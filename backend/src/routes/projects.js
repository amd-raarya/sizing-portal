const express = require('express');
const router = express.Router();
const pool = require('../db/connection');

// Elevated roles — see all projects automatically
const ELEVATED_ROLES = ['Senior Manager', 'Technical Business Analyst', 'Director', 'VP'];

// Shared query: projects with Peak HC, Sum HC, Total $ from SINGLE latest version only
const projectsWithStatsQuery = `
  SELECT
    p.project_id, p.project_name, p.project_code, p.BU, p.category,
    p.leader, p.top_level_team, p.status, p.sizing_deadline,
    p.parent_project_id,
    (SELECT pp.project_name FROM RA_projects pp WHERE pp.project_id = p.parent_project_id) AS parent_project_name,
    v.submitted_by, v.version_status, v.submitted_at,
    COALESCE(
      (SELECT SUM(sq2.headcount)
       FROM RA_staging_headcount sh2
       JOIN RA_staging_quarterly sq2 ON sq2.staging_id = sh2.staging_id
       WHERE sh2.version_id = v.version_id), 0) AS sum_hc,
    COALESCE(
      (SELECT SUM(sq_prev.headcount)
       FROM RA_staging_headcount sh_prev
       JOIN RA_staging_quarterly sq_prev ON sq_prev.staging_id = sh_prev.staging_id
       WHERE sh_prev.version_id = (
         SELECT version_id FROM RA_sizing_versions
         WHERE project_id = p.project_id AND version_id < v.version_id
         ORDER BY created_at DESC LIMIT 1
       )), 0) AS prev_sum_hc,
    COALESCE(
      (SELECT MAX(qt.quarter_total)
       FROM (
         SELECT SUM(sq3.headcount) AS quarter_total
         FROM RA_staging_headcount sh3
         JOIN RA_staging_quarterly sq3 ON sq3.staging_id = sh3.staging_id
         WHERE sh3.version_id = v.version_id
         GROUP BY sq3.fiscal_year, sq3.quarter
       ) qt), 0) AS peak_hc,
    COALESCE(
      (SELECT SUM(sq4.headcount * COALESCE(
         r.rate_per_quarter,
         CASE TRIM(LOWER(sh4.location))
           WHEN 'canada'          THEN 30138
           WHEN 'us'              THEN 30138
           WHEN 'usa'             THEN 30138
           WHEN 'india bangalore' THEN 12203
           WHEN 'india hyderabad' THEN 12203
           WHEN 'china shanghai'  THEN 27275
           WHEN 'taiwan'          THEN 24975
           WHEN 'global'          THEN 31000
           ELSE 20000
         END
       ))
       FROM RA_staging_headcount sh4
       JOIN RA_staging_quarterly sq4 ON sq4.staging_id = sh4.staging_id
       LEFT JOIN RA_project_rates r
         ON r.project_id = p.project_id
         AND TRIM(LOWER(r.location)) = TRIM(LOWER(sh4.location))
       WHERE sh4.version_id = v.version_id), 0) AS total_cost
  -- PM names: all assigned PMs comma-separated
  , (SELECT GROUP_CONCAT(u.display_name ORDER BY a.id ASC SEPARATOR ' | ')
     FROM RA_pm_project_access a
     JOIN RA_pm_users u ON u.pm_user_id = a.pm_user_id
     WHERE a.project_id = p.project_id) AS pm_name
  FROM RA_projects p
  LEFT JOIN RA_sizing_versions v ON v.project_id = p.project_id
    AND v.version_id = (
      -- Pick latest version that has actual HC data; fall back to latest if none do
      SELECT COALESCE(
        (SELECT sv2.version_id FROM RA_sizing_versions sv2
         JOIN RA_staging_headcount sh2 ON sh2.version_id = sv2.version_id
         JOIN RA_staging_quarterly sq2 ON sq2.staging_id = sh2.staging_id AND sq2.headcount > 0
         WHERE sv2.project_id = p.project_id
         ORDER BY sv2.version_id DESC LIMIT 1),
        (SELECT sv3.version_id FROM RA_sizing_versions sv3
         WHERE sv3.project_id = p.project_id
         ORDER BY sv3.created_at DESC LIMIT 1)
      )
    )
  ORDER BY p.project_name ASC
`;

