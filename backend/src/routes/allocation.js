const express = require('express');
const router = express.Router();
const pool = require('../db/connection');
const engine = require('../services/assignmentEngine');
const projectFlex = require('../services/projectFlex');
// Which sizing version counts as a project's demand: the LAST SUBMITTED one (submitted / locked / BU-approved).
// A newer draft is work in progress and must not hide or replace it. Projects that were never submitted
// (draft only) fall back to their newest version so they still show up.
const demandVersionSql = projectRef => `COALESCE(
  (SELECT MAX(dvs.version_id) FROM RA_sizing_versions dvs WHERE dvs.project_id = ${projectRef} AND dvs.version_status IN ('submitted','locked','bu_approved')),
  (SELECT MAX(dva.version_id) FROM RA_sizing_versions dva WHERE dva.project_id = ${projectRef}))`;

engine.ensureAutoColumn(pool).catch(e => console.error('auto_hc column check failed:', e.message));

// GET /api/allocation/team?manager_name=Gopalakrishnan, Veerabadhran (Veera)
// Returns direct reports of a manager from RA_people
router.get('/team', async (req, res) => {
  try {
    const { manager_name } = req.query;
    let query, params;

    if (!manager_name || manager_name === 'all') {
      // Return everyone (for admin/director viewing all)
      [query, params] = [`
        SELECT person_id, display_name, designation, reporting_manager,
               location, employment_type, function_area, top_level_team, email
        FROM RA_people
        WHERE is_active = 1
        ORDER BY reporting_manager, display_name
      `, []];
    } else {
      // Direct reports only — could be multi-level for directors
      // First check if this manager also has sub-managers (directors)
      [query, params] = [`
        SELECT person_id, display_name, designation, reporting_manager,
               location, employment_type, function_area, top_level_team, email
        FROM RA_people
        WHERE is_active = 1
          AND reporting_manager = ?
        ORDER BY display_name
      `, [manager_name]];
    }

    const [rows] = await pool.query(query, params);
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('GET /allocation/team error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/allocation/org-tree?manager_name=Writer, Tim
// Returns all people under a manager recursively (for directors)
router.get('/org-tree', async (req, res) => {
  try {
    const { manager_name } = req.query;
    if (!manager_name) return res.json({ success: true, data: [] });

    // Get direct reports, then their direct reports (2 levels for now)
    const [direct] = await pool.query(`
      SELECT person_id, display_name, designation, reporting_manager, location, employment_type
      FROM RA_people WHERE is_active = 1 AND reporting_manager = ?
    `, [manager_name]);

    // For sub-managers, get their reports too
    const subManagerNames = direct
      .filter(p => p.designation && (p.designation.includes('Manager') || p.designation.includes('Director')))
      .map(p => p.display_name);

    let indirect = [];
    if (subManagerNames.length > 0) {
      const placeholders = subManagerNames.map(() => '?').join(',');
      const [rows] = await pool.query(`
        SELECT person_id, display_name, designation, reporting_manager, location, employment_type
        FROM RA_people WHERE is_active = 1 AND reporting_manager IN (${placeholders})
      `, subManagerNames);
      indirect = rows;
    }

    const all = [...direct, ...indirect];
    const unique = [...new Map(all.map(p => [p.person_id, p])).values()];
    res.json({ success: true, data: unique });
  } catch (err) {
    console.error('GET /allocation/org-tree error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/allocation/eligibility?manager_name=...
// Returns all eligibility records for a manager's team
router.get('/eligibility', async (req, res) => {
  try {
    const { manager_name } = req.query;
    let personFilter = '';
    let params = [];

    if (manager_name && manager_name !== 'all') {
      personFilter = `AND p.reporting_manager = ?`;
      params = [manager_name];
    }

    const [rows] = await pool.query(`
      SELECT e.eligibility_id, e.person_id, e.project_id, e.capability, e.set_by, e.set_at,
             p.display_name, p.location, p.employment_type, p.designation,
             proj.project_name, proj.BU, proj.status AS project_status
      FROM RA_resource_eligibility e
      JOIN RA_people p ON p.person_id = e.person_id
      JOIN RA_projects proj ON proj.project_id = e.project_id
      WHERE 1=1 ${personFilter}
      ORDER BY p.display_name, proj.project_name
    `, params);

    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('GET /allocation/eligibility error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Yes / Expert ticks on forecast placeholders (pseudo project id -forecast_id) go to RA_forecast_eligibility
async function saveForecastElig(db, records, setBy) {
  if (!records || !records.length) return;
  await require('../services/forecastEstimate').ensureTables(pool);
  for (const r of records) {
    const fid = -Number(r.project_id);
    if (!r.capability) await db.query('DELETE FROM RA_forecast_eligibility WHERE person_id = ? AND forecast_id = ?', [r.person_id, fid]);
    else await db.query(
      `INSERT INTO RA_forecast_eligibility (forecast_id, person_id, capability, set_by) VALUES (?,?,?,?)
       ON DUPLICATE KEY UPDATE capability = VALUES(capability), set_by = VALUES(set_by), set_at = NOW()`, [fid, r.person_id, r.capability, setBy || null]);
  }
}

// POST /api/allocation/eligibility — upsert a single eligibility record
router.post('/eligibility', async (req, res) => {
  try {
    const { person_id, project_id, capability, set_by } = req.body;
    if (!person_id || !project_id) return res.status(400).json({ success: false, error: 'person_id and project_id required' });

    if (project_id < 0) {   // forecast placeholder (pseudo id -forecast_id)
      await saveForecastElig(pool, [{ person_id, project_id, capability }], set_by);
      return res.json({ success: true });
    }

    if (!capability) {
      // Delete — removing eligibility
      await pool.query(
        `DELETE FROM RA_resource_eligibility WHERE person_id = ? AND project_id = ?`,
        [person_id, project_id]
      );
    } else {
      // Upsert
      await pool.query(`
        INSERT INTO RA_resource_eligibility (person_id, project_id, capability, set_by)
        VALUES (?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE capability = VALUES(capability), set_by = VALUES(set_by), set_at = NOW()
      `, [person_id, project_id, capability, set_by || null]);
    }
    res.json({ success: true });
  } catch (err) {
    console.error('POST /allocation/eligibility error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/allocation/eligibility/bulk — save entire matrix for a manager's team
// GET /api/allocation/manager-projects?manager_name=Fan, Fai
// Returns projects scoped to this manager:
//   Source A — projects where manager is named in sizing rows (sh.manager_name)
//   Source B — projects where any of the manager's team members are marked Yes in eligibility
// Also pre-populates eligibility map for the team
router.get('/manager-projects', async (req, res) => {
  try {
    const { manager_name } = req.query;
    if (!manager_name) return res.json({ success: true, data: [] });

    // 1. Team members under this manager
    const [teamRows] = await pool.query(`
      SELECT person_id, display_name, designation, location, employment_type
      FROM RA_people WHERE is_active = 1 AND reporting_manager = ?
      ORDER BY display_name
    `, [manager_name]);

    const personIds = teamRows.map(p => p.person_id);

    // 2. All eligibility records for this team (across ALL projects)
    let eligRows = [];
    if (personIds.length) {
      const [elig] = await pool.query(`
        SELECT person_id, project_id, capability
        FROM RA_resource_eligibility
        WHERE person_id IN (${personIds.map(() => '?').join(',')})
      `, personIds);
      eligRows = elig;
    }

    // Projects from Source B: any project where a team member is marked Yes
    // Exclude projects that are classified as steady state tasks (retro_category = 'ss_task')
    // or whose name matches a known steady state task — these belong in the SS section, not the matrix
    const [ssTasks] = await pool.query(`SELECT DISTINCT project_id FROM RA_projects WHERE retro_category = 'ss_task'`);
    const ssProjectIds = new Set(ssTasks.map(r => r.project_id));
    const eligProjectIds = new Set(
      eligRows.filter(e => e.capability === 'yes' && !ssProjectIds.has(e.project_id)).map(e => e.project_id)
    );

    // Build both name format variants (DB stores "Fan, Fai" and "Fai Fan")
    const name1 = manager_name.trim();
    let name2 = name1;
    if (name1.includes(',')) {
      const parts = name1.split(',').map(s => s.trim());
      name2 = `${parts[1]} ${parts[0]}`;
    } else {
      const parts = name1.split(' ');
      if (parts.length >= 2) name2 = `${parts[parts.length - 1]}, ${parts.slice(0, -1).join(' ')}`;
    }

    // 3a. Source A — projects where manager is named, HC broken down by location
    // so each person only consumes the demand for their location
    const [hcProjectRows] = await pool.query(`
      SELECT
        p.project_id, p.project_name, p.BU, p.status,
        sh.location,
        sq.fiscal_year, sq.quarter,
        SUM(sq.headcount) AS hc
      FROM RA_projects p
      JOIN RA_sizing_versions v ON v.project_id = p.project_id
      JOIN RA_staging_headcount sh ON sh.version_id = v.version_id
      JOIN RA_staging_quarterly sq ON sq.staging_id = sh.staging_id AND sq.headcount > 0
      WHERE (sh.manager_name = ? OR sh.manager_name = ?)
        AND p.status NOT IN ('cancelled','closed')
        AND (p.is_test = 0 OR p.is_test IS NULL)
        AND v.version_id = ${demandVersionSql('p.project_id')}
      GROUP BY p.project_id, p.project_name, p.BU, p.status, sh.location, sq.fiscal_year, sq.quarter
      ORDER BY p.project_name, sh.location, sq.fiscal_year, sq.quarter
    `, [name1, name2]);

    // 3b. Source B — eligibility projects. Only the project itself is taken from here, NOT its sizing HC:
    //     demand shown for a manager must be that manager's own sizing (Source A). Summing every manager's
    //     rows here made a manager look like they owned the whole project's demand (and double-counted
    //     projects that are in both A and B).
    let eligHcRows = [];
    if (eligProjectIds.size > 0) {
      const idList = [...eligProjectIds].map(() => '?').join(',');
      const [rows] = await pool.query(`
        SELECT p.project_id, p.project_name, p.BU, p.status
        FROM RA_projects p
        WHERE p.project_id IN (${idList})
          AND p.status NOT IN ('cancelled','closed')
          AND (p.is_test = 0 OR p.is_test IS NULL)
        ORDER BY p.project_name
      `, [...eligProjectIds]);
      eligHcRows = rows;
    }

    // Under-review projects follow the same rule as funded ones: they appear only when the manager is named
    // in the sizing (Source A) or one of their people is marked eligible (Source B). Test projects are excluded.
    const projectRows = [...hcProjectRows, ...eligHcRows];

    // 4. Shape: per-project HC map — { hcByQuarter: { quarter: total }, hcByLocationQuarter: { location: { quarter: hc } } }
    const projectMap = {};
    for (const r of projectRows) {
      if (!projectMap[r.project_id]) {
        projectMap[r.project_id] = { project_id: r.project_id, project_name: r.project_name, BU: r.BU, status: r.status, hcByQuarter: {}, hcByLocationQuarter: {} };
      }
      if (r.fiscal_year && r.quarter) {
        const label = `Q${r.quarter} FY${String(r.fiscal_year).slice(-2)}`;
        // Total HC per quarter (for display)
        projectMap[r.project_id].hcByQuarter[label] = (projectMap[r.project_id].hcByQuarter[label] || 0) + parseFloat(r.hc || 0);
        // HC per location per quarter (for capacity calculation)
        const loc = (r.location || '').toLowerCase().trim();
        if (loc) {
          if (!projectMap[r.project_id].hcByLocationQuarter[loc]) projectMap[r.project_id].hcByLocationQuarter[loc] = {};
          projectMap[r.project_id].hcByLocationQuarter[loc][label] = (projectMap[r.project_id].hcByLocationQuarter[loc][label] || 0) + parseFloat(r.hc || 0);
        }
      }
    }

    // 4a. Project flex: adjustable rules on top of the approved sizing (shift / extend / scale). The matrix shows the ADJUSTED plan;
    //     the sized numbers stay available as sizedHcByQuarter. Same rule the engine applies, so matrix, gap and output agree.
    {
      const flexMap = await projectFlex.loadAll(pool);
      const ids = Object.keys(projectMap).map(Number).filter(id => flexMap.has(id));
      if (ids.length) {
        const totals = await projectFlex.loadTotals(pool, ids);
        const lab2key = l => { const m = l.match(/Q(\d) FY(\d{2})/); return m ? projectFlex.qKey(2000 + parseInt(m[2], 10), parseInt(m[1], 10)) : 0; };
        const key2lab = k => { const { fy, q } = projectFlex.keyToFyQ(k); return `Q${q} FY${String(fy).slice(-2)}`; };
        const flexLabels = ser => { const o = {}; Object.keys(ser).forEach(l => { o[lab2key(l)] = ser[l]; }); return o; };
        const backLabels = ser => { const o = {}; Object.keys(ser).forEach(k => { o[key2lab(Number(k))] = Math.round(ser[k] * 1000) / 1000; }); return o; };
        for (const id of ids) {
          const f = flexMap.get(id), fx = projectFlex.makeFlexer(f, totals[id] || {}), pm = projectMap[id];
          pm.sizedHcByQuarter = pm.hcByQuarter;
          pm.hcByQuarter = backLabels(fx.apply(flexLabels(pm.hcByQuarter)));
          for (const loc of Object.keys(pm.hcByLocationQuarter)) pm.hcByLocationQuarter[loc] = backLabels(fx.apply(flexLabels(pm.hcByLocationQuarter[loc])));
          pm.flexed = true;
          pm.flex = { shift_q: f.shift_q, extend_q: f.extend_q, tail_mode: f.tail_mode, hc_pct: f.hc_pct, hc_add: f.hc_add, from_fy: f.from_fy, from_q: f.from_q, note: f.note };
        }
      }
    }

    // 4b. HC the manager's people actually carry on each project, per quarter (retro + plan rows in
    //     RA_person_project_effort, same calendar-quarter labels as above). Shown next to the sizing allotment.
    const shownIds = Object.keys(projectMap).map(Number);
    for (const pid of shownIds) { projectMap[pid].teamHcByQuarter = {}; projectMap[pid].teamPeopleByQuarter = {}; }
    if (personIds.length && shownIds.length) {
      const [teamEffort] = await pool.query(`
        SELECT project_id, fiscal_year, quarter, SUM(effort_hc) AS hc, COUNT(DISTINCT person_id) AS people
        FROM RA_person_project_effort
        WHERE effort_hc > 0
          AND person_id IN (${personIds.map(() => '?').join(',')})
          AND project_id IN (${shownIds.map(() => '?').join(',')})
        GROUP BY project_id, fiscal_year, quarter
        HAVING SUM(effort_hc) >= 0.05   -- ignore stray sub-0.05 HC values (shown as "0.0 HC", not real assignments)
      `, [...personIds, ...shownIds]);
      for (const r of teamEffort) {
        const label = `Q${r.quarter} FY${String(r.fiscal_year).slice(-2)}`;
        projectMap[r.project_id].teamHcByQuarter[label] = Math.round(parseFloat(r.hc) * 100) / 100;
        projectMap[r.project_id].teamPeopleByQuarter[label] = Number(r.people);
      }
    }

    // Funded (everything that is not under review) first, then under review; alphabetical inside each group
    const projectList = Object.values(projectMap).sort((a, b) =>
      (a.status === 'under review') - (b.status === 'under review') || a.project_name.localeCompare(b.project_name));

    // Forecast placeholders (projects not sized yet) — only when asked for (include_estimates=1). They carry a NEGATIVE
    // project_id (-forecast_id), status 'forecast', and their Yes ticks live in RA_forecast_eligibility.
    if (req.query.include_estimates === '1' || req.query.include_estimates === 'true') {
      const fe = require('../services/forecastEstimate');
      const norm = engine.helpers.normName;
      const mine = new Set([norm(name1), norm(name2)]);
      const open = await fe.loadOpen(pool);
      let feElig = [];
      if (personIds.length && open.length) {
        [feElig] = await pool.query(
          `SELECT person_id, forecast_id, capability FROM RA_forecast_eligibility
           WHERE person_id IN (${personIds.map(() => '?').join(',')})`, personIds);
      }
      for (const f of open) {
        if (!f.bucket) continue;
        const hcByQuarter = {};
        fe.generate(f, f.bucket, f.stakeholders).forEach(row => {
          Object.entries(row.byManager).forEach(([mgr, hc]) => {
            if (mine.has(norm(mgr))) hcByQuarter[`Q${row.q} FY${String(row.fy).slice(-2)}`] = (hcByQuarter[`Q${row.q} FY${String(row.fy).slice(-2)}`] || 0) + hc;
          });
        });
        const ticked = feElig.some(e => e.forecast_id === f.forecast_id);
        if (!Object.keys(hcByQuarter).length && !ticked) continue;   // not a stakeholder of this one
        projectList.push({
          project_id: -f.forecast_id, project_name: f.project_name, BU: '', status: 'forecast', estimated: true,
          forecast_id: f.forecast_id, bucket: f.bucket.name, complexity: Number(f.complexity),
          hcByQuarter, hcByLocationQuarter: {}, teamHcByQuarter: {}, teamPeopleByQuarter: {}
        });
      }
      feElig.forEach(e => eligRows.push({ person_id: e.person_id, project_id: -e.forecast_id, capability: e.capability }));
    }

    res.json({
      success: true,
      data: {
        projects: projectList,
        team: teamRows,
        eligibility: eligRows,  // all elig records for team, not just scoped projects
      }
    });
  } catch (err) {
    console.error('GET /allocation/manager-projects error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/eligibility/bulk', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const { records, set_by } = req.body; // records: [{person_id, project_id, capability}]

    await saveForecastElig(pool, records.filter(r => r.project_id < 0), set_by);   // forecast placeholders live in their own table

    for (const r of records.filter(r => r.project_id >= 0)) {
      if (!r.capability) {
        await conn.query(
          `DELETE FROM RA_resource_eligibility WHERE person_id = ? AND project_id = ?`,
          [r.person_id, r.project_id]
        );
      } else {
        await conn.query(`
          INSERT INTO RA_resource_eligibility (person_id, project_id, capability, set_by)
          VALUES (?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE capability = VALUES(capability), set_by = VALUES(set_by), set_at = NOW()
        `, [r.person_id, r.project_id, r.capability, set_by || null]);
      }
    }

    await conn.commit();
    res.json({ success: true });
  } catch (err) {
    await conn.rollback();
    console.error('POST /allocation/eligibility/bulk error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    conn.release();
  }
});

// GET /api/allocation/summary — compute algorithm output
// Returns per-project allocation based on eligibility + sizing data
router.get('/summary', async (req, res) => {
  try {
    const { manager_name } = req.query;

    // Get all active projects with their sizing HC totals
    const [projects] = await pool.query(`
      SELECT p.project_id, p.project_name, p.BU, p.status,
        COALESCE((
          SELECT SUM(sq.headcount)
          FROM RA_sizing_versions v2
          JOIN RA_staging_headcount sh ON sh.version_id = v2.version_id
          JOIN RA_staging_quarterly sq ON sq.staging_id = sh.staging_id AND sq.headcount > 0
          WHERE v2.project_id = p.project_id
            AND v2.version_id = ${demandVersionSql('p.project_id')}
        ), 0) AS total_sized_hc
      FROM RA_projects p
      WHERE p.status NOT IN ('cancelled','closed')
        AND (p.is_test = 0 OR p.is_test IS NULL)
      ORDER BY p.project_name
    `);

    // Get eligibility records filtered by manager team
    let eligQuery = `
      SELECT e.person_id, e.project_id, e.capability,
             p.display_name, p.location, p.employment_type, p.designation
      FROM RA_resource_eligibility e
      JOIN RA_people p ON p.person_id = e.person_id
    `;
    let eligParams = [];
    if (manager_name && manager_name !== 'all') {
      eligQuery += ` WHERE p.reporting_manager = ?`;
      eligParams = [manager_name];
    }

    const [eligibility] = await pool.query(eligQuery, eligParams);

    // Load effort overrides from fine-tune table
    const [effortRows] = await pool.query(`
      SELECT person_id, project_id, SUM(effort_hc) / COUNT(*) AS avg_effort
      FROM RA_person_project_effort
      GROUP BY person_id, project_id
    `);
    const effortMap = new Map();
    effortRows.forEach(r => effortMap.set(`${r.person_id}:${r.project_id}`, Number(r.avg_effort)));

    // Build result per project
    const result = projects.map(proj => {
      const projElig = eligibility.filter(e => e.project_id === proj.project_id);
      const eligible = projElig.filter(e => e.capability === 'yes' || e.capability === 'expert');

      let assigned = [], status = 'gap';
      if (eligible.length > 0) {
        status = 'covered';
        // Use fine-tune effort if available, else divide equally
        const defaultHc = Math.round((proj.total_sized_hc / eligible.length) * 10) / 10;
        assigned = eligible.map(e => {
          const overrideHc = effortMap.get(`${e.person_id}:${proj.project_id}`);
          return { ...e, allocated_hc: overrideHc || defaultHc, assignment_type: 'eligible' };
        });
      }

      // Under-review projects are not funded yet: report them as 'provisional' so they stay out of the
      // funded covered / gap totals. project_status keeps the real lifecycle status.
      const provisional = proj.status === 'under review';
      return { ...proj, assigned, status: provisional ? 'provisional' : status, project_status: proj.status, eligible_count: eligible.length };
    });

    res.json({ success: true, data: result });
  } catch (err) {
    console.error('GET /allocation/summary error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── ALLOCATION COMPUTE ENGINE ────────────────────────────────────────────────
// GET /api/allocation/compute
// Runs the full assignment algorithm:
//   1. Load people, eligibility, project quarterly demand, steady-state tasks
//   2. Compute availability per person per quarter (subtract steady-state)
//   3. Match people to projects using priority scoring
//   4. Detect conflicts and gaps
//   5. Return assignment matrix + gap summary per quarter
router.get('/compute', async (req, res) => {
  try {
    const { manager_name } = req.query;

    // ── 1. Load people — filtered to manager's team if specified ─────────────
    let peopleFilter = 'WHERE p.is_active = 1';
    let peopleParams = [];
    if (manager_name && manager_name !== 'all') {
      peopleFilter = 'WHERE p.is_active = 1 AND p.reporting_manager = ?';
      peopleParams = [manager_name];
    }
    const [people] = await pool.query(`
      SELECT person_id, display_name, designation, location,
             employment_type, reporting_manager, function_area
      FROM RA_people p
      ${peopleFilter}
      ORDER BY display_name
    `, peopleParams);

    const personIds = people.map(p => p.person_id);
    if (!personIds.length) return res.json({ success: true, data: { quarters: [], person_matrix: [], gap_summary: [], totals: { people: 0, projects: 0, quarters: 0 } } });

    // ── 2. Load eligibility — only for this manager's team ───────────────────
    const [eligibility] = await pool.query(`
      SELECT e.person_id, e.project_id, e.capability
      FROM RA_resource_eligibility e
      WHERE e.person_id IN (${personIds.map(() => '?').join(',')})
        AND (e.capability = 'yes' OR e.capability = 'expert')
    `, personIds);
    const eligMap = {};
    for (const e of eligibility) {
      if (!eligMap[e.person_id]) eligMap[e.person_id] = {};
      eligMap[e.person_id][e.project_id] = e.capability;
    }

    // ── 3. Load project quarterly demand ─────────────────────────────────────
    const [demandRows] = await pool.query(`
      SELECT
        p.project_id, p.project_name, p.BU, p.status,
        sq.fiscal_year, sq.quarter, SUM(sq.headcount) AS hc,
        sh.hc_type, sh.location
      FROM RA_projects p
      JOIN RA_sizing_versions v ON v.project_id = p.project_id
      JOIN RA_staging_headcount sh ON sh.version_id = v.version_id
      JOIN RA_staging_quarterly sq ON sq.staging_id = sh.staging_id AND sq.headcount > 0
      WHERE p.status NOT IN ('cancelled','closed')
        AND v.version_id = ${demandVersionSql('p.project_id')}
      GROUP BY p.project_id, sq.fiscal_year, sq.quarter, sh.hc_type, sh.location
      ORDER BY p.project_id, sq.fiscal_year, sq.quarter
    `);

    // Quarter label helper
    const toQLabel = (fy, q) => `Q${q} FY${String(fy).slice(-2)}`;

    // Build demand map: { project_id → { quarter → { hc_type → { location → hc } } } }
    const demandMap = {};
    const projectMeta = {};
    for (const r of demandRows) {
      const ql = toQLabel(r.fiscal_year, r.quarter);
      if (!demandMap[r.project_id]) demandMap[r.project_id] = {};
      if (!demandMap[r.project_id][ql]) demandMap[r.project_id][ql] = {};
      if (!demandMap[r.project_id][ql][r.hc_type]) demandMap[r.project_id][ql][r.hc_type] = {};
      demandMap[r.project_id][ql][r.hc_type][r.location] =
        (demandMap[r.project_id][ql][r.hc_type][r.location] || 0) + Number(r.hc);
      projectMeta[r.project_id] = { project_id: r.project_id, project_name: r.project_name, BU: r.BU, status: r.status };
    }

    // ── 3b. Load retro effort data (RA_person_project_effort) ────────────────
    const [retroEffortRows] = await pool.query(`
      SELECT e.person_id, e.project_id, e.fiscal_year, e.quarter, e.effort_hc,
             proj.project_name, proj.BU, proj.status
      FROM RA_person_project_effort e
      JOIN RA_projects proj ON proj.project_id = e.project_id
      WHERE e.effort_hc > 0
        AND e.set_by = 'retro_import'
        AND (proj.retro_category IS NULL)
        AND e.person_id IN (${personIds.length ? personIds.map(() => '?').join(',') : 'NULL'})
      ORDER BY e.person_id, e.fiscal_year, e.quarter
    `, personIds);

    // Add retro quarters + project meta
    for (const r of retroEffortRows) {
      const ql = toQLabel(r.fiscal_year, r.quarter);
      if (!projectMeta[r.project_id]) {
        projectMeta[r.project_id] = { project_id: r.project_id, project_name: r.project_name, BU: r.BU, status: r.status };
      }
      // Retro projects get a lightweight demand entry (supply = retro HC, demand = same)
      if (!demandMap[r.project_id]) demandMap[r.project_id] = {};
      if (!demandMap[r.project_id][ql]) demandMap[r.project_id][ql] = { _retro: true };
    }

    // All unique quarters — from sizing AND retro
    const quarterSet = new Set([
      ...demandRows.map(r => toQLabel(r.fiscal_year, r.quarter)),
      ...retroEffortRows.map(r => toQLabel(r.fiscal_year, r.quarter))
    ]);
    const parse = (s) => { const m = s.match(/Q(\d) FY(\d{2})/); return m ? parseInt(m[2]) * 4 + parseInt(m[1]) : 0; };
    const allQuarters = [...quarterSet].sort((a, b) => parse(a) - parse(b));

    // Build retro effort map: { person_id:project_id:quarter → hc }
    const retroMap = {};
    for (const r of retroEffortRows) {
      retroMap[`${r.person_id}:${r.project_id}:${toQLabel(r.fiscal_year, r.quarter)}`] = Number(r.effort_hc);
    }

    // ── 4. Compute availability vector per person per quarter ─────────────────
    // For now steady-state is not yet in DB — availability = 1.0 for everyone
    // When RA_task_person_assignments is built, subtract here
    const availMap = {}; // { person_id → { quarter → 0..1 } }
    for (const p of people) {
      availMap[p.person_id] = {};
      for (const q of allQuarters) availMap[p.person_id][q] = 1.0;
    }

    // ── 5. Priority score per project ─────────────────────────────────────────
    // w1=3 funded/active, w2=2 is this peak quarter, w3=1 base
    const peakQuarter = {}; // project_id → quarter with max hc
    for (const [pid, qMap] of Object.entries(demandMap)) {
      let maxHc = 0, maxQ = null;
      for (const [q, typeMap] of Object.entries(qMap)) {
        const total = Object.values(typeMap).reduce((s, locMap) =>
          s + Object.values(locMap).reduce((a, b) => a + b, 0), 0);
        if (total > maxHc) { maxHc = total; maxQ = q; }
      }
      peakQuarter[pid] = maxQ;
    }
    const priorityScore = (pid, q) => {
      const meta = projectMeta[pid] || {};
      const w1 = meta.status === 'active' ? 3 : 1;
      const w2 = peakQuarter[pid] === q ? 2 : 0;
      return w1 + w2 + 1;
    };

    // ── 6. Load effort overrides from fine-tune table ────────────────────────
    const [effortOverrides] = await pool.query(`
      SELECT person_id, project_id, fiscal_year, quarter, effort_hc
      FROM RA_person_project_effort
    `);
    const toQLabel2 = (fy, q) => `Q${q} FY${String(fy).slice(-2)}`;
    const effortOverrideMap = {};
    for (const r of effortOverrides) {
      const key = `${r.person_id}:${r.project_id}:${toQLabel2(r.fiscal_year, r.quarter)}`;
      effortOverrideMap[key] = Number(r.effort_hc);
    }

    // ── 6b. Pre-load manager allotments in ONE query (avoid N+1 in loop) ─────
    const [mgrAllotAll] = await pool.query(`
      SELECT v.project_id, sq.fiscal_year, sq.quarter,
             SUM(sq.headcount) AS allotment
      FROM RA_staging_headcount sh
      JOIN RA_staging_quarterly sq ON sq.staging_id = sh.staging_id AND sq.headcount > 0
      JOIN RA_sizing_versions v ON v.version_id = sh.version_id
      JOIN RA_projects p ON p.project_id = v.project_id
      WHERE (sh.manager_name = ? OR sh.manager_name = ?)
        AND p.status NOT IN ('cancelled','closed')
        AND (p.is_test = 0 OR p.is_test IS NULL)
      GROUP BY v.project_id, sq.fiscal_year, sq.quarter
    `, [manager_name || '', '']);
    // Map: "project_id:quarter" → allotment
    const mgrAllotMap = {};
    for (const r of mgrAllotAll) {
      const key = `${r.project_id}:${toQLabel2(r.fiscal_year, r.quarter)}`;
      mgrAllotMap[key] = Number(r.allotment);
    }

    for (const r of effortOverrides) {
      const key = `${r.person_id}:${r.project_id}:${toQLabel2(r.fiscal_year, r.quarter)}`;
      effortOverrideMap[key] = Number(r.effort_hc);
    }

    // ── 7. Assignment — use eligibility + allotment/effort data ──────────────
    // Supply = sum of eligible people's effort for each project per quarter
    // Uses fine-tune if available, else allotment ÷ eligible count

    const assignments = {};
    const gapByProject = {};

    for (const q of allQuarters) {
      const projIds = Object.keys(demandMap);

      for (const pid of projIds) {
        const qDemand = demandMap[pid]?.[q];
        if (!qDemand) continue;
        if (!gapByProject[pid]) gapByProject[pid] = {};

        // Flatten demand for this project+quarter
        let totalDemand = 0;
        const demandByType = {}; // hc_type → { location → hc }
        for (const [hcType, locMap] of Object.entries(qDemand)) {
          demandByType[hcType] = locMap;
          totalDemand += Object.values(locMap).reduce((a, b) => a + b, 0);
        }

        // Find all eligible people for this project
        const eligiblePeople = people.filter(p => {
          const cap = eligMap[p.person_id]?.[pid];
          return cap === 'yes' || cap === 'expert';
        });

        let supply = 0;
        const projAssigned = [];

        // Manager's allotment for this project+quarter — pre-loaded above, no SQL in loop
        const mgrAllotment = mgrAllotMap[`${pid}:${q}`] || 0;

        for (const p of eligiblePeople) {
          const overrideKey = `${p.person_id}:${pid}:${q}`;
          // Priority: retro effort > fine-tune override > manager allotment
          let hc = retroMap[overrideKey] || effortOverrideMap[overrideKey] || 0;
          const source = retroMap[overrideKey] ? 'retro' : effortOverrideMap[overrideKey] ? 'planned' : null;

          if (!hc && mgrAllotment > 0) {
            hc = Math.round((mgrAllotment / Math.max(eligiblePeople.length, 1)) * 100) / 100;
          }

          if (hc > 0) {
            supply += hc;
            if (!assignments[p.person_id]) assignments[p.person_id] = {};
            if (!assignments[p.person_id][q]) assignments[p.person_id][q] = [];
            // Allow multiple projects per person per quarter
            const existing = assignments[p.person_id][q].find(a => a.project_id === parseInt(pid));
            if (!existing) {
              assignments[p.person_id][q].push({
                project_id: parseInt(pid),
                project_name: projectMeta[pid]?.project_name,
                hc: Math.round(hc * 10) / 10,
                capability: eligMap[p.person_id]?.[pid],
                source: source || 'planned'
              });
            }
            projAssigned.push({ person_id: p.person_id, display_name: p.display_name, hc });
          }
        }

        // Also add retro assignments for people NOT in eligiblePeople (direct retro data)
        for (const p of people) {
          if (eligMap[p.person_id]?.[pid]) continue;
          const rKey = `${p.person_id}:${pid}:${q}`;
          const rHc = retroMap[rKey];
          if (rHc > 0) {
            supply += rHc;
            if (!assignments[p.person_id]) assignments[p.person_id] = {};
            if (!assignments[p.person_id][q]) assignments[p.person_id][q] = [];
            const existing = assignments[p.person_id][q].find(a => a.project_id === parseInt(pid));
            if (!existing) {
              assignments[p.person_id][q].push({
                project_id: parseInt(pid),
                project_name: projectMeta[pid]?.project_name,
                hc: Math.round(rHc * 10) / 10,
                capability: 'yes',
                source: 'retro'
              });
            }
            projAssigned.push({ person_id: p.person_id, display_name: p.display_name, hc: rHc });
          }
        }

        gapByProject[pid][q] = {
          demand: Math.round(totalDemand * 10) / 10,
          supply: Math.round(supply * 10) / 10,
          gap: Math.round((supply - totalDemand) * 10) / 10,
          assigned: projAssigned
        };
      }
    }

    // ── 7. Build person assignment matrix ─────────────────────────────────────
    const personMatrix = people.map(p => ({
      person_id: p.person_id,
      display_name: p.display_name,
      designation: p.designation,
      location: p.location,
      employment_type: p.employment_type,
      reporting_manager: p.reporting_manager || null,
      assignments: assignments[p.person_id] || {}
    }));

    // ── 8. Build gap summary ──────────────────────────────────────────────────
    const gapSummary = Object.entries(gapByProject).map(([pid, qMap]) => {
      const meta = projectMeta[pid] || {};
      const quarters = Object.entries(qMap).map(([q, data]) => ({ quarter: q, ...data }));
      const totalDemand = quarters.reduce((s, q) => s + q.demand, 0);
      const totalSupply = quarters.reduce((s, q) => s + q.supply, 0);
      return {
        project_id: parseInt(pid),
        project_name: meta.project_name,
        BU: meta.BU,
        status: meta.status,
        total_demand: Math.round(totalDemand * 10) / 10,
        total_supply: Math.round(totalSupply * 10) / 10,
        total_gap: Math.round((totalSupply - totalDemand) * 10) / 10,
        quarters
      };
    });

    res.json({
      success: true,
      data: {
        quarters: allQuarters,
        person_matrix: personMatrix,
        gap_summary: gapSummary,
        totals: {
          people: people.length,
          projects: Object.keys(projectMeta).length,
          quarters: allQuarters.length
        }
      }
    });

  } catch (err) {
    console.error('GET /allocation/compute error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/allocation/project-quarterly?project_id=X
// Returns total HC per quarter for a project across all managers (for All Teams view)
router.get('/project-quarterly', async (req, res) => {
  try {
    const { project_id } = req.query;
    if (!project_id) return res.status(400).json({ success: false, error: 'project_id required' });
    // Demand: all managers' sizing for the latest version. Supply: HC every person carries on the project (retro + plan rows).
    const [rows] = await pool.query(`
      SELECT sq.fiscal_year, sq.quarter, SUM(sq.headcount) AS hc
      FROM RA_sizing_versions v
      JOIN RA_staging_headcount sh ON sh.version_id = v.version_id
      JOIN RA_staging_quarterly sq ON sq.staging_id = sh.staging_id AND sq.headcount > 0
      WHERE v.project_id = ?
        AND v.version_id = ${demandVersionSql('?')}
      GROUP BY sq.fiscal_year, sq.quarter
    `, [project_id, project_id, project_id]);
    const [supplyRows] = await pool.query(`
      SELECT fiscal_year, quarter, SUM(effort_hc) AS hc
      FROM RA_person_project_effort
      WHERE project_id = ? AND effort_hc > 0
      GROUP BY fiscal_year, quarter
      HAVING SUM(effort_hc) >= 0.05   -- ignore stray sub-0.05 HC values
    `, [project_id]);
    const byQ = new Map();
    const slot = (fy, q) => {
      const key = fy * 10 + q;
      if (!byQ.has(key)) byQ.set(key, { key, quarter: `Q${q} FY${String(fy).slice(-2)}`, hc: null, team: null });
      return byQ.get(key);
    };
    rows.forEach(r => { slot(Number(r.fiscal_year), Number(r.quarter)).hc = Math.round(Number(r.hc) * 10) / 10; });
    supplyRows.forEach(r => { slot(Number(r.fiscal_year), Number(r.quarter)).team = Math.round(Number(r.hc) * 100) / 100; });
    const quarters = [...byQ.values()].sort((a, b) => a.key - b.key).map(({ quarter, hc, team }) => ({ quarter, hc, team }));
    res.json({ success: true, data: quarters });
  } catch (err) {
    console.error('GET /allocation/project-quarterly error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── MANAGER ALLOTMENT ───────────────────────────────────────────────────────
// GET /api/allocation/manager-allotment?manager_name=Fan,+Fai
// Returns per project, per quarter: sum of HC rows where manager_name matches
// Handles both "Fan, Fai" and "Fai Fan" formats in the DB
router.get('/manager-allotment', async (req, res) => {
  try {
    const { manager_name } = req.query;
    if (!manager_name) return res.status(400).json({ success: false, error: 'manager_name required' });

    // Build both name format variants
    const name1 = manager_name.trim(); // e.g. "Fan, Fai"
    let name2 = name1;
    if (name1.includes(',')) {
      // "Last, First" → "First Last"
      const parts = name1.split(',').map(s => s.trim());
      name2 = `${parts[1]} ${parts[0]}`;
    } else {
      // "First Last" → "Last, First"
      const parts = name1.split(' ');
      if (parts.length >= 2) {
        name2 = `${parts[parts.length - 1]}, ${parts.slice(0, -1).join(' ')}`;
      }
    }

    // Get all sizing rows for this manager across all projects
    const [rows] = await pool.query(`
      SELECT
        p.project_id, p.project_name, p.BU, p.status,
        sq.fiscal_year, sq.quarter,
        SUM(sq.headcount) AS hc_allotment
      FROM RA_projects p
      JOIN RA_sizing_versions v ON v.project_id = p.project_id
      JOIN RA_staging_headcount sh ON sh.version_id = v.version_id
      JOIN RA_staging_quarterly sq ON sq.staging_id = sh.staging_id AND sq.headcount > 0
      WHERE (sh.manager_name = ? OR sh.manager_name = ?)
        AND p.status NOT IN ('cancelled', 'closed')
        AND v.version_id = ${demandVersionSql('p.project_id')}
      GROUP BY p.project_id, sq.fiscal_year, sq.quarter
      ORDER BY p.project_name, sq.fiscal_year, sq.quarter
    `, [name1, name2]);

    // Build structured result: { project_id → { project_name, BU, status, quarters: { "Q1 FY27" → hc } } }
    const projectMap = new Map();
    for (const r of rows) {
      const q = `Q${r.quarter} FY${String(r.fiscal_year).slice(-2)}`;
      if (!projectMap.has(r.project_id)) {
        projectMap.set(r.project_id, {
          project_id: r.project_id,
          project_name: r.project_name,
          BU: r.BU,
          status: r.status,
          quarters: {}
        });
      }
      projectMap.get(r.project_id).quarters[q] = Math.round(Number(r.hc_allotment) * 10) / 10;
    }

    res.json({
      success: true,
      data: {
        manager_name: name1,
        name_variants: [name1, name2],
        projects: [...projectMap.values()]
      }
    });
  } catch (err) {
    console.error('GET /allocation/manager-allotment error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── EFFORT OVERRIDES ─────────────────────────────────────────────────────────

// GET /api/allocation/effort?project_id=X — all effort overrides for a project
router.get('/effort', async (req, res) => {
  try {
    const { project_id } = req.query;
    if (!project_id) return res.status(400).json({ success: false, error: 'project_id required' });
    const [rows] = await pool.query(`
      SELECT e.id, e.person_id, e.project_id, e.fiscal_year, e.quarter, e.effort_hc, e.set_by,
             p.display_name, p.designation, p.location, p.employment_type
      FROM RA_person_project_effort e
      JOIN RA_people p ON p.person_id = e.person_id
      WHERE e.project_id = ?
      ORDER BY p.display_name, e.fiscal_year, e.quarter
    `, [project_id]);
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('GET /allocation/effort error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/allocation/effort — upsert a single effort override
router.post('/effort', async (req, res) => {
  try {
    const { person_id, project_id, fiscal_year, quarter, effort_hc, set_by } = req.body;
    if (!person_id || !project_id || !fiscal_year || !quarter)
      return res.status(400).json({ success: false, error: 'person_id, project_id, fiscal_year, quarter required' });
    if (effort_hc === 0 || effort_hc === null) {
      // Delete override — revert to algorithm
      await pool.query(
        `DELETE FROM RA_person_project_effort WHERE person_id=? AND project_id=? AND fiscal_year=? AND quarter=?`,
        [person_id, project_id, fiscal_year, quarter]
      );
    } else {
      await pool.query(`
        INSERT INTO RA_person_project_effort (person_id, project_id, fiscal_year, quarter, effort_hc, set_by)
        VALUES (?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          m1 = IF(ABS((effort_hc - auto_hc) - VALUES(effort_hc)) > 0.0015, NULL, m1), m2 = IF(ABS((effort_hc - auto_hc) - VALUES(effort_hc)) > 0.0015, NULL, m2), m3 = IF(ABS((effort_hc - auto_hc) - VALUES(effort_hc)) > 0.0015, NULL, m3),   -- a changed value drops the stored month shape (must stay before effort_hc/auto_hc: assignments run left to right)
          effort_hc = VALUES(effort_hc), auto_hc = 0, set_by = VALUES(set_by), set_at = NOW()
      `, [person_id, project_id, fiscal_year, quarter, effort_hc, set_by || null]);
    }
    res.json({ success: true });
  } catch (err) {
    console.error('POST /allocation/effort error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/allocation/effort/bulk — save all overrides for a project at once
router.post('/effort/bulk', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const { project_id, records, set_by } = req.body;
    // records: [{person_id, fiscal_year, quarter, effort_hc}]
    for (const r of records) {
      if (!r.effort_hc || r.effort_hc <= 0) {
        await conn.query(
          `DELETE FROM RA_person_project_effort WHERE person_id=? AND project_id=? AND fiscal_year=? AND quarter=?`,
          [r.person_id, project_id, r.fiscal_year, r.quarter]
        );
      } else {
        await conn.query(`
          INSERT INTO RA_person_project_effort (person_id, project_id, fiscal_year, quarter, effort_hc, set_by)
          VALUES (?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
          m1 = IF(ABS((effort_hc - auto_hc) - VALUES(effort_hc)) > 0.0015, NULL, m1), m2 = IF(ABS((effort_hc - auto_hc) - VALUES(effort_hc)) > 0.0015, NULL, m2), m3 = IF(ABS((effort_hc - auto_hc) - VALUES(effort_hc)) > 0.0015, NULL, m3),   -- a changed value drops the stored month shape (must stay before effort_hc/auto_hc: assignments run left to right)
          effort_hc = VALUES(effort_hc), auto_hc = 0, set_by = VALUES(set_by), set_at = NOW()
        `, [r.person_id, project_id, r.fiscal_year, r.quarter, r.effort_hc, set_by || null]);
      }
    }
    await conn.commit();
    res.json({ success: true });
  } catch (err) {
    await conn.rollback();
    console.error('POST /allocation/effort/bulk error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    conn.release();
  }
});

// GET /api/allocation/person-capacity?manager_name=X
// Per person per quarter: total effort allocated across all projects + steady state vs 1.0 capacity
router.get('/person-capacity', async (req, res) => {
  try {
    const { manager_name } = req.query;
    let personFilter = '';
    let params = [];
    if (manager_name && manager_name !== 'all') {
      personFilter = 'AND reporting_manager = ?';
      params = [manager_name];
    }

    // Get all people
    const [people] = await pool.query(`
      SELECT person_id, display_name, designation, location, reporting_manager
      FROM RA_people WHERE is_active = 1 ${personFilter}
      ORDER BY display_name
    `, params);

    // Get all effort overrides (retro/plan data). retro_category tells us which rows are steady-state tasks.
    const [efforts] = await pool.query(`
      SELECT e.person_id, e.project_id, e.fiscal_year, e.quarter, e.effort_hc,
             proj.project_name, proj.retro_category
      FROM RA_person_project_effort e
      JOIN RA_projects proj ON proj.project_id = e.project_id
    `);

    // Steady-state task names — a retro row whose project name matches one of these is SS work too
    const [ssTaskRows] = await pool.query(`SELECT task_name FROM RA_steady_state_tasks`);
    const normName = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const ssNameSet = new Set(ssTaskRows.map(t => normName(t.task_name)));
    const isSsRow = e => e.retro_category === 'ss_task' || ssNameSet.has(normName(e.project_name));

    // Get algorithmic allocations from eligibility (for people with Yes but no override)
    const [eligibility] = await pool.query(`
      SELECT e.person_id, e.project_id, proj.project_name
      FROM RA_resource_eligibility e
      JOIN RA_projects proj ON proj.project_id = e.project_id
      WHERE e.capability = 'yes' OR e.capability = 'expert'
    `);

    // Build per-person capacity map
    const result = people.map(person => {
      const personEfforts = efforts.filter(e => e.person_id === person.person_id);

      // Group by quarter label
      const byQuarter = {};
      for (const e of personEfforts) {
        const q = `Q${e.quarter} FY${String(e.fiscal_year).slice(-2)}`;
        if (!byQuarter[q]) byQuarter[q] = { allocated: 0, projectHc: 0, ssHc: 0, projects: [] };
        const hc = Number(e.effort_hc);
        const ss = isSsRow(e);
        byQuarter[q].allocated += hc;
        if (ss) byQuarter[q].ssHc += hc; else byQuarter[q].projectHc += hc;
        byQuarter[q].projects.push({ name: e.project_name, hc, is_ss: ss });
      }

      const r2 = n => Math.round(n * 100) / 100;
      const quarters = Object.entries(byQuarter).map(([quarter, data]) => ({
        quarter,
        allocated: r2(data.allocated),
        project_hc: r2(data.projectHc),   // non-steady-state project work
        ss_hc: r2(data.ssHc),             // steady-state work already in the retro data (e.g. Management)
        gap: r2(1.0 - data.allocated),
        over: data.allocated > 1.0,
        projects: data.projects
      }));

      return {
        person_id: person.person_id,
        display_name: person.display_name,
        designation: person.designation,
        location: person.location,
        eligible_projects: eligibility.filter(e => e.person_id === person.person_id).map(e => e.project_name),
        quarters
      };
    });

    res.json({ success: true, data: result });
  } catch (err) {
    console.error('GET /allocation/person-capacity error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── ASSIGNMENT ENGINE (preview + save) ───────────────────────────────────────
// POST /api/allocation/plan/preview  { manager_name, pending: [{ person_id, project_id, capability }] }
//   Stateless: runs the engine on the DB state with the UNSAVED matrix ticks overlaid. Nothing is written.
// POST /api/allocation/plan/save     { manager_name, set_by }
//   Re-runs the engine on the saved eligibility and writes the auto assignments into RA_person_project_effort
//   (the engine's share of each row is tracked in auto_hc, so it can always be taken back out). Idempotent.
router.post('/plan/preview', async (req, res) => {
  try {
    const { manager_name, pending, include_estimates } = req.body || {};
    if (!manager_name || manager_name === 'all') return res.status(400).json({ success: false, error: 'manager_name required' });
    const ctx = await engine.loadContext(pool, manager_name, { includeEstimates: !!include_estimates });
    // Under-review projects are planned like funded ones everywhere (preview, Save, export) so all views agree
    const plan = engine.runPlan(ctx, Array.isArray(pending) ? pending : []);
    res.json({ success: true, data: plan });
  } catch (err) {
    console.error('POST /allocation/plan/preview error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/plan/save', async (req, res) => {
  try {
    const { manager_name } = req.body || {};
    if (!manager_name || manager_name === 'all') return res.status(400).json({ success: false, error: 'manager_name required' });
    const ctx = await engine.loadContext(pool, manager_name);
    const plan = engine.runPlan(ctx, []);
    const out = await engine.savePlan(pool, ctx, plan);
    res.json({ success: true, data: { ...out, summary: plan.summary } });
  } catch (err) {
    console.error('POST /allocation/plan/save error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── ASSIGNMENT EXPORT ────────────────────────────────────────────────────────
// GET /api/allocation/export?manager_name=Fan,+Fai&format=monthly|weekly&from_quarter=Q1 FY26&to_quarter=Q4 FY27
//
// Source of truth per person per quarter (same numbers the Eligibility Matrix cards show):
//   1. Retro / plan data (RA_person_project_effort). If the person has ANY rows for the quarter we use
//      exactly those rows — project rows as projects, steady-state rows (e.g. Management) as SS.
//   2. If the person has no rows for that quarter, fall back to eligibility × manager allotment.
// Steady-state auto-fill: remaining = max(0, 1.0 - project HC - retro SS HC), split equally across the
// person's SS-eligible tasks that are NOT already present in the retro data. No availability => 0.
const outputModel = require('../services/outputModel');

// Shared by the preview and the download: the SAME model feeds both, so they cannot disagree.
async function prepareOutput(query) {
  const { manager_name, format = 'monthly', from_quarter, to_quarter } = query;
  // include_estimates=1 adds the forecast placeholders (projects not sized yet), flagged as estimates
  const includeEstimates = query.include_estimates === '1' || query.include_estimates === 'true';
  // flex=0 gives the approved sizing as-is (no project adjustments); default = sizing + the adjustments in force
  const useFlex = !(query.flex === '0' || query.flex === 'false');
  const ctx = await engine.loadContext(pool, manager_name, { includeEstimates, useFlex });
  if (ctx.empty) return null;
  const plan = engine.runPlan(ctx);
  const quarters = outputModel.resolveQuarters(ctx, plan, from_quarter, to_quarter);
  const excludedIds = await outputModel.loadExclusions(pool, manager_name);
  return outputModel.buildOutputModel(ctx, plan, { format, quarters, excludedIds });
}

// GET /api/allocation/output-preview — the lines of the Assignment Output as JSON (nothing is written to a file)
router.get('/output-preview', async (req, res) => {
  try {
    const model = await prepareOutput(req.query);
    if (!model) return res.status(404).json({ success: false, error: 'No people found' });
    res.json({ success: true, data: model });
  } catch (err) {
    console.error('GET /allocation/output-preview error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/allocation/output-exclusions?manager_name=  — projects this manager leaves out of the output
router.get('/output-exclusions', async (req, res) => {
  try {
    const ids = await outputModel.loadExclusions(pool, req.query.manager_name);
    res.json({ success: true, data: { project_ids: [...ids] } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT /api/allocation/output-exclusions  { manager_name, project_ids: [..], excluded_by }  — replaces the saved set.
// Only affects the Assignment Output; the matrix, views and saved data are never touched.
router.put('/output-exclusions', async (req, res) => {
  try {
    const { manager_name, project_ids, excluded_by } = req.body || {};
    if (!Array.isArray(project_ids)) return res.status(400).json({ success: false, error: 'project_ids must be an array' });
    const saved = await outputModel.saveExclusions(pool, manager_name, project_ids, excluded_by);
    res.json({ success: true, data: { project_ids: saved } });
  } catch (err) {
    console.error('PUT /allocation/output-exclusions error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/export', async (req, res) => {
  try {
    const ExcelJS = require('exceljs');
    const { manager_name, format = 'monthly' } = req.query;
    const model = await prepareOutput(req.query);
    if (!model) return res.status(404).json({ success: false, error: 'No people found' });
    const { quarters, periods } = model;
    const qIsForecast = {};
    quarters.forEach(q => { qIsForecast[q.label] = q.forecast; });

    // ── Workbook styling ─────────────────────────────────────────────────────
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(format === 'monthly' ? 'Monthly View' : 'Weekly View');
    const fill = argb => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
    const QTR_FILL = fill('FF1A1A2E'), MON_FILL = fill('FF2D2D4E'), PERSON_FILL = fill('FFE8F0FE');
    const OVER_FILL = fill('FFFFCDD2'), SS_FILL = fill('FFFFF8E1'), HC_FILL = fill('FFFFF176');
    const SUM_FILL = fill('FFEEEEEE'), GAP_FILL = fill('FFFFEBEE');
    // Forecast / computed highlighting: blue fill + italic blue text. Regular yellow = straight from uploaded data.
    const FC_FILL = fill('FFC9DEFF'), FC_QTR_FILL = fill('FF3949AB'), FC_MON_FILL = fill('FF5C6BC0');
    const FC_FONT = { name: 'Arial', size: 9, italic: true, color: { argb: 'FF1A4FA3' } };
    const FC_BOLD = { name: 'Arial', size: 9, italic: true, bold: true, color: { argb: 'FF1A4FA3' } };
    const WHITE_FONT = { name: 'Arial', bold: true, color: { argb: 'FFFFFFFF' }, size: 9 };
    const DARK_FONT = { name: 'Arial', size: 9 };
    const BOLD_FONT = { name: 'Arial', bold: true, size: 9 };
    const RED_BOLD = { name: 'Arial', bold: true, size: 9, color: { argb: 'FFC62828' } };
    const COL_NAME = 1, COL_TYPE = 2, COL_DATA = 3;

    // Row 1: quarter headers
    const qtrRow = ws.getRow(1);
    qtrRow.getCell(COL_NAME).value = 'Resource Name'; qtrRow.getCell(COL_NAME).font = WHITE_FONT; qtrRow.getCell(COL_NAME).fill = QTR_FILL;
    qtrRow.getCell(COL_TYPE).value = 'Details';       qtrRow.getCell(COL_TYPE).font = WHITE_FONT; qtrRow.getCell(COL_TYPE).fill = QTR_FILL;
    const qtrGroups = {};
    periods.forEach((p, i) => { if (!qtrGroups[p.quarter]) qtrGroups[p.quarter] = { s: i, e: i }; else qtrGroups[p.quarter].e = i; });
    quarters.forEach(({ q, fy, label }) => {
      const g = qtrGroups[label]; if (!g) return;
      const s = COL_DATA + g.s, e = COL_DATA + g.e;
      if (s < e) ws.mergeCells(1, s, 1, e);
      const fcQ = qIsForecast[label];
      qtrRow.getCell(s).value = fcQ ? `Qtr ${q}, ${fy} · FORECAST` : `Qtr ${q}, ${fy}`;
      for (let c = s; c <= e; c++) {
        qtrRow.getCell(c).fill = fcQ ? FC_QTR_FILL : QTR_FILL; qtrRow.getCell(c).font = WHITE_FONT;
        qtrRow.getCell(c).alignment = { horizontal: 'center', vertical: 'middle' };
        qtrRow.getCell(c).border = { right: { style: 'medium', color: { argb: 'FF5588AA' } } };
      }
    });
    qtrRow.height = 22;

    // Row 2: month / week headers
    const monRow = ws.getRow(2);
    monRow.getCell(COL_NAME).fill = MON_FILL; monRow.getCell(COL_TYPE).fill = MON_FILL;
    periods.forEach((p, i) => {
      const c = monRow.getCell(COL_DATA + i);
      c.value = p.col; c.font = WHITE_FONT; c.fill = qIsForecast[p.quarter] ? FC_MON_FILL : MON_FILL;
      c.alignment = { horizontal: 'center', textRotation: format === 'weekly' ? 90 : 0 };
    });
    monRow.height = 16;

    // Data rows
    let dr = 3;
    for (const person of model.people) {
      // Person aggregate row
      const pRow = ws.getRow(dr++);
      pRow.getCell(COL_NAME).value = person.name; pRow.getCell(COL_NAME).font = BOLD_FONT; pRow.getCell(COL_NAME).fill = PERSON_FILL;
      pRow.getCell(COL_TYPE).value = 'Work'; pRow.getCell(COL_TYPE).font = DARK_FONT; pRow.getCell(COL_TYPE).fill = PERSON_FILL;
      person.work.forEach((w, i) => {
        const c = pRow.getCell(COL_DATA + i);
        c.value = w.v > 0 ? w.v : '';
        c.font = w.over ? RED_BOLD : (w.fc ? FC_BOLD : BOLD_FONT);
        c.fill = w.over ? OVER_FILL : (w.fc && w.v > 0 ? FC_FILL : PERSON_FILL);
        c.alignment = { horizontal: 'center' }; c.numFmt = '0.00';
      });
      pRow.height = 17;

      // Project sub-rows
      for (const pr of person.projects) {
        const row = ws.getRow(dr++);
        row.getCell(COL_NAME).value = `    ${pr.name}${pr.prov ? ' (under review)' : ''}${pr.est ? ' (ESTIMATE)' : ''}${pr.flex ? ' (adjusted)' : ''}`; row.getCell(COL_NAME).font = DARK_FONT;
        row.getCell(COL_TYPE).value = 'Work'; row.getCell(COL_TYPE).font = DARK_FONT;
        pr.vals.forEach((cv, i) => {
          const c = row.getCell(COL_DATA + i);
          if (cv.v > 0) { c.value = cv.v; c.fill = cv.fc ? FC_FILL : HC_FILL; c.numFmt = '0.00'; }
          c.font = cv.fc ? FC_FONT : DARK_FONT; c.alignment = { horizontal: 'center' };
        });
        row.height = 15;
      }

      // Steady-state sub-rows (retro SS first, auto-filled SS where there is availability)
      for (const sr of person.ss) {
        const row = ws.getRow(dr++);
        row.getCell(COL_NAME).value = `    ${sr.label} [SS]`; row.getCell(COL_NAME).font = { ...DARK_FONT, italic: true }; row.getCell(COL_NAME).fill = SS_FILL;
        row.getCell(COL_TYPE).value = 'Work'; row.getCell(COL_TYPE).font = DARK_FONT;
        sr.vals.forEach((cv, i) => {
          const c = row.getCell(COL_DATA + i);
          if (cv.v > 0) { c.value = cv.v; c.fill = cv.fromData ? HC_FILL : FC_FILL; c.numFmt = '0.00'; }
          c.font = cv.fromData || cv.v <= 0 ? { ...DARK_FONT, italic: true } : FC_FONT; c.alignment = { horizontal: 'center' };
        });
        row.height = 15;
      }
    }

    // Team summary rows
    if (model.people.length) {
      dr++;
      const STYLE = {
        total: { font: BOLD_FONT, fill: SUM_FILL }, over: { font: RED_BOLD, fill: GAP_FILL }, hire: { font: RED_BOLD, fill: GAP_FILL },
        hireProj: { font: DARK_FONT, fill: GAP_FILL }, fit: { font: DARK_FONT, fill: SUM_FILL }, unassigned: { font: BOLD_FONT, fill: SUM_FILL }, unassignedProj: { font: DARK_FONT, fill: SUM_FILL }
      };
      model.summary.forEach(sr => {
        const st = STYLE[sr.kind];
        const row = ws.getRow(dr++);
        row.getCell(COL_NAME).value = sr.label; row.getCell(COL_NAME).font = st.font; row.getCell(COL_NAME).fill = st.fill;
        row.getCell(COL_TYPE).fill = st.fill;
        sr.vals.forEach((v, i) => {
          const c = row.getCell(COL_DATA + i);
          c.value = v > 0 ? v : ''; c.font = st.font; c.fill = st.fill; c.alignment = { horizontal: 'center' }; c.numFmt = '0.00';
        });
        row.height = 17;
      });

      // Legend
      dr++;
      const legend = [
        { text: 'Yellow = straight from uploaded retro / plan data', fill: HC_FILL, font: DARK_FONT },
        { text: 'Blue italic = forecast or auto-calculated (not in uploaded data)', fill: FC_FILL, font: FC_FONT },
        { text: 'Blue italic also = HC assigned by the engine from Yes ticks + last submitted sizing (steady state shrinks to make room)', fill: FC_FILL, font: FC_FONT },
        { text: '"(under review)" = project not funded yet; planned from the saved Yes ticks exactly like a funded one', fill: FC_FILL, font: FC_FONT },
        { text: 'Red = person over 1.0 HC in that month', fill: OVER_FILL, font: RED_BOLD },
        { text: 'Months show the uploaded month-by-month data; the matrix and every quarter view show the average of the three months', fill: SUM_FILL, font: DARK_FONT },
        { text: 'HIRING GAP = sized demand the ticked people cannot absorb · UNASSIGNED = nobody is ticked Yes for it yet', fill: GAP_FILL, font: RED_BOLD }
      ];
      if (model.hasEstimates) {
        legend.push({ text: '"(ESTIMATE)" = project not sized yet; HC comes from a forecast bucket curve x complexity. People: where Yes is ticked, the estimate is placed on those people only and follows their room (it is cut to fit when they are short, and grows into their free room when they have more; see the ESTIMATES CUT / GREW rows). With no ticks: people who usually work on projects of the same bucket, then anyone with spare capacity; HC nobody has capacity for shows as hiring gap. Replaced when a real sizing is submitted', fill: FC_FILL, font: FC_FONT });
      }
      if (model.flexed && model.flexed.length) {
        legend.push({ text: `"(adjusted)" = the approved sizing of this project was moved / extended / scaled by a project adjustment, applied live (nothing is hard-coded; change or reset it any time). Adjusted: ${model.flexed.join(', ')}`, fill: FC_FILL, font: FC_FONT });
      }
      if (model.excluded.length) {
        legend.push({ text: `Left out of this output by the manager (still in the matrix and views): ${model.excluded.map(p => p.name).join(', ')}. Person totals and gaps above exclude them.`, fill: SUM_FILL, font: RED_BOLD });
      }
      legend.forEach(l => {
        const row = ws.getRow(dr++);
        const c = row.getCell(COL_NAME);
        c.value = l.text; c.fill = l.fill; c.font = l.font;
        ws.mergeCells(row.number, COL_NAME, row.number, COL_DATA + 9);
      });
    }

    ws.getColumn(1).width = 32; ws.getColumn(2).width = 7;
    for (let i = 0; i < periods.length; i++) ws.getColumn(COL_DATA + i).width = format === 'weekly' ? 5 : 7;
    ws.views = [{ state: 'frozen', xSplit: 2, ySplit: 2 }];

    const safe = s => String(s || '').replace(/[^A-Za-z0-9_-]+/g, '_');
    const fname = `Assignment_${format}_${safe(manager_name) || 'AllTeams'}_${quarters[0].label.replace(' ', '')}-${quarters[quarters.length - 1].label.replace(' ', '')}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('GET /allocation/export error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── FORECAST ENGINE ──────────────────────────────────────────────────────────
// GET /api/allocation/forecast?manager_name=Fan,+Fai&quarters_ahead=20
// Returns precomputed weighted-average forecast per person, per project, team aggregate
// Computation: weighted rolling avg of last 8 actual quarters → 20 projected quarters ahead

router.get('/forecast', async (req, res) => {
  try {
    const { manager_name, quarters_ahead = 20, lookback = 8 } = req.query;
    const aheadN = parseInt(quarters_ahead);
    const lookbackN = parseInt(lookback);

    // ── Helper: quarter label utilities ──────────────────────────────────────
    const toLabel = (fy, q) => `Q${q} FY${String(fy).slice(-2)}`;
    const parseLabel = (label) => {
      const m = label.match(/Q(\d) FY(\d{2})/);
      return m ? { fy: 2000 + parseInt(m[2]), q: parseInt(m[1]) } : null;
    };
    const addQuarters = (fy, q, n) => {
      let total = (fy * 4 + q - 1) + n;
      return { fy: Math.floor(total / 4), q: (total % 4) + 1 };
    };

    // Current quarter
    const now = new Date();
    const curFY = now.getFullYear();
    const curQ = Math.ceil((now.getMonth() + 1) / 3);

    // ── Load team members ─────────────────────────────────────────────────────
    let personFilter = 'WHERE p.is_active = 1';
    let personParams = [];
    if (manager_name && manager_name !== 'all') {
      personFilter = 'WHERE p.is_active = 1 AND p.reporting_manager = ?';
      personParams = [manager_name];
    }
    const [people] = await pool.query(
      `SELECT person_id, display_name, designation, location FROM RA_people p ${personFilter} ORDER BY display_name`,
      personParams
    );
    if (!people.length) {
      return res.json({ success: true, data: {
        team_size: 0, current_quarter: toLabel(curFY, curQ), actual_quarters: [], projected_quarters: [],
        people: [], projects: [], team: { actual: {}, forecast: {}, actual_ss: {}, forecast_ss: {}, pattern: 'stable', sparkline_actual: [], sparkline_forecast: [] }
      } });
    }

    const personIds = people.map(p => p.person_id);

    // ── Load all effort records for team ─────────────────────────────────────
    const [effortRows] = await pool.query(`
      SELECT e.person_id, e.project_id, e.fiscal_year, e.quarter, e.effort_hc,
             proj.project_name, proj.BU, proj.retro_category
      FROM RA_person_project_effort e
      JOIN RA_projects proj ON proj.project_id = e.project_id
      WHERE e.person_id IN (${personIds.map(() => '?').join(',')})
      ORDER BY e.fiscal_year, e.quarter
    `, personIds);

    // Steady-state rows: flagged by retro_category or by matching a configured SS task name
    const [ssTaskRows] = await pool.query(`SELECT task_name FROM RA_steady_state_tasks`);
    const normName = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const ssNameSet = new Set(ssTaskRows.map(t => normName(t.task_name)));
    const isSsRow = r => r.retro_category === 'ss_task' || ssNameSet.has(normName(r.project_name));

    // ── Weighted rolling average ──────────────────────────────────────────────
    // Weights: most recent quarter = weight N, oldest = weight 1
    const weightedAvg = (values) => {
      if (!values.length) return 0;
      const n = values.length;
      let sumW = 0, sumWV = 0;
      values.forEach((v, i) => { const w = i + 1; sumW += w; sumWV += w * v; });
      return sumWV / sumW;
    };

    // ── Detect pattern: flat | ramp_up | ramp_down ───────────────────────────
    const detectPattern = (values) => {
      if (values.length < 3) return 'stable';
      const first = values.slice(0, Math.floor(values.length / 2));
      const last = values.slice(Math.floor(values.length / 2));
      const avgFirst = first.reduce((a, b) => a + b, 0) / first.length;
      const avgLast = last.reduce((a, b) => a + b, 0) / last.length;
      const delta = avgLast - avgFirst;
      if (Math.abs(delta) < 0.05) return 'stable';
      return delta > 0 ? 'ramp_up' : 'ramp_down';
    };

    // ── Build projected quarter labels ────────────────────────────────────────
    const projectedQuarters = [];
    for (let i = 0; i < aheadN; i++) {
      const { fy, q } = addQuarters(curFY, curQ, i);
      projectedQuarters.push(toLabel(fy, q));
    }

    // ── Per-person per-project actual + forecast ──────────────────────────────
    const personMap = {};
    for (const person of people) {
      personMap[person.person_id] = {
        person_id: person.person_id,
        display_name: person.display_name,
        designation: person.designation,
        location: person.location,
        projects: {},   // project_id → { name, BU, actual: {quarter→hc}, forecast: {quarter→hc}, pattern }
        total_actual: {},   // quarter → total hc
        total_forecast: {}, // quarter → projected hc
        pattern: 'stable',
        dominant_project: null,
      };
    }

    // Populate actual effort
    for (const row of effortRows) {
      const p = personMap[row.person_id];
      if (!p) continue;
      const label = toLabel(row.fiscal_year, row.quarter);
      if (!p.projects[row.project_id]) {
        p.projects[row.project_id] = { project_id: row.project_id, project_name: row.project_name, BU: row.BU, is_ss: isSsRow(row), actual: {}, forecast: {} };
      }
      p.projects[row.project_id].actual[label] = (p.projects[row.project_id].actual[label] || 0) + parseFloat(row.effort_hc || 0);
      p.total_actual[label] = (p.total_actual[label] || 0) + parseFloat(row.effort_hc || 0);
    }

    // Build sorted actual quarter list
    const allActualLabels = [...new Set(effortRows.map(r => toLabel(r.fiscal_year, r.quarter)))]
      .sort((a, b) => { const pa = parseLabel(a), pb = parseLabel(b); return (pa.fy * 4 + pa.q) - (pb.fy * 4 + pb.q); });

    // Compute forecast per person per project
    for (const person of Object.values(personMap)) {
      // Total trend pattern
      const totalSeries = allActualLabels.map(l => person.total_actual[l] || 0).filter(v => v > 0);
      person.pattern = detectPattern(totalSeries);

      // Find dominant project (most HC)
      let maxHC = 0;
      for (const proj of Object.values(person.projects)) {
        const tot = Object.values(proj.actual).reduce((s, v) => s + v, 0);
        if (tot > maxHC) { maxHC = tot; person.dominant_project = proj.project_name; }
      }

      // Forecast per project
      for (const proj of Object.values(person.projects)) {
        // Use last N actual quarters as lookback
        const recentLabels = allActualLabels.slice(-lookbackN);
        const recentValues = recentLabels.map(l => proj.actual[l] || 0);
        const avg = weightedAvg(recentValues);

        // Project forward
        for (const ql of projectedQuarters) {
          proj.forecast[ql] = Math.round(avg * 100) / 100;
        }
      }

      // Total forecast
      for (const ql of projectedQuarters) {
        person.total_forecast[ql] = Math.round(
          Object.values(person.projects).reduce((s, proj) => s + (proj.forecast[ql] || 0), 0) * 100
        ) / 100;
      }
    }

    // ── Team aggregate ────────────────────────────────────────────────────────
    const teamActual = {};
    const teamForecast = {};
    const teamActualSs = {};    // steady-state portion only
    const teamForecastSs = {};
    const projectAggregate = {}; // project_name → { actual:{}, forecast:{} }

    for (const person of Object.values(personMap)) {
      for (const [q, hc] of Object.entries(person.total_actual)) {
        teamActual[q] = (teamActual[q] || 0) + hc;
      }
      for (const [q, hc] of Object.entries(person.total_forecast)) {
        teamForecast[q] = (teamForecast[q] || 0) + hc;
      }
      for (const proj of Object.values(person.projects)) {
        if (proj.is_ss) {
          for (const [q, hc] of Object.entries(proj.actual)) teamActualSs[q] = (teamActualSs[q] || 0) + hc;
          for (const [q, hc] of Object.entries(proj.forecast)) teamForecastSs[q] = (teamForecastSs[q] || 0) + hc;
        }
        if (!projectAggregate[proj.project_name]) {
          projectAggregate[proj.project_name] = { project_name: proj.project_name, BU: proj.BU, is_ss: !!proj.is_ss, actual: {}, forecast: {} };
        }
        for (const [q, hc] of Object.entries(proj.actual)) {
          projectAggregate[proj.project_name].actual[q] = (projectAggregate[proj.project_name].actual[q] || 0) + hc;
        }
        for (const [q, hc] of Object.entries(proj.forecast)) {
          projectAggregate[proj.project_name].forecast[q] = (projectAggregate[proj.project_name].forecast[q] || 0) + hc;
        }
      }
    }

    // Team pattern
    const teamSeries = allActualLabels.map(l => teamActual[l] || 0);
    const teamPattern = detectPattern(teamSeries);

    res.json({
      success: true,
      data: {
        team_size: people.length,                       // capacity = team_size × 1.0 HC per quarter
        current_quarter: toLabel(curFY, curQ),
        actual_quarters: allActualLabels,
        projected_quarters: projectedQuarters,
        people: Object.values(personMap).map(p => ({
          ...p,
          projects: Object.values(p.projects)
        })),
        projects: Object.values(projectAggregate),
        team: {
          actual: teamActual,
          forecast: teamForecast,
          actual_ss: teamActualSs,
          forecast_ss: teamForecastSs,
          pattern: teamPattern,
          sparkline_actual: allActualLabels.slice(-12).map(l => teamActual[l] || 0),
          sparkline_forecast: projectedQuarters.slice(0, 8).map(l => teamForecast[l] || 0),
        }
      }
    });
  } catch (err) {
    console.error('GET /allocation/forecast error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
