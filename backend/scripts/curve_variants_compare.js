'use strict';
/**
 * Read-only: compares how each bucket's curve looks under the lifecycle variants (nothing is written).
 *   node scripts/curve_variants_compare.js            -> all buckets
 *   node scripts/curve_variants_compare.js 1          -> one bucket id
 */
require('dotenv').config({ quiet: true });
const mysql = require('mysql2/promise');
const fe = require('../src/services/forecastEstimate');

const BASE = { start: 'BTO', end: ['UU', 'A0 Asic Back'], combine: 'average', guideline: 0 };
const VARIANTS = [
  ['old: raw, skip, no cut', { ...BASE, lifecycle: 'raw', after_end: 'skip', min_support: 1 }],
  ['raw + cut(3) + zero after end', { ...BASE, lifecycle: 'raw', after_end: 'zero', min_support: 3 }],
  ['stretch to median length', { ...BASE, lifecycle: 'stretch', length: 'median' }],
  ['stretch to longest', { ...BASE, lifecycle: 'stretch', length: 'longest' }],
];

(async () => {
  const pool = mysql.createPool({ host: process.env.DB_HOST, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME, port: Number(process.env.DB_PORT || 3306) });
  const only = process.argv[2];
  const [bs] = await pool.query('SELECT bucket_id, code, name FROM RA_forecast_buckets ORDER BY code');
  for (const b of bs) {
    if (only && String(b.bucket_id) !== only) continue;
    console.log(`\n=== ${b.code} ${b.name} ===`);
    for (const [label, shape] of VARIANTS) {
      const l = await fe.relearnBucket(pool, b.bucket_id, { shape, dryRun: true });
      if (!l) { console.log(label, '-> no data'); continue; }
      console.log(`${label}: ${l.curve.length} quarters, typical peak ${l.typical_peak_hc}, members ${l.members.length}`);
      console.log('  curve  ', l.curve.map(v => v.toFixed(2)).join(' '));
      console.log('  support', l.support.join(' '));
      (l.notes || []).forEach(n => console.log('  note:', n));
    }
  }
  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
