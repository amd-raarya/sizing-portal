'use strict';
/**
 * Forecast estimates for projects that are NOT sized yet ("placeholders").
 *
 *   bucket (one of ~5 similar-project groups, each with one curve)  x  complexity factor  x  start quarter
 *   -> project HC per quarter  ->  split across the stakeholder managers  ->  demand the assignment engine plans.
 *
 * Placeholders live in their own tables (RA_forecast_*), never in RA_projects, so no existing list, filter,
 * cron job or view can see them by accident. The engine addresses a placeholder by the pseudo project id
 * -forecast_id (negative), and its output lines carry estimated:true.
 *
 * Curves start as TEMPLATE curves (placeholders until the history data is fed in) and become LEARNED curves
 * once a bucket has member projects with history (see learnCurve).
 */

const r3 = n => Math.round(n * 1000) / 1000;
const qKey = (fy, q) => fy * 4 + q;
const keyToFyQ = k => ({ fy: Math.floor((k - 1) / 4), q: ((k - 1) % 4) + 1 });
const normName = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

// Curve = share of the bucket's typical peak HC, one value per quarter counted from the project's start quarter.
// TEMPLATE values until the real buckets are agreed (Rahul + Fai) and curves are learned from history.
const TEMPLATE_BUCKETS = [
  { code: 'A', name: 'New architecture',          shape: 'double hump',  peak: 12, curve: [0.15, 0.4, 0.75, 1, 0.8, 0.5, 0.45, 0.7, 0.9, 0.6, 0.3, 0.1] },
  { code: 'B', name: 'Derivative / chiplet reuse', shape: 'trapezoid',    peak: 8,  curve: [0.2, 0.6, 0.9, 1, 1, 0.9, 0.7, 0.4, 0.2, 0.1, 0, 0] },
  { code: 'C', name: 'Respin / stepping',          shape: 'short burst',  peak: 6,  curve: [0, 0.2, 0.7, 1, 0.8, 0.4, 0.15, 0, 0, 0, 0, 0] },
  { code: 'D', name: 'Sustaining',                 shape: 'flat + tail',  peak: 3,  curve: [0.5, 0.8, 0.9, 0.9, 0.9, 0.85, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3] },
  { code: 'E', name: 'Software-only',              shape: 'back-loaded',  peak: 7,  curve: [0.1, 0.15, 0.3, 0.45, 0.6, 0.8, 1, 0.95, 0.8, 0.6, 0.4, 0.25] },
];

let ready = false;
async function ensureTables(pool) {
  if (ready) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS RA_forecast_buckets (
      bucket_id       INT AUTO_INCREMENT PRIMARY KEY,
      code            VARCHAR(10)  NOT NULL,
      name            VARCHAR(100) NOT NULL,
      shape_label     VARCHAR(60)  NULL,
      typical_peak_hc DECIMAL(8,2) NOT NULL DEFAULT 5,
      curve_json      TEXT NOT NULL,
      curve_source    ENUM('template','learned') NOT NULL DEFAULT 'template',
      manager_shares_json TEXT NULL,
      updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_bucket_code (code)
    )`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS RA_forecast_bucket_members (
      project_id  INT NOT NULL PRIMARY KEY,
      bucket_id   INT NOT NULL,
      assigned_by VARCHAR(200) NULL,
      assigned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      KEY idx_fbm_bucket (bucket_id)
    )`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS RA_forecast_projects (
      forecast_id          INT AUTO_INCREMENT PRIMARY KEY,
      project_name         VARCHAR(255) NOT NULL,
      bucket_id            INT NOT NULL,
      complexity           DECIMAL(5,2) NOT NULL DEFAULT 1.00,
      peak_hc_override     DECIMAL(8,2) NULL,
      start_fy             INT NOT NULL,
      start_q              INT NOT NULL,
      silicon_fy           INT NULL,
      silicon_q            INT NULL,
      reference_project_id INT NULL,
      status               ENUM('open','promoted','cancelled') NOT NULL DEFAULT 'open',
      promoted_project_id  INT NULL,
      notes                TEXT NULL,
      created_by           VARCHAR(200) NULL,
      created_at           DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at           DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_fp_status (status)
    )`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS RA_forecast_stakeholders (
      id           INT AUTO_INCREMENT PRIMARY KEY,
      forecast_id  INT NOT NULL,
      manager_name VARCHAR(200) NOT NULL,
      share_pct    DECIMAL(6,3) NOT NULL,
      UNIQUE KEY uq_fs (forecast_id, manager_name),
      CONSTRAINT fk_fs_forecast FOREIGN KEY (forecast_id) REFERENCES RA_forecast_projects(forecast_id) ON DELETE CASCADE
    )`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS RA_forecast_eligibility (
      id          INT AUTO_INCREMENT PRIMARY KEY,
      forecast_id INT NOT NULL,
      person_id   INT NOT NULL,
      capability  ENUM('yes','no','expert') NOT NULL DEFAULT 'yes',
      set_by      VARCHAR(255) NULL,
      set_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_fe (person_id, forecast_id),
      CONSTRAINT fk_fe_forecast FOREIGN KEY (forecast_id) REFERENCES RA_forecast_projects(forecast_id) ON DELETE CASCADE
    )`);
  // manager split learned together with the curve (added later: older databases get the column here)
  const [[col]] = await pool.query(`SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'RA_forecast_buckets' AND COLUMN_NAME = 'manager_shares_json'`);
  if (!col.n) await pool.query('ALTER TABLE RA_forecast_buckets ADD COLUMN manager_shares_json TEXT NULL AFTER curve_source');
  const [[mcol]] = await pool.query(`SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'RA_forecast_buckets' AND COLUMN_NAME = 'milestones_json'`);
  if (!mcol.n) await pool.query('ALTER TABLE RA_forecast_buckets ADD COLUMN milestones_json TEXT NULL AFTER manager_shares_json');
  const [[scol]] = await pool.query(`SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'RA_forecast_buckets' AND COLUMN_NAME = 'shape_config_json'`);
  if (!scol.n) await pool.query('ALTER TABLE RA_forecast_buckets ADD COLUMN shape_config_json TEXT NULL AFTER milestones_json');
  // Milestone dates of an estimate (used to time-shift the bucket curve)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS RA_forecast_milestones (
      id             INT AUTO_INCREMENT PRIMARY KEY,
      forecast_id    INT NOT NULL,
      milestone_name VARCHAR(100) NOT NULL,
      milestone_date DATE NOT NULL,
      UNIQUE KEY uq_fm (forecast_id, milestone_name),
      CONSTRAINT fk_fm_forecast FOREIGN KEY (forecast_id) REFERENCES RA_forecast_projects(forecast_id) ON DELETE CASCADE
    )`);
  const [[{ n }]] = await pool.query('SELECT COUNT(*) AS n FROM RA_forecast_buckets');
  if (!n) {
    for (const b of TEMPLATE_BUCKETS) {
      await pool.query(
        `INSERT INTO RA_forecast_buckets (code, name, shape_label, typical_peak_hc, curve_json, curve_source) VALUES (?,?,?,?,?, 'template')`,
        [b.code, b.name, b.shape, b.peak, JSON.stringify(b.curve)]);
    }
  }
  ready = true;
}

