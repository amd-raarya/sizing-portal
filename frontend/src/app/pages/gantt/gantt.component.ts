import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { FormsModule } from '@angular/forms';
import { MatTooltipModule } from '@angular/material/tooltip';

interface Quarter { label: string; }
interface Milestone { name: string; color: string; quarter: string; }
interface FunctionRow { name: string; location: string; hcType: string; hc: Record<string, number>; }
interface GanttProject {
  id: number;
  name: string;
  code: string;
  bu: string;
  color: string;
  expanded: boolean;
  totalHC: Record<string, number>;
  peakHC: number;
  milestones: Milestone[];
  functions: FunctionRow[];
}

@Component({
  selector: 'app-gantt',
  standalone: true,
  imports: [CommonModule, MatIconModule, MatButtonModule, MatSelectModule, MatFormFieldModule, FormsModule, MatTooltipModule],
  template: `
    <div class="gantt-page">
      <!-- Header -->
      <div class="page-header">
        <div class="header-left">
          <mat-icon class="page-icon">view_timeline</mat-icon>
          <div>
            <h2>Project Gantt View</h2>
            <p class="subtitle">All projects · HC by quarter · Milestones · Click to expand</p>
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
          <button mat-stroked-button (click)="collapseAll()">
            <mat-icon>unfold_less</mat-icon> Collapse All
          </button>
          <button mat-stroked-button (click)="expandAll()">
            <mat-icon>unfold_more</mat-icon> Expand All
          </button>
        </div>
      </div>

      <!-- Legend -->
      <div class="legend-bar">
        <span class="legend-item"><span class="legend-dot" style="background:#1a1a2e"></span> Sized HC</span>
        <span class="legend-item"><span class="legend-ms" style="background:#ED1C24"></span> Milestone</span>
        <span class="legend-item"><span class="legend-dot" style="background:#4caf5066"></span> Low</span>
        <span class="legend-item"><span class="legend-dot" style="background:#ff980066"></span> Medium</span>
        <span class="legend-item"><span class="legend-dot" style="background:#ED1C2466"></span> Peak</span>
      </div>

      <!-- Gantt table -->
      <div class="gantt-wrapper">
        <table class="gantt-table">
          <thead>
            <!-- Milestone row -->
            <tr class="ms-header-row">
              <th class="project-col sticky-col"></th>
              @for (q of quarters; track q.label) {
                <th class="q-cell">
                  @for (proj of filteredProjects; track proj.id) {
                    @for (ms of getMilestonesForQuarter(proj, q.label); track ms.name) {
                      <span class="ms-marker" [style.background]="ms.color" [matTooltip]="proj.name + ' — ' + ms.name">
                        ◆
                      </span>
                    }
                  }
                </th>
              }
            </tr>
            <!-- Quarter labels -->
            <tr class="q-header-row">
              <th class="project-col sticky-col">Project</th>
              @for (q of quarters; track q.label) {
                <th class="q-cell q-label">{{ q.label }}</th>
              }
              <th class="total-col">Peak HC</th>
            </tr>
          </thead>
          <tbody>
            @for (proj of filteredProjects; track proj.id) {
              <!-- Project summary row -->
              <tr class="project-row" (click)="toggleProject(proj)">
                <td class="project-col sticky-col">
                  <div class="project-name-cell">
                    <span class="expand-btn">
                      <mat-icon>{{ proj.expanded ? 'expand_less' : 'expand_more' }}</mat-icon>
                    </span>
                    <span class="proj-dot" [style.background]="proj.color"></span>
                    <div class="proj-info">
                      <span class="proj-name">{{ proj.name }}</span>
                      <span class="proj-code">{{ proj.code }} · {{ proj.bu }}</span>
                    </div>
                  </div>
                </td>
                @for (q of quarters; track q.label) {
                  <td class="q-cell">
                    @if (proj.totalHC[q.label]) {
                      <div class="hc-bar-wrap">
                        <div class="hc-bar"
                          [style.width.%]="getBarWidth(proj.totalHC[q.label], proj.peakHC)"
                          [style.background]="getBarColor(proj.totalHC[q.label], proj.peakHC, proj.color)"
                          [matTooltip]="proj.totalHC[q.label] + ' HC'">
                        </div>
                        <span class="hc-val">{{ proj.totalHC[q.label] }}</span>
                      </div>
                    }
                  </td>
                }
                <td class="total-col peak-val">{{ proj.peakHC }}</td>
              </tr>

              <!-- Expanded function rows -->
              @if (proj.expanded) {
                @for (fn of proj.functions; track fn.name) {
                  <tr class="fn-row">
                    <td class="project-col sticky-col">
                      <div class="fn-name-cell">
                        <span class="fn-name">{{ fn.name }}</span>
                        <span class="fn-meta">{{ fn.location }} · {{ fn.hcType }}</span>
                      </div>
                    </td>
                    @for (q of quarters; track q.label) {
                      <td class="q-cell fn-q-cell">
                        @if (fn.hc[q.label]) {
                          <div class="fn-bar-wrap">
                            <div class="fn-bar"
                              [style.width.%]="getBarWidth(fn.hc[q.label], proj.peakHC)"
                              [style.background]="proj.color + '99'">
                            </div>
                            <span class="fn-val">{{ fn.hc[q.label] }}</span>
                          </div>
                        }
                      </td>
                    }
                    <td class="total-col fn-peak">{{ getPeakHC(fn.hc) }}</td>
                  </tr>
                }
              }
            }
          </tbody>
        </table>
      </div>
    </div>
  `,
  styles: [`
    .gantt-page { padding: 0; }

    .page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
    .header-left { display: flex; align-items: center; gap: 14px; }
    .page-icon { font-size: 32px; width: 32px; height: 32px; color: #ED1C24; }
    .page-header h2 { margin: 0; font-size: 22px; font-weight: 500; }
    .subtitle { margin: 2px 0 0; color: #666; font-size: 13px; }
    .header-actions { display: flex; align-items: center; gap: 10px; }
    .filter-field { width: 130px; }
    .filter-field ::ng-deep .mat-mdc-form-field-subscript-wrapper { display: none; }

    .legend-bar { display: flex; gap: 20px; padding: 8px 16px; background: white; border: 1px solid #e8e8e8; border-radius: 8px; margin-bottom: 16px; align-items: center; font-size: 12px; color: #666; }
    .legend-item { display: flex; align-items: center; gap: 6px; }
    .legend-dot { width: 12px; height: 12px; border-radius: 3px; display: inline-block; }
    .legend-ms { font-size: 10px; color: #ED1C24; }

    /* Table */
    .gantt-wrapper { overflow-x: auto; border-radius: 10px; border: 1px solid #e0e0e0; background: white; }
    .gantt-table { border-collapse: collapse; width: 100%; min-width: max-content; }

    /* Sticky project column */
    .sticky-col { position: sticky; left: 0; z-index: 3; background: white; border-right: 2px solid #e8e8e8; }

    /* Quarter cells */
    .q-cell { min-width: 90px; max-width: 90px; padding: 0 4px; text-align: center; border-right: 1px solid #f0f0f0; }
    .project-col { min-width: 260px; max-width: 260px; padding: 0 12px; }
    .total-col { min-width: 70px; padding: 0 10px; text-align: center; font-weight: 600; font-size: 13px; border-left: 2px solid #f0f0f0; }

    /* Milestone header row */
    .ms-header-row th { height: 24px; background: #fff; border-bottom: none; padding: 2px 4px; }
    .ms-marker { font-size: 11px; cursor: help; margin: 0 1px; }

    /* Quarter label row */
    .q-header-row { background: #f8f9fa; }
    .q-header-row th { padding: 10px 4px; font-size: 11px; font-weight: 700; color: #555; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 2px solid #e0e0e0; }
    .q-label { color: #1a1a2e !important; }

    /* Project row */
    .project-row { cursor: pointer; border-bottom: 1px solid #eee; }
    .project-row:hover td { background: #f8f9ff; }
    .project-row td { padding: 10px 4px; height: 52px; }
    .project-name-cell { display: flex; align-items: center; gap: 8px; }
    .expand-btn mat-icon { font-size: 18px; width: 18px; height: 18px; color: #999; }
    .proj-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
    .proj-info { display: flex; flex-direction: column; }
    .proj-name { font-size: 13px; font-weight: 600; color: #1a1a2e; }
    .proj-code { font-size: 11px; color: #999; }

    /* HC bar in project row */
    .hc-bar-wrap { display: flex; align-items: center; gap: 6px; padding: 0 4px; }
    .hc-bar { height: 20px; border-radius: 3px; min-width: 4px; transition: width 0.3s; }
    .hc-val { font-size: 12px; font-weight: 600; color: #333; white-space: nowrap; }
    .peak-val { color: #ED1C24; font-size: 14px; }

    /* Function drill-down rows */
    .fn-row { border-bottom: 1px solid #f5f5f5; background: #fafbff; }
    .fn-row td { padding: 6px 4px; height: 38px; }
    .fn-name-cell { display: flex; flex-direction: column; padding-left: 36px; }
    .fn-name { font-size: 12px; font-weight: 500; color: #444; }
    .fn-meta { font-size: 10px; color: #aaa; }
    .fn-bar-wrap { display: flex; align-items: center; gap: 4px; padding: 0 4px; }
    .fn-bar { height: 14px; border-radius: 2px; min-width: 3px; }
    .fn-val { font-size: 11px; color: #666; }
    .fn-peak { color: #888; font-size: 12px; }
    .fn-q-cell { background: transparent; }
  `]
})
export class GanttComponent {
  filterBU = '';

