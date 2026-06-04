const express = require('express');
const router = express.Router();
const pool = require('../db/connection');

// Elevated roles — see all projects automatically
const ELEVATED_ROLES = ['Senior Manager', 'Director', 'VP'];

// GET /api/projects - return projects based on caller's role
// Query param: pm_user_id (optional) — if provided, filters by access for regular PMs
router.get('/', async (req, res) => {
  try {
    const { pm_user_id } = req.query;

    // If a pm_user_id is provided, check their role first
    if (pm_user_id) {
      const [userRows] = await pool.query(
        `SELECT u.pm_user_id, per.role
         FROM RA_pm_users u
         LEFT JOIN RA_people per ON u.person_id = per.person_id
         WHERE u.pm_user_id = ?`,
        [pm_user_id]
      );

      // If user has elevated role OR user not found — return ALL projects
      if (!userRows.length || ELEVATED_ROLES.includes(userRows[0]?.role)) {
        const [rows] = await pool.query(
          `SELECT p.project_id, p.project_name, p.project_code, p.BU, p.category,
                  p.leader, p.top_level_team, p.status,
                  v.submitted_by, v.version_status, v.submitted_at
           FROM RA_projects p
           LEFT JOIN RA_sizing_versions v ON v.project_id = p.project_id AND v.is_current = 1
           ORDER BY p.project_name ASC`
        );
        return res.json({ success: true, data: rows, access: 'full' });
      }

      // Regular PM — return only their granted projects
      const [rows] = await pool.query(
        `SELECT p.project_id, p.project_name, p.project_code, p.BU, p.category,
                p.leader, p.top_level_team, p.status,
                v.submitted_by, v.version_status, v.submitted_at,
                a.can_edit, a.can_submit
         FROM RA_projects p
         JOIN RA_pm_project_access a ON p.project_id = a.project_id AND a.pm_user_id = ?
         LEFT JOIN RA_sizing_versions v ON v.project_id = p.project_id AND v.is_current = 1
         ORDER BY p.project_name ASC`,
        [pm_user_id]
      );
      return res.json({ success: true, data: rows, access: 'restricted' });
    }

    // No pm_user_id — return all projects (admin / unauthenticated for now)
    const [rows] = await pool.query(
      `SELECT p.project_id, p.project_name, p.project_code, p.BU, p.category,
              p.leader, p.top_level_team, p.status,
              v.submitted_by, v.version_status, v.submitted_at
       FROM RA_projects p
       LEFT JOIN RA_sizing_versions v ON v.project_id = p.project_id AND v.is_current = 1
       ORDER BY p.project_name ASC`
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('Error fetching projects:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/projects/:id - return a single project
router.get('/:id', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT project_id, project_name, project_code, BU, category, leader, top_level_team, status
       FROM RA_projects WHERE project_id = ?`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ success: false, error: 'Project not found' });
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    console.error('Error fetching project:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});
// GET /api/projects/:id/draft — latest draft version for a project
router.get('/:id/draft', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT version_id FROM RA_sizing_versions
       WHERE project_id = ? AND version_status = 'draft'
       ORDER BY created_at DESC LIMIT 1`,
      [req.params.id]
    );
    res.json({ success: true, data: rows.length ? rows[0] : null });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/projects/:id/versions — create a new draft version
router.post('/:id/versions', async (req, res) => {
  try {
    const [result] = await pool.query(
      `INSERT INTO RA_sizing_versions (project_id, version_status, is_current) VALUES (?, 'draft', 0)`,
      [req.params.id]
    );
    res.json({ success: true, data: { version_id: result.insertId } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
module.exports = router;