const parseCurve = j => { try { const a = JSON.parse(j); return Array.isArray(a) ? a.map(Number) : []; } catch (e) { return []; } };

// ── Time-shifting with milestones ───────────────────────────────────────────────────────────────────────────
// Time is a continuous "quarter coordinate": calendar quarter k (see qKey) covers [k-1, k). A date lands inside its quarter.
const dateCoord = str => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(str || ''));
  if (!m) return null;
  return Number(m[1]) * 4 + (Number(m[2]) - 1) / 3 + (Number(m[3]) - 1) / 90;
};

/**
 * The map from the estimate's time to the bucket curve's time. The bucket knows where each milestone usually falls
 * (`offset_q` = quarters after the curve's first quarter). Each milestone date the user gives pins that point of the curve
 * to the date; between two pins the curve is stretched or squeezed evenly, and outside them it just moves along.
 * The start quarter is a pin too, so the curve begins where "Starts" says. No milestones = no change at all.
 */
function buildWarp(fp, bucket) {
  const warnings = [];
  const known = new Map((bucket.milestones || []).map(m => [m.name, m]));
  const startCoord = qKey(Number(fp.start_fy), Number(fp.start_q)) - 1;
  let startX = 0;
  const before = [], after = [];
  (fp.milestones || []).forEach(m => {
    const b = known.get(m.milestone_name);
    const c = dateCoord(m.milestone_date);
    if (!b || c === null) return;
    const pin = { name: m.milestone_name, x: c - startCoord, t: Number(b.offset_q) };
    if (Math.abs(pin.t) <= 0.01) startX = pin.x;      // this milestone is where the curve starts: it replaces the start pin
    else (pin.t < 0 ? before : after).push(pin);
  });
  const keep = (list, sign) => {
    const sorted = list.sort((a, b) => sign * (a.t - b.t));      // walk outward from the start
    const out = []; let lastX = startX;
    for (const p of sorted) {
      const ok = sign > 0 ? p.x > lastX + 1e-6 : p.x < lastX - 1e-6;
      if (ok) { out.push(p); lastX = p.x; } else warnings.push(`${p.name}: the date is out of order with the other milestones or the start, so it was ignored.`);
    }
    return out;
  };
  const pins = [...keep(before, -1).reverse(), { name: 'start', x: startX, t: 0 }, ...keep(after, 1)];
  pins.slice(1).forEach((p, i) => {
    const prev = pins[i]; const f = (p.x - prev.x) / (p.t - prev.t);
    if (f < 0.34 || f > 3) warnings.push(`${p.name}: ${f < 1 ? 'squeezes' : 'stretches'} the phase before it to ${Math.round(f * 100)}% of its usual length.`);
  });
  const active = pins.length > 1 || Math.abs(startX) > 1e-9;
  const toCurveTime = x => {
    if (x <= pins[0].x) return pins[0].t + (x - pins[0].x);
    const last = pins[pins.length - 1];
    if (x >= last.x) return last.t + (x - last.x);
    let i = 0; while (x > pins[i + 1].x) i++;
    const a = pins[i], b = pins[i + 1];
    return a.t + ((x - a.x) / (b.x - a.x)) * (b.t - a.t);
  };
  return { active, toCurveTime, warnings };
}

