// Summary of the Assignment Output: which people work on which project, and what changed since the last download.
//
// Rahul 2026-11-19: "a tab which summarises all the changes happening": new projects with the people picked on them (by the engine or by
// the managers' ticks), people added to / removed from projects that already existed. The reference for "changed" is the LAST DOWNLOADED
// output of the same scope (one team, or one planning file): every Excel download stores who is on which project, and the next preview /
// download compares with it. Without an earlier download there is nothing to compare with: the roster is shown and nothing is flagged.
//
// Only quarters both outputs cover are compared, so asking for another range does not look like people appearing or disappearing.

const r2 = n => Math.round(n * 100) / 100;
const PRESENT = 0.004;       // below this a person is not "on" the project (rounding noise)
const MOVED = 0.1;           // average HC over the compared quarters must differ by this much to count as "more" / "less"
const KEEP = 5;              // snapshots kept per scope

let ready = false;
async function ensureTable(pool) {
  if (ready) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS RA_output_snapshot (
      id        INT AUTO_INCREMENT PRIMARY KEY,
      scope     VARCHAR(200) NOT NULL,
      taken_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
      taken_by  VARCHAR(200) NULL,
      q_from    VARCHAR(20) NULL,
      q_to      VARCHAR(20) NULL,
      payload   LONGTEXT NOT NULL,
      KEY idx_os_scope (scope, taken_at)
    )`);
  ready = true;
}

/** Who is on which project, per quarter (average of the quarter's columns): { quarters, projects: { name: { est, prov, seq, people: { pid: { n, q: { label: hc } } } } } } */
function rosterOf(model) {
  const quarters = model.quarters.map(q => q.label);
  const perQ = {};                                    // quarter label → number of columns
  model.periods.forEach(p => { perQ[p.quarter] = (perQ[p.quarter] || 0) + 1; });
  const projects = {};
  (model.people || []).forEach(person => {
    if (person.empty) return;
    const lines = person.lines || (person.projects || []).map(p => ({ kind: 'project', ...p }));
    lines.forEach(l => {
      if (l.kind !== 'project' || l.other) return;
      const sums = {};
      l.vals.forEach((v, i) => { const q = model.periods[i].quarter; sums[q] = (sums[q] || 0) + (v.v || 0); });
      const q = {};
      let any = false;
      quarters.forEach(label => { const hc = (sums[label] || 0) / (perQ[label] || 1); q[label] = r2(hc); if (hc > PRESENT) any = true; });
      if (!any) return;
      const p = projects[l.name] || (projects[l.name] = { est: false, prov: false, seq: null, people: {} });
      p.est = p.est || !!l.est; p.prov = p.prov || !!l.prov;
      if (l.seq != null && (p.seq == null || l.seq < p.seq)) p.seq = l.seq;
      p.people[person.person_id] = { n: person.name, q };
    });
  });
  return { quarters, projects };
}

const avgOver = (q, labels) => (labels.length ? labels.reduce((t, l) => t + (q[l] || 0), 0) / labels.length : 0);

/**
 * The summary: every project with its people, and (when there is an earlier download) what changed.
 * snapshot = { taken_at, taken_by, roster } or null.
 */
function buildSummary(model, snapshot) {
  const now = rosterOf(model);
  const before = snapshot && snapshot.roster ? snapshot.roster : null;
  const common = before ? now.quarters.filter(l => before.quarters.includes(l)) : [];
  const compare = !!before && common.length > 0;
  let note = '';
  if (!before) note = 'No earlier download of this output to compare with. This download becomes the reference: from the next one on, the Summary shows who was added or removed.';
  else if (!common.length) note = 'The last download covers other quarters than this one, so nothing can be compared. This download becomes the new reference.';

  const names = new Set([...Object.keys(now.projects), ...(compare ? Object.keys(before.projects) : [])]);
  const totals = { projects: 0, projects_new: 0, projects_removed: 0, people_added: 0, people_removed: 0, people_changed: 0 };
  const rows = [];
  names.forEach(name => {
    const cur = now.projects[name], old = compare ? before.projects[name] : null;
    const people = [];
    const pids = new Set([...(cur ? Object.keys(cur.people) : []), ...(old ? Object.keys(old.people) : [])]);
    pids.forEach(pid => {
      const c = cur && cur.people[pid], o = old && old.people[pid];
      const hc = c ? avgOver(c.q, compare ? common : now.quarters) : 0;
      const was = o ? avgOver(o.q, common) : 0;
      const isNow = !!c && hc > PRESENT, wasThere = !!o && was > PRESENT;
      let change = 'same';
      if (compare) {
        if (isNow && !wasThere) change = 'added';
        else if (!isNow && wasThere) change = 'removed';
        else if (isNow && hc - was >= MOVED) change = 'up';
        else if (isNow && was - hc >= MOVED) change = 'down';
        else if (!isNow && !wasThere) return;
      } else if (!isNow) return;
      people.push({ person_id: Number(pid), name: (c || o).n, hc: r2(hc), was: compare ? r2(was) : null, delta: compare ? r2(hc - was) : null, change });
    });
    if (!people.length) return;
    const order = { added: 0, removed: 1, up: 2, down: 2, same: 3 };
    people.sort((a, b) => order[a.change] - order[b.change] || b.hc - a.hc || a.name.localeCompare(b.name));
    let status = 'existing';
    if (compare && cur && !old) status = 'new';
    else if (compare && !cur && old) status = 'removed';
    const added = people.filter(p => p.change === 'added').length, removed = people.filter(p => p.change === 'removed').length;
    const changed = people.filter(p => p.change === 'up' || p.change === 'down').length;
    totals.projects++;
    if (status === 'new') totals.projects_new++;
    if (status === 'removed') totals.projects_removed++;
    totals.people_added += added; totals.people_removed += removed; totals.people_changed += changed;
    const src = cur || old;
    rows.push({
      name, status, est: !!src.est, prov: !!src.prov, seq: src.seq,
      people_now: people.filter(p => p.change !== 'removed').length, added, removed, changed,
      hc_now: r2(people.reduce((t, p) => t + (p.change === 'removed' ? 0 : p.hc), 0)),
      people
    });
  });
  // list order of the planning file when there is one, else the project's total HC; unlisted ones at the bottom
  rows.sort((a, b) => ((a.seq ?? 1e9) - (b.seq ?? 1e9)) || (b.hc_now - a.hc_now) || a.name.localeCompare(b.name));
  return {
    compared: compare,
    baseline: before ? { taken_at: snapshot.taken_at, taken_by: snapshot.taken_by, from: before.quarters[0], to: before.quarters[before.quarters.length - 1], compared_quarters: common.length } : null,
    quarters: { from: now.quarters[0], to: now.quarters[now.quarters.length - 1] },
    note, totals, projects: rows
  };
}

async function loadLatest(pool, scope) {
  await ensureTable(pool);
  const [[row]] = await pool.query('SELECT taken_at, taken_by, payload FROM RA_output_snapshot WHERE scope = ? ORDER BY taken_at DESC, id DESC LIMIT 1', [scope]);
  if (!row) return null;
  try { return { taken_at: row.taken_at, taken_by: row.taken_by, roster: JSON.parse(row.payload) }; } catch (e) { return null; }
}

/** Store what this output shows as the reference for the next comparison (called when the Excel is downloaded). */
async function saveSnapshot(pool, scope, model, by) {
  await ensureTable(pool);
  const roster = rosterOf(model);
  await pool.query('INSERT INTO RA_output_snapshot (scope, taken_by, q_from, q_to, payload) VALUES (?,?,?,?,?)',
    [scope, by || null, roster.quarters[0] || null, roster.quarters[roster.quarters.length - 1] || null, JSON.stringify(roster)]);
  await pool.query(
    `DELETE FROM RA_output_snapshot WHERE scope = ? AND id NOT IN (SELECT id FROM (SELECT id FROM RA_output_snapshot WHERE scope = ? ORDER BY taken_at DESC, id DESC LIMIT ${KEEP}) t)`, [scope, scope]);
}

/** The "Summary" worksheet of the Excel: totals, then every project with its people and what changed. */
function writeSheet(wb, changes, scopeLabel) {
  const ws = wb.addWorksheet('Summary');
  const F = (argb) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
  const font = (o) => ({ name: 'Arial', size: 10, ...o });
  const COL = { added: 'FFC8E6C9', removed: 'FFFFCDD2', up: 'FFFFF9C4', down: 'FFFFE0B2' };
  const WORD = { added: 'ADDED', removed: 'REMOVED', up: 'More HC', down: 'Less HC', same: '' };
  ws.columns = [{ width: 44 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 12 }];
  let r = 1;
  const line = (text, o) => { const c = ws.getCell(r, 1); c.value = text; c.font = font(o || {}); ws.mergeCells(r, 1, r, 6); r++; };
  line(`Assignment output summary · ${/^File (\d)$/.test(scopeLabel) ? 'Alloc_MLS_Linux_' + scopeLabel.slice(5) : scopeLabel}`, { bold: true, size: 13 });
  line(`Quarters in this output: ${changes.quarters.from} to ${changes.quarters.to}`);
  if (changes.baseline) {
    const when = changes.baseline.taken_at ? new Date(changes.baseline.taken_at).toISOString().slice(0, 16).replace('T', ' ') : '';
    line(`Compared with the output downloaded ${when}${changes.baseline.taken_by ? ' by ' + changes.baseline.taken_by : ''} (${changes.baseline.from} to ${changes.baseline.to}; ${changes.baseline.compared_quarters} quarters in common)`);
    const t = changes.totals;
    line(`New projects: ${t.projects_new} · Projects dropped: ${t.projects_removed} · People added: ${t.people_added} · People removed: ${t.people_removed} · HC changed: ${t.people_changed}`, { bold: true });
  }
  if (changes.note) line(changes.note, { italic: true, color: { argb: 'FF8A5A00' } });
  r++;
  const head = ['Project / person', 'Status', 'HC (avg)', 'Was (avg)', 'Change', 'Delta'];
  head.forEach((h, i) => { const c = ws.getCell(r, i + 1); c.value = h; c.font = font({ bold: true, color: { argb: 'FFFFFFFF' } }); c.fill = F('FF1A1A2E'); });
  const headRow = r; r++;
  changes.projects.forEach(p => {
    const tag = [p.est ? 'estimate' : '', p.prov ? 'under review' : ''].filter(Boolean).join(', ');
    const label = `${p.name}${tag ? ' (' + tag + ')' : ''}`;
    const st = p.status === 'new' ? 'NEW PROJECT' : p.status === 'removed' ? 'DROPPED' : '';
    const vals = [label, st, p.hc_now, null, `${p.people_now} ${p.people_now === 1 ? 'person' : 'people'}`, changes.compared ? `+${p.added} / -${p.removed}` : null];
    vals.forEach((v, i) => {
      const c = ws.getCell(r, i + 1); c.value = v; c.font = font({ bold: true }); c.fill = F(p.status === 'new' ? 'FFC8E6C9' : p.status === 'removed' ? 'FFFFCDD2' : 'FFE8F0FE');
      if (i === 2) c.numFmt = '0.00';
    });
    r++;
    p.people.forEach(x => {
      const row = [`    ${x.name}`, '', x.change === 'removed' ? null : x.hc, x.was, WORD[x.change], x.delta];
      row.forEach((v, i) => {
        const c = ws.getCell(r, i + 1); c.value = v; c.font = font(x.change === 'removed' ? { strike: i === 0, color: { argb: 'FFC62828' } } : {});
        if (COL[x.change]) c.fill = F(COL[x.change]);
        if (i === 2 || i === 3) c.numFmt = '0.00';
        if (i === 5) c.numFmt = '+0.00;-0.00;0.00';
      });
      r++;
    });
  });
  ws.views = [{ state: 'frozen', ySplit: headRow }];
  return ws;
}

/** The key a scope is stored under: the manager's name, the planning file, or all teams. */
const scopeOf = (query, model) => (model && model.file_no ? `File ${model.file_no}` : (query.manager_name && query.manager_name !== 'all' ? query.manager_name : 'All teams'));

module.exports = { ensureTable, rosterOf, buildSummary, loadLatest, saveSnapshot, scopeOf, writeSheet };
