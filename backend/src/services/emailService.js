const nodemailer = require('nodemailer');
const ExcelJS = require('exceljs');
const pool = require('../db/connection');

const NOTIFY_EMAIL = 'rahul.arya@amd.com';
const FROM_EMAIL = 'sizing-portal@amd.com';

// AMD internal SMTP relay — no auth needed for internal servers
const transporter = nodemailer.createTransport({
  host: 'smtp.amd.com',
  port: 25,
  secure: false,
  tls: { rejectUnauthorized: false }
});

// ── Generate Excel buffer for a version ──
async function generateSizingExcel(versionId, projectName) {
  const [rows] = await pool.query(`
    SELECT sh.function_contact, sh.location, sh.hc_type, sh.manager_name,
           sh.scope, sh.assumptions, sh.risks, sh.notes,
           sq.fiscal_year, sq.quarter, sq.headcount
    FROM RA_staging_headcount sh
    LEFT JOIN RA_staging_quarterly sq ON sq.staging_id = sh.staging_id
    WHERE sh.version_id = ?
    ORDER BY sh.staging_id, sq.fiscal_year, sq.quarter
  `, [versionId]);

  // Group by staging_id
  const rowMap = new Map();
  rows.forEach(r => {
    if (!rowMap.has(r.function_contact + r.location)) {
      rowMap.set(r.function_contact + r.location, {
        function_contact: r.function_contact,
        location: r.location,
        hc_type: r.hc_type,
        manager_name: r.manager_name || '',
        scope: r.scope || '',
        quarters: {}
      });
    }
    if (r.fiscal_year) {
      const label = `Q${r.quarter} FY${String(r.fiscal_year).slice(-2)}`;
      rowMap.get(r.function_contact + r.location).quarters[label] = r.headcount;
    }
  });

  const dataRows = Array.from(rowMap.values());

  // Get all unique quarter labels sorted
  const quarterSet = new Set();
  dataRows.forEach(r => Object.keys(r.quarters).forEach(q => quarterSet.add(q)));
  const quarters = Array.from(quarterSet).sort();

  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet('Sizing');

  // Header
  ws.columns = [
    { header: 'Function / Contact', key: 'function_contact', width: 35 },
    { header: 'Location', key: 'location', width: 18 },
    { header: 'HC Type', key: 'hc_type', width: 20 },
    { header: 'Manager', key: 'manager_name', width: 20 },
    { header: 'Scope', key: 'scope', width: 30 },
    ...quarters.map(q => ({ header: q, key: q, width: 10 })),
    { header: 'Total HC', key: 'total', width: 10 }
  ];

  // Style header row
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1a1a2e' } };

  // Data rows
  dataRows.forEach(row => {
    const totalHC = quarters.reduce((s, q) => s + (Number(row.quarters[q]) || 0), 0);
    const rowData = {
      function_contact: row.function_contact,
      location: row.location,
      hc_type: row.hc_type,
      manager_name: row.manager_name,
      scope: row.scope,
      total: Math.round(totalHC * 10) / 10
    };
    quarters.forEach(q => { rowData[q] = Number(row.quarters[q]) || 0; });
    ws.addRow(rowData);
  });

  // Total row
  const totalRow = { function_contact: 'TOTAL', location: '', hc_type: '', manager_name: '', scope: '' };
  let grandTotal = 0;
  quarters.forEach(q => {
    const sum = dataRows.reduce((s, r) => s + (Number(r.quarters[q]) || 0), 0);
    totalRow[q] = Math.round(sum * 10) / 10;
    grandTotal += sum;
  });
  totalRow.total = Math.round(grandTotal * 10) / 10;
  const tr = ws.addRow(totalRow);
  tr.font = { bold: true };
  tr.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFDE7' } };

  const buffer = await workbook.xlsx.writeBuffer();
  return { buffer, fileName: `${projectName.replace(/[^a-zA-Z0-9]/g, '_')}_Sizing_v${versionId}.xlsx` };
}