/**
 * HC per quarter for one placeholder, split across its stakeholders.
 * The bucket curve is scaled by the typical peak and the complexity, then time-shifted if milestone dates were given.
 * (A stretched phase keeps its HC level for longer, so it adds effort; a squeezed one removes effort.)
 * @returns [{ key, fy, q, total, byManager: { 'Fan, Fai': hc } }] — the array also carries `.warnings`
 */
function generate(fp, bucket, stakeholders) {
  const curve = Array.isArray(bucket.curve) ? bucket.curve : parseCurve(bucket.curve_json);
  const peak = Number(bucket.typical_peak_hc) * Number(fp.complexity || 1);
  const totalShare = stakeholders.reduce((s, x) => s + Number(x.share_pct || 0), 0) || 0;
  const start = qKey(Number(fp.start_fy), Number(fp.start_q));
  const warp = buildWarp(fp, bucket);
  const L = curve.length;
  const curveAt = j => {                     // curve at a fractional quarter index; it fades to 0 within one quarter of either end
    if (j <= -1 || j >= L) return 0;
    if (j < 0) return curve[0] * (1 + j);
    if (j > L - 1) return curve[L - 1] * (L - j);
    const i = Math.floor(j), f = j - i;
    return i >= L - 1 ? curve[L - 1] : curve[i] * (1 - f) + curve[i + 1] * f;
  };
  const fracs = [];
  if (!warp.active) curve.forEach((v, i) => fracs.push([i, v]));
  else for (let i = -24; i < L * 4 + 24; i++) fracs.push([i, curveAt(warp.toCurveTime(i + 0.5) - 0.5)]);
  const out = [];
  fracs.forEach(([i, frac]) => {
    const total = r3(peak * frac);
    if (total <= 0.0004) return;
    const byManager = {};
    let placed = 0;
    stakeholders.forEach((s, j) => {
      const share = totalShare > 0 ? Number(s.share_pct) / totalShare : 0;
      // the last stakeholder takes the rounding remainder so the quarter total is exact
      const hc = j === stakeholders.length - 1 ? r3(total - placed) : r3(total * share);
      placed = r3(placed + hc);
      if (hc > 0.0004) byManager[s.manager_name] = hc;
    });
    out.push({ key: start + i, ...keyToFyQ(start + i), total, byManager });
  });
  out.warnings = warp.warnings;
  return out;
}

async function listBuckets(pool) {
  await ensureTables(pool);
  const [rows] = await pool.query(`
    SELECT b.*, (SELECT COUNT(*) FROM RA_forecast_bucket_members m WHERE m.bucket_id = b.bucket_id) AS member_count
    FROM RA_forecast_buckets b ORDER BY b.code`);
  return rows.map(r => {
    let shares = null;
    try { shares = r.manager_shares_json ? JSON.parse(r.manager_shares_json) : null; } catch (e) { shares = null; }
    let milestones = [];
    try { milestones = r.milestones_json ? JSON.parse(r.milestones_json) : []; } catch (e) { milestones = []; }
    let shapeRaw = null;
    try { shapeRaw = r.shape_config_json ? JSON.parse(r.shape_config_json) : null; } catch (e) { shapeRaw = null; }
    const shape = { ...normShape(shapeRaw), learned: shapeRaw && shapeRaw.learned ? shapeRaw.learned : null };
    const { manager_shares_json, milestones_json, shape_config_json, ...rest } = r;
    return { ...rest, shape, curve: parseCurve(r.curve_json), typical_peak_hc: Number(r.typical_peak_hc), manager_shares: shares && shares.managers ? shares.managers : [], milestones };
  });
}

/** Milestone dates of estimates: Map forecast_id → [{ milestone_name, milestone_date: 'YYYY-MM-DD' }] */
async function loadMilestones(pool, ids) {
  const map = new Map();
  if (!ids.length) return map;
  const [rows] = await pool.query(
    `SELECT forecast_id, milestone_name, DATE_FORMAT(milestone_date, '%Y-%m-%d') AS milestone_date FROM RA_forecast_milestones
     WHERE forecast_id IN (${ids.map(() => '?').join(',')}) ORDER BY milestone_date`, ids);
  rows.forEach(r => { if (!map.has(r.forecast_id)) map.set(r.forecast_id, []); map.get(r.forecast_id).push({ milestone_name: r.milestone_name, milestone_date: r.milestone_date }); });
  return map;
}

/** Open placeholders with their bucket and stakeholders. */
async function loadOpen(pool) {
  await ensureTables(pool);
  const [fps] = await pool.query(`SELECT * FROM RA_forecast_projects WHERE status = 'open' ORDER BY forecast_id`);
  if (!fps.length) return [];
  const ids = fps.map(f => f.forecast_id);
  const [sh] = await pool.query(`SELECT * FROM RA_forecast_stakeholders WHERE forecast_id IN (${ids.map(() => '?').join(',')})`, ids);
  const ms = await loadMilestones(pool, ids);
  const buckets = new Map((await listBuckets(pool)).map(b => [b.bucket_id, b]));
  return fps.map(f => ({ ...f, bucket: buckets.get(f.bucket_id) || null, stakeholders: sh.filter(s => s.forecast_id === f.forecast_id), milestones: ms.get(f.forecast_id) || [] }));
}

