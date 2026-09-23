#!/usr/bin/env node
/**
 * folder_watcher.js
 * Watches inbox/sizing/ and inbox/documents/ for new files.
 * Parses .xlsx sizing files with ExcelJS and queues for admin review.
 *
 * Run: node scripts/folder_watcher.js
 * Or via pm2: pm2 start scripts/folder_watcher.js --name folder-watcher
 */
'use strict';

const fs      = require('fs');
const path    = require('path');
const ExcelJS = require('exceljs');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const pool = require('../src/db/connection');

const BASE        = path.join(__dirname, '..');
const INBOX_SZ    = path.join(BASE, 'inbox',     'sizing');
const INBOX_DOC   = path.join(BASE, 'inbox',     'documents');
const PROC_SZ     = path.join(BASE, 'processed', 'sizing');
const PROC_DOC    = path.join(BASE, 'processed', 'documents');

[INBOX_SZ, INBOX_DOC, PROC_SZ, PROC_DOC].forEach(d => fs.mkdirSync(d, { recursive: true }));

const SIZING_EXTS = new Set(['.xlsx', '.xls']);
const DOC_EXTS    = new Set(['.pdf', '.pptx', '.docx', '.ppt', '.doc']);

function log(msg) { console.log(`${new Date().toISOString().slice(0,19).replace('T',' ')} [watcher] ${msg}`); }

// ── Reuse the same ExcelJS parser from admin.js ───────────────────────────────
const SKIP_TABS = new Set(['Assumptions','Info','BrowserTab','LUT','Instructions','Ramp Scenarios']);

function parseQ(h) {
  if (!h) return null;
  const m = String(h).trim().match(/^Q(\d)(\d{2})$/);
  return m ? { q: parseInt(m[1]), fy: 2000 + parseInt(m[2]) } : null;
}
function cellVal(v) {
  if (v && typeof v === 'object') {
    if ('result' in v) return v.result ?? '';
    if ('text'   in v) return v.text   ?? '';
    if ('richText' in v) return v.richText.map(r => r.text).join('');
  }
  return v ?? '';
}
function clean(v) {
  const s = String(cellVal(v)).trim();
  return ['nan','none','null','undefined'].includes(s.toLowerCase()) ? '' : s;
}

async function parseSizingExcel(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);

  const lut_rates = {};
  const assumptions = [];
  const lutWs = wb.getWorksheet('LUT');
  if (lutWs) lutWs.eachRow((row, ri) => {
    if (ri < 3) return;
    const loc = clean(row.getCell(9).value);
    const rate = parseFloat(cellVal(row.getCell(8).value));
    if (loc && !isNaN(rate)) lut_rates[loc] = Math.round(rate * 100) / 100;
  });
  const assWs = wb.getWorksheet('Assumptions');
  if (assWs) assWs.eachRow((row, ri) => {
    if (ri < 3) return;
    const fn = clean(row.getCell(1).value), scope = clean(row.getCell(2).value);
    if (fn || scope) assumptions.push({ function: fn, scope, assumptions: clean(row.getCell(3).value), risks: clean(row.getCell(4).value) });
  });

  const projects = [];
  wb.eachSheet(ws => {
    if (SKIP_TABS.has(ws.name)) return;
    const row4 = ws.getRow(4);
    const bu_raw = clean(row4.getCell(1).value);
    const row5   = ws.getRow(5);
    const colMap = { category:1, leader:2, team:3, func:4, location:5, hctype:7 };
    const qCols  = {};
    row5.eachCell((cell, ci) => {
      const h = clean(cell.value); if (!h) return;
      const qr = parseQ(h); if (qr) { qCols[ci] = qr; return; }
      const hl = h.toLowerCase();
      if (hl.includes('category')) colMap.category = ci;
      else if (hl.includes('leader'))    colMap.leader   = ci;
      else if (hl.includes('top level')) colMap.team     = ci;
      else if (hl.includes('function'))  colMap.func     = ci;
      else if (hl.includes('allocation')) { /* skip */ }
      else if (hl.includes('location'))  colMap.location = ci;
      else if (hl.includes('hc') && hl.includes('type')) colMap.hctype = ci;
    });
    // Fallback: detect from row 4 year
    if (!Object.keys(qCols).length) {
      row4.eachCell((cell, ci) => {
        if (ci < 8) return;
        const v = parseInt(cellVal(cell.value));
        if (!Object.keys(qCols).length && v >= 2020 && v <= 2040) {
          let fy = v, q = 1;
          for (let c = ci; c <= ci + 80; c++) { qCols[c] = { q, fy }; q++; if (q > 4) { q = 1; fy++; } }
        }
      });
    }
    if (!Object.keys(qCols).length) return;

    const rows = [];
    ws.eachRow((row, ri) => {
      if (ri <= 5) return;
      const category = clean(row.getCell(colMap.category).value);
      const leader   = clean(row.getCell(colMap.leader).value);
      const team     = clean(row.getCell(colMap.team).value);
      const func     = clean(row.getCell(colMap.func).value);
      const loc      = clean(row.getCell(colMap.location).value);
      const hctype   = clean(row.getCell(colMap.hctype).value);
      if (!category && !team && !loc && !hctype) return;
      const quarterly_hc = {};
      for (const [ci, { q, fy }] of Object.entries(qCols)) {
        const v = parseFloat(cellVal(row.getCell(parseInt(ci)).value));
        if (!isNaN(v) && v > 0) quarterly_hc[`Q${q} FY${String(fy).slice(-2)}`] = Math.round(v * 1000) / 1000;
      }
      if (Object.keys(quarterly_hc).length) rows.push({ category, leader, top_level_team: team, function: func, location: loc, hc_type: hctype, quarterly_hc });
    });

    const location_summary = {};
    rows.forEach(r => {
      if (r.location?.trim()) {
        if (!location_summary[r.location]) location_summary[r.location] = { rate: lut_rates[r.location] || null, rows: 0 };
        location_summary[r.location].rows++;
      }
    });
    const scope_notes = assumptions.filter(a => a.scope).map(a => `${a.function}: ${a.scope}`).join('\n');
    projects.push({ project_name: ws.name, bu: ['BU','Client',''].includes(bu_raw) ? '' : bu_raw, rows, row_count: rows.length, location_summary, scope_notes });
  });
  return { projects, rates: lut_rates, assumptions };
}

