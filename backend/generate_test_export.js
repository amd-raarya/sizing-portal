const ExcelJS = require('exceljs');

const Q_MONTHS = {
  'Q1': ['Feb','Mar','Apr'],
  'Q2': ['May','Jun','Jul'],
  'Q3': ['Aug','Sep','Oct'],
  'Q4': ['Nov','Dec','Jan']
};

const people = [
  { person_id: 6, display_name: 'B N, Anil Kumar', location: 'India' },
  { person_id: 14, display_name: 'Chamarty, PhaniMadhav (Phani)', location: 'India' },
];

// Project assignments per quarter (only where project exists)
const projectAssignments = [
  { person_id: 6,  project_name: 'KRK1 New Features v1.0', quarters: {'Q2 FY26':0.25,'Q3 FY26':0.25,'Q4 FY26':0.5,'Q1 FY27':0.5,'Q2 FY27':0.25} },
  { person_id: 14, project_name: 'KRK1 New Features v1.0', quarters: {'Q2 FY26':0.25,'Q3 FY26':0.25,'Q4 FY26':0.5,'Q1 FY27':0.5,'Q2 FY27':0.25} },
];

// SS task eligibility (which tasks each person is on)
const ssEligibility = [
  { person_id: 6,  task_name: 'Management' },
  { person_id: 6,  task_name: 'Other_Customers' },
  { person_id: 14, task_name: 'Management' },
  { person_id: 14, task_name: 'HIP on Windows' },
  { person_id: 14, task_name: 'Other_Customers' },
];

// Quarter range Q2 FY26 → Q4 FY28
const quarters = [];
let [q, fy] = [2, 2026];
while (true) {
  quarters.push({ q, fy, label: `Q${q} FY${String(fy).slice(-2)}` });
  if (q === 4 && fy === 2028) break;
  q++; if (q > 4) { q = 1; fy++; }
}

// Build month columns
const months = [];
quarters.forEach(({ q, fy }) => {
  Q_MONTHS[`Q${q}`].forEach(m => months.push({
    month: m, year: fy,
    quarter: `Q${q} FY${String(fy).slice(-2)}`,
    label: `${m} ${fy}`
  }));
});

// ── KEY FUNCTION: compute SS per task per quarter dynamically ──
function computeSsForQuarter(personId, quarter) {
  const projHc = projectAssignments
    .filter(a => a.person_id === personId)
    .reduce((s, a) => s + (a.quarters[quarter] || 0), 0);
  const remaining = Math.max(0, Math.round((1.0 - projHc) * 1000) / 1000);
  const tasks = ssEligibility.filter(e => e.person_id === personId);
  const perTask = tasks.length ? Math.round((remaining / tasks.length) * 1000) / 1000 : 0;
  return { projHc, remaining, perTask, tasks };
}

