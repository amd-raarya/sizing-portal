'use strict';
/**
 * Load the Assignment Output order + names from data/output_layout_seed.json (the project list of the four planning files
 * alloc_MLS_Linux_1..4, 2026-11-11) and match each line to our projects.
 *
 *   node scripts/seed_output_layout.js          -> dry run: prints what would be written, changes nothing
 *   node scripts/seed_output_layout.js apply    -> backs the three layout tables up to backups/, then REPLACES them
 *
 * Re-running 'apply' resets the list to the file: edits made in the output preview (renames, placements) are replaced.
 */
require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const layout = require('../src/services/outputLayout');

const APPLY = process.argv[2] === 'apply';
const SEED = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'output_layout_seed.json'), 'utf8'));
// Christopher Smith has one person in file 1 and one in file 2: left out until Rahul says which file he belongs to
const SKIP_MANAGERS = new Set(['Smith, Christopher']);

(async () => {
  const pool = mysql.createPool({ host: process.env.DB_HOST, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME, port: Number(process.env.DB_PORT || 3306) });
  await layout.ensureTables(pool);
  const [projects] = await pool.query(`SELECT project_id, project_name, project_code FROM RA_projects WHERE (is_test = 0 OR is_test IS NULL) AND status <> 'cancelled'`);
  const [mgrRows] = await pool.query('SELECT DISTINCT reporting_manager FROM RA_people WHERE reporting_manager IS NOT NULL');
  const known = new Set(mgrRows.map(r => r.reporting_manager));

  const matched = layout.autoMatch(SEED.entries, projects);
  const mapRows = [];                                   // [group, entrySeq, project_id]
  const taken = new Set();                              // group|project — the first line that claims a project keeps it
  const unmatched = [];
  matched.forEach(m => {
    let any = false;
    m.projects.forEach(pid => { const k = `${m.entry.group}|${pid}`; if (!taken.has(k)) { taken.add(k); mapRows.push([m.entry.group, m.entry.seq, pid]); any = true; } });
    if (!any && !m.projects.length) unmatched.push(m.entry);
  });

  const perGroup = {};
  SEED.entries.forEach(e => { perGroup[e.group] = (perGroup[e.group] || 0) + 1; });
  console.log('List lines per file:', perGroup);
  console.log('Lines matched to a project of ours:', matched.filter(m => m.projects.length).length, 'of', matched.length);
  console.log('Project placements:', mapRows.length);
  console.log('Lines with no project of ours yet (they stay in the list, ready for a project):');
  unmatched.forEach(e => console.log(`   file ${e.group} #${e.seq}  ${e.name}`));
  const mgrs = Object.entries(SEED.managers).filter(([m]) => !SKIP_MANAGERS.has(m));
  const unknownMgr = mgrs.filter(([m]) => !known.has(m));
  console.log('Managers placed in a file:', mgrs.length, unknownMgr.length ? `(NOT in the people table: ${unknownMgr.map(x => x[0]).join(', ')})` : '');

  if (!APPLY) { console.log('\nDry run only. Run with "apply" to write.'); await pool.end(); return; }

  const dir = path.join(__dirname, '..', 'backups', 'pre_output_layout_' + new Date().toISOString().slice(0, 10).replace(/-/g, ''));
  fs.mkdirSync(dir, { recursive: true });
  for (const t of ['RA_output_layout_entry', 'RA_output_layout_map', 'RA_output_layout_manager']) {
    const [rows] = await pool.query(`SELECT * FROM ${t}`);
    fs.writeFileSync(path.join(dir, t + '.json'), JSON.stringify(rows, null, 1));
  }
  console.log('Backup written to', dir);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('DELETE FROM RA_output_layout_map');
    await conn.query('DELETE FROM RA_output_layout_entry');
    await conn.query('DELETE FROM RA_output_layout_manager');
    const idOf = new Map();                              // group|seq → entry_id
    for (const e of SEED.entries) {
      const [r] = await conn.query('INSERT INTO RA_output_layout_entry (group_no, seq, output_name, source_code, updated_by) VALUES (?,?,?,?,?)', [e.group, e.seq, e.name, e.code, 'seed']);
      idOf.set(`${e.group}|${e.seq}`, r.insertId);
    }
    for (const [g, seq, pid] of mapRows) await conn.query('INSERT INTO RA_output_layout_map (group_no, project_id, entry_id) VALUES (?,?,?)', [g, pid, idOf.get(`${g}|${seq}`)]);
    for (const [m, g] of mgrs) await conn.query('INSERT INTO RA_output_layout_manager (manager_name, group_no) VALUES (?,?)', [m, g]);
    await conn.commit();
    console.log('Written: lines', SEED.entries.length, '· placements', mapRows.length, '· managers', mgrs.length);
  } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
