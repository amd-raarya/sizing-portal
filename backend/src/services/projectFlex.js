'use strict';
/**
 * Project flex — an adjustable layer on top of the approved sizing.
 *
 * The sizing from Sam stays the BASELINE and is never edited. A flex is a small RULE stored per project
 * (move it, run it longer/shorter, scale its HC). The rule is applied LIVE to the sized demand every time a plan,
 * a gap or an output is built, so nothing is baked into the data: change or remove the rule and every screen and the
 * next output follow immediately. Gaps are therefore always measured as "flexed plan - HC we actually have".
 *
 *   shift_q    move the whole project N quarters later (+) or earlier (-)
 *   extend_q   run N quarters longer (+) or end N quarters earlier (-)
 *   tail_mode  how the extra quarters look: 'hold' (last sized HC continues), 'fade' (last sized HC fades out over the
 *              extension), 'stretch' (the whole curve is stretched/squeezed to the new length, shape kept)
 *   hc_pct     scale HC, 100 = unchanged (120 = 20% more)
 *   hc_add     add this many HC per quarter on top (split across managers in proportion to their sizing)
 *   from_fy/q  the HC change (pct/add) applies from this quarter on (default: whole project)
 *
 * Quarter keys are fiscal_year * 4 + quarter, the same as the assignment engine.
 */

const r3 = n => Math.round(n * 1000) / 1000;
const qKey = (fy, q) => fy * 4 + q;
const keyToFyQ = k => ({ fy: Math.floor((k - 1) / 4), q: ((k - 1) % 4) + 1 });
const intOf = v => { const n = Math.round(Number(v)); return Number.isFinite(n) ? n : 0; };

const TAILS = ['hold', 'fade', 'stretch'];

/** Clean and validate a flex rule coming from the browser. Returns { flex } or { error }. */
function cleanFlex(b) {
  b = b || {};
  const f = {
    shift_q: intOf(b.shift_q), extend_q: intOf(b.extend_q),
    tail_mode: TAILS.includes(b.tail_mode) ? b.tail_mode : 'hold',
    hc_pct: b.hc_pct === undefined || b.hc_pct === null || b.hc_pct === '' ? 100 : Number(b.hc_pct),
    hc_add: b.hc_add === undefined || b.hc_add === null || b.hc_add === '' ? 0 : Number(b.hc_add),
    from_fy: b.from_fy ? intOf(b.from_fy) : null, from_q: b.from_q ? intOf(b.from_q) : null,
    note: b.note ? String(b.note).slice(0, 500) : null
  };
  if (!Number.isFinite(f.hc_pct) || f.hc_pct < 0 || f.hc_pct > 1000) return { error: 'HC % must be between 0 and 1000' };
  if (!Number.isFinite(f.hc_add) || Math.abs(f.hc_add) > 500) return { error: 'HC to add must be a number between -500 and 500' };
  if (Math.abs(f.shift_q) > 40 || Math.abs(f.extend_q) > 40) return { error: 'Shift and extension are limited to 40 quarters' };
  if ((f.from_fy && !f.from_q) || (!f.from_fy && f.from_q)) return { error: 'Give both the year and the quarter to start the HC change from' };
  if (f.from_q && (f.from_q < 1 || f.from_q > 4)) return { error: 'Quarter must be 1 to 4' };
  f.hc_pct = Math.round(f.hc_pct * 100) / 100; f.hc_add = Math.round(f.hc_add * 100) / 100;
  return { flex: f };
}

/** Does this rule change anything at all? */
function isNeutral(f) {
  return !f || (!f.shift_q && !f.extend_q && Number(f.hc_pct) === 100 && !Number(f.hc_add));
}

/** Timeline part of the rule (shift + extend/shorten) applied to ONE series { quarterKey: hc }. */
function windowOf(series) {
  const keys = Object.keys(series || {}).map(Number).filter(k => series[k] > 0).sort((a, b) => a - b);
  return keys.length ? { first: keys[0], last: keys[keys.length - 1] } : null;
}

