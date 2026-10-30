'use strict';
/**
 * Assignment engine — turns eligibility "Yes" ticks into per-person, per-quarter project HC.
 *
 * ONE calculation shared by the matrix preview, the Save endpoint and the Assignment Output (Excel export),
 * so they can never disagree.
 *
 * Rules (agreed with Rahul, 2026-10-21):
 *  - Demand  = the manager's OWN sizing rows from the last SUBMITTED version of each project, exact sized quarters.
 *  - Only current and future quarters are planned. Past quarters are actuals and are never touched.
 *  - HC already on the project in the uploaded / hand-edited data (retro or plan rows) stays as it is. Only the
 *    uncovered part of the demand (demand − what the manager's team already carries) is assigned.
 *  - That uncovered HC is split EQUALLY across the people ticked "Yes" for the project (location is not a factor).
 *    A person who cannot take their share (no room left) passes it on to the others.
 *  - Steady state is the FLEXIBLE part of a person's time (SS can be at most 1.0 − project HC). So a new project's HC
 *    is taken out of steady state first, and when a project ends its HC flows back to steady state.
 *  - HC nobody can absorb (everyone full, or nobody ticked) is a HIRING GAP — reported, never forced onto a person.
 *  - 'under review' projects are provisional (not funded): no HC is assigned to them.
 *
 * Auto-assigned HC is persisted in RA_person_project_effort. The engine's share of a row is tracked in the
 * `auto_hc` column (effort_hc = uploaded/hand-set part + auto_hc), so it can always be taken back out exactly.
 * Steady-state rows that shrink to make room carry a NEGATIVE auto_hc.
 */

const EPS = 1e-9;
const r3 = n => Math.round(n * 1000) / 1000;
const toQL = (fy, q) => `Q${q} FY${String(fy).slice(-2)}`;
const qKey = (fy, q) => fy * 4 + q;
const keyToFyQ = k => ({ fy: Math.floor((k - 1) / 4), q: ((k - 1) % 4) + 1 });
const keyToLabel = k => { const { fy, q } = keyToFyQ(k); return toQL(fy, q); };
const normName = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const currentQuarterKey = () => { const d = new Date(); return qKey(d.getFullYear(), Math.ceil((d.getMonth() + 1) / 3)); };

// "Fan, Fai" <-> "Fai Fan"
const nameVariants = n => {
  if (!n) return [];
  if (n.includes(',')) { const p = n.split(',').map(s => s.trim()); return [n, `${p[1]} ${p[0]}`]; }
  if (n.includes(' ')) { const p = n.split(' '); return [n, `${p[p.length - 1]}, ${p.slice(0, -1).join(' ')}`]; }
  return [n];
};
const mgrKeys = n => nameVariants(n).map(normName);

let columnChecked = false;
/**
 * Make sure RA_person_project_effort.auto_hc and m1/m2/m3 exist (idempotent; no-op once checked).
 * m1..m3 = the three calendar months of the quarter as uploaded (effort_hc is their average); NULL = flat quarter.
 */
async function ensureAutoColumn(pool) {
  if (columnChecked) return;
  const [c] = await pool.query(`
    SELECT COLUMN_NAME FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'RA_person_project_effort' AND COLUMN_NAME IN ('auto_hc','m1','m2','m3')`);
  const have = new Set(c.map(x => x.COLUMN_NAME));
  if (!have.has('auto_hc')) await pool.query(`ALTER TABLE RA_person_project_effort ADD COLUMN auto_hc DECIMAL(8,3) NOT NULL DEFAULT 0`);
  for (const col of ['m1', 'm2', 'm3']) {
    if (!have.has(col)) await pool.query(`ALTER TABLE RA_person_project_effort ADD COLUMN ${col} DECIMAL(8,3) NULL DEFAULT NULL`);
  }
  columnChecked = true;
}

/**
 * Load everything the engine needs for one manager's team (or every team when managerName is empty / 'all').
 * Effort rows are loaded WITHOUT the engine's own share (effort_hc − auto_hc), i.e. the "base" data.
 */
