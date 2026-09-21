#!/usr/bin/env python3
"""
parse_sizing_excel.py <filepath>
Parses Sam's sizing Excel format. Outputs JSON to stdout.
Each project tab becomes a separate project.
"""
import sys, json, re, openpyxl
import warnings
warnings.filterwarnings('ignore')

SKIP_TABS = {'Assumptions', 'Info', 'BrowserTab', 'LUT', 'Instructions', 'Ramp Scenarios'}

def parse_quarter(h):
    m = re.match(r'^Q(\d)(\d{2})$', str(h).strip())
    if m: return int(m.group(1)), 2000 + int(m.group(2))
    return None, None

def parse_file(path):
    wb = openpyxl.load_workbook(path, data_only=True)

    # LUT: col I=Location, col H=Labour Rate
    lut_rates = {}
    if 'LUT' in wb.sheetnames:
        ws_lut = wb['LUT']
        for r in range(3, ws_lut.max_row + 1):
            loc  = str(ws_lut.cell(r, 9).value or '').strip()
            rate = ws_lut.cell(r, 8).value
            if loc and rate:
                try: lut_rates[loc] = round(float(rate), 2)
                except: pass

    # Assumptions tab
    assumptions = []
    if 'Assumptions' in wb.sheetnames:
        ws_a = wb['Assumptions']
        for r in range(3, ws_a.max_row + 1):
            fn    = str(ws_a.cell(r, 1).value or '').strip()
            scope = str(ws_a.cell(r, 2).value or '').strip()
            assum = str(ws_a.cell(r, 3).value or '').strip()
            risks = str(ws_a.cell(r, 4).value or '').strip()
            if fn or scope:
                assumptions.append({'function': fn, 'scope': scope, 'assumptions': assum, 'risks': risks})

    projects = []
    for sheet_name in wb.sheetnames:
        if sheet_name in SKIP_TABS: continue
        ws = wb[sheet_name]

        proj_name = sheet_name
        bu_raw    = str(ws.cell(4, 1).value or '').strip()
        started   = ws.cell(4, 2).value
        due       = ws.cell(4, 3).value

        # Row 5 headers
        headers = {}
        for c in range(1, ws.max_column + 1):
            v = ws.cell(5, c).value
            if v: headers[c] = str(v).strip()

        quarterly_cols = {}
        for col, h in headers.items():
            q, fy = parse_quarter(h)
            if q: quarterly_cols[col] = (q, fy)

        def find_col(keyword, default):
            return next((c for c,h in headers.items() if keyword.lower() in h.lower()), default)

        col_cat  = find_col('category', 1)
        col_lead = find_col('leader', 2)
        col_team = find_col('top level', 3)
        col_func = find_col('function', 4)
        col_loc  = find_col('location', 5)
        col_hct  = find_col('hc type', 7)

        rows = []
        for r in range(6, ws.max_row + 1):
            category = str(ws.cell(r, col_cat).value  or '').strip()
            leader   = str(ws.cell(r, col_lead).value or '').strip()
            team     = str(ws.cell(r, col_team).value or '').strip()
            func     = str(ws.cell(r, col_func).value or '').strip()
            loc      = str(ws.cell(r, col_loc).value  or '').strip()
            hctype   = str(ws.cell(r, col_hct).value  or '').strip()
            if not (category or team or loc or hctype): continue
            quarterly = {}
            for col, (q, fy) in quarterly_cols.items():
                v = ws.cell(r, col).value
                if v:
                    try:
                        hc = float(v)
                        if hc > 0: quarterly[f'Q{q} FY{str(fy)[-2:]}'] = round(hc, 3)
                    except: pass
            if quarterly:
                rows.append({'category': category, 'leader': leader, 'top_level_team': team,
                             'function': func, 'location': loc, 'hc_type': hctype,
                             'quarterly_hc': quarterly})

        # Location summary for rate lookup
        location_summary = {}
        for row in rows:
            loc = row['location']
            if loc not in location_summary:
                location_summary[loc] = {'rate': lut_rates.get(loc), 'rows': 0}
            location_summary[loc]['rows'] += 1

        projects.append({
            'project_name': proj_name,
            'bu': bu_raw if bu_raw not in ('BU', 'Client', '') else '',
            'bu_raw': bu_raw,
            'started': str(started)[:10] if started else None,
            'due_date': str(due)[:10] if due else None,
            'rows': rows,
            'row_count': len(rows),
            'location_summary': location_summary,
            'scope_notes': '\n'.join(
                f"{a['function']}: {a['scope']}" for a in assumptions if a['scope']
            )
        })

    return {'projects': projects, 'rates': lut_rates, 'assumptions': assumptions}

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(json.dumps({'error': 'Usage: parse_sizing_excel.py <filepath>'}))
        sys.exit(1)
    try:
        result = parse_file(sys.argv[1])
        print(json.dumps(result))
    except Exception as e:
        print(json.dumps({'error': str(e)}))
        sys.exit(1)
