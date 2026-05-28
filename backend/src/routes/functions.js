const express = require('express');
const router = express.Router();
const pool = require('../db/connection');

router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT function_name FROM RA_function_suggestions ORDER BY function_name ASC'
    );
    res.json({ success: true, data: rows.map(r => r.function_name) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { function_name } = req.body;
    if (!function_name?.trim())
      return res.status(400).json({ success: false, error: 'function_name required' });
    await pool.query(
      'INSERT IGNORE INTO RA_function_suggestions (function_name) VALUES (?)',
      [function_name.trim()]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;