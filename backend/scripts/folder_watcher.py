#!/usr/bin/env python3
"""
folder_watcher.py
Watches inbox/sizing/ and inbox/documents/ for new files.
Parses sizing .xlsx files and queues everything for admin review.

Run via pm2:
  pm2 start backend/scripts/folder_watcher.py --interpreter python3 --name folder-watcher
"""

import os, sys, time, json, shutil, logging, re
import warnings
warnings.filterwarnings('ignore')

import pymysql
from dotenv import dotenv_values

# ── Paths ─────────────────────────────────────────────────────────────────────
BASE_DIR      = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INBOX_SIZING  = os.path.join(BASE_DIR, 'inbox', 'sizing')
INBOX_DOCS    = os.path.join(BASE_DIR, 'inbox', 'documents')
PROC_SIZING   = os.path.join(BASE_DIR, 'processed', 'sizing')
PROC_DOCS     = os.path.join(BASE_DIR, 'processed', 'documents')

for d in [INBOX_SIZING, INBOX_DOCS, PROC_SIZING, PROC_DOCS]:
    os.makedirs(d, exist_ok=True)

# ── Logging ───────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [watcher] %(levelname)s %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
log = logging.getLogger('watcher')

# ── DB connection ─────────────────────────────────────────────────────────────
env_path = os.path.join(BASE_DIR, '.env')
cfg = dotenv_values(env_path)

def get_conn():
    return pymysql.connect(
        host=cfg.get('DB_HOST', 'localhost'),
        user=cfg.get('DB_USER', 'root'),
        password=cfg.get('DB_PASSWORD', ''),
        database=cfg.get('DB_NAME', 'scbumatplan'),
        charset='utf8mb4',
        cursorclass=pymysql.cursors.DictCursor
    )

