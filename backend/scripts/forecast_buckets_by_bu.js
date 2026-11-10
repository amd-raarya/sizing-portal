'use strict';
/**
 * One-off (idempotent) setup of the four BU forecast buckets, 2026-11-05 (Rahul):
 *   A Embedded            = EMB
 *   B Data Centre         = DC
 *   C Client & Gaming     = CG + Client
 *   D Server              = Server + S3
 * Members = the projects loaded from Sam's sizing dump (latest version of each program line, so one program is not counted
 * once per revision) + the members the buckets already had. Then every bucket is re-learned from its members.
 *
 *   node scripts/forecast_buckets_by_bu.js          -> dry run (prints what it would do, changes nothing)
 *   node scripts/forecast_buckets_by_bu.js apply    -> backs the bucket tables up to backups/, then writes
 */
require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const fe = require('../src/services/forecastEstimate');

const APPLY = process.argv[2] === 'apply';
const SHAPE = { start: 'BTO', end: ['UU', 'A0 Asic Back'], combine: 'average', guideline: 0 };

const BUCKETS = [
  { code: 'A', name: 'Embedded',        label: 'Embedded (EMB)' },
  { code: 'B', name: 'Data Centre',     label: 'Data Centre (DC)' },
  { code: 'C', name: 'Client & Gaming', label: 'Client & Gaming (CG, Client)' },
  { code: 'D', name: 'Server',          label: 'Server (Server, S3)' },
];

// project_id lists (names for the reader). Paused older revisions of a program (Arcadia v0.11-v3.1, Eris v1.x, Camelot v1.0/v1.1,
// AlphaTrion x v1.0/v1.2, Grimlock3, KRK1 v1.0, VEO v1.0, Gainsborough v2.0-v3.2, ...) are NOT members: same program, older sizing.
const MEMBERS = {
  A: [23 /*Capitola C90 v1.0 r1*/, 421 /*Capitola C90 v1.1*/, 3 /*Eris v2.0*/, 558 /*Capitola C40 v1.0*/, 559 /*ECARX V2000A v4.0*/, 560 /*Emb Ryzen 8000*/,
      567 /*Fremont Bridge Plan v2.1*/, 572 /*Glacier Peak*/, 580 /*Pine Ridge*/, 546 /*Android EAP v1.0*/, 583 /*V4000 KRK1 v1.1*/, 584 /*V4000 KRK1 KRK2e*/,
      586 /*V4000 VEO v1.1*/, 588 /*VAS2.0 V2000A v2.4*/, 589 /*VAS3.0 v2.0*/, 590 /*VAS3.0 V4000A v1.0*/],
  B: [24 /*Camelot-Arthur*/, 419 /*AT1 Magpie*/, 424 /*Onyx Prime 1*/, 30 /*Arcadia v4.0*/, 553 /*Arcadia 2D v3.2*/],
  C: [537 /*AlphaTrion 0 v1.1*/, 540 /*AlphaTrion 1 v2.0*/, 543 /*AlphaTrion 2 v1.3*/, 545 /*AlphaTrion 3 v1.2*/, 554 /*Blurr*/, 555 /*Bumblebee*/,
      565 /*Firefly*/, 573 /*Grimlock1*/, 574 /*Grimlock2*/, 581 /*Siren Halo*/],
  D: [571 /*Gainsborough v3.3*/, 578 /*Magnus v4.0*/, 577 /*MI410P*/, 579 /*Mezzana*/],
};

(async () => {
  const pool = mysql.createPool({ host: process.env.DB_HOST, port: process.env.DB_PORT, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME });
  await fe.ensureTables(pool);
  const [bk] = await pool.query('SELECT * FROM RA_forecast_buckets ORDER BY code');
  const [mem] = await pool.query('SELECT * FROM RA_forecast_bucket_members');
  if (APPLY) {
    const dir = path.join(__dirname, '..', 'backups', 'pre_forecast_buckets_20261105');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'RA_forecast_buckets.json'), JSON.stringify(bk));
    fs.writeFileSync(path.join(dir, 'RA_forecast_bucket_members.json'), JSON.stringify(mem));
    console.log('backup written to', dir);
  }
  const ids = {};
  for (const b of BUCKETS) {
    const row = bk.find(x => x.code === b.code);
    if (row) { ids[b.code] = row.bucket_id; console.log(`${b.code}: exists as bucket ${row.bucket_id} "${row.name}" -> "${b.name}"`); }
    else console.log(`${b.code}: will be created as "${b.name}"`);
    if (!APPLY) continue;
    if (row) {
      await pool.query('UPDATE RA_forecast_buckets SET name = ?, shape_label = ?, shape_config_json = ? WHERE bucket_id = ?', [b.name, b.label, JSON.stringify(SHAPE), row.bucket_id]);
    } else {
      const tpl = fe.TEMPLATE_BUCKETS[0];
      const [r] = await pool.query(`INSERT INTO RA_forecast_buckets (code, name, shape_label, typical_peak_hc, curve_json, curve_source, shape_config_json) VALUES (?,?,?,?,?, 'template', ?)`,
        [b.code, b.name, b.label, tpl.peak, JSON.stringify(tpl.curve), JSON.stringify(SHAPE)]);
      ids[b.code] = r.insertId;
    }
  }
  for (const [code, list] of Object.entries(MEMBERS)) {
    const [found] = await pool.query(`SELECT project_id, project_name, BU, status FROM RA_projects WHERE project_id IN (${list.map(() => '?').join(',')})`, list);
    const missing = list.filter(id => !found.find(f => f.project_id === id));
    if (missing.length) throw new Error(`bucket ${code}: unknown project ids ${missing.join(',')}`);
    console.log(`\n${code} members (${found.length}): ${found.map(f => `${f.project_name} [${f.BU}/${f.status}]`).join('; ')}`);
    if (!APPLY) continue;
    for (const id of list) {
      await pool.query(`INSERT INTO RA_forecast_bucket_members (project_id, bucket_id, assigned_by) VALUES (?,?, 'system:bu-bucket-setup')
                        ON DUPLICATE KEY UPDATE bucket_id = VALUES(bucket_id), assigned_by = VALUES(assigned_by), assigned_at = NOW()`, [id, ids[code]]);
    }
  }
  if (APPLY) {
    for (const b of BUCKETS) {
      const l = await fe.relearnBucket(pool, ids[b.code], {});
      if (!l) { console.log(b.code, 'NOT learned (no data)'); continue; }
      console.log(`\n${b.code} ${b.name}: learned from ${l.members.length} projects, typical peak ${l.typical_peak_hc} HC, ${l.curve.length} quarters`);
      console.log('  curve', l.curve.join(' '));
      l.notes.forEach(n => console.log('  note:', n));
    }
  }
  console.log(APPLY ? '\nDONE' : '\n(dry run - nothing changed)');
  await pool.end();
})().catch(e => { console.error('ERROR', e.message); process.exit(1); });