async function loadContext(pool, managerName, opts) {
  await ensureAutoColumn(pool);
  const all = !managerName || managerName === 'all';

  let pf = 'WHERE p.is_active = 1', pp = [];
  if (!all) {
    const v = nameVariants(managerName);
    pf = `WHERE p.is_active = 1 AND p.reporting_manager IN (${v.map(() => '?').join(',')})`;
    pp = v;
  }
  const [people] = await pool.query(
    `SELECT person_id, display_name, location, reporting_manager FROM RA_people p ${pf} ORDER BY display_name`, pp);
  const pids = people.map(p => p.person_id);
  const ctx = { people, pids, nowKey: currentQuarterKey() };
  if (!pids.length) { ctx.empty = true; return ctx; }
  const ph = pids.map(() => '?').join(',');

  // Steady-state task names (a project whose name matches one is steady-state work, not a project)
  const [ssTaskRows] = await pool.query(`SELECT task_id, task_name FROM RA_steady_state_tasks`);
  ctx.ssNameSet = new Set(ssTaskRows.map(t => normName(t.task_name)));
  const [ssElig] = await pool.query(`
    SELECT e.person_id, e.task_id, t.task_name
    FROM RA_steady_state_eligibility e JOIN RA_steady_state_tasks t ON t.task_id = e.task_id
    WHERE e.person_id IN (${ph})`, pids);
  ctx.ssByPerson = {};
  ssElig.forEach(e => { (ctx.ssByPerson[e.person_id] = ctx.ssByPerson[e.person_id] || []).push(e); });

  // Base effort rows (uploaded / hand-edited part only)
  const [effortRows] = await pool.query(`
    SELECT e.person_id, e.project_id, e.fiscal_year, e.quarter, (e.effort_hc - e.auto_hc) AS base_hc, e.m1, e.m2, e.m3,
           proj.project_name, proj.retro_category, proj.status
    FROM RA_person_project_effort e JOIN RA_projects proj ON proj.project_id = e.project_id
    WHERE e.person_id IN (${ph}) AND (e.effort_hc - e.auto_hc) > 0.0005`, pids);
  ctx.retro = {};      // personId → quarterKey → [{ project_id, name, hc, ss }]
  const dataKeys = new Set();
  effortRows.forEach(r => {
    const k = qKey(r.fiscal_year, r.quarter);
    dataKeys.add(k);
    const ss = r.retro_category === 'ss_task' || ctx.ssNameSet.has(normName(r.project_name));
    const byQ = ctx.retro[r.person_id] = ctx.retro[r.person_id] || {};
    const row = { project_id: r.project_id, name: r.project_name, hc: Number(r.base_hc), ss };
    // Month-by-month shape of the uploaded data (the quarter HC above is its average). Absent → flat quarter.
    if (r.m1 !== null && r.m2 !== null && r.m3 !== null) row.mon = [Number(r.m1), Number(r.m2), Number(r.m3)];
    (byQ[k] = byQ[k] || []).push(row);
  });
  ctx.dataKeys = [...dataKeys].sort((a, b) => a - b);
  ctx.lastDataKey = ctx.dataKeys.length ? ctx.dataKeys[ctx.dataKeys.length - 1] : -Infinity;
  ctx.minDataKey = ctx.dataKeys.length ? ctx.dataKeys[0] : Infinity;

  // Weighted-average forecast per person (same method as GET /forecast): last 8 data quarters.
  // Only used for quarters AFTER the last data quarter.
  const lookback = ctx.dataKeys.slice(-8);
  ctx.forecastByPerson = {};
  people.forEach(p => {
    const byProj = {};
    lookback.forEach((k, i) => {
      ((ctx.retro[p.person_id] && ctx.retro[p.person_id][k]) || []).forEach(r => {
        const e = byProj[r.project_id] = byProj[r.project_id] || { project_id: r.project_id, name: r.name, ss: r.ss, vals: new Array(lookback.length).fill(0) };
        e.vals[i] += r.hc;
      });
    });
    ctx.forecastByPerson[p.person_id] = Object.values(byProj).map(e => {
      let sw = 0, swv = 0;
      e.vals.forEach((v, i) => { sw += i + 1; swv += (i + 1) * v; });
      return { project_id: e.project_id, name: e.name, ss: e.ss, hc: Math.round((swv / (sw || 1)) * 100) / 100, fc: true };
    }).filter(e => e.hc > 0);
  });

  // Eligibility (Yes / Expert)
  const [elig] = await pool.query(`
    SELECT person_id, project_id, capability FROM RA_resource_eligibility
    WHERE person_id IN (${ph}) AND capability IN ('yes','expert')`, pids);
  ctx.eligDb = elig;

  // Demand: manager's own rows, last SUBMITTED version of each project
  const [dem] = await pool.query(`
    SELECT sh.manager_name, v.project_id, p.project_name, p.status, p.retro_category,
           sq.fiscal_year, sq.quarter, SUM(sq.headcount) AS hc
    FROM RA_staging_headcount sh
    JOIN RA_sizing_versions v ON v.version_id = sh.version_id
    JOIN RA_projects p ON p.project_id = v.project_id
    JOIN RA_staging_quarterly sq ON sq.staging_id = sh.staging_id AND sq.headcount > 0
    WHERE sh.manager_name IS NOT NULL AND sh.manager_name != ''
      AND p.status NOT IN ('cancelled','closed') AND (p.is_test = 0 OR p.is_test IS NULL)
      AND v.version_id = (SELECT MAX(v2.version_id) FROM RA_sizing_versions v2
                          WHERE v2.project_id = v.project_id AND v2.version_status IN ('submitted','locked','bu_approved'))
    GROUP BY sh.manager_name, v.project_id, p.project_name, p.status, p.retro_category, sq.fiscal_year, sq.quarter`);
  ctx.projectInfo = {};
  ctx.demandByMgr = {};   // normalised manager name → projectId → quarterKey → hc
  dem.forEach(r => {
    ctx.projectInfo[r.project_id] = { project_id: r.project_id, name: r.project_name, status: r.status, ss: r.retro_category === 'ss_task' || ctx.ssNameSet.has(normName(r.project_name)) };
    const m = ctx.demandByMgr[normName(r.manager_name)] = ctx.demandByMgr[normName(r.manager_name)] || {};
    const pj = m[r.project_id] = m[r.project_id] || {};
    const k = qKey(r.fiscal_year, r.quarter);
    pj[k] = (pj[k] || 0) + Number(r.hc);
  });

  // Forecast placeholders (projects not sized yet): only when asked for (opts.includeEstimates). They enter as extra demand
  // under the pseudo project id -forecast_id, are planned LAST (after funded and under-review projects) and are flagged
  // estimated everywhere. They are never written to RA_person_project_effort (savePlan skips them).
  ctx.includesEstimates = false;
  if (opts && opts.includeEstimates) {
    const fe = require('./forecastEstimate');
    const { demand, eligibility, no, usual, open } = await fe.loadActiveDemand(pool);
    ctx.includesEstimates = true;
    ctx.estNo = new Set();      // 'person:-forecast_id' explicitly ticked No on an estimate
    ctx.estUsual = new Map();   // -forecast_id → Set(person_id) who usually work on the projects of the estimate's bucket
    open.forEach(f => {
      ctx.projectInfo[-f.forecast_id] = { project_id: -f.forecast_id, name: f.project_name, status: 'forecast', ss: false, estimated: true, forecast_id: f.forecast_id };
    });
    demand.forEach(d => {
      const pid = -d.forecast_id;
      const m = ctx.demandByMgr[normName(d.manager_name)] = ctx.demandByMgr[normName(d.manager_name)] || {};
      const pj = m[pid] = m[pid] || {};
      pj[d.key] = (pj[d.key] || 0) + d.hc;
    });
    const pidSet = new Set(pids);
    eligibility.forEach(e => { if (pidSet.has(e.person_id)) ctx.eligDb.push({ person_id: e.person_id, project_id: -e.forecast_id, capability: e.capability }); });
    no.forEach(e => ctx.estNo.add(`${e.person_id}:${-e.forecast_id}`));
    open.forEach(f => ctx.estUsual.set(-f.forecast_id, new Set((usual[f.forecast_id] || []).filter(id => pidSet.has(id)))));
  }
  return ctx;
}

