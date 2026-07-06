const express = require('express');
const router = express.Router();
const pool = require('../db/connection');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// ── File storage setup ──
const uploadDir = path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${Date.now()}_${safe}`);
  }
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } }); // 50MB

// GET /api/documents/project/:projectId — get all docs for a project
router.get('/project/:projectId', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT * FROM RA_project_documents WHERE project_id = ? ORDER BY created_at DESC`,
      [req.params.projectId]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('GET /documents/project error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/documents/project/:projectId/link — save a link
router.post('/project/:projectId/link', async (req, res) => {
  const { doc_label, doc_url, uploaded_by } = req.body;
  if (!doc_url) return res.status(400).json({ success: false, error: 'doc_url is required' });
  try {
    const [result] = await pool.query(
      `INSERT INTO RA_project_documents (project_id, doc_type, doc_label, doc_url, uploaded_by)
       VALUES (?, 'link', ?, ?, ?)`,
      [req.params.projectId, doc_label || doc_url, doc_url, uploaded_by || null]
    );
    res.json({ success: true, doc_id: result.insertId });
  } catch (err) {
    console.error('POST /documents/link error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/documents/project/:projectId/file — upload a file
router.post('/project/:projectId/file', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, error: 'No file uploaded' });
  const { uploaded_by } = req.body;
  try {
    // Build a publicly accessible URL for the file
    const host = req.get('host') || `localhost:3000`;
    const protocol = req.protocol || 'http';
    const fileUrl = `${protocol}://${host}/uploads/${req.file.filename}`;

    const [result] = await pool.query(
      `INSERT INTO RA_project_documents (project_id, doc_type, doc_label, doc_url, file_name, file_path, uploaded_by)
       VALUES (?, 'file', ?, ?, ?, ?, ?)`,
      [req.params.projectId, req.file.originalname, fileUrl, req.file.originalname, req.file.filename, uploaded_by || null]
    );
    res.json({ success: true, doc_id: result.insertId, file_name: req.file.originalname, file_url: fileUrl });
  } catch (err) {
    console.error('POST /documents/file error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/documents/:docId — delete a document
router.delete('/:docId', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT * FROM RA_project_documents WHERE doc_id = ?`, [req.params.docId]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Not found' });

    // Delete file from disk if it's a file type
    const doc = rows[0];
    if (doc.doc_type === 'file' && doc.file_path) {
      const filePath = path.join(uploadDir, doc.file_path);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }

    await pool.query(`DELETE FROM RA_project_documents WHERE doc_id = ?`, [req.params.docId]);
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /documents error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
