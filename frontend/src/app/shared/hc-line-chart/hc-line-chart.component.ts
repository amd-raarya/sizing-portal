import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';

export type HcPointKind = 'actual' | 'planned' | 'forecast';

export interface HcPoint {
  label: string;
  value: number;
  /** actual = past/current data · planned = future quarter already in uploaded data · forecast = projected beyond data */
  kind: HcPointKind;
}

/**
 * Small dependency-free SVG line chart used for team / project / person HC trends.
 * - Solid line = data (actual + planned). Dashed line = forecast beyond the data.
 * - Red dashed horizontal line = capacity (optional). Points above it are marked red.
 * - Vertical "Today" marker separates past from future.
 */
@Component({
  selector: 'app-hc-line-chart',
  imports: [DecimalPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display:block' },
  template: `
    <div class="hlc" [class.hlc--compact]="compact()" [style.height.px]="height()"
      role="img" [attr.aria-label]="ariaSummary()">

      <!-- Plot area -->
      <div class="hlc-plot"
        (mousemove)="onMove($event)" (mouseleave)="hover.set(null)">
        <svg viewBox="0 0 1000 100" preserveAspectRatio="none" class="hlc-svg" aria-hidden="true">
          <defs>
            <linearGradient [attr.id]="gradId" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" [attr.stop-color]="color()" stop-opacity="0.22" />
              <stop offset="100%" [attr.stop-color]="color()" stop-opacity="0.02" />
            </linearGradient>
          </defs>

          <!-- Future shading -->
          @if (nowX() !== null) {
            <rect [attr.x]="nowX()" y="0" [attr.width]="1000 - (nowX() ?? 0)" height="100" class="hlc-future" />
          }

          <!-- Grid -->
          @for (t of yTicks(); track t.value) {
            <line x1="0" x2="1000" [attr.y1]="t.y" [attr.y2]="t.y" class="hlc-grid" vector-effect="non-scaling-stroke" />
          }

          <!-- Capacity line -->
          @if (capacityY() !== null) {
            <line x1="0" x2="1000" [attr.y1]="capacityY()" [attr.y2]="capacityY()" class="hlc-cap" vector-effect="non-scaling-stroke" />
          }

          <!-- Area + lines -->
          @if (areaPath()) { <path [attr.d]="areaPath()" [attr.fill]="'url(#' + gradId + ')'" /> }
          @if (solidPath()) { <path [attr.d]="solidPath()" class="hlc-line" [attr.stroke]="color()" vector-effect="non-scaling-stroke" /> }
          @if (dashedPath()) { <path [attr.d]="dashedPath()" class="hlc-line hlc-line--dash" [attr.stroke]="color()" vector-effect="non-scaling-stroke" /> }

          <!-- Today marker -->
          @if (nowX() !== null) {
            <line [attr.x1]="nowX()" [attr.x2]="nowX()" y1="0" y2="100" class="hlc-now" vector-effect="non-scaling-stroke" />
          }
        </svg>

        <!-- Over-capacity dots -->
        @for (d of overDots(); track d.label) {
          <span class="hlc-dot hlc-dot--over" [style.left.%]="d.left" [style.top.%]="d.top"></span>
        }

        <!-- Today label -->
        @if (nowX() !== null && !compact()) {
          <span class="hlc-now-label" [style.left.%]="(nowX() ?? 0) / 10">Today</span>
        }

        <!-- Capacity label -->
        @if (capacityY() !== null && !compact()) {
          <span class="hlc-cap-label" [style.top.%]="capacityY()">Capacity {{ capacity() | number:'1.0-1' }}</span>
        }

        <!-- Hover -->
        @if (hoverPoint(); as h) {
          <div class="hlc-cross" [style.left.%]="h.left"></div>
          <span class="hlc-dot hlc-dot--hover" [style.left.%]="h.left" [style.top.%]="h.top"
            [style.background]="h.over ? '#c62828' : color()"></span>
          <div class="hlc-tip" [class.hlc-tip--right]="h.left > 60" [style.left.%]="h.left">
            <div class="hlc-tip-q">{{ h.label }} <span class="hlc-tip-kind hlc-tip-kind--{{h.kind}}">{{ kindLabel(h.kind) }}</span></div>
            <div class="hlc-tip-v">{{ h.value | number:'1.1-1' }} {{ unit() }}</div>
            @if (capacity() !== null && capacity()! > 0) {
              <div class="hlc-tip-s" [class.hlc-tip-s--over]="h.over">
                {{ (h.value / capacity()!) * 100 | number:'1.0-0' }}% of capacity
                @if (h.over) { · +{{ h.value - capacity()! | number:'1.1-1' }} over }
              </div>
            }
          </div>
        }
      </div>

      <!-- Y labels -->
      @if (!compact()) {
        <div class="hlc-y">
          @for (t of yTicks(); track t.value) {
            <span class="hlc-y-label" [style.top.%]="t.y">{{ t.value | number:'1.0-1' }}</span>
          }
        </div>
      }

      <!-- X labels -->
      <div class="hlc-x">
        @for (x of xLabels(); track x.label) {
          <span class="hlc-x-label" [class.hlc-x-label--first]="x.edge === 'first'" [class.hlc-x-label--last]="x.edge === 'last'"
            [style.left.%]="x.left">{{ x.label }}</span>
        }
      </div>
    </div>
  `,
  styles: [`
    .hlc { position: relative; width: 100%; box-sizing: border-box; padding: 6px 8px 24px 40px; }
    .hlc--compact { padding: 2px 0 16px 0; }
    .hlc-plot { position: absolute; left: 40px; right: 8px; top: 6px; bottom: 24px; }
    .hlc--compact .hlc-plot { left: 0; right: 0; top: 2px; bottom: 16px; }
    .hlc-svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
    .hlc-grid { stroke: #eceff3; stroke-width: 1; }
    .hlc--compact .hlc-grid { display: none; }
    .hlc-future { fill: #f3f6fb; }
    .hlc-cap { stroke: #c62828; stroke-width: 1.2; stroke-dasharray: 5 4; opacity: 0.85; }
    .hlc-line { fill: none; stroke-width: 2.4; stroke-linejoin: round; stroke-linecap: round; }
    .hlc--compact .hlc-line { stroke-width: 2; }
    .hlc-line--dash { stroke-dasharray: 6 5; opacity: 0.8; }
    .hlc-now { stroke: #90a4ae; stroke-width: 1; stroke-dasharray: 2 3; }
    .hlc-now-label { position: absolute; top: 2px; transform: translateX(4px); font-size: 10px; font-weight: 700; color: #607d8b; text-transform: uppercase; letter-spacing: 0.4px; pointer-events: none; }
    .hlc-cap-label { position: absolute; right: 4px; transform: translateY(-115%); font-size: 10px; font-weight: 700; color: #c62828; pointer-events: none; background: rgba(255,255,255,0.8); padding: 0 3px; border-radius: 3px; }
    .hlc-dot { position: absolute; width: 8px; height: 8px; border-radius: 50%; transform: translate(-50%, -50%); pointer-events: none; border: 1.5px solid #fff; box-sizing: border-box; }
    .hlc-dot--over { background: #c62828; }
    .hlc-dot--hover { width: 11px; height: 11px; box-shadow: 0 1px 4px rgba(0,0,0,0.3); }
    .hlc-cross { position: absolute; top: 0; bottom: 0; width: 1px; background: #b0bec5; pointer-events: none; }
    .hlc-tip { position: absolute; top: -4px; transform: translateX(10px); background: #1a1a2e; color: #fff; padding: 7px 10px; border-radius: 8px; font-size: 11px; white-space: nowrap; pointer-events: none; z-index: 5; box-shadow: 0 4px 14px rgba(0,0,0,0.25); }
    .hlc-tip--right { transform: translateX(calc(-100% - 10px)); }
    .hlc-tip-q { font-weight: 700; display: flex; align-items: center; gap: 6px; }
    .hlc-tip-kind { font-size: 9px; font-weight: 700; padding: 1px 6px; border-radius: 8px; text-transform: uppercase; letter-spacing: 0.3px; }
    .hlc-tip-kind--actual { background: #2e7d32; }
    .hlc-tip-kind--planned { background: #1565c0; }
    .hlc-tip-kind--forecast { background: #8e24aa; }
    .hlc-tip-v { font-size: 15px; font-weight: 800; margin-top: 2px; }
    .hlc-tip-s { font-size: 10px; color: #b0bec5; margin-top: 1px; }
    .hlc-tip-s--over { color: #ff8a80; font-weight: 700; }
    .hlc-y { position: absolute; left: 0; top: 6px; bottom: 24px; width: 36px; pointer-events: none; }
    .hlc-y-label { position: absolute; right: 4px; transform: translateY(-50%); font-size: 10px; color: #8a94a6; font-variant-numeric: tabular-nums; }
    .hlc-x { position: absolute; left: 40px; right: 8px; bottom: 4px; height: 16px; pointer-events: none; }
    .hlc--compact .hlc-x { left: 0; right: 0; bottom: 0; height: 12px; }
    .hlc-x-label { position: absolute; transform: translateX(-50%); font-size: 10px; color: #8a94a6; white-space: nowrap; }
    .hlc--compact .hlc-x-label { font-size: 9px; }
    .hlc-x-label--first { transform: none; }
    .hlc-x-label--last { transform: translateX(-100%); }
  `]
})
export class HcLineChartComponent {
  private static seq = 0;
  readonly gradId = `hlc-grad-${HcLineChartComponent.seq++}`;

  points = input.required<HcPoint[]>();
  /** Capacity reference line (HC). null = no line. */
  capacity = input<number | null>(null);
  /** Label of the current quarter — draws the "Today" marker. */
  nowLabel = input<string | null>(null);
  height = input(220);
  compact = input(false);
  color = input('#1565c0');
  unit = input('HC');

  hover = signal<number | null>(null);

  /** Axis range. Starts at 0 unless the data is bunched near the top (then it zooms in so the trend is readable). */
  private scale = computed(() => {
    const vals = this.points().map(p => p.value);
    const ref = this.capacity();
    const all = ref !== null && ref > 0 ? [...vals, ref] : vals;
    const maxV = Math.max(...all, 0.1);
    const minV = Math.min(...all, maxV);
    const pad = Math.max((maxV - minV) * 0.25, maxV * 0.04, 0.05);
    let hi = maxV + pad;
    let lo = minV - pad;
    if (lo < hi * 0.35 || maxV - minV < 0.1) lo = 0;  // not bunched (or basically flat) → keep an honest zero baseline
    const rawStep = (hi - lo) / 3;
    const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
    const norm = rawStep / mag;
    const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
    lo = Math.floor(lo / step + 1e-9) * step;
    hi = Math.ceil(hi / step - 1e-9) * step;
    if (hi <= lo) hi = lo + step;
    return { lo, hi, step };
  });

  private xAt(i: number): number {
    const n = this.points().length;
    return n <= 1 ? 500 : (i / (n - 1)) * 1000;
  }
  private yAt(v: number): number {
    const { lo, hi } = this.scale();
    return 100 - ((v - lo) / (hi - lo)) * 100;
  }

  yTicks = computed(() => {
    const { lo, hi, step } = this.scale();
    const out: { value: number; y: number }[] = [];
    for (let v = lo; v <= hi + step * 0.001 && out.length < 6; v += step) out.push({ value: v, y: this.yAt(v) });
    return out;
  });

  capacityY = computed(() => {
    const c = this.capacity();
    return c !== null && c > 0 ? this.yAt(c) : null;
  });

  nowX = computed(() => {
    const now = this.nowLabel();
    if (!now) return null;
    const idx = this.points().findIndex(p => p.label === now);
    return idx < 0 ? null : this.xAt(idx);
  });

  private coords = computed(() => this.points().map((p, i) => ({ x: this.xAt(i), y: this.yAt(p.value), kind: p.kind })));

  solidPath = computed(() => {
    const pts = this.coords().filter(c => c.kind !== 'forecast');
    return pts.length > 1 ? pts.map((c, i) => `${i ? 'L' : 'M'}${c.x.toFixed(1)},${c.y.toFixed(2)}`).join(' ') : '';
  });

  dashedPath = computed(() => {
    const all = this.coords();
    const firstF = all.findIndex(c => c.kind === 'forecast');
    if (firstF < 0) return '';
    const pts = all.slice(Math.max(0, firstF - 1));   // overlap one point so the line stays connected
    return pts.length > 1 ? pts.map((c, i) => `${i ? 'L' : 'M'}${c.x.toFixed(1)},${c.y.toFixed(2)}`).join(' ') : '';
  });

  areaPath = computed(() => {
    const pts = this.coords().filter(c => c.kind !== 'forecast');
    if (pts.length < 2) return '';
    const line = pts.map((c, i) => `${i ? 'L' : 'M'}${c.x.toFixed(1)},${c.y.toFixed(2)}`).join(' ');
    return `${line} L${pts[pts.length - 1].x.toFixed(1)},100 L${pts[0].x.toFixed(1)},100 Z`;
  });

  overDots = computed(() => {
    const cap = this.capacity();
    if (cap === null || cap <= 0) return [];
    return this.points()
      .map((p, i) => ({ label: p.label, value: p.value, left: this.xAt(i) / 10, top: this.yAt(p.value) }))
      .filter(d => d.value > cap + 0.0001);
  });

  xLabels = computed(() => {
    const pts = this.points();
    const n = pts.length;
    if (!n) return [];
    if (this.compact()) {
      const out: { label: string; left: number; edge: 'first' | 'last' | null }[] = [{ label: pts[0].label, left: 0, edge: 'first' }];
      if (n > 1) out.push({ label: pts[n - 1].label, left: 100, edge: 'last' });
      return out;
    }
    const step = Math.max(1, Math.ceil(n / 8));
    const out: { label: string; left: number; edge: 'first' | 'last' | null }[] = [];
    for (let i = 0; i < n; i += step) {
      out.push({ label: pts[i].label, left: this.xAt(i) / 10, edge: i === 0 ? 'first' : null });
    }
    return out;
  });

  hoverPoint = computed(() => {
    const i = this.hover();
    const pts = this.points();
    if (i === null || !pts[i]) return null;
    const cap = this.capacity();
    return {
      label: pts[i].label, value: pts[i].value, kind: pts[i].kind,
      left: this.xAt(i) / 10, top: this.yAt(pts[i].value),
      over: cap !== null && cap > 0 && pts[i].value > cap + 0.0001
    };
  });

  ariaSummary = computed(() => {
    const pts = this.points();
    if (!pts.length) return 'No data';
    const max = pts.reduce((m, p) => (p.value > m.value ? p : m), pts[0]);
    return `Line chart of ${this.unit()} from ${pts[0].label} to ${pts[pts.length - 1].label}. Peak ${max.value.toFixed(1)} in ${max.label}.`;
  });

  kindLabel(k: HcPointKind): string {
    return k === 'actual' ? 'Actual' : k === 'planned' ? 'Planned' : 'Forecast';
  }

  onMove(ev: MouseEvent) {
    const n = this.points().length;
    if (!n) return;
    const el = ev.currentTarget as HTMLElement;
    const rect = el.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (ev.clientX - rect.left) / rect.width));
    this.hover.set(n === 1 ? 0 : Math.round(frac * (n - 1)));
  }
}
