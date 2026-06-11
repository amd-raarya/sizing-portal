const express = require('express');
const router = express.Router();
const pool = require('../db/connection');

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
    const { rows, quarters } = req.body;

    const [existing] = await connection.query(
      'SELECT staging_id FROM RA_staging_headcount WHERE version_id = ?', [versionId]
    );
    if (existing.length > 0) {
      const ids = existing.map(r => r.staging_id);
      await connection.query('DELETE FROM RA_staging_quarterly WHERE staging_id IN (?)', [ids]);
      await connection.query('DELETE FROM RA_staging_headcount WHERE version_id = ?', [versionId]);
    }

    for (const row of rows) {
      const [result] = await connection.query(
        `INSERT INTO RA_staging_headcount
          (version_id, function_contact, location, hc_type, manager_name, scope, assumptions, risks, notes, import_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft')`,
        [versionId, row.function_contact, row.location, row.hc_type, row.manager_name || null,
         row.scope || null, row.assumptions || null, row.risks || null, row.notes || null]
      );
      const stagingId = result.insertId;

      for (const q of quarters) {
        const val = row.quarters[q.label];
        if (val !== null && val !== undefined && val !== '') {
          await connection.query(
            'INSERT INTO RA_staging_quarterly (staging_id, fiscal_year, quarter, headcount) VALUES (?, ?, ?, ?)',
            [stagingId, q.fiscal_year, q.quarter, parseFloat(val) || 0]
          );
        }
      }
    }

    await connection.commit();
    res.json({ success: true });
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
    // 1. Mark version as submitted
    await pool.query(
      `UPDATE RA_sizing_versions SET version_status = 'submitted', submitted_at = NOW(), is_current = 1
       WHERE version_id = ?`,
      [req.params.id]
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