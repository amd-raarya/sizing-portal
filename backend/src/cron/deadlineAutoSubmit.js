/**
 * Deadline Auto-Submit Cron Job
 *
 * Runs every minute. A project's sizing deadline is a calendar DATE; the draft is
 * auto-submitted at 5:00 PM Toronto time (America/Toronto — EDT or EST depending on
 * the date) on that date. Applies to draft versions of projects still in 'pipeline'.
 *
 * Deadline reminders (7 days / 1 day before) go out once per Toronto day, from 8:00 AM.
 */
const pool = require('../db/connection');
const { notifyDeadlineReminder, notifyAutoSubmit } = require('../services/emailService');

const DEADLINE_TZ = 'America/Toronto';
const CUTOFF_HOUR = 17;   // 5 PM Toronto
const REMINDER_HOUR = 8;  // 8 AM Toronto

const torontoFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: DEADLINE_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', hourCycle: 'h23',
});

/** Current Toronto calendar date ('YYYY-MM-DD') and hour (0-23). DST handled by Intl. */
function torontoNow(now = new Date()) {
  const p = Object.fromEntries(torontoFmt.formatToParts(now).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) };
}

/** True once it is 5 PM Toronto time on the deadline date, or any later day. */
function isDeadlinePassed(deadlineDate, now = new Date()) {
  const t = torontoNow(now);
  return t.date > deadlineDate || (t.date === deadlineDate && t.hour >= CUTOFF_HOUR);
}

function daysBetween(fromDate, toDate) {
  return Math.round((Date.parse(toDate + 'T00:00:00Z') - Date.parse(fromDate + 'T00:00:00Z')) / 86400000);
}

let running = false;
const remindersSent = new Set(); // `${project_id}:${days_left}:${toronto date}` — in-memory, per process

async function runDeadlineAutoSubmit() {
  if (running) return;
  running = true;
  try {
    const now = torontoNow();

    // Pipeline projects with a deadline in the near past/future (the 2-day margin covers any server/DB time-zone slop)
    const [candidates] = await pool.query(`
      SELECT p.project_id, p.project_name,
             DATE_FORMAT(p.sizing_deadline, '%Y-%m-%d') AS deadline_str
      FROM RA_projects p
      WHERE p.status = 'pipeline'
        AND p.sizing_deadline IS NOT NULL
        AND p.sizing_deadline <= DATE_ADD(CURDATE(), INTERVAL 9 DAY)
    `);
    if (candidates.length === 0) return;

    // 1. Reminders: 7 days and 1 day before the deadline date (Toronto calendar), once per day, from 8 AM
    if (now.hour >= REMINDER_HOUR) {
      for (const proj of candidates) {
        const daysLeft = daysBetween(now.date, proj.deadline_str);
        if (daysLeft !== 7 && daysLeft !== 1) continue;
        const key = `${proj.project_id}:${daysLeft}:${now.date}`;
        if (remindersSent.has(key)) continue;
        remindersSent.add(key);
        notifyDeadlineReminder(proj.project_name, proj.deadline_str, daysLeft);
      }
    }

    // 2. Auto-submit: deadline date reached AND it is 5 PM Toronto time (or later)
    const due = candidates.filter(c => isDeadlinePassed(c.deadline_str));
    if (due.length === 0) return;

    for (const proj of due) {
      try {
        const [[v]] = await pool.query(
          `SELECT version_id FROM RA_sizing_versions
           WHERE project_id = ? AND version_status = 'draft'
           ORDER BY created_at DESC LIMIT 1`,
          [proj.project_id]
        );
        if (!v) continue; // nothing to submit

        await pool.query(
          `UPDATE RA_sizing_versions
           SET version_status = 'submitted',
               submitted_at = NOW(),
               submitted_by = 'system:auto-submit',
               is_current = 1
           WHERE version_id = ?`,
          [v.version_id]
        );

        // Move project to under review
        await pool.query(
          `UPDATE RA_projects SET status = 'under review', updated_at = NOW()
           WHERE project_id = ? AND status = 'pipeline'`,
          [proj.project_id]
        );

        console.log(`[Cron] Auto-submitted: ${proj.project_name} (project_id=${proj.project_id}, version_id=${v.version_id}, deadline=${proj.deadline_str} 17:00 ${DEADLINE_TZ})`);
        notifyAutoSubmit(proj.project_name, v.version_id, proj.deadline_str);
      } catch (err) {
        console.error(`[Cron] Failed to auto-submit ${proj.project_name}:`, err.message);
      }
    }
  } catch (err) {
    console.error('[Cron] Error running deadline auto-submit:', err.message);
  } finally {
    running = false;
  }
}

module.exports = { runDeadlineAutoSubmit, isDeadlinePassed, torontoNow, DEADLINE_TZ, CUTOFF_HOUR };