// ── DB helpers ─────────────────────────────────────────────────────────────────
async function matchProject(name) {
  const [rows] = await pool.query(
    'SELECT project_id, project_name FROM RA_projects WHERE project_name LIKE ? AND retro_category IS NULL LIMIT 1',
    [`%${name.slice(0, 20)}%`]
  );
  return rows[0] || null;
}

async function queueItem(fileType, originalName, storedPath, parseResult, projectId, projectName, error) {
  await pool.query(
    `INSERT INTO RA_import_queue (file_type, original_name, stored_path, parse_result, status, matched_project_id, matched_project_name, error_message)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [fileType, originalName, storedPath, parseResult ? JSON.stringify(parseResult) : null,
     error ? 'error' : 'pending', projectId || null, projectName || null, error || null]
  );
  log(`Queued ${fileType}: ${originalName} → ${error ? 'error: ' + error : 'pending review'}`);
}

// ── File processors ───────────────────────────────────────────────────────────
async function processSizing(filepath, filename) {
  log(`Processing sizing: ${filename}`);
  const ts   = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const dest = path.join(PROC_SZ, `${ts}_${filename}`);
  const buf  = fs.readFileSync(filepath);
  fs.renameSync(filepath, dest);

  try {
    const result = await parseSizingExcel(buf);
    if (result.error) { await queueItem('sizing', filename, dest, null, null, null, result.error); return; }
    for (const proj of result.projects || []) {
      const match = await matchProject(proj.project_name);
      await queueItem('sizing', filename, dest,
        { project: proj, rates: result.rates || {} },
        match?.project_id, match?.project_name || proj.project_name, null);
    }
    if (!result.projects?.length) await queueItem('sizing', filename, dest, null, null, null, 'No project tabs found in file');
  } catch (err) {
    await queueItem('sizing', filename, dest, null, null, null, err.message);
  }
}

async function processDocument(filepath, filename) {
  log(`Processing document: ${filename}`);
  const ts   = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const dest = path.join(PROC_DOC, `${ts}_${filename}`);
  fs.renameSync(filepath, dest);
  const nameGuess = filename.replace(/\.(pdf|pptx?|docx?)$/i, '').replace(/[-_v]\d+.*$/, '').trim();
  const match = nameGuess.length > 3 ? await matchProject(nameGuess) : null;
  await queueItem('document', filename, dest, null, match?.project_id, match?.project_name, null);
}

// ── Scan loop ──────────────────────────────────────────────────────────────────
const pending = new Set(); // prevent double-processing

async function scanFolder(dir, exts, handler) {
  const files = fs.readdirSync(dir);
  for (const fname of files) {
    const ext = path.extname(fname).toLowerCase();
    if (!exts.has(ext)) continue;
    if (fname.startsWith('.')) continue;
    const fpath = path.join(dir, fname);
    const key   = fpath;
    if (pending.has(key)) continue;
    pending.add(key);
    // Wait for file to finish writing (size stable)
    const s1 = fs.statSync(fpath).size;
    await new Promise(r => setTimeout(r, 2000));
    if (!fs.existsSync(fpath)) { pending.delete(key); continue; }
    const s2 = fs.statSync(fpath).size;
    if (s1 !== s2) { pending.delete(key); continue; }
    try { await handler(fpath, fname); } catch (e) { log(`Error: ${e.message}`); }
    pending.delete(key);
  }
}

async function main() {
  log('Folder watcher started');
  log(`  Sizing inbox:   ${INBOX_SZ}`);
  log(`  Document inbox: ${INBOX_DOC}`);
  log('  Poll interval:  10s');
  while (true) {
    await scanFolder(INBOX_SZ,  SIZING_EXTS, processSizing);
    await scanFolder(INBOX_DOC, DOC_EXTS,    processDocument);
    await new Promise(r => setTimeout(r, 10000));
  }
}

main().catch(err => { log(`Fatal: ${err.message}`); process.exit(1); });
