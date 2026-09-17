const express = require('express');
const router = express.Router();
const pool = require('../db/connection');

// ─── PM USERS ──────────────────────────────────────────────────────────────

// GET /api/admin/users — list all PM users with their person info
router.get('/users', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT u.pm_user_id, u.display_name, u.email, u.is_active, u.is_elevated, u.created_at,
             u.azure_object_id,
             p.designation, p.location, p.function_area, p.top_level_team,
             COUNT(a.id) AS project_count
      FROM RA_pm_users u
      LEFT JOIN RA_people p ON u.person_id = p.person_id
      LEFT JOIN RA_pm_project_access a ON u.pm_user_id = a.pm_user_id
      WHERE p.designation NOT IN (
        'Sr. Director Software Development',
        'Director Software Development',
        'Director',
        'Sr. Manager Software Development',
        'Sr. Manager, Program Management',
        'Senior Manager',
        'Sr. Program Manager',
        'Technical Business Analyst',
        'Sr. Fellow Software Development Eng.',
        'Fellow Software Development Eng.',
        'VP'
      )
      OR p.designation IS NULL
      GROUP BY u.pm_user_id
      ORDER BY u.display_name ASC
    `);
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('GET /admin/users error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/admin/users — create a new PM user
router.post('/users', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const { display_name, email, designation = 'Program Manager', location, top_level_team, function_area, person_id } = req.body;

    if (!display_name || !email)
      return res.status(400).json({ success: false, error: 'display_name and email are required' });

    let personId = person_id || null;

    if (!personId) {
      // Create new person record
      const [personResult] = await conn.query(
        `INSERT INTO RA_people (display_name, email, designation, location, top_level_team, function_area)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [display_name, email, designation, location || null, top_level_team || null, function_area || null]
      );
      personId = personResult.insertId;
    }

    // Create PM user record — links to existing or new RA_people row
    const [userResult] = await conn.query(
      `INSERT INTO RA_pm_users (person_id, display_name, email, is_active)
       VALUES (?, ?, ?, 1)`,
      [personId, display_name, email]
    );

    await conn.commit();
    res.json({ success: true, data: { pm_user_id: userResult.insertId, person_id: personId } });
  } catch (err) {
    await conn.rollback();
    console.error('POST /admin/users error:', err.message);
    if (err.code === 'ER_DUP_ENTRY')
      return res.status(409).json({ success: false, error: 'A user with this email already exists' });
    res.status(500).json({ success: false, error: err.message });
  } finally {
    conn.release();
  }
});

