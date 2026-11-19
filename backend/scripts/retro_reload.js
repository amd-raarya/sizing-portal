'use strict';
/**
 * Retro reload (Rahul 2026-11-19): compare a NEW retro workbook (the four MS Project sheets, "Retro Data 11192026.xlsx") with the retro data in
 * the database and bring the database to exactly the file's numbers, for the months the file covers.
 *
 *   node scripts/retro_reload.js <file.xlsx>            -> compare only: writes a review workbook, changes nothing
 *   node scripts/retro_reload.js <file.xlsx> lines      -> only (re)stores the person -> project lines of the file for the planning-file output
 *   node scripts/retro_reload.js <file.xlsx> apply [--drop-after] -> backs up, then applies the delta in one transaction (see below);
 *                                                        --drop-after also removes retro rows after the file's last month
 *
 * Rules (same as the 2026-10-16 load, see memory project_retro_data_purged):
 *  - time axis = the MONTH columns of row 2 (continuous), calendar quarters; quarterly HC = average of the 3 months (blank = 0); the three
 *    months are kept in m1/m2/m3 for the export. The file's own quarter labels are only cross-checked.
 *  - skipped: gap_ / commit_ / Unassigned people and every "Other projects and commitments" row; zero rows are not loaded.
 *  - a person on several sheets is merged (HC of the same project is added up, and reported).
 *  - only rows set_by 'retro_import' inside the file's months are compared / changed. Engine rows (auto_plan), months outside the file
 *    (history before it starts, anything after it ends) and everything else are never touched.
 */
require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const ExcelJS = require('exceljs');

const FILE = process.argv.slice(2).find(a => a.endsWith('.xlsx'));
const APPLY = process.argv.includes('apply');
if (!FILE) { console.error('usage: node scripts/retro_reload.js <retro file.xlsx> [apply]'); process.exit(1); }
const OUT_DIR = process.env.RETRO_OUT_DIR || path.join(__dirname, '..', '..', 'planning');
const SEED = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'output_layout_seed.json'), 'utf8'));
const EPS = 0.0005;
const r3 = n => Math.round(n * 1000) / 1000;
const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
// Project lines whose file code does not match our project: decided earlier (see the memory note), re-used here
const CODE_ALIAS = { 'spg02.015': 'MI-450', 'spg02.050': 'AlphaTrion1' };

const cellText = c => { const v = c && c.value; if (v === null || v === undefined) return ''; if (typeof v === 'object') return String(v.richText ? v.richText.map(t => t.text).join('') : v.result ?? v.text ?? ''); return String(v); };
const hcOf = c => { const t = cellText(c).trim(); if (!t) return 0; const m = t.match(/^(-?[\d.]+)\s*mo$/i); return m ? Number(m[1]) : (Number.isFinite(Number(t)) ? Number(t) : NaN); };