/**
 * What the assignment engine needs for the open placeholders:
 *   demand:      [{ forecast_id, project_name, manager_name, key, hc }]
 *   eligibility: [{ person_id, forecast_id, capability }]
 */
async function loadActiveDemand(pool) {
  const open = await loadOpen(pool);
  const demand = [];
  for (const f of open) {
    if (!f.bucket || !f.stakeholders.length) continue;
    generate(f, f.bucket, f.stakeholders).forEach(row => {
      Object.entries(row.byManager).forEach(([manager_name, hc]) => demand.push({ forecast_id: f.forecast_id, project_name: f.project_name, manager_name, key: row.key, hc }));
    });
  }
  let eligibility = [], no = [];
  const usual = {};   // forecast_id → [person_id]: the people who usually work on the projects of its bucket
  if (open.length) {
    const ids = open.map(f => f.forecast_id);
    const ph = ids.map(() => '?').join(',');
    [eligibility] = await pool.query(`SELECT person_id, forecast_id, capability FROM RA_forecast_eligibility WHERE forecast_id IN (${ph}) AND capability IN ('yes','expert')`, ids);
    [no] = await pool.query(`SELECT person_id, forecast_id FROM RA_forecast_eligibility WHERE forecast_id IN (${ph}) AND capability = 'no'`, ids);
    {
      const [mem] = await pool.query('SELECT project_id, bucket_id FROM RA_forecast_bucket_members');
      const byBucket = new Map();
      mem.forEach(m => byBucket.set(m.bucket_id, (byBucket.get(m.bucket_id) || []).concat(m.project_id)));
      const peopleOf = new Map();   // bucket_id → Set(person_id)
      for (const [bid, pids] of byBucket) {
        const mph = pids.map(() => '?').join(',');
        const [a] = await pool.query(`SELECT DISTINCT person_id FROM RA_resource_eligibility WHERE project_id IN (${mph}) AND capability IN ('yes','expert')`, pids);
        const [b] = await pool.query(`SELECT DISTINCT person_id FROM RA_person_project_effort WHERE project_id IN (${mph}) AND effort_hc > 0`, pids);
        peopleOf.set(bid, new Set([...a, ...b].map(r => r.person_id)));
      }
      open.forEach(f => { usual[f.forecast_id] = [...(peopleOf.get(f.bucket_id) || [])]; });
    }
  }
  return { demand, eligibility, no, usual, open };
}

/**
 * Each manager's typical share of a project, from a list of past projects: every project's split is normalised to 100%
 * first (so a 47-HC project does not outvote a 5-HC one — same rule as the curve), then the splits are averaged.
 * Source per project: the managers' own sizing rows (latest submitted version, else the latest draft); if the project has none,
 * the people who actually carried its effort (retro history).
 */
async function managerSharesFromProjects(pool, ids) {
  const [known] = await pool.query(`SELECT DISTINCT reporting_manager FROM RA_people WHERE reporting_manager IS NOT NULL AND reporting_manager <> ''`);
  const spell = new Map(known.map(k => [normName(k.reporting_manager), k.reporting_manager]));   // spelling of the people table = what the picker and the engine use
  const perProject = [];
  for (const id of ids) {
    const [[sub]] = await pool.query(`SELECT MAX(version_id) AS vid FROM RA_sizing_versions WHERE project_id = ? AND version_status IN ('submitted','locked','bu_approved')`, [id]);
    const [[any]] = await pool.query('SELECT MAX(version_id) AS vid FROM RA_sizing_versions WHERE project_id = ?', [id]);
    const vid = sub.vid || any.vid;
    let rows = [];
    if (vid) {
      [rows] = await pool.query(`
        SELECT sh.manager_name AS manager_name, SUM(sq.headcount) AS hc
        FROM RA_staging_headcount sh JOIN RA_staging_quarterly sq ON sq.staging_id = sh.staging_id
        WHERE sh.version_id = ? AND sh.manager_name IS NOT NULL AND sh.manager_name <> ''
        GROUP BY sh.manager_name HAVING hc > 0`, [vid]);
    }
    if (!rows.length) {
      [rows] = await pool.query(`
        SELECT p.reporting_manager AS manager_name, SUM(e.effort_hc) AS hc
        FROM RA_person_project_effort e JOIN RA_people p ON p.person_id = e.person_id
        WHERE e.project_id = ? AND p.reporting_manager IS NOT NULL AND p.reporting_manager <> ''
        GROUP BY p.reporting_manager HAVING hc > 0`, [id]);
    }
    const m = new Map();
    rows.filter(r => spell.has(normName(r.manager_name))).forEach(r => { const k = spell.get(normName(r.manager_name)); m.set(k, (m.get(k) || 0) + Number(r.hc)); });
    const tot = [...m.values()].reduce((a, b) => a + b, 0);
    if (tot > 0) perProject.push(new Map([...m.entries()].map(([k, v]) => [k, v / tot])));
  }
  if (!perProject.length) return { projects_used: 0, managers: [] };
  const avg = new Map();
  perProject.forEach(pm => pm.forEach((v, k) => avg.set(k, (avg.get(k) || 0) + v / perProject.length)));
  let managers = [...avg.entries()].map(([manager_name, v]) => ({ manager_name, share_pct: Math.round(v * 1000) / 10 })).sort((a, b) => b.share_pct - a.share_pct);
  // keep it short: managers under 3% are noise for a placeholder
  const kept = managers.filter(m => m.share_pct >= 3);
  const keptTotal = kept.reduce((s, m) => s + m.share_pct, 0) || 1;
  managers = kept.map(m => ({ manager_name: m.manager_name, share_pct: Math.round((m.share_pct / keptTotal) * 1000) / 10 }));
  return { projects_used: perProject.length, managers };
}