  quarters: Quarter[] = [
    { label: 'Q2 FY26' }, { label: 'Q3 FY26' }, { label: 'Q4 FY26' },
    { label: 'Q1 FY27' }, { label: 'Q2 FY27' }, { label: 'Q3 FY27' },
    { label: 'Q4 FY27' }, { label: 'Q1 FY28' }, { label: 'Q2 FY28' },
  ];

  projects: GanttProject[] = [
    {
      id: 1, name: 'Android EAP v1.3', code: 'spg00.099', bu: 'Embedded',
      color: '#1565c0', expanded: false, peakHC: 21,
      totalHC: { 'Q2 FY26': 4, 'Q3 FY26': 8, 'Q4 FY26': 12, 'Q1 FY27': 21, 'Q2 FY27': 18, 'Q3 FY27': 14, 'Q4 FY27': 8, 'Q1 FY28': 4 },
      milestones: [
        { name: 'Concept', color: '#9c27b0', quarter: 'Q2 FY26' },
        { name: 'BTO', color: '#03a9f4', quarter: 'Q4 FY26' },
        { name: 'Bring Up Exit', color: '#4caf50', quarter: 'Q2 FY27' },
        { name: 'GA', color: '#ED1C24', quarter: 'Q1 FY28' },
      ],
      functions: [
        { name: 'UMR-(TimW/Pierre-Eric)', location: 'Canada', hcType: 'Existing - FTE', hc: { 'Q2 FY26': 0.5, 'Q3 FY26': 1, 'Q4 FY26': 2, 'Q1 FY27': 3 } },
        { name: 'Linux BPI-(TimW/Slava)', location: 'Canada', hcType: 'Existing - FTE', hc: { 'Q2 FY26': 0.5, 'Q3 FY26': 1.5, 'Q4 FY26': 3, 'Q1 FY27': 5 } },
        { name: 'Perfetto-(RayH/Julian)', location: 'Canada', hcType: 'Incremental - CONT', hc: { 'Q3 FY26': 1, 'Q4 FY26': 2, 'Q1 FY27': 4, 'Q2 FY27': 4 } },
        { name: 'Program/Architecture', location: 'India Hyderabad', hcType: 'Incremental - CONT', hc: { 'Q4 FY26': 1, 'Q1 FY27': 3, 'Q2 FY27': 5, 'Q3 FY27': 4 } },
        { name: 'Linux- Compositor', location: 'India Hyderabad', hcType: 'Existing - FTE', hc: { 'Q1 FY27': 2, 'Q2 FY27': 4, 'Q3 FY27': 5, 'Q4 FY27': 3 } },
      ]
    },
    {
      id: 2, name: 'ECARX SW Tools CCB', code: 'spg07.030', bu: 'Embedded',
      color: '#2e7d32', expanded: false, peakHC: 9,
      totalHC: { 'Q2 FY26': 2, 'Q3 FY26': 5, 'Q4 FY26': 9, 'Q1 FY27': 7, 'Q2 FY27': 5, 'Q3 FY27': 3 },
      milestones: [
        { name: 'Feasibility', color: '#3f51b5', quarter: 'Q2 FY26' },
        { name: 'Asic Back', color: '#009688', quarter: 'Q4 FY26' },
        { name: 'AFEr', color: '#8bc34a', quarter: 'Q2 FY27' },
      ],
      functions: [
        { name: 'UMR-(RayH/Jiqian)', location: 'Canada', hcType: 'Existing - FTE', hc: { 'Q2 FY26': 0.5, 'Q3 FY26': 1, 'Q4 FY26': 2 } },
        { name: 'System logging tool', location: 'Canada', hcType: 'Existing - FTE', hc: { 'Q3 FY26': 1, 'Q4 FY26': 3, 'Q1 FY27': 3 } },
        { name: 'Linux BPI', location: 'India Bangalore', hcType: 'Incremental - CONT', hc: { 'Q4 FY26': 2, 'Q1 FY27': 2, 'Q2 FY27': 2 } },
      ]
    },
    {
      id: 3, name: 'Eris v2.0', code: 'spg00.098', bu: 'Embedded',
      color: '#e65100', expanded: false, peakHC: 10,
      totalHC: { 'Q2 FY26': 1, 'Q3 FY26': 2, 'Q4 FY26': 4, 'Q1 FY27': 7, 'Q2 FY27': 10, 'Q3 FY27': 9, 'Q4 FY27': 6, 'Q1 FY28': 3 },
      milestones: [
        { name: 'BTO', color: '#03a9f4', quarter: 'Q4 FY26' },
        { name: 'Bring Up Exit', color: '#4caf50', quarter: 'Q2 FY27' },
        { name: 'AFEd', color: '#ffeb3b', quarter: 'Q3 FY27' },
        { name: 'GA', color: '#ED1C24', quarter: 'Q1 FY28' },
      ],
      functions: [
        { name: 'Linux - IQE Support', location: 'China Shanghai', hcType: 'Incremental - CONT', hc: { 'Q2 FY27': 2, 'Q3 FY27': 3, 'Q4 FY27': 2, 'Q1 FY28': 1 } },
        { name: 'Linux Solution Architect', location: 'China Shanghai', hcType: 'Incremental - CONT', hc: { 'Q4 FY26': 0.5, 'Q1 FY27': 1, 'Q2 FY27': 2, 'Q3 FY27': 2 } },
        { name: 'ROCm on APU', location: 'India Bangalore', hcType: 'Incremental - CONT', hc: { 'Q2 FY27': 2, 'Q3 FY27': 3, 'Q4 FY27': 2, 'Q1 FY28': 1 } },
      ]
    },
    {
      id: 4, name: 'KRK1 New Features v1.0', code: 'spg00.097', bu: 'Embedded',
      color: '#6a1b9a', expanded: false, peakHC: 11,
      totalHC: { 'Q2 FY26': 2, 'Q3 FY26': 4, 'Q4 FY26': 7, 'Q1 FY27': 11, 'Q2 FY27': 9, 'Q3 FY27': 6, 'Q4 FY27': 3 },
      milestones: [
        { name: 'Concept', color: '#9c27b0', quarter: 'Q2 FY26' },
        { name: 'BTO', color: '#03a9f4', quarter: 'Q3 FY26' },
        { name: 'AFOr', color: '#ff9800', quarter: 'Q2 FY27' },
        { name: 'AFOd', color: '#ff5722', quarter: 'Q4 FY27' },
      ],
      functions: [
        { name: 'Unified RAS SW model', location: 'China Shanghai', hcType: 'Incremental - CONT', hc: { 'Q3 FY26': 1, 'Q4 FY26': 2, 'Q1 FY27': 3, 'Q2 FY27': 3 } },
        { name: 'Linux BringUp PreSI', location: 'India Bangalore', hcType: 'Existing - FTE', hc: { 'Q4 FY26': 1, 'Q1 FY27': 2, 'Q2 FY27': 2, 'Q3 FY27': 1 } },
        { name: 'Program Management', location: 'India Hyderabad', hcType: 'Incremental - CONT', hc: { 'Q2 FY26': 1, 'Q3 FY26': 2, 'Q4 FY26': 3, 'Q1 FY27': 4 } },
      ]
    },
  ];

  get filteredProjects(): GanttProject[] {
    if (!this.filterBU) return this.projects;
    return this.projects.filter(p => p.bu === this.filterBU);
  }

  toggleProject(proj: GanttProject) { proj.expanded = !proj.expanded; }
  expandAll() { this.projects.forEach(p => p.expanded = true); }
  collapseAll() { this.projects.forEach(p => p.expanded = false); }

  getMilestonesForQuarter(proj: GanttProject, quarter: string): Milestone[] {
    return proj.milestones.filter(m => m.quarter === quarter);
  }

  getBarWidth(hc: number, peak: number): number {
    if (!peak) return 0;
    return Math.max((hc / peak) * 100, 5);
  }

  getBarColor(hc: number, peak: number, baseColor: string): string {
    const pct = hc / peak;
    if (pct >= 0.8) return '#ED1C24aa';
    if (pct >= 0.5) return '#ff9800aa';
    return baseColor + '99';
  }

  getPeakHC(hc: Record<string, number>): number {
    return Math.max(...Object.values(hc), 0);
  }
}
