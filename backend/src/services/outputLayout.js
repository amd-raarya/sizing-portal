// Output layout: the ORDER and the NAMES the Assignment Output uses for projects.
//
// Rahul 2026-11-11: the planning files ("alloc_MLS_Linux_1..4", all under Jeff Weyman) each list their projects in a fixed
// sequence with fixed names, and the same project always sits in the same place for every person. The output follows that.
//   - A "group" is one of those files (1..4). A manager belongs to one group, and so do their people.
//   - An "entry" is one line of a group's list: its position (seq) and the name the output shows.
//   - A "map" row says which project of ours is that entry. Our names can differ from the file's; the output shows the entry's name.
//   - A project with no entry goes to the bottom of the list (newest last), under its own name. Nothing is ever dropped.
//   - People whose manager has no group are shown in the old order (largest HC first), so nothing changes for them.
// When the four files are merged later, there will be one group; nothing else changes.

const normName = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

let ready = false;
async function ensureTables(pool) {
  if (ready) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS RA_output_layout_entry (
      entry_id    INT AUTO_INCREMENT PRIMARY KEY,
      group_no    INT NOT NULL,
      seq         INT NOT NULL,
      output_name VARCHAR(255) NOT NULL,
      source_code VARCHAR(40) NULL,
      updated_by  VARCHAR(200) NULL,
      updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_ole_group (group_no, seq)
    )`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS RA_output_layout_map (
      id         INT AUTO_INCREMENT PRIMARY KEY,
      group_no   INT NOT NULL,
      project_id INT NOT NULL,
      entry_id   INT NOT NULL,
      UNIQUE KEY uq_olm (group_no, project_id),
      KEY idx_olm_entry (entry_id)
    )`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS RA_output_layout_manager (
      manager_name VARCHAR(200) NOT NULL PRIMARY KEY,
      group_no     INT NOT NULL
    )`);
  // The people sequence of each planning file ("Resource Name" rows of the MS Project sheets). No sort rule exists (resources were added in
  // batches), so it is stored as given. kind: person (person_id set) | commit | gap (headcount commitment / gap rows of the sheet).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS RA_output_layout_people (
      id          INT AUTO_INCREMENT PRIMARY KEY,
      group_no    INT NOT NULL,
      seq         INT NOT NULL,
      sheet_name  VARCHAR(255) NOT NULL,
      kind        VARCHAR(10) NOT NULL DEFAULT 'person',
      person_id   INT NULL,
      KEY idx_olp_group (group_no, seq)
    )`);
  // Every project line a person has in the MS Project files (zero lines too), from the retro file; the planning-file output lists them all,
  // like MS Project does, even when the person has no HC on them in the quarters shown.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS RA_output_file_lines (
      person_id  INT NOT NULL,
      project_id INT NOT NULL,
      group_no   INT NOT NULL DEFAULT 0,
      label      VARCHAR(255) NULL,
      PRIMARY KEY (person_id, group_no, project_id)
    )`);
  const [[gc]] = await pool.query("SELECT COUNT(*) AS n FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'RA_output_file_lines' AND column_name = 'label'");
  if (!gc.n) { await pool.query('DROP TABLE RA_output_file_lines'); await pool.query(`CREATE TABLE RA_output_file_lines (person_id INT NOT NULL, project_id INT NOT NULL, group_no INT NOT NULL DEFAULT 0, label VARCHAR(255) NULL, PRIMARY KEY (person_id, group_no, project_id))`); }   // older shape: derived data, refreshed by scripts/retro_reload.js
  // The "Other projects and commitments" line of every person in the MS Project files (shown in the planning-file output only; never counted as
  // project HC by the engine). One row per person, planning file and quarter, the three months kept.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS RA_output_other_lines (
      person_id   INT NOT NULL,
      group_no    INT NOT NULL,
      fiscal_year INT NOT NULL,
      quarter     INT NOT NULL,
      m1 DECIMAL(8,3) NOT NULL DEFAULT 0, m2 DECIMAL(8,3) NOT NULL DEFAULT 0, m3 DECIMAL(8,3) NOT NULL DEFAULT 0,
      PRIMARY KEY (person_id, group_no, fiscal_year, quarter)
    )`);
  // Every line row of the MS Project sheets in the sheet's own order and spelling, under the header ('Last; First#n' = n-th time that header appears on the sheet)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS RA_output_file_rows (
      group_no   INT NOT NULL,
      seq        INT NOT NULL,
      header_key VARCHAR(255) NOT NULL,
      label      VARCHAR(255) NOT NULL,
      project_id INT NULL,
      is_other   TINYINT NOT NULL DEFAULT 0,
      person_id  INT NULL,
      PRIMARY KEY (group_no, seq, header_key),
      KEY idx_header (group_no, header_key)
    )`);
  ready = true;
}

/** header_key -> [{ label, project_id, other }] : the lines under each header of one planning file, as the sheet has them */
async function loadFileRows(pool, groupNo) {
  await ensureTables(pool);
  const [rows] = await pool.query('SELECT header_key, label, project_id, is_other FROM RA_output_file_rows WHERE group_no = ? ORDER BY seq', [groupNo]);
  const map = new Map();
  rows.forEach(r => { if (!map.has(r.header_key)) map.set(r.header_key, []); map.get(r.header_key).push({ label: r.label, project_id: r.project_id, other: !!r.is_other }); });
  return map;
}

/** person_id -> { ids: Set(project_id), labels: [label] } : what each person has on the OTHER planning files' sheets (those lines belong there, not to this file) */
async function loadOtherSheetLines(pool, groupNo) {
  await ensureTables(pool);
  const [rows] = await pool.query('SELECT person_id, label, project_id FROM RA_output_file_rows WHERE group_no <> ? AND person_id IS NOT NULL AND is_other = 0', [groupNo]);
  const map = new Map();
  rows.forEach(r => { if (!map.has(r.person_id)) map.set(r.person_id, { ids: new Set(), labels: [] }); const e = map.get(r.person_id); if (r.project_id) e.ids.add(r.project_id); e.labels.push(r.label); });
  return map;
}

/** person_id -> Map("year|quarter" -> [m1, m2, m3]) : the "Other projects and commitments" values of these people */
async function loadOtherLines(pool, personIds, groupNo) {
  await ensureTables(pool);
  const map = new Map();
  if (!personIds.length) return map;
  const [rows] = await pool.query(`SELECT person_id, fiscal_year, quarter, m1, m2, m3 FROM RA_output_other_lines WHERE group_no = ? AND person_id IN (${personIds.map(() => '?').join(',')})`, [groupNo, ...personIds]);
  rows.forEach(r => { if (!map.has(r.person_id)) map.set(r.person_id, new Map()); map.get(r.person_id).set(`${r.fiscal_year}|${r.quarter}`, [Number(r.m1), Number(r.m2), Number(r.m3)]); });
  return map;
}

/** person_id -> [{ project_id, name, ss, groups: [planning files whose sheet has that line] }] : the project lines of these people in the MS Project files */
async function loadFileLines(pool, personIds) {
  await ensureTables(pool);
  const map = new Map();
  if (!personIds.length) return map;
  const [rows] = await pool.query(
    `SELECT l.person_id, l.project_id, l.group_no, l.label, p.project_name, p.retro_category FROM RA_output_file_lines l JOIN RA_projects p ON p.project_id = l.project_id
     WHERE l.person_id IN (${personIds.map(() => '?').join(',')})`, personIds);
  rows.forEach(r => {
    if (!map.has(r.person_id)) map.set(r.person_id, []);
    const list = map.get(r.person_id);
    let e = list.find(x => x.project_id === r.project_id);
    if (!e) list.push(e = { project_id: r.project_id, name: r.project_name, ss: r.retro_category === 'ss_task', groups: [], labels: {} });
    e.groups.push(r.group_no); if (r.label) e.labels[r.group_no] = r.label;
  });
  return map;
}

/** The people of one planning file in the sheet's order: [{ seq, sheet_name, kind, person_id }] */
async function loadFilePeople(pool, groupNo) {
  await ensureTables(pool);
  const [rows] = await pool.query('SELECT seq, sheet_name, kind, person_id FROM RA_output_layout_people WHERE group_no = ? ORDER BY seq, id', [groupNo]);
  return rows;
}
async function fileGroups(pool) {
  await ensureTables(pool);
  const [rows] = await pool.query('SELECT group_no, COUNT(*) AS n FROM RA_output_layout_people GROUP BY group_no ORDER BY group_no');
  return rows.map(r => ({ group_no: r.group_no, rows: r.n }));
}

/** Everything the output needs: manager → group, each group's ordered entries, project → entry per group. */
async function loadLayout(pool) {
  await ensureTables(pool);
  const [entries] = await pool.query('SELECT entry_id, group_no, seq, output_name FROM RA_output_layout_entry ORDER BY group_no, seq, entry_id');
  const [maps] = await pool.query('SELECT group_no, project_id, entry_id FROM RA_output_layout_map');
  const [mgrs] = await pool.query('SELECT manager_name, group_no FROM RA_output_layout_manager');
  const [projs] = maps.length ? await pool.query(`SELECT project_id, project_name FROM RA_projects WHERE project_id IN (${[...new Set(maps.map(m => m.project_id))].map(() => '?').join(',')})`, [...new Set(maps.map(m => m.project_id))]) : [[]];
  const nameOf = new Map(projs.map(p => [p.project_id, p.project_name]));
  const entryById = new Map(entries.map(e => [e.entry_id, e]));
  const groups = {};
  entries.forEach(e => { const g = (groups[e.group_no] = groups[e.group_no] || { entries: [], byProject: new Map(), byName: new Map(), byLabel: new Map() }); g.entries.push(e); const lk = String(e.output_name).trim().toLowerCase(); if (!g.byLabel.has(lk)) g.byLabel.set(lk, e); });
  maps.forEach(m => {
    const g = groups[m.group_no], e = entryById.get(m.entry_id);
    if (!g || !e) return;
    g.byProject.set(m.project_id, e);
    const nm = normName(nameOf.get(m.project_id));
    if (nm && !g.byName.has(nm)) g.byName.set(nm, e);      // lets steady-state lines (they carry a name, not a project id) find their place
  });
  const groupOfManager = new Map(mgrs.map(m => [m.manager_name, m.group_no]));
  return { groups, groupOfManager, active: entries.length > 0 };
}

/** The entry a line sits at in `group` (by project id, else by name), or null = not in the list (goes to the bottom). */
function entryFor(layout, group, line) {
  const g = layout && layout.groups[group];
  if (!g) return null;
  // the line is under a label of its own in this file's sheet (the same project can be spelled differently for different people): that line
  if (line.label && g.byLabel.has(String(line.label).trim().toLowerCase())) return g.byLabel.get(String(line.label).trim().toLowerCase());
  if (line.project_id && g.byProject.has(line.project_id)) return g.byProject.get(line.project_id);
  const nm = normName(line.name);
  return (nm && g.byName.get(nm)) || null;
}

// ── Editing (from the output preview) ───────────────────────────────────────────────────────────────────────
async function renameEntry(pool, entryId, name, by) {
  await ensureTables(pool);
  const n = String(name || '').trim();
  if (!n) throw new Error('Enter a name');
  const [r] = await pool.query('UPDATE RA_output_layout_entry SET output_name = ?, updated_by = ? WHERE entry_id = ?', [n.slice(0, 255), by || null, entryId]);
  if (!r.affectedRows) throw new Error('Unknown list line');
}

/**
 * Put a project at a line of a group's list.
 *   entryId  → that line;  newName → a NEW line at the bottom of the list with that name (new projects start there);  neither → unplace it.
 */
async function placeProject(pool, { groupNo, projectId, entryId, newName, by }) {
  await ensureTables(pool);
  if (!groupNo || !projectId) throw new Error('group_no and project_id required');
  let eid = entryId ? Number(entryId) : null;
  if (!eid && newName && String(newName).trim()) {
    const [[mx]] = await pool.query('SELECT COALESCE(MAX(seq), 0) AS m FROM RA_output_layout_entry WHERE group_no = ?', [groupNo]);
    const [r] = await pool.query('INSERT INTO RA_output_layout_entry (group_no, seq, output_name, updated_by) VALUES (?,?,?,?)', [groupNo, mx.m + 1, String(newName).trim().slice(0, 255), by || null]);
    eid = r.insertId;
  }
  if (eid) {
    const [[e]] = await pool.query('SELECT group_no FROM RA_output_layout_entry WHERE entry_id = ?', [eid]);
    if (!e || Number(e.group_no) !== Number(groupNo)) throw new Error('That line belongs to another list');
    await pool.query('INSERT INTO RA_output_layout_map (group_no, project_id, entry_id) VALUES (?,?,?) ON DUPLICATE KEY UPDATE entry_id = VALUES(entry_id)', [groupNo, projectId, eid]);
  } else {
    await pool.query('DELETE FROM RA_output_layout_map WHERE group_no = ? AND project_id = ?', [groupNo, projectId]);
  }
  return eid;
}

async function listEntries(pool, groupNo) {
  await ensureTables(pool);
  const [rows] = await pool.query('SELECT entry_id, seq, output_name FROM RA_output_layout_entry WHERE group_no = ? ORDER BY seq, entry_id', [groupNo]);
  return rows;
}

// ── Seeding from the planning files' project list (scripts/seed_output_layout.js) ───────────────────────────────
/**
 * Match each list line to our projects: by the spg code first (RA_projects.project_code), else by the name without the code.
 * Every project that carries the code is matched (all versions of a program share one line).
 * @returns [{ entry (seed entry), projects: [project_id] }]
 */
function autoMatch(seedEntries, projects) {
  const strip = s => normName(String(s || '').replace(/^spg[\d.]+_/i, ''));
  const byCode = new Map(), byName = new Map();
  projects.forEach(p => {
    if (p.project_code) { const k = String(p.project_code).trim().toLowerCase(); (byCode.get(k) || byCode.set(k, []).get(k)).push(p); }
    const k = strip(p.project_name); (byName.get(k) || byName.set(k, []).get(k)).push(p);
  });
  return seedEntries.map(e => {
    let hit = e.code ? byCode.get(String(e.code).toLowerCase()) : null;
    let how = 'code';
    if (!hit || !hit.length) { hit = byName.get(strip(e.leaf || e.name)) || byName.get(strip(e.name)); how = 'name'; }
    return { entry: e, projects: (hit || []).map(p => p.project_id), how: hit && hit.length ? how : null };
  });
}

module.exports = { ensureTables, loadFileLines, loadFileRows, loadOtherSheetLines, loadOtherLines, loadLayout, loadFilePeople, fileGroups, entryFor, renameEntry, placeProject, listEntries, autoMatch, normName };
