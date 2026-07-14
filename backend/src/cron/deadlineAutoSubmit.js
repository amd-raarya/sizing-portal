/**
 * Deadline Auto-Submit Cron Job
 * Runs daily at midnight — auto-submits draft versions for projects
 * whose sizing_deadline has passed and status is still 'pipeline'.
 */
const pool = require('../db/connection');
const { notifyDeadlineReminder, notifyAutoSubmit } = require('../services/emailService');

async function runDeadlineAutoSubmit() {
  console.log('[Cron] Running deadline auto-submit check...');
  try {
    // 1. Send deadline reminders for projects due in 7 days or 1 day
    const [reminderProjects] = await pool.query(`
      SELECT p.project_id, p.project_name, p.sizing_deadline,
             DATEDIFF(p.sizing_deadline, CURDATE()) AS days_left
      FROM RA_projects p
      WHERE p.status = 'pipeline'
        AND p.sizing_deadline IS NOT NULL
        AND DATEDIFF(p.sizing_deadline, CURDATE()) IN (7, 1)
    `);
    for (const proj of reminderProjects) {
      notifyDeadlineReminder(proj.project_name, proj.sizing_deadline, proj.days_left);
    }

    // 2. Find projects past their deadline with a draft version and still in pipeline
    const [projects] = await pool.query(`
      SELECT p.project_id, p.project_name, p.sizing_deadline,
             v.version_id
      FROM RA_projects p
      JOIN RA_sizing_versions v ON v.version_id = (
        SELECT sv.version_id FROM RA_sizing_versions sv
        WHERE sv.project_id = p.project_id
          AND sv.version_status = 'draft'
        ORDER BY sv.created_at DESC LIMIT 1
      )
      WHERE p.status = 'pipeline'
        AND p.sizing_deadline IS NOT NULL
        AND p.sizing_deadline <= CURDATE()
    `);

    if (projects.length === 0) {
      console.log('[Cron] No projects require auto-submit.');
      return;
    }

    console.log(`[Cron] Found ${projects.length} project(s) past deadline — auto-submitting...`);

    for (const proj of projects) {
      try {
        // Submit the draft version
        await pool.query(
          `UPDATE RA_sizing_versions
           SET version_status = 'submitted',
               submitted_at = NOW(),
               submitted_by = 'system:auto-submit',
               is_current = 1
           WHERE version_id = ?`,
          [proj.version_id]
        );

        // Move project to under review
        await pool.query(
          `UPDATE RA_projects SET status = 'under review', updated_at = NOW()
           WHERE project_id = ? AND status = 'pipeline'`,
          [proj.project_id]
        );

        console.log(`[Cron] Auto-submitted: ${proj.project_name} (project_id=${proj.project_id}, version_id=${proj.version_id}, deadline=${proj.sizing_deadline})`);
        // Send auto-submit notification with Excel
        notifyAutoSubmit(proj.project_name, proj.version_id, proj.sizing_deadline);
      } catch (err) {
        console.error(`[Cron] Failed to auto-submit ${proj.project_name}:`, err.message);
      }
    }

    console.log('[Cron] Deadline auto-submit complete.');
  } catch (err) {
    console.error('[Cron] Error running deadline auto-submit:', err.message);
  }
}

module.exports = { runDeadlineAutoSubmit };
