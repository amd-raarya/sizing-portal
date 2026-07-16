import { Component, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { FormsModule } from '@angular/forms';
import { MatTooltipModule } from '@angular/material/tooltip';

interface Milestone { name: string; color: string; quarters: string[]; }
interface FunctionRow { name: string; location: string; hcType: string; hc: Record<string, number>; }
interface GanttProject {
  id: number; name: string; code: string; bu: string; color: string;
  expanded: boolean;
  milestones: Milestone[];
  functions: FunctionRow[];
}

@Component({
  selector: 'app-gantt',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, MatIconModule, MatButtonModule, MatSelectModule, MatFormFieldModule, FormsModule, MatTooltipModule],
  template: `
    <div class="gantt-page">
      <div class="mockup-banner">
        <mat-icon style="color:#f9a825;font-size:18px;width:18px;height:18px;flex-shrink:0">info</mat-icon>
        <span><strong>Preview Mode</strong> — This view shows sample data for demonstration. Live data wiring coming soon.</span>
      </div>
      <div class="page-header">
        <div class="header-left">
          <mat-icon class="page-icon">show_chart</mat-icon>
          <div>
            <h2>Project HC Mountain View</h2>
            <p class="subtitle">Headcount ramp across quarters · Milestones marked · Click project to toggle function detail</p>
          </div>
        </div>
        <div class="header-actions">
          <mat-form-field appearance="outline" class="filter-field">
            <mat-label>BU</mat-label>
            <mat-select [(ngModel)]="filterBU">
              <mat-option value="">All BUs</mat-option>
              <mat-option value="Embedded">Embedded</mat-option>
            </mat-select>
          </mat-form-field>
          <mat-form-field appearance="outline" class="filter-field">
            <mat-label>View</mat-label>
            <mat-select [(ngModel)]="viewMode">
              <mat-option value="combined">All Projects Combined</mat-option>
              <mat-option value="individual">Individual Projects</mat-option>
            </mat-select>
          </mat-form-field>
        </div>
      </div>

      <!-- Milestone legend -->
      <div class="ms-legend">
        <span class="ms-legend-label">Milestones:</span>
        @for (ms of allMilestones; track ms.name) {
          <span class="ms-legend-item">
            <span class="ms-dot" [style.background]="ms.color"></span> {{ ms.name }}
          </span>
        }
        <span class="ms-legend-sep">|</span>
        <span class="ms-legend-label">Projects:</span>
        @for (proj of filteredProjects; track proj.id) {
          <span class="ms-legend-item">
            <span class="ms-dot" [style.background]="proj.color"></span> {{ proj.name }}
          </span>
        }
      </div>

      <!-- ── COMBINED view: additive stacked mountain + AMD baseline ── -->
      @if (viewMode === 'combined') {
        <div class="chart-card">
          <div class="chart-card-header">
            <span class="chart-card-title">Combined HC Demand vs AMD Baseline — All Projects Additive</span>
            <div class="baseline-control">
              <span class="baseline-label">AMD Baseline HC:</span>
              <input class="baseline-input" type="number" [(ngModel)]="baselineHC" min="0" step="5"/>
            </div>
          </div>
          <!-- Legend -->
          <div class="combined-legend">
            @for (proj of filteredProjects; track proj.id) {
              <span class="leg-item">
                <span class="leg-swatch" [style.background]="proj.color"></span> {{ proj.name }}
              </span>
            }
            <span class="leg-sep">|</span>
            <span class="leg-item"><span class="leg-line"></span> AMD Baseline ({{ baselineHC }} HC)</span>
            <span class="leg-item"><span class="leg-swatch" style="background:#ED1C24;opacity:0.5"></span> Gap (over baseline)</span>
          </div>
          <div class="chart-wrap">
            <svg [attr.viewBox]="'0 0 ' + svgW + ' ' + svgH" class="mountain-svg" preserveAspectRatio="none">
              <!-- Y gridlines -->
              @for (tick of yTicks(chartMax); track tick) {
                <line [attr.x1]="padL" [attr.x2]="svgW - padR"
                      [attr.y1]="yPos(tick, chartMax)" [attr.y2]="yPos(tick, chartMax)"
                      stroke="#f0f0f0" stroke-width="1"/>
                <text [attr.x]="padL - 6" [attr.y]="yPos(tick, chartMax) + 4"
                      text-anchor="end" font-size="10" fill="#999">{{ tick }}</text>
              }
              <!-- X axis -->
              <line [attr.x1]="padL" [attr.x2]="svgW - padR"
                    [attr.y1]="svgH - padB" [attr.y2]="svgH - padB"
                    stroke="#ddd" stroke-width="1.5"/>

              <!-- Stacked area per project — each sits on top of the previous -->
              @for (proj of stackedLayers; track proj.id) {
                <path [attr.d]="proj.areaD" [attr.fill]="proj.color" fill-opacity="0.75"/>
                <path [attr.d]="proj.topLineD" [attr.stroke]="proj.color" fill="none"
                      stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>
              }

              <!-- Gap area (where total exceeds baseline — red overlay) -->
              <path [attr.d]="gapAreaPath()" fill="#ED1C24" fill-opacity="0.3"/>

              <!-- Total value label + dot at the top of the stack -->
              @for (q of quarters; track q; let qi = $index) {
                @if (getStackedTotal(q) > 0) {
                  <circle [attr.cx]="xPos(qi)" [attr.cy]="yPos(getStackedTotal(q), chartMax)"
                          r="4" [attr.fill]="getStackedTotal(q) > baselineHC ? '#ED1C24' : '#333'"
                          [matTooltip]="q + ' — Total: ' + getStackedTotal(q) + ' HC | Baseline: ' + baselineHC + ' HC'"/>
                  <text [attr.x]="xPos(qi)" [attr.y]="yPos(getStackedTotal(q), chartMax) - 8"
                        text-anchor="middle" font-size="10" font-weight="700"
                        [attr.fill]="getStackedTotal(q) > baselineHC ? '#ED1C24' : '#333'">
                    {{ getStackedTotal(q) }}
                  </text>
                }
              }

              <!-- AMD Baseline dashed line -->
              <line [attr.x1]="padL" [attr.x2]="svgW - padR"
                    [attr.y1]="yPos(baselineHC, chartMax)" [attr.y2]="yPos(baselineHC, chartMax)"
                    stroke="#ED1C24" stroke-width="2" stroke-dasharray="8,5"/>
              <text [attr.x]="svgW - padR + 4" [attr.y]="yPos(baselineHC, chartMax) + 4"
                    font-size="10" font-weight="700" fill="#ED1C24">{{ baselineHC }}</text>

              <!-- Quarter labels on X axis -->
              @for (q of quarters; track q; let qi = $index) {
                <text [attr.x]="xPos(qi)" [attr.y]="svgH - padB + 16"
                      text-anchor="middle" font-size="10" fill="#666">{{ q }}</text>
              }
            </svg>
          </div>
        </div>
      }

      <!-- ── INDIVIDUAL view: one mountain chart per project ── -->
      @if (viewMode === 'individual') {
        <div class="proj-grid">
          @for (proj of filteredProjects; track proj.id) {
            <div class="proj-card">
              <div class="proj-card-header" (click)="toggleProject(proj)">
                <div class="proj-card-title">
                  <span class="proj-dot-lg" [style.background]="proj.color"></span>
                  <span class="proj-name-lg">{{ proj.name }}</span>
                  <span class="proj-code-sm">{{ proj.code }}</span>
                </div>
                <div class="proj-card-meta">
                  <span class="meta-chip">Peak {{ getProjPeak(proj) }} HC</span>
                  <span class="meta-chip">{{ proj.milestones.length }} milestones</span>
                  <mat-icon class="expand-chevron">{{ proj.expanded ? 'expand_less' : 'expand_more' }}</mat-icon>
                </div>
              </div>

              <!-- Mountain chart for this project -->
              <div class="chart-wrap chart-wrap-sm">
                <svg [attr.viewBox]="'0 0 ' + svgW + ' ' + svgHsm" class="mountain-svg" preserveAspectRatio="none">
                  @for (tick of yTicks(getProjPeak(proj)); track tick) {
                    <line [attr.x1]="padL" [attr.x2]="svgW - padR"
                          [attr.y1]="yPosSm(tick, getProjPeak(proj))" [attr.y2]="yPosSm(tick, getProjPeak(proj))"
                          stroke="#f0f0f0" stroke-width="1"/>
                    <text [attr.x]="padL - 6" [attr.y]="yPosSm(tick, getProjPeak(proj)) + 4"
                          text-anchor="end" font-size="10" fill="#999">{{ tick }}</text>
                  }
                  <line [attr.x1]="padL" [attr.x2]="svgW - padR"
                        [attr.y1]="svgHsm - padB" [attr.y2]="svgHsm - padB"
                        stroke="#ddd" stroke-width="1.5"/>
                  <!-- Milestone vertical bands -->
                  @for (ms of proj.milestones; track ms.name) {
                    @for (mq of ms.quarters; track mq) {
                      @if (quarters.indexOf(mq) >= 0) {
                        <rect [attr.x]="xPos(quarters.indexOf(mq)) - colW / 2"
                              [attr.y]="padT"
                              [attr.width]="colW"
                              [attr.height]="svgHsm - padT - padB"
                              [attr.fill]="ms.color" fill-opacity="0.07"/>
                        <text [attr.x]="xPos(quarters.indexOf(mq))"
                              [attr.y]="padT + 10"
                              text-anchor="middle" font-size="9" [attr.fill]="ms.color" font-weight="600">{{ ms.name }}</text>
                      }
                    }
                  }
                  <!-- Area fill -->
                  <path [attr.d]="areaPathSm(proj)" [attr.fill]="proj.color" fill-opacity="0.15"/>
                  <!-- Line -->
                  <path [attr.d]="linePathSm(proj)" [attr.stroke]="proj.color" fill="none" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
                  <!-- Dots with HC labels -->
                  @for (q of quarters; track q; let qi = $index) {
                    @if (getProjectTotal(proj, q) > 0) {
                      <circle [attr.cx]="xPos(qi)" [attr.cy]="yPosSm(getProjectTotal(proj, q), getProjPeak(proj))"
                              r="5" [attr.fill]="proj.color"
                              [matTooltip]="q + ': ' + getProjectTotal(proj, q) + ' HC'"/>
                      <text [attr.x]="xPos(qi)"
                            [attr.y]="yPosSm(getProjectTotal(proj, q), getProjPeak(proj)) - 9"
                            text-anchor="middle" font-size="10" font-weight="600" [attr.fill]="proj.color">{{ getProjectTotal(proj, q) }}</text>
                    }
                  }
                  <!-- X labels -->
                  @for (q of quarters; track q; let qi = $index) {
                    <text [attr.x]="xPos(qi)" [attr.y]="svgHsm - padB + 16"
                          text-anchor="middle" font-size="10" fill="#666">{{ q }}</text>
                  }
                </svg>
              </div>

              <!-- Expanded function breakdown table -->
              @if (proj.expanded) {
                <div class="fn-table-wrap">
                  <table class="fn-table">
                    <thead>
                      <tr>
                        <th>Function</th>
                        <th>Location</th>
                        <th>Type</th>
                        @for (q of quarters; track q) {
                          <th>{{ q }}</th>
                        }
                        <th>Peak</th>
                      </tr>
                    </thead>
                    <tbody>
                      @for (fn of proj.functions; track fn.name) {
                        <tr>
                          <td class="fn-name-cell">{{ fn.name }}</td>
                          <td class="fn-loc-cell">{{ fn.location }}</td>
                          <td class="fn-type-cell">{{ fn.hcType }}</td>
                          @for (q of quarters; track q) {
                            <td class="fn-hc-cell">
                              @if (fn.hc[q] > 0) {
                                <span class="fn-hc-pill" [style.background]="proj.color + '22'" [style.color]="proj.color">{{ fn.hc[q] }}</span>
                              } @else {
                                <span class="fn-hc-dash">—</span>
                              }
                            </td>
                          }
                          <td class="fn-peak-cell" [style.color]="proj.color">{{ getFnPeak(fn) }}</td>
                        </tr>
                      }
                    </tbody>
                  </table>
                </div>
              }
            </div>
          }
        </div>
      }
    </div>
  `,
  styles: [`
    .mockup-banner { display: flex; align-items: center; gap: 10px; background: #fff8e1; border: 1px solid #ffe082; border-left: 4px solid #f9a825; border-radius: 6px; padding: 10px 16px; font-size: 13px; color: #5d4037; margin-bottom: 12px; }
    .gantt-page { padding: 0; }
    .page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
    .header-left { display: flex; align-items: center; gap: 14px; }
    .page-icon { font-size: 32px; width: 32px; height: 32px; color: #ED1C24; }
    .page-header h2 { margin: 0; font-size: 22px; font-weight: 500; }
    .subtitle { margin: 2px 0 0; color: #666; font-size: 13px; }
    .header-actions { display: flex; align-items: center; gap: 10px; }
    .filter-field { width: 180px; }
    .filter-field ::ng-deep .mat-mdc-form-field-subscript-wrapper { display: none; }

    /* Legend */
    .ms-legend { display: flex; flex-wrap: wrap; gap: 14px; padding: 8px 16px; background: white; border: 1px solid #e8e8e8; border-radius: 8px; margin-bottom: 16px; align-items: center; font-size: 12px; }
    .ms-legend-label { font-weight: 600; color: #555; }
    .ms-legend-sep { color: #ccc; }
    .ms-legend-item { display: flex; align-items: center; gap: 5px; color: #555; }
    .ms-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }

    /* Combined chart card */
    .chart-card { background: white; border: 1px solid #e8e8e8; border-radius: 10px; padding: 16px 20px; margin-bottom: 20px; }
    .chart-card-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
    .chart-card-title { font-size: 14px; font-weight: 600; color: #1a1a2e; }
    .baseline-control { display: flex; align-items: center; gap: 8px; font-size: 12px; color: #555; }
    .baseline-label { font-weight: 500; }
    .baseline-input { width: 72px; border: 1.5px solid #ddd; border-radius: 6px; padding: 4px 8px; font-size: 13px; font-weight: 700; color: #ED1C24; text-align: center; outline: none; font-family: inherit; }
    .baseline-input:focus { border-color: #ED1C24; }
    .combined-legend { display: flex; gap: 20px; align-items: center; margin-bottom: 12px; flex-wrap: wrap; }
    .leg-item { display: flex; align-items: center; gap: 6px; font-size: 12px; color: #555; }
    .leg-swatch { display: inline-block; width: 14px; height: 14px; border-radius: 3px; }
    .leg-line { display: inline-block; width: 24px; border-top: 2px dashed #ED1C24; }
    .leg-sep { color: #ddd; margin: 0 4px; }

    /* SVG chart */
    .chart-wrap { width: 100%; overflow-x: auto; }
    .chart-wrap-sm { margin-top: 4px; }
    .mountain-svg { width: 100%; display: block; }

    /* Individual project cards */
    .proj-grid { display: flex; flex-direction: column; gap: 16px; }
    .proj-card { background: white; border: 1px solid #e8e8e8; border-radius: 10px; overflow: hidden; }
    .proj-card-header { display: flex; justify-content: space-between; align-items: center; padding: 14px 18px; cursor: pointer; border-bottom: 1px solid #f0f0f0; }
    .proj-card-header:hover { background: #fafafa; }
    .proj-card-title { display: flex; align-items: center; gap: 10px; }
    .proj-dot-lg { width: 12px; height: 12px; border-radius: 50%; flex-shrink: 0; }
    .proj-name-lg { font-size: 15px; font-weight: 600; color: #1a1a2e; }
    .proj-code-sm { font-size: 11px; color: #aaa; background: #f5f5f5; padding: 1px 8px; border-radius: 8px; }
    .proj-card-meta { display: flex; align-items: center; gap: 8px; }
    .meta-chip { font-size: 11px; background: #f5f5f5; color: #666; padding: 2px 10px; border-radius: 10px; }
    .expand-chevron { font-size: 20px; width: 20px; height: 20px; color: #aaa; }

    /* Function breakdown table */
    .fn-table-wrap { overflow-x: auto; border-top: 1px solid #f0f0f0; }
    .fn-table { width: 100%; border-collapse: collapse; font-size: 12px; }
    .fn-table thead tr { background: #f8f9fa; }
    .fn-table th { padding: 7px 10px; text-align: center; font-weight: 600; color: #555; font-size: 11px; white-space: nowrap; border-bottom: 1px solid #e8e8e8; }
    .fn-table th:first-child, .fn-table th:nth-child(2), .fn-table th:nth-child(3) { text-align: left; }
    .fn-table td { padding: 6px 10px; border-bottom: 1px solid #f5f5f5; text-align: center; vertical-align: middle; }
    .fn-name-cell { text-align: left; font-weight: 500; color: #333; min-width: 180px; white-space: nowrap; }
    .fn-loc-cell { text-align: left; color: #777; white-space: nowrap; }
    .fn-type-cell { text-align: left; color: #999; font-style: italic; white-space: nowrap; }
    .fn-hc-cell { min-width: 60px; }
    .fn-hc-pill { display: inline-block; padding: 1px 8px; border-radius: 8px; font-weight: 600; font-size: 11px; }
    .fn-hc-dash { color: #ddd; }
    .fn-peak-cell { font-weight: 700; }
  `]
})
export class GanttComponent {
  filterBU = '';
  viewMode: 'combined' | 'individual' = 'combined';