/** `win` = the PROJECT's first/last sized quarter: a manager's or location's series is moved/extended with the project, not with its own end. */
function shapeSeries(series, f, win) {
  win = win || windowOf(series);
  if (!win || !f) return { ...(series || {}) };
  const first = win.first, n = win.last - win.first + 1;
  const dense = Array.from({ length: n }, (_, i) => series[first + i] || 0);
  const ext = intOf(f.extend_q), shift = intOf(f.shift_q);
  let out = dense.slice();
  if (ext !== 0) {
    const L = Math.max(1, n + ext);
    if (f.tail_mode === 'stretch') {
      out = Array.from({ length: L }, (_, i) => {
        const pos = L === 1 ? 0 : i * (n - 1) / (L - 1);
        const lo = Math.floor(pos), hi = Math.min(n - 1, lo + 1);
        return dense[lo] + (dense[hi] - dense[lo]) * (pos - lo);
      });
    } else if (ext > 0) {
      const last = dense[n - 1];
      for (let i = 1; i <= ext; i++) out.push(f.tail_mode === 'fade' ? last * (1 - i / (ext + 1)) : last);
    } else {
      out = dense.slice(0, L);
    }
  }
  const res = {};
  out.forEach((v, i) => { if (v > 1e-9) res[first + shift + i] = r3(v); });
  return res;
}

/** HC part of the rule: the factor to multiply each quarter with, from the PROJECT total (all managers) after the timeline change. */
function levelFactors(totalShaped, f) {
  const pct = Number(f.hc_pct) / 100, add = Number(f.hc_add) || 0;
  const from = f.from_fy && f.from_q ? qKey(f.from_fy, f.from_q) : -Infinity;
  const out = {};
  for (const k of Object.keys(totalShaped).map(Number)) {
    const t = totalShaped[k];
    if (k < from || t <= 0) { out[k] = 1; continue; }
    out[k] = Math.max(0, pct + add / t);
  }
  return out;
}

/** Sum several series { key: hc } into one. */
function sumSeries(list) {
  const out = {};
  list.forEach(s => Object.keys(s || {}).forEach(k => { out[k] = (out[k] || 0) + s[k]; }));
  return out;
}

/**
 * Flexer for one project. `totals` = the project's sized HC per quarter across ALL managers (needed so that "add x HC"
 * is shared fairly between managers). flexer.apply(series) turns any sub-series (a manager, a location) into its flexed version.
 */
function makeFlexer(f, totals) {
  const win = windowOf(totals);
  const shapedTotal = shapeSeries(totals, f, win);
  const factors = levelFactors(shapedTotal, f);
  return {
    totalFlexed: (() => { const o = {}; Object.keys(shapedTotal).forEach(k => { o[k] = r3(shapedTotal[k] * (factors[k] === undefined ? 1 : factors[k])); }); return o; })(),
    apply(series) {
      const sh = shapeSeries(series, f, win), o = {};
      Object.keys(sh).forEach(k => { const v = sh[k] * (factors[k] === undefined ? 1 : factors[k]); if (v > 1e-9) o[k] = r3(v); });
      return o;
    }
  };
}

