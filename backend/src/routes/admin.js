const express = require('express');
const router = express.Router();
const pool = require('../db/connection');
const multer = require('multer');
const ExcelJS = require('exceljs');

// Multer — memory storage for speed
const sizingUpload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    if (file.originalname.match(/\.(xlsx|xls)$/i)) cb(null, true);
    else cb(new Error('Only Excel files allowed'));
  },
  limits: { fileSize: 20 * 1024 * 1024 }
});

const SKIP_TABS = new Set(['Assumptions','Info','BrowserTab','LUT','Instructions','Ramp Scenarios']);

function parseQ(h) {
  if (!h) return null;
  const m = String(h).trim().match(/^Q(\d)(\d{2})$/);
  return m ? { q: parseInt(m[1]), fy: 2000 + parseInt(m[2]) } : null;
}
function cellVal(v) {
  // ExcelJS returns formula cells as {formula, result} — extract the result
  if (v && typeof v === 'object') {
    if ('result' in v) return v.result ?? '';
    if ('text' in v)   return v.text ?? '';
    if ('richText' in v) return v.richText.map(r => r.text).join('');
  }
  return v ?? '';
}
function clean(v) {
  const s = String(cellVal(v)).trim();
  return ['nan','none','null','undefined',''].includes(s.toLowerCase()) ? '' : s;
}

async function parseSizingExcel(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);

  const lut_rates = {};
  const assumptions = [];
  const lutWs = wb.getWorksheet('LUT');
  if (lutWs) lutWs.eachRow((row, ri) => {
    if (ri < 3) return;
    const loc = clean(row.getCell(9).value);
    const rate = parseFloat(cellVal(row.getCell(8).value));
    if (loc && !isNaN(rate)) lut_rates[loc] = Math.round(rate * 100) / 100;
  });
  const assWs = wb.getWorksheet('Assumptions');
  if (assWs) assWs.eachRow((row, ri) => {
    if (ri < 3) return;
    const fn = clean(row.getCell(1).value), scope = clean(row.getCell(2).value);
    if (fn || scope) assumptions.push({ function: fn, scope, assumptions: clean(row.getCell(3).value), risks: clean(row.getCell(4).value) });
  });

  const projects = [];
  wb.eachSheet(ws => {
    if (SKIP_TABS.has(ws.name)) return;
    console.log(`[parse] Sheet: ${ws.name}`);
    const row4 = ws.getRow(4);
    const bu_raw = clean(row4.getCell(1).value);
    const started = clean(row4.getCell(2).value);
    const due = clean(row4.getCell(3).value);
    const row5 = ws.getRow(5);
    const colMap = { category:1, leader:2, team:3, func:4, location:5, hctype:7 };
    const qCols = {};
    const row5sample = [];
    row5.eachCell((cell, ci) => {
      const raw = cell.value;
      const h = clean(raw);
      if (ci <= 12) row5sample.push(`col${ci}:${JSON.stringify(raw)}→${h}`);
      if (!h) return;
      const qr = parseQ(h); if (qr) { qCols[ci] = qr; return; }
      const hl = h.toLowerCase();
      if (hl.includes('category')) colMap.category = ci;
      else if (hl.includes('leader')) colMap.leader = ci;
      else if (hl.includes('top level')) colMap.team = ci;
      else if (hl.includes('function')) colMap.func = ci;
      else if (hl.includes('allocation')) { /* skip */ }
      else if (hl.includes('location')) colMap.location = ci;
      else if (hl.includes('hc') && hl.includes('type')) colMap.hctype = ci;
    });
    // Fallback: if no quarterly columns found from row5 headers (formula cells),
    // detect them from row 4 which has the fiscal year as a plain number
    if (!Object.keys(qCols).length) {
      const row4q = ws.getRow(4);
      let startCol = null, startYear = null;
      row4q.eachCell((cell, ci) => {
        if (ci < 8) return; // quarterly starts at col H (8)
        const v = parseInt(cellVal(cell.value));
        if (!startYear && v >= 2020 && v <= 2040) { startYear = v; startCol = ci; }
      });
      if (startYear && startCol) {
        // Each quarter = 1 column. Q1 FY26, Q2 FY26, Q3 FY26, Q4 FY26, Q1 FY27...
        let fy = startYear, q = 1;
        for (let ci = startCol; ci <= (ws.columnCount || startCol + 60); ci++) {
          qCols[ci] = { q, fy };
          q++; if (q > 4) { q = 1; fy++; }
        }
      }
    }
    if (!Object.keys(qCols).length) return;

    const rows = [];
    ws.eachRow((row, ri) => {
      if (ri <= 5) return;
      const category = clean(row.getCell(colMap.category).value);
      const leader   = clean(row.getCell(colMap.leader).value);
      const team     = clean(row.getCell(colMap.team).value);
      const func     = clean(row.getCell(colMap.func).value);
      const loc      = clean(row.getCell(colMap.location).value);
      const hctype   = clean(row.getCell(colMap.hctype).value);
      if (!category && !team && !loc && !hctype) return;
      const quarterly_hc = {};
      for (const [ci, {q, fy}] of Object.entries(qCols)) {
        const v = parseFloat(cellVal(row.getCell(parseInt(ci)).value));
        if (!isNaN(v) && v > 0) quarterly_hc[`Q${q} FY${String(fy).slice(-2)}`] = Math.round(v * 1000) / 1000;
      }
      if (Object.keys(quarterly_hc).length) rows.push({ category, leader, top_level_team: team, function: func, location: loc, hc_type: hctype, quarterly_hc });
    });

    const location_summary = {};
    rows.forEach(r => { if (r.location?.trim()) { if (!location_summary[r.location]) location_summary[r.location] = { rate: lut_rates[r.location] || null, rows: 0 }; location_summary[r.location].rows++; } });
    const scope_notes = assumptions.filter(a => a.scope).map(a => `${a.function}: ${a.scope}`).join('\n');
    // Fix dates: ExcelJS returns Date objects, extract YYYY-MM-DD
    function fmtDate(raw) {
      const v = cellVal(raw);
      if (!v) return null;
      if (v instanceof Date) {
        // Use UTC to avoid timezone shift (Excel dates are UTC midnight)
        const y = v.getUTCFullYear(), m = String(v.getUTCMonth()+1).padStart(2,'0'), d = String(v.getUTCDate()).padStart(2,'0');
        return y > 2020 ? `${y}-${m}-${d}` : null;
      }
      const s = String(v).slice(0,10);
      return s.match(/^\d{4}-\d{2}-\d{2}$/) && parseInt(s.slice(0,4)) > 2020 ? s : null;
    }
    projects.push({ project_name: ws.name, bu: ['BU','Client',''].includes(bu_raw) ? '' : bu_raw, started: fmtDate(row4.getCell(2).value), due_date: fmtDate(row4.getCell(3).value), rows, row_count: rows.length, location_summary, scope_notes });
  });
  return { projects, rates: lut_rates, assumptions };
}