  // SVG layout constants
  readonly svgW = 900;
  readonly svgH = 320;
  readonly svgHsm = 220;
  readonly padL = 36;
  readonly padR = 20;
  readonly padT = 24;
  readonly padB = 28;

  quarters = [
    'Q2 FY26','Q3 FY26','Q4 FY26',
    'Q1 FY27','Q2 FY27','Q3 FY27','Q4 FY27',
    'Q1 FY28','Q2 FY28'
  ];

  get colW(): number {
    return (this.svgW - this.padL - this.padR) / (this.quarters.length - 1);
  }

  allMilestones: { name: string; color: string }[] = [
    { name: 'Concept',       color: '#9c27b0' },
    { name: 'Feasibility',   color: '#3f51b5' },
    { name: 'BTO',           color: '#03a9f4' },
    { name: 'Bring Up Exit', color: '#4caf50' },
    { name: 'AFEr',          color: '#8bc34a' },
    { name: 'AFOr',          color: '#ff9800' },
    { name: 'GA',            color: '#ED1C24' },
  ];

  projects: GanttProject[] = [
    {
      id: 1, name: 'Android EAP v1.3', code: 'spg00.099', bu: 'Embedded',
      color: '#1565c0', expanded: false,
      milestones: [
        { name: 'Concept',       color: '#9c27b0', quarters: ['Q2 FY26'] },
        { name: 'BTO',           color: '#03a9f4', quarters: ['Q4 FY26'] },
        { name: 'Bring Up Exit', color: '#4caf50', quarters: ['Q2 FY27'] },
        { name: 'GA',            color: '#ED1C24', quarters: ['Q1 FY28'] },
      ],
      functions: [
        { name: 'UMR-(TimW/Pierre-Eric)', location: 'Canada',          hcType: 'Existing - FTE',     hc: { 'Q2 FY26': 0.5, 'Q3 FY26': 1, 'Q4 FY26': 2, 'Q1 FY27': 3 } },
        { name: 'Linux BPI-(TimW/Slava)', location: 'Canada',          hcType: 'Existing - FTE',     hc: { 'Q2 FY26': 0.5, 'Q3 FY26': 1.5, 'Q4 FY26': 3, 'Q1 FY27': 5 } },
        { name: 'Perfetto-(RayH/Julian)', location: 'Canada',          hcType: 'Incremental - CONT', hc: { 'Q3 FY26': 1, 'Q4 FY26': 2, 'Q1 FY27': 4, 'Q2 FY27': 4 } },
        { name: 'Program/Architecture',   location: 'India Hyderabad', hcType: 'Incremental - CONT', hc: { 'Q4 FY26': 1, 'Q1 FY27': 3, 'Q2 FY27': 5, 'Q3 FY27': 4 } },
        { name: 'Linux- Compositor',      location: 'India Hyderabad', hcType: 'Existing - FTE',     hc: { 'Q1 FY27': 2, 'Q2 FY27': 4, 'Q3 FY27': 5, 'Q4 FY27': 3 } },
        { name: 'System logging tool',    location: 'Canada',          hcType: 'Existing - FTE',     hc: { 'Q2 FY26': 0.5, 'Q3 FY26': 0.5, 'Q4 FY26': 1, 'Q1 FY27': 2 } },
        { name: 'ROCm on APU',            location: 'India Bangalore', hcType: 'Incremental - CONT', hc: { 'Q2 FY27': 1, 'Q3 FY27': 2, 'Q4 FY27': 3 } },
      ]
    },
    {
      id: 2, name: 'ECARX SW Tools CCB', code: 'spg07.030', bu: 'Embedded',
      color: '#2e7d32', expanded: false,
      milestones: [
        { name: 'Feasibility', color: '#3f51b5', quarters: ['Q2 FY26'] },
        { name: 'BTO',         color: '#03a9f4', quarters: ['Q4 FY26'] },
        { name: 'AFEr',        color: '#8bc34a', quarters: ['Q2 FY27'] },
      ],
      functions: [
        { name: 'UMR-(RayH/Jiqian)',   location: 'Canada',          hcType: 'Existing - FTE',     hc: { 'Q2 FY26': 0.5, 'Q3 FY26': 1, 'Q4 FY26': 2 } },
        { name: 'System logging tool', location: 'Canada',          hcType: 'Existing - FTE',     hc: { 'Q3 FY26': 1, 'Q4 FY26': 3, 'Q1 FY27': 3 } },
        { name: 'Linux BPI',           location: 'India Bangalore', hcType: 'Incremental - CONT', hc: { 'Q4 FY26': 2, 'Q1 FY27': 2, 'Q2 FY27': 2 } },
        { name: 'Perfetto',            location: 'Canada',          hcType: 'Existing - FTE',     hc: { 'Q2 FY26': 0.5, 'Q3 FY26': 1, 'Q4 FY26': 1 } },
        { name: 'Linux- Compositor',   location: 'India Hyderabad', hcType: 'Incremental - CONT', hc: { 'Q3 FY26': 1, 'Q4 FY26': 1, 'Q2 FY27': 1 } },
      ]
    },
    {
      id: 3, name: 'Eris v2.0', code: 'spg00.098', bu: 'Embedded',
      color: '#e65100', expanded: false,
      milestones: [
        { name: 'BTO',           color: '#03a9f4', quarters: ['Q4 FY26'] },
        { name: 'Bring Up Exit', color: '#4caf50', quarters: ['Q2 FY27'] },
        { name: 'AFOr',          color: '#ff9800', quarters: ['Q3 FY27'] },
        { name: 'GA',            color: '#ED1C24', quarters: ['Q1 FY28'] },
      ],
      functions: [
        { name: 'Linux - IQE Support',      location: 'China Shanghai',  hcType: 'Incremental - CONT', hc: { 'Q2 FY27': 2, 'Q3 FY27': 3, 'Q4 FY27': 2, 'Q1 FY28': 1 } },
        { name: 'Linux Solution Architect', location: 'China Shanghai',  hcType: 'Incremental - CONT', hc: { 'Q4 FY26': 0.5, 'Q1 FY27': 1, 'Q2 FY27': 2, 'Q3 FY27': 2 } },
        { name: 'ROCm on APU',              location: 'India Bangalore', hcType: 'Incremental - CONT', hc: { 'Q2 FY27': 2, 'Q3 FY27': 3, 'Q4 FY27': 2, 'Q1 FY28': 1 } },
        { name: 'Program/Architecture',     location: 'India Hyderabad', hcType: 'Incremental - CONT', hc: { 'Q2 FY26': 0.5, 'Q3 FY26': 1, 'Q4 FY26': 1.5, 'Q1 FY27': 2 } },
        { name: 'Linux BringUp PreSI',      location: 'India Bangalore', hcType: 'Existing - FTE',     hc: { 'Q3 FY26': 0.5, 'Q4 FY26': 1, 'Q1 FY27': 1, 'Q2 FY27': 1 } },
      ]
    },
    {
      id: 4, name: 'KRK1 New Features v1.0', code: 'spg00.097', bu: 'Embedded',
      color: '#6a1b9a', expanded: false,
      milestones: [
        { name: 'Concept', color: '#9c27b0', quarters: ['Q2 FY26'] },
        { name: 'BTO',     color: '#03a9f4', quarters: ['Q3 FY26'] },
        { name: 'AFOr',    color: '#ff9800', quarters: ['Q2 FY27'] },
        { name: 'GA',      color: '#ED1C24', quarters: ['Q4 FY27'] },
      ],
      functions: [
        { name: 'Unified RAS SW model', location: 'China Shanghai',  hcType: 'Incremental - CONT', hc: { 'Q3 FY26': 1, 'Q4 FY26': 2, 'Q1 FY27': 3, 'Q2 FY27': 3 } },
        { name: 'Linux BringUp PreSI',  location: 'India Bangalore', hcType: 'Existing - FTE',     hc: { 'Q4 FY26': 1, 'Q1 FY27': 2, 'Q2 FY27': 2, 'Q3 FY27': 1 } },
        { name: 'Program Management',   location: 'India Hyderabad', hcType: 'Incremental - CONT', hc: { 'Q2 FY26': 1, 'Q3 FY26': 2, 'Q4 FY26': 3, 'Q1 FY27': 4 } },
        { name: 'ROCm on APU',          location: 'India Bangalore', hcType: 'Incremental - CONT', hc: { 'Q2 FY26': 0.5, 'Q3 FY26': 1, 'Q1 FY27': 2, 'Q2 FY27': 2 } },
      ]
    },
  ];