/**
 * Managers + shares for a new estimate, with no input needed: the bucket's snapshot taken when its curve was learned
 * (or, if there is none yet, computed from its member projects). A reference project overrides the bucket.
 */
async function suggestStakeholders(pool, bucketId, referenceProjectId) {
  await ensureTables(pool);
  if (referenceProjectId) {
    const r = await managerSharesFromProjects(pool, [Number(referenceProjectId)]);
    return { source: r.managers.length ? 'reference_project' : 'none', ...r };
  }
  const [[b]] = await pool.query('SELECT manager_shares_json FROM RA_forecast_buckets WHERE bucket_id = ?', [bucketId]);
  if (b && b.manager_shares_json) {
    try { const snap = JSON.parse(b.manager_shares_json); if (snap.managers && snap.managers.length) return { source: 'bucket_history', ...snap }; } catch (e) { /* fall through */ }
  }
  const ids = (await pool.query('SELECT project_id FROM RA_forecast_bucket_members WHERE bucket_id = ?', [bucketId]))[0].map(r => r.project_id);
  if (!ids.length) return { source: 'none', projects_used: 0, managers: [] };
  const r = await managerSharesFromProjects(pool, ids);
  return { source: r.managers.length ? 'bucket_history' : 'none', ...r };
}

// ── Learning a bucket's curve from its member projects ───────────────────────────────────────────────────────
/**
 * Quarterly total HC of one past/pending project, in consecutive quarters from its first quarter with HC.
 * Source = the last SUBMITTED version (what the engine plans from); if the project was never submitted, its latest draft.
 */
async function loadProjectSeries(pool, projectId) {
  const [[p]] = await pool.query('SELECT project_id, project_name, status FROM RA_projects WHERE project_id = ?', [projectId]);
  if (!p) return null;
  const [[sub]] = await pool.query(
    `SELECT MAX(version_id) AS vid FROM RA_sizing_versions WHERE project_id = ? AND version_status IN ('submitted','locked','bu_approved')`, [projectId]);
  const [[any]] = await pool.query('SELECT MAX(version_id) AS vid FROM RA_sizing_versions WHERE project_id = ?', [projectId]);
  const vid = sub.vid || any.vid;
  if (!vid) return { ...p, version_id: null, source: 'none', startKey: null, hc: [] };
  const [rows] = await pool.query(
    `SELECT sq.fiscal_year AS fy, sq.quarter AS q, SUM(sq.headcount) AS hc
     FROM RA_staging_headcount sh JOIN RA_staging_quarterly sq ON sq.staging_id = sh.staging_id
     WHERE sh.version_id = ? GROUP BY sq.fiscal_year, sq.quarter ORDER BY sq.fiscal_year, sq.quarter`, [vid]);
  const pos = rows.filter(r => Number(r.hc) > 0).map(r => ({ k: qKey(r.fy, r.q), hc: Number(r.hc) }));
  if (!pos.length) return { ...p, version_id: vid, source: sub.vid ? 'submitted' : 'draft', startKey: null, hc: [] };
  const byKey = new Map(pos.map(x => [x.k, x.hc]));
  const startKey = pos[0].k, endKey = pos[pos.length - 1].k;
  const hc = [];
  for (let k = startKey; k <= endKey; k++) hc.push(byKey.get(k) || 0);
  // Milestones of the same version, as quarters after the first quarter with HC (the curve's own time axis)
  // (the HC version if it has milestones; otherwise the newest submitted, then newest any, version of the project that does — a newer version can be saved without them)
  const [[mv]] = await pool.query(
    `SELECT v.version_id FROM RA_sizing_versions v JOIN RA_version_milestones m ON m.version_id = v.version_id AND m.start_date IS NOT NULL
     WHERE v.project_id = ? GROUP BY v.version_id
     ORDER BY (v.version_id = ?) DESC, (v.version_status IN ('submitted','locked','bu_approved')) DESC, v.version_id DESC LIMIT 1`, [projectId, vid]);
  const [ms] = mv ? await pool.query(`SELECT milestone_name, DATE_FORMAT(start_date, '%Y-%m-%d') AS d FROM RA_version_milestones WHERE version_id = ? AND start_date IS NOT NULL`, [mv.version_id]) : [[]];
  const milestones = ms.map(m => ({ name: m.milestone_name, date: m.d, offset: dateCoord(m.d) - (startKey - 1) })).filter(m => Number.isFinite(m.offset));
  return { ...p, version_id: vid, source: sub.vid ? 'submitted' : 'draft', startKey, hc, milestones };
}

