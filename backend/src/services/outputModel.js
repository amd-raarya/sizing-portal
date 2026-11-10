// Assignment Output model.
//
// ONE code path builds the lines of the Assignment Output. The Excel writer (GET /allocation/export) and the
// on-screen preview (GET /allocation/output-preview) both consume the object returned by buildOutputModel(),
// so the preview and the downloaded file can never disagree.
//
// Per-manager exclusions: projects a manager has chosen to leave OUT of the output. They are applied here, after
// the engine has planned everything, so nobody else's assignments move and the matrix / views are untouched.

const engine = require('./assignmentEngine');

const normName = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const r3 = n => Math.round(n * 1000) / 1000;
const sumHc = arr => arr.reduce((s, x) => s + x.hc, 0);
const qKey = (fy, q) => fy * 4 + q;
const parseQL = s => { const m = String(s || '').match(/Q(\d)\s*FY(\d{2})/i); return m ? { q: parseInt(m[1]), fy: 2000 + parseInt(m[2]) } : null; };
const Q_MONTHS = { Q1: ['Jan', 'Feb', 'Mar'], Q2: ['Apr', 'May', 'Jun'], Q3: ['Jul', 'Aug', 'Sep'], Q4: ['Oct', 'Nov', 'Dec'] };

// ── Exclusion storage (per manager) ─────────────────────────────────────────────────────────────────────────
let exclusionsReady = false;
async function ensureExclusionsTable(pool) {
  if (exclusionsReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS RA_output_exclusions (
      id           INT AUTO_INCREMENT PRIMARY KEY,
      manager_name VARCHAR(200) NOT NULL DEFAULT '',
      project_id   INT NOT NULL,
      excluded_by  VARCHAR(200) NULL,
      created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_output_excl (manager_name, project_id),
      KEY idx_output_excl_mgr (manager_name)
    )`);
  exclusionsReady = true;
}
async function loadExclusions(pool, managerName) {
  await ensureExclusionsTable(pool);
  const [rows] = await pool.query('SELECT project_id FROM RA_output_exclusions WHERE manager_name = ?', [managerName || '']);
  return new Set(rows.map(r => r.project_id));
}
// Replace the whole set for a manager.
async function saveExclusions(pool, managerName, projectIds, by) {
  await ensureExclusionsTable(pool);
  const ids = [...new Set((projectIds || []).map(Number).filter(n => Number.isInteger(n) && n > 0))];
  const mgr = managerName || '';
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('DELETE FROM RA_output_exclusions WHERE manager_name = ?', [mgr]);
    for (const id of ids) {
      await conn.query('INSERT INTO RA_output_exclusions (manager_name, project_id, excluded_by) VALUES (?,?,?)', [mgr, id, by || null]);
    }
    await conn.commit();
  } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
  return ids;
}

// ── Quarter range ───────────────────────────────────────────────────────────────────────────────────────────
const toQL = (fy, q) => `Q${q} FY${String(fy).slice(-2)}`;
function resolveQuarters(ctx, plan, fromQuarter, toQuarter) {
  const nowKey = ctx.nowKey;
  const planKeys = plan.assignments.map(a => a.key).concat(plan.gaps.map(g => g.key));
  const maxPlanKey = planKeys.length ? Math.max(...planKeys) : -Infinity;
  const fromP = parseQL(fromQuarter), toP = parseQL(toQuarter);
  let fromKey = fromP ? qKey(fromP.fy, fromP.q) : (isFinite(ctx.minDataKey) ? ctx.minDataKey : nowKey - 2);
  let toKey = toP ? qKey(toP.fy, toP.q) : (isFinite(ctx.lastDataKey) || isFinite(maxPlanKey) ? Math.max(ctx.lastDataKey, maxPlanKey) : nowKey + 6);
  if (toKey < fromKey) [fromKey, toKey] = [toKey, fromKey];
  if (toKey - fromKey > 63) toKey = fromKey + 63;   // hard cap: 16 years
  const quarters = [];
  for (let k = fromKey; k <= toKey; k++) {
    const fy = Math.floor((k - 1) / 4), q = ((k - 1) % 4) + 1;
    quarters.push({ q, fy, label: toQL(fy, q) });
  }
  return quarters;
}

// ── The model ───────────────────────────────────────────────────────────────────────────────────────────────
// opts: { format: 'monthly'|'weekly', quarters, excludedIds: Set<number> }
function buildOutputModel(ctx, plan, opts) {
  const format = opts.format || 'monthly';
  const quarters = opts.quarters;
  const excludedIds = opts.excludedIds || new Set();
  const people = ctx.people;
  const autoIdx = engine.indexAssignments(plan);   // personId → quarterKey → [{ project_id, name, hc }]
  const personMgr = {};
  people.forEach(p => { personMgr[p.person_id] = p.reporting_manager || ''; });
  const demandSets = {};
  const demandSetOf = personId => { const m = personMgr[personId]; return demandSets[m] || (demandSets[m] = engine.demandProjectSet(ctx, m)); };
  const autoMonIdx = engine.monthlyAuto(ctx, plan, pid => demandSetOf(pid));   // personId → quarterKey → projectId → [m1, m2, m3]
  const ssByPerson = ctx.ssByPerson;

  // ── Per person / quarter model ───────────────────────────────────────────
  // mode: 'data'     → rows come straight from the uploaded retro/plan data (regular colouring)
  //       'forecast' → no data for that quarter: weighted-average forecast (highlighted)
  //       'plan'     → no data for the quarter, only engine-assigned HC (highlighted)
  // Rows with auto:true were added by the assignment engine from the eligibility ticks + sized demand.
  const cache = {};
  function cellFor(personId, qLabel) {
    const ck = `${personId}|${qLabel}`;
    if (cache[ck]) return cache[ck];
    const m = parseQL(qLabel);
    const k = m ? qKey(m.fy, m.q) : 0;
    const b = engine.baseRows(ctx, personId, k, demandSetOf(personId));
    const projects = [], retroSs = [];
    b.rows.forEach(r => (r.ss ? retroSs : projects).push({ project_id: r.project_id, name: r.name, hc: r.hc, baseHc: r.hc, mon: r.mon }));
    const autos = (autoIdx[personId] && autoIdx[personId][k]) || [];
    let mode = b.mode;
    if (autos.length) {
      if (!b.rows.length) mode = 'plan';
      autos.forEach(a => {
        const ex = projects.find(x => x.project_id === a.project_id);
        if (ex) { ex.hc = r3(ex.hc + a.hc); ex.auto = true; ex.autoAdd = (ex.autoAdd || 0) + a.hc; }
        else projects.push({ project_id: a.project_id, name: a.name, hc: a.hc, baseHc: 0, autoAdd: a.hc, auto: true, prov: !!a.provisional, est: !!a.estimated });
      });
    }
    const projHc = r3(sumHc(projects));
    // Steady state is the flexible part: when the engine added project HC, SS shrinks to fit (never grows)
    let ssAdjusted = false;
    if (autos.length) {
      const oldSs = sumHc(retroSs), target = Math.max(0, r3(1 - projHc));
      if (oldSs > target + 0.0005) {
        const f = target / oldSs;
        retroSs.forEach(s => { s.hc = r3(s.hc * f); });
        ssAdjusted = true;
      }
    }
    const retroSsHc = r3(sumHc(retroSs));
    const remainingRaw = Math.max(0, r3(1 - projHc - retroSsHc));
    const remaining = remainingRaw < 0.005 ? 0 : remainingRaw;   // sub-0.005 HC left over is rounding noise
    const have = new Set(retroSs.map(s => normName(s.name)));
    const autoTasks = (ssByPerson[personId] || []).filter(t => !have.has(normName(t.task_name)));
    const perTask = autoTasks.length && remaining > 0 ? r3(remaining / autoTasks.length) : 0;
    const out = {
      mode, projects, retroSs, projHc, retroSsHc, remaining, autoTasks, perTask, ssAdjusted,
      total: r3(projHc + retroSsHc + perTask * autoTasks.length)
    };
    // ── Month-by-month values (mi = 0..2 within the quarter) ───────────────
    // The quarter figure used everywhere else is the average of these. Uploaded rows keep their own month shape.
    // What the engine adds (a quarterly average) is placed where each month still has room — never on top of a
    // month that is already full — and steady state shrinks month by month to make way, so a person stays at
    // 1.0 in every month where that is possible, not just on average.
    const flat3 = v => [v, v, v];
    const spread = (total, rooms) => {       // equal split over months, each capped by its room; overflow spread evenly
      const o = [0, 0, 0]; let rem = total, act = [0, 1, 2].filter(i => rooms[i] > 0.0005);
      while (rem > 0.0005 && act.length) {
        const share = rem / act.length; let used = 0; const next = [];
        for (const i of act) { const g = Math.min(share, rooms[i] - o[i]); o[i] += g; used += g; if (rooms[i] - o[i] > 0.0005) next.push(i); }
        rem -= used; if (used < 1e-9) break; act = next;
      }
      if (rem > 0.0005) for (let i = 0; i < 3; i++) o[i] += rem / 3;
      return o;
    };
    const autoM = (autoMonIdx[personId] && autoMonIdx[personId][k]) || {};
    projects.forEach(x => {
      const base = x.mon || flat3(x.baseHc);
      const add = autoM[x.project_id] || (x.autoAdd ? flat3(x.autoAdd) : [0, 0, 0]);
      x.cm = [0, 1, 2].map(i => Math.max(0, r3(base[i] + add[i])));
    });
    const projMon = [0, 1, 2].map(i => projects.reduce((t, x) => t + x.cm[i], 0));
    const ssOldMon = [0, 1, 2].map(i => retroSs.reduce((t, x) => t + (x.mon ? x.mon[i] : x.hc), 0));
    retroSs.forEach(x => {
      const base = x.mon || flat3(x.hc);
      x.cm = [0, 1, 2].map(i => {
        if (!autos.length) return base[i];                                  // engine added nothing → data as uploaded
        const target = Math.max(0, 1 - projMon[i]);
        return ssOldMon[i] > target + 0.0005 ? Math.max(0, r3(base[i] * target / ssOldMon[i])) : base[i];
      });
    });
    const ssMon = [0, 1, 2].map(i => retroSs.reduce((t, x) => t + x.cm[i], 0));
    const nAuto = autoTasks.length;
    const fillDist = nAuto && perTask > 0 ? spread(3 * perTask * nAuto, [0, 1, 2].map(i => Math.max(0, 1 - projMon[i] - ssMon[i]))) : [0, 0, 0];
    out.perTaskMon = fillDist.map(v => nAuto ? r3(v / nAuto) : 0);
    out.monthOf = (row, mi) => row.cm[mi];
    out.monthTotal = mi => r3(projMon[mi] + ssMon[mi] + out.perTaskMon[mi] * nAuto);

    // ── Projects the manager left OUT of this output ──
    // Their HC is not simply dropped (that would leave the person under 1.0): it moves to the person's steady state, which is the
    // flexible part of a week. It is shared over the SS lines the person already has, in the proportion of their usual mix (the
    // uploaded values before the engine shrank them); a person with no SS lines in the quarter gets it on their SS-eligible tasks.
    // A person is never taken above 1.0 by this. Sized project HC itself is never scaled.
    out.freed = [0, 0, 0];
    out.ssAdd = { retro: retroSs.map(() => [0, 0, 0]), auto: autoTasks.map(() => [0, 0, 0]) };
    const exp = projects.filter(x => excludedIds.has(x.project_id));
    if (exp.length) {
      out.freed = [0, 1, 2].map(i => exp.reduce((t, x) => t + x.cm[i], 0));
      [0, 1, 2].forEach(i => {
        const add = Math.min(out.freed[i], Math.max(0, 1 - (out.monthTotal(i) - out.freed[i])));
        if (add <= 0.0005) return;
        if (retroSs.length) {
          const w = retroSs.map(x => Math.max(0, x.mon ? x.mon[i] : x.baseHc));
          const wSum = w.reduce((a, b) => a + b, 0);
          retroSs.forEach((x, j) => { out.ssAdd.retro[j][i] = add * (wSum > 0.0005 ? w[j] / wSum : 1 / retroSs.length); });
        } else if (autoTasks.length) {
          autoTasks.forEach((t, j) => { out.ssAdd.auto[j][i] = add / autoTasks.length; });
        }
      });
    }
    const addAt = i => out.ssAdd.retro.reduce((t, a) => t + a[i], 0) + out.ssAdd.auto.reduce((t, a) => t + a[i], 0);
    out.refilled = [0, 1, 2].some(i => addAt(i) > 0.0005);
    // what the person carries in the output (excluded projects out, their HC moved to SS)
    out.incMonthTotal = mi => Math.max(0, r3(out.monthTotal(mi) - out.freed[mi] + addAt(mi)));
    return (cache[ck] = out);
  }

  // What the output shows for a cell once excluded projects are taken out (their HC moved to steady state, see cellFor)
  const incTotal = c => r3([0, 1, 2].reduce((t, i) => t + c.incMonthTotal(i), 0) / 3);

  // ── Periods ──────────────────────────────────────────────────────────────
  const periods = [];
  quarters.forEach(({ q, fy, label }) => {
    const months = Q_MONTHS[`Q${q}`];
    if (format === 'monthly') {
      months.forEach((m, mi) => periods.push({ col: `${m} ${String(fy).slice(-2)}`, quarter: label, mi }));   // year on every month so columns can be matched to the source sheet
    } else {
      let wk = 1;
      months.forEach((m, mi) => { for (let w = 0; w < (mi < 2 ? 4 : 5); w++) periods.push({ col: `W${wk++} ${m}`, quarter: label, mi }); });
    }
  });

  // A quarter is a "forecast quarter" when none of the people has uploaded data for it
  const qIsForecast = {};
  quarters.forEach(({ label }) => {
    qIsForecast[label] = !people.some(p => { const c = cellFor(p.person_id, label); return c.mode === 'data' && c.total > 0; });
  });

  // ── Projects present in the output range (before exclusions) – drives the include / exclude list ──
  const present = new Map();   // project_id → { project_id, name, prov, hc }
  for (const person of people) {
    for (const { label } of quarters) {
      cellFor(person.person_id, label).projects.forEach(p => {
        const e = present.get(p.project_id) || { project_id: p.project_id, name: p.name, prov: !!p.prov, est: !!p.est, hc: 0 };
        e.hc = r3(e.hc + p.hc); if (p.prov) e.prov = true; if (p.est) e.est = true;
        present.set(p.project_id, e);
      });
    }
  }
  plan.gaps.forEach(g => {
    if (!quarters.some(q => q.label === g.label)) return;
    if (!present.has(g.project_id)) present.set(g.project_id, { project_id: g.project_id, name: g.project_name, prov: !!g.provisional, est: !!g.estimated, hc: 0, gapOnly: true });
  });

  // ── People ───────────────────────────────────────────────────────────────
  const flexIds = new Set(plan.flexed || []);
  const outPeople = [];
  const teamTotal = periods.map(() => 0), teamGap = periods.map(() => 0);
  for (const person of people) {
    const projNames = new Map();   // name → total hc
    const provNames = new Set();   // projects that are still under review (labelled in the sheet)
    const estNames = new Set();    // forecast placeholders (estimated, not sized yet)
    const flexNames = new Set();   // projects whose sizing is adjusted by a flex rule (timeline / HC)
    const ssNames = new Map();     // normName → { label, total }
    let anyHc = false;
    for (const { label } of quarters) {
      const c = cellFor(person.person_id, label);
      if (incTotal(c) > 0) anyHc = true;
      c.projects.forEach(p => {
        if (excludedIds.has(p.project_id)) return;
        projNames.set(p.name, (projNames.get(p.name) || 0) + p.hc); if (p.prov) provNames.add(p.name); if (p.est) estNames.add(p.name); if (flexIds.has(p.project_id)) flexNames.add(p.name);
      });
      c.retroSs.forEach(s => { const k = normName(s.name); ssNames.set(k, { label: s.name, total: (ssNames.get(k)?.total || 0) + s.hc }); });
      if (c.perTask > 0 || c.ssAdd.auto.some(a => a.some(v => v > 0.0005))) c.autoTasks.forEach(t => { const k = normName(t.task_name); if (!ssNames.has(k)) ssNames.set(k, { label: t.task_name, total: 0 }); });
    }
    if (!anyHc) continue;

    const work = periods.map((p, i) => {
      const cell = cellFor(person.person_id, p.quarter);
      const tot = cell.incMonthTotal(p.mi);
      const over = tot > 1.005;   // shown with 2 decimals: 1.001-1.005 is rounding noise and reads 1.00, so it is not flagged
      teamTotal[i] += tot;
      if (over) teamGap[i] += tot - 1;
      return { v: tot, over, fc: cell.mode !== 'data' };
    });

    const projects = [...projNames.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0]).map(name => ({
      name, prov: provNames.has(name), est: estNames.has(name), flex: flexNames.has(name),
      vals: periods.map(p => {
        const cellM = cellFor(person.person_id, p.quarter);
        const hit = cellM.projects.find(x => x.name === name && !excludedIds.has(x.project_id));
        const fc = cellM.mode !== 'data' || !!(hit && hit.auto);   // engine-assigned HC is highlighted like a forecast
        return { v: hit ? cellM.monthOf(hit, p.mi) : 0, fc };
      })
    }));

    const ss = [...ssNames.entries()].map(([k, info]) => ({
      label: info.label,
      vals: periods.map(p => {
        const cell = cellFor(person.person_id, p.quarter);
        const rIdx = cell.retroSs.findIndex(s => normName(s.name) === k);
        const aIdx = cell.autoTasks.findIndex(t => normName(t.task_name) === k);
        const retroHit = rIdx >= 0 ? cell.retroSs[rIdx] : null;
        const extra = rIdx >= 0 ? cell.ssAdd.retro[rIdx][p.mi] : (aIdx >= 0 ? cell.ssAdd.auto[aIdx][p.mi] : 0);   // HC moved here from excluded projects
        const auto = aIdx >= 0 ? cell.perTaskMon[p.mi] : 0;
        const hc = (retroHit ? cell.monthOf(retroHit, p.mi) : auto) + extra;
        // Regular colouring only when the value is straight from uploaded data; auto-filled SS, moved HC and forecast are highlighted
        return { v: hc, fromData: !!retroHit && cell.mode === 'data' && !cell.ssAdjusted && extra < 0.0005 };
      })
    }));

    outPeople.push({ person_id: person.person_id, name: person.display_name, work, projects, ss });
  }

  // ── Team summary ─────────────────────────────────────────────────────────
  const summary = [];
  if (outPeople.length) {
    const capacity = outPeople.length;
    summary.push({ label: 'TEAM TOTAL HC', kind: 'total', vals: teamTotal.map(v => Math.round(v * 100) / 100) });
    summary.push({ label: 'TEAM CAPACITY', kind: 'total', vals: periods.map(() => capacity) });
    summary.push({ label: 'GAP (over capacity)', kind: 'over', vals: teamGap.map(v => Math.round(v * 100) / 100) });

    // Sized demand the engine could not place. 'no_capacity' = people are ticked but full → HIRING GAP.
    // 'no_one_ticked' = nobody is ticked Yes for the project yet (not a hiring need, just unassigned).
    const gaps = plan.gaps.filter(g => !excludedIds.has(g.project_id));
    const gapSum = kind => periods.map(p => r3(gaps.filter(g => g.kind === kind && g.label === p.quarter).reduce((s, g) => s + g.hc, 0)));
    const hireVals = gapSum('no_capacity'), unassignedVals = gapSum('no_one_ticked');
    const projGapRows = (kind, rowKind) => {
      const names = [...new Set(gaps.filter(g => g.kind === kind).map(g => g.project_name))].sort();
      return names.map(n => ({
        label: `    ${n}`, kind: rowKind,
        vals: periods.map(p => r3(gaps.filter(g => g.kind === kind && g.project_name === n && g.label === p.quarter).reduce((s, g) => s + g.hc, 0)))
      }));
    };
    // Estimates whose ticked people could not carry (or had more room than) what the bucket curve asks: the output follows the people
    const adj = (plan.estimate_adjustments || []).filter(a => !excludedIds.has(a.project_id));
    const fitVals = sign => periods.map(p => r3(adj.filter(a => a.label === p.quarter && a.delta * sign > 0).reduce((s, a) => s + Math.abs(a.delta), 0)));
    const cutVals = fitVals(-1), grewVals = fitVals(1);
    if (hireVals.some(v => v > 0)) {
      summary.push({ label: 'HIRING GAP (HC to hire)', kind: 'hire', vals: hireVals });
      summary.push(...projGapRows('no_capacity', 'hireProj'));
    }
    if (cutVals.some(v => v > 0)) summary.push({ label: "ESTIMATES CUT to fit ticked people's room", kind: 'fit', vals: cutVals });
    if (grewVals.some(v => v > 0)) summary.push({ label: "ESTIMATES GREW into ticked people's room", kind: 'fit', vals: grewVals });
    if (unassignedVals.some(v => v > 0)) {
      summary.push({ label: 'UNASSIGNED (nobody ticked Yes)', kind: 'unassigned', vals: unassignedVals });
      summary.push(...projGapRows('no_one_ticked', 'unassignedProj'));
    }
  }

  const available = [...present.values()].sort((a, b) => b.hc - a.hc || a.name.localeCompare(b.name))
    .map(p => ({ ...p, included: !excludedIds.has(p.project_id) }));
  const excluded = available.filter(p => !p.included);

  return {
    format,
    quarters: quarters.map(q => ({ ...q, forecast: qIsForecast[q.label] })),
    periods,
    people: outPeople,
    summary,
    hasEstimates: available.some(p => p.est),
    flexed: available.filter(p => flexIds.has(p.project_id)).map(p => p.name),   // projects shown with an adjusted sizing
    flexOn: !!(plan.flexed && plan.flexed.length),
    flexRules: plan.flexRules || 0,   // adjustments that exist (so the preview can offer 'approved sizing only')
    projects: available,       // every project in the range, with an `included` flag
    excluded,                  // the ones left out of this output
    excludedHc: r3(sumHc(excluded))
  };
}

module.exports = { buildOutputModel, resolveQuarters, loadExclusions, saveExclusions, ensureExclusionsTable, toQL, Q_MONTHS };