/** Demand map (projectId → quarterKey → hc) for one manager name. */
function demandFor(ctx, managerName) {
  const out = {};
  for (const mk of mgrKeys(managerName)) {
    const m = ctx.demandByMgr[mk]; if (!m) continue;
    for (const pid of Object.keys(m)) {
      out[pid] = out[pid] || {};
      for (const k of Object.keys(m[pid])) out[pid][k] = (out[pid][k] || 0) + m[pid][k];
    }
  }
  return out;
}

/** Set (of string ids) of the funded-or-not, non-steady-state projects a manager has sized demand on. */
function demandProjectSet(ctx, managerName) {
  const d = demandFor(ctx, managerName);
  return new Set(Object.keys(d).filter(pid => ctx.projectInfo[pid] && !ctx.projectInfo[pid].ss));
}

/**
 * Base rows of a person in a quarter: the uploaded/hand-set data; or, after the last data quarter, the
 * weighted-average forecast. Forecast rows of projects in `demandProjectIds` are dropped — the sizing demand
 * supersedes a projection of the past.
 */
function baseRows(ctx, personId, k, demandProjectIds) {
  const rows = (ctx.retro[personId] && ctx.retro[personId][k]) || [];
  if (rows.length) return { mode: 'data', rows };
  if (k > ctx.lastDataKey) {
    const fc = (ctx.forecastByPerson[personId] || []).filter(r => !(demandProjectIds && demandProjectIds.has(String(r.project_id))));
    return { mode: 'forecast', rows: fc };
  }
  return { mode: 'data', rows: [] };
}

/** Split `total` equally across slots, each limited by caps[i]; leftover is passed to those with room. */
// Estimates with ticked people may grow beyond what the curve asks, up to the ticked people's room. EST_SWELL_CAP limits that to a
// multiple of the ask (e.g. 1.5). Infinity (default) = no limit.
const EST_SWELL_CAP = process.env.ESTIMATE_SWELL_CAP ? Number(process.env.ESTIMATE_SWELL_CAP) : Infinity;

function waterFill(total, caps) {
  const out = caps.map(() => 0);
  let rem = total;
  let active = caps.map((c, i) => i).filter(i => caps[i] > EPS);
  while (rem > EPS && active.length) {
    const share = rem / active.length;
    let used = 0; const next = [];
    for (const i of active) {
      const give = Math.min(share, caps[i] - out[i]);
      out[i] += give; used += give;
      if (caps[i] - out[i] > EPS) next.push(i);
    }
    rem -= used;
    if (used < 1e-12) break;
    active = next;
  }
  return { out, rem };
}

/**
 * Run the plan.
 * @param ctx      from loadContext
 * @param pending  optional [{ person_id, project_id, capability }] — unsaved matrix ticks that override the DB
 *                 eligibility (capability '' / null removes the tick).
 */
