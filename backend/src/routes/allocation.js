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

    // Build result per project
    const result = projects.map(proj => {
      const projElig = eligibility.filter(e => e.project_id === proj.project_id);
      const experts = projElig.filter(e => e.capability === 'expert');
      const capable = projElig.filter(e => e.capability === 'capable');

      let assigned = [], status = 'gap';
      if (experts.length > 0) {
        status = 'covered';
        const hcPer = Math.round((proj.total_sized_hc / experts.length) * 10) / 10;
        assigned = experts.map(e => ({ ...e, allocated_hc: hcPer, assignment_type: 'expert' }));
        if (capable.length > 0) {
          assigned.push(...capable.map(e => ({ ...e, allocated_hc: 0, assignment_type: 'standby' })));
        }
      } else if (capable.length > 0) {
        status = 'fallback';
        const hcPer = Math.round((proj.total_sized_hc / capable.length) * 10) / 10;
        assigned = capable.map(e => ({ ...e, allocated_hc: hcPer, assignment_type: 'fallback' }));
      }

      return { ...proj, assigned, status, experts_count: experts.length, capable_count: capable.length };
    });

    res.json({ success: true, data: result });
  } catch (err) {
    console.error('GET /allocation/summary error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
