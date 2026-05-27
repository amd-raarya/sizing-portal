const express = require('express');
const router = express.Router();
const pool = require('../db/connection');

// GET /api/projects - return all projects for the dropdown
router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT 
        project_id,
        project_name,
        project_code,
        BU,
        category,
        leader,
        top_level_team,
        status
      FROM RA_projects
      ORDER BY project_name ASC
    `);
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('Error fetching projects:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;