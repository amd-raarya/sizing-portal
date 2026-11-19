'use strict';
/**
 * RERUNNABLE (2026-11-16): the buckets are taken from the tags sheet, not from a fixed list. When Rahul sends a revised breakdown, run this
 * again with the new sheet: the current family buckets are backed up and replaced, the open estimates follow (same bucket + role if it still
 * exists, else the same bucket's other role, else the first bucket in the sheet - listed in the output so you can check them).
 *
 * Forecast buckets v2 (Rahul 2026-11-13): 5 families (APU, DGPU, Embedded, Gaming Console, MI) x 2 roles (lead, follow-on) = 10 curves.
 * Replaces the 4 old buckets (Embedded, Data Centre, Client & Gaming, Server).
 *
 *   node scripts/migrate_buckets_v2.js [tags.xlsx]          -> dry run: shows the 10 curves that would be learned, changes nothing
 *   node scripts/migrate_buckets_v2.js [tags.xlsx] apply    -> backs up the forecast tables to backups/, then migrates
 *
 * tags.xlsx = planning/Bucket_Lead_FollowOn_Tags_PROPOSAL.xlsx (default). Per project the bucket / role is the "Your correction" column when
 * filled, else the "Proposed" column. A row with no bucket or no role is left out (not a member of any bucket).
 * Open forecast estimates keep their stakeholders / milestones / eligibility and move to a new row:
 *   old Embedded -> Embedded follow-on, old Data Centre / Server -> MI lead, old Client & Gaming -> APU lead (change in the estimate screen after).
 */
require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const ExcelJS = require('exceljs');
const fe = require('../src/services/forecastEstimate');

const KNOWN_CODE = { 'APU': 'APU', 'DGPU': 'DGPU', 'Embedded': 'EMB', 'Gaming Console': 'GC', 'MI': 'MI' };
const codeOf = fam => KNOWN_CODE[fam] || fam.replace(/[^A-Za-z0-9]/g, '').slice(0, 6).toUpperCase();
const ROLES = { 'Lead': 'lead', 'Follow-on': 'follow' };
const ROLE_LABEL = { lead: 'Lead', follow: 'Follow-on' };
const ESTIMATE_MOVE = { 'Embedded': ['Embedded', 'follow'], 'Data Centre': ['MI', 'lead'], 'Server': ['MI', 'lead'], 'Client & Gaming': ['APU', 'lead'] };
const APPLY = process.argv.includes('apply');
const XLSX = process.argv.slice(2).find(a => a.endsWith('.xlsx')) || path.join(__dirname, '..', '..', 'planning', 'Bucket_Lead_FollowOn_Tags_PROPOSAL.xlsx');

