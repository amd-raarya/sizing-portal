const https = require('https');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Serve uploaded files publicly at /uploads/<filename>
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date() });
});

// Routes (we'll add these one by one)
app.use('/api/projects',   require('./routes/projects'));
app.use('/api/versions',   require('./routes/versions'));
app.use('/api/functions',  require('./routes/functions'));
app.use('/api/admin',      require('./routes/admin'));
app.use('/api/documents',  require('./routes/documents'));
app.use('/api/allocation', require('./routes/allocation'));

// Serve Angular frontend (production build)
app.use(express.static(path.join(__dirname, '../../frontend/dist/frontend/browser')));
app.get('/{*splat}', (req, res) => {
  res.sendFile(path.join(__dirname, '../../frontend/dist/frontend/browser/index.html'));
});

// Use HTTPS if certs exist (production server), fall back to HTTP (local dev)
const CERT_PATH = process.env.SSL_KEY || '/home/raarya/sizing-portal/certs/key.pem';
if (fs.existsSync(CERT_PATH)) {
  const sslOptions = {
    key: fs.readFileSync(process.env.SSL_KEY || '/home/raarya/sizing-portal/certs/key.pem'),
    cert: fs.readFileSync(process.env.SSL_CERT || '/home/raarya/sizing-portal/certs/cert.pem')
  };
  https.createServer(sslOptions, app).listen(PORT, () => {
    console.log(`API server running on https://localhost:${PORT}`);
  }).on('error', err => console.error('Server startup error:', err));
} else {
  app.listen(PORT, () => {
    console.log(`API server running on http://localhost:${PORT} (no SSL certs found)`);
  }).on('error', err => console.error('Server startup error:', err));
}

// Test DB connection on startup
const pool = require('./db/connection');
pool.query('SELECT 1')
  .then(() => console.log('✓ Database connection successful'))
  .catch(err => console.error('✗ Database connection failed:', err.message));

// ── Deadline Auto-Submit Cron — checks every minute ──
// A deadline date auto-submits the draft at 5:00 PM Toronto time (EDT/EST) on that date.
const { runDeadlineAutoSubmit } = require('./cron/deadlineAutoSubmit');

// Run once on startup to catch any missed deadlines, then every minute
runDeadlineAutoSubmit();
setInterval(runDeadlineAutoSubmit, 60 * 1000);
console.log('[Cron] Deadline auto-submit check scheduled every minute (cutoff 5:00 PM America/Toronto)');