(async () => {
  const pool = mysql.createPool({ host: process.env.DB_HOST, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME, port: Number(process.env.DB_PORT || 3306) });
  const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(FILE);

  // ── our people and projects ──
  const [people] = await pool.query('SELECT person_id, display_name, reporting_manager FROM RA_people');
  const personByName = new Map(people.map(p => [p.display_name, p]));
  const personBySheet = new Map();
  (SEED.people || []).forEach(r => { if (r.kind === 'person' && r.person && personByName.has(r.person)) personBySheet.set(r.sheet_name, personByName.get(r.person)); });
  Object.entries(SEED.person_aliases || {}).forEach(([s, d]) => { if (personByName.has(d)) personBySheet.set(s, personByName.get(d)); });
  const resolvePerson = sheetName => personBySheet.get(sheetName) || personByName.get(sheetName.replace(/;\s*/, ', ')) || null;

  const [projects] = await pool.query(`SELECT project_id, project_name, project_code, retro_category, status FROM RA_projects WHERE (is_test = 0 OR is_test IS NULL)`);
  const [retroCount] = await pool.query(`SELECT project_id, COUNT(*) n FROM RA_person_project_effort WHERE set_by = 'retro_import' GROUP BY project_id`);
  const rc = new Map(retroCount.map(r => [r.project_id, r.n]));
  const byCode = new Map(), byName = new Map();
  projects.forEach(p => {
    const c = String(p.project_code || '').trim().toLowerCase(); if (c) (byCode.get(c) || byCode.set(c, []).get(c)).push(p);
    const n = norm(p.project_name); (byName.get(n) || byName.set(n, []).get(n)).push(p);
  });
  const best = list => list.slice().sort((a, b) => (rc.get(b.project_id) || 0) - (rc.get(a.project_id) || 0) || a.project_id - b.project_id)[0];
  const projCache = new Map();
  function resolveProject(label) {
    if (projCache.has(label)) return projCache.get(label);
    const m = label.match(/^(spg[\d.]+)_(.*)$/i);
    const code = m ? m[1].toLowerCase() : null, nm = m ? m[2] : label;
    let hit = null, how = '';
    if (code && CODE_ALIAS[code] && /MI-400|AlphaTrion1/i.test(label)) { const l = byName.get(norm(CODE_ALIAS[code])); if (l) { hit = best(l); how = 'alias'; } }
    if (!hit && code && byCode.has(code)) { hit = best(byCode.get(code)); how = byCode.get(code).length > 1 ? 'code (several: the one with retro data)' : 'code'; }
    if (!hit) { const l = byName.get(norm(nm)) || byName.get(norm(nm.replace(/\s*\(.*\)\s*$/, ''))); if (l) { hit = best(l); how = 'name'; } }
    const res = hit ? { project: hit, how } : null;
    projCache.set(label, res);
    return res;
  }

  // ── parse the four sheets ──
  const months = [];                       // [{ y, m }] of the file's month columns (same on every sheet)
  const rows = new Map();                  // "person|project|y|q" -> { person, project, y, q, m: [m1,m2,m3], sheets: Set }
  const fileLines = new Map();             // "person|project" -> every project line a person has in the file (zero lines too): the planning-file output lists them all
  const otherLines = new Map();            // "person|file|year|quarter" -> the "Other projects and commitments" months
  const skeleton = [];                     // [group_no, seq, header_key, label, project_id, is_other] : every row of every sheet in the sheet's own order (the planning-file output copies it)
  const headerCount = new Map();
  const dupCells = [];                     // person+project+month on more than one sheet
  const skippedPeople = new Set(), unmatchedPeople = new Map(), unmatchedProjects = new Map(), labelNotes = [];
  const monthSeen = new Map();             // "person|project|ym" -> value (to spot the same month on two sheets)
  for (const [wsIdx, ws] of wb.worksheets.entries()) {
    const groupNo = Number((ws.name.match(/(\d)\s*$/) || [])[1]) || wsIdx + 1;     // Linux 1..4 = planning file 1..4
    const r1 = ws.getRow(1), r2 = ws.getRow(2);
    const cols = [];                       // [{ col, y, m }]
    let year = null, lastM = 0, qLabelYear = null;
    for (let c = 3; c <= ws.columnCount; c++) {
      const mname = cellText(r2.getCell(c)).trim().toLowerCase();
      if (!mname) continue;
      const m = MON[mname]; if (!m) { labelNotes.push(`${ws.name}: column ${c} has the month "${mname}" (not understood)`); continue; }
      const lab = cellText(r1.getCell(c)).match(/Q(\d),\s*(\d{4})/); if (lab) qLabelYear = { q: Number(lab[1]), y: Number(lab[2]) };
      if (year === null) year = qLabelYear ? qLabelYear.y : 0;
      else if (m < lastM) year += 1;                                // a month name smaller than the previous one = a new calendar year
      lastM = m;
      if (lab && (Math.ceil(m / 3) !== qLabelYear.q || year !== qLabelYear.y)) labelNotes.push(`${ws.name}: column ${c} is ${mname} ${year} but its quarter label says Q${qLabelYear.q}, ${qLabelYear.y}`);
      cols.push({ col: c, y: year, m });
    }
    if (!months.length) cols.forEach(c => months.push({ y: c.y, m: c.m }));
    else if (months.length !== cols.length || months.some((x, i) => x.y !== cols[i].y || x.m !== cols[i].m)) labelNotes.push(`${ws.name}: month columns differ from the first sheet`);

    let person = null, skipPerson = false, headerKey = '', skelSeq = 0;
    ws.eachRow((row, i) => {
      if (i < 3) return;
      const a = cellText(row.getCell(1));
      if (!a.trim()) return;
      if (!/^\s/.test(a)) {                                            // a person row
        const name = a.trim();
        const occ = headerCount.get(`${groupNo}|${name}`) || 0; headerCount.set(`${groupNo}|${name}`, occ + 1); headerKey = `${name}#${occ}`;
        skipPerson = /^(commit_|gap_|unassigned)/i.test(name);
        if (skipPerson) { skippedPeople.add(name); person = null; return; }
        person = resolvePerson(name);
        if (!person) unmatchedPeople.set(name, (unmatchedPeople.get(name) || 0) + 1);
        return;
      }
      const label = a.trim();
      { const isOther = /^other projects and commitments/i.test(label), rp0 = isOther ? null : resolveProject(label); skeleton.push([groupNo, ++skelSeq, headerKey.slice(0, 250), label.slice(0, 250), rp0 ? rp0.project.project_id : null, isOther ? 1 : 0, person ? person.person_id : null]); }
      if (skipPerson) return;
      if (/^other projects and commitments/i.test(label)) {          // kept for the planning-file output (display only), never loaded as HC
        if (person) cols.forEach(({ col, y, m }) => { const v = hcOf(row.getCell(col)); if (!(v > 0)) return; const k = `${person.person_id}|${groupNo}|${y}|${Math.ceil(m / 3)}`; const e = otherLines.get(k) || [person.person_id, groupNo, y, Math.ceil(m / 3), 0, 0, 0]; e[4 + ((m - 1) % 3)] += v; otherLines.set(k, e); });
        return;
      }
      const rp = resolveProject(label);
      if (!rp) { if (person) unmatchedProjects.set(label, (unmatchedProjects.get(label) || 0) + 1); return; }
      if (!person) return;
      fileLines.set(`${person.person_id}|${groupNo}|${rp.project.project_id}`, [person.person_id, rp.project.project_id, groupNo, label.slice(0, 250)]);
      cols.forEach(({ col, y, m }) => {
        const v = hcOf(row.getCell(col)); if (!(v > 0)) return;
        const ymk = `${person.person_id}|${rp.project.project_id}|${y}-${m}`;
        if (monthSeen.has(ymk)) dupCells.push(`${person.display_name} · ${label} · ${y}-${String(m).padStart(2, '0')}: on ${monthSeen.get(ymk)} and ${ws.name}`);
        monthSeen.set(ymk, ws.name);
        const q = Math.ceil(m / 3), k = `${person.person_id}|${rp.project.project_id}|${y}|${q}`;
        const e = rows.get(k) || { person, project: rp.project, y, q, m: [0, 0, 0], label };
        e.m[(m - 1) % 3] += v; rows.set(k, e);
      });
    });
  }
  const first = months[0], last = months[months.length - 1];
  const keyOfYM = (y, m) => y * 12 + m;
  const winFrom = keyOfYM(first.y, first.m), winTo = keyOfYM(last.y, last.m);
  const qFrom = first.y * 4 + Math.ceil(first.m / 3), qTo = last.y * 4 + Math.ceil(last.m / 3);
  // a quarter is compared only when the file covers all its months
  const covered = new Set(months.map(x => keyOfYM(x.y, x.m)));
  const qCovered = (y, q) => [1, 2, 3].every(i => covered.has(keyOfYM(y, (q - 1) * 3 + i)));
  console.log(`File: ${wb.worksheets.length} sheets, months ${first.y}-${first.m} to ${last.y}-${last.m} (${months.length}), ${rows.size} person-project-quarters with HC`);

  // ── the database, same window ──
  const [db] = await pool.query(
    `SELECT e.id, e.person_id, e.project_id, e.fiscal_year AS y, e.quarter AS q, e.effort_hc, e.auto_hc, e.m1, e.m2, e.m3, p.display_name, pr.project_name, pr.project_code
     FROM RA_person_project_effort e JOIN RA_people p ON p.person_id = e.person_id JOIN RA_projects pr ON pr.project_id = e.project_id
     WHERE e.set_by = 'retro_import' AND e.fiscal_year * 4 + e.quarter BETWEEN ? AND ?`, [qFrom, qTo]);
  const dbMap = new Map();
  db.forEach(d => { if (!qCovered(d.y, d.q)) return; dbMap.set(`${d.person_id}|${d.project_id}|${d.y}|${d.q}`, d); });

  const out = { new: [], changed: [], missing: [], same: 0 };
  const avg = e => r3((e.m[0] + e.m[1] + e.m[2]) / 3);
  rows.forEach((e, k) => {
    if (!qCovered(e.y, e.q)) return;
    const hc = avg(e);
    if (hc < EPS) return;
    const d = dbMap.get(k);
    if (!d) { out.new.push({ e, hc }); return; }
    const base = r3(Number(d.effort_hc) - Number(d.auto_hc || 0));
    const dm = [Number(d.m1), Number(d.m2), Number(d.m3)];
    const monthsDiffer = e.m.some((v, i) => Math.abs(v - dm[i]) > EPS);
    if (Math.abs(hc - base) > EPS || monthsDiffer) out.changed.push({ e, hc, d, base, dm }); else out.same++;
  });
  dbMap.forEach((d, k) => { const e = rows.get(k); if (!e || avg(e) < EPS) out.missing.push({ d, base: r3(Number(d.effort_hc) - Number(d.auto_hc || 0)) }); });

  // ── pairs that would need eligibility (new person+project with HC) ──
  const [elig] = await pool.query('SELECT person_id, project_id FROM RA_resource_eligibility WHERE capability IN (\'yes\',\'expert\')');
  const [eligSs] = await pool.query('SELECT * FROM RA_steady_state_eligibility LIMIT 1').catch(() => [[]]);
  const eligSet = new Set(elig.map(x => `${x.person_id}|${x.project_id}`));
  const [anyRow] = await pool.query(`SELECT DISTINCT person_id, project_id FROM RA_person_project_effort WHERE set_by = 'retro_import'`);
  const havePair = new Set(anyRow.map(x => `${x.person_id}|${x.project_id}`));
  const newPairs = new Map();
  out.new.forEach(({ e }) => { const k = `${e.person.person_id}|${e.project.project_id}`; if (!havePair.has(k)) newPairs.set(k, e); });

  // ── summary to the console ──
  console.log(`\nIn the window ${first.y}-${first.m} → ${last.y}-${last.m}:`);
  console.log(`  same: ${out.same}   NEW: ${out.new.length}   CHANGED: ${out.changed.length}   MISSING from the file (would be deleted): ${out.missing.length}`);
  console.log(`  new person+project pairs (no HC before anywhere): ${newPairs.size}`);
  console.log(`  people not matched: ${unmatchedPeople.size}`, [...unmatchedPeople.keys()].slice(0, 20));
  console.log(`  project lines not matched: ${unmatchedProjects.size}`); [...unmatchedProjects.entries()].forEach(([l, n]) => console.log(`     ${l}  (${n} person rows)`));
  const byName_ = [...projCache.entries()].filter(([, v]) => v && v.how !== 'code'); console.log(`  lines matched by name / alias / several (check): ${byName_.length}`); byName_.forEach(([l, v]) => console.log(`     ${l} -> #${v.project.project_id} ${v.project.project_name} [${v.how}]`));
  console.log(`  skipped people rows (gap/commit/unassigned): ${skippedPeople.size}`);
  console.log(`  same month on two sheets: ${dupCells.length}`); dupCells.slice(0, 8).forEach(x => console.log('     ' + x));
  console.log(`  header notes: ${labelNotes.length}`); labelNotes.slice(0, 8).forEach(x => console.log('     ' + x));

  // ── review workbook ──
  const rev = new ExcelJS.Workbook();
  const head = (ws, cols) => { ws.columns = cols.map(([h, w]) => ({ header: h, width: w })); ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }; ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A1A2E' } }; ws.views = [{ state: 'frozen', ySplit: 1 }]; ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } }; };
  const ql = (y, q) => `Q${q} ${y}`;
  const sum = rev.addWorksheet('Summary');
  sum.columns = [{ width: 58 }, { width: 18 }];
  [['Retro reload review', ''], ['File', path.basename(FILE)], ['Months in the file', `${first.y}-${String(first.m).padStart(2, '0')} to ${last.y}-${String(last.m).padStart(2, '0')}`], ['', ''],
    ['Person-project-quarters the same as the database', out.same], ['NEW (in the file, not in the database)', out.new.length], ['CHANGED (value differs)', out.changed.length],
    ['MISSING from the file (in the database, would be deleted)', out.missing.length], ['New person+project pairs (need eligibility)', newPairs.size], ['', ''],
    ['People in the file not matched to our people', unmatchedPeople.size], ['Project lines not matched to our projects', unmatchedProjects.size], ['Same month on two sheets (added up)', dupCells.length], ['Header notes', labelNotes.length]]
    .forEach(r => sum.addRow(r));
  sum.getRow(1).font = { bold: true, size: 13 };
  const sn = rev.addWorksheet('New'); head(sn, [['Person', 28], ['Project', 36], ['Quarter', 10], ['HC (avg)', 10], ['m1', 8], ['m2', 8], ['m3', 8], ['New pair', 10]]);
  out.new.forEach(({ e, hc }) => sn.addRow([e.person.display_name, e.label, ql(e.y, e.q), hc, ...e.m.map(r3), newPairs.has(`${e.person.person_id}|${e.project.project_id}`) ? 'yes' : '']));
  const sc = rev.addWorksheet('Changed'); head(sc, [['Person', 28], ['Project', 36], ['Quarter', 10], ['DB HC', 9], ['File HC', 9], ['Delta', 9], ['DB m1', 8], ['DB m2', 8], ['DB m3', 8], ['File m1', 8], ['File m2', 8], ['File m3', 8]]);
  out.changed.forEach(({ e, hc, d, base, dm }) => sc.addRow([e.person.display_name, d.project_name, ql(e.y, e.q), base, hc, r3(hc - base), ...dm.map(r3), ...e.m.map(r3)]));
  const sm = rev.addWorksheet('Missing from file'); head(sm, [['Person', 28], ['Project', 36], ['Quarter', 10], ['DB HC', 9]]);
  out.missing.forEach(({ d, base }) => sm.addRow([d.display_name, d.project_name, ql(d.y, d.q), base]));
  const sp = rev.addWorksheet('Not matched'); head(sp, [['Kind', 12], ['Name in the file', 50], ['Rows', 8]]);
  unmatchedPeople.forEach((n, k) => sp.addRow(['person', k, n])); unmatchedProjects.forEach((n, k) => sp.addRow(['project', k, n]));
  const spm = rev.addWorksheet('Project matches'); head(spm, [['Line in the file', 46], ['Matched to our project', 36], ['Project id', 10], ['Code', 12], ['Status', 12], ['How', 34], ['HC rows in DB (retro)', 12]]);
  [...projCache.entries()].filter(([, v]) => v).sort((x, y) => (x[1].how === 'code' ? 1 : 0) - (y[1].how === 'code' ? 1 : 0) || x[0].localeCompare(y[0]))
    .forEach(([l, v]) => spm.addRow([l, v.project.project_name, v.project.project_id, v.project.project_code || '', v.project.status, v.how, rc.get(v.project.project_id) || 0]));
  const sn2 = rev.addWorksheet('Notes'); head(sn2, [['Note', 120]]);
  dupCells.forEach(x => sn2.addRow(['two sheets: ' + x])); labelNotes.forEach(x => sn2.addRow(['header: ' + x]));
  // person totals: how much each person's quarter total moves
  const tot = new Map();
  const bump = (pid, name, y, q, field, v) => { const k = `${pid}|${y}|${q}`; const t = tot.get(k) || { name, y, q, db: 0, file: 0 }; t[field] += v; tot.set(k, t); };
  dbMap.forEach(d => bump(d.person_id, d.display_name, d.y, d.q, 'db', r3(Number(d.effort_hc) - Number(d.auto_hc || 0))));
  rows.forEach(e => { if (qCovered(e.y, e.q)) bump(e.person.person_id, e.person.display_name, e.y, e.q, 'file', avg(e)); });
  const st = rev.addWorksheet('Person totals moved'); head(st, [['Person', 28], ['Quarter', 10], ['DB total', 10], ['File total', 10], ['Delta', 10]]);
  [...tot.values()].filter(t => Math.abs(t.file - t.db) > 0.005).sort((a, b) => a.name.localeCompare(b.name) || a.y * 4 + a.q - (b.y * 4 + b.q)).forEach(t => st.addRow([t.name, ql(t.y, t.q), r3(t.db), r3(t.file), r3(t.file - t.db)]));
  const outFile = path.join(OUT_DIR, 'Retro_Reload_Review_' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + '.xlsx');
  fs.mkdirSync(OUT_DIR, { recursive: true });
  await rev.xlsx.writeFile(outFile);
  console.log('\nReview workbook:', outFile);

  // The output's list of lines per planning file (RA_output_layout_entry / _map) follows the sheets: every label of a sheet is a line, in the order the
  // sheets give them (they all agree), under the sheet's own spelling; every project a label resolves to sits on that line. Lines the sheets do not
  // have (added in the app, or unused) stay after the sheet's lines; existing links of other projects are kept.
  async function syncLayout() {
    const [ents] = await pool.query('SELECT entry_id, group_no, seq, output_name FROM RA_output_layout_entry ORDER BY group_no, seq, entry_id');
    const [maps] = await pool.query('SELECT group_no, project_id, entry_id FROM RA_output_layout_map');
    const mapped = new Set(maps.map(m => `${m.group_no}|${m.entry_id}`));
    let created = 0, linked = 0, reordered = 0;
    for (const g of [...new Set(skeleton.map(r => r[0]))]) {
      const rowsG = skeleton.filter(r => r[0] === g && !r[5]);
      // each person's sequence of labels -> one order for the file (stable topological merge; the sequences never contradict each other)
      const seqs = new Map(); rowsG.forEach(r => { if (!seqs.has(r[2])) seqs.set(r[2], []); seqs.get(r[2]).push(r[3]); });
      const labels = [], seen = new Set(); rowsG.forEach(r => { if (!seen.has(r[3])) { seen.add(r[3]); labels.push(r[3]); } });
      const pre = new Map(labels.map(l => [l, new Set()]));
      seqs.forEach(arr => { for (let i = 1; i < arr.length; i++) pre.get(arr[i]).add(arr[i - 1]); });   // direct predecessors are enough
      const order = [], done = new Set();
      while (order.length < labels.length) {
        const next = labels.find(l => !done.has(l) && [...pre.get(l)].every(x => done.has(x))) || labels.find(l => !done.has(l));
        done.add(next); order.push(next);
      }
      const mine = ents.filter(e => e.group_no === g);
      const entryOf = new Map();
      order.forEach(l => {
        const same = mine.filter(e => e.output_name.trim().toLowerCase() === l.trim().toLowerCase());
        entryOf.set(l, same.find(e => mapped.has(`${g}|${e.entry_id}`)) || same[0] || null);
      });
      let seq = 0;
      for (const l of order) {
        let e = entryOf.get(l); seq++;
        if (!e) { const [r] = await pool.query('INSERT INTO RA_output_layout_entry (group_no, seq, output_name, updated_by) VALUES (?,?,?,?)', [g, seq, l.slice(0, 255), 'retro_reload']); e = { entry_id: r.insertId, group_no: g, seq, output_name: l }; entryOf.set(l, e); mine.push(e); created++; }
        else { if (e.seq !== seq || e.output_name !== l) { await pool.query('UPDATE RA_output_layout_entry SET seq = ?, output_name = ? WHERE entry_id = ?', [seq, l.slice(0, 255), e.entry_id]); reordered++; } e.seq = seq; e.output_name = l; }
      }
      const used = new Set([...entryOf.values()].map(e => e.entry_id));
      for (const e of mine.filter(x => !used.has(x.entry_id)).sort((a, b) => a.seq - b.seq)) { seq++; if (e.seq !== seq) await pool.query('UPDATE RA_output_layout_entry SET seq = ? WHERE entry_id = ?', [seq, e.entry_id]); }
      // the projects each label resolves to (all versions that share the label's spg code) sit on its line
      const labelProj = new Map(); rowsG.forEach(r => { if (r[4]) labelProj.set(r[3], r[4]); });
      for (const [l, pid] of labelProj) {
        const e = entryOf.get(l); if (!e) continue;
        const code = (l.match(/^(spg[\d.]+)_/i) || [])[1];
        const ids = new Set([pid]);
        if (code) (byCode.get(code.toLowerCase()) || []).forEach(p => ids.add(p.project_id));
        for (const id of ids) { if (id !== pid && [...labelProj.values()].includes(id)) continue; await pool.query('INSERT INTO RA_output_layout_map (group_no, project_id, entry_id) VALUES (?,?,?) ON DUPLICATE KEY UPDATE entry_id = VALUES(entry_id)', [g, id, e.entry_id]); linked++; }
      }
    }
    console.log(`Output lines synced with the sheets: ${created} new, ${reordered} renamed/moved, ${linked} project links`);
  }

  // The person -> project lines of the file (replaces the stored list; harmless to the HC data)
  async function writeLines() {
    await require('../src/services/outputLayout').ensureTables(pool);
    await pool.query('DELETE FROM RA_output_file_lines');
    const vals = [...fileLines.values()];
    for (let i = 0; i < vals.length; i += 500) await pool.query('INSERT INTO RA_output_file_lines (person_id, project_id, group_no, label) VALUES ?', [vals.slice(i, i + 500)]);
    await pool.query('DELETE FROM RA_output_other_lines');
    const ov = [...otherLines.values()].map(e => [e[0], e[1], e[2], e[3], r3(e[4]), r3(e[5]), r3(e[6])]);
    for (let i = 0; i < ov.length; i += 500) await pool.query('INSERT INTO RA_output_other_lines (person_id, group_no, fiscal_year, quarter, m1, m2, m3) VALUES ?', [ov.slice(i, i + 500)]);
    await pool.query('DELETE FROM RA_output_file_rows');
    for (let i = 0; i < skeleton.length; i += 500) await pool.query('INSERT INTO RA_output_file_rows (group_no, seq, header_key, label, project_id, is_other, person_id) VALUES ?', [skeleton.slice(i, i + 500)]);
    console.log(`Sheet rows stored (exact order and labels): ${skeleton.length}`);
    console.log(`"Other projects and commitments" values stored: ${ov.length} person-quarters`);
    await syncLayout();
    console.log(`Project lines of the file stored: ${vals.length} (person + project pairs, zero lines included)`);
  }
  if (process.argv.includes('lines')) { await writeLines(); await pool.end(); return; }

  if (!APPLY) { console.log('Compare only. Nothing was changed.'); await pool.end(); return; }
  // ═══ APPLY ═══ (only rows the review lists; one transaction; --rollback runs everything and then undoes it, to test)
  const ROLLBACK = process.argv.includes('--rollback');
  const DROP_AFTER = process.argv.includes('--drop-after');   // also delete retro rows AFTER the file's last month
  const dir = path.join(__dirname, '..', 'backups', 'pre_retro_reload_' + new Date().toISOString().slice(0, 10).replace(/-/g, ''));
  fs.mkdirSync(dir, { recursive: true });
  for (const t of ['RA_person_project_effort', 'RA_resource_eligibility', 'RA_steady_state_eligibility']) {
    const [all] = await pool.query(`SELECT * FROM ${t}`);
    fs.writeFileSync(path.join(dir, t + '.json'), JSON.stringify(all));
  }
  console.log('Backup written to', dir);
  const [ssTasks] = await pool.query('SELECT task_id, task_code FROM RA_steady_state_tasks');
  const taskByCode = new Map(ssTasks.map(t => [String(t.task_code).toLowerCase(), t.task_id]));
  const conn = await pool.getConnection();
  const done = { inserted: 0, updated: 0, deleted: 0, kept_auto: 0, elig: 0, elig_ss: 0 };
  try {
    await conn.beginTransaction();
    // Rahul 2026-11-19: months after the file's last month (2031 here) are not loaded in MS Project: remove them first (retro_import rows only)
    if (DROP_AFTER) {
      const [rm] = await conn.query(`DELETE FROM RA_person_project_effort WHERE set_by = 'retro_import' AND auto_hc = 0 AND fiscal_year * 4 + quarter > ?`, [qTo]);
      done.dropped_after = rm.affectedRows;
    }
    for (const { d } of out.missing) {
      if (Number(d.auto_hc || 0) !== 0) { await conn.query('UPDATE RA_person_project_effort SET effort_hc = auto_hc, m1 = auto_hc, m2 = auto_hc, m3 = auto_hc WHERE id = ?', [d.id]); done.kept_auto++; }
      else { await conn.query('DELETE FROM RA_person_project_effort WHERE id = ?', [d.id]); done.deleted++; }
    }
    for (const { e, hc, d } of out.changed) {
      await conn.query('UPDATE RA_person_project_effort SET effort_hc = ?, m1 = ?, m2 = ?, m3 = ?, set_at = NOW() WHERE id = ?', [r3(hc + Number(d.auto_hc || 0)), r3(e.m[0]), r3(e.m[1]), r3(e.m[2]), d.id]);
      done.updated++;
    }
    for (const { e, hc } of out.new) {
      // a (person, project, quarter) row may already exist as an engine row: the file's HC is added to it
      await conn.query(
        `INSERT INTO RA_person_project_effort (person_id, project_id, fiscal_year, quarter, effort_hc, set_by, m1, m2, m3) VALUES (?,?,?,?,?, 'retro_import', ?,?,?)
         ON DUPLICATE KEY UPDATE effort_hc = effort_hc + VALUES(effort_hc), m1 = VALUES(m1), m2 = VALUES(m2), m3 = VALUES(m3), set_at = NOW()`,
        [e.person.person_id, e.project.project_id, e.y, e.q, hc, r3(e.m[0]), r3(e.m[1]), r3(e.m[2])]);
      done.inserted++;
    }
    for (const [, e] of newPairs) {          // eligibility follows HC (rule of the first load)
      if (e.project.retro_category === 'ss_task') {
        const tid = taskByCode.get(String(e.project.project_code || '').toLowerCase());
        if (tid) { const [r] = await conn.query('INSERT IGNORE INTO RA_steady_state_eligibility (task_id, person_id, added_by) VALUES (?,?,?)', [tid, e.person.person_id, 'retro_reload']); done.elig_ss += r.affectedRows; }
      } else {
        const [r] = await conn.query(`INSERT INTO RA_resource_eligibility (person_id, project_id, capability, set_by) VALUES (?,?, 'yes', 'retro_reload') ON DUPLICATE KEY UPDATE capability = 'yes'`, [e.person.person_id, e.project.project_id]);
        done.elig += r.affectedRows ? 1 : 0;
      }
    }
    if (ROLLBACK) { await conn.rollback(); console.log('--rollback: everything was applied and then undone.', done); }
    else { await conn.commit(); console.log('Applied:', done); await writeLines(); }
  } catch (err) { await conn.rollback(); throw err; } finally { conn.release(); }
  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
