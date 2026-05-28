const express = require('express');
const router = express.Router();
const pool = require('../db/connection');

// GET /api/projects - return all projects
router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT project_id, project_name, project_code, BU, category, leader, top_level_team, status
       FROM RA_projects ORDER BY project_name ASC`
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

module.exports = router;