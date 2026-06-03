import { Component } from '@angular/core';
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
  imports: [CommonModule, MatIconModule, MatButtonModule, MatSelectModule, MatFormFieldModule, FormsModule, MatTooltipModule],
  template: `
    <div class="gantt-page">
      <div class="page-header">
        <div class="header-left">
          <mat-icon class="page-icon">view_timeline</mat-icon>
          <div>
            <h2>Project Gantt View</h2>
            <p class="subtitle">HC by quarter · Milestone phases · Click project to expand functions</p>
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
          <button mat-stroked-button (click)="collapseAll()"><mat-icon>unfold_less</mat-icon> Collapse</button>
          <button mat-stroked-button (click)="expandAll()"><mat-icon>unfold_more</mat-icon> Expand</button>
        </div>
      </div>

      <!-- Milestone legend -->
      <div class="ms-legend">
        <span class="ms-legend-label">Milestones:</span>
        @for (ms of allMilestones; track ms.name) {
          <span class="ms-legend-item">
            <span class="ms-diamond" [style.color]="ms.color">◆</span> {{ ms.name }}
          </span>
        }
      </div>

      <!-- Gantt table -->
      <div class="gantt-wrapper">
        <table class="gantt-table">
          <thead>
            <!-- Milestone marker row -->
            <tr class="ms-row">
              <th class="label-col sticky-col"></th>
              <th class="info-col sticky-col2"></th>
              @for (q of quarters; track q) {
                <th class="q-col">
                  <div class="ms-markers">
                    @for (proj of filteredProjects; track proj.id) {
                      @for (ms of getMilestonesForQuarter(proj, q); track ms.name) {
                        <span class="ms-diamond-marker" [style.color]="ms.color"
                          [matTooltip]="proj.name + ' — ' + ms.name">◆</span>
                      }
                    }
                  </div>
                </th>
              }
              <th class="peak-col">Peak</th>
            </tr>
            <!-- Quarter headers -->
            <tr class="q-header-row">
              <th class="label-col sticky-col">Project / Function</th>
              <th class="info-col sticky-col2">Details</th>
              @for (q of quarters; track q) {
                <th class="q-col q-label">{{ q }}</th>
              }
              <th class="peak-col">HC</th>
            </tr>
          </thead>
          <tbody>
            @for (proj of filteredProjects; track proj.id) {
              <!-- Project aggregate row -->
              <tr class="proj-row" (click)="toggleProject(proj)">
                <td class="label-col sticky-col proj-label-cell">
                  <span class="expand-icon"><mat-icon>{{ proj.expanded ? 'expand_less' : 'expand_more' }}</mat-icon></span>
                  <span class="proj-dot" [style.background]="proj.color"></span>
                  <div class="proj-text">
                    <span class="proj-name">{{ proj.name }}</span>
                    <span class="proj-code">{{ proj.code }}</span>
                  </div>
                </td>
                <td class="info-col sticky-col2 proj-bu">{{ proj.bu }}</td>
                @for (q of quarters; track q) {
                  <td class="q-col">
                    @if (getProjectTotal(proj, q) > 0) {
                      <div class="gantt-bar proj-bar"
                        [style.background]="getMilestoneColorForQ(proj, q) || proj.color"
                        [style.opacity]="0.85"
                        [matTooltip]="proj.name + ' · ' + q + ': ' + getProjectTotal(proj, q) + ' HC'">
                        <span class="bar-val">{{ getProjectTotal(proj, q) }}</span>
                      </div>
                    }
                  </td>
                }
                <td class="peak-col peak-val" [style.color]="proj.color">{{ getProjPeak(proj) }}</td>
              </tr>

              <!-- Function rows (expanded) -->
              @if (proj.expanded) {
                @for (fn of proj.functions; track fn.name) {
                  <tr class="fn-row">
                    <td class="label-col sticky-col fn-label-cell">
                      <span class="fn-name">{{ fn.name }}</span>
                    </td>
                    <td class="info-col sticky-col2 fn-details">
                      {{ fn.location }} · <span class="hc-type-sm">{{ fn.hcType }}</span>
                    </td>
                    @for (q of quarters; track q) {
                      <td class="q-col">
                        @if (fn.hc[q] > 0) {
                          <div class="gantt-bar fn-bar"
                            [style.background]="getMilestoneColorForQ(proj, q) || proj.color"
                            [style.opacity]="0.6"
                            [style.width.%]="(fn.hc[q] / getProjPeak(proj)) * 90"
                            [matTooltip]="fn.name + ' · ' + q + ': ' + fn.hc[q] + ' HC'">
                            <span class="bar-val-sm">{{ fn.hc[q] }}</span>
                          </div>
                        }
                      </td>
                    }
                    <td class="peak-col fn-peak">{{ getFnPeak(fn) }}</td>
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
    .page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
    .header-left { display: flex; align-items: center; gap: 14px; }
    .page-icon { font-size: 32px; width: 32px; height: 32px; color: #ED1C24; }
    .page-header h2 { margin: 0; font-size: 22px; font-weight: 500; }
    .subtitle { margin: 2px 0 0; color: #666; font-size: 13px; }
    .header-actions { display: flex; align-items: center; gap: 10px; }
    .filter-field { width: 130px; }
    .filter-field ::ng-deep .mat-mdc-form-field-subscript-wrapper { display: none; }

    /* Milestone legend */
    .ms-legend { display: flex; flex-wrap: wrap; gap: 16px; padding: 8px 16px; background: white; border: 1px solid #e8e8e8; border-radius: 8px; margin-bottom: 16px; align-items: center; font-size: 12px; }
    .ms-legend-label { font-weight: 600; color: #555; }
    .ms-legend-item { display: flex; align-items: center; gap: 4px; color: #555; }
    .ms-diamond { font-size: 12px; }

    /* Gantt table */
    .gantt-wrapper { overflow-x: auto; border-radius: 10px; border: 1px solid #e0e0e0; background: white; }
    .gantt-table { border-collapse: collapse; min-width: max-content; width: 100%; }

    /* Sticky columns */
    .sticky-col { position: sticky; left: 0; z-index: 3; background: white; }
    .sticky-col2 { position: sticky; left: 220px; z-index: 3; background: white; border-right: 2px solid #e8e8e8; }

    /* Column widths */
    .label-col { min-width: 220px; max-width: 220px; padding: 0 10px; }
    .info-col { min-width: 160px; max-width: 160px; padding: 0 8px; }
    .q-col { min-width: 100px; padding: 4px 6px; border-right: 1px solid #f5f5f5; }
    .peak-col { min-width: 56px; padding: 0 8px; text-align: center; border-left: 2px solid #f0f0f0; font-weight: 700; font-size: 13px; }
    .peak-val { font-size: 14px; }
    .fn-peak { color: #888; font-size: 12px; font-weight: 500; }

    /* Milestone row */
    .ms-row th { height: 28px; background: white; border-bottom: none; padding: 2px 6px; vertical-align: bottom; }
    .ms-markers { display: flex; justify-content: center; gap: 2px; min-height: 20px; }
    .ms-diamond-marker { font-size: 12px; cursor: help; }

    /* Quarter header row */
    .q-header-row { background: #f8f9fa; }
    .q-header-row th { padding: 8px 6px; font-size: 11px; font-weight: 700; color: #555; text-transform: uppercase; letter-spacing: 0.3px; border-bottom: 2px solid #e0e0e0; text-align: center; }
    .q-label { color: #1a1a2e !important; }

    /* Project rows */
    .proj-row { cursor: pointer; border-bottom: 2px solid #eaeaea; }
    .proj-row:hover td { background: #f8f9ff; }
    .proj-row td { padding: 8px 6px; height: 48px; vertical-align: middle; }
    .proj-label-cell { display: flex; align-items: center; gap: 6px; }
    .expand-icon mat-icon { font-size: 18px; width: 18px; height: 18px; color: #999; }
    .proj-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
    .proj-text { display: flex; flex-direction: column; }
    .proj-name { font-size: 13px; font-weight: 600; color: #1a1a2e; line-height: 1.2; }
    .proj-code { font-size: 10px; color: #aaa; }
    .proj-bu { font-size: 12px; color: #666; }

    /* Function rows */
    .fn-row { border-bottom: 1px solid #f5f5f5; background: #fafbff; }
    .fn-row td { padding: 5px 6px; height: 36px; vertical-align: middle; }
    .fn-label-cell { display: flex; align-items: center; padding-left: 28px !important; }
    .fn-name { font-size: 12px; font-weight: 500; color: #333; }
    .fn-details { font-size: 11px; color: #999; }
    .hc-type-sm { font-style: italic; }

    /* Gantt bars */
    .gantt-bar { border-radius: 4px; display: flex; align-items: center; padding: 0 6px; min-width: 28px; cursor: default; transition: opacity 0.2s; }
    .gantt-bar:hover { opacity: 1 !important; }
    .proj-bar { height: 28px; width: 90%; }
    .fn-bar { height: 18px; min-width: 20px; }
    .bar-val { font-size: 11px; font-weight: 700; color: white; white-space: nowrap; }
    .bar-val-sm { font-size: 10px; font-weight: 600; color: white; white-space: nowrap; }
  `]
})
export class GanttComponent {
  filterBU = '';

