'use strict';
/**
 * 2026-11-09: re-learn every bucket with the new lifecycle handling (stretch to a common length, default = median member length).
 * Backs the bucket rows up to backups/pre_curve_stretch_20261109/ first.
 *   node scripts/relearn_buckets_stretch.js         -> dry run (prints old vs new length)
 *   node scripts/relearn_buckets_stretch.js apply
 */
require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const fe = require('../src/services/forecastEstimate');

const APPLY = process.argv[2] === 'apply';
(async () => {
  const pool = mysql.createPool({ host: process.env.DB_HOST, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME, port: Number(process.env.DB_PORT || 3306) });
  await fe.listBuckets(pool);   // makes sure tables / columns exist
  const [rows] = await pool.query('SELECT * FROM RA_forecast_buckets ORDER BY bucket_id');
  if (APPLY) {
    const dir = path.join(__dirname, '..', 'backups', 'pre_curve_stretch_20261109');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'RA_forecast_buckets.json'), JSON.stringify(rows, null, 2));
    console.log('backup written to', dir);
  }
  for (const b of rows) {
    const oldLen = JSON.parse(b.curve_json).length;
    const l = await fe.relearnBucket(pool, b.bucket_id, { dryRun: !APPLY });
    console.log(`${b.code} ${b.name}: ${oldLen} -> ${l ? l.curve.length : 'no data'} quarters${APPLY ? ' (saved)' : ' (dry run)'}`);
  }
  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
