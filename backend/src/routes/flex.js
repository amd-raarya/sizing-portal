const express = require('express');
const router = express.Router();
const pool = require('../db/connection');
const pf = require('../services/projectFlex');

// Project flex: adjustable rules (shift / extend / scale) on top of the approved sizing. The sizing is never edited; the rule is applied
// live by the assignment engine, so plans, gaps and outputs always follow the CURRENT rule. See services/projectFlex.js.
// Elevated users only. The caller identifies itself with the x-user-email header (same as the rest of the portal).

router.use(async (req, res, next) => {
  try {
    const email = req.header('x-user-email') || req.query.email || (req.body && req.body.email);
    if (!(await pf.isElevated(pool, email))) return res.status(403).json({ success: false, error: 'Project flex is available to elevated users' });
    await pf.ensureTables(pool);
    req.userEmail = String(email).toLowerCase();
    next();
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

const label = k => { const { fy, q } = pf.keyToFyQ(k); return `Q${q} FY${String(fy).slice(-2)}`; };
const rows = series => Object.keys(series).map(Number).sort((a, b) => a - b).map(k => ({ key: k, label: label(k), ...pf.keyToFyQ(k), hc: Math.round(series[k] * 1000) / 1000 }));
const ruleOut = r => r && ({
  shift_q: r.shift_q, extend_q: r.extend_q, tail_mode: r.tail_mode, hc_pct: Number(r.hc_pct), hc_add: Number(r.hc_add),
  from_fy: r.from_fy, from_q: r.from_q, note: r.note, updated_by: r.updated_by, updated_at: r.updated_at, base_version_id: r.base_version_id
});

// Everything the editor needs for one project: the rule, sized plan, flexed plan, and the HC people actually carry
async function describe(projectId, rule) {
  const [[proj]] = await pool.query(`SELECT project_id, project_name, status FROM RA_projects WHERE project_id = ?`, [projectId]);
  if (!proj) return null;
  const totals = (await pf.loadTotals(pool, [projectId]))[projectId] || {};
  const flexer = pf.makeFlexer(rule || { shift_q: 0, extend_q: 0, tail_mode: 'hold', hc_pct: 100, hc_add: 0 }, totals);
  // HC people carry on the project today (uploaded / hand-set part only, not the engine's own share)
  const [rt] = await pool.query(`
    SELECT fiscal_year, quarter, SUM(effort_hc - auto_hc) AS hc FROM RA_person_project_effort
    WHERE project_id = ? AND effort_hc - auto_hc > 0.0005 GROUP BY fiscal_year, quarter`, [projectId]);
  const actual = {}; rt.forEach(r => { actual[pf.qKey(r.fiscal_year, r.quarter)] = Number(r.hc); });
  const keys = new Set([...Object.keys(totals), ...Object.keys(flexer.totalFlexed), ...Object.keys(actual)].map(Number));
  const gapOf = series => { const g = {}; Object.keys(series).forEach(k => { const d = series[k] - (actual[k] || 0); if (d > 0.0005) g[k] = d; }); return g; };
  const latest = (await pf.latestVersions(pool, [projectId]))[projectId] || null;
  return {
    project: proj,
    sized: rows(totals), flexed: rows(flexer.totalFlexed), actual: rows(actual),
    gap_sized: rows(gapOf(totals)), gap_flexed: rows(gapOf(flexer.totalFlexed)),
    totals: {
      sized: Math.round(Object.values(totals).reduce((a, b) => a + b, 0) * 10) / 10,
      flexed: Math.round(Object.values(flexer.totalFlexed).reduce((a, b) => a + b, 0) * 10) / 10,
      peak_sized: Math.round(Math.max(0, ...Object.values(totals)) * 10) / 10,
      peak_flexed: Math.round(Math.max(0, ...Object.values(flexer.totalFlexed)) * 10) / 10,
      quarters: keys.size
    },
    latest_version_id: latest
  };
}

// All rules in force
router.get('/', async (req, res) => {
  try {
    const [r] = await pool.query(`
      SELECT f.*, p.project_name, p.status FROM RA_project_flex f JOIN RA_projects p ON p.project_id = f.project_id ORDER BY p.project_name`);
    const latest = await pf.latestVersions(pool, r.map(x => x.project_id));
    res.json({ success: true, data: r.filter(x => !pf.isNeutral({ ...x, hc_pct: Number(x.hc_pct), hc_add: Number(x.hc_add) })).map(x => ({
      project_id: x.project_id, project_name: x.project_name, status: x.status, ...ruleOut(x),
      sizing_changed: !!(x.base_version_id && latest[x.project_id] && latest[x.project_id] !== x.base_version_id)
    })) });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.get('/:projectId', async (req, res) => {
  try {
    const id = Number(req.params.projectId);
    const [[r]] = await pool.query(`SELECT * FROM RA_project_flex WHERE project_id = ?`, [id]);
    const rule = r ? { ...r, hc_pct: Number(r.hc_pct), hc_add: Number(r.hc_add) } : null;
    const d = await describe(id, rule);
    if (!d) return res.status(404).json({ success: false, error: 'Project not found' });
    res.json({ success: true, data: { ...d, rule: ruleOut(r), sizing_changed: !!(r && r.base_version_id && d.latest_version_id && d.latest_version_id !== r.base_version_id) } });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// Try a rule without saving it
router.post('/:projectId/preview', async (req, res) => {
  try {
    const c = pf.cleanFlex(req.body && req.body.rule);
    if (c.error) return res.status(400).json({ success: false, error: c.error });
    const d = await describe(Number(req.params.projectId), c.flex);
    if (!d) return res.status(404).json({ success: false, error: 'Project not found' });
    res.json({ success: true, data: d });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.put('/:projectId', async (req, res) => {
  try {
    const id = Number(req.params.projectId);
    const c = pf.cleanFlex(req.body && req.body.rule);
    if (c.error) return res.status(400).json({ success: false, error: c.error });
    const [[proj]] = await pool.query(`SELECT project_id FROM RA_projects WHERE project_id = ?`, [id]);
    if (!proj) return res.status(404).json({ success: false, error: 'Project not found' });
    const f = c.flex;
    if (pf.isNeutral(f)) return res.status(400).json({ success: false, error: 'Nothing to change: use Reset to sizing to remove the adjustment' });
    const base = (await pf.latestVersions(pool, [id]))[id] || null;
    await pool.query(`
      INSERT INTO RA_project_flex (project_id, shift_q, extend_q, tail_mode, hc_pct, hc_add, from_fy, from_q, note, base_version_id, updated_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE shift_q = VALUES(shift_q), extend_q = VALUES(extend_q), tail_mode = VALUES(tail_mode), hc_pct = VALUES(hc_pct),
        hc_add = VALUES(hc_add), from_fy = VALUES(from_fy), from_q = VALUES(from_q), note = VALUES(note), base_version_id = VALUES(base_version_id), updated_by = VALUES(updated_by)`,
      [id, f.shift_q, f.extend_q, f.tail_mode, f.hc_pct, f.hc_add, f.from_fy, f.from_q, f.note, base, req.userEmail]);
    await pool.query(`INSERT INTO RA_project_flex_history (project_id, action, rule_json, changed_by) VALUES (?, 'set', ?, ?)`, [id, JSON.stringify(f), req.userEmail]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// Back to the approved sizing
router.delete('/:projectId', async (req, res) => {
  try {
    const id = Number(req.params.projectId);
    const [[old]] = await pool.query(`SELECT * FROM RA_project_flex WHERE project_id = ?`, [id]);
    if (old) {
      await pool.query(`DELETE FROM RA_project_flex WHERE project_id = ?`, [id]);
      await pool.query(`INSERT INTO RA_project_flex_history (project_id, action, rule_json, changed_by) VALUES (?, 'reset', ?, ?)`, [id, JSON.stringify(ruleOut(old)), req.userEmail]);
    }
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

module.exports = router;
