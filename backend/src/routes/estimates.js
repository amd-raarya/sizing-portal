const express = require('express');
const router = express.Router();
const pool = require('../db/connection');
const fe = require('../services/forecastEstimate');

// Forecast estimates: buckets, bucket membership of past projects, and placeholders for projects that are not sized yet.
// Access: every elevated user (FORECAST_ALLOWED_EMAILS = optional comma list of e-mails to restrict it again).
// The caller identifies itself with the x-user-email header (or ?email=), the same way the rest of the portal does.

router.get('/access', async (req, res) => {
  try {
    const email = req.query.email || req.header('x-user-email');
    res.json({ success: true, data: { allowed: await fe.canUse(pool, email) } });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.use(async (req, res, next) => {
  try {
    const email = req.header('x-user-email') || req.query.email || (req.body && req.body.email);
    if (!(await fe.canUse(pool, email))) return res.status(403).json({ success: false, error: 'Forecast estimates are not enabled for this user' });
    await fe.ensureTables(pool);
    req.userEmail = String(email).toLowerCase();
    next();
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ── Buckets ──────────────────────────────────────────────────────────────────
router.get('/buckets', async (req, res) => {
  try { res.json({ success: true, data: await fe.listBuckets(pool) }); }
  catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// Rename / re-size a bucket (after the bucket session with Fai)
router.put('/buckets/:id', async (req, res) => {
  try {
    const { name, shape_label, typical_peak_hc } = req.body || {};
    await pool.query(
      `UPDATE RA_forecast_buckets SET name = COALESCE(?, name), shape_label = COALESCE(?, shape_label), typical_peak_hc = COALESCE(?, typical_peak_hc) WHERE bucket_id = ?`,
      [name || null, shape_label || null, typical_peak_hc === undefined || typical_peak_hc === null ? null : Number(typical_peak_hc), req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// How a bucket's curve is built (see normShape in forecastEstimate.js): the milestone that ends the ramp-up, the ordered candidates
// for the milestone that ends the plateau, and how much of the curve comes from that guideline (0..1; the rest is the averaged projects). Saved here; takes effect at the next re-learn.
const cleanShape = b => ({
  start: String((b && b.start) || '').trim(),
  end: [...new Set((b && Array.isArray(b.end) ? b.end : []).map(x => String(x).trim()).filter(Boolean))],
  combine: b && b.combine === 'median' ? 'median' : 'average',
  guideline: b && Number.isFinite(Number(b.guideline)) ? Math.min(1, Math.max(0, Number(b.guideline))) : 0,
  // how projects of different lengths are put on one axis (see normShape): stretch every project to one common length, or keep real quarters
  lifecycle: b && b.lifecycle === 'raw' ? 'raw' : 'stretch',
  length: b && b.length === 'longest' ? 'longest' : (b && Number.isFinite(Number(b.length)) && Number(b.length) >= 2 && Number(b.length) <= 40 ? Math.round(Number(b.length)) : 'median'),
  min_support: b && Number.isFinite(Number(b.min_support)) ? Math.min(20, Math.max(1, Math.round(Number(b.min_support)))) : 3,
  after_end: b && b.after_end === 'skip' ? 'skip' : 'zero'
});
router.put('/buckets/:id/shape', async (req, res) => {
  try {
    const shape = cleanShape(req.body);
    await pool.query('UPDATE RA_forecast_buckets SET shape_config_json = ? WHERE bucket_id = ?', [JSON.stringify(shape), req.params.id]);
    res.json({ success: true, data: shape });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// Re-learn a bucket's curve, milestone timing and typical peak from its current member projects (their sizing data).
// Body { shape?: {start,end,guideline}, dry_run?: bool }: dry_run computes (with the given shape) and returns the result WITHOUT saving it,
// plus the curve first-quarter alignment would give, so the two can be compared.
router.post('/buckets/:id/learn', async (req, res) => {
  try {
    const body = req.body || {};
    const dry = body.dry_run === true || body.dry_run === 'true';
    const l = await fe.relearnBucket(pool, req.params.id, { shape: body.shape ? cleanShape(body.shape) : undefined, dryRun: dry });
    if (!l) return res.status(400).json({ success: false, error: 'This bucket has no member projects with HC data yet' });
    const out = { config: l.config, params: l.params, notes: l.notes, curve: l.curve, learned_curve: l.learned_curve, guideline_curve: l.guideline_curve, support: l.support, typical_peak_hc: l.typical_peak_hc, length_q: l.length_q, milestones: l.milestones,
      members: l.members.map(m => ({ project_id: m.project_id, project_name: m.project_name, source: m.source, quarters: m.quarters, peak: m.peak, aligned: m.aligned, start_ref: m.start_ref, end_ref: m.end_ref })) };
    if (dry) out.first_hc_curve = (await fe.relearnBucket(pool, req.params.id, { shape: { start: '', end: [], guideline: 0 }, dryRun: true })).curve;
    res.json({ success: true, data: out });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// Projects a curve can be learned from = projects with sizing HC (last submitted version, else the latest draft),
// and the bucket each one is placed in. Same source as relearnBucket, so what you see here is what gets learned.
router.get('/history-projects', async (req, res) => {
  try {
    const [cands] = await pool.query(`
      SELECT DISTINCT p.project_id FROM RA_projects p
      JOIN RA_sizing_versions v ON v.project_id = p.project_id
      JOIN RA_staging_headcount sh ON sh.version_id = v.version_id
      JOIN RA_staging_quarterly sq ON sq.staging_id = sh.staging_id AND sq.headcount > 0
      WHERE p.status <> 'cancelled' AND (p.is_test = 0 OR p.is_test IS NULL) AND (p.retro_category IS NULL OR p.retro_category <> 'ss_task')`);
    const [mem] = await pool.query('SELECT project_id, bucket_id FROM RA_forecast_bucket_members');
    const bucketOf = new Map(mem.map(m => [m.project_id, m.bucket_id]));
    const d = new Date(), nowKey = d.getFullYear() * 4 + Math.ceil((d.getMonth() + 1) / 3);
    const lab = k => `Q${((k - 1) % 4) + 1} ${Math.floor((k - 1) / 4)}`;
    const out = [];
    for (const c of cands) {
      const s = await fe.loadProjectSeries(pool, c.project_id);
      if (!s || !s.hc.length) continue;
      const endKey = s.startKey + s.hc.length - 1;
      out.push({
        project_id: s.project_id, project_name: s.project_name, status: s.status, bucket_id: bucketOf.get(s.project_id) ?? null,
        source: s.source, first_quarter: lab(s.startKey), last_quarter: lab(endKey), quarters: s.hc.length,
        peak_hc: Math.round(Math.max(...s.hc) * 10) / 10, finished: endKey < nowKey
      });
    }
    out.sort((a, b) => a.project_name.localeCompare(b.project_name));
    res.json({ success: true, data: out });
  } catch (err) {
    console.error('GET /estimates/history-projects error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Assign (or clear, bucket_id null) the bucket of one past project
router.put('/bucket-members', async (req, res) => {
  try {
    const { project_id, bucket_id, assigned_by } = req.body || {};
    if (!project_id) return res.status(400).json({ success: false, error: 'project_id required' });
    if (!bucket_id) await pool.query('DELETE FROM RA_forecast_bucket_members WHERE project_id = ?', [project_id]);
    else {
      const [b] = await pool.query('SELECT bucket_id FROM RA_forecast_buckets WHERE bucket_id = ?', [bucket_id]);
      if (!b.length) return res.status(400).json({ success: false, error: 'Unknown bucket' });
      await pool.query(
        `INSERT INTO RA_forecast_bucket_members (project_id, bucket_id, assigned_by) VALUES (?,?,?)
         ON DUPLICATE KEY UPDATE bucket_id = VALUES(bucket_id), assigned_by = VALUES(assigned_by), assigned_at = NOW()`,
        [project_id, bucket_id, assigned_by || req.userEmail]);
    }
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ── Stakeholders / preview ───────────────────────────────────────────────────
router.get('/suggest-stakeholders', async (req, res) => {
  try { res.json({ success: true, data: await fe.suggestStakeholders(pool, req.query.bucket_id, req.query.reference_project_id) }); }
  catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// Managers that exist in the people table (for the stakeholder picker)
router.get('/managers', async (req, res) => {
  try {
    const [rows] = await pool.query(`SELECT reporting_manager AS manager_name, COUNT(*) AS people FROM RA_people
                                     WHERE is_active = 1 AND reporting_manager IS NOT NULL AND reporting_manager <> '' GROUP BY reporting_manager ORDER BY reporting_manager`);
    res.json({ success: true, data: rows });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

async function validate(body, partial) {
  const err = m => ({ error: m });
  const b = body || {};
  const out = {};
  if (!partial || b.project_name !== undefined) { if (!String(b.project_name || '').trim()) return err('project_name required'); out.project_name = String(b.project_name).trim(); }
  if (!partial || b.bucket_id !== undefined) {
    const [r] = await pool.query('SELECT * FROM RA_forecast_buckets WHERE bucket_id = ?', [b.bucket_id]);
    if (!r.length) return err('Choose a bucket'); out.bucket_id = r[0].bucket_id;
  }
  if (!partial || b.complexity !== undefined) { const c = Number(b.complexity === undefined ? 1 : b.complexity); if (!(c >= 0.05 && c <= 5)) return err('complexity must be between 0.05 and 5'); out.complexity = c; }
  if (!partial || b.start_fy !== undefined || b.start_q !== undefined) {
    const fy = Number(b.start_fy), q = Number(b.start_q);
    if (!(fy >= 2020 && fy <= 2045) || !(q >= 1 && q <= 4)) return err('start quarter required'); out.start_fy = fy; out.start_q = q;
  }
  if (b.duration_q !== undefined) {
    if (b.duration_q === null || b.duration_q === '') out.duration_q = null;
    else { const d = Number(b.duration_q); if (!Number.isInteger(d) || d < 2 || d > 40) return err('Duration must be a whole number of quarters between 2 and 40'); out.duration_q = d; }
  }
  ['reference_project_id', 'notes'].forEach(k => {
    if (b[k] !== undefined) out[k] = (b[k] === '' || b[k] === null) ? null : b[k];
  });
  // Milestone dates (time-shift the bucket curve). Only milestones the bucket knows about are accepted.
  if (b.milestones !== undefined) {
    const bid = out.bucket_id ?? b.bucket_id;
    const buckets = await fe.listBuckets(pool);
    const bucket = buckets.find(x => Number(x.bucket_id) === Number(bid));
    const allowed = new Set(((bucket && bucket.milestones) || []).map(m => m.name));
    const seen = new Set(), list = [];
    for (const m of (b.milestones || [])) {
      if (!m || !m.milestone_name) continue;
      if (!allowed.has(m.milestone_name)) return err(`This bucket has no history for the milestone "${m.milestone_name}"`);
      if (seen.has(m.milestone_name)) return err(`Milestone listed twice: ${m.milestone_name}`);
      const d = String(m.milestone_date || '');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(Date.parse(d))) return err(`Enter a date for ${m.milestone_name}`);
      seen.add(m.milestone_name); list.push({ milestone_name: m.milestone_name, milestone_date: d });
    }
    out.milestones = list;
  }
  if (b.stakeholders !== undefined || !partial) {
    let sh = (b.stakeholders || []).filter(s => s && s.manager_name && Number(s.share_pct) > 0);
    // Nothing chosen -> use the bucket's own managers and shares (learned from its member projects): no input needed
    if (!sh.length) {
      const bid = out.bucket_id ?? b.bucket_id;
      if (bid) sh = (await fe.suggestStakeholders(pool, bid, b.reference_project_id)).managers;
    }
    if (!sh.length) return err('This bucket has no manager history yet — add the managers who will staff the project');
    const [known] = await pool.query(`SELECT DISTINCT reporting_manager FROM RA_people WHERE reporting_manager IS NOT NULL AND reporting_manager <> ''`);
    const knownSet = new Set(known.map(k => fe.helpers.normName(k.reporting_manager)));
    const bad = sh.find(s => !knownSet.has(fe.helpers.normName(s.manager_name)));
    if (bad) return err(`Unknown manager: ${bad.manager_name}`);
    const seen = new Set();
    for (const s of sh) { const k = fe.helpers.normName(s.manager_name); if (seen.has(k)) return err(`Manager listed twice: ${s.manager_name}`); seen.add(k); }
    const total = sh.reduce((t, s) => t + Number(s.share_pct), 0);
    out.stakeholders = sh.map(s => ({ manager_name: s.manager_name, share_pct: Math.round((Number(s.share_pct) / total) * 100000) / 1000 }));   // normalised to 100
  }
  return { value: out };
}

// Live preview for the Estimate screen: nothing is saved
router.post('/preview', async (req, res) => {
  try {
    const v = await validate({ project_name: 'preview', ...req.body }, false);
    if (v.error) return res.status(400).json({ success: false, error: v.error });
    const bucket = (await fe.listBuckets(pool)).find(b => Number(b.bucket_id) === Number(v.value.bucket_id));   // parsed curve + milestones
    const rows = fe.generate(v.value, bucket, v.value.stakeholders);
    const total = rows.reduce((s, r) => s + r.total, 0);
    res.json({ success: true, data: {
      quarters: rows.map(r => ({ label: `Q${r.q} FY${String(r.fy).slice(-2)}`, fy: r.fy, q: r.q, total: r.total, byManager: r.byManager })),
      peak: Math.max(0, ...rows.map(r => r.total)), total: Math.round(total * 100) / 100, stakeholders: v.value.stakeholders,
      curve_source: bucket.curve_source, bucket: bucket.name, warnings: rows.warnings || []
    } });
  } catch (err) {
    console.error('POST /estimates/preview error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Placeholders ─────────────────────────────────────────────────────────────
const shape = (f, stakeholders, bucket) => ({ ...f, bucket_name: bucket ? bucket.name : null, bucket_code: bucket ? bucket.code : null, curve_source: bucket ? bucket.curve_source : null, stakeholders });

router.get('/projects', async (req, res) => {
  try {
    const [fps] = await pool.query(`SELECT * FROM RA_forecast_projects WHERE status <> 'cancelled' ORDER BY status, project_name`);
    const [sh] = fps.length ? await pool.query(`SELECT * FROM RA_forecast_stakeholders WHERE forecast_id IN (${fps.map(() => '?').join(',')})`, fps.map(f => f.forecast_id)) : [[]];
    const buckets = new Map((await fe.listBuckets(pool)).map(b => [b.bucket_id, b]));
    const ms = await fe.loadMilestones(pool, fps.map(f => f.forecast_id));
    res.json({ success: true, data: fps.map(f => {
      const b = buckets.get(f.bucket_id); const st = sh.filter(s => s.forecast_id === f.forecast_id);
      const mil = ms.get(f.forecast_id) || [];
      const rows = b && st.length ? fe.generate({ ...f, milestones: mil }, b, st) : [];
      return { ...shape(f, st, b), milestones: mil, peak: Math.max(0, ...rows.map(r => r.total)), total: Math.round(rows.reduce((s, r) => s + r.total, 0) * 100) / 100 };
    }) });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.post('/projects', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const v = await validate(req.body, false);
    if (v.error) { conn.release(); return res.status(400).json({ success: false, error: v.error }); }
    const x = v.value;
    await conn.beginTransaction();
    const [r] = await conn.query(
      `INSERT INTO RA_forecast_projects (project_name, bucket_id, complexity, start_fy, start_q, duration_q, reference_project_id, notes, created_by)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [x.project_name, x.bucket_id, x.complexity, x.start_fy, x.start_q, x.duration_q ?? null, x.reference_project_id ?? null, x.notes ?? null, req.userEmail]);
    for (const m of (x.milestones || [])) await conn.query('INSERT INTO RA_forecast_milestones (forecast_id, milestone_name, milestone_date) VALUES (?,?,?)', [r.insertId, m.milestone_name, m.milestone_date]);
    for (const s of x.stakeholders) await conn.query('INSERT INTO RA_forecast_stakeholders (forecast_id, manager_name, share_pct) VALUES (?,?,?)', [r.insertId, s.manager_name, s.share_pct]);
    await conn.commit();
    res.json({ success: true, data: { forecast_id: r.insertId } });
  } catch (err) {
    await conn.rollback();
    console.error('POST /estimates/projects error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  } finally { conn.release(); }
});

router.patch('/projects/:id', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const [cur] = await conn.query('SELECT status FROM RA_forecast_projects WHERE forecast_id = ?', [req.params.id]);
    if (!cur.length) { conn.release(); return res.status(404).json({ success: false, error: 'Not found' }); }
    if (cur[0].status !== 'open') { conn.release(); return res.status(409).json({ success: false, error: `This estimate is ${cur[0].status} and can no longer be edited` }); }
    const v = await validate(req.body, true);
    if (v.error) { conn.release(); return res.status(400).json({ success: false, error: v.error }); }
    const { stakeholders, milestones, ...cols } = v.value;
    await conn.beginTransaction();
    const keys = Object.keys(cols);
    if (keys.length) await conn.query(`UPDATE RA_forecast_projects SET ${keys.map(k => `${k} = ?`).join(', ')} WHERE forecast_id = ?`, [...keys.map(k => cols[k]), req.params.id]);
    if (stakeholders) {
      await conn.query('DELETE FROM RA_forecast_stakeholders WHERE forecast_id = ?', [req.params.id]);
      for (const s of stakeholders) await conn.query('INSERT INTO RA_forecast_stakeholders (forecast_id, manager_name, share_pct) VALUES (?,?,?)', [req.params.id, s.manager_name, s.share_pct]);
    }
    if (milestones) {
      await conn.query('DELETE FROM RA_forecast_milestones WHERE forecast_id = ?', [req.params.id]);
      for (const m of milestones) await conn.query('INSERT INTO RA_forecast_milestones (forecast_id, milestone_name, milestone_date) VALUES (?,?,?)', [req.params.id, m.milestone_name, m.milestone_date]);
    }
    await conn.commit();
    res.json({ success: true });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ success: false, error: err.message });
  } finally { conn.release(); }
});

// Cancel (soft delete — kept for history, stops counting everywhere)
router.delete('/projects/:id', async (req, res) => {
  try {
    await pool.query(`UPDATE RA_forecast_projects SET status = 'cancelled' WHERE forecast_id = ? AND status = 'open'`, [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// Link the real project once it exists (after Sam's email). The estimate stops counting; the real sizing takes over.
router.post('/projects/:id/promote', async (req, res) => {
  try {
    const { project_id } = req.body || {};
    const [p] = await pool.query('SELECT project_id FROM RA_projects WHERE project_id = ?', [project_id]);
    if (!p.length) return res.status(400).json({ success: false, error: 'Choose an existing project' });
    const [r] = await pool.query(`UPDATE RA_forecast_projects SET status = 'promoted', promoted_project_id = ? WHERE forecast_id = ? AND status = 'open'`, [project_id, req.params.id]);
    if (!r.affectedRows) return res.status(409).json({ success: false, error: 'Only an open estimate can be linked' });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

module.exports = router;