/**
 * Piecewise-linear map between two time axes from pins [{ name, t, x }] (t = a project's own time, x = the common time).
 * Pins are walked in order of t; one that would put x out of order is dropped. Outside the pins the map has slope 1 (it just shifts).
 */
function makePiecewise(pins) {
  const sorted = [...pins].sort((a, b) => a.t - b.t);
  const kept = [], dropped = [];
  for (const p of sorted) {
    if (!kept.length || (p.x > kept[kept.length - 1].x + 1e-6 && p.t > kept[kept.length - 1].t + 1e-6)) kept.push(p); else dropped.push(p.name);
  }
  const map = (v, from, to) => {
    if (!kept.length) return v;
    if (v <= kept[0][from]) return kept[0][to] + (v - kept[0][from]);
    const last = kept[kept.length - 1];
    if (v >= last[from]) return last[to] + (v - last[from]);
    let i = 0; while (v > kept[i + 1][from]) i++;
    const a = kept[i], b = kept[i + 1];
    return a[to] + ((v - a[from]) / (b[from] - a[from])) * (b[to] - a[to]);
  };
  return { fwd: t => map(t, 't', 'x'), inv: x => map(x, 'x', 't'), dropped, pins: kept };
}

/**
 * How a bucket's curve is built. Nothing about milestones is hard-coded: it is this configuration, kept per bucket.
 *   end       = the milestone the member projects are ALIGNED on, as ordered candidates (e.g. UU, then A0 Asic Back): per project the
 *               first one it has is used. Projects with none of them are not dropped: they are averaged in on their own start.
 *   start     = milestone that ends the ramp-up of the guideline shape (e.g. BTO). It is not used for alignment.
 *   combine   = 'average' | 'median': how the aligned projects are combined quarter by quarter.
 *   guideline = share of the curve that comes from the guideline shape (0..1); the rest is the combined real projects.
 * (An older config used mode 'phases' / 'learned': they mean guideline 1 / 0.)
 */
const normShape = c => {
  const o = c && typeof c === 'object' ? c : {};
  let g = Number(o.guideline);
  if (!Number.isFinite(g)) g = o.mode === 'phases' ? 1 : o.mode === 'learned' ? 0 : 0;
  return {
    start: String(o.start || ''),
    end: Array.isArray(o.end) ? o.end.map(String).filter(Boolean) : [],
    combine: o.combine === 'median' ? 'median' : 'average',
    guideline: Math.min(1, Math.max(0, Math.round(g * 100) / 100))
  };
};

/**
 * One curve from several projects. Each project is divided by its own peak (so a 47-HC and a 5-HC project can share a shape).
 *  1. ALIGN: every project that has the alignment milestone (UU, else A0 Asic Back, per the bucket's list) is shifted in time so that
 *     milestone falls on a common quarter (the average of where the projects have it). The other projects are averaged in on their own
 *     start, shifted by the average of the aligned ones, so none is thrown away.
 *  2. COMBINE: each quarter is the average (or median) of the projects that have data there.
 *  3. GUIDELINE: the textbook shape managers follow — ramp up until the start milestone (BTO), hold the peak until the alignment
 *     milestone, ramp down — on the same axis, starting and ending at the combined curve's own levels.
 *  4. BLEND: curve = (1 − guideline) × combined + guideline × guideline shape, scaled so the curve peaks at 1.0.
 * typical_peak_hc = the MEDIAN of the member peaks (an average would be pulled around by one very large project).
 * `support[i]` = how many projects quarter i rests on. Milestone offsets are quarters after the curve's first quarter.
 */
