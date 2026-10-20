import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ApiService } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';
import { HcLineChartComponent, HcPoint, HcPointKind } from '../../shared/hc-line-chart/hc-line-chart.component';

type TrendView = 'team' | 'projects' | 'people';
type TeamSeries = 'all' | 'projects' | 'ss';

const keyOf = (label: string): number => {
  const m = label.match(/Q(\d) FY(\d{2})/);
  return m ? (2000 + parseInt(m[2])) * 4 + parseInt(m[1]) : 0;
};
const labelOf = (k: number): string => `Q${((k - 1) % 4) + 1} FY${String(Math.floor((k - 1) / 4)).slice(-2)}`;
const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;

@Component({
  selector: 'app-trends',
  imports: [DecimalPipe, MatIconModule, MatProgressSpinnerModule, MatTooltipModule, HcLineChartComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="tr-page">

      <!-- ── Header ── -->
      <header class="tr-head">
        <div class="tr-head-left">
          <mat-icon class="tr-head-icon">show_chart</mat-icon>
          <div>
            <h1 class="tr-title">HC Trends &amp; Forecast</h1>
            <p class="tr-sub">How loaded the team is — past, planned and forecast — compared with the people available.</p>
          </div>
        </div>
        <div class="tr-controls">
          <label class="tr-field">
            <span>Manager</span>
            <select class="tr-select" [value]="manager()" (change)="onManager($any($event.target).value)">
              <option value="">All teams</option>
              @for (m of managerList(); track m) { <option [value]="m">{{ m }}</option> }
            </select>
          </label>
          <label class="tr-field">
            <span>Horizon</span>
            <select class="tr-select" [value]="horizon()" (change)="horizon.set(+$any($event.target).value)">
              <option value="4">1 year</option>
              <option value="8">2 years</option>
              <option value="12">3 years</option>
              <option value="20">5 years</option>
            </select>
          </label>
          <div class="tr-seg" role="tablist" aria-label="View">
            <button type="button" role="tab" [class.on]="view() === 'team'" [attr.aria-selected]="view() === 'team'" (click)="view.set('team')">
              <mat-icon>groups</mat-icon> Team
            </button>
            <button type="button" role="tab" [class.on]="view() === 'projects'" [attr.aria-selected]="view() === 'projects'" (click)="view.set('projects')">
              <mat-icon>folder_open</mat-icon> Projects
            </button>
            <button type="button" role="tab" [class.on]="view() === 'people'" [attr.aria-selected]="view() === 'people'" (click)="view.set('people')">
              <mat-icon>person</mat-icon> People
            </button>
          </div>
        </div>
      </header>

      @if (loading()) {
        <div class="tr-state"><mat-spinner diameter="36"></mat-spinner><span>Loading HC data…</span></div>
      } @else if (error()) {
        <div class="tr-state tr-state--err"><mat-icon>error_outline</mat-icon><span>Couldn't load the forecast. Check the backend is running and try again.</span></div>
      } @else if (data(); as d) {

        <!-- ── How to read ── -->
        <div class="tr-legend" role="note">
          <span class="tr-legend-title">How to read this</span>
          <span class="lg"><i class="lg-line"></i> Recorded / planned HC (from uploaded data)</span>
          <span class="lg"><i class="lg-line lg-dash"></i> Forecast beyond the data (weighted average of the last 8 quarters)</span>
          <span class="lg"><i class="lg-cap"></i> Capacity = people × 1.0 HC</span>
          <span class="lg"><i class="lg-shade"></i> Future quarters</span>
        </div>

        <!-- ═════════ TEAM ═════════ -->
        @if (view() === 'team') {
          <section class="tr-kpis">
            <div class="kpi">
              <div class="kpi-label">Load this quarter</div>
              <div class="kpi-value">{{ teamKpi().now | number:'1.1-1' }} <small>of {{ teamSize() }} HC</small></div>
              <div class="kpi-bar"><div class="kpi-bar-fill" [class.kpi-bar-fill--over]="teamKpi().pct > 100" [style.width.%]="Math.min(100, teamKpi().pct)"></div></div>
              <div class="kpi-sub">{{ teamKpi().pct }}% of capacity · {{ currentQuarter() }}</div>
            </div>
            <div class="kpi">
              <div class="kpi-label">Peak ahead</div>
              <div class="kpi-value" [class.kpi-value--over]="teamKpi().peakOver > 0">{{ teamKpi().peak | number:'1.1-1' }} <small>HC</small></div>
              <div class="kpi-sub">in {{ teamKpi().peakLabel }}
                @if (teamKpi().peakOver > 0) { · <strong class="neg">{{ teamKpi().peakOver | number:'1.1-1' }} over capacity</strong> }
                @else { · within capacity }
              </div>
            </div>
            <div class="kpi">
              <div class="kpi-label">Quarters over capacity</div>
              <div class="kpi-value" [class.kpi-value--over]="teamKpi().overCount > 0">{{ teamKpi().overCount }} <small>of {{ teamKpi().horizonCount }}</small></div>
              <div class="kpi-sub">
                @if (teamKpi().firstOver) { First: <strong>{{ teamKpi().firstOver }}</strong> } @else { Team stays within capacity }
              </div>
            </div>
            <div class="kpi">
              <div class="kpi-label">Direction</div>
              <div class="kpi-value">
                <span class="dir dir--{{ d.team.pattern }}">{{ patternLabel(d.team.pattern) }}</span>
              </div>
              <div class="kpi-sub">{{ teamKpi().deltaText }}</div>
            </div>
          </section>

          <section class="tr-card">
            <div class="tr-card-head">
              <div>
                <h2 class="tr-card-title">Team HC load vs capacity</h2>
                <p class="tr-card-sub">Each point is the total HC the team is committed to that quarter. Above the red line = more work planned than people available.</p>
              </div>
              <div class="tr-seg tr-seg--sm" role="group" aria-label="Work type">
                <button type="button" [class.on]="series() === 'all'" (click)="series.set('all')">All work</button>
                <button type="button" [class.on]="series() === 'projects'" (click)="series.set('projects')">Projects</button>
                <button type="button" [class.on]="series() === 'ss'" (click)="series.set('ss')">Steady state</button>
              </div>
            </div>
            <app-hc-line-chart [points]="teamPoints()" [capacity]="series() === 'all' ? teamSize() : null"
              [nowLabel]="currentQuarter()" [height]="320" />
          </section>

          <section class="tr-card">
            <div class="tr-card-head">
              <div>
                <h2 class="tr-card-title">Quarter by quarter</h2>
                <p class="tr-card-sub"><strong>Overload gap</strong> = HC above 1.0 summed over the people who are over-booked. It can be non-zero even when the team total is under capacity.</p>
              </div>
            </div>
            <div class="tbl-wrap">
              <table class="tbl">
                <thead>
                  <tr>
                    <th scope="col">Quarter</th><th scope="col">Type</th><th scope="col" class="num">Team load</th>
                    <th scope="col" class="num">Capacity</th><th scope="col" class="num">Team vs capacity</th>
                    <th scope="col" class="num">Overload gap</th><th scope="col" class="num">Spare</th><th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  @for (r of quarterRows(); track r.label) {
                    <tr [class.row-now]="r.label === currentQuarter()">
                      <th scope="row">{{ r.label }}@if (r.label === currentQuarter()) { <span class="now-tag">Today</span> }</th>
                      <td><span class="kind kind--{{ r.kind }}">{{ kindLabel(r.kind) }}</span></td>
                      <td class="num">{{ r.load | number:'1.1-1' }}</td>
                      <td class="num">{{ teamSize() | number:'1.0-1' }}</td>
                      <td class="num" [class.neg]="r.delta > 0.049" [class.pos]="r.delta < -0.049">{{ r.delta > 0 ? '+' : '' }}{{ r.delta | number:'1.1-1' }}</td>
                      <td class="num" [class.neg]="r.gap > 0">{{ r.gap > 0 ? '+' + (r.gap | number:'1.2-2') : '—' }}</td>
                      <td class="num">{{ r.spare | number:'1.1-1' }}</td>
                      <td>
                        @if (r.delta > 0.049) { <span class="chip chip--over">Over capacity</span> }
                        @else if (r.gap > 0) { <span class="chip chip--some">Some over-booked</span> }
                        @else if (r.load >= teamSize() * 0.9) { <span class="chip chip--full">Near full</span> }
                        @else { <span class="chip chip--ok">Has room</span> }
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </section>
        }

        <!-- ═════════ PROJECTS ═════════ -->
        @if (view() === 'projects') {
          <section class="tr-toolbar">
            <input class="tr-search" type="search" placeholder="Search projects…" aria-label="Search projects"
              [value]="search()" (input)="search.set($any($event.target).value)">
            <label class="tr-field tr-field--inline">
              <span>Sort by</span>
              <select class="tr-select" [value]="projSort()" (change)="projSort.set($any($event.target).value)">
                <option value="now">HC this quarter</option>
                <option value="peak">Peak HC</option>
                <option value="change">Biggest change</option>
                <option value="name">Name</option>
              </select>
            </label>
            <label class="tr-check">
              <input type="checkbox" [checked]="includeSs()" (change)="includeSs.set($any($event.target).checked)">
              Include steady-state tasks
            </label>
            <span class="tr-count">{{ projectRows().length }} {{ projectRows().length === 1 ? 'project' : 'projects' }}</span>
          </section>

          @if (projectRows().length === 0) {
            <div class="tr-state"><span>No projects with HC in this window.</span></div>
          } @else {
            <section class="proj-grid">
              @for (p of projectRows(); track p.name) {
                <article class="proj-card">
                  <header class="proj-head">
                    <div class="proj-name" [matTooltip]="p.name">{{ p.name }}</div>
                    @if (p.bu) { <span class="proj-bu">{{ p.bu }}</span> }
                    @if (p.isSs) { <span class="proj-bu proj-bu--ss">SS</span> }
                  </header>
                  <app-hc-line-chart [points]="p.points" [nowLabel]="currentQuarter()" [height]="92" [compact]="true" color="#1565c0" />
                  <footer class="proj-stats">
                    <div><span class="ps-l">Now</span><span class="ps-v">{{ p.now | number:'1.1-1' }}</span></div>
                    <div><span class="ps-l">Peak</span><span class="ps-v">{{ p.peak | number:'1.1-1' }} <em>{{ p.peakLabel }}</em></span></div>
                    <div><span class="ps-l">vs 4 qtrs ago</span>
                      <span class="ps-v" [class.neg]="p.change > 0.049" [class.pos]="p.change < -0.049">{{ p.change > 0 ? '+' : '' }}{{ p.change | number:'1.1-1' }}</span></div>
                  </footer>
                </article>
              }
            </section>
          }
        }

        <!-- ═════════ PEOPLE ═════════ -->
        @if (view() === 'people') {
          <section class="tr-toolbar">
            <div class="tr-seg tr-seg--sm" role="group" aria-label="Sort people">
              <button type="button" [class.on]="peopleSort() === 'name'" (click)="peopleSort.set('name')">Name</button>
              <button type="button" [class.on]="peopleSort() === 'over'" (click)="peopleSort.set('over')">Most over-booked</button>
            </div>
            <div class="heat-legend">
              <span><i class="hk hk-none"></i> No work</span>
              <span><i class="hk hk-low"></i> Spare capacity</span>
              <span><i class="hk hk-mid"></i> Mostly booked</span>
              <span><i class="hk hk-full"></i> Full (≈1.0)</span>
              <span><i class="hk hk-over"></i> Over 1.0</span>
            </div>
            <span class="tr-count">Click a row for the person's trend line</span>
          </section>

          <section class="tr-card tr-card--flush">
            <div class="heat-scroll">
              <table class="heat">
                <thead>
                  <tr>
                    <th scope="col" class="heat-name-h">Person</th>
                    @for (q of quarters(); track q) {
                      <th scope="col" class="heat-q" [class.heat-q--now]="q === currentQuarter()" [class.heat-q--future]="keyOf(q) > nowKey()">
                        {{ q }}
                        @if (q === currentQuarter()) { <span class="heat-today">Today</span> }
                        @else if (kindOf(q) === 'forecast') { <span class="heat-fc">Fcst</span> }
                      </th>
                    }
                  </tr>
                </thead>
                <tbody>
                  @for (row of peopleRows(); track row.person.person_id) {
                    <tr class="heat-row" [class.heat-row--open]="expandedPerson() === row.person.person_id"
                      tabindex="0" (click)="togglePerson(row.person.person_id)" (keydown.enter)="togglePerson(row.person.person_id)">
                      <th scope="row" class="heat-name">
                        <mat-icon class="heat-chev">{{ expandedPerson() === row.person.person_id ? 'expand_less' : 'expand_more' }}</mat-icon>
                        <div>
                          <div class="heat-person">{{ row.person.display_name }}</div>
                          <div class="heat-meta">{{ row.person.designation }} · {{ row.person.location }}</div>
                        </div>
                        @if (row.overCount > 0) { <span class="chip chip--over heat-chip">{{ row.overCount }} over</span> }
                      </th>
                      @for (v of row.values; track $index) {
                        <td class="heat-cell" [class.heat-cell--now]="quarters()[$index] === currentQuarter()"
                          [style.background]="heatBg(v)" [style.color]="heatFg(v)"
                          [attr.title]="row.person.display_name + ' · ' + quarters()[$index] + ': ' + (v | number:'1.2-2') + ' HC' + (v > 1.0001 ? ' (+' + ((v - 1) | number:'1.2-2') + ' over)' : '')">
                          {{ v > 0 ? (v | number:'1.1-1') : '' }}
                        </td>
                      }
                    </tr>
                    @if (expandedPerson() === row.person.person_id) {
                      <tr class="heat-detail">
                        <td [attr.colspan]="quarters().length + 1">
                          <div class="heat-detail-inner">
                            <div class="heat-detail-head">
                              <strong>{{ row.person.display_name }}</strong>
                              <span class="dir dir--{{ row.person.pattern }}">{{ patternLabel(row.person.pattern) }}</span>
                              @if (row.person.dominant_project) { <span class="tr-count">Mostly on <strong>{{ row.person.dominant_project }}</strong></span> }
                            </div>
                            <app-hc-line-chart [points]="row.points" [capacity]="1" [nowLabel]="currentQuarter()" [height]="170" />
                          </div>
                        </td>
                      </tr>
                    }
                  }
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="row" class="heat-name heat-foot">Team total</th>
                    @for (v of peopleTotals().load; track $index) { <td class="heat-foot-cell">{{ v | number:'1.1-1' }}</td> }
                  </tr>
                  <tr>
                    <th scope="row" class="heat-name heat-foot">Overload gap</th>
                    @for (v of peopleTotals().gap; track $index) {
                      <td class="heat-foot-cell" [class.neg]="v > 0">{{ v > 0 ? '+' + (v | number:'1.1-1') : '—' }}</td>
                    }
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>
        }
      }
    </div>
  `,
  styles: [`
    :host { display: block; }
    .tr-page { display: flex; flex-direction: column; gap: 16px; }

    /* Header */
    .tr-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
    .tr-head-left { display: flex; align-items: center; gap: 12px; }
    .tr-head-icon { color: #1565c0; font-size: 30px; width: 30px; height: 30px; }
    .tr-title { font-size: 22px; font-weight: 800; color: #1a1a2e; margin: 0; }
    .tr-sub { font-size: 12px; color: #78859a; margin: 2px 0 0; }
    .tr-controls { display: flex; align-items: flex-end; gap: 12px; flex-wrap: wrap; }
    .tr-field { display: flex; flex-direction: column; gap: 3px; font-size: 10px; font-weight: 700; color: #8a94a6; text-transform: uppercase; letter-spacing: 0.4px; }
    .tr-field--inline { flex-direction: row; align-items: center; gap: 8px; }
    .tr-select { height: 36px; border: 1px solid #d8dee8; border-radius: 8px; padding: 0 10px; font-size: 13px; font-family: inherit; background: #fff; outline: none; color: #1a1a2e; text-transform: none; letter-spacing: 0; font-weight: 500; }
    .tr-select:focus, .tr-search:focus { border-color: #1565c0; box-shadow: 0 0 0 3px rgba(21,101,192,0.12); }
    .tr-seg { display: inline-flex; border: 1px solid #d8dee8; border-radius: 9px; overflow: hidden; background: #fff; }
    .tr-seg button { display: inline-flex; align-items: center; gap: 5px; border: none; background: none; padding: 0 14px; height: 36px; font-size: 12px; font-weight: 600; color: #607d8b; cursor: pointer; font-family: inherit; }
    .tr-seg button mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .tr-seg button:hover:not(.on) { background: #f3f6fb; }
    .tr-seg button.on { background: #1565c0; color: #fff; }
    .tr-seg--sm button { height: 30px; padding: 0 12px; font-size: 11px; }

    /* States */
    .tr-state { display: flex; align-items: center; justify-content: center; gap: 12px; padding: 60px; color: #78859a; background: #fff; border: 1px solid #e6e9ef; border-radius: 12px; }
    .tr-state--err { color: #c62828; }

    /* Legend */
    .tr-legend { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 18px; background: #fff; border: 1px solid #e6e9ef; border-radius: 10px; padding: 9px 14px; font-size: 11px; color: #546e7a; }
    .tr-legend-title { font-weight: 800; color: #1a1a2e; text-transform: uppercase; letter-spacing: 0.4px; font-size: 10px; }
    .lg { display: inline-flex; align-items: center; gap: 7px; }
    .lg-line { display: inline-block; width: 24px; height: 0; border-top: 3px solid #1565c0; border-radius: 2px; }
    .lg-dash { border-top-style: dashed; }
    .lg-cap { display: inline-block; width: 24px; height: 0; border-top: 2px dashed #c62828; }
    .lg-shade { display: inline-block; width: 18px; height: 12px; background: #f3f6fb; border: 1px solid #dfe6f0; border-radius: 3px; }

    /* KPIs */
    .tr-kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 12px; }
    .kpi { background: #fff; border: 1px solid #e6e9ef; border-radius: 12px; padding: 14px 16px; }
    .kpi-label { font-size: 10px; font-weight: 700; color: #8a94a6; text-transform: uppercase; letter-spacing: 0.5px; }
    .kpi-value { font-size: 26px; font-weight: 800; color: #1a1a2e; margin-top: 4px; line-height: 1.1; }
    .kpi-value small { font-size: 12px; font-weight: 600; color: #8a94a6; }
    .kpi-value--over { color: #c62828; }
    .kpi-bar { height: 6px; background: #edf0f5; border-radius: 3px; overflow: hidden; margin: 8px 0 6px; }
    .kpi-bar-fill { height: 100%; background: #1565c0; border-radius: 3px; }
    .kpi-bar-fill--over { background: #c62828; }
    .kpi-sub { font-size: 11px; color: #78859a; margin-top: 4px; }
    .neg { color: #c62828; font-weight: 700; }
    .pos { color: #2e7d32; font-weight: 700; }

    /* Cards */
    .tr-card { background: #fff; border: 1px solid #e6e9ef; border-radius: 12px; padding: 16px 18px; }
    .tr-card--flush { padding: 0; overflow: hidden; }
    .tr-card-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 10px; }
    .tr-card-title { font-size: 15px; font-weight: 700; color: #1a1a2e; margin: 0; }
    .tr-card-sub { font-size: 12px; color: #78859a; margin: 3px 0 0; max-width: 760px; line-height: 1.4; }

    /* Direction */
    .dir { display: inline-block; font-size: 13px; font-weight: 700; padding: 3px 10px; border-radius: 12px; }
    .dir--ramp_up { background: #fff3e0; color: #e65100; }
    .dir--ramp_down { background: #e3f2fd; color: #1565c0; }
    .dir--stable { background: #e8f5e9; color: #2e7d32; }

    /* Table */
    .tbl-wrap { overflow-x: auto; }
    .tbl { width: 100%; border-collapse: collapse; font-size: 12px; }
    .tbl th, .tbl td { padding: 8px 10px; border-bottom: 1px solid #f0f2f6; text-align: left; white-space: nowrap; }
    .tbl thead th { font-size: 10px; font-weight: 700; color: #8a94a6; text-transform: uppercase; letter-spacing: 0.4px; background: #fafbfc; position: sticky; top: 0; }
    .tbl tbody th { font-weight: 700; color: #1a1a2e; }
    .tbl .num { text-align: right; font-variant-numeric: tabular-nums; }
    .row-now { background: #f3f8ff; }
    .now-tag { margin-left: 8px; font-size: 9px; font-weight: 700; background: #1565c0; color: #fff; padding: 1px 6px; border-radius: 8px; text-transform: uppercase; }
    .kind { font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 10px; }
    .kind--actual { background: #e8f5e9; color: #2e7d32; }
    .kind--planned { background: #e3f2fd; color: #1565c0; }
    .kind--forecast { background: #f3e5f5; color: #8e24aa; }
    .chip { font-size: 10px; font-weight: 700; padding: 2px 9px; border-radius: 10px; }
    .chip--over { background: #ffebee; color: #c62828; }
    .chip--some { background: #fff3e0; color: #e65100; }
    .chip--full { background: #fff8e1; color: #f57f17; }
    .chip--ok { background: #e8f5e9; color: #2e7d32; }

    /* Toolbar */
    .tr-toolbar { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
    .tr-search { height: 36px; min-width: 240px; border: 1px solid #d8dee8; border-radius: 8px; padding: 0 12px; font-size: 13px; font-family: inherit; outline: none; background: #fff; }
    .tr-check { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: #455a64; cursor: pointer; }
    .tr-count { font-size: 11px; color: #8a94a6; margin-left: auto; }

    /* Project cards */
    .proj-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 12px; }
    .proj-card { background: #fff; border: 1px solid #e6e9ef; border-radius: 12px; padding: 12px 14px 10px; display: flex; flex-direction: column; gap: 6px; }
    .proj-head { display: flex; align-items: center; gap: 8px; }
    .proj-name { font-size: 13px; font-weight: 700; color: #1a1a2e; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; min-width: 0; }
    .proj-bu { font-size: 10px; font-weight: 600; color: #607d8b; background: #eef2f7; padding: 2px 8px; border-radius: 8px; flex-shrink: 0; }
    .proj-bu--ss { background: #fff3e0; color: #e65100; }
    .proj-stats { display: flex; justify-content: space-between; gap: 8px; border-top: 1px solid #f0f2f6; padding-top: 8px; }
    .proj-stats > div { display: flex; flex-direction: column; gap: 1px; }
    .ps-l { font-size: 9px; font-weight: 700; color: #9aa5b5; text-transform: uppercase; letter-spacing: 0.4px; }
    .ps-v { font-size: 14px; font-weight: 800; color: #1a1a2e; font-variant-numeric: tabular-nums; }
    .ps-v em { font-style: normal; font-size: 10px; font-weight: 600; color: #8a94a6; }

    /* Heatmap */
    .heat-scroll { overflow: auto; max-height: calc(100vh - 300px); }
    .heat { border-collapse: separate; border-spacing: 0; font-size: 12px; min-width: 100%; }
    .heat th, .heat td { padding: 0; }
    .heat-name-h, .heat-name { position: sticky; left: 0; z-index: 2; background: #fff; min-width: 250px; max-width: 250px; text-align: left; border-right: 1px solid #e6e9ef; }
    .heat-name-h { z-index: 4; padding: 10px 14px; font-size: 10px; font-weight: 700; color: #8a94a6; text-transform: uppercase; letter-spacing: 0.4px; background: #fafbfc; border-bottom: 1px solid #e6e9ef; top: 0; }
    .heat-q { position: sticky; top: 0; z-index: 3; min-width: 62px; padding: 8px 4px; font-size: 10px; font-weight: 700; color: #607d8b; background: #fafbfc; border-bottom: 1px solid #e6e9ef; text-align: center; white-space: nowrap; }
    .heat-q--future { background: #f3f6fb; }
    .heat-q--now { color: #1565c0; background: #e3f2fd; box-shadow: inset 0 -2px 0 #1565c0; }
    .heat-today, .heat-fc { display: block; font-size: 8px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.4px; margin-top: 1px; }
    .heat-today { color: #1565c0; }
    .heat-fc { color: #8e24aa; }
    .heat-row { cursor: pointer; }
    .heat-row:hover .heat-name { background: #f6f9fe; }
    .heat-row:focus-visible { outline: 2px solid #1565c0; outline-offset: -2px; }
    .heat-row--open .heat-name { background: #eef4fd; }
    .heat-name { padding: 8px 12px; display: table-cell; border-bottom: 1px solid #f0f2f6; }
    .heat-name > * { vertical-align: middle; }
    .heat-name { white-space: nowrap; }
    .heat-chev { font-size: 18px; width: 18px; height: 18px; color: #90a4ae; vertical-align: middle; margin-right: 4px; }
    .heat-name > div { display: inline-block; vertical-align: middle; max-width: 150px; }
    .heat-person { font-weight: 700; color: #1a1a2e; font-size: 12px; overflow: hidden; text-overflow: ellipsis; }
    .heat-meta { font-size: 10px; color: #8a94a6; overflow: hidden; text-overflow: ellipsis; }
    .heat-chip { margin-left: 6px; vertical-align: middle; }
    .heat-cell { text-align: center; height: 40px; min-width: 62px; font-size: 12px; font-weight: 700; border-bottom: 1px solid #fff; border-right: 1px solid #fff; font-variant-numeric: tabular-nums; }
    .heat-cell--now { box-shadow: inset 2px 0 0 #1565c0, inset -2px 0 0 #1565c0; }
    .heat-detail td { background: #fafcff; border-bottom: 1px solid #e6e9ef; padding: 0; }
    .heat-detail-inner { position: sticky; left: 0; width: min(900px, 100vw - 340px); padding: 12px 16px 8px; }
    .heat-detail-head { display: flex; align-items: center; gap: 12px; margin-bottom: 4px; font-size: 13px; }
    .heat tfoot th, .heat tfoot td { position: sticky; bottom: 0; background: #f6f8fb; border-top: 1px solid #e6e9ef; z-index: 2; }
    .heat-foot { font-size: 11px; font-weight: 700; color: #455a64; padding: 8px 14px; z-index: 4 !important; }
    .heat-foot-cell { text-align: center; font-size: 11px; font-weight: 700; color: #37474f; padding: 8px 4px; font-variant-numeric: tabular-nums; }
    .heat-legend, .heat-legend span { font-size: 11px; color: #607d8b; }
    .heat-legend { display: flex; gap: 14px; flex-wrap: wrap; }
    .heat-legend span { display: inline-flex; align-items: center; gap: 5px; }
    .hk { width: 14px; height: 14px; border-radius: 3px; display: inline-block; border: 1px solid rgba(0,0,0,0.06); }
    .hk-none { background: #fafafa; } .hk-low { background: #e3f2fd; } .hk-mid { background: #90caf9; } .hk-full { background: #1e88e5; } .hk-over { background: #e53935; }
  `]
})
export class TrendsComponent implements OnInit {
  private api = inject(ApiService);
  private auth = inject(AuthService);

  readonly Math = Math;
  readonly keyOf = keyOf;

  loading = signal(false);
  error = signal(false);
  data = signal<any | null>(null);

  view = signal<TrendView>('team');
  series = signal<TeamSeries>('all');
  manager = signal('');
  managerList = signal<string[]>([]);
  horizon = signal(20);
  search = signal('');
  projSort = signal<'now' | 'peak' | 'change' | 'name'>('now');
  includeSs = signal(false);
  peopleSort = signal<'name' | 'over'>('name');
  expandedPerson = signal<number | null>(null);

  // ── Derived ────────────────────────────────────────────────────────────────
  currentQuarter = computed(() => this.data()?.current_quarter ?? '');
  nowKey = computed(() => keyOf(this.currentQuarter()));
  teamSize = computed(() => Number(this.data()?.team_size) || 0);
  private actualSet = computed(() => new Set<string>(this.data()?.actual_quarters ?? []));

  /** Contiguous window: 4 quarters back → horizon quarters ahead of today. */
  quarters = computed<string[]>(() => {
    if (!this.data()) return [];
    const now = this.nowKey();
    const out: string[] = [];
    for (let k = now - 4; k <= now + this.horizon(); k++) out.push(labelOf(k));
    return out;
  });

  kindOf(q: string): HcPointKind {
    if (!this.actualSet().has(q)) return 'forecast';
    return keyOf(q) <= this.nowKey() ? 'actual' : 'planned';
  }

  kindLabel(k: HcPointKind): string { return k === 'actual' ? 'Actual' : k === 'planned' ? 'Planned' : 'Forecast'; }
  patternLabel(p: string): string { return p === 'ramp_up' ? '↑ Increasing' : p === 'ramp_down' ? '↓ Decreasing' : '→ Stable'; }

  private isData(q: string) { return this.actualSet().has(q); }
  private personValue(p: any, q: string): number { return Number((this.isData(q) ? p.total_actual?.[q] : p.total_forecast?.[q]) || 0); }
  private projValue(p: any, q: string): number { return Number((this.isData(q) ? p.actual?.[q] : p.forecast?.[q]) || 0); }

  private teamValue(q: string, s: TeamSeries): number {
    const t = this.data()?.team;
    if (!t) return 0;
    const total = Number((this.isData(q) ? t.actual?.[q] : t.forecast?.[q]) || 0);
    const ss = Number((this.isData(q) ? t.actual_ss?.[q] : t.forecast_ss?.[q]) || 0);
    return s === 'all' ? total : s === 'ss' ? ss : Math.max(0, total - ss);
  }

  // ── Team view ──────────────────────────────────────────────────────────────
  teamPoints = computed<HcPoint[]>(() =>
    this.quarters().map(q => ({ label: q, value: r2(this.teamValue(q, this.series())), kind: this.kindOf(q) })));

  quarterRows = computed(() => {
    const d = this.data();
    if (!d) return [];
    const cap = this.teamSize();
    const now = this.nowKey();
    return this.quarters().filter(q => keyOf(q) >= now).slice(0, 13).map(q => {
      let gap = 0, spare = 0;
      for (const p of d.people) {
        const v = this.personValue(p, q);
        if (v > 1.0001) gap += v - 1; else spare += 1 - v;
      }
      const load = this.teamValue(q, 'all');
      return { label: q, kind: this.kindOf(q), load, delta: load - cap, gap: r2(gap), spare: r2(spare) };
    });
  });

  teamKpi = computed(() => {
    const cap = this.teamSize();
    const now = this.nowKey();
    const pts = this.quarters().filter(q => keyOf(q) >= now).map(q => ({ q, v: this.teamValue(q, 'all') }));
    const cur = pts[0]?.v ?? 0;
    const peak = pts.reduce((m, p) => (p.v > m.v ? p : m), pts[0] ?? { q: '', v: 0 });
    const over = pts.filter(p => cap > 0 && p.v > cap + 0.0001);
    const prev = this.teamValue(labelOf(now - 4), 'all');
    const diff = cur - prev;
    const deltaText = prev > 0
      ? `${diff >= 0 ? '+' : ''}${r1(diff)} HC vs 4 quarters ago`
      : 'No data 4 quarters ago';
    return {
      now: cur, pct: cap > 0 ? Math.round((cur / cap) * 100) : 0,
      peak: peak.v, peakLabel: peak.q, peakOver: cap > 0 ? Math.max(0, r1(peak.v - cap)) : 0,
      overCount: over.length, horizonCount: pts.length, firstOver: over[0]?.q ?? null,
      deltaText
    };
  });

  // ── Project view ───────────────────────────────────────────────────────────
  projectRows = computed(() => {
    const d = this.data();
    if (!d) return [];
    const qs = this.quarters();
    const now = this.nowKey();
    const needle = this.search().trim().toLowerCase();
    const rows = (d.projects as any[])
      .filter(p => (this.includeSs() || !p.is_ss) && (!needle || String(p.project_name).toLowerCase().includes(needle)))
      .map(p => {
        const points: HcPoint[] = qs.map(q => ({ label: q, value: r2(this.projValue(p, q)), kind: this.kindOf(q) }));
        const future = points.filter(pt => keyOf(pt.label) >= now);
        const peak = future.reduce((m, pt) => (pt.value > m.value ? pt : m), future[0] ?? { label: '', value: 0, kind: 'actual' as HcPointKind });
        const cur = points.find(pt => pt.label === this.currentQuarter())?.value ?? 0;
        const prev = this.projValue(p, labelOf(now - 4));
        return { name: p.project_name as string, bu: p.BU as string, isSs: !!p.is_ss, points, now: cur, peak: peak.value, peakLabel: peak.label, change: cur - prev };
      })
      .filter(r => r.points.some(pt => pt.value > 0));
    const s = this.projSort();
    rows.sort((a, b) =>
      s === 'name' ? a.name.localeCompare(b.name)
      : s === 'peak' ? b.peak - a.peak
      : s === 'change' ? Math.abs(b.change) - Math.abs(a.change)
      : b.now - a.now || b.peak - a.peak);
    return rows;
  });

  // ── People view ────────────────────────────────────────────────────────────
  peopleRows = computed(() => {
    const d = this.data();
    if (!d) return [];
    const qs = this.quarters();
    const rows = (d.people as any[]).map(p => {
      const values = qs.map(q => r2(this.personValue(p, q)));
      const points: HcPoint[] = qs.map((q, i) => ({ label: q, value: values[i], kind: this.kindOf(q) }));
      return { person: p, values, points, overCount: values.filter(v => v > 1.0001).length };
    });
    rows.sort((a, b) => this.peopleSort() === 'over'
      ? b.overCount - a.overCount || a.person.display_name.localeCompare(b.person.display_name)
      : a.person.display_name.localeCompare(b.person.display_name));
    return rows;
  });

  peopleTotals = computed(() => {
    const rows = this.peopleRows();
    const n = this.quarters().length;
    const load = Array.from({ length: n }, (_, i) => r1(rows.reduce((s, r) => s + r.values[i], 0)));
    const gap = Array.from({ length: n }, (_, i) => r1(rows.reduce((s, r) => s + Math.max(0, r.values[i] - 1), 0)));
    return { load, gap };
  });

  heatBg(v: number): string {
    if (v <= 0) return '#fafafa';
    if (v > 1.0001) return '#e53935';
    if (v >= 0.9) return '#1e88e5';
    if (v >= 0.5) return '#90caf9';
    return '#e3f2fd';
  }
  heatFg(v: number): string { return v > 1.0001 || (v >= 0.9) ? '#ffffff' : '#1a1a2e'; }

  togglePerson(id: number) { this.expandedPerson.update(cur => (cur === id ? null : id)); }

  // ── Loading ────────────────────────────────────────────────────────────────
  ngOnInit() {
    this.api.getAllocationTeam('').subscribe({
      next: (res: any) => {
        const people = res.data || [];
        this.managerList.set([...new Set<string>(people.map((p: any) => p.reporting_manager).filter(Boolean))].sort());
        // Non-elevated users start on their own manager's team
        const email = this.auth.user()?.email;
        if (!this.auth.isElevated() && email) {
          const me = people.find((p: any) => p.email === email);
          if (me?.reporting_manager) this.manager.set(me.reporting_manager);
        }
        this.load();
      },
      error: () => this.load()
    });
  }

  onManager(m: string) { this.manager.set(m); this.load(); }

  load() {
    this.loading.set(true);
    this.error.set(false);
    this.expandedPerson.set(null);
    this.api.getForecast(this.manager() || undefined).subscribe({
      next: (res: any) => { this.data.set(res.data || null); this.loading.set(false); },
      error: () => { this.error.set(true); this.loading.set(false); }
    });
  }
}
