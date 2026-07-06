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
// app.use('/api/sizing', require('./routes/sizing'));

app.listen(PORT, () => {
  console.log(`API server running on http://localhost:${PORT}`);
}).on('error', (err) => {
  console.error('Server startup error:', err);
});

// Test DB connection on startup
const pool = require('./db/connection');
pool.query('SELECT 1')
  .then(() => console.log('✓ Database connection successful'))
  .catch(err => console.error('✗ Database connection failed:', err.message));