function learnCurve(series, shapeIn) {
  const cfg = normShape(shapeIn);
  const usable = series.filter(s => s && s.hc.length);
  if (!usable.length) return null;
  const peaks = usable.map(s => Math.max(...s.hc));
  const norm = usable.map((s, j) => s.hc.map(v => v / peaks[j]));
  const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
  const medianOf = a => { const t = [...a].sort((x, y) => x - y), m = Math.floor(t.length / 2); return t.length % 2 ? t[m] : (t[m - 1] + t[m]) / 2; };
  const msOf = (s, name) => (s.milestones || []).find(m => m.name === name);
  const notes = [];

  // Each project's own milestones: the alignment one (first candidate it has) and, for the guideline, the ramp-up one
  const refs = usable.map(s => {
    const b = cfg.start ? msOf(s, cfg.start) : null;
    let u = null; for (const n of cfg.end) { const m = msOf(s, n); if (m) { u = m; break; } }
    return { b: b ? b.offset : null, bName: b ? b.name : null, u: u ? u.offset : null, uName: u ? u.name : null };
  });
  const us = refs.filter(r => r.u !== null).map(r => r.u);
  const U = us.length ? mean(us) : null;                 // where the alignment milestone sits on the common axis
  const unaligned = usable.filter((s, j) => refs[j].u === null).map(s => s.project_name);
  if (cfg.end.length) {
    if (!us.length) notes.push(`No project has ${cfg.end.join(' or ')}, so the projects are averaged on their own start.`);
    else if (unaligned.length) notes.push(`${unaligned.join(', ')}: no ${cfg.end.join(' or ')}, so ${unaligned.length === 1 ? 'it is' : 'they are'} averaged in on ${unaligned.length === 1 ? 'its' : 'their'} own start.`);
  }

  // One pin per project = a pure shift (nothing is stretched)
  const pinsFor = j => (refs[j].u !== null && U !== null ? [{ name: refs[j].uName, t: refs[j].u, x: U }] : []);
  const warps = usable.map((s, j) => makePiecewise(pinsFor(j)));
  const pinned = warps.map(w => w.pins.length > 0);
  const shiftOfPinned = pinned.some(Boolean) ? mean(warps.filter((w, j) => pinned[j]).map(w => w.fwd(0))) : 0;
  const fwd = (j, t) => (pinned[j] ? warps[j].fwd(t) : t + shiftOfPinned);
  const inv = (j, x) => (pinned[j] ? warps[j].inv(x) : x - shiftOfPinned);
  const xStart = usable.map((s, j) => fwd(j, 0)), xEnd = usable.map((s, j) => fwd(j, s.hc.length));
  const xmin = Math.floor(Math.min(...xStart) + 1e-9), xmax = Math.max(...xEnd);
  const sample = (j, t) => {                      // member j's normalised HC at its own time t (a quarter i covers [i, i+1], its centre is i+0.5)
    const n = norm[j], f = Math.min(Math.max(t - 0.5, 0), n.length - 1), i = Math.floor(f), w = f - i;
    return i >= n.length - 1 ? n[n.length - 1] : n[i] * (1 - w) + n[i + 1] * w;
  };
  const avg = [], support = [], aligned = usable.map(() => []);
  const Q = Math.max(1, Math.ceil(xmax - xmin - 1e-9));
  for (let i = 0; i < Q; i++) {
    const x = xmin + i + 0.5, vals = [];
    usable.forEach((s, j) => {
      const t = inv(j, x);
      if (t >= -1e-9 && t <= s.hc.length + 1e-9) { const v = sample(j, t); vals.push(v); aligned[j].push(r3(v)); } else aligned[j].push(null);
    });
    if (!vals.length) { avg.push(0); support.push(0); continue; }
    avg.push(r3(cfg.combine === 'median' ? medianOf(vals) : mean(vals)));
    support.push(vals.length);
  }
  // The curve starts at its first quarter with HC (alignment can leave empty quarters at either end)
  let lead = 0; while (lead < avg.length - 1 && avg[lead] <= 0.0005) lead++;
  let end = avg.length; while (end > lead + 1 && avg[end - 1] <= 0.0005) end--;
  if (lead > 0 || end < avg.length) {
    avg.splice(end); avg.splice(0, lead); support.splice(end); support.splice(0, lead);
    aligned.forEach(al => { al.splice(end); al.splice(0, lead); });
  }
  const xBase = xmin + lead;
  const sorted = [...peaks].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  // Scale so the averaged curve itself peaks at 1.0 (an average of per-project peaks that fall in different quarters is below 1)
  const top = Math.max(...avg) || 1;
  const learnedCurve = avg.map(v => r3(v / top));
  const Lc = learnedCurve.length;

  // Guideline: ramp up to the start milestone (BTO), hold to the alignment milestone, ramp down — on the same axis,
  // from / to the combined curve's own first and last levels
  let guidelineCurve = null, params = null;
  const bAligned = refs.map((r, j) => (r.b !== null ? fwd(j, r.b) : null)).filter(v => v !== null);
  if (bAligned.length) {
    const Bx = Math.min(Math.max(mean(bAligned) - xBase, 0.6), Lc - 0.5);
    let Ux = U !== null ? Math.min(Math.max(U - xBase, 0.6), Lc - 0.5) : Bx;
    if (U !== null && Ux < Bx) { notes.push(`${cfg.end.join(' / ')} comes before ${cfg.start} on average, so the guideline has no plateau.`); Ux = Bx; }
    if (U === null && cfg.end.length) notes.push(`No project has ${cfg.end.join(' / ')}, so the guideline peaks at ${cfg.start} and ramps down straight after it.`);
    const base = learnedCurve[0], endLevel = learnedCurve[Lc - 1];
    const x0 = 0.5, xe = Lc - 0.5;
    const f = x => (x <= x0 ? base : x < Bx ? base + (1 - base) * (x - x0) / (Bx - x0) : x <= Ux ? 1 : x < xe ? 1 + (endLevel - 1) * (x - Ux) / (xe - Ux) : endLevel);
    guidelineCurve = Array.from({ length: Lc }, (_, i) => r3(f(i + 0.5)));
    params = { ramp_up_q: Math.round(Bx * 100) / 100, plateau_q: Math.round((Ux - Bx) * 100) / 100, ramp_down_q: Math.round((Lc - Ux) * 100) / 100, base: r3(base), end_level: r3(endLevel) };
  } else if (cfg.guideline > 0) {
    notes.push(cfg.start ? `No project has ${cfg.start}, so there is no guideline shape and the curve is the real projects alone.` : 'No start milestone is set, so there is no guideline shape and the curve is the real projects alone.');
  }
  let finalCurve = learnedCurve;
  if (guidelineCurve && cfg.guideline > 0) {
    const g = cfg.guideline, mix = learnedCurve.map((v, i) => (1 - g) * v + g * guidelineCurve[i]);
    const mt = Math.max(...mix) || 1;
    finalCurve = mix.map(v => r3(v / mt));
  }

  // Where each milestone usually falls on the curve's axis: the average over the projects that have it
  const msAcc = new Map();
  usable.forEach((s, j) => (s.milestones || []).forEach(m => {
    const a = msAcc.get(m.name) || { sum: 0, n: 0 }; a.sum += fwd(j, m.offset) - xBase; a.n += 1; msAcc.set(m.name, a);
  }));
  const milestones = [...msAcc.entries()].map(([name, a]) => ({ name, offset_q: Math.round((a.sum / a.n) * 100) / 100, n: a.n })).sort((a, b) => a.offset_q - b.offset_q);
  return {
    config: cfg,
    params,
    notes,
    milestones,
    curve: finalCurve,
    learned_curve: learnedCurve,        // the aligned average alone
    guideline_curve: guidelineCurve,    // the textbook shape alone (null when it cannot be built)
    raw_curve: avg,
    support,
    typical_peak_hc: Math.round(median * 100) / 100,
    member_peaks: peaks.map(x => Math.round(x * 100) / 100),
    members: usable.map((s, j) => ({
      project_id: s.project_id, project_name: s.project_name, source: s.source, quarters: s.hc.length, peak: Math.round(peaks[j] * 100) / 100,
      normalised: norm[j].map(r3), aligned: aligned[j].map(v => (v === null ? null : r3(v / top))),
      start_ref: refs[j].bName, end_ref: refs[j].uName, aligned_on: refs[j].uName
    }))
  };
}