function runPlan(ctx, pending, opts) {
  // Under-review projects are planned exactly like funded ones (after them, so funded demand gets first pick of steady state);
  // preview, Save and the Assignment Output all use the same rule. Pass { includeProvisional: false } to leave them out.
  const includeProvisional = !(opts && opts.includeProvisional === false);
  const result = { assignments: [], ss_adjustments: [], gaps: [], projects: [], provisional: [], people: {}, breakdown: {}, estimate_adjustments: [] };
  if (ctx.empty) return result;

  // eligibility set: DB overlaid with pending
  const elig = new Set(ctx.eligDb.map(e => `${e.person_id}:${e.project_id}`));
  (pending || []).forEach(p => {
    const key = `${p.person_id}:${p.project_id}`;
    if (p.capability === 'yes' || p.capability === 'expert') elig.add(key); else elig.delete(key);
  });

  // group people by manager
  const teams = new Map();
  ctx.people.forEach(p => {
    const key = p.reporting_manager || '';
    if (!teams.has(key)) teams.set(key, []);
    teams.get(key).push(p);
  });

  for (const [mgr, team] of teams) {
    const demand = demandFor(ctx, mgr);
    const demandSet = demandProjectSet(ctx, mgr);
    const projIds = [...demandSet];
    if (!projIds.length) continue;
    const teamIds = team.map(p => p.person_id);

    // quarters to plan: current .. last demand quarter
    let maxKey = -Infinity;
    projIds.forEach(pid => Object.keys(demand[pid]).forEach(k => { if (+k > maxKey) maxKey = +k; }));

    const projSummary = {};   // pid → { project_id, name, status, quarters: Map(k → row) }
    const note = (pid, k, patch) => {
      const info = ctx.projectInfo[pid];
      const ps = projSummary[pid] = projSummary[pid] || { project_id: +pid, project_name: info.name, status: info.status, quarters: {} };
      ps.quarters[k] = Object.assign(ps.quarters[k] || { key: +k, label: keyToLabel(+k), demand: 0, existing: 0, assigned: 0, gap: 0 }, patch);
    };

    let estPrev = {};   // estimates: who carried each one last quarter
    const lastBreakdownKey = Math.max(maxKey, ctx.nowKey + 11, isFinite(ctx.lastDataKey) ? ctx.lastDataKey : 0);   // all quarters that have data
    for (let k = Math.max(ctx.nowKey, 0); k <= lastBreakdownKey; k++) {
      // project HC each person already carries this quarter (non-SS base rows) — the room left is 1 − this
      const base = {};
      const baseByProj = {};   // pid → HC the team already has on it
      teamIds.forEach(id => {
        const b = baseRows(ctx, id, k, demandSet);
        base[id] = 0;
        b.rows.forEach(r => {
          if (r.ss) return;
          base[id] += r.hc;
          baseByProj[r.project_id] = (baseByProj[r.project_id] || 0) + r.hc;
        });
      });
      const load = Object.assign({}, base);
      const estCur = {};   // pid → people an estimate was spread over this quarter (kept for next quarter's continuity)

      // projects with demand this quarter; most constrained (fewest eligible people) first
      const todo = projIds.filter(pid => (demand[pid][k] || 0) > EPS).map(pid => ({
        pid, people: team.filter(p => elig.has(`${p.person_id}:${pid}`))
      })).sort((a, b) =>
        (ctx.projectInfo[a.pid].status === 'forecast') - (ctx.projectInfo[b.pid].status === 'forecast')           // estimates last
        || (ctx.projectInfo[a.pid].status === 'under review') - (ctx.projectInfo[b.pid].status === 'under review')   // funded first
        // among estimates: the ones with explicit ticks go first, so a manager's choices are never taken by an estimate that has none
        || (ctx.projectInfo[a.pid].status === 'forecast' && ctx.projectInfo[b.pid].status === 'forecast' ? (a.people.length === 0) - (b.people.length === 0) : 0)
        || a.people.length - b.people.length || a.pid - b.pid);

      // Estimates are placed after the sized projects. Those with people ticked Yes share those people's room jointly (see
      // jointEstimates below); the others go through the normal per-project path (usual people, then anyone with room).
      const isEst = pid => ctx.projectInfo[pid].status === 'forecast';
      const todoEstTicked = todo.filter(t => isEst(t.pid) && t.people.length);
      const todoReg = todo.filter(t => !isEst(t.pid));
      const todoEstOther = todo.filter(t => isEst(t.pid) && !t.people.length);

      // One assignment of `hc` of a project to a person (updates the person's load)
      const pushAssign = (pid, p, hc, basis) => {
        const info = ctx.projectInfo[pid];
        const prov = info.status === 'under review', est = info.status === 'forecast';
        load[p.person_id] += hc;
        const a = { person_id: p.person_id, person_name: p.display_name, project_id: +pid, project_name: info.name, key: k, label: keyToLabel(k), ...keyToFyQ(k), hc, provisional: prov, estimated: est };
        if (est) { a.basis = basis; (estCur[pid] = estCur[pid] || new Set()).add(p.person_id); }
        result.assignments.push(a);
        const pp = result.people[p.person_id] = result.people[p.person_id] || {};
        const lab = keyToLabel(k);
        pp[lab] = pp[lab] || { project_hc: 0, auto_hc: 0 };
        pp[lab].auto_hc = r3(pp[lab].auto_hc + hc);
      };

      const planOne = ({ pid, people }) => {
        const info = ctx.projectInfo[pid];
        const d = r3(demand[pid][k]);
        const existing = r3(baseByProj[pid] || 0);
        const prov = info.status === 'under review';
        const est = info.status === 'forecast';
        if (prov && !result.provisional.includes(+pid)) result.provisional.push(+pid);
        if (prov && !includeProvisional) {
          note(pid, k, { demand: d, existing, assigned: 0, gap: 0 });
          return;
        }
        const residual = Math.max(0, d - existing);
        if (residual <= 0.0005) { note(pid, k, { demand: d, existing, assigned: 0, gap: 0 }); return; }

        let assigned = 0;
        // Put `amount` HC on `cands`, evenly by room (water-fill). Returns what was placed. `basis` says why these people.
        const placeAmong = (cands, amount, basis) => {
          if (!cands.length || amount <= 0.0005) return 0;
          const caps = cands.map(p => { const room = 1 - load[p.person_id]; return room < 0.005 ? 0 : room; });   // < 0.005 HC of room counts as full
          const { out } = waterFill(amount, caps);
          // Rounding each share to 3 decimals can make the total drift (0.5 over 3 people → 0.167 × 3 = 0.501) and
          // push someone who is exactly full over 1.0. Put that fraction on the person with the most room left
          // (not on someone already at the limit), so the total matches the demand exactly.
          const rounded = out.map(r3);
          const drift = r3(out.reduce((s, v) => s + v, 0) - rounded.reduce((s, v) => s + v, 0));
          if (Math.abs(drift) > 0.0004) {
            let best = -1, bestRoom = -Infinity;
            rounded.forEach((v, i) => { const room = caps[i] - v; if (room > bestRoom && v + drift >= 0) { bestRoom = room; best = i; } });
            if (best >= 0 && (drift < 0 || bestRoom >= drift)) rounded[best] = r3(rounded[best] + drift);
          }
          let placed = 0;
          rounded.forEach((hc, i) => { if (hc > 0.0005) { push(cands[i], hc, basis); placed += hc; } });
          return placed;
        };
        const push = (p, hc, basis) => { assigned += hc; pushAssign(pid, p, hc, basis); };

        placeAmong(people, residual, 'ticked');   // 1st priority: the people the manager ticked Yes
        if (est) {
          // Estimates only. Nobody (or not enough) ticked → 2nd: people who usually work on the projects of the estimate's bucket,
          // 3rd: anyone with spare capacity. People ticked No on this estimate are never used. What is left over is a gap.
          const usualSet = (ctx.estUsual && ctx.estUsual.get(+pid)) || new Set();
          const noKey = p => ctx.estNo && ctx.estNo.has(`${p.person_id}:${pid}`);
          const tickedIds = new Set(people.map(p => p.person_id));
          const usualP = team.filter(p => !tickedIds.has(p.person_id) && usualSet.has(p.person_id) && !noKey(p));
          placeAmong(usualP, r3(residual - assigned), 'usual');
          const used = new Set([...tickedIds, ...usualP.map(p => p.person_id)]);
          const prev = estPrev[pid] || new Set();
          const availP = team.filter(p => !used.has(p.person_id) && !noKey(p) && 1 - load[p.person_id] >= 0.005)
            // keep last quarter's people first (continuity), then the most room, then a stable order
            .sort((a, b) => (prev.has(b.person_id) - prev.has(a.person_id)) || ((1 - load[b.person_id]) - (1 - load[a.person_id])) || a.person_id - b.person_id);
          for (const p of availP) {
            const left = r3(residual - assigned);
            if (left <= 0.0005) break;
            const hc = r3(Math.min(left, 1 - load[p.person_id]));
            if (hc > 0.0005) push(p, hc, 'available');
          }
        }
        assigned = r3(assigned);
        const gap = r3(Math.max(0, residual - assigned));
        note(pid, k, { demand: d, existing, assigned, gap });
        if (gap > 0.0005) {
          result.gaps.push({
            manager: mgr, project_id: +pid, project_name: info.name, key: k, label: keyToLabel(k), hc: gap, provisional: prov, estimated: est,
            // no_capacity = people exist but are full → a real HIRING gap; no_one_ticked = simply not assigned yet.
            // An estimate always tries everyone on the team, so what is left is always a capacity (hiring) gap.
            kind: (people.length || est) ? 'no_capacity' : 'no_one_ticked',
            reason: est ? 'Nobody on the team has spare capacity for this estimate' : (people.length ? 'Everyone ticked is already at full capacity' : 'Nobody is ticked Yes for this project')
          });
        }
      };

      /**
       * Estimates with people ticked Yes. The ticked people's room is shared by ALL the estimates they are ticked on, in proportion
       * to what each estimate asks for this quarter — so it works both ways:
       *   - they are short of room → every estimate shrinks to fit (0.3 free, three estimates asking 0.5 → 0.1 each), no hiring gap;
       *   - they have more room than the estimates ask → the estimates grow to use it (optionally capped, see EST_SWELL_CAP).
       * A person's room = 1 − what they already carry (steady state gives way, as everywhere else).
       */
      const jointEstimates = () => {
        if (!todoEstTicked.length) return;
        const items = todoEstTicked.map(({ pid, people }) => ({ pid, people, d: r3(demand[pid][k]) }));
        const room = p => { const r = 1 - load[p.person_id]; return r < 0.005 ? 0 : r; };
        const asked = new Map();      // person → total HC asked of them by the estimates they are ticked on
        items.forEach(it => it.people.forEach(p => asked.set(p.person_id, (asked.get(p.person_id) || 0) + it.d)));
        const rooms = new Map(items.flatMap(it => it.people).map(p => [p.person_id, room(p)]));   // snapshot before anything is placed
        items.forEach(it => { it.x = it.people.map(p => rooms.get(p.person_id) * it.d / asked.get(p.person_id)); });
        if (isFinite(EST_SWELL_CAP)) items.forEach(it => {
          const tot = it.x.reduce((s, v) => s + v, 0), lim = EST_SWELL_CAP * it.d;
          if (tot > lim) it.x = it.x.map(v => v * lim / tot);
        });
        items.forEach(it => {
          let placed = 0;
          it.people.forEach((p, i) => {
            const hc = Math.floor(it.x[i] * 1000 + 1e-9) / 1000;    // round down: a person is never pushed over their room
            if (hc > 0.0005) { pushAssign(it.pid, p, hc, 'ticked'); placed += hc; }
          });
          placed = r3(placed);
          note(it.pid, k, { demand: it.d, existing: 0, assigned: placed, gap: 0 });
          if (Math.abs(placed - it.d) > 0.0005) {
            result.estimate_adjustments.push({ manager: mgr, project_id: +it.pid, project_name: ctx.projectInfo[it.pid].name, key: k, label: keyToLabel(k), asked: it.d, placed, delta: r3(placed - it.d) });
          }
        });
      };

      todoReg.forEach(planOne);
      jointEstimates();
      todoEstOther.forEach(planOne);

      estPrev = estCur;

      // person totals (for the preview cards). Steady state only ever shrinks to make room (never grows):
      // ss = min(SS already in the data, 1 − project HC)
      teamIds.forEach(id => {
        const lab = keyToLabel(k);
        const pp = result.people[id];
        if (pp && pp[lab]) {
          const b = baseRows(ctx, id, k, demandSet);
          const ssRows = b.rows.filter(r => r.ss);
          const ssOld = ssRows.reduce((s, r) => s + r.hc, 0);
          const target = Math.max(0, 1 - load[id]);
          pp[lab].project_hc = r3(load[id]);
          pp[lab].base_project_hc = r3(base[id]);
          pp[lab].ss_before = r3(ssOld);
          pp[lab].ss_hc = r3(Math.min(ssOld, target));
          // Shrink the person's steady-state rows proportionally to make room (stored as a negative auto_hc)
          if (b.mode === 'data' && ssOld > target + 0.0005) {
            ssRows.forEach(r => {
              const delta = r3(r.hc * target / ssOld) - r.hc;
              if (Math.abs(delta) > 0.0004) result.ss_adjustments.push({ person_id: id, project_id: r.project_id, name: r.name, key: k, label: lab, ...keyToFyQ(k), delta: r3(delta) });
            });
          }
        }
      });

      // Full "after" breakdown of every team member this quarter — what the matrix draws as the 1.0 HC bar
      const lab = keyToLabel(k);
      const autoNow = {};
      result.assignments.filter(a => a.key === k).forEach(a => { (autoNow[a.person_id] = autoNow[a.person_id] || []).push(a); });
      teamIds.forEach(id => {
        const b = baseRows(ctx, id, k, demandSet);
        const projects = [], ssRows = [];
        b.rows.forEach(r => (r.ss ? ssRows : projects).push({ project_id: r.project_id, name: r.name, hc: r.hc, auto: 0 }));
        (autoNow[id] || []).forEach(a => {
          const ex = projects.find(x => x.project_id === a.project_id);
          if (ex) { ex.hc = r3(ex.hc + a.hc); ex.auto = r3(ex.auto + a.hc); }
          else projects.push({ project_id: a.project_id, name: a.project_name, hc: a.hc, auto: a.hc, provisional: a.provisional, estimated: a.estimated });
        });
        const projHc = projects.reduce((s, x) => s + x.hc, 0);
        const ssOld = ssRows.reduce((s, x) => s + x.hc, 0), target = Math.max(0, 1 - projHc);
        const ss = ssOld > target + 0.0005 ? ssRows.map(x => ({ ...x, was: x.hc, hc: r3(x.hc * target / ssOld) })) : ssRows;
        const ssHc = ss.reduce((s, x) => s + x.hc, 0);
        (result.breakdown[id] = result.breakdown[id] || {})[lab] = {
          projects: projects.filter(x => x.hc > 0.0004).sort((a, b) => b.hc - a.hc),
          ss: ss.filter(x => x.hc > 0.0004),
          free: r3(Math.max(0, 1 - projHc - ssHc)),
          over: r3(Math.max(0, projHc + ssHc - 1))
        };
      });
    }

    Object.values(projSummary).forEach(ps => {
      result.projects.push({ ...ps, quarters: Object.values(ps.quarters).sort((a, b) => a.key - b.key) });
    });
  }

  result.projects.sort((a, b) => a.project_name.localeCompare(b.project_name));
  const hire = {}, unassigned = {};
  result.gaps.forEach(g => {
    const t = g.kind === 'no_capacity' ? hire : unassigned;
    t[g.label] = r3((t[g.label] || 0) + g.hc);
  });
  const sumKind = kind => r3(result.gaps.filter(g => g.kind === kind).reduce((s, g) => s + g.hc, 0));
  result.summary = {
    assigned_hc: r3(result.assignments.reduce((s, a) => s + a.hc, 0)),
    people_affected: Object.keys(result.people).length,
    hiring_gap_hc: sumKind('no_capacity'),
    unassigned_hc: sumKind('no_one_ticked'),
    hiring_gap_by_quarter: hire,
    unassigned_by_quarter: unassigned
  };
  return result;
}