// ── Send save notification (no attachment) ──
async function notifySaveDraft(projectName, savedBy, versionId) {
  try {
    await transporter.sendMail({
      from: FROM_EMAIL,
      to: NOTIFY_EMAIL,
      subject: `[Sizing Portal] Draft saved — ${projectName}`,
      html: `
        <p>A sizing draft was saved for <strong>${projectName}</strong>.</p>
        <ul>
          <li><b>Saved by:</b> ${savedBy || 'Unknown'}</li>
          <li><b>Version:</b> #${versionId}</li>
          <li><b>Time:</b> ${new Date().toLocaleString()}</li>
        </ul>
        <p>No action required — this is an informational notification.</p>
      `
    });
    console.log(`[Email] Save notification sent for ${projectName}`);
  } catch (err) {
    console.error('[Email] Failed to send save notification:', err.message);
  }
}

// ── Send submit notification (with Excel) ──
async function notifySubmit(projectName, submittedBy, versionId) {
  try {
    const { buffer, fileName } = await generateSizingExcel(versionId, projectName);
    await transporter.sendMail({
      from: FROM_EMAIL,
      to: NOTIFY_EMAIL,
      subject: `[Sizing Portal] Sizing submitted — ${projectName}`,
      html: `
        <p>Sizing has been <strong>submitted</strong> for <strong>${projectName}</strong>.</p>
        <ul>
          <li><b>Submitted by:</b> ${submittedBy || 'Unknown'}</li>
          <li><b>Version:</b> #${versionId}</li>
          <li><b>Time:</b> ${new Date().toLocaleString()}</li>
        </ul>
        <p>The full sizing data is attached as an Excel file for your review.</p>
      `,
      attachments: [{ filename: fileName, content: buffer }]
    });
    console.log(`[Email] Submit notification sent for ${projectName}`);
  } catch (err) {
    console.error('[Email] Failed to send submit notification:', err.message);
  }
}

// ── Send deadline reminder ──
async function notifyDeadlineReminder(projectName, deadline, daysLeft) {
  try {
    const urgency = daysLeft <= 1 ? 'URGENT' : 'Reminder';
    const dayText = daysLeft === 0 ? 'TODAY' : daysLeft === 1 ? 'tomorrow' : `in ${daysLeft} days`;
    await transporter.sendMail({
      from: FROM_EMAIL,
      to: NOTIFY_EMAIL,
      subject: `[Sizing Portal] ${urgency} — ${projectName} deadline ${dayText}`,
      html: `
        <p>The sizing deadline for <strong>${projectName}</strong> is <strong>${dayText}</strong>.</p>
        <ul>
          <li><b>Deadline:</b> ${new Date(deadline).toDateString()}</li>
          <li><b>Days remaining:</b> ${daysLeft === 0 ? 'Today is the deadline' : daysLeft}</li>
        </ul>
        <p>Please ensure the PM submits sizing before the deadline. If not submitted by end of day, it will be auto-submitted.</p>
      `
    });
    console.log(`[Email] Deadline reminder sent for ${projectName} (${daysLeft} days left)`);
  } catch (err) {
    console.error('[Email] Failed to send deadline reminder:', err.message);
  }
}

// ── Send auto-submit notification (with Excel) ──
async function notifyAutoSubmit(projectName, versionId, deadline) {
  try {
    const { buffer, fileName } = await generateSizingExcel(versionId, projectName);
    await transporter.sendMail({
      from: FROM_EMAIL,
      to: NOTIFY_EMAIL,
      subject: `[Sizing Portal] Auto-submitted — ${projectName}`,
      html: `
        <p>The sizing deadline for <strong>${projectName}</strong> has been reached.</p>
        <p>The draft was <strong>automatically submitted</strong> by the system.</p>
        <ul>
          <li><b>Deadline:</b> ${new Date(deadline).toDateString()}</li>
          <li><b>Version:</b> #${versionId}</li>
          <li><b>Submitted by:</b> system:auto-submit</li>
          <li><b>Time:</b> ${new Date().toLocaleString()}</li>
        </ul>
        <p>The full sizing data is attached. The project is now <strong>Under Review</strong>.</p>
      `,
      attachments: [{ filename: fileName, content: buffer }]
    });
    console.log(`[Email] Auto-submit notification sent for ${projectName}`);
  } catch (err) {
    console.error('[Email] Failed to send auto-submit notification:', err.message);
  }
}

module.exports = {
  notifySaveDraft,
  notifySubmit,
  notifyAutoSubmit,
  notifyDeadlineReminder
};