/**
 * Recompute a bucket's curve, milestone timing and typical peak from its member projects and store them as 'learned'.
 * opts.shape overrides the bucket's saved shape configuration (see normShape); opts.dryRun computes without storing anything.
 */
async function relearnBucket(pool, bucketId, opts) {
  const o = opts || {};
  const [mem] = await pool.query('SELECT project_id FROM RA_forecast_bucket_members WHERE bucket_id = ?', [bucketId]);
  const series = [];
  for (const m of mem) series.push(await loadProjectSeries(pool, m.project_id));
  let shape = o.shape;
  if (!shape) {
    const [[b]] = await pool.query('SELECT shape_config_json FROM RA_forecast_buckets WHERE bucket_id = ?', [bucketId]);
    try { shape = b && b.shape_config_json ? JSON.parse(b.shape_config_json) : null; } catch (e) { shape = null; }
  }
  const learned = learnCurve(series, shape);
  if (!learned) return null;
  if (o.dryRun) return learned;
  const shares = await managerSharesFromProjects(pool, mem.map(m => m.project_id));
  const stored = { ...learned.config, learned: learned.params };
  await pool.query(`UPDATE RA_forecast_buckets SET curve_json = ?, typical_peak_hc = ?, curve_source = 'learned', manager_shares_json = ?, milestones_json = ?, shape_config_json = ? WHERE bucket_id = ?`,
    [JSON.stringify(learned.curve), learned.typical_peak_hc, JSON.stringify(shares), JSON.stringify(learned.milestones), JSON.stringify(stored), bucketId]);
  learned.manager_shares = shares;
  return learned;
}

// ── Access (soft gate: allow-list for the first rollout, then every elevated user) ────────────────────────
// FORECAST_ALLOWED_EMAILS = comma list of emails or aliases; '*' = every elevated user. Default = the pilot (Rahul, Fai).
const PILOT = ['rahul.arya@amd.com', 'raarya@amd.com', 'fai.fan@amd.com', 'ffan@amd.com'];
async function canUse(pool, email) {
  const e = String(email || '').trim().toLowerCase();
  if (!e) return false;
  const [u] = await pool.query(
    `SELECT u.is_elevated FROM RA_pm_users u LEFT JOIN RA_people pe ON pe.person_id = u.person_id
     WHERE LOWER(u.email) = ? OR LOWER(pe.alias_email) = ? LIMIT 1`, [e, e]);
  if (!u.length || !u[0].is_elevated) return false;
  const cfg = String(process.env.FORECAST_ALLOWED_EMAILS || '').trim();
  if (cfg === '*') return true;
  const list = (cfg ? cfg.split(',') : PILOT).map(s => s.trim().toLowerCase()).filter(Boolean);
  return list.includes(e);
}

module.exports = { ensureTables, generate, loadMilestones, dateCoord, loadProjectSeries, learnCurve, relearnBucket, listBuckets, loadOpen, loadActiveDemand, suggestStakeholders, canUse, parseCurve, TEMPLATE_BUCKETS, helpers: { qKey, keyToFyQ, normName, r3 } };
