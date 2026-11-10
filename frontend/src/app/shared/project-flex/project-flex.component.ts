import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, OnInit, afterNextRender, computed, inject, input, output, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DecimalPipe } from '@angular/common';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { debounceTime, switchMap } from 'rxjs';
import { ApiService } from '../../services/api.service';

interface FlexRow { key: number; label: string; fy: number; q: number; hc: number }
interface FlexView {
  project: { project_id: number; project_name: string; status: string };
  sized: FlexRow[]; flexed: FlexRow[]; actual: FlexRow[]; gap_sized: FlexRow[]; gap_flexed: FlexRow[];
  totals: { sized: number; flexed: number; peak_sized: number; peak_flexed: number };
  rule: { updated_by?: string; updated_at?: string; note?: string } | null;
  sizing_changed?: boolean;
}
interface QuarterLine { key: number; label: string; sized: number; flexed: number; actual: number; gap: number }

const sum = (rows: FlexRow[]) => rows.reduce((s, r) => s + r.hc, 0);

/**
 * Adjust a project's sizing without touching it. The approved sizing from Sam stays the baseline; what is saved here is a small RULE
 * (move / run longer or shorter / scale HC) that the backend applies live to plans, gaps and the Assignment Output.
 * Change or reset it whenever the plan changes: nothing is baked into the data.
 */