// ─── SIZING EXCEL UPLOAD ──────────────────────────────────────────────────────

// POST /api/admin/upload-sizing — parse in memory, return preview instantly
router.post('/upload-sizing', sizingUpload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, error: 'No file uploaded' });
  try {
    const parsed = await parseSizingExcel(req.file.buffer);
    return res.json({ success: true, data: parsed, original_name: req.file.originalname });
  } catch (err) {
    console.error('upload-sizing error:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});


// POST /api/admin/upload-sizing/commit — write parsed data to DB
router.post('/upload-sizing/commit', async (req, res) => {
  const { projects, rates, submitted_by } = req.body;
  if (!projects || !Array.isArray(projects)) return res.status(400).json({ success: false, error: 'projects array required' });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const created = [];

    for (const proj of projects) {
      const { project_name, bu, category, leader, top_level_team, status, scope_notes, rows, location_summary } = proj;

      // 1. Create or find project
      let [existing] = await conn.query(
        `SELECT project_id FROM RA_projects WHERE project_name = ? LIMIT 1`, [project_name]
      );
      let projectId;
      if (existing.length) {
        projectId = existing[0].project_id;
      } else {
        const [ins] = await conn.query(
          `INSERT INTO RA_projects (project_name, BU, category, leader, top_level_team, status, is_test)
           VALUES (?, ?, ?, ?, ?, ?, 0)`,
          [project_name, bu || '', category || '', leader || '', top_level_team || '', status || 'pipeline']
        );
        projectId = ins.insertId;
      }

      // 2. Create sizing version
      const [vIns] = await conn.query(
        `INSERT INTO RA_sizing_versions (project_id, version_status, submitted_by, scope_notes)
         VALUES (?, 'draft', ?, ?)`,
        [projectId, submitted_by || null, scope_notes || null]
      );
      const versionId = vIns.insertId;

      // 3. Insert staging rows
      for (const row of rows) {
        const [shIns] = await conn.query(
          `INSERT INTO RA_staging_headcount (version_id, function_name, location, hc_type, manager_name)
           VALUES (?, ?, ?, ?, ?)`,
          [versionId, row.function || row.category || '', row.location || '', row.hc_type || '', row.leader || '']
        );
        const stagingId = shIns.insertId;

        // 4. Insert quarterly HC
        for (const [label, hc] of Object.entries(row.quarterly_hc || {})) {
          const m = label.match(/Q(\d) FY(\d{2})/);
          if (!m) continue;
          const quarter = parseInt(m[1]);
          const fiscal_year = 2000 + parseInt(m[2]);
          await conn.query(
            `INSERT INTO RA_staging_quarterly (staging_id, fiscal_year, quarter, headcount) VALUES (?, ?, ?, ?)`,
            [stagingId, fiscal_year, quarter, hc]
          );
        }
      }

      // 5. Upsert location rates from LUT
      if (location_summary && rates) {
        for (const [loc, info] of Object.entries(location_summary)) {
          const rate = info.rate || (rates && rates[loc]);
          if (loc && rate) {
            await conn.query(
              `INSERT INTO RA_project_rates (project_id, location, rate_per_quarter)
               VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE rate_per_quarter = ?`,
              [projectId, loc, rate, rate]
            );
          }
        }
      }

      created.push({ project_name, project_id: projectId, version_id: versionId, rows: rows.length });
    }

    await conn.commit();
    res.json({ success: true, data: created });
  } catch (err) {
    await conn.rollback();
    console.error('upload-sizing commit error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    conn.release();
  }
});

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

// GET /api/admin/history/person-summary?person_name=X&fy_from=2024&fy_to=2027
// Returns per-person quarterly allocation from RA_person_project_effort (retro data)
// covering both SS tasks and funded/closed projects
router.get('/history/person-summary', async (req, res) => {
  try {
    const { person_name, fy_from = 2024, fy_to = 2027 } = req.query;

    const params = [parseInt(fy_from), parseInt(fy_to)];
    let personFilter = '';
    if (person_name) { personFilter = 'AND p.display_name LIKE ?'; params.push(`%${person_name}%`); }

    const [rows] = await pool.query(`
      SELECT
        p.display_name AS person_name,
        proj.project_code AS task_code,
        proj.project_name AS task_name,
        e.fiscal_year,
        e.quarter,
        e.effort_hc,
        CONCAT('Q', e.quarter, ' FY', RIGHT(e.fiscal_year, 2)) AS quarter_label
      FROM RA_person_project_effort e
      JOIN RA_people p ON p.person_id = e.person_id
      JOIN RA_projects proj ON proj.project_id = e.project_id
      WHERE e.fiscal_year BETWEEN ? AND ?
        AND e.effort_hc > 0
        AND e.set_by = 'retro_import'
        ${personFilter}
      ORDER BY p.display_name, e.fiscal_year, e.quarter, proj.project_name
    `, params);

    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('GET /admin/history/person-summary error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── IMPORT QUEUE ────────────────────────────────────────────────────────────

// GET /api/admin/import-queue — list all pending/recent queue items
router.get('/import-queue', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT q.*, p.project_name AS linked_project_name
      FROM RA_import_queue q
      LEFT JOIN RA_projects p ON p.project_id = q.matched_project_id
      ORDER BY q.queued_at DESC
      LIMIT 100
    `);
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PATCH /api/admin/import-queue/:id/approve — approve and commit a queue item
router.patch('/import-queue/:id/approve', async (req, res) => {
  const { id } = req.params;
  const { reviewed_by, project_id_override } = req.body;
  const conn = await pool.getConnection();
  try {
    const [[item]] = await conn.query('SELECT * FROM RA_import_queue WHERE id = ?', [id]);
    if (!item) return res.status(404).json({ success: false, error: 'Not found' });

    await conn.beginTransaction();

    if (item.file_type === 'sizing') {
      const parsed = JSON.parse(item.parse_result || '{}');
      const proj = parsed.project;
      const rates = parsed.rates || {};
      if (proj) {
        const projId = project_id_override || item.matched_project_id;
        let finalId = projId;

        if (!finalId) {
          // Create new project
          const [ins] = await conn.query(
            `INSERT INTO RA_projects (project_name, BU, status, is_test) VALUES (?, ?, 'pipeline', 0)`,
            [proj.project_name, proj.bu || '']
          );
          finalId = ins.insertId;
        }

        // Create sizing version
        const [vIns] = await conn.query(
          `INSERT INTO RA_sizing_versions (project_id, version_status, submitted_by, scope_notes) VALUES (?, 'draft', ?, ?)`,
          [finalId, reviewed_by || 'import', proj.scope_notes || null]
        );
        const versionId = vIns.insertId;

        // Insert staging rows
        for (const row of proj.rows || []) {
          const [shIns] = await conn.query(
            `INSERT INTO RA_staging_headcount (version_id, function_name, location, hc_type, manager_name) VALUES (?,?,?,?,?)`,
            [versionId, row.function || row.category || '', row.location || '', row.hc_type || '', row.leader || '']
          );
          for (const [label, hc] of Object.entries(row.quarterly_hc || {})) {
            const m = label.match(/Q(\d) FY(\d{2})/);
            if (!m) continue;
            await conn.query(
              `INSERT INTO RA_staging_quarterly (staging_id, fiscal_year, quarter, headcount) VALUES (?,?,?,?)`,
              [shIns.insertId, 2000+parseInt(m[2]), parseInt(m[1]), hc]
            );
          }
        }

        // Upsert location rates
        for (const [loc, info] of Object.entries(proj.location_summary || {})) {
          const rate = info.rate || rates[loc];
          if (loc && rate) await conn.query(
            `INSERT INTO RA_project_rates (project_id, location, rate_per_quarter) VALUES (?,?,?) ON DUPLICATE KEY UPDATE rate_per_quarter=?`,
            [finalId, loc, rate, rate]
          );
        }
      }
    } else if (item.file_type === 'document') {
      const projId = project_id_override || item.matched_project_id;
      if (projId) {
        await conn.query(
          `INSERT INTO RA_documents (project_id, doc_label, doc_url, uploaded_by) VALUES (?,?,?,?)`,
          [projId, item.original_name, item.stored_path, reviewed_by || 'import']
        );
      }
    }

    await conn.query(
      `UPDATE RA_import_queue SET status='approved', reviewed_at=NOW(), reviewed_by=? WHERE id=?`,
      [reviewed_by || null, id]
    );
    await conn.commit();
    res.json({ success: true });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ success: false, error: err.message });
  } finally {
    conn.release();
  }
});

// PATCH /api/admin/import-queue/:id/reject
router.patch('/import-queue/:id/reject', async (req, res) => {
  const { id } = req.params;
  const { reviewed_by } = req.body;
  try {
    await pool.query(
      `UPDATE RA_import_queue SET status='rejected', reviewed_at=NOW(), reviewed_by=? WHERE id=?`,
      [reviewed_by || null, id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── POWER AUTOMATE WEBHOOK ──────────────────────────────────────────────────
// POST /api/admin/automate/sizing
// Called by Power Automate when Sam's email arrives.
// Body: { filename: string, content_base64: string, sender?: string }
// No auth token required but a shared secret header for basic security.

const AUTOMATE_SECRET = process.env.AUTOMATE_SECRET || 'amd-sizing-2026';

router.post('/automate/sizing', async (req, res) => {
  const secret = req.headers['x-automate-secret'];
  if (secret !== AUTOMATE_SECRET) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }
  const { filename, content_base64, sender } = req.body;
  if (!filename || !content_base64) {
    return res.status(400).json({ success: false, error: 'filename and content_base64 required' });
  }
  if (!filename.match(/\.(xlsx|xls)$/i)) {
    return res.status(400).json({ success: false, error: 'Only .xlsx files accepted' });
  }

  try {
    const buffer = Buffer.from(content_base64, 'base64');
    const parsed = await parseSizingExcel(buffer);

    if (parsed.error) {
      return res.status(422).json({ success: false, error: parsed.error });
    }

    // Write to processed folder for record-keeping
    const path = require('path');
    const fs   = require('fs');
    const ts   = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const procDir = path.join(__dirname, '../../processed/sizing');
    fs.mkdirSync(procDir, { recursive: true });
    const destPath = path.join(procDir, `${ts}_${filename}`);
    fs.writeFileSync(destPath, buffer);

    // Queue each project tab
    const queued = [];
    for (const proj of parsed.projects || []) {
      const [existing] = await pool.query(
        'SELECT project_id, project_name FROM RA_projects WHERE project_name LIKE ? AND retro_category IS NULL LIMIT 1',
        [`%${proj.project_name.slice(0, 20)}%`]
      );
      const match = existing[0] || null;
      await pool.query(
        `INSERT INTO RA_import_queue (file_type, original_name, stored_path, parse_result, status, matched_project_id, matched_project_name, error_message)
         VALUES (?, ?, ?, ?, 'pending', ?, ?, NULL)`,
        ['sizing', filename, destPath, JSON.stringify({ project: proj, rates: parsed.rates || {} }),
         match?.project_id || null, match?.project_name || proj.project_name]
      );
      queued.push(proj.project_name);
    }

    console.log(`[automate] Queued from Power Automate: ${filename} → ${queued.join(', ')} (sender: ${sender || 'unknown'})`);
    res.json({ success: true, queued, message: `${queued.length} project(s) added to Import Queue for review` });
  } catch (err) {
    console.error('[automate] error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