  get filteredProjects(): GanttProject[] {
    return this.filterBU ? this.projects.filter(p => p.bu === this.filterBU) : this.projects;
  }

  // Sort largest-peak first so smaller areas render on top
  get sortedBySize(): GanttProject[] {
    return [...this.filteredProjects].sort((a, b) => this.getProjPeak(b) - this.getProjPeak(a));
  }

  // AMD baseline HC — editable by user in the chart header
  baselineHC = 40;

  // Stacked total across all projects per quarter
  getStackedTotal(q: string): number {
    return Math.round(
      this.filteredProjects.reduce((s, p) => s + this.getProjectTotal(p, q), 0) * 10
    ) / 10;
  }

  // Chart Y-axis max = larger of baseline or stacked peak (so baseline always visible)
  get chartMax(): number {
    const stackedPeak = Math.max(...this.quarters.map(q => this.getStackedTotal(q)), 1);
    return Math.max(stackedPeak, this.baselineHC) * 1.1; // 10% headroom
  }

  get combinedMax(): number { return this.chartMax; }

  // Builds stacked layer data — each project's band sits on top of cumulative sum below it
  get stackedLayers(): { id: number; color: string; areaD: string; topLineD: string }[] {
    const projects = this.filteredProjects;
    const max = this.chartMax;
    const baseline = this.svgH - this.padB;

    // Cumulative bottom per quarter index
    const cumulative = new Array(this.quarters.length).fill(0);

    return projects.map(proj => {
      const topPts = this.quarters.map((q, i) => {
        const bottom = cumulative[i];
        const top = bottom + this.getProjectTotal(proj, q);
        return { x: this.xPos(i), topY: this.yPos(top, max), botY: this.yPos(bottom, max), top, bottom };
      });

      // Update cumulative for next layer
      this.quarters.forEach((q, i) => {
        cumulative[i] += this.getProjectTotal(proj, q);
      });

      // Area: top edge forward, bottom edge backward (trapezoid)
      const active = topPts.filter(p => p.top > 0);
      if (active.length === 0) return { id: proj.id, color: proj.color, areaD: '', topLineD: '' };

      const first = active[0];
      const last = active[active.length - 1];
      const topEdge = active.map(p => `${p.x},${p.topY}`).join(' L ');
      const botEdge = [...active].reverse().map(p => `${p.x},${p.botY}`).join(' L ');
      const areaD = `M ${first.x},${first.botY} L ${topEdge} L ${last.x},${last.botY} L ${botEdge} Z`;

      // Top line only
      const topLineD = 'M ' + active.map(p => `${p.x},${p.topY}`).join(' L ');

      return { id: proj.id, color: proj.color, areaD, topLineD };
    });
  }

