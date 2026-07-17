const express = require('express');
const router = express.Router();
const pool = require('../db/connection');
const { notifySaveDraft, notifySubmit } = require('../services/emailService');

// GET /api/versions/sizing-summary — MUST be before /:id to avoid route conflict
router.get('/sizing-summary', async (req, res) => {
  try {
    // Get latest version per project + all headcount in one query.
    // Uses MAX(version_id) per project — version_id is auto-increment so highest = most recent.
    // LEFT JOIN headcount so projects with no HC rows still appear (shown with empty hc:{}).
    const [rows] = await pool.query(`
      SELECT
        p.project_name, p.BU, p.top_level_team AS team,
        v.version_status, v.version_id,
        sh.function_contact, sh.location, sh.hc_type, sh.manager_name, sh.scope,
        sq.fiscal_year, sq.quarter, sq.headcount
      FROM RA_projects p
      JOIN RA_sizing_versions v ON v.version_id = (
        SELECT MAX(sv2.version_id)
        FROM RA_sizing_versions sv2
        WHERE sv2.project_id = p.project_id
      )
      LEFT JOIN RA_staging_headcount sh ON sh.version_id = v.version_id
      LEFT JOIN RA_staging_quarterly sq
        ON sq.staging_id = sh.staging_id AND sq.headcount > 0
      WHERE p.status NOT IN ('cancelled','closed')
      ORDER BY p.project_name, sh.staging_id, sq.fiscal_year, sq.quarter
    `);
    const rowMap = new Map();
    rows.forEach(row => {
      const key = `${row.project_name}::${row.function_contact}::${row.location}::${row.hc_type}`;
      if (!rowMap.has(key)) {
        rowMap.set(key, {
          project: row.project_name, bu: row.BU || '', team: row.team || '',
          fn: row.function_contact || '', location: row.location || '',
          hcType: row.hc_type || '', manager_name: row.manager_name || '',
          scope: row.scope || '', hc: {},
          version_status: row.version_status,
          version_id: row.version_id
        });
      }
      if (row.fiscal_year) {
        const label = `Q${row.quarter} FY${String(row.fiscal_year).slice(-2)}`;
        rowMap.get(key).hc[label] = parseFloat(row.headcount);
      }
    });
    res.json({ success: true, data: Array.from(rowMap.values()) });
  } catch (err) {
    console.error('GET /versions/sizing-summary error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/versions/:id — get version with all rows and quarterly data
router.get('/:id', async (req, res) => {
  try {
    const [versions] = await pool.query(
      'SELECT * FROM RA_sizing_versions WHERE version_id = ?',
      [req.params.id]
    );
    if (versions.length === 0)
      return res.status(404).json({ success: false, error: 'Version not found' });

    const [rows] = await pool.query(`
      SELECT sh.staging_id, sh.function_contact, sh.location, sh.hc_type, sh.manager_name,
             sh.scope, sh.assumptions, sh.risks, sh.notes,
             sq.fiscal_year, sq.quarter, sq.headcount
      FROM RA_staging_headcount sh
      LEFT JOIN RA_staging_quarterly sq ON sh.staging_id = sq.staging_id
      WHERE sh.version_id = ?
      ORDER BY sh.staging_id, sq.fiscal_year, sq.quarter
    `, [req.params.id]);

    const rowMap = new Map();
    rows.forEach(row => {
      if (!rowMap.has(row.staging_id)) {
        rowMap.set(row.staging_id, {
          staging_id: row.staging_id,
          function_contact: row.function_contact || '',
          location: row.location || '',
          hc_type: row.hc_type || '',
          manager_name: row.manager_name || '',
          scope: row.scope || '',
          assumptions: row.assumptions || '',
          risks: row.risks || '',
          notes: row.notes || '',
          quarters: {}
        });
      }
      if (row.fiscal_year) {
        const label = `Q${row.quarter} FY${String(row.fiscal_year).slice(-2)}`;
        rowMap.get(row.staging_id).quarters[label] = parseFloat(row.headcount);
      }
    });

    res.json({ success: true, data: { version: versions[0], rows: Array.from(rowMap.values()) } });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/versions/:id/rows — save all rows (replace existing)
router.post('/:id/rows', async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const versionId = req.params.id;
    const { rows, quarters, saved_by = null } = req.body;

    // Track who last saved this draft and when
    await connection.query(
      `UPDATE RA_sizing_versions SET last_saved_by = ?, last_saved_at = NOW() WHERE version_id = ?`,
      [saved_by || null, versionId]
    );

    const [existing] = await connection.query(
      'SELECT staging_id FROM RA_staging_headcount WHERE version_id = ?', [versionId]
    );
    if (existing.length > 0) {
      const ids = existing.map(r => r.staging_id);
      await connection.query('DELETE FROM RA_staging_quarterly WHERE staging_id IN (?)', [ids]);
      await connection.query('DELETE FROM RA_staging_headcount WHERE version_id = ?', [versionId]);
    }

    // Build a Set of all selected quarter labels (sent from the frontend picker)
    // so we can persist them as 0-value rows even if user hasn't typed HC yet.
    // This ensures columns are restored on next page load even if HC is 0.
    const selectedQuarterLabels = new Set(
      (quarters || []).map(q => q.label || `Q${q.quarter} FY${String(q.fiscal_year).slice(-2)}`)
    );

    for (const row of rows) {
      const [result] = await connection.query(
        `INSERT INTO RA_staging_headcount
          (version_id, function_contact, location, hc_type, manager_name, scope, assumptions, risks, notes, import_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft')`,
        [versionId, row.function_contact, row.location, row.hc_type, row.manager_name || null,
         row.scope || null, row.assumptions || null, row.risks || null, row.notes || null]
      );
      const stagingId = result.insertId;

      // Save ALL quarter data from row.quarters directly.
      // Also persist 0 for any selected quarter that has no value yet —
      // this preserves the column selection across sessions.
      const savedLabels = new Set();
      for (const [label, val] of Object.entries(row.quarters || {})) {
        const match = label.match(/Q(\d)\s+FY(\d{2})/);
        if (!match) continue;
        const quarter = parseInt(match[1]);
        const fiscal_year = 2000 + parseInt(match[2]);
        const hc = (val === null || val === undefined || val === '') ? 0 : (parseFloat(String(val)) || 0);
        await connection.query(
          'INSERT INTO RA_staging_quarterly (staging_id, fiscal_year, quarter, headcount) VALUES (?, ?, ?, ?)',
          [stagingId, fiscal_year, quarter, hc]
        );
        savedLabels.add(label);
      }
      // Persist any selected quarters not yet in row.quarters (user added column but didn't type yet)
      for (const label of selectedQuarterLabels) {
        if (savedLabels.has(label)) continue;
        const match = label.match(/Q(\d)\s+FY(\d{2})/);
        if (!match) continue;
        const quarter = parseInt(match[1]);
        const fiscal_year = 2000 + parseInt(match[2]);
        await connection.query(
          'INSERT INTO RA_staging_quarterly (staging_id, fiscal_year, quarter, headcount) VALUES (?, ?, ?, ?)',
          [stagingId, fiscal_year, quarter, 0]
        );
      }
    }

    await connection.commit();
    res.json({ success: true });

    // Send save notification (fire and forget — don't block response)
    try {
      const [proj] = await pool.query(
        'SELECT project_name FROM RA_projects p JOIN RA_sizing_versions v ON v.project_id = p.project_id WHERE v.version_id = ?',
        [versionId]
      );
      if (proj.length > 0) {
        notifySaveDraft(proj[0].project_name, saved_by, versionId);
      }
    } catch {}

  } catch (err) {
    await connection.rollback();
    console.error(err.message);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    connection.release();
  }
});

// PATCH /api/versions/:id/scope — save scope_notes on a version
router.patch('/:id/scope', async (req, res) => {
  try {
    const { scope_notes } = req.body;
    await pool.query(
      'UPDATE RA_sizing_versions SET scope_notes = ? WHERE version_id = ?',
      [scope_notes || null, req.params.id]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('PATCH scope error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT /api/versions/:id/submit
router.put('/:id/submit', async (req, res) => {
  try {
    const { submitted_by = null } = req.body;
    // 1. Mark version as submitted with who submitted it
    await pool.query(
      `UPDATE RA_sizing_versions SET version_status = 'submitted', submitted_at = NOW(),
       is_current = 1, submitted_by = ?
       WHERE version_id = ?`,
      [submitted_by, req.params.id]
    );
    // 2. Move project to 'under review' — locked for sizing until BU responds
    await pool.query(
      `UPDATE RA_projects p
       JOIN RA_sizing_versions v ON v.version_id = ?
       SET p.status = 'under review'
       WHERE p.project_id = v.project_id AND p.status = 'pipeline'`,
      [req.params.id]
    );
    res.json({ success: true });

    // Send submit notification with Excel attachment (fire and forget)
    try {
      const [proj] = await pool.query(
        'SELECT p.project_name FROM RA_projects p JOIN RA_sizing_versions v ON v.project_id = p.project_id WHERE v.version_id = ?',
        [req.params.id]
      );
      if (proj.length > 0) {
        notifySubmit(proj[0].project_name, submitted_by, parseInt(req.params.id));
      }
    } catch {}

  } catch (err) {
    console.error(err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});
// GET /api/versions/:id/milestones
router.get('/:id/milestones', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT milestone_name, start_date, end_date 
       FROM RA_version_milestones WHERE version_id = ?`,
      [req.params.id]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/versions/:id/milestones — upsert a milestone date
router.post('/:id/milestones', async (req, res) => {
  try {
    const { milestone_name, start_date, end_date } = req.body;
    await pool.query(
      `INSERT INTO RA_version_milestones (version_id, milestone_name, start_date, end_date)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE start_date = VALUES(start_date), end_date = VALUES(end_date)`,
      [req.params.id, milestone_name, start_date, end_date || null]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
module.exports = router;