async function generate() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Monthly View');

  const QTR_FILL    = { type:'pattern', pattern:'solid', fgColor:{ argb:'FF1A1A2E' } };
  const MON_FILL    = { type:'pattern', pattern:'solid', fgColor:{ argb:'FF2D2D4E' } };
  const PERSON_FILL = { type:'pattern', pattern:'solid', fgColor:{ argb:'FFE8F0FE' } };
  const PROJ_FILL   = { type:'pattern', pattern:'solid', fgColor:{ argb:'FFFFFFFF' } };
  const SS_FILL     = { type:'pattern', pattern:'solid', fgColor:{ argb:'FFFFF8E1' } };
  const HC_FILL     = { type:'pattern', pattern:'solid', fgColor:{ argb:'FFFFF176' } };
  const WHITE_FONT  = { name:'Arial', bold:true, color:{ argb:'FFFFFFFF' }, size:9 };
  const DARK_FONT   = { name:'Arial', size:9 };
  const BOLD_FONT   = { name:'Arial', bold:true, size:9 };

  const COL_NAME = 1, COL_TYPE = 2, COL_DATA = 3;

  // Row 1: Quarter headers
  const qtrRow = ws.getRow(1);
  qtrRow.getCell(COL_NAME).value = 'Resource Name'; qtrRow.getCell(COL_NAME).font = WHITE_FONT; qtrRow.getCell(COL_NAME).fill = QTR_FILL;
  qtrRow.getCell(COL_TYPE).value = 'Details';       qtrRow.getCell(COL_TYPE).font = WHITE_FONT; qtrRow.getCell(COL_TYPE).fill = QTR_FILL;

  const qtrGroups = {};
  months.forEach((m, i) => {
    if (!qtrGroups[m.quarter]) qtrGroups[m.quarter] = { start: i, end: i };
    else qtrGroups[m.quarter].end = i;
  });
  quarters.forEach(({ q, fy }) => {
    const qLabel = `Q${q} FY${String(fy).slice(-2)}`;
    const g = qtrGroups[qLabel]; if (!g) return;
    const s = COL_DATA + g.start, e = COL_DATA + g.end;
    if (s < e) ws.mergeCells(1, s, 1, e);
    qtrRow.getCell(s).value = `Qtr ${q}, ${fy}`;
    for (let c = s; c <= e; c++) {
      qtrRow.getCell(c).fill = QTR_FILL; qtrRow.getCell(c).font = WHITE_FONT;
      qtrRow.getCell(c).alignment = { horizontal:'center', vertical:'middle' };
      qtrRow.getCell(c).border = { right:{ style:'medium', color:{ argb:'FF5588AA' } } };
    }
  });
  qtrRow.height = 20;

  // Row 2: Month headers
  const monRow = ws.getRow(2);
  monRow.getCell(COL_NAME).fill = MON_FILL; monRow.getCell(COL_TYPE).fill = MON_FILL;
  months.forEach((m, i) => {
    const c = monRow.getCell(COL_DATA + i);
    c.value = m.month; c.font = WHITE_FONT; c.fill = MON_FILL;
    c.alignment = { horizontal:'center' };
    c.border = { right:{ style:'thin', color:{ argb:'FF444466' } } };
  });
  monRow.height = 16;

  // Data rows
  let dr = 3;
  for (const person of people) {
    const projRows = projectAssignments.filter(a => a.person_id === person.person_id);
    const ssTasks  = ssEligibility.filter(e => e.person_id === person.person_id);

    // Person aggregate row — shows 1.0 every month (project + SS always = 1.0)
    const pRow = ws.getRow(dr++);
    pRow.getCell(COL_NAME).value = person.display_name; pRow.getCell(COL_NAME).font = BOLD_FONT; pRow.getCell(COL_NAME).fill = PERSON_FILL;
    pRow.getCell(COL_TYPE).value = 'Work'; pRow.getCell(COL_TYPE).font = DARK_FONT; pRow.getCell(COL_TYPE).fill = PERSON_FILL;
    months.forEach((m, i) => {
      const { projHc, remaining } = computeSsForQuarter(person.person_id, m.quarter);
      const total = Math.round((projHc + remaining) * 1000) / 1000;
      const c = pRow.getCell(COL_DATA + i);
      c.value = total > 0 ? total : ''; c.font = BOLD_FONT; c.fill = PERSON_FILL;
      c.alignment = { horizontal:'center' }; c.numFmt = '0.00';
    });
    pRow.height = 17;

    // Project sub-rows — dynamic per quarter
    for (const pr of projRows) {
      const row = ws.getRow(dr++);
      row.getCell(COL_NAME).value = `    ${pr.project_name}`; row.getCell(COL_NAME).font = DARK_FONT; row.getCell(COL_NAME).fill = PROJ_FILL;
      row.getCell(COL_TYPE).value = 'Work'; row.getCell(COL_TYPE).font = DARK_FONT;
      months.forEach((m, i) => {
        const hc = pr.quarters[m.quarter] || 0;
        const c = row.getCell(COL_DATA + i);
        if (hc > 0) { c.value = hc; c.fill = HC_FILL; c.numFmt = '0.00'; }
        c.font = DARK_FONT; c.alignment = { horizontal:'center' };
      });
      row.height = 15;
    }

    // SS sub-rows — dynamic: remaining ÷ ss task count per quarter
    for (const ss of ssTasks) {
      const row = ws.getRow(dr++);
      row.getCell(COL_NAME).value = `    ${ss.task_name} [SS]`; row.getCell(COL_NAME).font = { ...DARK_FONT, italic:true }; row.getCell(COL_NAME).fill = SS_FILL;
      row.getCell(COL_TYPE).value = 'Work'; row.getCell(COL_TYPE).font = DARK_FONT;
      months.forEach((m, i) => {
        const { perTask } = computeSsForQuarter(person.person_id, m.quarter);
        const c = row.getCell(COL_DATA + i);
        if (perTask > 0) { c.value = perTask; c.fill = HC_FILL; c.numFmt = '0.000'; }
        c.font = { ...DARK_FONT, italic:true }; c.alignment = { horizontal:'center' };
      });
      row.height = 15;
    }
  }

  ws.getColumn(1).width = 32; ws.getColumn(2).width = 7;
  for (let i = 0; i < months.length; i++) ws.getColumn(COL_DATA + i).width = 5.5;
  ws.views = [{ state:'frozen', xSplit:2, ySplit:2 }];
  ws.getRow(1).height = 22; ws.getRow(2).height = 16;

  await wb.xlsx.writeFile('/sessions/charming-festive-albattani/mnt/outputs/Assignment_Export_v3.xlsx');
  console.log('Done');
}
generate().catch(console.error);
