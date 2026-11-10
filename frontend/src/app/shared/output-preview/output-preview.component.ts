import { ChangeDetectionStrategy, Component, ElementRef, OnInit, afterNextRender, computed, inject, input, model, output, signal, viewChild } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ApiService } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';

interface OutCell { v: number; over?: boolean; fc?: boolean; fromData?: boolean }
interface OutPeriod { col: string; quarter: string; mi: number }
interface OutQuarter { label: string; forecast: boolean }
interface OutProject { project_id: number; name: string; prov: boolean; est: boolean; hc: number; gapOnly?: boolean; included: boolean }
interface OutModel {
  format: string;
  quarters: OutQuarter[];
  periods: OutPeriod[];
  people: { person_id: number; name: string; work: OutCell[]; projects: { name: string; prov: boolean; est: boolean; flex?: boolean; vals: OutCell[] }[]; ss: { label: string; vals: OutCell[] }[] }[];
  summary: { label: string; kind: string; vals: number[] }[];
  hasEstimates: boolean;
  flexed: string[];
  flexOn: boolean;
  flexRules: number;
  projects: OutProject[];
  excluded: OutProject[];
  excludedHc: number;
}
interface PreviewRow { key: string; kind: 'person' | 'project' | 'ss' | 'summary'; label: string; sub?: string; est?: boolean; prov?: boolean; summaryKind?: string; personId?: number; cells: OutCell[] }

/**
 * Preview of the Assignment Output: the same numbers as the Excel download (one shared model on the backend),
 * plus a per-project include/exclude list. Excluding only changes the output — the matrix, the views and the
 * saved data are never touched. The choice is remembered per manager.
 */