// GET /api/admin/users/by-email?email=... — MUST be before /:id to avoid route conflict
router.get('/users/by-email', async (req, res) => {
  try {
    const { email } = req.query;
    if (!email) return res.status(400).json({ success: false, error: 'email required' });
    const [rows] = await pool.query(`
      SELECT u.pm_user_id, u.display_name, u.email, u.is_active, u.is_elevated,
             p.designation, p.alias_email
      FROM RA_pm_users u
      LEFT JOIN RA_people p ON p.person_id = u.person_id
      WHERE LOWER(u.email) = LOWER(?)
         OR LOWER(p.alias_email) = LOWER(?)
      LIMIT 1
    `, [email, email]);
    if (!rows.length) return res.json({ success: false, error: 'User not found' });
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    console.error('GET /admin/users/by-email error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/admin/users/:id — get single user with role info
router.get('/users/:id', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT u.pm_user_id, u.display_name, u.email, u.is_active,
              p.designation, p.location, p.person_id
       FROM RA_pm_users u
       LEFT JOIN RA_people p ON u.person_id = p.person_id
       WHERE u.pm_user_id = ?`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'User not found' });
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PATCH /api/admin/users/:id/toggle — activate or deactivate a PM user
router.patch('/users/:id/toggle', async (req, res) => {
  try {
    const [current] = await pool.query('SELECT is_active FROM RA_pm_users WHERE pm_user_id = ?', [req.params.id]);
    if (!current.length) return res.status(404).json({ success: false, error: 'User not found' });

    const newStatus = current[0].is_active ? 0 : 1;
    await pool.query('UPDATE RA_pm_users SET is_active = ? WHERE pm_user_id = ?', [newStatus, req.params.id]);
    res.json({ success: true, data: { is_active: newStatus } });
  } catch (err) {
    console.error('PATCH /admin/users/:id/toggle error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── PROJECT ACCESS ─────────────────────────────────────────────────────────

// GET /api/admin/managers — list of reporting managers from RA_people
router.get('/managers', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT DISTINCT display_name
      FROM RA_people
      WHERE reporting_manager IS NOT NULL
        AND is_active = 1
        AND designation IN (
          'Director Software Development',
          'Sr. Director Software Development',
          'Sr. Manager Software Development',
          'Sr. Program Manager',
          'Sr. Manager, Program Management',
          'Manager Software Development',
          'PMTS Software System Design Eng.',
          'PMTS Software Development Eng.',
          'Sr. Fellow Software Development Eng.',
          'Fellow Software Development Eng.'
        )
        AND display_name NOT LIKE '%Arya%'
      ORDER BY display_name ASC
    `);
    res.json({ success: true, data: rows.map((r) => r.display_name) });
  } catch (err) {
    console.error('GET /admin/managers error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/admin/access — all projects with their assigned users
router.get('/access', async (req, res) => {
  try {
    const [projects] = await pool.query(
      'SELECT project_id, project_name, project_code, BU, status, is_test FROM RA_projects ORDER BY project_name ASC'
    );
    const [access] = await pool.query(`
      SELECT a.id, a.pm_user_id, a.project_id, a.can_edit, a.can_submit,
             u.display_name, u.email, u.is_active
      FROM RA_pm_project_access a
      JOIN RA_pm_users u ON a.pm_user_id = u.pm_user_id
      ORDER BY a.project_id, u.display_name
    `);
    res.json({ success: true, data: { projects, access } });
  } catch (err) {
    console.error('GET /admin/access error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/admin/access/:pm_user_id — all access for one PM user
router.get('/access/:pm_user_id', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT a.id, a.project_id, a.can_edit, a.can_submit, a.granted_at,
             p.project_name, p.project_code, p.BU, p.status
      FROM RA_pm_project_access a
      JOIN RA_projects p ON a.project_id = p.project_id
      WHERE a.pm_user_id = ?
      ORDER BY p.project_name ASC
    `, [req.params.pm_user_id]);
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('GET /admin/access/:id error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/admin/access — grant project access
router.post('/access', async (req, res) => {
  try {
    const { pm_user_id, project_id, can_edit = 1, can_submit = 1 } = req.body;
    if (!pm_user_id || !project_id)
      return res.status(400).json({ success: false, error: 'pm_user_id and project_id required' });

    const [result] = await pool.query(
      `INSERT INTO RA_pm_project_access (pm_user_id, project_id, can_edit, can_submit)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE can_edit = VALUES(can_edit), can_submit = VALUES(can_submit)`,
      [pm_user_id, project_id, can_edit, can_submit]
    );
    res.json({ success: true, data: { id: result.insertId } });
  } catch (err) {
    console.error('POST /admin/access error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// PATCH /api/admin/access/:id — update can_edit / can_submit
router.patch('/access/:id', async (req, res) => {
  try {
    const { can_edit, can_submit } = req.body;
    await pool.query(
      'UPDATE RA_pm_project_access SET can_edit = ?, can_submit = ? WHERE id = ?',
      [can_edit ? 1 : 0, can_submit ? 1 : 0, req.params.id]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('PATCH /admin/access/:id error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/admin/access/:id — revoke access
router.delete('/access/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM RA_pm_project_access WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /admin/access/:id error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// PATCH /api/admin/users/:id/elevated — toggle elevated flag directly
router.patch('/users/:id/elevated', async (req, res) => {
  try {
    const { is_elevated } = req.body;
    await pool.query(
      'UPDATE RA_pm_users SET is_elevated = ? WHERE pm_user_id = ?',
      [is_elevated ? 1 : 0, req.params.id]
    );
    res.json({ success: true, data: { is_elevated: is_elevated ? 1 : 0 } });
  } catch (err) {
    console.error('PATCH /admin/users/:id/elevated error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// PATCH /api/admin/people/:id/promote — update designation to Senior Manager
router.patch('/people/:id/promote', async (req, res) => {
  try {
    const { designation } = req.body; // allow custom designation or default to Senior Manager
    await pool.query(
      `UPDATE RA_people SET designation = ? WHERE person_id = ?`,
      [designation || 'Senior Manager', req.params.id]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('PATCH /admin/people/:id/promote error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/admin/people — all people from RA_people for admin matrix
router.get('/people', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT p.person_id, p.display_name, p.email, p.alias_email,
             p.designation, p.location, p.reporting_manager,
             p.employment_type, p.function_area, p.top_level_team,
             u.pm_user_id, u.is_active AS portal_access, u.is_elevated
      FROM RA_people p
      LEFT JOIN RA_pm_users u ON u.person_id = p.person_id
      WHERE p.is_active = 1
      ORDER BY p.display_name ASC
    `);
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('GET /admin/people error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/admin/access/upsert — upsert a single access record (No/Yes/Can Submit)
router.post('/access/upsert', async (req, res) => {
  try {
    const { pm_user_id, project_id, level } = req.body;
    // level: 'none' | 'yes' | 'can_submit'
    if (!pm_user_id || !project_id) return res.status(400).json({ success: false, error: 'pm_user_id and project_id required' });

    if (level === 'none') {
      await pool.query('DELETE FROM RA_pm_project_access WHERE pm_user_id = ? AND project_id = ?', [pm_user_id, project_id]);
    } else {
      const can_edit = 1;
      const can_submit = level === 'can_submit' ? 1 : 0;
      await pool.query(`
        INSERT INTO RA_pm_project_access (pm_user_id, project_id, can_edit, can_submit)
        VALUES (?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE can_edit = VALUES(can_edit), can_submit = VALUES(can_submit)
      `, [pm_user_id, project_id, can_edit, can_submit]);
    }
    res.json({ success: true });
  } catch (err) {
    console.error('POST /admin/access/upsert error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── STEADY STATE TASKS ──────────────────────────────────────────────────────

// GET /api/admin/steady-state-tasks — list all tasks
router.get('/steady-state-tasks', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT task_id, task_code, task_name, total_hc, description,
             color, is_attributable, is_active, created_at
      FROM RA_steady_state_tasks
      WHERE is_active = 1
      ORDER BY task_name ASC
    `);
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('GET /admin/steady-state-tasks error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// PATCH /api/admin/steady-state-tasks/:id — update HC budget (elevated only)
router.patch('/steady-state-tasks/:id', async (req, res) => {
  try {
    const { total_hc, color, is_attributable } = req.body;
    const fields = [];
    const values = [];
    if (total_hc !== undefined) { fields.push('total_hc = ?'); values.push(total_hc); }
    if (color !== undefined)    { fields.push('color = ?');    values.push(color); }
    if (is_attributable !== undefined) { fields.push('is_attributable = ?'); values.push(is_attributable ? 1 : 0); }
    if (!fields.length) return res.status(400).json({ success: false, error: 'Nothing to update' });
    values.push(req.params.id);
    await pool.query(`UPDATE RA_steady_state_tasks SET ${fields.join(', ')} WHERE task_id = ?`, values);
    res.json({ success: true });
  } catch (err) {
    console.error('PATCH /admin/steady-state-tasks error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/admin/org-headcount?root=Jeffrey+Weyman
// Recursively walks the reporting_manager tree from the given root person
// and returns the total count of active ICs (non-managers) in the org.
router.get('/org-headcount', async (req, res) => {
  try {
    const root = req.query.root || 'Weyman, Jeff';

    // Load all active people in one query
    const [rows] = await pool.query(`
      SELECT person_id, display_name, reporting_manager, designation, employment_type, is_active
      FROM RA_people
      WHERE is_active = 1
    `);

    // Build a map: manager_name -> [direct reports]
    const directReports = new Map();
    for (const r of rows) {
      if (!r.reporting_manager) continue;
      if (!directReports.has(r.reporting_manager)) directReports.set(r.reporting_manager, []);
      directReports.get(r.reporting_manager).push(r);
    }

    // BFS from root to get all people in the org tree
    const visited = new Set();
    const queue = [root];
    const orgPeople = [];

    // Include the root person (Jeff) themselves
    const rootPerson = rows.find(r => r.display_name === root);
    if (rootPerson) {
      visited.add(rootPerson.display_name);
      orgPeople.push(rootPerson);
    }

    while (queue.length > 0) {
      const manager = queue.shift();
      const reports = directReports.get(manager) || [];
      for (const person of reports) {
        if (visited.has(person.display_name)) continue;
        visited.add(person.display_name);
        orgPeople.push(person);
        if (directReports.has(person.display_name)) {
          queue.push(person.display_name);
        }
      }
    }

    // Additional people to always include (outside org tree but part of the headcount)
    const additionalNames = ['Li, Bruce']; // update with exact DB name once confirmed
    for (const name of additionalNames) {
      if (!visited.has(name)) {
        const person = rows.find(r => r.display_name === name);
        if (person) {
          visited.add(person.display_name);
          orgPeople.push(person);
        }
      }
    }

    res.json({
      success: true,
      data: {
        root,
        total: orgPeople.length,
        people: orgPeople.map(p => ({ name: p.display_name, designation: p.designation, employment_type: p.employment_type }))
      }
    });
  } catch (err) {
    console.error('GET /admin/org-headcount error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── STEADY STATE ELIGIBILITY ─────────────────────────────────────────────────

// GET /api/admin/steady-state-eligibility?person_id=X
router.get('/steady-state-eligibility', async (req, res) => {
  try {
    const { person_id } = req.query;
    let where = '';
    let params = [];
    if (person_id) { where = 'WHERE e.person_id = ?'; params = [person_id]; }
    const [rows] = await pool.query(`
      SELECT e.id, e.task_id, e.person_id, e.added_by,
             t.task_name, t.color,
             p.display_name
      FROM RA_steady_state_eligibility e
      JOIN RA_steady_state_tasks t ON t.task_id = e.task_id
      JOIN RA_people p ON p.person_id = e.person_id
      ${where}
      ORDER BY p.display_name, t.task_name
    `, params);
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('GET /admin/steady-state-eligibility error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/admin/steady-state-eligibility/bulk — set eligible tasks for a person
router.post('/steady-state-eligibility/bulk', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const { person_id, task_ids, added_by } = req.body;
    // Delete existing eligibility for this person
    await conn.query('DELETE FROM RA_steady_state_eligibility WHERE person_id = ?', [person_id]);
    // Insert new ones
    for (const task_id of (task_ids || [])) {
      await conn.query(
        'INSERT INTO RA_steady_state_eligibility (task_id, person_id, added_by) VALUES (?, ?, ?)',
        [task_id, person_id, added_by || null]
      );
    }
    await conn.commit();
    res.json({ success: true });
  } catch (err) {
    await conn.rollback();
    console.error('POST /admin/steady-state-eligibility/bulk error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    conn.release();
  }
});

// POST /api/admin/steady-state-distribute
// Auto-distributes remaining capacity — clears existing entries per person then inserts fresh
router.post('/steady-state-distribute', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const { distributions, set_by } = req.body;

    // Get unique person_ids being recalculated
    const personIds = [...new Set(distributions.map(d => d.person_id))];

    // Delete ALL existing SS effort for these people so we start fresh
    if (personIds.length > 0) {
      await conn.query(
        `DELETE FROM RA_task_person_assignment WHERE person_id IN (${personIds.map(() => '?').join(',')})`,
        personIds
      );
    }

    // Insert new distributions
    for (const d of distributions) {
      if (d.effort_hc > 0) {
        await conn.query(`
          INSERT INTO RA_task_person_assignment (task_id, person_id, effort_hc, assigned_by)
          VALUES (?, ?, ?, ?)
        `, [d.task_id, d.person_id, d.effort_hc, set_by || null]);
      }
    }
    await conn.commit();
    res.json({ success: true, count: distributions.length });
  } catch (err) {
    await conn.rollback();
    console.error('POST /admin/steady-state-distribute error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    conn.release();
  }
});

// ─── STEADY STATE PERSON EFFORT ───────────────────────────────────────────────

// GET /api/admin/steady-state-effort — load all person efforts
router.get('/steady-state-effort', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT a.id, a.task_id, a.person_id, a.effort_hc, a.assigned_by,
             p.display_name, p.designation, p.location
      FROM RA_task_person_assignment a
      JOIN RA_people p ON p.person_id = a.person_id
      WHERE a.effort_hc > 0
      ORDER BY a.task_id, p.display_name
    `);
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('GET /admin/steady-state-effort error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/admin/steady-state-effort/bulk — save full effort matrix
router.post('/steady-state-effort/bulk', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const { records, set_by } = req.body;
    // records: [{ task_id, person_id, effort_hc }]
    for (const r of records) {
      if (!r.effort_hc || r.effort_hc <= 0) {
        await conn.query(
          `DELETE FROM RA_task_person_assignment WHERE task_id = ? AND person_id = ?`,
          [r.task_id, r.person_id]
        );
      } else {
        await conn.query(`
          INSERT INTO RA_task_person_assignment (task_id, person_id, effort_hc, assigned_by)
          VALUES (?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE effort_hc = VALUES(effort_hc), assigned_by = VALUES(assigned_by)
        `, [r.task_id, r.person_id, r.effort_hc, set_by || null]);
      }
    }
    await conn.commit();
    res.json({ success: true });
  } catch (err) {
    await conn.rollback();
    console.error('POST /admin/steady-state-effort/bulk error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    conn.release();
  }
});

// GET /api/admin/person-capacity?manager_name=X
// Returns per-person: project effort + steady state effort + remaining capacity
router.get('/person-capacity', async (req, res) => {
  try {
    const { manager_name } = req.query;
    let personFilter = '';
    let params = [];
    if (manager_name && manager_name !== 'all') {
      personFilter = 'AND p.reporting_manager = ?';
      params = [manager_name];
    }

    const [people] = await pool.query(`
      SELECT person_id, display_name, designation, location
      FROM RA_people WHERE is_active = 1 ${personFilter}
      ORDER BY display_name
    `, params);

    // Project effort from eligibility (simplified: count eligible projects)
    const [projectEffort] = await pool.query(`
      SELECT e.person_id, COUNT(DISTINCT e.project_id) AS project_count
      FROM RA_resource_eligibility e
      WHERE e.capability = 'yes'
      GROUP BY e.person_id
    `);

    // Steady state effort
    const [ssEffort] = await pool.query(`
      SELECT a.person_id, SUM(a.effort_hc) AS total_ss_effort
      FROM RA_task_person_assignment a
      WHERE a.effort_hc > 0
      GROUP BY a.person_id
    `);

    const projMap = new Map(projectEffort.map(r => [r.person_id, r.project_count]));
    const ssMap = new Map(ssEffort.map(r => [r.person_id, Number(r.total_ss_effort)]));

    const result = people.map(p => ({
      person_id: p.person_id,
      display_name: p.display_name,
      designation: p.designation,
      location: p.location,
      project_count: projMap.get(p.person_id) || 0,
      ss_effort: Math.round((ssMap.get(p.person_id) || 0) * 100) / 100,
      remaining: Math.round((1.0 - (ssMap.get(p.person_id) || 0)) * 100) / 100
    }));

    res.json({ success: true, data: result });
  } catch (err) {
    console.error('GET /admin/person-capacity error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── RETRO PROJECT DATA FOR GANTT ─────────────────────────────────────────────
// GET /api/admin/retro-projects — project allocations from retro import in Gantt format
// Groups by project + location so sizing view can show per-location HC rows and estimate cost
router.get('/retro-projects', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT
        proj.project_id, proj.project_name, proj.BU,
        proj.status, proj.project_code,
        COALESCE(p.location, 'Unknown') AS location,
        'Existing - FTE' AS hc_type,
        e.fiscal_year, e.quarter,
        SUM(e.effort_hc) AS headcount
      FROM RA_person_project_effort e
      JOIN RA_people p ON p.person_id = e.person_id
      JOIN RA_projects proj ON proj.project_id = e.project_id
      WHERE e.set_by = 'retro_import'
        AND e.effort_hc > 0
        AND (proj.retro_category IS NULL)
      GROUP BY proj.project_id, proj.project_name, proj.BU, proj.status,
               proj.project_code, p.location, e.fiscal_year, e.quarter
      ORDER BY proj.project_name, p.location, e.fiscal_year, e.quarter
    `);

    // Build rows grouped by (project, location) — one row per location per project
    const toQL = (fy, q) => `Q${q} FY${String(fy).slice(-2)}`;
    const rowMap = new Map();

    rows.forEach(r => {
      const key = `${r.project_name}||${r.location}`;
      if (!rowMap.has(key)) {
        rowMap.set(key, {
          project:      r.project_name,
          project_id:   r.project_id,
          bu:           r.BU || '',
          status:       r.status,
          fn:           'Retro HC',
          location:     r.location,
          hcType:       r.hc_type,
          manager_name: '',
          hc:           {},
          is_estimate:  true,   // flag for frontend to mark cost as estimated
          version_id:   null,
          version_status: r.status === 'active' ? 'active' : 'closed'
        });
      }
      const entry = rowMap.get(key);
      const ql = toQL(r.fiscal_year, r.quarter);
      entry.hc[ql] = Math.round(((entry.hc[ql] || 0) + Number(r.headcount)) * 100) / 100;
    });

    res.json({ success: true, data: [...rowMap.values()] });
  } catch (err) {
    console.error('GET /admin/retro-projects error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── HISTORICAL ALLOCATION DATA ───────────────────────────────────────────────

// GET /api/admin/history?person_name=X&task_code=Y&fy_from=2024&fy_to=2026
router.get('/history', async (req, res) => {
  try {
    const { person_name, task_code, fy_from, fy_to, manager_name } = req.query;

    let where = ['1=1'];
    const params = [];

    if (person_name) { where.push('h.person_name LIKE ?'); params.push(`%${person_name}%`); }
    if (task_code)   { where.push('h.task_code = ?');   params.push(task_code); }
    if (fy_from)     { where.push('h.fiscal_year >= ?'); params.push(parseInt(fy_from)); }
    if (fy_to)       { where.push('h.fiscal_year <= ?'); params.push(parseInt(fy_to)); }

    // Filter by manager's team if specified
    if (manager_name && manager_name !== 'all') {
      where.push(`h.person_name IN (
        SELECT REPLACE(CONCAT(p.display_name), ';', ',') FROM RA_people p
        WHERE p.reporting_manager = ? AND p.is_active = 1
      )`);
      params.push(manager_name);
    }

    const [rows] = await pool.query(`
      SELECT h.task_code, h.task_name, h.person_name,
             h.fiscal_year, h.quarter, h.effort_hc,
             CONCAT('Q', h.quarter, ' FY', RIGHT(h.fiscal_year, 2)) AS quarter_label
      FROM RA_task_person_history h
      WHERE ${where.join(' AND ')}
      ORDER BY h.person_name, h.fiscal_year, h.quarter
      LIMIT 5000
    `, params);

    // Also return summary per task_code per quarter
    const [summary] = await pool.query(`
      SELECT h.task_code, h.task_name, h.fiscal_year, h.quarter,
             SUM(h.effort_hc) AS total_hc, COUNT(DISTINCT h.person_name) AS person_count,
             CONCAT('Q', h.quarter, ' FY', RIGHT(h.fiscal_year, 2)) AS quarter_label
      FROM RA_task_person_history h
      WHERE ${where.join(' AND ')}
      GROUP BY h.task_code, h.task_name, h.fiscal_year, h.quarter
      ORDER BY h.task_code, h.fiscal_year, h.quarter
      LIMIT 2000
    `, params);

    res.json({ success: true, data: rows, summary });
  } catch (err) {
    console.error('GET /admin/history error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/admin/history/person-summary?person_name=X
// Returns per-person quarterly allocation summary across all SS tasks
router.get('/history/person-summary', async (req, res) => {
  try {
    const { person_name, fy_from = 2024, fy_to = 2027 } = req.query;

    const params = [parseInt(fy_from), parseInt(fy_to)];
    let personFilter = '';
    if (person_name) { personFilter = 'AND h.person_name LIKE ?'; params.push(`%${person_name}%`); }

    const [rows] = await pool.query(`
      SELECT h.person_name, h.task_code, h.task_name,
             h.fiscal_year, h.quarter, h.effort_hc,
             CONCAT('Q', h.quarter, ' FY', RIGHT(h.fiscal_year, 2)) AS quarter_label
      FROM RA_task_person_history h
      WHERE h.fiscal_year BETWEEN ? AND ? ${personFilter}
      ORDER BY h.person_name, h.fiscal_year, h.quarter, h.task_code
    `, params);

    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('GET /admin/history/person-summary error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