/**
 * Month-by-month placement of the engine's quarterly assignments (used by the Assignment Output).
 * The engine decides WHO gets HOW MUCH per quarter (an average). This decides WHEN inside the quarter:
 *   1. each person's share goes on the months where they still have room (never on a month that is already full);
 *   2. the project's total in each month is then balanced towards the sized demand for that month, by moving HC
 *      between months for whoever has room — so when one person is full in some months, the others take up the slack
 *      and the project reads the same number every month (e.g. 0.50 / 0.50 / 0.50), not 0.43 / 0.43 / 0.63.
 * Every person's quarter average stays exactly what the engine assigned.
 * Returns idx[personId][quarterKey][projectId] = [m1, m2, m3].
 */
function monthlyAuto(ctx, plan, demandSetOf) {
  const idx = {};
  const loadCache = {};
  const baseMon = (personId, k) => {            // project (non-SS) HC the person carries per month from uploaded data
    const ck = `${personId}|${k}`;
    if (loadCache[ck]) return loadCache[ck];
    const m = [0, 0, 0];
    baseRows(ctx, personId, k, demandSetOf(personId)).rows.forEach(r => {
      if (r.ss) return;
      for (let i = 0; i < 3; i++) m[i] += r.mon ? r.mon[i] : r.hc;
    });
    return (loadCache[ck] = m);
  };
  const projBaseMon = (personIds, pid, k) => {  // what the team already carries on this project per month
    const m = [0, 0, 0];
    personIds.forEach(id => baseRows(ctx, id, k, demandSetOf(id)).rows.forEach(r => {
      if (r.ss || r.project_id !== pid) return;
      for (let i = 0; i < 3; i++) m[i] += r.mon ? r.mon[i] : r.hc;
    }));
    return m;
  };
  const spreadInto = (total, rooms) => {         // equal split over months, each capped by its room; overflow evenly
    const o = [0, 0, 0]; let rem = total, act = [0, 1, 2].filter(i => rooms[i] > 0.0005);
    while (rem > 0.0005 && act.length) {
      const share = rem / act.length; let used = 0; const next = [];
      for (const i of act) { const g = Math.min(share, rooms[i] - o[i]); o[i] += g; used += g; if (rooms[i] - o[i] > 0.0005) next.push(i); }
      rem -= used; if (used < 1e-9) break; act = next;
    }
    if (rem > 0.0005) for (let i = 0; i < 3; i++) o[i] += rem / 3;
    return o;
  };

  // group the plan's assignments by quarter + project, in the order the engine placed them
  const groups = new Map();
  plan.assignments.forEach(a => {
    const gk = `${a.key}|${a.project_id}`;
    if (!groups.has(gk)) groups.set(gk, { key: a.key, pid: a.project_id, rows: [] });
    groups.get(gk).rows.push(a);
  });
  const demandOf = {};
  (plan.projects || []).forEach(p => p.quarters.forEach(q => { demandOf[`${q.key}|${p.project_id}`] = q.demand; }));
  const mgrOf = {}; ctx.people.forEach(p => { mgrOf[p.person_id] = p.reporting_manager || ''; });

  for (const g of groups.values()) {
    const { key: k, pid, rows } = g;
    const ids = rows.map(r => r.person_id);
    const team = ctx.people.filter(p => (p.reporting_manager || '') === mgrOf[ids[0]]).map(p => p.person_id);
    const d = demandOf[`${k}|${pid}`] || 0;
    const ex = projBaseMon(team, pid, k);
    const R = ex.map(v => Math.max(0, d - v));
    const avgR = (R[0] + R[1] + R[2]) / 3;
    const total = rows.reduce((t, r) => t + r.hc, 0);
    const T = avgR > 0.0005 ? R.map(v => v * total / avgR) : [total, total, total];   // month targets (sum = 3 × assigned)

    const rooms = {}, x = {};
    rows.forEach(r => {
      const base = baseMon(r.person_id, k).slice();
      // earlier projects already placed this quarter take room too
      const placed = (idx[r.person_id] && idx[r.person_id][k]) || {};
      Object.values(placed).forEach(arr => { for (let i = 0; i < 3; i++) base[i] += arr[i]; });
      rooms[r.person_id] = base.map(v => Math.max(0, 1 - v));
      x[r.person_id] = spreadInto(3 * r.hc, rooms[r.person_id]);
    });

    // balance months: move HC from months that run above target to months below it, for whoever has room
    for (let pass = 0; pass < 40; pass++) {
      const S = [0, 1, 2].map(i => ids.reduce((t, id) => t + x[id][i], 0));
      const diff = S.map((v, i) => v - T[i]);
      let moved = false;
      for (let from = 0; from < 3; from++) for (let to = 0; to < 3; to++) {
        if (from === to) continue;
        const dF = S[from] - T[from], dT = S[to] - T[to];
        if (dF <= 0.0005 || dT >= -0.0005) continue;
        let need = Math.min(dF, -dT);
        const cands = ids.map(id => ({ id, can: Math.min(x[id][from], rooms[id][to] - x[id][to]) })).filter(c => c.can > 0.0005).sort((a, b) => b.can - a.can);
        for (const c of cands) {
          if (need <= 0.0005) break;
          const mv = Math.min(need, c.can);
          x[c.id][from] -= mv; x[c.id][to] += mv; S[from] -= mv; S[to] += mv; need -= mv; moved = true;
        }
      }
      if (!moved) break;
    }

    rows.forEach(r => {
      const m = x[r.person_id].map(v => Math.max(0, r3(v)));
      const byQ = idx[r.person_id] = idx[r.person_id] || {};
      const byP = byQ[k] = byQ[k] || {};
      byP[pid] = m.map((v, i) => r3((byP[pid] ? byP[pid][i] : 0) + v));
    });
  }
  return idx;
}