  // Gap area path — red fill only where total stack exceeds baseline
  gapAreaPath(): string {
    const baselineY = this.yPos(this.baselineHC, this.chartMax);
    const pts = this.quarters.map((q, i) => ({ x: this.xPos(i), total: this.getStackedTotal(q) }));
    const segments: string[] = [];
    let inGap = false;
    let path = '';
    for (let i = 0; i < pts.length; i++) {
      const { x, total } = pts[i];
      if (total > this.baselineHC) {
        const y = this.yPos(total, this.chartMax);
        if (!inGap) { path = `M ${x},${baselineY} L ${x},${y}`; inGap = true; }
        else path += ` L ${x},${y}`;
      } else {
        if (inGap) { path += ` L ${x},${baselineY} Z`; segments.push(path); inGap = false; path = ''; }
      }
    }
    if (inGap) { path += ` L ${pts[pts.length - 1].x},${baselineY} Z`; segments.push(path); }
    return segments.join(' ');
  }

  toggleProject(proj: GanttProject) { proj.expanded = !proj.expanded; }

  getProjectTotal(proj: GanttProject, quarter: string): number {
    const total = proj.functions.reduce((s, fn) => s + (fn.hc[quarter] || 0), 0);
    return Math.round(total * 10) / 10;
  }

  getProjPeak(proj: GanttProject): number {
    return Math.max(...this.quarters.map(q => this.getProjectTotal(proj, q)), 0);
  }