(async () => {
  const pool = mysql.createPool({ host: process.env.DB_HOST, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME, port: Number(process.env.DB_PORT || 3306) });
  const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(XLSX);
  const ws = wb.getWorksheet('Tags');
  const tags = [], problems = [];
  ws.eachRow((row, i) => {
    if (i === 1) return;
    const cell = n => { const v = row.getCell(n).value; return v && typeof v === 'object' && v.text !== undefined ? v.text : v; };
    const id = Number(cell(1)), name = cell(2);
    const fam = String(cell(10) || cell(6) || '').trim(), role = String(cell(11) || cell(7) || '').trim();
    if (!fam || !role) { problems.push(`${name}: no bucket/role → left out`); return; }
    if (!ROLES[role]) { problems.push(`${name}: unknown role "${role}" → left out`); return; }
    tags.push({ id, name, fam, role: ROLES[role] });
  });
  const FAMILIES = [...new Set(tags.map(t => t.fam))];           // the buckets are whatever the sheet names (order of first appearance)
  console.log('Buckets in the sheet:', FAMILIES.join(', '));
  console.log('Tagged projects:', tags.length);
  problems.forEach(p => console.log('  !', p));

  await fe.ensureTables(pool);
  const [allOld] = await pool.query('SELECT * FROM RA_forecast_buckets');
  const hadFamilies = allOld.some(b => b.family);
  // the shape settings (milestone alignment, lifecycle ...) of the existing buckets become the starting point of every new row
  const base = allOld.find(b => b.family) || allOld.find(b => b.name === 'Embedded') || allOld[0];
  let baseShape = null; try { baseShape = JSON.parse(base.shape_config_json); } catch (e) { baseShape = null; }
  if (baseShape) { delete baseShape.learned; delete baseShape.fallback; }
  console.log('Shape settings copied from the old bucket:', base.name, baseShape ? JSON.stringify(baseShape) : '(defaults)');

  // ── what would be learned (computed here, same rule as relearnBucket) ──
  const series = new Map();
  for (const t of tags) series.set(t.id, await fe.loadProjectSeries(pool, t.id));
  console.log('\nFamily        role       own  pooled  curve  peak   source');
  for (const fam of FAMILIES) for (const role of ['lead', 'follow']) {
    const own = tags.filter(t => t.fam === fam && t.role === role), all = tags.filter(t => t.fam === fam);
    const useOwn = own.length >= fe.MIN_ROLE_MEMBERS;
    const l = fe.learnCurve((useOwn ? own : all).map(t => series.get(t.id)), baseShape);
    const lo = !useOwn && own.length ? fe.learnCurve(own.map(t => series.get(t.id)), baseShape) : null;
    console.log(`${fam.padEnd(14)}${ROLE_LABEL[role].padEnd(10)} ${String(own.length).padStart(3)}  ${String(all.length).padStart(5)}   ${l ? String(l.length_q).padStart(3) + 'q' : ' n/a'}  ${l ? String((lo || l).typical_peak_hc).padStart(5) : '  n/a'}  ${useOwn ? 'own projects' : (all.length ? 'FALLBACK: whole family' + (lo ? ', peak from own' : ', peak from family') : 'NO PROJECTS')}`);
  }
  const [fps] = await pool.query(`SELECT f.forecast_id, f.project_name, f.status, b.name AS old, b.family AS old_family, b.role AS old_role FROM RA_forecast_projects f JOIN RA_forecast_buckets b ON b.bucket_id = f.bucket_id`);
  // where an estimate goes: old-style bucket -> the fixed table; family bucket -> same bucket + role, else same bucket's other role, else the first bucket
  const target = f => {
    if (!f.old_family) return ESTIMATE_MOVE[f.old] && FAMILIES.includes(ESTIMATE_MOVE[f.old][0]) ? ESTIMATE_MOVE[f.old] : [FAMILIES[0], 'lead'];
    if (FAMILIES.includes(f.old_family)) return [f.old_family, f.old_role];
    return [FAMILIES[0], f.old_role || 'lead'];
  };
  console.log('\nEstimates (' + (hadFamilies ? 'family buckets are replaced' : 'old buckets are replaced') + '):');
  fps.forEach(f => { const m = target(f); console.log(`  #${f.forecast_id} ${f.project_name} [${f.status}]: ${f.old} -> ${m[0]} ${ROLE_LABEL[m[1]]}`); });

  if (!APPLY) { console.log('\nDry run only. Run with "apply" to write.'); await pool.end(); return; }

  // ── backup ──
  const dir = path.join(__dirname, '..', 'backups', 'pre_buckets_v2_' + new Date().toISOString().slice(0, 10).replace(/-/g, ''));
  fs.mkdirSync(dir, { recursive: true });
  for (const t of ['RA_forecast_buckets', 'RA_forecast_bucket_members', 'RA_forecast_projects', 'RA_forecast_stakeholders', 'RA_forecast_milestones', 'RA_forecast_eligibility']) {
    const [rows] = await pool.query(`SELECT * FROM ${t}`);
    fs.writeFileSync(path.join(dir, t + '.json'), JSON.stringify(rows, null, 1));
  }
  console.log('\nBackup written to', dir);

  const conn = await pool.getConnection();
  const idOf = new Map();                                   // "Family|role" -> bucket_id
  try {
    await conn.beginTransaction();
    await conn.query(`UPDATE RA_forecast_buckets SET code = CONCAT('~', bucket_id), family = NULL, role = NULL`);   // park the old rows (unique keys), deleted below
    for (const fam of FAMILIES) for (const role of ['lead', 'follow']) {
      const [r] = await conn.query(
        `INSERT INTO RA_forecast_buckets (code, name, family, role, shape_label, typical_peak_hc, curve_json, curve_source, shape_config_json)
         VALUES (?,?,?,?,?,?,?, 'template', ?)`,
        [`${codeOf(fam)}-${role === 'lead' ? 'L' : 'F'}`, `${fam} · ${ROLE_LABEL[role]}`, fam, role, `${fam} ${ROLE_LABEL[role].toLowerCase()} projects`, 5, JSON.stringify([0.3, 0.7, 1, 0.7, 0.3]), baseShape ? JSON.stringify(baseShape) : null]);
      idOf.set(`${fam}|${role}`, r.insertId);
    }
    // existing rows get out of the way first (their codes / family+role keys would collide); estimates are re-pointed below
    await conn.query('DELETE FROM RA_forecast_bucket_members');
    for (const t of tags) await conn.query('INSERT INTO RA_forecast_bucket_members (project_id, bucket_id, assigned_by) VALUES (?,?,?)', [t.id, idOf.get(`${t.fam}|${t.role}`), 'buckets_v2']);
    for (const f of fps) {
      const m = target(f);
      await conn.query('UPDATE RA_forecast_projects SET bucket_id = ? WHERE forecast_id = ?', [idOf.get(`${m[0]}|${m[1]}`), f.forecast_id]);
    }
    const left = (await conn.query('SELECT COUNT(*) n FROM RA_forecast_projects f JOIN RA_forecast_buckets b ON b.bucket_id = f.bucket_id WHERE b.family IS NULL'))[0][0].n;
    if (left) throw new Error(left + ' estimate(s) still point at an old bucket — nothing changed');
    await conn.query('DELETE FROM RA_forecast_buckets WHERE family IS NULL');
    await conn.commit();
  } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }

  // ── learn the 10 curves ──
  for (const fam of FAMILIES) for (const role of ['lead', 'follow']) {
    const l = await fe.relearnBucket(pool, idOf.get(`${fam}|${role}`), {});
    console.log(`${fam} ${ROLE_LABEL[role]}: ${l ? `${l.length_q}q, peak ${l.typical_peak_hc}${l.fallback ? ' (family fallback)' : ''}` : 'no data'}`);
  }
  console.log('Done.');
  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