  quarters = [
    'Q2 FY26','Q3 FY26','Q4 FY26',
    'Q1 FY27','Q2 FY27','Q3 FY27','Q4 FY27',
    'Q1 FY28','Q2 FY28'
  ];

  // All unique milestones across projects for legend
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
        { name: 'Linux - IQE Support',         location: 'China Shanghai',  hcType: 'Incremental - CONT', hc: { 'Q2 FY27': 2, 'Q3 FY27': 3, 'Q4 FY27': 2, 'Q1 FY28': 1 } },
        { name: 'Linux Solution Architect',    location: 'China Shanghai',  hcType: 'Incremental - CONT', hc: { 'Q4 FY26': 0.5, 'Q1 FY27': 1, 'Q2 FY27': 2, 'Q3 FY27': 2 } },
        { name: 'ROCm on APU',                 location: 'India Bangalore', hcType: 'Incremental - CONT', hc: { 'Q2 FY27': 2, 'Q3 FY27': 3, 'Q4 FY27': 2, 'Q1 FY28': 1 } },
        { name: 'Program/Architecture',        location: 'India Hyderabad', hcType: 'Incremental - CONT', hc: { 'Q2 FY26': 0.5, 'Q3 FY26': 1, 'Q4 FY26': 1.5, 'Q1 FY27': 2 } },
        { name: 'Linux BringUp PreSI',         location: 'India Bangalore', hcType: 'Existing - FTE',     hc: { 'Q3 FY26': 0.5, 'Q4 FY26': 1, 'Q1 FY27': 1, 'Q2 FY27': 1 } },
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
        { name: 'Unified RAS SW model',   location: 'China Shanghai',  hcType: 'Incremental - CONT', hc: { 'Q3 FY26': 1, 'Q4 FY26': 2, 'Q1 FY27': 3, 'Q2 FY27': 3 } },
        { name: 'Linux BringUp PreSI',    location: 'India Bangalore', hcType: 'Existing - FTE',     hc: { 'Q4 FY26': 1, 'Q1 FY27': 2, 'Q2 FY27': 2, 'Q3 FY27': 1 } },
        { name: 'Program Management',     location: 'India Hyderabad', hcType: 'Incremental - CONT', hc: { 'Q2 FY26': 1, 'Q3 FY26': 2, 'Q4 FY26': 3, 'Q1 FY27': 4 } },
        { name: 'ROCm on APU',            location: 'India Bangalore', hcType: 'Incremental - CONT', hc: { 'Q2 FY26': 0.5, 'Q3 FY26': 1, 'Q1 FY27': 2, 'Q2 FY27': 2 } },
      ]
    },
  ];

  get filteredProjects(): GanttProject[] {
    return this.filterBU ? this.projects.filter(p => p.bu === this.filterBU) : this.projects;
  }

  toggleProject(proj: GanttProject) { proj.expanded = !proj.expanded; }
  expandAll() { this.projects.forEach(p => p.expanded = true); }
  collapseAll() { this.projects.forEach(p => p.expanded = false); }

  // Derive project total from function rows — fixes the data mismatch
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

  getMilestonesForQuarter(proj: GanttProject, quarter: string): Milestone[] {
    return proj.milestones.filter(m => m.quarters.includes(quarter));
  }

  // Color the bar based on which milestone phase the quarter falls in
  getMilestoneColorForQ(proj: GanttProject, quarter: string): string | null {
    const allQ = this.quarters;
    const qIdx = allQ.indexOf(quarter);
    // Find which milestone phase this quarter belongs to
    // A quarter is in a phase if it's between this milestone and the next one
    const sorted = [...proj.milestones].sort((a, b) =>
      allQ.indexOf(a.quarters[0]) - allQ.indexOf(b.quarters[0])
    );
    for (let i = sorted.length - 1; i >= 0; i--) {
      const msQIdx = allQ.indexOf(sorted[i].quarters[0]);
      if (qIdx >= msQIdx) return sorted[i].color;
    }
    return null;
  }
}