  getFnPeak(fn: FunctionRow): number {
    return Math.max(...Object.values(fn.hc), 0);
  }

  // ── SVG helpers ──
  xPos(qi: number): number {
    const usableW = this.svgW - this.padL - this.padR;
    return this.padL + (qi / (this.quarters.length - 1)) * usableW;
  }

  yPos(val: number, max: number): number {
    const usableH = this.svgH - this.padT - this.padB;
    return this.padT + usableH * (1 - val / max);
  }

  yPosSm(val: number, max: number): number {
    const usableH = this.svgHsm - this.padT - this.padB;
    return this.padT + usableH * (1 - val / (max || 1));
  }

  yTicks(max: number): number[] {
    if (max <= 0) return [0];
    const step = max <= 5 ? 1 : max <= 15 ? 2 : max <= 30 ? 5 : 10;
    const ticks: number[] = [];
    for (let v = 0; v <= max; v += step) ticks.push(v);
    return ticks;
  }

  linePath(proj: GanttProject, max: number): string {
    const pts = this.quarters
      .map((q, i) => ({ x: this.xPos(i), y: this.yPos(this.getProjectTotal(proj, q), max), v: this.getProjectTotal(proj, q) }))
      .filter(p => p.v > 0);
    if (pts.length === 0) return '';
    return 'M ' + pts.map(p => `${p.x},${p.y}`).join(' L ');
  }

