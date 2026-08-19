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

    // Build result per project — simple yes/no eligibility (no expert/capable tiers)
    const result = projects.map(proj => {
      const projElig = eligibility.filter(e => e.project_id === proj.project_id);
      // Accept both 'yes' (new) and legacy 'expert' values
      const eligible = projElig.filter(e => e.capability === 'yes' || e.capability === 'expert');

      let assigned = [], status = 'gap';
      if (eligible.length > 0) {
        status = 'covered';
        const hcPer = Math.round((proj.total_sized_hc / eligible.length) * 10) / 10;
        assigned = eligible.map(e => ({ ...e, allocated_hc: hcPer, assignment_type: 'eligible' }));
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

    // ── 1. Load all active people ────────────────────────────────────────────
    const [people] = await pool.query(`
      SELECT person_id, display_name, designation, location,
             employment_type, reporting_manager, function_area
      FROM RA_people
      WHERE is_active = 1
      ORDER BY display_name
    `);

    // ── 2. Load eligibility matrix ───────────────────────────────────────────
    const [eligibility] = await pool.query(`
      SELECT e.person_id, e.project_id, e.capability
      FROM RA_resource_eligibility e
      JOIN RA_people p ON p.person_id = e.person_id
      WHERE p.is_active = 1
    `);
    // Map: person_id → { project_id → capability }
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

    // ── 6. Assignment algorithm ───────────────────────────────────────────────
    // For each quarter, for each project (sorted by priority desc):
    //   collect eligible available people matching location + type
    //   assign greedily, mark assigned people as used for that quarter

    // Result structures
    const assignments = {}; // { person_id → { quarter → { project_id, hc, type } } }
    const gapByProject = {}; // { project_id → { quarter → { demand, supply, gap } } }

    for (const q of allQuarters) {
      // Track remaining availability this quarter
      const qAvail = {}; // person_id → remaining fraction
      for (const p of people) qAvail[p.person_id] = availMap[p.person_id][q];

      // Sort projects by priority desc
      const projIds = Object.keys(demandMap).sort((a, b) => priorityScore(b, q) - priorityScore(a, q));

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

        // Find eligible available people
        // Type matching: FTE/AOP → employment_type='Full-time', XCHG/CONT → 'Contractor'/'Service Provider'
        const hcTypeToEmpType = (hcType) => {
          if (hcType.includes('FTE') || hcType.includes('AOP')) return ['Full-time', 'FTE'];
          return ['Contractor', 'Service Provider Worker', 'Contingent'];
        };

        let supply = 0;
        const projAssigned = [];

        for (const [hcType, locMap] of Object.entries(demandByType)) {
          for (const [loc, hcNeeded] of Object.entries(locMap)) {
            const empTypes = hcTypeToEmpType(hcType);
            let remaining = hcNeeded;

            // Find eligible people: capability=expert first, then capable
            const candidates = people
              .filter(p => {
                const cap = eligMap[p.person_id]?.[pid];
                return (cap === 'yes' || cap === 'expert') && qAvail[p.person_id] > 0;
              })
              .sort((a, b) => {
                // Prefer location match, then employment type match
                const locA = a.location === loc ? 1 : 0;
                const locB = b.location === loc ? 1 : 0;
                return locB - locA;
              });

            for (const p of candidates) {
              if (remaining <= 0) break;
              const avail = qAvail[p.person_id];
              if (avail <= 0) continue;

              const allocated = Math.min(avail, remaining);
              qAvail[p.person_id] -= allocated;
              supply += allocated;
              remaining -= allocated;

              if (!assignments[p.person_id]) assignments[p.person_id] = {};
              assignments[p.person_id][q] = {
                project_id: parseInt(pid),
                project_name: projectMeta[pid]?.project_name,
                hc: Math.round(allocated * 10) / 10,
                hc_type: hcType,
                capability: eligMap[p.person_id]?.[pid]
              };

              projAssigned.push({ person_id: p.person_id, display_name: p.display_name, hc: allocated, hc_type: hcType });
            }
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
      const byQuarter: Record<string, { allocated: number; projects: {name: string; hc: number}[] }> = {};
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

module.exports = router;