# ── Excel parser (reuse backend logic via subprocess) ─────────────────────────
def parse_sizing_excel(filepath):
    """Parse a sizing .xlsx and return dict with projects/rates/assumptions."""
    try:
        import openpyxl, re as _re
        _SKIP = {'Assumptions','Info','BrowserTab','LUT','Instructions','Ramp Scenarios'}

        def _pq(h):
            if not h: return None
            m = _re.match(r'^Q(\d)(\d{2})$', str(h).strip())
            return {'q': int(m.group(1)), 'fy': 2000+int(m.group(2))} if m else None

        def _cv(v):
            if v and isinstance(v, dict):
                if 'result' in v: return v['result'] or ''
                if 'text' in v:   return v['text'] or ''
            return v or ''

        def _cl(v):
            s = str(_cv(v)).strip()
            return '' if s.lower() in ('nan','none','null','undefined') else s

        wb = openpyxl.load_workbook(filepath, data_only=True)

        lut_rates = {}
        ws_lut = wb['LUT'] if 'LUT' in wb.sheetnames else None
        if ws_lut:
            for r in range(3, ws_lut.max_row+1):
                loc  = _cl(ws_lut.cell(r,9).value)
                rate = _cv(ws_lut.cell(r,8).value)
                if loc and rate:
                    try: lut_rates[loc] = round(float(rate),2)
                    except: pass

        assumptions = []
        ws_a = wb['Assumptions'] if 'Assumptions' in wb.sheetnames else None
        if ws_a:
            for r in range(3, ws_a.max_row+1):
                fn    = _cl(ws_a.cell(r,1).value)
                scope = _cl(ws_a.cell(r,2).value)
                assum = _cl(ws_a.cell(r,3).value)
                risks = _cl(ws_a.cell(r,4).value)
                if fn or scope:
                    assumptions.append({'function':fn,'scope':scope,'assumptions':assum,'risks':risks})

        projects = []
        for name in wb.sheetnames:
            if name in _SKIP: continue
            ws = wb[name]
            row4 = ws[4]
            bu_raw = _cl(row4[0].value if len(row4)>0 else '')

            # Detect quarters from row 4 year + position
            row5 = ws[5] if ws.max_row >= 5 else []
            col_map = {'category':1,'leader':2,'team':3,'func':4,'location':5,'hctype':7}
            q_cols  = {}

            for ci, cell in enumerate(row5, 1):
                h = _cl(cell.value); hl = h.lower()
                qr = _pq(h)
                if qr: q_cols[ci] = qr; continue
                if 'category' in hl:   col_map['category'] = ci
                elif 'leader' in hl:   col_map['leader']   = ci
                elif 'top level' in hl: col_map['team']    = ci
                elif 'function' in hl: col_map['func']     = ci
                elif 'allocation' in hl: pass
                elif 'location' in hl: col_map['location'] = ci
                elif 'hc' in hl and 'type' in hl: col_map['hctype'] = ci

            # Fallback: detect quarterly cols from row 4 year
            if not q_cols:
                for ci, cell in enumerate(row4, 1):
                    if ci < 8: continue
                    v = _cv(cell.value)
                    try:
                        yr = int(float(str(v)))
                        if 2020 <= yr <= 2040:
                            fy, q = yr, 1
                            for c in range(ci, ws.max_column+1):
                                q_cols[c] = {'q':q,'fy':fy}
                                q += 1
                                if q > 4: q=1; fy+=1
                            break
                    except: pass

            if not q_cols: continue

            rows = []
            for ri in range(6, ws.max_row+1):
                row = ws[ri]
                def gc(key):
                    ci = col_map.get(key,1)-1
                    return _cl(row[ci].value) if ci < len(row) else ''
                category=gc('category'); leader=gc('leader'); team=gc('team')
                func=gc('func'); loc=gc('location'); hctype=gc('hctype')
                if not (category or team or loc or hctype): continue
                qhc = {}
                for ci,(qr) in q_cols.items():
                    ci0 = ci-1
                    if ci0 >= len(row): continue
                    v = _cv(row[ci0].value)
                    try:
                        n = float(v)
                        if n>0: qhc[f"Q{qr['q']} FY{str(qr['fy'])[-2:]}"] = round(n,3)
                    except: pass
                if qhc:
                    rows.append({'category':category,'leader':leader,'top_level_team':team,
                                 'function':func,'location':loc,'hc_type':hctype,'quarterly_hc':qhc})

            loc_sum = {}
            for r in rows:
                l=r['location']
                if l and l.strip():
                    if l not in loc_sum: loc_sum[l]={'rate':lut_rates.get(l),'rows':0}
                    loc_sum[l]['rows']+=1

            # Date from row 4
            def fmtd(v):
                import datetime
                rv = _cv(v)
                if isinstance(rv, (datetime.date, datetime.datetime)):
                    y,m,d = rv.year, rv.month, rv.day
                    return f"{y}-{str(m).zfill(2)}-{str(d).zfill(2)}" if y>2020 else None
                s = str(rv)[:10]
                return s if _re.match(r'^\d{4}-\d{2}-\d{2}$',s) and int(s[:4])>2020 else None

            scope_notes = '\n'.join(f"{a['function']}: {a['scope']}" for a in assumptions if a['scope'])
            projects.append({
                'project_name': name,
                'bu': bu_raw if bu_raw not in ('BU','Client','') else '',
                'due_date': fmtd(row4[2].value) if len(row4)>2 else None,
                'rows': rows, 'row_count': len(rows),
                'location_summary': loc_sum, 'scope_notes': scope_notes
            })

        wb.close()
        return {'projects': projects, 'rates': lut_rates, 'assumptions': assumptions}

    except Exception as e:
        log.error(f"Parse error: {e}")
        return {'error': str(e)}

# ── Match project by name ──────────────────────────────────────────────────────
def match_project(conn, name):
    """Try to find an existing project matching the name."""
    with conn.cursor() as cur:
        cur.execute("SELECT project_id, project_name FROM RA_projects WHERE project_name LIKE %s AND retro_category IS NULL LIMIT 1", (f"%{name[:20]}%",))
        row = cur.fetchone()
    return row