/** Index assignments for quick lookup: personId → quarterKey → [{ project_id, name, hc }] */
function indexAssignments(plan) {
  const idx = {};
  plan.assignments.forEach(a => {
    const byQ = idx[a.person_id] = idx[a.person_id] || {};
    (byQ[a.key] = byQ[a.key] || []).push({ project_id: a.project_id, name: a.project_name, hc: a.hc, provisional: !!a.provisional, estimated: !!a.estimated });
  });
  return idx;
}

/**
 * Persist the plan for the people in ctx: first take back every earlier auto assignment, then write the new
 * ones. Idempotent — saving twice gives the same rows.
 */
async function savePlan(pool, ctx, plan) {
  await ensureAutoColumn(pool);
  if (ctx.empty) return { removed: 0, written: 0 };
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const ph = ctx.pids.map(() => '?').join(',');
    const [rm] = await conn.query(
      `UPDATE RA_person_project_effort SET effort_hc = effort_hc - auto_hc, auto_hc = 0
       WHERE person_id IN (${ph}) AND auto_hc <> 0`, ctx.pids);
    await conn.query(
      `DELETE FROM RA_person_project_effort WHERE person_id IN (${ph}) AND set_by = 'auto_plan' AND effort_hc <= 0.0005`, ctx.pids);
    for (const a of plan.assignments) {
      if (a.project_id < 0) continue;   // forecast placeholders are never persisted as effort rows
      await conn.query(`
        INSERT INTO RA_person_project_effort (person_id, project_id, fiscal_year, quarter, effort_hc, auto_hc, set_by)
        VALUES (?, ?, ?, ?, ?, ?, 'auto_plan')
        ON DUPLICATE KEY UPDATE effort_hc = effort_hc + VALUES(effort_hc), auto_hc = auto_hc + VALUES(auto_hc), set_at = NOW()`,
        [a.person_id, a.project_id, a.fy, a.q, a.hc, a.hc]);
    }
    for (const a of plan.ss_adjustments || []) {
      await conn.query(
        `UPDATE RA_person_project_effort SET effort_hc = effort_hc + ?, auto_hc = auto_hc + ?, set_at = NOW()
         WHERE person_id = ? AND project_id = ? AND fiscal_year = ? AND quarter = ?`,
        [a.delta, a.delta, a.person_id, a.project_id, a.fy, a.q]);
    }
    await conn.commit();
    return { removed: rm.affectedRows, written: plan.assignments.length, ss_adjusted: (plan.ss_adjustments || []).length };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

module.exports = {
  loadContext, runPlan, savePlan, indexAssignments, monthlyAuto, baseRows, demandFor, demandProjectSet, ensureAutoColumn,
  helpers: { r3, toQL, qKey, keyToFyQ, keyToLabel, normName, nameVariants, currentQuarterKey }
};