let ensured = false;
async function ensureTables(pool) {
  if (ensured) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS RA_project_flex (
      project_id     INT NOT NULL PRIMARY KEY,
      shift_q        INT NOT NULL DEFAULT 0,
      extend_q       INT NOT NULL DEFAULT 0,
      tail_mode      ENUM('hold','fade','stretch') NOT NULL DEFAULT 'hold',
      hc_pct         DECIMAL(7,2) NOT NULL DEFAULT 100,
      hc_add         DECIMAL(7,2) NOT NULL DEFAULT 0,
      from_fy        INT NULL,
      from_q         TINYINT NULL,
      note           VARCHAR(500) NULL,
      base_version_id INT NULL,
      updated_by     VARCHAR(255) NULL,
      updated_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS RA_project_flex_history (
      history_id  INT AUTO_INCREMENT PRIMARY KEY,
      project_id  INT NOT NULL,
      action      VARCHAR(20) NOT NULL,
      rule_json   TEXT NULL,
      changed_by  VARCHAR(255) NULL,
      changed_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_flex_hist_project (project_id)
    )`);
  ensured = true;
}

/** Latest version the sizing demand is read from (same rule as the engine: last submitted/locked/approved). */
const LATEST_VERSION_SQL = pid => `(SELECT MAX(v2.version_id) FROM RA_sizing_versions v2 WHERE v2.project_id = ${pid} AND v2.version_status IN ('submitted','locked','bu_approved'))`;

/** All active flex rules: Map(project_id -> rule). Never throws when the table is missing (returns empty). */
async function loadAll(pool) {
  await ensureTables(pool);
  const [rows] = await pool.query(`SELECT * FROM RA_project_flex`);
  const m = new Map();
  rows.forEach(r => { const f = { ...r, hc_pct: Number(r.hc_pct), hc_add: Number(r.hc_add) }; if (!isNeutral(f)) m.set(r.project_id, f); });
  return m;
}

/** Sized HC per quarter across all managers for the given projects: { project_id: { key: hc } }. */
async function loadTotals(pool, projectIds) {
  if (!projectIds.length) return {};
  const [rows] = await pool.query(`
    SELECT v.project_id, sq.fiscal_year, sq.quarter, SUM(sq.headcount) AS hc
    FROM RA_staging_headcount sh
    JOIN RA_sizing_versions v ON v.version_id = sh.version_id
    JOIN RA_staging_quarterly sq ON sq.staging_id = sh.staging_id AND sq.headcount > 0
    WHERE v.project_id IN (${projectIds.map(() => '?').join(',')})
      AND v.version_id = COALESCE(${LATEST_VERSION_SQL('v.project_id')},
                                  (SELECT MAX(v3.version_id) FROM RA_sizing_versions v3 WHERE v3.project_id = v.project_id))
    GROUP BY v.project_id, sq.fiscal_year, sq.quarter`, projectIds);
  const out = {};
  rows.forEach(r => { (out[r.project_id] = out[r.project_id] || {})[qKey(r.fiscal_year, r.quarter)] = Number(r.hc); });
  return out;
}

/** Latest sizing version id per project (to flag a rule that was set against an older sizing). */
async function latestVersions(pool, projectIds) {
  if (!projectIds.length) return {};
  const [rows] = await pool.query(`
    SELECT project_id, MAX(version_id) AS v FROM RA_sizing_versions
    WHERE project_id IN (${projectIds.map(() => '?').join(',')}) AND version_status IN ('submitted','locked','bu_approved')
    GROUP BY project_id`, projectIds);
  const o = {}; rows.forEach(r => { o[r.project_id] = r.v; }); return o;
}

/**
 * Apply the rules to a demand map { normManager: { projectId: { key: hc } } } IN PLACE (engine use).
 * Returns { projectId: rule } for the projects that were flexed.
 */
function applyToDemand(demandByMgr, flexMap) {
  const applied = {};
  const pids = new Set();
  Object.values(demandByMgr).forEach(m => Object.keys(m).forEach(p => pids.add(p)));
  for (const pid of pids) {
    const f = flexMap.get(Number(pid));
    if (!f) continue;
    const totals = sumSeries(Object.values(demandByMgr).map(m => m[pid]).filter(Boolean));
    const fx = makeFlexer(f, totals);
    for (const mk of Object.keys(demandByMgr)) if (demandByMgr[mk][pid]) demandByMgr[mk][pid] = fx.apply(demandByMgr[mk][pid]);
    applied[pid] = f;
  }
  return applied;
}

/** Elevated portal user (same lookup as forecast access: pm-user e-mail or the person's alias e-mail). */
async function isElevated(pool, email) {
  const e = String(email || '').trim().toLowerCase();
  if (!e) return false;
  const [u] = await pool.query(
    `SELECT u.is_elevated FROM RA_pm_users u LEFT JOIN RA_people pe ON pe.person_id = u.person_id
     WHERE LOWER(u.email) = ? OR LOWER(pe.alias_email) = ? LIMIT 1`, [e, e]);
  return !!(u.length && u[0].is_elevated);
}

module.exports = {
  isElevated, ensureTables, cleanFlex, isNeutral, shapeSeries, makeFlexer, sumSeries, loadAll, loadTotals, latestVersions, applyToDemand,
  TAILS, qKey, keyToFyQ
};