@Component({
  selector: 'app-project-flex',
  imports: [ReactiveFormsModule, DecimalPipe, MatIconModule, MatProgressSpinnerModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(keydown.escape)': 'closed.emit()' },
  template: `
    <div class="pf-backdrop" (click)="closed.emit()"></div>
    <div class="pf-dialog" role="dialog" aria-modal="true" aria-labelledby="pf-title" tabindex="-1" #dialog>
      <header class="pf-head">
        <div>
          <h2 id="pf-title" class="pf-title">Adjust sizing &middot; {{ projectName() }}</h2>
          <p class="pf-sub">The approved sizing stays as it is. This adjustment is applied live to the plan, the gap and the Assignment Output, so you can change or reset it any time.</p>
        </div>
        <button type="button" class="pf-x" (click)="closed.emit()" aria-label="Close"><mat-icon aria-hidden="true">close</mat-icon></button>
      </header>

      @if (loading()) {
        <div class="pf-state"><mat-spinner diameter="28"></mat-spinner><span>Loading&hellip;</span></div>
      } @else if (error()) {
        <div class="pf-error" role="alert">{{ error() }}</div>
      } @else if (view(); as v) {
        <div class="pf-body">
          <form class="pf-form" [formGroup]="form" (ngSubmit)="save()">
            @if (v.sizing_changed) {
              <div class="pf-warn" role="status"><mat-icon aria-hidden="true">info</mat-icon>
                <span>A newer sizing was submitted after this adjustment was set. Check that it still fits.</span></div>
            }
            <div class="pf-grid">
              <label class="pf-field">
                <span class="pf-lab">Move the project (quarters)</span>
                <input type="number" step="1" formControlName="shift_q" />
                <span class="pf-hint">+2 = two quarters later, -1 = one quarter earlier</span>
              </label>
              <label class="pf-field">
                <span class="pf-lab">Run longer / shorter (quarters)</span>
                <input type="number" step="1" formControlName="extend_q" />
                <span class="pf-hint">+4 = four extra quarters at the end, -2 = ends two quarters sooner</span>
              </label>
              <label class="pf-field pf-field--wide">
                <span class="pf-lab">The extra quarters look like</span>
                <select formControlName="tail_mode">
                  <option value="hold">Hold: the last sized HC continues</option>
                  <option value="fade">Fade out: the last sized HC tapers to zero</option>
                  <option value="stretch">Stretch: the whole curve is spread over the new length</option>
                </select>
              </label>
              <label class="pf-field">
                <span class="pf-lab">Scale HC (%)</span>
                <input type="number" step="5" min="0" formControlName="hc_pct" />
                <span class="pf-hint">100 = unchanged, 120 = 20% more</span>
              </label>
              <label class="pf-field">
                <span class="pf-lab">Add HC per quarter</span>
                <input type="number" step="0.5" formControlName="hc_add" />
                <span class="pf-hint">Shared between managers in proportion to their sizing</span>
              </label>
              <fieldset class="pf-field pf-field--wide pf-from">
                <legend class="pf-lab">Apply the HC change from</legend>
                <select formControlName="from_fy" aria-label="From year">
                  <option [ngValue]="null">Whole project</option>
                  @for (y of years(); track y) { <option [ngValue]="y">FY{{ y % 100 }}</option> }
                </select>
                <select formControlName="from_q" aria-label="From quarter">
                  <option [ngValue]="null">&ndash;</option>
                  @for (q of [1,2,3,4]; track q) { <option [ngValue]="q">Q{{ q }}</option> }
                </select>
              </fieldset>
              <label class="pf-field pf-field--wide">
                <span class="pf-lab">Note (why)</span>
                <input type="text" maxlength="500" formControlName="note" placeholder="e.g. tape-out slipped two quarters (agreed with Fai)" />
              </label>
            </div>
            @if (v.rule && !dirty()) {
              <p class="pf-meta">Adjustment in force{{ v.rule.updated_by ? ' &middot; set by ' + v.rule.updated_by : '' }}.</p>
            }
          </form>

          <section class="pf-result" aria-label="Effect of the adjustment">
            <div class="pf-kpis">
              <div class="pf-kpi"><span class="pf-kv">{{ v.totals.sized | number:'1.0-1' }}</span><span class="pf-kl">Approved sizing (HC-quarters)</span></div>
              <div class="pf-kpi pf-kpi--new"><span class="pf-kv">{{ v.totals.flexed | number:'1.0-1' }}</span><span class="pf-kl">Adjusted</span></div>
              <div class="pf-kpi"><span class="pf-kv">{{ gapSized() | number:'1.0-1' }}</span><span class="pf-kl">Gap today vs sizing</span></div>
              <div class="pf-kpi pf-kpi--new"><span class="pf-kv">{{ gapFlexed() | number:'1.0-1' }}</span><span class="pf-kl">Gap vs adjusted</span></div>
            </div>
            <p class="pf-note">Gap = HC the plan asks for minus HC people already carry on the project, summed over quarters where it is short.</p>

            <svg class="pf-chart" [attr.viewBox]="'0 0 ' + chartW() + ' 130'" role="img" [attr.aria-label]="chartLabel()" preserveAspectRatio="none">
              @for (b of bars(); track b.label) {
                <rect [attr.x]="b.x" [attr.y]="b.sy" width="6" [attr.height]="b.sh" fill="#90a4ae" />
                <rect [attr.x]="b.x + 7" [attr.y]="b.fy" width="6" [attr.height]="b.fh" fill="#1565c0" />
                <rect [attr.x]="b.x + 14" [attr.y]="b.ay" width="6" [attr.height]="b.ah" fill="#ef6c00" />
              }
            </svg>
            <div class="pf-legend" aria-hidden="true">
              <span><i style="background:#90a4ae"></i>Approved sizing</span><span><i style="background:#1565c0"></i>Adjusted</span><span><i style="background:#ef6c00"></i>HC people carry today</span>
            </div>

            <div class="pf-table-wrap" tabindex="0" role="region" aria-label="HC per quarter">
              <table class="pf-table">
                <thead><tr><th scope="col">Quarter</th><th scope="col">Sizing</th><th scope="col">Adjusted</th><th scope="col">Today</th><th scope="col">Gap</th></tr></thead>
                <tbody>
                  @for (l of lines(); track l.key) {
                    <tr [class.pf-changed]="l.sized !== l.flexed">
                      <th scope="row">{{ l.label }}</th>
                      <td>{{ l.sized | number:'1.0-2' }}</td><td>{{ l.flexed | number:'1.0-2' }}</td><td>{{ l.actual | number:'1.0-2' }}</td>
                      <td [class.pf-gap]="l.gap > 0.0005">{{ l.gap | number:'1.0-2' }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </section>
        </div>

        <footer class="pf-foot">
          @if (message()) { <span class="pf-msg" role="status">{{ message() }}</span> }
          @if (v.rule) {
            <button type="button" class="pf-btn pf-btn--ghost" (click)="reset()" [disabled]="busy()">Reset to sizing</button>
          }
          <span class="pf-spacer"></span>
          <button type="button" class="pf-btn pf-btn--ghost" (click)="closed.emit()">Cancel</button>
          <button type="button" class="pf-btn pf-btn--primary" (click)="save()" [disabled]="busy() || previewing() || !!formError()">
            {{ busy() ? 'Saving…' : 'Save adjustment' }}
          </button>
        </footer>
      }
    </div>
  `,
  styles: [`
    :host { position: fixed; inset: 0; z-index: 1300; display: flex; align-items: center; justify-content: center; }
    .pf-backdrop { position: absolute; inset: 0; background: rgba(20,24,38,0.45); }
    .pf-dialog { position: relative; width: min(980px, 96vw); max-height: 92vh; background: #fff; border-radius: 14px; box-shadow: 0 20px 60px rgba(0,0,0,0.3); display: flex; flex-direction: column; overflow: hidden; outline: none; }
    .pf-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 16px 20px 10px; border-bottom: 1px solid #eceff4; }
    .pf-title { margin: 0; font-size: 18px; font-weight: 800; color: #1a1a2e; }
    .pf-sub { margin: 3px 0 0; font-size: 12px; color: #4a586b; }
    .pf-x { border: 0; background: transparent; cursor: pointer; color: #4a586b; border-radius: 8px; padding: 4px; display: flex; }
    .pf-x:hover { background: #eef1f6; }
    .pf-state { display: flex; gap: 10px; align-items: center; padding: 30px; color: #4a586b; }
    .pf-error { margin: 16px 20px; padding: 10px 12px; background: #ffebee; color: #b71c1c; border-radius: 8px; font-size: 13px; }
    .pf-body { display: grid; grid-template-columns: minmax(280px, 1fr) minmax(300px, 1.2fr); gap: 20px; padding: 16px 20px; overflow: auto; }
    @media (max-width: 800px) { .pf-body { grid-template-columns: 1fr; } }
    .pf-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px 14px; }
    .pf-field { display: flex; flex-direction: column; gap: 3px; border: 0; padding: 0; margin: 0; min-width: 0; }
    .pf-field--wide { grid-column: 1 / -1; }
    .pf-from { flex-direction: row; flex-wrap: wrap; align-items: center; gap: 8px; }
    .pf-from .pf-lab { width: 100%; padding: 0; }
    .pf-lab { font-size: 12px; font-weight: 700; color: #1a1a2e; }
    .pf-hint { font-size: 11px; color: #5d6b7e; }
    .pf-field input, .pf-field select { height: 34px; border: 1px solid #aab4c3; border-radius: 8px; padding: 0 8px; font-size: 13px; background: #fff; color: #1a1a2e; width: 100%; box-sizing: border-box; }
    .pf-from select { width: auto; min-width: 110px; }
    .pf-field input:focus-visible, .pf-field select:focus-visible, .pf-btn:focus-visible, .pf-x:focus-visible, .pf-table-wrap:focus-visible { outline: 2px solid #1565c0; outline-offset: 2px; }
    .pf-warn { display: flex; gap: 8px; align-items: center; background: #fff8e1; color: #6d4c00; border-radius: 8px; padding: 8px 10px; font-size: 12px; margin-bottom: 12px; }
    .pf-warn mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .pf-meta { font-size: 11px; color: #5d6b7e; margin: 10px 0 0; }
    .pf-kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
    .pf-kpi { background: #f4f6fa; border-radius: 10px; padding: 8px 10px; display: flex; flex-direction: column; }
    .pf-kpi--new { background: #e3f2fd; }
    .pf-kv { font-size: 20px; font-weight: 800; color: #1a1a2e; }
    .pf-kl { font-size: 10.5px; color: #4a586b; line-height: 1.25; }
    .pf-note { font-size: 11px; color: #5d6b7e; margin: 6px 0 8px; }
    .pf-chart { width: 100%; height: 130px; background: #fafbfd; border-radius: 8px; }
    .pf-legend { display: flex; flex-wrap: wrap; gap: 12px; font-size: 11px; color: #3a475a; margin: 4px 0 8px; }
    .pf-legend i { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 5px; vertical-align: -1px; }
    .pf-table-wrap { max-height: 190px; overflow: auto; border: 1px solid #e3e8f0; border-radius: 8px; }
    .pf-table { width: 100%; border-collapse: collapse; font-size: 12px; }
    .pf-table th, .pf-table td { padding: 4px 8px; text-align: right; border-bottom: 1px solid #eef1f6; }
    .pf-table thead th { position: sticky; top: 0; background: #f4f6fa; color: #1a1a2e; text-align: right; }
    .pf-table th[scope=row], .pf-table thead th:first-child { text-align: left; font-weight: 600; }
    .pf-changed td:nth-child(3) { background: #e3f2fd; font-weight: 700; }
    .pf-gap { color: #b71c1c; font-weight: 700; }
    .pf-foot { display: flex; align-items: center; gap: 10px; padding: 12px 20px; border-top: 1px solid #eceff4; }
    .pf-spacer { flex: 1; }
    .pf-msg { font-size: 12px; color: #1b5e20; }
    .pf-btn { height: 34px; padding: 0 16px; border-radius: 8px; font-size: 13px; font-weight: 700; cursor: pointer; border: 1px solid transparent; }
    .pf-btn:disabled { opacity: .55; cursor: not-allowed; }
    .pf-btn--primary { background: #1565c0; color: #fff; }
    .pf-btn--ghost { background: #fff; color: #1a1a2e; border-color: #aab4c3; }
  `]
})
export class ProjectFlexComponent implements OnInit {
  private api = inject(ApiService);
  private fb = inject(FormBuilder);
  private destroyRef = inject(DestroyRef);

  readonly projectId = input.required<number>();
  readonly projectName = input<string>('');
  readonly closed = output<void>();
  /** Fires after the adjustment was saved or reset, so the page can reload its plan */
  readonly changed = output<void>();

  private dialog = viewChild<ElementRef<HTMLElement>>('dialog');

  readonly form = this.fb.group({
    shift_q: this.fb.control<number | null>(0), extend_q: this.fb.control<number | null>(0),
    tail_mode: this.fb.control<string>('hold'),
    hc_pct: this.fb.control<number | null>(100), hc_add: this.fb.control<number | null>(0),
    from_fy: this.fb.control<number | null>(null), from_q: this.fb.control<number | null>(null),
    note: this.fb.control<string>('')
  });

  readonly loading = signal(true);
  readonly previewing = signal(false);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly message = signal('');
  readonly view = signal<FlexView | null>(null);
  readonly dirty = signal(false);

  readonly lines = computed<QuarterLine[]>(() => {
    const v = this.view(); if (!v) return [];
    const m = new Map<number, QuarterLine>();
    const get = (r: FlexRow) => { let l = m.get(r.key); if (!l) { l = { key: r.key, label: r.label, sized: 0, flexed: 0, actual: 0, gap: 0 }; m.set(r.key, l); } return l; };
    v.sized.forEach(r => { get(r).sized = r.hc; });
    v.flexed.forEach(r => { get(r).flexed = r.hc; });
    v.actual.forEach(r => { get(r).actual = r.hc; });
    v.gap_flexed.forEach(r => { get(r).gap = r.hc; });
    return [...m.values()].sort((a, b) => a.key - b.key);
  });
  readonly gapSized = computed(() => { const v = this.view(); return v ? sum(v.gap_sized) : 0; });
  readonly gapFlexed = computed(() => { const v = this.view(); return v ? sum(v.gap_flexed) : 0; });
  readonly years = computed(() => {
    const keys = this.lines().map(l => Math.floor((l.key - 1) / 4));
    const now = new Date().getFullYear();
    const lo = Math.min(now, ...keys), hi = Math.max(now + 3, ...keys);
    return Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
  });
  readonly chartW = computed(() => Math.max(300, this.lines().length * 24));
  readonly bars = computed(() => {
    const ls = this.lines();
    const max = Math.max(1, ...ls.map(l => Math.max(l.sized, l.flexed, l.actual)));
    const h = (v: number) => (v / max) * 118;
    return ls.map((l, i) => ({
      label: l.label, x: i * 24 + 2,
      sh: h(l.sized), sy: 124 - h(l.sized), fh: h(l.flexed), fy: 124 - h(l.flexed), ah: h(l.actual), ay: 124 - h(l.actual)
    }));
  });
  readonly chartLabel = computed(() => {
    const v = this.view(); const ls = this.lines();
    return v ? `HC per quarter from ${ls[0]?.label ?? ''} to ${ls[ls.length - 1]?.label ?? ''}: approved sizing totals ${Math.round(v.totals.sized)}, adjusted ${Math.round(v.totals.flexed)} HC-quarters` : '';
  });
  formError(): string { return this.validate(); }

  constructor() {
    afterNextRender(() => this.dialog()?.nativeElement.focus());
    this.form.valueChanges.pipe(debounceTime(250), switchMap(() => { this.dirty.set(true); this.previewing.set(true); return this.api.previewProjectFlex(this.projectId(), this.rule()); }), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (r: any) => { this.view.set(r.data); this.previewing.set(false); this.error.set(''); },
        error: (e: any) => { this.previewing.set(false); this.message.set(e?.error?.error || 'Could not preview this adjustment'); }
      });
  }

  ngOnInit(): void { this.load(); }

  private load(): void {
    this.api.getProjectFlex(this.projectId()).subscribe({
      next: (r: any) => {
        const d: FlexView & { rule: any } = r.data;
        if (d.rule) {
          this.form.reset({ shift_q: d.rule.shift_q, extend_q: d.rule.extend_q, tail_mode: d.rule.tail_mode, hc_pct: d.rule.hc_pct, hc_add: d.rule.hc_add,
            from_fy: d.rule.from_fy, from_q: d.rule.from_q, note: d.rule.note || '' }, { emitEvent: false });
        }
        this.view.set(d); this.dirty.set(false); this.loading.set(false);
      },
      error: (e: any) => { this.error.set(e?.error?.error || 'Could not load this project'); this.loading.set(false); }
    });
  }

  private rule() {
    const f = this.form.getRawValue();
    return { shift_q: f.shift_q ?? 0, extend_q: f.extend_q ?? 0, tail_mode: f.tail_mode, hc_pct: f.hc_pct ?? 100, hc_add: f.hc_add ?? 0, from_fy: f.from_fy, from_q: f.from_q, note: f.note || null };
  }

  private validate(): string {
    const f = this.form.getRawValue();
    if ((f.from_fy && !f.from_q) || (!f.from_fy && f.from_q)) return 'Choose both the year and the quarter';
    if ((f.hc_pct ?? 100) < 0) return 'HC % cannot be negative';
    return '';
  }

  save(): void {
    if (this.validate()) return;
    this.busy.set(true); this.message.set('');
    this.api.saveProjectFlex(this.projectId(), this.rule()).subscribe({
      next: () => { this.busy.set(false); this.changed.emit(); this.closed.emit(); },
      error: (e: any) => { this.busy.set(false); this.message.set(e?.error?.error || 'Could not save'); }
    });
  }

  reset(): void {
    this.busy.set(true); this.message.set('');
    this.api.resetProjectFlex(this.projectId()).subscribe({
      next: () => { this.busy.set(false); this.changed.emit(); this.closed.emit(); },
      error: (e: any) => { this.busy.set(false); this.message.set(e?.error?.error || 'Could not reset'); }
    });
  }
}
