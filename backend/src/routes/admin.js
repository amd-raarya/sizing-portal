const express = require('express');
const router = express.Router();
const pool = require('../db/connection');

// ─── PM USERS ──────────────────────────────────────────────────────────────

// GET /api/admin/users — list all PM users with their person info
router.get('/users', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT u.pm_user_id, u.display_name, u.email, u.is_active, u.created_at,
             u.azure_object_id,
             p.role, p.location, p.function_area, p.top_level_team,
             COUNT(a.id) AS project_count
      FROM RA_pm_users u
      LEFT JOIN RA_people p ON u.person_id = p.person_id
      LEFT JOIN RA_pm_project_access a ON u.pm_user_id = a.pm_user_id
      GROUP BY u.pm_user_id
      ORDER BY u.display_name ASC
    `);
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('GET /admin/users error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/admin/users — create a new PM user
router.post('/users', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const { display_name, email, role = 'Project Manager', location, top_level_team, function_area } = req.body;

    if (!display_name || !email)
      return res.status(400).json({ success: false, error: 'display_name and email are required' });

    // Create person record first
    const [personResult] = await conn.query(
      `INSERT INTO RA_people (display_name, email, role, location, top_level_team, function_area)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [display_name, email, role, location || null, top_level_team || null, function_area || null]
    );
    const personId = personResult.insertId;

    // Create PM user record
    const [userResult] = await conn.query(
      `INSERT INTO RA_pm_users (person_id, display_name, email, is_active)
       VALUES (?, ?, ?, 1)`,
      [personId, display_name, email]
    );

    await conn.commit();
    res.json({ success: true, data: { pm_user_id: userResult.insertId, person_id: personId } });
  } catch (err) {
    await conn.rollback();
    console.error('POST /admin/users error:', err.message);
    if (err.code === 'ER_DUP_ENTRY')
      return res.status(409).json({ success: false, error: 'A user with this email already exists' });
    res.status(500).json({ success: false, error: err.message });
  } finally {
    conn.release();
  }
});

// GET /api/admin/users/:id — get single user with role info
router.get('/users/:id', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT u.pm_user_id, u.display_name, u.email, u.is_active,
              p.role, p.location, p.person_id
       FROM RA_pm_users u
       LEFT JOIN RA_people p ON u.person_id = p.person_id
       WHERE u.pm_user_id = ?`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'User not found' });
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PATCH /api/admin/users/:id/toggle — activate or deactivate a PM user
router.patch('/users/:id/toggle', async (req, res) => {
  try {
    const [current] = await pool.query('SELECT is_active FROM RA_pm_users WHERE pm_user_id = ?', [req.params.id]);
    if (!current.length) return res.status(404).json({ success: false, error: 'User not found' });

    const newStatus = current[0].is_active ? 0 : 1;
    await pool.query('UPDATE RA_pm_users SET is_active = ? WHERE pm_user_id = ?', [newStatus, req.params.id]);
    res.json({ success: true, data: { is_active: newStatus } });
  } catch (err) {
    console.error('PATCH /admin/users/:id/toggle error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── PROJECT ACCESS ─────────────────────────────────────────────────────────

// GET /api/admin/access — all projects with their assigned users
router.get('/access', async (req, res) => {
  try {
    const [projects] = await pool.query(
      'SELECT project_id, project_name, project_code, BU, status FROM RA_projects ORDER BY project_name ASC'
    );
    const [access] = await pool.query(`
      SELECT a.id, a.pm_user_id, a.project_id, a.can_edit, a.can_submit,
             u.display_name, u.email, u.is_active
      FROM RA_pm_project_access a
      JOIN RA_pm_users u ON a.pm_user_id = u.pm_user_id
      ORDER BY a.project_id, u.display_name
    `);
    res.json({ success: true, data: { projects, access } });
  } catch (err) {
    console.error('GET /admin/access error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/admin/access/:pm_user_id — all access for one PM user
router.get('/access/:pm_user_id', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT a.id, a.project_id, a.can_edit, a.can_submit, a.granted_at,
             p.project_name, p.project_code, p.BU, p.status
      FROM RA_pm_project_access a
      JOIN RA_projects p ON a.project_id = p.project_id
      WHERE a.pm_user_id = ?
      ORDER BY p.project_name ASC
    `, [req.params.pm_user_id]);
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('GET /admin/access/:id error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/admin/access — grant project access
router.post('/access', async (req, res) => {
  try {
    const { pm_user_id, project_id, can_edit = 1, can_submit = 1 } = req.body;
    if (!pm_user_id || !project_id)
      return res.status(400).json({ success: false, error: 'pm_user_id and project_id required' });

    const [result] = await pool.query(
      `INSERT INTO RA_pm_project_access (pm_user_id, project_id, can_edit, can_submit)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE can_edit = VALUES(can_edit), can_submit = VALUES(can_submit)`,
      [pm_user_id, project_id, can_edit, can_submit]
    );
    res.json({ success: true, data: { id: result.insertId } });
  } catch (err) {
    console.error('POST /admin/access error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// PATCH /api/admin/access/:id — update can_edit / can_submit
router.patch('/access/:id', async (req, res) => {
  try {
    const { can_edit, can_submit } = req.body;
    await pool.query(
      'UPDATE RA_pm_project_access SET can_edit = ?, can_submit = ? WHERE id = ?',
      [can_edit ? 1 : 0, can_submit ? 1 : 0, req.params.id]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('PATCH /admin/access/:id error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/admin/access/:id — revoke access
router.delete('/access/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM RA_pm_project_access WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /admin/access/:id error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