  areaPath(proj: GanttProject, max: number): string {
    const allPts = this.quarters.map((q, i) => ({
      x: this.xPos(i), y: this.yPos(this.getProjectTotal(proj, q), max), v: this.getProjectTotal(proj, q)
    }));
    const active = allPts.filter(p => p.v > 0);
    if (active.length === 0) return '';
    const baseline = this.svgH - this.padB;
    const line = active.map(p => `${p.x},${p.y}`).join(' L ');
    return `M ${active[0].x},${baseline} L ${line} L ${active[active.length - 1].x},${baseline} Z`;
  }

  linePathSm(proj: GanttProject): string {
    const max = this.getProjPeak(proj) || 1;
    const pts = this.quarters
      .map((q, i) => ({ x: this.xPos(i), y: this.yPosSm(this.getProjectTotal(proj, q), max), v: this.getProjectTotal(proj, q) }))
      .filter(p => p.v > 0);
    if (pts.length === 0) return '';
    return 'M ' + pts.map(p => `${p.x},${p.y}`).join(' L ');
  }

  areaPathSm(proj: GanttProject): string {
    const max = this.getProjPeak(proj) || 1;
    const allPts = this.quarters.map((q, i) => ({
      x: this.xPos(i), y: this.yPosSm(this.getProjectTotal(proj, q), max), v: this.getProjectTotal(proj, q)
    }));
    const active = allPts.filter(p => p.v > 0);
    if (active.length === 0) return '';
    const baseline = this.svgHsm - this.padB;
    const line = active.map(p => `${p.x},${p.y}`).join(' L ');
    return `M ${active[0].x},${baseline} L ${line} L ${active[active.length - 1].x},${baseline} Z`;
  }

  diamondPoints(qi: number, val: number, max: number): string {
    const cx = this.xPos(qi);
    const cy = this.yPos(val, max);
    const s = 6;
    return `${cx},${cy - s} ${cx + s},${cy} ${cx},${cy + s} ${cx - s},${cy}`;
  }
}