// GET /api/projects - return projects based on caller's role
// Query param: pm_user_id (optional) — if provided, filters by access for regular PMs
router.get('/', async (req, res) => {
  try {
    const { pm_user_id } = req.query;

    // If a pm_user_id is provided, check their role first
    if (pm_user_id) {
      const [userRows] = await pool.query(
        `SELECT u.pm_user_id, per.designation
         FROM RA_pm_users u
         LEFT JOIN RA_people per ON u.person_id = per.person_id
         WHERE u.pm_user_id = ?`,
        [pm_user_id]
      );

      // If user has elevated role OR user not found — return ALL projects
      if (!userRows.length || ELEVATED_ROLES.includes(userRows[0]?.designation)) {
        const [rows] = await pool.query(projectsWithStatsQuery);
        return res.json({ success: true, data: rows, access: 'full' });
      }

      // Regular PM — return only their granted projects
      const [rows] = await pool.query(
        `${projectsWithStatsQuery.replace('FROM RA_projects p',
          'FROM RA_projects p JOIN RA_pm_project_access acc ON p.project_id = acc.project_id AND acc.pm_user_id = ?')}`,
        [pm_user_id]
      );
      return res.json({ success: true, data: rows, access: 'restricted' });
    }

    // No pm_user_id — return all projects
    const [rows] = await pool.query(projectsWithStatsQuery);
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('Error fetching projects:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/projects/:id - return a single project
router.get('/:id', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT project_id, project_name, project_code, BU, category, leader,
              top_level_team, platform, status, sizing_deadline, notes,
              parent_project_id, is_techprotect, created_at, updated_at
       FROM RA_projects WHERE project_id = ?`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ success: false, error: 'Project not found' });
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    console.error('Error fetching project:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});
// GET /api/projects/:id/baseline — latest locked/submitted version (approved baseline)
// For CR projects with no submitted version, falls back to parent project's baseline
router.get('/:id/baseline', async (req, res) => {
  try {
    let projectId = req.params.id;

    const [versions] = await pool.query(
      `SELECT version_id FROM RA_sizing_versions
       WHERE project_id = ? AND version_status IN ('locked','submitted','bu_approved')
       ORDER BY created_at DESC LIMIT 1`,
      [projectId]
    );

    // If no submitted version, check if this is a CR — use parent's baseline
    if (!versions.length) {
      const [proj] = await pool.query(
        `SELECT parent_project_id FROM RA_projects WHERE project_id = ?`,
        [projectId]
      );
      if (proj.length > 0 && proj[0].parent_project_id) {
        // Recurse into parent's baseline
        projectId = proj[0].parent_project_id;
        const [parentVersions] = await pool.query(
          `SELECT version_id FROM RA_sizing_versions
           WHERE project_id = ? AND version_status IN ('locked','submitted','bu_approved')
           ORDER BY created_at DESC LIMIT 1`,
          [projectId]
        );
        if (!parentVersions.length) return res.json({ success: true, data: null });
        versions.push(parentVersions[0]);
      } else {
        return res.json({ success: true, data: null });
      }
    }

    const versionId = versions[0].version_id;
    const [rows] = await pool.query(`
      SELECT sh.staging_id, sh.function_contact, sh.location, sh.hc_type,
             sh.scope, sh.assumptions, sh.risks, sh.notes,
             sq.fiscal_year, sq.quarter, sq.headcount
      FROM RA_staging_headcount sh
      LEFT JOIN RA_staging_quarterly sq ON sh.staging_id = sq.staging_id
      WHERE sh.version_id = ?
      ORDER BY sh.staging_id, sq.fiscal_year, sq.quarter
    `, [versionId]);

    const rowMap = new Map();
    rows.forEach(row => {
      if (!rowMap.has(row.staging_id)) {
        rowMap.set(row.staging_id, {
          staging_id: row.staging_id,
          function_contact: row.function_contact || '',
          location: row.location || '',
          hc_type: row.hc_type || '',
          quarters: {}
        });
      }
      if (row.fiscal_year) {
        const label = `Q${row.quarter} FY${String(row.fiscal_year).slice(-2)}`;
        rowMap.get(row.staging_id).quarters[label] = parseFloat(row.headcount);
      }
    });

    res.json({ success: true, data: { version_id: versionId, rows: Array.from(rowMap.values()) } });
  } catch (err) {
    console.error('GET baseline error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/projects/:id/draft — latest draft version for a project
router.get('/:id/draft', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT version_id FROM RA_sizing_versions
       WHERE project_id = ? AND version_status = 'draft'
       ORDER BY created_at DESC LIMIT 1`,
      [req.params.id]
    );
    res.json({ success: true, data: rows.length ? rows[0] : null });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/projects/:id/versions — create a new draft version
router.post('/:id/versions', async (req, res) => {
  try {
    const [result] = await pool.query(
      `INSERT INTO RA_sizing_versions (project_id, version_status, is_current) VALUES (?, 'draft', 0)`,
      [req.params.id]
    );
    res.json({ success: true, data: { version_id: result.insertId } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
// GET /api/projects/summary/budget — real budget totals per status for landing page tiles
router.get('/summary/budget', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT
        p.project_id, p.project_name, p.status,
        COALESCE(SUM(
          sq.headcount * COALESCE(
            r.rate_per_quarter,
            CASE TRIM(LOWER(sh.location))
              WHEN 'canada'           THEN 30138
              WHEN 'us'               THEN 30138
              WHEN 'usa'              THEN 30138
              WHEN 'india bangalore'  THEN 12203
              WHEN 'india hyderabad'  THEN 12203
              WHEN 'china shanghai'   THEN 27275
              WHEN 'taiwan'           THEN 24975
              WHEN 'global'           THEN 31000
              ELSE 20000
            END
          )
        ), 0) AS total_cost
      FROM RA_projects p
      LEFT JOIN RA_sizing_versions v ON v.version_id = (
        SELECT COALESCE(
          (SELECT sv2.version_id FROM RA_sizing_versions sv2
           JOIN RA_staging_headcount sh2 ON sh2.version_id = sv2.version_id
           JOIN RA_staging_quarterly sq2 ON sq2.staging_id = sh2.staging_id AND sq2.headcount > 0
           WHERE sv2.project_id = p.project_id
           ORDER BY sv2.version_id DESC LIMIT 1),
          (SELECT sv3.version_id FROM RA_sizing_versions sv3
           WHERE sv3.project_id = p.project_id
           ORDER BY sv3.created_at DESC LIMIT 1)
        )
      )
      LEFT JOIN RA_staging_headcount sh ON sh.version_id = v.version_id
      LEFT JOIN RA_staging_quarterly sq ON sq.staging_id = sh.staging_id AND sq.headcount > 0
      LEFT JOIN RA_project_rates r ON r.project_id = p.project_id AND TRIM(LOWER(r.location)) = TRIM(LOWER(sh.location))
      GROUP BY p.project_id, p.project_name, p.status
    `);

    const summary = {};
    let grandTotal = 0;
    let totalProjects = rows.length;

    rows.forEach(row => {
      const s = row.status || 'unknown';
      if (!summary[s]) summary[s] = { count: 0, total: 0 };
      summary[s].count++;
      summary[s].total += Number(row.total_cost || 0);
      grandTotal += Number(row.total_cost || 0);
    });

    res.json({ success: true, data: { summary, grandTotal, totalProjects } });
  } catch (err) {
    console.error('GET /projects/summary/budget error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/projects/meta — dropdown data for New Project form
router.get('/meta/form', async (req, res) => {
  try {
    // All active PM users for assignment dropdown
    const [pmUsers] = await pool.query(
      `SELECT u.pm_user_id, u.display_name, u.email, p.alias_email, p.designation
       FROM RA_pm_users u
       LEFT JOIN RA_people p ON u.person_id = p.person_id
       WHERE u.is_active = 1
       ORDER BY u.display_name ASC`
    );

    // All projects for parent CR dropdown
    const [projects] = await pool.query(
      `SELECT project_id, project_name, project_code, status
       FROM RA_projects
       ORDER BY project_name ASC`
    );

    res.json({ success: true, data: { pmUsers, projects } });
  } catch (err) {
    console.error('GET /projects/meta/form error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/projects — create a new project
router.post('/', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const {
      project_name, project_code, BU, category, leader, top_level_team,
      platform = null,
      status = 'pipeline',
      sizing_deadline = null,
      notes = null,
      parent_project_id = null,
      is_techprotect = 0,
      created_by = null,
      // PM assignment
      assigned_pm_user_id = null,    // for elevated users to pick a PM
      auto_assign_pm_user_id = null, // for PM creating their own project
      // MPRS file
      mprs_file_name = null,
      mprs_file_segment = null,
      reporting_manager_id = null,
    } = req.body;

    if (!project_name || !BU || !category || !leader || !top_level_team) {
      return res.status(400).json({ success: false, error: 'Missing required fields: project_name, BU, category, leader, top_level_team' });
    }

    // Resolve created_by email → pm_user_id from RA_pm_users
    let createdByPersonId = null;
    if (created_by) {
      const [pmRows] = await conn.query(
        `SELECT pm_user_id FROM RA_pm_users WHERE LOWER(email) = LOWER(?) LIMIT 1`,
        [created_by]
      );
      if (pmRows.length > 0) {
        createdByPersonId = pmRows[0].pm_user_id;
      } else {
        // User not in pm_users — store null rather than failing
        createdByPersonId = null;
      }
    }

    // 1. Create the project
    const [projectResult] = await conn.query(
      `INSERT INTO RA_projects
        (project_name, project_code, BU, category, leader, top_level_team, platform,
         status, sizing_deadline, notes, parent_project_id, created_by, is_techprotect)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [project_name, project_code, BU, category, leader, top_level_team, platform || null,
       status, sizing_deadline || null, notes || null, parent_project_id || null,
       createdByPersonId, is_techprotect ? 1 : 0]
    );
    const projectId = projectResult.insertId;

    // 2. Auto-assign PM — either the chosen PM or the creator
    const pmToAssign = assigned_pm_user_id || auto_assign_pm_user_id;
    if (pmToAssign) {
      await conn.query(
        `INSERT INTO RA_pm_project_access (pm_user_id, project_id, can_edit, can_submit)
         VALUES (?, ?, 1, 1)
         ON DUPLICATE KEY UPDATE can_edit = 1, can_submit = 1`,
        [pmToAssign, projectId]
      );
    }

    // 3. If Techprotect — grant access to creator automatically
    if (is_techprotect && reporting_manager_id) {
      await conn.query(
        `INSERT IGNORE INTO RA_techprotect_access (project_id, person_id, granted_by)
         VALUES (?, ?, ?)`,
        [projectId, reporting_manager_id, reporting_manager_id]
      );
    }

    // 4. If MPRS file provided — register it
    if (mprs_file_name) {
      await conn.query(
        `INSERT INTO RA_project_allocation_files
          (project_id, reporting_manager_id, allocation_file, file_segment, is_current)
         VALUES (?, ?, ?, ?, 1)`,
        [projectId, reporting_manager_id || null, mprs_file_name, mprs_file_segment || null]
      );
    }

    // 5. If this is a CR project — copy parent's approved sizing as baseline hint
    // (actual baseline load happens on sizing page open via /baseline endpoint)
    // Just record the link in parent_project_id which is already set above

    await conn.commit();
    res.json({
      success: true,
      data: { project_id: projectId, project_name, project_code, status }
    });

  } catch (err) {
    await conn.rollback();
    console.error('POST /projects error:', err.message);
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ success: false, error: 'A project with this name or code already exists' });
    }
    res.status(500).json({ success: false, error: err.message });
  } finally {
    conn.release();
  }
});

// POST /api/projects/:id/rates — save location rates for a project
router.post('/:id/rates', async (req, res) => {
  try {
    const { rates } = req.body; // [{ location, rate_per_quarter }]
    if (!rates || !rates.length) return res.json({ success: true });

    // Delete existing rates for this project and re-insert
    await pool.query(`DELETE FROM RA_project_rates WHERE project_id = ?`, [req.params.id]);

    for (const r of rates) {
      if (r.location && r.rate_per_quarter) {
        await pool.query(
          `INSERT INTO RA_project_rates (project_id, location, rate_per_quarter, currency)
           VALUES (?, ?, ?, 'USD')`,
          [req.params.id, r.location, parseFloat(r.rate_per_quarter)]
        );
      }
    }
    res.json({ success: true });
  } catch (err) {
    console.error('POST /projects/rates error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/projects/:id/rates — get rates for a project
router.get('/:id/rates', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT location, rate_per_quarter FROM RA_project_rates WHERE project_id = ? ORDER BY location`,
      [req.params.id]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PATCH /api/projects/:id — update project details (admin/elevated only)
router.patch('/:id', async (req, res) => {
  try {
    const {
      project_name, project_code, BU, category, leader, top_level_team, platform,
      status, sizing_deadline, notes, parent_project_id, is_techprotect,
      assigned_pm_user_id
    } = req.body;

    await pool.query(
      `UPDATE RA_projects SET
        project_name = COALESCE(?, project_name),
        project_code = COALESCE(?, project_code),
        BU = COALESCE(?, BU),
        category = COALESCE(?, category),
        leader = COALESCE(?, leader),
        top_level_team = COALESCE(?, top_level_team),
        platform = COALESCE(?, platform),
        status = COALESCE(?, status),
        sizing_deadline = COALESCE(?, sizing_deadline),
        notes = ?,
        parent_project_id = ?,
        is_techprotect = COALESCE(?, is_techprotect),
        updated_at = NOW()
       WHERE project_id = ?`,

      [project_name, project_code, BU, category, leader, top_level_team, platform || null,
       status, sizing_deadline || null,
       notes !== undefined ? notes : null,
       parent_project_id !== undefined ? parent_project_id : null,
       is_techprotect !== undefined ? (is_techprotect ? 1 : 0) : null,
       req.params.id]
    );

    // Handle PM reassignment — upsert into RA_pm_project_access
    if (assigned_pm_user_id) {
      await pool.query(
        `INSERT INTO RA_pm_project_access (pm_user_id, project_id, can_edit, can_submit)
         VALUES (?, ?, 1, 1)
         ON DUPLICATE KEY UPDATE can_edit = 1, can_submit = 1`,
        [assigned_pm_user_id, req.params.id]
      );
    }

    res.json({ success: true, data: { project_id: parseInt(req.params.id) } });
  } catch (err) {
    console.error('PATCH /projects/:id error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// PATCH /api/projects/:id/approve — BU approves → project becomes active (Funded)
router.patch('/:id/approve', async (req, res) => {
  try {
    await pool.query(
      `UPDATE RA_projects SET status = 'active', updated_at = NOW() WHERE project_id = ?`,
      [req.params.id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PATCH /api/projects/:id/negotiate — BU wants changes → back to pipeline
router.patch('/:id/negotiate', async (req, res) => {
  try {
    await pool.query(
      `UPDATE RA_projects SET status = 'pipeline', updated_at = NOW() WHERE project_id = ?`,
      [req.params.id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/projects/:id — permanently delete a project and all related data
router.delete('/:id', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const projectId = req.params.id;

    // Delete in correct dependency order
    // 1. Quarterly headcount data
    await conn.query(`
      DELETE sq FROM RA_staging_quarterly sq
      JOIN RA_staging_headcount sh ON sh.staging_id = sq.staging_id
      JOIN RA_sizing_versions v ON v.version_id = sh.version_id
      WHERE v.project_id = ?`, [projectId]);

    // 2. Headcount rows
    await conn.query(`
      DELETE sh FROM RA_staging_headcount sh
      JOIN RA_sizing_versions v ON v.version_id = sh.version_id
      WHERE v.project_id = ?`, [projectId]);

    // 3. Milestones
    await conn.query(`
      DELETE vm FROM RA_version_milestones vm
      JOIN RA_sizing_versions v ON v.version_id = vm.version_id
      WHERE v.project_id = ?`, [projectId]);

    // 4. Versions
    await conn.query(`DELETE FROM RA_sizing_versions WHERE project_id = ?`, [projectId]);

    // 5. Documents, rates, access
    await conn.query(`DELETE FROM RA_project_documents WHERE project_id = ?`, [projectId]);
    await conn.query(`DELETE FROM RA_project_rates WHERE project_id = ?`, [projectId]);
    await conn.query(`DELETE FROM RA_pm_project_access WHERE project_id = ?`, [projectId]);

    // 6. Project itself
    await conn.query(`DELETE FROM RA_projects WHERE project_id = ?`, [projectId]);

    await conn.commit();
    res.json({ success: true });
  } catch (err) {
    await conn.rollback();
    console.error('DELETE /projects/:id error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    conn.release();
  }
});

module.exports = router;