# ── Queue a file ───────────────────────────────────────────────────────────────
def queue_file(conn, file_type, original_name, stored_path, parse_result=None,
               project_id=None, project_name=None, error=None):
    with conn.cursor() as cur:
        cur.execute("""
            INSERT INTO RA_import_queue
              (file_type, original_name, stored_path, parse_result,
               status, matched_project_id, matched_project_name, error_message)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
        """, (
            file_type, original_name, stored_path,
            json.dumps(parse_result) if parse_result else None,
            'error' if error else 'pending',
            project_id, project_name,
            error
        ))
    conn.commit()
    log.info(f"Queued {file_type}: {original_name} → {'error: '+error if error else 'pending review'}")

# ── Process sizing file ────────────────────────────────────────────────────────
def process_sizing(filepath, filename):
    log.info(f"Processing sizing: {filename}")
    result = parse_sizing_excel(filepath)

    ts = time.strftime('%Y%m%d_%H%M%S')
    dest = os.path.join(PROC_SIZING, f"{ts}_{filename}")
    shutil.move(filepath, dest)

    conn = get_conn()
    try:
        if 'error' in result:
            queue_file(conn, 'sizing', filename, dest, error=result['error'])
            return

        # Queue each project tab separately
        for proj in result.get('projects', []):
            match = match_project(conn, proj['project_name'])
            queue_file(conn, 'sizing', filename, dest,
                       parse_result={'project': proj, 'rates': result.get('rates',{})},
                       project_id=match['project_id'] if match else None,
                       project_name=match['project_name'] if match else proj['project_name'])
    finally:
        conn.close()

# ── Process document file ──────────────────────────────────────────────────────
def process_document(filepath, filename):
    log.info(f"Processing document: {filename}")
    ts = time.strftime('%Y%m%d_%H%M%S')
    dest = os.path.join(PROC_DOCS, f"{ts}_{filename}")
    shutil.move(filepath, dest)

    # Try to match project from filename
    conn = get_conn()
    try:
        # Strip extension and common suffixes to get a clean name for matching
        name_guess = re.sub(r'\.(pdf|pptx|docx|xlsx|xls)$', '', filename, flags=re.IGNORECASE)
        name_guess = re.sub(r'[-_v]\d+.*$', '', name_guess).strip()
        match = match_project(conn, name_guess) if len(name_guess) > 3 else None
        queue_file(conn, 'document', filename, dest,
                   project_id=match['project_id'] if match else None,
                   project_name=match['project_name'] if match else None)
    finally:
        conn.close()

# ── Main watch loop ────────────────────────────────────────────────────────────
SIZING_EXTS = {'.xlsx', '.xls'}
DOC_EXTS    = {'.pdf', '.pptx', '.docx', '.ppt', '.doc'}

def scan_folder(folder, exts, handler):
    for fname in os.listdir(folder):
        fpath = os.path.join(folder, fname)
        if not os.path.isfile(fpath): continue
        ext = os.path.splitext(fname)[1].lower()
        if ext not in exts: continue
        # Wait until file is fully written (size stable for 2s)
        try:
            s1 = os.path.getsize(fpath); time.sleep(2); s2 = os.path.getsize(fpath)
            if s1 != s2: continue  # still writing
        except: continue
        try:
            handler(fpath, fname)
        except Exception as e:
            log.error(f"Error handling {fname}: {e}")

def main():
    log.info(f"Folder watcher started")
    log.info(f"  Sizing inbox:   {INBOX_SIZING}")
    log.info(f"  Document inbox: {INBOX_DOCS}")
    log.info(f"  Poll interval:  10s")

    while True:
        scan_folder(INBOX_SIZING, SIZING_EXTS, process_sizing)
        scan_folder(INBOX_DOCS,   DOC_EXTS,    process_document)
        time.sleep(10)

if __name__ == '__main__':
    main()
