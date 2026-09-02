const express = require('express');
const router = express.Router();
const pool = require('../db/connection');

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

// POST /api/allocation/eligibility — upsert a single eligibility record
router.post('/eligibility', async (req, res) => {
  try {
    const { person_id, project_id, capability, set_by } = req.body;
    if (!person_id || !project_id) return res.status(400).json({ success: false, error: 'person_id and project_id required' });

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
router.post('/eligibility/bulk', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const { records, set_by } = req.body; // records: [{person_id, project_id, capability}]

    for (const r of records) {
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
            AND v2.version_id = (
              SELECT MAX(v3.version_id) FROM RA_sizing_versions v3
              WHERE v3.project_id = p.project_id
            )
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

      return { ...proj, assigned, status, eligible_count: eligible.length };
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
        AND v.version_id = (
          SELECT MAX(v2.version_id) FROM RA_sizing_versions v2
          WHERE v2.project_id = p.project_id
        )
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

    // All unique quarters across all projects
    const quarterSet = new Set(demandRows.map(r => toQLabel(r.fiscal_year, r.quarter)));
    const parse = (s) => { const m = s.match(/Q(\d) FY(\d{2})/); return m ? parseInt(m[2]) * 4 + parseInt(m[1]) : 0; };
    const allQuarters = [...quarterSet].sort((a, b) => parse(a) - parse(b));

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
          // Use fine-tune override if available
          const overrideKey = `${p.person_id}:${pid}:${q}`;
          let hc = effortOverrideMap[overrideKey] || 0;

          if (!hc && mgrAllotment > 0) {
            // Fallback: manager's allotment ÷ number of eligible team members
            hc = Math.round((mgrAllotment / Math.max(eligiblePeople.length, 1)) * 100) / 100;
          }

          if (hc > 0) {
            supply += hc;
            if (!assignments[p.person_id]) assignments[p.person_id] = {};
            if (!assignments[p.person_id][q]) {
              assignments[p.person_id][q] = {
                project_id: parseInt(pid),
                project_name: projectMeta[pid]?.project_name,
                hc: Math.round(hc * 10) / 10,
                capability: eligMap[p.person_id]?.[pid]
              };
            }
            projAssigned.push({ person_id: p.person_id, display_name: p.display_name, hc });
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
    const [rows] = await pool.query(`
      SELECT sq.fiscal_year, sq.quarter, SUM(sq.headcount) AS hc
      FROM RA_sizing_versions v
      JOIN RA_staging_headcount sh ON sh.version_id = v.version_id
      JOIN RA_staging_quarterly sq ON sq.staging_id = sh.staging_id AND sq.headcount > 0
      WHERE v.project_id = ?
        AND v.version_id = (
          SELECT MAX(v2.version_id) FROM RA_sizing_versions v2 WHERE v2.project_id = ?
        )
      GROUP BY sq.fiscal_year, sq.quarter
      ORDER BY sq.fiscal_year, sq.quarter
    `, [project_id, project_id]);
    const quarters = rows.map(r => ({
      quarter: `Q${r.quarter} FY${String(r.fiscal_year).slice(-2)}`,
      hc: Math.round(Number(r.hc) * 10) / 10
    }));
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
        AND v.version_id = (
          SELECT MAX(v2.version_id) FROM RA_sizing_versions v2
          WHERE v2.project_id = p.project_id
        )
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
        ON DUPLICATE KEY UPDATE effort_hc = VALUES(effort_hc), set_by = VALUES(set_by), set_at = NOW()
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
          ON DUPLICATE KEY UPDATE effort_hc = VALUES(effort_hc), set_by = VALUES(set_by), set_at = NOW()
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
      personFilter = 'AND p.reporting_manager = ?';
      params = [manager_name];
    }

    // Get all people
    const [people] = await pool.query(`
      SELECT person_id, display_name, designation, location, reporting_manager
      FROM RA_people WHERE is_active = 1 ${personFilter}
      ORDER BY display_name
    `, params);

    // Get all effort overrides
    const [efforts] = await pool.query(`
      SELECT e.person_id, e.project_id, e.fiscal_year, e.quarter, e.effort_hc,
             proj.project_name
      FROM RA_person_project_effort e
      JOIN RA_projects proj ON proj.project_id = e.project_id
    `);

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
        if (!byQuarter[q]) byQuarter[q] = { allocated: 0, projects: [] };
        byQuarter[q].allocated += Number(e.effort_hc);
        byQuarter[q].projects.push({ name: e.project_name, hc: Number(e.effort_hc) });
      }

      const quarters = Object.entries(byQuarter).map(([quarter, data]) => ({
        quarter,
        allocated: Math.round(data.allocated * 100) / 100,
        gap: Math.round((1.0 - data.allocated) * 100) / 100,
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

// ─── ASSIGNMENT EXPORT ────────────────────────────────────────────────────────
// GET /api/allocation/export?manager_name=Fan,+Fai&format=monthly|weekly
router.get('/export', async (req, res) => {
  try {
    const ExcelJS = require('exceljs');
    const { manager_name, format = 'monthly' } = req.query;

    const Q_MONTHS = { 'Q1':['Feb','Mar','Apr'], 'Q2':['May','Jun','Jul'], 'Q3':['Aug','Sep','Oct'], 'Q4':['Nov','Dec','Jan'] };
    const toQL = (fy, q) => `Q${q} FY${String(fy).slice(-2)}`;

    // ── Load people ──────────────────────────────────────────────────────────
    let pf = 'WHERE p.is_active = 1', pp = [];
    if (manager_name && manager_name !== 'all') { pf = 'WHERE p.is_active = 1 AND p.reporting_manager = ?'; pp = [manager_name]; }
    const [people] = await pool.query(`SELECT person_id, display_name, location, reporting_manager FROM RA_people p ${pf} ORDER BY display_name`, pp);
    const pids = people.map(p => p.person_id);
    if (!pids.length) return res.status(404).json({ success: false, error: 'No people found' });
    const pidPh = pids.map(() => '?').join(',');

    // ── Load project eligibility ─────────────────────────────────────────────
    const [elig] = await pool.query(`
      SELECT e.person_id, e.project_id, proj.project_name
      FROM RA_resource_eligibility e
      JOIN RA_projects proj ON proj.project_id = e.project_id
      WHERE e.person_id IN (${pidPh}) AND (e.capability='yes' OR e.capability='expert')
        AND proj.status NOT IN ('cancelled','closed') AND (proj.is_test=0 OR proj.is_test IS NULL)
    `, pids);

    // ── Load fine-tune effort overrides ──────────────────────────────────────
    const [effortRows] = await pool.query(`
      SELECT person_id, project_id, fiscal_year, quarter, effort_hc
      FROM RA_person_project_effort WHERE person_id IN (${pidPh})
    `, pids);
    const effortMap = {};
    effortRows.forEach(r => { effortMap[`${r.person_id}:${r.project_id}:${toQL(r.fiscal_year, r.quarter)}`] = Number(r.effort_hc); });

    // ── Load manager allotments — try both name formats ──────────────────────
    // "Fan, Fai" → "Fai Fan" and vice versa
    let name1 = manager_name || '';
    let name2 = name1;
    if (name1.includes(',')) {
      const parts = name1.split(',').map(s => s.trim());
      name2 = `${parts[1]} ${parts[0]}`;
    } else if (name1.includes(' ')) {
      const parts = name1.split(' ');
      name2 = `${parts[parts.length-1]}, ${parts.slice(0,-1).join(' ')}`;
    }
    // Load allotments per manager_name — so each person uses their own manager's allotment
    // Map: "manager_name:project_id:quarter" → allotment HC
    const [allotAll] = await pool.query(`
      SELECT sh.manager_name, v.project_id, sq.fiscal_year, sq.quarter, SUM(sq.headcount) AS allotment
      FROM RA_staging_headcount sh
      JOIN RA_staging_quarterly sq ON sq.staging_id = sh.staging_id AND sq.headcount > 0
      JOIN RA_sizing_versions v ON v.version_id = sh.version_id
      JOIN RA_projects p ON p.project_id = v.project_id
      WHERE sh.manager_name IS NOT NULL AND sh.manager_name != ''
        AND (p.is_test = 0 OR p.is_test IS NULL)
      GROUP BY sh.manager_name, v.project_id, sq.fiscal_year, sq.quarter
    `);
    // Also build a person → reporting_manager map
    const personMgrMap = {};
    people.forEach(p2 => { personMgrMap[p2.person_id] = p2.reporting_manager; });

    const allotByMgr = {}; // "mgr:project_id:quarter" → hc
    allotAll.forEach(r => {
      allotByMgr[`${r.manager_name}:${r.project_id}:${toQL(r.fiscal_year, r.quarter)}`] = Number(r.allotment);
    });

    // Helper: get allotment for a person on a project for a quarter
    // Uses their reporting_manager to find the right allotment slice
    function getAllotment(personId, projectId, qLabel) {
      const mgr = personMgrMap[personId] || '';
      // Try both name formats
      let allot = allotByMgr[`${mgr}:${projectId}:${qLabel}`] || 0;
      if (!allot) {
        // Flip name format
        let mgr2 = mgr;
        if (mgr.includes(',')) { const p = mgr.split(',').map(s=>s.trim()); mgr2=`${p[1]} ${p[0]}`; }
        else if (mgr.includes(' ')) { const p=mgr.split(' '); mgr2=`${p[p.length-1]}, ${p.slice(0,-1).join(' ')}`; }
        allot = allotByMgr[`${mgr2}:${projectId}:${qLabel}`] || 0;
      }
      return allot;
    }

    // Keep allotMap for backward compat (used in getSsForQuarter)
    const allotMap = {};

    // ── Load SS eligibility (which tasks each person can work on) ────────────
    const [ssElig] = await pool.query(`
      SELECT e.person_id, e.task_id, t.task_name
      FROM RA_steady_state_eligibility e
      JOIN RA_steady_state_tasks t ON t.task_id = e.task_id
      WHERE e.person_id IN (${pidPh})
    `, pids);

    // ── Build quarter range (earliest data → Q4 FY28) ────────────────────────
    const parseQ = s => { const m = s.match(/Q(\d) FY(\d{2})/); return m ? parseInt(m[2])*4+parseInt(m[1]) : 0; };
    const allQs = [...Object.keys(allotMap).map(k=>k.split(':')[1]), ...Object.keys(effortMap).map(k=>k.split(':')[2])].filter(Boolean);
    const minQLabel = allQs.length ? allQs.sort((a,b)=>parseQ(a)-parseQ(b))[0] : 'Q3 FY26';
    const quarters = [];
    let [cq, cfy] = [parseInt(minQLabel[1]), 2000+parseInt(minQLabel.split('FY')[1])];
    while (true) {
      quarters.push({ q: cq, fy: cfy, label: toQL(cfy, cq) });
      if (cq === 4 && cfy === 2028) break;
      cq++; if (cq > 4) { cq = 1; cfy++; }
      if (cfy > 2035) break;
    }

    // ── Build month/week periods ─────────────────────────────────────────────
    const periods = [];
    if (format === 'monthly') {
      quarters.forEach(({ q, fy, label }) => {
        Q_MONTHS[`Q${q}`].forEach(m => periods.push({ col: m, quarter: label }));
      });
    } else {
      quarters.forEach(({ q, fy, label }) => {
        const months = Q_MONTHS[`Q${q}`];
        let wk = 1;
        months.forEach((m, mi) => {
          for (let w = 0; w < (mi < 2 ? 4 : 5); w++) periods.push({ col: `W${wk++} ${m}`, quarter: label });
        });
      });
    }

    // ── Dynamic SS computation per person per quarter ────────────────────────
    function getSsForQuarter(personId, qLabel) {
      const eligCount = elig.filter(e => e.person_id === personId).length;
      const projHc = elig.filter(e => e.person_id === personId).reduce((s, e) => {
        const override = effortMap[`${personId}:${e.project_id}:${qLabel}`];
        const allot = allotMap[`${e.project_id}:${qLabel}`] || 0;
        return s + (override !== undefined ? override : (allot > 0 ? Math.round(allot / Math.max(elig.filter(x=>x.project_id===e.project_id).length,1)*1000)/1000 : 0));
      }, 0);
      const remaining = Math.max(0, Math.round((1.0 - projHc) * 1000) / 1000);
      const ssTasks = ssElig.filter(e => e.person_id === personId);
      const perTask = ssTasks.length ? Math.round(remaining / ssTasks.length * 1000) / 1000 : 0;
      return { projHc: Math.round(projHc*1000)/1000, remaining, perTask, ssTasks };
    }

    function getProjHcForQuarter(personId, projectId, qLabel) {
      // Use fine-tune override if available
      const override = effortMap[`${personId}:${projectId}:${qLabel}`];
      if (override !== undefined) return override;
      // Use person's manager allotment ÷ their manager's eligible count
      const mgr = personMgrMap[personId] || '';
      const allot = getAllotment(personId, projectId, qLabel);
      if (!allot) return 0;
      // Count eligible people under the same manager for this project
      const mgrPeople = people.filter(p2 => p2.reporting_manager === mgr).map(p2 => p2.person_id);
      const eligCount = elig.filter(e => e.project_id === projectId && mgrPeople.includes(e.person_id)).length || 1;
      return Math.round(allot / eligCount * 1000) / 1000;
    }

    // ── Build Excel ──────────────────────────────────────────────────────────
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(format === 'monthly' ? 'Monthly View' : 'Weekly View');

    const QTR_FILL    = { type:'pattern', pattern:'solid', fgColor:{ argb:'FF1A1A2E' } };
    const MON_FILL    = { type:'pattern', pattern:'solid', fgColor:{ argb:'FF2D2D4E' } };
    const PERSON_FILL = { type:'pattern', pattern:'solid', fgColor:{ argb:'FFE8F0FE' } };
    const PROJ_FILL   = { type:'pattern', pattern:'solid', fgColor:{ argb:'FFFFFFFF' } };
    const SS_FILL     = { type:'pattern', pattern:'solid', fgColor:{ argb:'FFFFF8E1' } };
    const HC_FILL     = { type:'pattern', pattern:'solid', fgColor:{ argb:'FFFFF176' } };
    const WHITE_FONT  = { name:'Arial', bold:true, color:{ argb:'FFFFFFFF' }, size:9 };
    const DARK_FONT   = { name:'Arial', size:9 };
    const BOLD_FONT   = { name:'Arial', bold:true, size:9 };
    const COL_NAME=1, COL_TYPE=2, COL_DATA=3;

    // Row 1: Quarter spanning headers
    const qtrRow = ws.getRow(1);
    qtrRow.getCell(COL_NAME).value='Resource Name'; qtrRow.getCell(COL_NAME).font=WHITE_FONT; qtrRow.getCell(COL_NAME).fill=QTR_FILL;
    qtrRow.getCell(COL_TYPE).value='Details';       qtrRow.getCell(COL_TYPE).font=WHITE_FONT; qtrRow.getCell(COL_TYPE).fill=QTR_FILL;
    const qtrGroups = {};
    periods.forEach((p,i) => { if(!qtrGroups[p.quarter]) qtrGroups[p.quarter]={s:i,e:i}; else qtrGroups[p.quarter].e=i; });
    quarters.forEach(({q,fy,label}) => {
      const g = qtrGroups[label]; if(!g) return;
      const s=COL_DATA+g.s, e=COL_DATA+g.e;
      if(s<e) ws.mergeCells(1,s,1,e);
      qtrRow.getCell(s).value=`Qtr ${q}, ${fy}`;
      for(let c=s;c<=e;c++){ qtrRow.getCell(c).fill=QTR_FILL; qtrRow.getCell(c).font=WHITE_FONT; qtrRow.getCell(c).alignment={horizontal:'center',vertical:'middle'}; qtrRow.getCell(c).border={right:{style:'medium',color:{argb:'FF5588AA'}}}; }
    });
    qtrRow.height=22;

    // Row 2: Month/week headers
    const monRow = ws.getRow(2);
    monRow.getCell(COL_NAME).fill=MON_FILL; monRow.getCell(COL_TYPE).fill=MON_FILL;
    periods.forEach((p,i) => { const c=monRow.getCell(COL_DATA+i); c.value=p.col; c.font=WHITE_FONT; c.fill=MON_FILL; c.alignment={horizontal:'center',textRotation:format==='weekly'?90:0}; });
    monRow.height=16;

    // Data rows
    let dr=3;
    for (const person of people) {
      const projElig = elig.filter(e => e.person_id === person.person_id);
      const ssTasks  = ssElig.filter(e => e.person_id === person.person_id);
      if (!projElig.length && !ssTasks.length) continue;

      // Person aggregate row
      const pRow = ws.getRow(dr++);
      pRow.getCell(COL_NAME).value=person.display_name; pRow.getCell(COL_NAME).font=BOLD_FONT; pRow.getCell(COL_NAME).fill=PERSON_FILL;
      pRow.getCell(COL_TYPE).value='Work'; pRow.getCell(COL_TYPE).font=DARK_FONT; pRow.getCell(COL_TYPE).fill=PERSON_FILL;
      periods.forEach((p,i) => {
        const {projHc,remaining} = getSsForQuarter(person.person_id, p.quarter);
        const total = Math.round((projHc+remaining)*1000)/1000;
        const c = pRow.getCell(COL_DATA+i);
        c.value=total>0?total:''; c.font=BOLD_FONT; c.fill=PERSON_FILL; c.alignment={horizontal:'center'}; c.numFmt='0.00';
      });
      pRow.height=17;

      // Project sub-rows
      for (const e of projElig) {
        const row = ws.getRow(dr++);
        row.getCell(COL_NAME).value=`    ${e.project_name}`; row.getCell(COL_NAME).font=DARK_FONT; row.getCell(COL_NAME).fill=PROJ_FILL;
        row.getCell(COL_TYPE).value='Work'; row.getCell(COL_TYPE).font=DARK_FONT;
        periods.forEach((p,i) => {
          const hc = getProjHcForQuarter(person.person_id, e.project_id, p.quarter);
          const c = row.getCell(COL_DATA+i);
          if(hc>0){ c.value=hc; c.fill=HC_FILL; c.numFmt='0.00'; }
          c.font=DARK_FONT; c.alignment={horizontal:'center'};
        });
        row.height=15;
      }

      // SS sub-rows — dynamic remaining per quarter
      for (const ss of ssTasks) {
        const row = ws.getRow(dr++);
        row.getCell(COL_NAME).value=`    ${ss.task_name} [SS]`; row.getCell(COL_NAME).font={...DARK_FONT,italic:true}; row.getCell(COL_NAME).fill=SS_FILL;
        row.getCell(COL_TYPE).value='Work'; row.getCell(COL_TYPE).font=DARK_FONT;
        periods.forEach((p,i) => {
          const {perTask} = getSsForQuarter(person.person_id, p.quarter);
          const c = row.getCell(COL_DATA+i);
          if(perTask>0){ c.value=perTask; c.fill=HC_FILL; c.numFmt='0.00'; }
          c.font={...DARK_FONT,italic:true}; c.alignment={horizontal:'center'};
        });
        row.height=15;
      }
    }

    ws.getColumn(1).width=32; ws.getColumn(2).width=7;
    for(let i=0;i<periods.length;i++) ws.getColumn(COL_DATA+i).width=format==='weekly'?5:5.5;
    ws.views=[{state:'frozen',xSplit:2,ySplit:2}];

    res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition',`attachment; filename="Assignment_${format}_${manager_name||'AllTeams'}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('GET /allocation/export error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