@Component({
  selector: 'app-output-preview',
  imports: [MatIconModule, MatProgressSpinnerModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(keydown.escape)': 'closed.emit()' },
  template: `
    <div class="op-backdrop" (click)="closed.emit()"></div>
    <div class="op-dialog" role="dialog" aria-modal="true" aria-labelledby="op-title" tabindex="-1" #dialog>

      <header class="op-head">
        <div>
          <h2 id="op-title" class="op-title">Assignment output preview</h2>
          <p class="op-sub">{{ manager() || 'All teams' }} · {{ rangeText() }} · same numbers as the Excel download</p>
        </div>
        <button type="button" class="op-x" (click)="closed.emit()" aria-label="Close preview"><mat-icon>close</mat-icon></button>
      </header>

      @if (loading()) {
        <div class="op-state"><mat-spinner diameter="32"></mat-spinner><span>Building the output…</span></div>
      } @else if (error()) {
        <div class="op-state op-state--err" role="alert"><mat-icon>error_outline</mat-icon><span>{{ error() }}</span></div>
      } @else if (model(); as m) {

        @if (excludedCount() > 0) {
          <div class="op-banner" role="status">
            <mat-icon>visibility_off</mat-icon>
            <span><strong>{{ excludedCount() }} project{{ excludedCount() === 1 ? '' : 's' }} excluded</strong>
              ({{ m.excludedHc }} HC) — left out of this output only. Each person's freed HC moves to their steady state so they keep their full load. Still in the matrix, views and saved data.</span>
            <button type="button" class="op-link" (click)="resetExclusions()" [disabled]="saving()">Reset to include all</button>
          </div>
        }
        @if (m.flexRules > 0) {
          <div class="op-note" role="note">
            <span class="op-tag">ADJ</span>
            @if (useFlex()) {
              <span>Sizing of <strong>{{ m.flexed.join(', ') || 'some projects' }}</strong> is adjusted (moved, extended or scaled). Applied live: change or reset it from the project's calendar icon in the matrix.</span>
            } @else {
              <span>Showing the <strong>approved sizing only</strong>. {{ m.flexRules }} project adjustment{{ m.flexRules === 1 ? ' is' : 's are' }} switched off for this output.</span>
            }
            <label class="op-flexsw"><input type="checkbox" [checked]="useFlex()" (change)="setUseFlex($any($event.target).checked)" /> Include project adjustments</label>
          </div>
        }
        @if (m.hasEstimates) {
          <div class="op-note" role="note">
            <span class="op-tag">EST</span>
            Hatched lines are <strong>estimates</strong> for projects that are not sized yet. They are generated from a bucket curve. Where people are ticked Yes, the estimate goes to those people only and follows their free room: it is cut when they are short and grows when they have more (see the ESTIMATES CUT / GREW rows). With no ticks, it goes to people who usually work on that bucket's projects, then anyone with spare capacity; HC nobody can take shows as hiring gap.
          </div>
        }

        <div class="op-body">

          <!-- Include / exclude list -->
          <aside class="op-side" aria-label="Projects in this output">
            <div class="op-side-head">
              <span>Projects in this output</span>
              <span class="op-count">{{ includedCount() }} of {{ m.projects.length }}</span>
            </div>
            <ul class="op-plist">
              @for (p of m.projects; track p.project_id) {
                <li>
                  <label class="op-pitem" [class.op-pitem--off]="!p.included">
                    <input type="checkbox" [checked]="p.included" [disabled]="saving()" (change)="toggleProject(p)" [attr.aria-label]="'Include ' + p.name + ' in the output'">
                    <span class="op-pname">{{ p.name }}</span>
                    @if (p.est) { <span class="op-tag">EST</span> }
                    @else if (p.prov) { <span class="op-tag op-tag--rev">REVIEW</span> }
                    <span class="op-phc">{{ p.gapOnly ? 'gap' : fmt(p.hc) }}</span>
                  </label>
                </li>
              }
            </ul>
            <p class="op-side-foot">Unticked projects are removed from the output only. Remembered for {{ manager() || 'all teams' }}.</p>
          </aside>

          <!-- Table -->
          <section class="op-main">
            <div class="op-tools">
              <div class="op-seg" role="group" aria-label="Column detail">
                <button type="button" [class.on]="!months()" [attr.aria-pressed]="!months()" (click)="months.set(false)">Quarters</button>
                <button type="button" [class.on]="months()" [attr.aria-pressed]="months()" (click)="months.set(true)">{{ m.format === 'weekly' ? 'Weeks' : 'Months' }}</button>
              </div>
              <button type="button" class="op-link" (click)="toggleAll()">{{ allOpen() ? 'Collapse all people' : 'Expand all people' }}</button>
              <span class="op-hint">{{ months() ? 'Values as in the Excel columns.' : 'Quarter columns show the average HC per ' + (m.format === 'weekly' ? 'week' : 'month') + '.' }}</span>
            </div>

            <div class="op-scroll">
              <table class="op-table">
                <thead>
                  @if (months()) {
                    <tr class="op-grp">
                      <th class="op-name"></th>
                      @for (g of groups(); track g.label) { <th [attr.colspan]="g.span" [class.op-fc]="g.forecast">{{ g.label }}</th> }
                    </tr>
                  }
                  <tr>
                    <th class="op-name" scope="col">Person / project</th>
                    @for (c of colHeads(); track c.key) { <th scope="col" class="op-num" [class.op-fc]="c.forecast">{{ c.label }}</th> }
                  </tr>
                </thead>
                <tbody>
                  @for (r of rows(); track r.key) {
                    <tr [class]="'op-r op-r--' + r.kind + (r.summaryKind ? ' op-s--' + r.summaryKind : '') + (r.est ? ' op-r--est' : '')">
                      <th class="op-name" scope="row">
                        @if (r.kind === 'person') {
                          <button type="button" class="op-person" (click)="toggleOpen(r.personId!)" [attr.aria-expanded]="isOpen(r.personId!)">
                            <mat-icon>{{ isOpen(r.personId!) ? 'expand_more' : 'chevron_right' }}</mat-icon>{{ r.label }}
                          </button>
                        } @else {
                          {{ r.label }}
                          @if (r.est) { <span class="op-tag">EST</span> }
                          @else if (r.prov) { <span class="op-tag op-tag--rev">REVIEW</span> }
                          @if (r.sub) { <span class="op-rsub">{{ r.sub }}</span> }
                        }
                      </th>
                      @for (c of r.cells; track $index) {
                        <td class="op-num" [class.op-over]="c.over" [class.op-fc]="c.fc" [class.op-zero]="!c.v">{{ fmt(c.v) }}</td>
                      }
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </section>
        </div>

        <footer class="op-foot">
          <span class="op-foot-note">
            @if (saving()) { Saving your selection… } @else { Download uses exactly what you see here. }
          </span>
          <button type="button" class="op-btn op-btn--ghost" (click)="closed.emit()">Close</button>
          <button type="button" class="op-btn op-btn--primary" [disabled]="saving() || downloading()" (click)="download.emit()">
            <mat-icon>download</mat-icon> Download Excel
          </button>
        </footer>
      }
    </div>
  `,
  styles: [`
    :host { position: fixed; inset: 0; z-index: 1300; display: flex; align-items: center; justify-content: center; }
    .op-flexsw { margin-left: auto; font-size: 12px; font-weight: 600; color: #1a1a2e; display: inline-flex; gap: 6px; align-items: center; white-space: nowrap; }
    .op-backdrop { position: absolute; inset: 0; background: rgba(20,24,38,0.45); }
    .op-dialog { position: relative; width: min(1280px, 96vw); height: min(820px, 92vh); background: #fff; border-radius: 14px; box-shadow: 0 20px 60px rgba(0,0,0,0.3); display: flex; flex-direction: column; overflow: hidden; outline: none; }
    .op-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 16px 20px 10px; border-bottom: 1px solid #eceff4; }
    .op-title { margin: 0; font-size: 18px; font-weight: 800; color: #1a1a2e; }
    .op-sub { margin: 3px 0 0; font-size: 12px; color: #5d6b7e; }
    .op-x { border: none; background: none; cursor: pointer; color: #5d6b7e; border-radius: 8px; padding: 4px; display: flex; }
    .op-x:hover { background: #f1f3f7; }
    .op-x:focus-visible, .op-link:focus-visible, .op-btn:focus-visible, .op-seg button:focus-visible, .op-person:focus-visible { outline: 2px solid #1565c0; outline-offset: 2px; }
    .op-state { flex: 1; display: flex; align-items: center; justify-content: center; gap: 12px; color: #5d6b7e; }
    .op-state--err { color: #b71c1c; }

    .op-banner { display: flex; align-items: center; gap: 10px; margin: 10px 20px 0; padding: 8px 12px; background: #fff8e1; border: 1px solid #ffe08a; border-radius: 9px; font-size: 12px; color: #5d4300; }
    .op-banner mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .op-banner .op-link { margin-left: auto; }
    .op-note { display: flex; align-items: center; gap: 8px; margin: 8px 20px 0; padding: 7px 12px; background: #fff3e0; border: 1px dashed #e65100; border-radius: 9px; font-size: 12px; color: #7a2e00; }
    .op-tag { display: inline-block; font-size: 9.5px; font-weight: 800; letter-spacing: 0.4px; color: #8a2f00; background: #ffe0b2; border: 1px dashed #e65100; border-radius: 8px; padding: 0 6px; margin-left: 6px; vertical-align: middle; }
    .op-note .op-tag { margin-left: 0; }
    .op-tag--rev { color: #4a2a8a; background: #ede7f6; border: 1px solid #b39ddb; }
    .op-link { border: none; background: none; color: #0d47a1; font-weight: 700; font-size: 12px; cursor: pointer; padding: 2px 4px; border-radius: 4px; font-family: inherit; }
    .op-link:hover:not(:disabled) { text-decoration: underline; }
    .op-link:disabled { color: #8a94a6; cursor: default; }

    .op-body { flex: 1; min-height: 0; display: flex; gap: 14px; padding: 12px 20px; }
    .op-side { width: 270px; flex-shrink: 0; border: 1px solid #e6e9ef; border-radius: 10px; display: flex; flex-direction: column; min-height: 0; }
    .op-side-head { display: flex; justify-content: space-between; align-items: center; padding: 9px 12px; font-size: 11px; font-weight: 800; color: #3b4658; text-transform: uppercase; letter-spacing: 0.4px; border-bottom: 1px solid #eef1f5; }
    .op-count { font-weight: 600; color: #5d6b7e; text-transform: none; letter-spacing: 0; }
    .op-plist { list-style: none; margin: 0; padding: 4px 0; overflow-y: auto; flex: 1; }
    .op-pitem { display: flex; align-items: center; gap: 8px; padding: 6px 12px; font-size: 12.5px; cursor: pointer; color: #1a1a2e; }
    .op-pitem:hover { background: #f5f8fd; }
    .op-pitem--off .op-pname { text-decoration: line-through; color: #78859a; }
    .op-pitem input { width: 16px; height: 16px; accent-color: #1565c0; flex-shrink: 0; }
    .op-pname { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .op-phc { font-size: 11px; color: #5d6b7e; font-variant-numeric: tabular-nums; }
    .op-side-foot { margin: 0; padding: 8px 12px; font-size: 11px; color: #5d6b7e; border-top: 1px solid #eef1f5; line-height: 1.4; }

    .op-main { flex: 1; min-width: 0; display: flex; flex-direction: column; min-height: 0; }
    .op-tools { display: flex; align-items: center; gap: 14px; margin-bottom: 8px; flex-wrap: wrap; }
    .op-seg { display: inline-flex; border: 1px solid #d8dee8; border-radius: 9px; overflow: hidden; }
    .op-seg button { border: none; background: #fff; padding: 0 14px; height: 30px; font-size: 12px; font-weight: 600; color: #4a5a6e; cursor: pointer; font-family: inherit; }
    .op-seg button.on { background: #1565c0; color: #fff; }
    .op-hint { font-size: 11px; color: #5d6b7e; }
    .op-scroll { flex: 1; min-height: 0; overflow: auto; border: 1px solid #e6e9ef; border-radius: 10px; }
    .op-table { border-collapse: separate; border-spacing: 0; font-size: 12px; min-width: 100%; }
    .op-table th, .op-table td { padding: 5px 9px; border-bottom: 1px solid #f0f2f6; white-space: nowrap; }
    .op-table thead th { position: sticky; top: 0; background: #fafbfc; z-index: 2; font-size: 10.5px; font-weight: 700; color: #5d6b7e; text-transform: uppercase; letter-spacing: 0.3px; border-bottom: 1px solid #e6e9ef; }
    .op-grp th { text-align: center; border-left: 1px solid #e6e9ef; color: #3b4658; }
    .op-grp th.op-name { border-left: none; }
    .op-table thead tr:nth-child(2) th { top: 29px; }
    .op-name { position: sticky; left: 0; background: #fff; z-index: 1; text-align: left; min-width: 250px; max-width: 320px; font-weight: 500; color: #1a1a2e; }
    thead .op-name { background: #fafbfc; z-index: 3; }
    .op-num { text-align: right; font-variant-numeric: tabular-nums; min-width: 52px; }
    .op-zero { color: #b0b8c4; }
    td.op-fc, th.op-fc { background: #f4f8ff; }
    td.op-over { color: #b71c1c; font-weight: 800; background: #ffebee; }
    .op-person { display: inline-flex; align-items: center; gap: 2px; border: none; background: none; cursor: pointer; font: inherit; font-weight: 800; color: #1a1a2e; padding: 0; }
    .op-person mat-icon { font-size: 18px; width: 18px; height: 18px; color: #5d6b7e; }
    .op-r--person th, .op-r--person td { background: #f7f9fc; font-weight: 700; }
    .op-r--person td.op-over { background: #ffebee; }
    .op-r--person td.op-fc { background: #eef4ff; }
    .op-r--project .op-name { padding-left: 30px; }
    .op-r--ss .op-name { padding-left: 30px; color: #5d6b7e; }
    .op-r--est th, .op-r--est td { background: repeating-linear-gradient(45deg, #fff3e0, #fff3e0 5px, #ffe9cc 5px, #ffe9cc 10px); color: #7a2e00; }
    .op-rsub { margin-left: 6px; font-size: 10.5px; color: #78859a; }
    .op-r--summary th, .op-r--summary td { font-weight: 800; background: #eef2f7; border-top: 1px solid #d8dee8; }
    .op-s--over th, .op-s--over td { color: #b71c1c; }
    .op-s--hire th, .op-s--hire td { color: #8a2f00; background: #fff3e0; }
    .op-s--fit th, .op-s--fit td { color: #5d4300; background: #f5f0ff; font-weight: 600; font-size: 12px; }
    .op-s--unassigned th, .op-s--unassigned td { color: #5d4300; background: #fff8e1; }
    .op-s--hireProj th, .op-s--hireProj td, .op-s--unassignedProj th, .op-s--unassignedProj td { font-weight: 500; font-size: 11.5px; background: #fff; border-top: none; color: #5d6b7e; }

    .op-foot { display: flex; align-items: center; gap: 10px; padding: 12px 20px; border-top: 1px solid #eceff4; }
    .op-foot-note { margin-right: auto; font-size: 12px; color: #5d6b7e; }
    .op-btn { display: inline-flex; align-items: center; gap: 6px; height: 36px; padding: 0 16px; border-radius: 9px; font-size: 13px; font-weight: 700; cursor: pointer; font-family: inherit; border: 1px solid transparent; }
    .op-btn mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .op-btn--ghost { background: #fff; border-color: #d8dee8; color: #1a1a2e; }
    .op-btn--primary { background: #1565c0; color: #fff; }
    .op-btn--primary:disabled { background: #9bb8dc; cursor: default; }
  `]
})
export class OutputPreviewComponent implements OnInit {
  private api = inject(ApiService);
  private auth = inject(AuthService);

  readonly manager = input<string>('');
  readonly format = input<'monthly' | 'weekly'>('monthly');
  readonly fromQuarter = input<string | undefined>(undefined);
  readonly toQuarter = input<string | undefined>(undefined);
  readonly includeEstimates = input<boolean>(false);
  /** Include the project adjustments (two-way: the page uses the same choice for the download) */
  readonly useFlex = model<boolean>(true);
  readonly downloading = input<boolean>(false);

  readonly closed = output<void>();
  readonly download = output<void>();

  private dialog = viewChild<ElementRef<HTMLElement>>('dialog');

  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly model = signal<OutModel | null>(null);
  readonly months = signal(false);
  private open = signal<Set<number>>(new Set());

  readonly rangeText = computed(() => {
    const m = this.model();
    if (!m || !m.quarters.length) return this.fromQuarter() && this.toQuarter() ? `${this.fromQuarter()} → ${this.toQuarter()}` : 'all quarters with data';
    return `${m.quarters[0].label} → ${m.quarters[m.quarters.length - 1].label}`;
  });
  readonly excludedCount = computed(() => this.model()?.excluded.length ?? 0);
  readonly includedCount = computed(() => (this.model()?.projects ?? []).filter(p => p.included).length);
  readonly allOpen = computed(() => { const m = this.model(); return !!m && m.people.length > 0 && this.open().size >= m.people.length; });

  /** Columns: one per quarter (average of its periods) or one per period (month / week). */
  readonly colHeads = computed(() => {
    const m = this.model();
    if (!m) return [];
    const fc = new Map(m.quarters.map(q => [q.label, q.forecast]));
    return this.months()
      ? m.periods.map((p, i) => ({ key: `p${i}`, label: p.col, forecast: !!fc.get(p.quarter) }))
      : m.quarters.map(q => ({ key: q.label, label: q.label, forecast: q.forecast }));
  });
  readonly groups = computed(() => {
    const m = this.model();
    if (!m) return [];
    return m.quarters.map(q => ({ label: q.label, forecast: q.forecast, span: m.periods.filter(p => p.quarter === q.label).length }));
  });

  readonly rows = computed<PreviewRow[]>(() => {
    const m = this.model();
    if (!m) return [];
    const open = this.open();
    const months = this.months();
    const idx = m.quarters.map(q => m.periods.map((p, i) => (p.quarter === q.label ? i : -1)).filter(i => i >= 0));
    // Collapse month/week values to a quarter average unless the user asked for the raw columns
    const agg = <T extends { v: number }>(vals: T[]): OutCell[] => months
      ? vals.map(c => ({ ...(c as OutCell) }))
      : idx.map(ix => {
          const part = ix.map(i => vals[i]);
          const avg = part.length ? part.reduce((s, c) => s + c.v, 0) / part.length : 0;
          const any = part as OutCell[];
          return { v: avg, over: any.some(c => c.over) && avg > 1.005, fc: any.some(c => c.fc), fromData: any.every(c => c.fromData) };
        });
    const aggNum = (vals: number[]): OutCell[] => agg(vals.map(v => ({ v })));

    const out: PreviewRow[] = [];
    for (const p of m.people) {
      out.push({ key: `p${p.person_id}`, kind: 'person', label: p.name, personId: p.person_id, cells: agg(p.work) });
      if (!open.has(p.person_id)) continue;
      p.projects.forEach((pr, i) => out.push({ key: `p${p.person_id}-pr${i}`, kind: 'project', label: pr.flex ? pr.name + ' (adjusted)' : pr.name, est: pr.est, prov: pr.prov, cells: agg(pr.vals) }));
      p.ss.forEach((s, i) => out.push({ key: `p${p.person_id}-ss${i}`, kind: 'ss', label: s.label, sub: 'steady state', cells: agg(s.vals) }));
    }
    m.summary.forEach((s, i) => out.push({ key: `s${i}`, kind: 'summary', summaryKind: s.kind, label: s.label.trim(), cells: aggNum(s.vals) }));
    return out;
  });

  constructor() {
    afterNextRender(() => this.dialog()?.nativeElement.focus());
  }

  ngOnInit() { this.load(true); }

  fmt(v: number): string { return v ? (Math.round(v * 100) / 100).toFixed(2) : '–'; }

  isOpen(personId: number): boolean { return this.open().has(personId); }
  toggleOpen(personId: number) {
    this.open.update(s => { const n = new Set(s); n.has(personId) ? n.delete(personId) : n.add(personId); return n; });
  }
  toggleAll() {
    const m = this.model();
    if (!m) return;
    this.open.set(this.allOpen() ? new Set() : new Set(m.people.map(p => p.person_id)));
  }

  toggleProject(p: OutProject) {
    const m = this.model();
    if (!m) return;
    const off = new Set(m.projects.filter(x => !x.included).map(x => x.project_id));
    p.included ? off.add(p.project_id) : off.delete(p.project_id);
    this.persist([...off]);
  }
  resetExclusions() { this.persist([]); }
  setUseFlex(on: boolean) { this.useFlex.set(on); this.load(false); }

  /** Save the exclusion set (remembered per manager), then rebuild the preview from the same model the download uses. */
  private persist(ids: number[]) {
    this.saving.set(true);
    this.api.saveOutputExclusions(this.manager() || undefined, ids, this.auth.user()?.email).subscribe({
      next: () => { this.saving.set(false); this.load(false); },
      error: () => { this.saving.set(false); this.error.set('Could not save your selection. Please try again.'); }
    });
  }

  private load(first: boolean) {
    if (first) this.loading.set(true);
    this.error.set('');
    this.api.getOutputPreview(this.manager() || undefined, this.format(), this.fromQuarter(), this.toQuarter(), this.includeEstimates(), this.useFlex()).subscribe({
      next: (r: any) => {
        this.model.set(r.data as OutModel);
        this.loading.set(false);
      },
      error: (e: any) => {
        this.loading.set(false);
        this.error.set(e?.status === 404 ? 'No people found for this team, so there is nothing to preview.' : 'Could not build the preview. The backend may need a restart.');
      }
    });
  }
}
