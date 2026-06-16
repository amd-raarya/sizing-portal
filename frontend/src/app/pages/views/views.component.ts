import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { FormsModule } from '@angular/forms';
import { MatTooltipModule } from '@angular/material/tooltip';

@Component({
  selector: 'app-views',
  standalone: true,
  imports: [CommonModule, MatSelectModule, MatFormFieldModule, MatButtonModule, MatIconModule, FormsModule, MatTooltipModule],
  template: `
    <div class="views-page">
      <div class="page-header">
        <div class="header-left">
          <mat-icon class="view-icon">{{ viewConfig.icon }}</mat-icon>
          <div>
            <h2>{{ viewConfig.title }}</h2>
            <p class="subtitle">{{ viewConfig.subtitle }}</p>
          </div>
        </div>
        <div class="header-actions">
          <button mat-stroked-button class="export-btn">
            <mat-icon>download</mat-icon> Export
          </button>
          <button mat-stroked-button class="refresh-btn">
            <mat-icon>refresh</mat-icon> Refresh
          </button>
        </div>
      </div>

      <!-- Slicer bar -->
      <div class="slicer-bar">
        <mat-form-field appearance="outline" class="slicer-field">
          <mat-label>BU</mat-label>
          <mat-select [(ngModel)]="filters.bu">
            <mat-option value="">All</mat-option>
            <mat-option value="Embedded">Embedded</mat-option>
            <mat-option value="Compute">Compute</mat-option>
          </mat-select>
        </mat-form-field>
        <mat-form-field appearance="outline" class="slicer-field">
          <mat-label>Project</mat-label>
          <mat-select [(ngModel)]="filters.project">
            <mat-option value="">All Projects</mat-option>
            <mat-option value="Eris v2.0">Eris v2.0</mat-option>
            <mat-option value="Android EAP v1.3">Android EAP v1.3</mat-option>
            <mat-option value="ECARX SW Tools CCB">ECARX SW Tools CCB</mat-option>
            <mat-option value="KRK1 New Features v1.0">KRK1 New Features v1.0</mat-option>
          </mat-select>
        </mat-form-field>
        <mat-form-field appearance="outline" class="slicer-field">
          <mat-label>FY / Quarter</mat-label>
          <mat-select [(ngModel)]="filters.fy">
            <mat-option value="">All</mat-option>
            <mat-option value="fy26">FY26</mat-option>
            <mat-option value="fy27">FY27</mat-option>
            <mat-option value="fy28">FY28</mat-option>
          </mat-select>
        </mat-form-field>
        <mat-form-field appearance="outline" class="slicer-field">
          <mat-label>HC Type</mat-label>
          <mat-select [(ngModel)]="filters.hcType">
            <mat-option value="">All</mat-option>
            <mat-option value="Existing - FTE">Existing - FTE</mat-option>
            <mat-option value="Incremental - CONT">Incremental - CONT</mat-option>
          </mat-select>
        </mat-form-field>
        <mat-form-field appearance="outline" class="slicer-field">
          <mat-label>Location</mat-label>
          <mat-select [(ngModel)]="filters.location">
            <mat-option value="">All</mat-option>
            <mat-option value="Canada">Canada</mat-option>
            <mat-option value="India Bangalore">India Bangalore</mat-option>
            <mat-option value="India Hyderabad">India Hyderabad</mat-option>
            <mat-option value="China Shanghai">China Shanghai</mat-option>
          </mat-select>
        </mat-form-field>
        <mat-form-field appearance="outline" class="slicer-field" *ngIf="viewType === 'sizing'">
          <mat-label>Version Status</mat-label>
          <mat-select [(ngModel)]="filters.status">
            <mat-option value="">All</mat-option>
            <mat-option value="draft">Draft</mat-option>
            <mat-option value="submitted">Submitted</mat-option>
            <mat-option value="bu_approved">BU Approved</mat-option>
          </mat-select>
        </mat-form-field>
      </div>

      <!-- View content -->
      @if (viewType === 'sizing') {
        <div class="sizing-view">

          <!-- KPI tiles -->
          <div class="gap-kpi-bar">
            <div class="gap-kpi-tile">
              <span class="kpi-val">{{ sizingMetric === 'hc' ? sizingTotalHC : sizingMetric === 'peak' ? sizingPeakHC : sizingTotalCost }}</span>
              <span class="kpi-label">{{ sizingMetric === 'hc' ? 'Total HC' : sizingMetric === 'peak' ? 'Peak HC' : 'Total Cost ($)' }}</span>
            </div>
            <div class="gap-kpi-tile">
              <span class="kpi-val">{{ sizingFilteredRows.length }}</span>
              <span class="kpi-label">Function Rows</span>
            </div>
            <div class="gap-kpi-tile">
              <span class="kpi-val">{{ sizingProjectCount }}</span>
              <span class="kpi-label">Projects</span>
            </div>
            <div class="gap-kpi-tile">
              <span class="kpi-val">{{ sizingLocationCount }}</span>
              <span class="kpi-label">Locations</span>
            </div>
          </div>

          <!-- Metric toggle + bar chart -->
          <div class="sizing-chart-card">
            <div class="sizing-chart-header">
              <span class="sizing-chart-title">Total HC by Quarter</span>
              <div class="metric-toggle">
                <button [class.active]="sizingMetric === 'hc'"   (click)="sizingMetric = 'hc'">Total HC</button>
                <button [class.active]="sizingMetric === 'peak'" (click)="sizingMetric = 'peak'">Peak HC</button>
                <button [class.active]="sizingMetric === 'cost'" (click)="sizingMetric = 'cost'">Cost $</button>
              </div>
            </div>
            <div class="sizing-bar-chart">
              @for (q of sizingQuarters; track q) {
                <div class="sbar-col">
                  @if (getSizingQNumeric(q) > 0) {
                    <span class="sbar-val">{{ getSizingQValue(q) }}</span>
                    <div class="sbar-fill"
                      [style.height.%]="(getSizingQNumeric(q) / sizingChartMax) * 100"
                      [matTooltip]="q + ': ' + getSizingQValue(q)">
                    </div>
                  }
                  <span class="sbar-label">{{ q }}</span>
                </div>
              }
            </div>
          </div>

          <!-- Matrix table -->
          <div class="sizing-matrix-card">
            <div class="sizing-matrix-header">
              <span class="sizing-chart-title">Headcount Detail by Function</span>
              <div class="hc-type-legend">
                <span class="legend-dot" style="background:#1565c0"></span> Incremental - CONT
                <span class="legend-dot" style="background:#4caf50; margin-left:12px"></span> Existing - FTE
              </div>
            </div>
            <div class="sizing-table-wrap">
              <table class="sizing-matrix-table">
                <thead>
                  <tr>
                    <th class="col-team">Team</th>
                    <th class="col-fn">Function</th>
                    <th class="col-loc">Location</th>
                    <th class="col-type">HC Type</th>
                    @for (q of sizingQuarters; track q) {
                      <th class="col-q">{{ q }}</th>
                    }
                    <th class="col-total">Total</th>
                  </tr>
                </thead>
                <tbody>
                  @for (row of sizingFilteredRows; track row.fn) {
                    <tr>
                      <td class="col-team">{{ row.team }}</td>
                      <td class="col-fn">{{ row.fn }}</td>
                      <td class="col-loc">{{ row.location }}</td>
                      <td class="col-type">
                        <span class="type-dot" [style.background]="row.hcType === 'Incremental - CONT' ? '#1565c0' : '#4caf50'"></span>
                        {{ row.hcType }}
                      </td>
                      @for (q of sizingQuarters; track q) {
                        <td class="col-q" [class.has-val]="(row.hc[q] || 0) > 0"
                          [style.background]="getCellBg(row.hc[q] || 0, sizingQMax)">
                          {{ getCellValue(row, q) }}
                        </td>
                      }
                      <td class="col-total">{{ getRowTotal(row) }}</td>
                    </tr>
                  }
                </tbody>
                <tfoot>
                  <tr class="total-row">
                    <td colspan="4"><strong>Total</strong></td>
                    @for (q of sizingQuarters; track q) {
                      <td class="col-q"><strong>{{ getSizingQNumeric(q) > 0 ? getSizingQValue(q) : '—' }}</strong></td>
                    }
                    <td class="col-total"><strong>{{ sizingMetric === 'cost' ? sizingTotalCost : sizingMetric === 'peak' ? sizingPeakHC : sizingTotalHC }}</strong></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          <!-- PBI reference screenshot pushed to bottom -->
          <div class="pbi-ref">
            <div class="pbi-ref-label">
              <mat-icon style="font-size:16px;width:16px;height:16px">bar_chart</mat-icon>
              Power BI Reference View
            </div>
            <img src="powerbi-sizing.png" alt="Power BI Sizing Reference" class="pbi-screenshot-sm" />
          </div>

        </div>
      }

      @if (viewType === 'gap') {
        <div class="gap-view">

          <!-- KPI tiles — Sized: 137.4, Allocated: 124.3, Gap: -13.1, 4 projects all understaffed -->
          <div class="gap-kpi-bar">
            <div class="gap-kpi-tile">
              <span class="kpi-val">137.4</span>
              <span class="kpi-label">Total Sized HC</span>
            </div>
            <div class="gap-kpi-tile">
              <span class="kpi-val">124.3</span>
              <span class="kpi-label">Total Allocated HC</span>
            </div>
            <div class="gap-kpi-tile red">
              <span class="kpi-val">-13.1</span>
              <span class="kpi-label">Total Gap</span>
            </div>
            <div class="gap-kpi-tile amber">
              <span class="kpi-val">4</span>
              <span class="kpi-label">Understaffed Projects</span>
            </div>
            <div class="gap-kpi-tile green">
              <span class="kpi-val">0</span>
              <span class="kpi-label">Fully Staffed</span>
            </div>
          </div>

          <!-- Bar chart summary -->
          <div class="gap-chart-panel">
            <div class="gap-chart-title">Sized vs Allocated HC by Project</div>
            <div class="gap-chart-body">
              @for (proj of gapChartData; track proj.name) {
                <div class="gap-chart-row">
                  <span class="gap-chart-label">{{ proj.name }}</span>
                  <div class="gap-chart-bars">
                    <div class="gap-bar sized" [style.width.%]="proj.sizedPct" [matTooltip]="'Sized: ' + proj.sized">
                      <span>{{ proj.sized }}</span>
                    </div>
                    <div class="gap-bar allocated" [style.width.%]="proj.allocPct" [matTooltip]="'Allocated: ' + proj.alloc">
                      <span>{{ proj.alloc }}</span>
                    </div>
                  </div>
                  <span class="gap-chart-gap" [class.negative]="proj.gap < 0">{{ proj.gap > 0 ? '+' : '' }}{{ proj.gap }}</span>
                </div>
              }
              <div class="gap-chart-legend">
                <span><span class="legend-dot" style="background:#1a1a2e"></span> Sized HC</span>
                <span><span class="legend-dot" style="background:#4caf50"></span> Allocated HC</span>
              </div>
            </div>
          </div>

          <!-- Detail matrix table -->
          <div class="gap-matrix">
            <div class="gap-matrix-title">Gap Details</div>
            <table class="gap-table">
              <thead>
                <tr>
                  <th class="proj-th">Project</th>
                  <th>Location</th>
                  <th>HC Type</th>
                  <th>Q2 FY26</th>
                  <th>Q3 FY26</th>
                  <th>Q4 FY26</th>
                  <th>Q1 FY27</th>
                  <th>Q2 FY27</th>
                  <th>Total Gap</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                @for (proj of gapProjectGroups; track proj.name) {
                  <!-- Aggregate row -->
                  <tr class="gap-agg-row" (click)="toggleGapProject(proj.name)">
                    <td class="proj-cell">
                      <span class="gap-expand-btn">
                        <mat-icon>{{ expandedGapProjects.has(proj.name) ? 'expand_less' : 'expand_more' }}</mat-icon>
                      </span>
                      {{ proj.name }}
                    </td>
                    <td class="loc-cell agg-all">All Locations</td>
                    <td><span class="hc-type-chip">All Types</span></td>
                    @for (q of gapQuarters; track q) {
                      <td class="num-cell">
                        @if (proj.totalByQ[q] !== 0) {
                          <span class="gap-cell-val" [class.neg]="proj.totalByQ[q] < 0" [class.pos]="proj.totalByQ[q] > 0">
                            {{ proj.totalByQ[q] > 0 ? '+' : '' }}{{ proj.totalByQ[q] }}
                          </span>
                        } @else {
                          <span class="gap-zero">—</span>
                        }
                      </td>
                    }
                    <td class="num-cell total-gap" [class.neg]="proj.totalGap < 0" [class.pos]="proj.totalGap > 0">
                      {{ proj.totalGap > 0 ? '+' : '' }}{{ proj.totalGap }}
                    </td>
                    <td>
                      <span class="gap-status-chip"
                        [class.chip-under]="proj.totalGap < 0"
                        [class.chip-ok]="proj.totalGap === 0"
                        [class.chip-over]="proj.totalGap > 0">
                        {{ proj.totalGap < 0 ? 'UNDERSTAFFED' : proj.totalGap === 0 ? 'STAFFED' : 'OVERSTAFFED' }}
                      </span>
                    </td>
                  </tr>
                  <!-- Expanded breakdown rows -->
                  @if (expandedGapProjects.has(proj.name)) {
                    @for (row of proj.rows; track row.id) {
                      <tr class="gap-detail-row">
                        <td class="proj-cell detail-indent"></td>
                        <td class="loc-cell">{{ row.location }}</td>
                        <td><span class="hc-type-chip">{{ row.hcType }}</span></td>
                        @for (q of gapQuarters; track q) {
                          <td class="num-cell">
                            @if (row.gaps[q] !== 0) {
                              <span class="gap-cell-val" [class.neg]="row.gaps[q] < 0" [class.pos]="row.gaps[q] > 0">
                                {{ row.gaps[q] > 0 ? '+' : '' }}{{ row.gaps[q] }}
                              </span>
                            } @else {
                              <span class="gap-zero">—</span>
                            }
                          </td>
                        }
                        <td class="num-cell total-gap" [class.neg]="row.totalGap < 0" [class.pos]="row.totalGap > 0">
                          {{ row.totalGap > 0 ? '+' : '' }}{{ row.totalGap }}
                        </td>
                        <td>
                          <span class="gap-status-chip"
                            [class.chip-under]="row.totalGap < 0"
                            [class.chip-ok]="row.totalGap === 0"
                            [class.chip-over]="row.totalGap > 0">
                            {{ row.totalGap < 0 ? 'UNDERSTAFFED' : row.totalGap === 0 ? 'STAFFED' : 'OVERSTAFFED' }}
                          </span>
                        </td>
                      </tr>
                    }
                  }
                }
              </tbody>
            </table>
          </div>
        </div>
      }

      @if (viewType === 'allocation') {
        <div class="alloc-view">

          <!-- KPI tiles: 8 engineers, 35 total HC, cost derived from detail rows -->
          <div class="gap-kpi-bar">
            <div class="gap-kpi-tile">
              <span class="kpi-val">8</span>
              <span class="kpi-label">People Allocated</span>
            </div>
            <div class="gap-kpi-tile">
              <span class="kpi-val">35.0</span>
              <span class="kpi-label">Total Allocated HC</span>
            </div>
            <div class="gap-kpi-tile green">
              <span class="kpi-val">$416K</span>
              <span class="kpi-label">Total Allocated Cost</span>
            </div>
            <div class="gap-kpi-tile amber">
              <span class="kpi-val">4</span>
              <span class="kpi-label">Projects Staffed</span>
            </div>
          </div>

          <!-- Bar chart — switches with toggle -->
          <div class="gap-chart-panel">
            <div class="gap-chart-title">
              {{ allocView === 'project' ? 'Allocated HC by Project (stacked by person)' : 'Allocated HC by Person (across all projects)' }}
            </div>
            <div class="gap-chart-body">
              @if (allocView === 'project') {
                @for (proj of allocChartData; track proj.name) {
                  <div class="gap-chart-row alloc-quarterly-row">
                    <span class="gap-chart-label">{{ proj.name }}</span>
                    <div class="alloc-quarterly-bars">
                      @for (q of allocQuarters; track q) {
                        <div class="alloc-q-col">
                          <span class="alloc-q-val">{{ getProjectQTotal(proj.name, q) || '' }}</span>
                          <div class="alloc-q-bar-outer">
                            <div class="alloc-q-bar-inner"
                              [style.height.%]="getProjectQPct(proj.name, q)"
                              [style.background]="proj.segments[0]?.color || '#1a1a2e'"
                              [matTooltip]="proj.name + ' · ' + q + ': ' + getProjectQTotal(proj.name, q) + ' HC'">
                            </div>
                          </div>
                          <span class="alloc-q-label">{{ q }}</span>
                        </div>
                      }
                    </div>
                  </div>
                }
              }
              @if (allocView === 'person') {
                @for (person of allocPersonGroups; track person.name) {
                  <div class="gap-chart-row alloc-quarterly-row">
                    <span class="gap-chart-label">
                      <span class="person-avatar" [style.background]="person.color" style="display:inline-flex;width:18px;height:18px;font-size:10px;margin-right:4px;border-radius:50%;align-items:center;justify-content:center;color:white;font-weight:700;">{{ person.name.charAt(0) }}</span>
                      {{ person.name }}
                    </span>
                    <div class="alloc-quarterly-bars">
                      @for (q of allocQuarters; track q) {
                        <div class="alloc-q-col">
                          <span class="alloc-q-val">{{ getPersonQTotal(person.name, q) || '' }}</span>
                          <div class="alloc-q-bar-outer">
                            <div class="alloc-q-bar-inner"
                              [style.height.%]="getPersonQPct(person.name, q)"
                              [style.background]="person.color"
                              [matTooltip]="person.name + ' · ' + q + ': ' + getPersonQTotal(person.name, q) + ' HC'">
                            </div>
                          </div>
                          <span class="alloc-q-label">{{ q }}</span>
                        </div>
                      }
                    </div>
                  </div>
                }
              }
            </div>
          </div>

          <!-- Toggle + table -->
          <div class="gap-matrix">
            <div class="alloc-table-header">
              <span class="gap-matrix-title" style="font-size:15px; color:#1a1a2e;">Allocation Details</span>
              <div class="alloc-toggle">
                <button class="toggle-btn" [class.toggle-active]="allocView === 'project'" (click)="allocView = 'project'">
                  <mat-icon>folder</mat-icon> By Project
                </button>
                <button class="toggle-btn" [class.toggle-active]="allocView === 'person'" (click)="allocView = 'person'">
                  <mat-icon>person</mat-icon> By Person
                </button>
              </div>
            </div>

            <!-- PROJECT VIEW -->
            @if (allocView === 'project') {
              <table class="gap-table">
                <thead>
                  <tr>
                    <th class="proj-th">Project</th>
                    <th>Q2 FY26</th><th>Q3 FY26</th><th>Q4 FY26</th><th>Q1 FY27</th><th>Q2 FY27</th>
                    <th>Total HC</th><th>Est. Cost</th>
                  </tr>
                </thead>
                <tbody>
                  @for (proj of allocProjectGroups; track proj.name) {
                    <tr class="gap-agg-row" (click)="toggleAllocProject(proj.name)">
                      <td class="proj-cell">
                        <span class="gap-expand-btn"><mat-icon>{{ expandedAllocProjects.has(proj.name) ? 'expand_less' : 'expand_more' }}</mat-icon></span>
                        {{ proj.name }}
                        <span class="proj-people-count">{{ proj.rows.length }} people</span>
                      </td>
                      @for (q of allocQuarters; track q) {
                        <td class="num-cell alloc-num">{{ proj.totalByQ[q] ? proj.totalByQ[q] : '—' }}</td>
                      }
                      <td class="num-cell alloc-total">{{ proj.totalHC }}</td>
                      <td class="num-cell alloc-cost">{{ proj.totalCost }}</td>
                    </tr>
                    @if (expandedAllocProjects.has(proj.name)) {
                      @for (row of proj.rows; track row.person) {
                        <tr class="gap-detail-row">
                          <td class="proj-cell detail-indent-cell">
                            <span class="person-avatar" [style.background]="row.color">{{ row.person.charAt(0) }}</span>
                            {{ row.person }}
                            <span class="role-chip">{{ row.role }}</span>
                            <span class="loc-text">{{ row.location }}</span>
                          </td>
                          @for (q of allocQuarters; track q) {
                            <td class="num-cell alloc-num">
                              @if (row.hc[q]) {
                                <div class="alloc-cell-bar">
                                  <div class="alloc-cell-fill" [style.width.%]="row.hc[q] * 100" [style.background]="row.color + 'aa'"></div>
                                  <span>{{ row.hc[q] }}</span>
                                </div>
                              } @else { <span class="gap-zero">—</span> }
                            </td>
                          }
                          <td class="num-cell alloc-total">{{ row.totalHC }}</td>
                          <td class="num-cell alloc-cost">{{ row.cost }}</td>
                        </tr>
                      }
                    }
                  }
                </tbody>
              </table>
            }

            <!-- PERSON VIEW -->
            @if (allocView === 'person') {
              <table class="gap-table">
                <thead>
                  <tr>
                    <th class="proj-th">Person</th>
                    <th>Q2 FY26</th><th>Q3 FY26</th><th>Q4 FY26</th><th>Q1 FY27</th><th>Q2 FY27</th>
                    <th>Total HC</th><th>Est. Cost</th>
                  </tr>
                </thead>
                <tbody>
                  @for (person of allocPersonGroups; track person.name) {
                    <tr class="gap-agg-row" (click)="toggleAllocPerson(person.name)">
                      <td class="proj-cell">
                        <span class="gap-expand-btn"><mat-icon>{{ expandedAllocPersons.has(person.name) ? 'expand_less' : 'expand_more' }}</mat-icon></span>
                        <span class="person-avatar" [style.background]="person.color">{{ person.name.charAt(0) }}</span>
                        {{ person.name }}
                        <span class="proj-people-count">{{ person.projects.length }} project{{ person.projects.length > 1 ? 's' : '' }}</span>
                      </td>
                      @for (q of allocQuarters; track q) {
                        <td class="num-cell alloc-num" [class.over-alloc]="person.totalByQ[q] > 1">
                          {{ person.totalByQ[q] ? person.totalByQ[q] : '—' }}
                          @if (person.totalByQ[q] > 1) { <mat-icon class="warn-icon">warning</mat-icon> }
                        </td>
                      }
                      <td class="num-cell alloc-total">{{ person.totalHC }}</td>
                      <td class="num-cell alloc-cost">{{ person.totalCost }}</td>
                    </tr>
                    @if (expandedAllocPersons.has(person.name)) {
                      @for (proj of person.projects; track proj.project) {
                        <tr class="gap-detail-row">
                          <td class="proj-cell detail-indent-cell">
                            <span class="proj-dot-small" [style.background]="proj.projColor"></span>
                            {{ proj.project }}
                            <span class="role-chip">{{ proj.role }}</span>
                          </td>
                          @for (q of allocQuarters; track q) {
                            <td class="num-cell alloc-num">
                              @if (proj.hc[q]) {
                                <div class="alloc-cell-bar">
                                  <div class="alloc-cell-fill" [style.width.%]="proj.hc[q] * 100" [style.background]="proj.projColor + 'aa'"></div>
                                  <span>{{ proj.hc[q] }}</span>
                                </div>
                              } @else { <span class="gap-zero">—</span> }
                            </td>
                          }
                          <td class="num-cell alloc-total">{{ proj.totalHC }}</td>
                          <td class="num-cell alloc-cost">{{ proj.cost }}</td>
                        </tr>
                      }
                    }
                  }
                </tbody>
              </table>
            }
          </div>
        </div>
      }
    </div>
  `,
  styles: [`
    .views-page { padding: 0; }
    .page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
    .header-left { display: flex; align-items: center; gap: 14px; }
    .view-icon { font-size: 32px; width: 32px; height: 32px; color: #ED1C24; }
    .page-header h2 { margin: 0; font-size: 22px; font-weight: 500; }
    .subtitle { margin: 2px 0 0; color: #666; font-size: 13px; }
    .header-actions { display: flex; gap: 8px; }
    .export-btn, .refresh-btn { font-size: 13px; }

    .slicer-bar { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 20px; background: #f8f9fa; padding: 12px 16px; border-radius: 8px; border: 1px solid #e8e8e8; }
    .slicer-field { width: 160px; }
    .slicer-field ::ng-deep .mat-mdc-form-field-subscript-wrapper { display: none; }

    .pbi-container { background: white; border: 1px solid #e0e0e0; border-radius: 8px; overflow: hidden; }
    .pbi-label { display: flex; align-items: center; gap: 8px; padding: 12px 16px; background: #1a1a2e; color: white; font-size: 13px; font-weight: 500; }
    .live-badge { background: #ED1C24; color: white; font-size: 10px; padding: 2px 8px; border-radius: 10px; margin-left: 8px; }
    .pbi-screenshot { width: 100%; display: block; }

    /* ── Sizing view ── */
    .sizing-view { display: flex; flex-direction: column; gap: 16px; }

    /* Bar chart card */
    .sizing-chart-card { background: white; border: 1px solid #e8e8e8; border-radius: 10px; padding: 16px 20px; }
    .sizing-chart-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; }
    .sizing-chart-title { font-size: 14px; font-weight: 600; color: #1a1a2e; }
    .metric-toggle { display: flex; border: 1px solid #e0e0e0; border-radius: 6px; overflow: hidden; }
    .metric-toggle button { padding: 5px 14px; font-size: 12px; border: none; background: white; cursor: pointer; color: #666; transition: all 0.15s; }
    .metric-toggle button.active { background: #1a1a2e; color: white; font-weight: 600; }
    .metric-toggle button:hover:not(.active) { background: #f5f5f5; }

    /* Bar chart */
    .sizing-bar-chart { display: flex; align-items: flex-end; gap: 6px; height: 160px; padding: 0 4px; border-bottom: 2px solid #eee; }
    .sbar-col { display: flex; flex-direction: column; align-items: center; flex: 1; height: 100%; justify-content: flex-end; gap: 4px; }
    .sbar-val { font-size: 11px; font-weight: 700; color: #1565c0; }
    .sbar-fill { width: 60%; background: linear-gradient(to top, #1565c0, #42a5f5); border-radius: 4px 4px 0 0; min-height: 4px; }
    .sbar-label { font-size: 9px; color: #888; white-space: nowrap; text-align: center; padding-top: 6px; }

    /* Matrix table card */
    .sizing-matrix-card { background: white; border: 1px solid #e8e8e8; border-radius: 10px; overflow: hidden; }
    .sizing-matrix-header { display: flex; justify-content: space-between; align-items: center; padding: 14px 18px; border-bottom: 1px solid #f0f0f0; }
    .hc-type-legend { display: flex; align-items: center; gap: 6px; font-size: 12px; color: #666; }
    .legend-dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
    .sizing-table-wrap { overflow-x: auto; }
    .sizing-matrix-table { width: 100%; border-collapse: collapse; font-size: 12px; min-width: 900px; }
    .sizing-matrix-table thead tr { background: #f8f9fa; }
    .sizing-matrix-table th { padding: 8px 10px; font-size: 11px; font-weight: 700; color: #555; white-space: nowrap; border-bottom: 2px solid #e0e0e0; text-align: center; }
    .sizing-matrix-table th.col-team, .sizing-matrix-table th.col-fn, .sizing-matrix-table th.col-loc, .sizing-matrix-table th.col-type { text-align: left; }
    .sizing-matrix-table td { padding: 6px 10px; border-bottom: 1px solid #f5f5f5; text-align: center; vertical-align: middle; }
    .col-team { text-align: left; font-size: 11px; color: #888; white-space: nowrap; min-width: 120px; }
    .col-fn { text-align: left; font-weight: 500; color: #1a1a2e; min-width: 200px; white-space: nowrap; }
    .col-loc { text-align: left; color: #666; white-space: nowrap; min-width: 130px; }
    .col-type { text-align: left; min-width: 150px; white-space: nowrap; }
    .type-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 5px; vertical-align: middle; }
    .col-q { min-width: 70px; font-size: 12px; }
    .col-total { min-width: 60px; font-weight: 700; color: #1a1a2e; background: #fffde7 !important; border-left: 2px solid #f9a825 !important; }
    .has-val { font-weight: 600; color: #1565c0; }
    .total-row td { background: #fffde7 !important; border-top: 2px solid #f9a825; padding: 8px 10px; font-size: 12px; }

    /* PBI reference at bottom */
    .pbi-ref { border: 1px solid #e8e8e8; border-radius: 10px; overflow: hidden; margin-top: 32px; }
    .pbi-ref-label { display: flex; align-items: center; gap: 8px; padding: 10px 16px; background: #f8f9fa; border-bottom: 1px solid #e8e8e8; font-size: 12px; color: #888; font-weight: 500; }
    .pbi-screenshot-sm { width: 100%; display: block; opacity: 0.85; }

    .placeholder-view { background: white; border: 1px solid #e0e0e0; border-radius: 8px; padding: 24px; }
    .placeholder-header { display: flex; align-items: flex-start; gap: 16px; margin-bottom: 24px; padding-bottom: 16px; border-bottom: 1px solid #eee; }
    .placeholder-header mat-icon { font-size: 40px; width: 40px; height: 40px; color: #ED1C24; margin-top: 4px; }
    .placeholder-header h3 { margin: 0 0 4px; font-size: 18px; }
    .placeholder-header p { margin: 0; color: #666; font-size: 13px; }

    /* Gap view — KPI tiles */
    .gap-view { display: flex; flex-direction: column; gap: 16px; }
    .gap-kpi-bar { display: flex; gap: 12px; flex-wrap: wrap; }
    .gap-kpi-tile { background: white; border: 1px solid #e0e0e0; border-radius: 8px; padding: 14px 20px; min-width: 120px; border-left: 4px solid #1a1a2e; }
    .gap-kpi-tile.red { border-left-color: #ED1C24; }
    .gap-kpi-tile.amber { border-left-color: #ff9800; }
    .gap-kpi-tile.green { border-left-color: #4caf50; }
    .kpi-val { display: block; font-size: 26px; font-weight: 700; color: #1a1a2e; }
    .gap-kpi-tile.red .kpi-val { color: #ED1C24; }
    .gap-kpi-tile.amber .kpi-val { color: #e65100; }
    .gap-kpi-tile.green .kpi-val { color: #2e7d32; }
    .kpi-label { display: block; font-size: 11px; color: #888; text-transform: uppercase; letter-spacing: 0.5px; margin-top: 4px; }

    /* Gap chart */
    .gap-chart-panel { background: white; border: 1px solid #e0e0e0; border-radius: 8px; padding: 16px 20px; }
    .gap-chart-title { font-size: 13px; font-weight: 600; color: #333; margin-bottom: 14px; }
    .gap-chart-row { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; font-size: 12px; }
    .gap-chart-label { width: 180px; flex-shrink: 0; color: #555; text-align: right; font-size: 12px; }
    .gap-chart-bars { flex: 1; display: flex; flex-direction: column; gap: 3px; }
    .gap-bar { height: 16px; border-radius: 3px; display: flex; align-items: center; padding: 0 6px; font-size: 10px; color: white; font-weight: 600; min-width: 20px; transition: width 0.3s; }
    .gap-bar.sized { background: #1a1a2e; }
    .gap-bar.allocated { background: #4caf50; }
    .gap-chart-gap { width: 40px; flex-shrink: 0; font-size: 12px; font-weight: 700; text-align: right; }
    .gap-chart-gap.negative { color: #ED1C24; }
    .gap-chart-legend { display: flex; gap: 16px; margin-top: 10px; font-size: 11px; color: #666; }
    .legend-dot { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 4px; }

    /* Gap matrix table */
    .gap-matrix { background: white; border: 1px solid #e0e0e0; border-radius: 8px; overflow: hidden; }
    .gap-matrix-title { padding: 12px 16px; font-size: 15px; font-weight: 600; color: #1a1a2e; border-bottom: 1px solid #f0f0f0; background: white; }
    .gap-table { width: 100%; border-collapse: collapse; font-size: 12px; }
    .gap-table th { background: #f5f5f5; padding: 8px 12px; text-align: left; font-weight: 600; color: #555; border-bottom: 2px solid #e0e0e0; font-size: 11px; text-transform: uppercase; letter-spacing: 0.3px; }
    .gap-table td { padding: 9px 12px; border-bottom: 1px solid #f5f5f5; }
    /* Aggregate rows */
    .gap-agg-row { cursor: pointer; background: #f8f9fa; border-bottom: 2px solid #e8e8e8; }
    .gap-agg-row:hover td { background: #f0f2ff; }
    .gap-agg-row td { padding: 10px 12px; font-weight: 600; }
    .gap-expand-btn { display: inline-flex; align-items: center; vertical-align: middle; margin-right: 4px; }
    .gap-expand-btn mat-icon { font-size: 16px; width: 16px; height: 16px; color: #888; }
    .agg-all { color: #aaa !important; font-style: italic; font-weight: 400 !important; }
    .proj-th { min-width: 180px; }
    /* Detail rows */
    .gap-detail-row { background: #fafbff; border-bottom: 1px solid #f5f5f5; }
    .gap-detail-row td { padding: 7px 12px; }
    .detail-indent { width: 20px; }
    .proj-cell { font-weight: 600; color: #1a1a2e; }
    .loc-cell { color: #666; }
    .num-cell { text-align: center; }
    .hc-type-chip { background: #f0f0f0; padding: 2px 6px; border-radius: 4px; font-size: 10px; color: #555; }
    .gap-cell-val { font-weight: 700; padding: 2px 6px; border-radius: 4px; }
    .gap-cell-val.neg { color: #c62828; background: #ffebee; }
    .gap-cell-val.pos { color: #2e7d32; background: #e8f5e9; }
    .gap-zero { color: #ccc; }
    .total-gap { font-weight: 700; font-size: 13px; }
    .total-gap.neg { color: #ED1C24; }
    .total-gap.pos { color: #2e7d32; }
    .row-under { background: #fff8f8; }
    .row-ok { background: #f8fff8; }
    .row-over { background: #f8fff8; }
    .gap-status-chip { padding: 3px 8px; border-radius: 10px; font-size: 10px; font-weight: 700; }
    .chip-under { background: #ffebee; color: #c62828; }
    .chip-ok { background: #e8f5e9; color: #2e7d32; }
    .chip-over { background: #fff3e0; color: #e65100; }

    .gap-sample, .alloc-sample { font-size: 13px; }
    .gap-row, .alloc-row { display: grid; padding: 8px 12px; border-bottom: 1px solid #f0f0f0; align-items: center; }
    .gap-row { grid-template-columns: 2fr 1fr 1fr 1fr 1fr 1fr 1.5fr; }
    .alloc-row { grid-template-columns: 1.5fr 1.5fr 1fr 1fr 1fr 1fr 1fr 1fr; }
    .header-row { background: #f5f5f5; font-weight: 600; color: #444; border-radius: 6px 6px 0 0; }
    .understaffed { background: #fff3f3; }
    .staffed { background: #f3fff6; }
    .overstaffed { background: #fff8f0; }
    .gap-val { font-weight: 600; }
    .status-chip { padding: 3px 8px; border-radius: 10px; font-size: 11px; font-weight: 600; text-align: center; }
    .gap-under { background: #ffebee; color: #c62828; }
    .gap-ok { background: #e8f5e9; color: #2e7d32; }
    .gap-over { background: #fff3e0; color: #e65100; }
    .person-name { font-weight: 500; }
    .role-tag { color: #666; font-size: 12px; }
    .cost-val { font-weight: 600; color: #1a1a2e; }

    .phase-badge { margin-top: 20px; text-align: center; color: #999; font-size: 12px; font-style: italic; padding: 12px; background: #f8f9fa; border-radius: 6px; }

    /* Allocation view */
    .alloc-view { display: flex; flex-direction: column; gap: 16px; }
    .alloc-bar-wrap { display: flex; height: 18px; border-radius: 3px; overflow: hidden; flex: 1; min-width: 200px; background: #f0f0f0; }
    .alloc-seg { height: 100%; transition: width 0.3s; flex-shrink: 0; }
    .alloc-view .gap-chart-bars { flex-direction: row; align-items: center; gap: 0; }
    .alloc-legend { flex-wrap: wrap; row-gap: 6px; }
    .proj-people-count { font-size: 11px; color: #999; font-weight: 400; margin-left: 8px; }
    .alloc-num { text-align: center; font-size: 12px; color: #444; }
    .alloc-total { font-weight: 700; color: #1a1a2e; text-align: center; }
    .alloc-cost { color: #2e7d32; font-weight: 600; text-align: right; }
    .person-name-cell { display: flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 500; }
    .person-avatar { width: 22px; height: 22px; border-radius: 50%; color: white; font-size: 11px; font-weight: 700; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
    .role-chip { background: #f0f0f0; padding: 2px 8px; border-radius: 10px; font-size: 10px; color: #555; }
    .alloc-cell-bar { display: flex; align-items: center; gap: 4px; }
    .alloc-cell-fill { height: 10px; border-radius: 2px; min-width: 3px; max-width: 40px; }

    /* Quarterly bar chart in project view */
    .alloc-quarterly-row { align-items: flex-end !important; }
    .alloc-quarterly-bars { display: flex; gap: 6px; flex: 1; align-items: flex-end; }
    .alloc-q-col { display: flex; flex-direction: column; align-items: center; gap: 2px; flex: 1; }
    .alloc-q-bar-outer { width: 100%; height: 60px; background: #f0f0f0; border-radius: 3px 3px 0 0; display: flex; align-items: flex-end; overflow: hidden; }
    .alloc-q-bar-inner { width: 100%; border-radius: 3px 3px 0 0; transition: height 0.3s; min-height: 2px; }
    .alloc-q-label { font-size: 9px; color: #999; text-align: center; white-space: nowrap; }
    .alloc-q-val { font-size: 10px; font-weight: 700; color: #555; min-height: 14px; }

    /* Toggle button */
    .alloc-table-header { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; border-bottom: 1px solid #f0f0f0; }
    .alloc-toggle { display: flex; gap: 0; border: 1px solid #e0e0e0; border-radius: 6px; overflow: hidden; }
    .toggle-btn { display: flex; align-items: center; gap: 6px; padding: 6px 14px; border: none; background: white; cursor: pointer; font-size: 13px; color: #666; transition: background 0.15s; }
    .toggle-btn mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .toggle-btn:first-child { border-right: 1px solid #e0e0e0; }
    .toggle-active { background: #1a1a2e !important; color: white !important; }

    /* Person view extras */
    .detail-indent-cell { display: flex; align-items: center; gap: 8px; padding-left: 36px !important; font-size: 12px; }
    .proj-dot-small { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
    .loc-text { font-size: 10px; color: #aaa; margin-left: 4px; }
    .over-alloc { background: #fff3e0 !important; color: #e65100 !important; font-weight: 700; }
    .warn-icon { font-size: 12px; width: 12px; height: 12px; color: #ff9800; vertical-align: middle; }
  `]
})
export class ViewsComponent {
  viewType = 'sizing';
  filters: any = { bu: '', project: '', fy: '', hcType: '', location: '', status: '' };

  // ── Sizing view ──
  sizingMetric: 'hc' | 'peak' | 'cost' = 'hc';

  sizingQuarters = ['Q2 FY26','Q3 FY26','Q4 FY26','Q1 FY27','Q2 FY27','Q3 FY27','Q4 FY27','Q1 FY28','Q2 FY28'];

  // All function rows across all 4 projects (mirrors Gantt data)
  sizingAllRows: { project: string; team: string; fn: string; location: string; hcType: string; hc: Record<string, number> }[] = [
    // ── Eris v2.0 ──
    { project: 'Eris v2.0',              team: 'SPG_Platform_Linux', fn: 'Linux - IQE Support',         location: 'China Shanghai',  hcType: 'Incremental - CONT', hc: { 'Q2 FY27': 2, 'Q3 FY27': 3, 'Q4 FY27': 2, 'Q1 FY28': 1 } },
    { project: 'Eris v2.0',              team: 'SPG_Platform_Linux', fn: 'Linux Solution Architect',     location: 'China Shanghai',  hcType: 'Incremental - CONT', hc: { 'Q4 FY26': 0.5, 'Q1 FY27': 1, 'Q2 FY27': 2, 'Q3 FY27': 2 } },
    { project: 'Eris v2.0',              team: 'SPG_Platform_Linux', fn: 'ROCm on APU',                  location: 'India Bangalore', hcType: 'Incremental - CONT', hc: { 'Q2 FY27': 2, 'Q3 FY27': 3, 'Q4 FY27': 2, 'Q1 FY28': 1 } },
    { project: 'Eris v2.0',              team: 'SPG_Platform_Linux', fn: 'Program/Architecture IP mgmt', location: 'India Hyderabad', hcType: 'Incremental - CONT', hc: { 'Q2 FY26': 0.5, 'Q3 FY26': 1, 'Q4 FY26': 1.5, 'Q1 FY27': 2 } },
    { project: 'Eris v2.0',              team: 'SPG_Platform_Linux', fn: 'Linux BringUp and PreSI',      location: 'India Bangalore', hcType: 'Existing - FTE',     hc: { 'Q3 FY26': 0.5, 'Q4 FY26': 1, 'Q1 FY27': 1, 'Q2 FY27': 1 } },
    // ── KRK1 New Features v1.0 ──
    { project: 'KRK1 New Features v1.0', team: 'SPG_Platform_Linux', fn: 'Unified RAS SW model',         location: 'China Shanghai',  hcType: 'Incremental - CONT', hc: { 'Q3 FY26': 1, 'Q4 FY26': 2, 'Q1 FY27': 3, 'Q2 FY27': 3 } },
    { project: 'KRK1 New Features v1.0', team: 'SPG_Platform_Linux', fn: 'Linux BringUp PreSI',          location: 'India Bangalore', hcType: 'Existing - FTE',     hc: { 'Q4 FY26': 1, 'Q1 FY27': 2, 'Q2 FY27': 2, 'Q3 FY27': 1 } },
    { project: 'KRK1 New Features v1.0', team: 'SPG_Platform_Linux', fn: 'Program Management',           location: 'India Hyderabad', hcType: 'Incremental - CONT', hc: { 'Q2 FY26': 1, 'Q3 FY26': 2, 'Q4 FY26': 3, 'Q1 FY27': 4 } },
    { project: 'KRK1 New Features v1.0', team: 'SPG_Platform_Linux', fn: 'ROCm on APU',                  location: 'India Bangalore', hcType: 'Incremental - CONT', hc: { 'Q2 FY26': 0.5, 'Q3 FY26': 1, 'Q1 FY27': 2, 'Q2 FY27': 2 } },
    // ── Android EAP v1.3 ──
    { project: 'Android EAP v1.3',       team: 'SPG_Platform_Linux', fn: 'UMR-(TimW/Pierre-Eric)',        location: 'Canada',          hcType: 'Existing - FTE',     hc: { 'Q2 FY26': 0.5, 'Q3 FY26': 1, 'Q4 FY26': 2, 'Q1 FY27': 3 } },
    { project: 'Android EAP v1.3',       team: 'SPG_Platform_Linux', fn: 'Linux BPI-(TimW/Slava)',        location: 'Canada',          hcType: 'Existing - FTE',     hc: { 'Q2 FY26': 0.5, 'Q3 FY26': 1.5, 'Q4 FY26': 3, 'Q1 FY27': 5 } },
    { project: 'Android EAP v1.3',       team: 'SPG_Platform_Linux', fn: 'Perfetto-(RayH/Julian)',        location: 'Canada',          hcType: 'Incremental - CONT', hc: { 'Q3 FY26': 1, 'Q4 FY26': 2, 'Q1 FY27': 4, 'Q2 FY27': 4 } },
    { project: 'Android EAP v1.3',       team: 'SPG_Platform_Linux', fn: 'Program/Architecture',         location: 'India Hyderabad', hcType: 'Incremental - CONT', hc: { 'Q4 FY26': 1, 'Q1 FY27': 3, 'Q2 FY27': 5, 'Q3 FY27': 4 } },
    { project: 'Android EAP v1.3',       team: 'SPG_Platform_Linux', fn: 'Linux- Compositor',            location: 'India Hyderabad', hcType: 'Existing - FTE',     hc: { 'Q1 FY27': 2, 'Q2 FY27': 4, 'Q3 FY27': 5, 'Q4 FY27': 3 } },
    { project: 'Android EAP v1.3',       team: 'SPG_Platform_Linux', fn: 'System logging tool',          location: 'Canada',          hcType: 'Existing - FTE',     hc: { 'Q2 FY26': 0.5, 'Q3 FY26': 0.5, 'Q4 FY26': 1, 'Q1 FY27': 2 } },
    { project: 'Android EAP v1.3',       team: 'SPG_Platform_Linux', fn: 'ROCm on APU',                  location: 'India Bangalore', hcType: 'Incremental - CONT', hc: { 'Q2 FY27': 1, 'Q3 FY27': 2, 'Q4 FY27': 3 } },
    // ── ECARX SW Tools CCB ──
    { project: 'ECARX SW Tools CCB',     team: 'SPG_Platform_Linux', fn: 'UMR-(RayH/Jiqian)',            location: 'Canada',          hcType: 'Existing - FTE',     hc: { 'Q2 FY26': 0.5, 'Q3 FY26': 1, 'Q4 FY26': 2 } },
    { project: 'ECARX SW Tools CCB',     team: 'SPG_Platform_Linux', fn: 'System logging tool',          location: 'Canada',          hcType: 'Existing - FTE',     hc: { 'Q3 FY26': 1, 'Q4 FY26': 3, 'Q1 FY27': 3 } },
    { project: 'ECARX SW Tools CCB',     team: 'SPG_Platform_Linux', fn: 'Linux BPI',                    location: 'India Bangalore', hcType: 'Incremental - CONT', hc: { 'Q4 FY26': 2, 'Q1 FY27': 2, 'Q2 FY27': 2 } },
    { project: 'ECARX SW Tools CCB',     team: 'SPG_Platform_Linux', fn: 'Perfetto',                     location: 'Canada',          hcType: 'Existing - FTE',     hc: { 'Q2 FY26': 0.5, 'Q3 FY26': 1, 'Q4 FY26': 1 } },
    { project: 'ECARX SW Tools CCB',     team: 'SPG_Platform_Linux', fn: 'Linux- Compositor',            location: 'India Hyderabad', hcType: 'Incremental - CONT', hc: { 'Q3 FY26': 1, 'Q4 FY26': 1, 'Q2 FY27': 1 } },
  ];

  get sizingFilteredRows() {
    return this.sizingAllRows.filter(r => {
      const matchProject  = !this.filters.project  || r.project  === this.filters.project;
      const matchHcType   = !this.filters.hcType   || r.hcType   === this.filters.hcType;
      const matchLocation = !this.filters.location || r.location === this.filters.location;
      return matchProject && matchHcType && matchLocation;
    });
  }

  get sizingTotalHC(): number {
    return Math.round(this.sizingFilteredRows.reduce((s, r) =>
      s + this.sizingQuarters.reduce((qs, q) => qs + (r.hc[q] || 0), 0), 0) * 10) / 10;
  }

  get sizingPeakHC(): number {
    return Math.max(...this.sizingQuarters.map(q => this.getSizingQTotal(q)), 0);
  }

  get sizingTotalCost(): string {
    const rateMap: Record<string, number> = {
      'Canada': 30138, 'US': 30138,
      'India Bangalore': 12203, 'India Hyderabad': 12203,
      'China Shanghai': 27275, 'Global': 31000, 'Taiwan': 24975
    };
    const total = this.sizingFilteredRows.reduce((s, r) => {
      const rate = rateMap[r.location] || 20000;
      const hcSum = this.sizingQuarters.reduce((qs, q) => qs + (r.hc[q] || 0), 0);
      return s + hcSum * rate;
    }, 0);
    return '$' + Math.round(total / 1000) + 'K';
  }

  get sizingProjectCount(): number {
    return new Set(this.sizingFilteredRows.map(r => r.project)).size;
  }

  get sizingLocationCount(): number {
    return new Set(this.sizingFilteredRows.map(r => r.location)).size;
  }

  getSizingQTotal(q: string): number {
    return Math.round(this.sizingFilteredRows.reduce((s, r) => s + (r.hc[q] || 0), 0) * 10) / 10;
  }

  // Returns the chart value for a quarter based on the active metric
  getSizingQValue(q: string): number | string {
    if (this.sizingMetric === 'hc') {
      return this.getSizingQTotal(q);
    } else if (this.sizingMetric === 'peak') {
      // Peak = max single row value in this quarter
      const peak = Math.max(...this.sizingFilteredRows.map(r => r.hc[q] || 0), 0);
      return Math.round(peak * 10) / 10;
    } else {
      // Cost: sum HC * location rate for this quarter
      const rateMap: Record<string, number> = {
        'Canada': 30138, 'US': 30138,
        'India Bangalore': 12203, 'India Hyderabad': 12203,
        'China Shanghai': 27275, 'Global': 31000, 'Taiwan': 24975
      };
      const cost = this.sizingFilteredRows.reduce((s, r) => {
        return s + (r.hc[q] || 0) * (rateMap[r.location] || 20000);
      }, 0);
      return cost > 0 ? '$' + Math.round(cost / 1000) + 'K' : 0;
    }
  }

  getSizingQNumeric(q: string): number {
    if (this.sizingMetric === 'hc') {
      return this.getSizingQTotal(q);
    } else if (this.sizingMetric === 'peak') {
      return Math.max(...this.sizingFilteredRows.map(r => r.hc[q] || 0), 0);
    } else {
      const rateMap: Record<string, number> = {
        'Canada': 30138, 'US': 30138,
        'India Bangalore': 12203, 'India Hyderabad': 12203,
        'China Shanghai': 27275, 'Global': 31000, 'Taiwan': 24975
      };
      return this.sizingFilteredRows.reduce((s, r) => s + (r.hc[q] || 0) * (rateMap[r.location] || 20000), 0);
    }
  }

  get sizingChartMax(): number {
    return Math.max(...this.sizingQuarters.map(q => this.getSizingQNumeric(q)), 1);
  }

  get sizingQMax(): number {
    return Math.max(...this.sizingFilteredRows.flatMap(r =>
      this.sizingQuarters.map(q => r.hc[q] || 0)), 1);
  }

  getCellValue(row: { location: string; hc: Record<string, number> }, q: string): number | string {
    const hc = row.hc[q] || 0;
    if (hc === 0) return '—';

    if (this.sizingMetric === 'hc') {
      return hc;
    }

    if (this.sizingMetric === 'peak') {
      // Show only the peak value for each row (max HC across all quarters for that row)
      // In each cell, show HC only if this is the peak quarter for this row, otherwise blank
      const rowPeak = Math.max(...this.sizingQuarters.map(q2 => row.hc[q2] || 0));
      return hc === rowPeak ? hc : '—';
    }

    // Cost $ — multiply cell HC by location rate
    const rateMap: Record<string, number> = {
      'Canada': 30138, 'US': 30138,
      'India Bangalore': 12203, 'India Hyderabad': 12203,
      'China Shanghai': 27275, 'Global': 31000, 'Taiwan': 24975
    };
    const cost = hc * (rateMap[row.location] || 20000);
    return '$' + Math.round(cost / 1000) + 'K';
  }

  getRowTotal(row: { location: string; hc: Record<string, number> }): number | string {
    const rateMap: Record<string, number> = {
      'Canada': 30138, 'US': 30138,
      'India Bangalore': 12203, 'India Hyderabad': 12203,
      'China Shanghai': 27275, 'Global': 31000, 'Taiwan': 24975
    };
    if (this.sizingMetric === 'hc' || this.sizingMetric === 'peak') {
      return Math.round(this.sizingQuarters.reduce((s, q) => s + (row.hc[q] || 0), 0) * 10) / 10;
    } else {
      const cost = this.sizingQuarters.reduce((s, q) => s + (row.hc[q] || 0) * (rateMap[row.location] || 20000), 0);
      return cost > 0 ? '$' + Math.round(cost / 1000) + 'K' : '—';
    }
  }

  getCellBg(val: number, max: number): string {
    if (!val || val === 0) return '';
    const intensity = Math.round((val / max) * 180);
    return `rgba(21, 101, 192, ${0.08 + (val / max) * 0.55})`;
  }

  viewConfig: any = {
    sizing: { title: 'Sizing View', subtitle: 'Headcount sizing submissions by project, version, and quarter', icon: 'table_chart' },
    gap: { title: 'Gap Analysis View', subtitle: 'Sized vs allocated headcount — identify understaffed projects', icon: 'compare_arrows' },
    allocation: { title: 'Allocation View', subtitle: 'Named headcount assignments per project and month', icon: 'people' }
  }['sizing'];

  constructor(private route: ActivatedRoute) {
    this.buildGapGroups();
    this.route.data.subscribe(data => {
      this.viewType = data['viewType'] || 'sizing';
      this.viewConfig = {
        sizing: { title: 'Sizing View', subtitle: 'Headcount sizing submissions by project, version, and quarter', icon: 'table_chart' },
        gap: { title: 'Gap Analysis View', subtitle: 'Sized vs allocated headcount — identify understaffed projects', icon: 'compare_arrows' },
        allocation: { title: 'Allocation View', subtitle: 'Named headcount assignments per project and month', icon: 'people' }
      }[this.viewType] || this.viewConfig;
    });
  }

  gapQuarters = ['Q2 FY26', 'Q3 FY26', 'Q4 FY26', 'Q1 FY27', 'Q2 FY27'];
  expandedGapProjects = new Set<string>();
  gapProjectGroups: { name: string; rows: any[]; totalByQ: Record<string, number>; totalGap: number }[] = [];

  buildGapGroups() {
    const projectNames = [...new Set(this.gapMatrixData.map(r => r.project))];
    this.gapProjectGroups = projectNames.map(name => {
      const rows = this.gapMatrixData.filter(r => r.project === name);
      const totalByQ: Record<string, number> = {};
      this.gapQuarters.forEach(q => {
        totalByQ[q] = rows.reduce((sum, r) => sum + (r.gaps[q] || 0), 0);
      });
      const totalGap = rows.reduce((sum, r) => sum + r.totalGap, 0);
      return { name, rows, totalByQ, totalGap };
    });
  }

  toggleGapProject(name: string) {
    if (this.expandedGapProjects.has(name)) {
      this.expandedGapProjects.delete(name);
    } else {
      this.expandedGapProjects.add(name);
    }
    // Trigger re-render by spreading the set
    this.expandedGapProjects = new Set(this.expandedGapProjects);
  }

  gapSampleData = [
    { project: 'Android EAP v1.3', location: 'Canada', quarter: 'Q2 FY26', sized: 3.0, allocated: 2.5, gap: -0.5, status: 'UNDERSTAFFED' },
    { project: 'ECARX SW Tools CCB', location: 'India Bangalore', quarter: 'Q2 FY26', sized: 5.0, allocated: 5.0, gap: 0, status: 'FULLY STAFFED' },
  ];

  // Real DB sized HC kept as-is. Allocation adjusted to give realistic 10-15 HC total gap.
  // Eris: 55.5 sized → 51.5 alloc → gap -4.0
  // KRK1: 39.9 sized → 36.4 alloc → gap -3.5
  // Android: 22 sized → 18.7 alloc → gap -3.3
  // ECARX: 20 sized → 17.7 alloc → gap -2.3   Total gap: -13.1
  gapChartData = [
    { name: 'Eris v2.0',              sized: 55.5, alloc: 51.5, gap: -4.0, sizedPct: 100, allocPct: 93 },
    { name: 'KRK1 New Features v1.0', sized: 39.9, alloc: 36.4, gap: -3.5, sizedPct: 72,  allocPct: 66 },
    { name: 'Android EAP v1.3',       sized: 22,   alloc: 18.7, gap: -3.3, sizedPct: 40,  allocPct: 34 },
    { name: 'ECARX SW Tools CCB',     sized: 20,   alloc: 17.7, gap: -2.3, sizedPct: 36,  allocPct: 32 },
  ];

  // Realistic quarterly gaps — total gap per project: Eris -4.0, KRK1 -3.5, Android -3.3, ECARX -2.3
  // Sub-rows per location sum to project total. Small gaps reflect mostly-staffed but slightly short reality.
  gapMatrixData: { id: number; project: string; location: string; hcType: string; gaps: Record<string, number>; totalGap: number }[] = [
    // Eris v2.0 — total gap -4.0 across India Bangalore + China Shanghai
    { id: 1, project: 'Eris v2.0', location: 'India Bangalore', hcType: 'Existing - FTE',     gaps: { 'Q2 FY26': -0.5, 'Q3 FY26': -0.5, 'Q4 FY26': -0.5, 'Q1 FY27': -0.5, 'Q2 FY27': 0 }, totalGap: -2.0 },
    { id: 2, project: 'Eris v2.0', location: 'China Shanghai',  hcType: 'Incremental - CONT', gaps: { 'Q2 FY26': -0.5, 'Q3 FY26': -0.5, 'Q4 FY26': -0.5, 'Q1 FY27': -0.5, 'Q2 FY27': 0 }, totalGap: -2.0 },
    // KRK1 New Features v1.0 — total gap -3.5 across India Hyderabad + Canada
    { id: 3, project: 'KRK1 New Features v1.0', location: 'India Hyderabad', hcType: 'Existing - FTE',     gaps: { 'Q2 FY26': -0.5, 'Q3 FY26': -0.5, 'Q4 FY26': -0.5, 'Q1 FY27': -0.5, 'Q2 FY27': 0 }, totalGap: -2.0 },
    { id: 4, project: 'KRK1 New Features v1.0', location: 'Canada',          hcType: 'Incremental - CONT', gaps: { 'Q2 FY26': -0.5, 'Q3 FY26': -0.5, 'Q4 FY26': -0.5, 'Q1 FY27': 0,    'Q2 FY27': 0 }, totalGap: -1.5 },
    // Android EAP v1.3 — total gap -3.3 across Canada + India Hyderabad
    { id: 5, project: 'Android EAP v1.3', location: 'Canada',          hcType: 'Existing - FTE',     gaps: { 'Q2 FY26': -0.5, 'Q3 FY26': -1,   'Q4 FY26': -0.5, 'Q1 FY27': -0.5, 'Q2 FY27': 0 }, totalGap: -2.5 },
    { id: 6, project: 'Android EAP v1.3', location: 'India Hyderabad', hcType: 'Incremental - CONT', gaps: { 'Q2 FY26': 0,    'Q3 FY26': -0.5, 'Q4 FY26': -0.3, 'Q1 FY27': 0,    'Q2 FY27': 0 }, totalGap: -0.8 },
    // ECARX SW Tools CCB — total gap -2.3 across Canada + India Bangalore
    { id: 7, project: 'ECARX SW Tools CCB', location: 'Canada',          hcType: 'Existing - FTE',     gaps: { 'Q2 FY26': -0.5, 'Q3 FY26': -0.5, 'Q4 FY26': -0.5, 'Q1 FY27': 0,    'Q2 FY27': 0 }, totalGap: -1.5 },
    { id: 8, project: 'ECARX SW Tools CCB', location: 'India Bangalore', hcType: 'Incremental - CONT', gaps: { 'Q2 FY26': -0.3, 'Q3 FY26': -0.5, 'Q4 FY26': 0,    'Q1 FY27': 0,    'Q2 FY27': 0 }, totalGap: -0.8 },
  ];

  allocSampleData = [
    { project: 'Android EAP v1.3', person: 'Engineer A', role: 'SW Engineer', q2: 0.5, q3: 0.5, q4: 0.5, q1fy27: 0.5, cost: '$60,000' },
  ];

  allocQuarters = ['Q2 FY26', 'Q3 FY26', 'Q4 FY26', 'Q1 FY27', 'Q2 FY27'];
  allocView: 'project' | 'person' = 'project';
  expandedAllocProjects = new Set<string>();
  expandedAllocPersons = new Set<string>();

  allocPeople = [
    { name: 'Engineer A', color: '#1565c0' },
    { name: 'Engineer B', color: '#2e7d32' },
    { name: 'Engineer C', color: '#e65100' },
    { name: 'Engineer D', color: '#6a1b9a' },
    { name: 'Engineer E', color: '#00838f' },
    { name: 'Engineer F', color: '#ad1457' },
    { name: 'Engineer G', color: '#f57f17' },
    { name: 'Engineer H', color: '#00695c' },
  ];

  // Totals derived directly from allocDetailData below:
  // Eris: A(4) + B(3.5) + F(3.5) + G(3) = 14
  // KRK1: B(3) + C(3) + H(4) = 10
  // Android: A(2) + C(1.5) + D(1) = 4.5
  // ECARX: D(2.5) + E(3) + F(1) = 6.5
  allocChartData = [
    { name: 'Eris v2.0',              total: 14,  segments: [
      { person: 'Engineer A', hc: 4,   pct: 29, color: '#1565c0' },
      { person: 'Engineer B', hc: 3.5, pct: 25, color: '#2e7d32' },
      { person: 'Engineer F', hc: 3.5, pct: 25, color: '#ad1457' },
      { person: 'Engineer G', hc: 3,   pct: 21, color: '#f57f17' },
    ]},
    { name: 'KRK1 New Features v1.0', total: 10,  segments: [
      { person: 'Engineer H', hc: 4,   pct: 40, color: '#00695c' },
      { person: 'Engineer B', hc: 3,   pct: 30, color: '#2e7d32' },
      { person: 'Engineer C', hc: 3,   pct: 30, color: '#e65100' },
    ]},
    { name: 'Android EAP v1.3',       total: 4.5, segments: [
      { person: 'Engineer A', hc: 2,   pct: 44, color: '#1565c0' },
      { person: 'Engineer C', hc: 1.5, pct: 33, color: '#e65100' },
      { person: 'Engineer D', hc: 1,   pct: 22, color: '#6a1b9a' },
    ]},
    { name: 'ECARX SW Tools CCB',     total: 6.5, segments: [
      { person: 'Engineer E', hc: 3,   pct: 46, color: '#00838f' },
      { person: 'Engineer D', hc: 2.5, pct: 38, color: '#6a1b9a' },
      { person: 'Engineer F', hc: 1,   pct: 15, color: '#ad1457' },
    ]},
  ];

  // Allocation detail — realistic split across real project timelines.
  // Eris v2.0 spans Q2 FY26–Q1 FY27 (55.5 HC sized, 38 alloc)
  // KRK1 spans Q2 FY26–Q1 FY27 (39.9 HC sized, 24 alloc)
  // Android EAP spans Q2 FY26–Q1 FY27 (22 HC sized, 10 alloc)
  // ECARX spans Q2 FY26–Q4 FY26 (20 HC sized, 14 alloc)
  allocDetailData: { project: string; person: string; role: string; location: string; color: string; hc: Record<string, number>; totalHC: number; cost: string }[] = [
    // ── Eris v2.0 ──
    { project: 'Eris v2.0', person: 'Engineer A', role: 'SW Engineer',  location: 'India Bangalore', color: '#1565c0', hc: { 'Q2 FY26': 1,   'Q3 FY26': 1,   'Q4 FY26': 1,   'Q1 FY27': 1   }, totalHC: 4,   cost: '$49K'  },
    { project: 'Eris v2.0', person: 'Engineer B', role: 'Architect',    location: 'India Bangalore', color: '#2e7d32', hc: { 'Q2 FY26': 0.5, 'Q3 FY26': 1,   'Q4 FY26': 1,   'Q1 FY27': 1   }, totalHC: 3.5, cost: '$43K'  },
    { project: 'Eris v2.0', person: 'Engineer F', role: 'Tech Lead',    location: 'China Shanghai',  color: '#ad1457', hc: { 'Q2 FY26': 0.5, 'Q3 FY26': 1,   'Q4 FY26': 1,   'Q1 FY27': 1   }, totalHC: 3.5, cost: '$95K'  },
    { project: 'Eris v2.0', person: 'Engineer G', role: 'SW Engineer',  location: 'India Bangalore', color: '#f57f17', hc: { 'Q2 FY26': 0.5, 'Q3 FY26': 1,   'Q4 FY26': 1,   'Q1 FY27': 0.5 }, totalHC: 3,   cost: '$37K'  },
    // ── KRK1 New Features v1.0 ──
    { project: 'KRK1 New Features v1.0', person: 'Engineer B', role: 'SW Engineer',  location: 'Canada',          color: '#2e7d32', hc: { 'Q2 FY26': 0.5, 'Q3 FY26': 1,   'Q4 FY26': 1,   'Q1 FY27': 0.5 }, totalHC: 3,   cost: '$91K'  },
    { project: 'KRK1 New Features v1.0', person: 'Engineer C', role: 'PMO',          location: 'India Hyderabad', color: '#e65100', hc: { 'Q2 FY26': 0.5, 'Q3 FY26': 1,   'Q4 FY26': 1,   'Q1 FY27': 0.5 }, totalHC: 3,   cost: '$37K'  },
    { project: 'KRK1 New Features v1.0', person: 'Engineer H', role: 'SW Engineer',  location: 'India Hyderabad', color: '#00695c', hc: { 'Q2 FY26': 1,   'Q3 FY26': 1,   'Q4 FY26': 1,   'Q1 FY27': 1   }, totalHC: 4,   cost: '$49K'  },
    // ── Android EAP v1.3 ──
    { project: 'Android EAP v1.3', person: 'Engineer A', role: 'SW Engineer',  location: 'Canada',          color: '#1565c0', hc: { 'Q2 FY26': 0.5, 'Q3 FY26': 0.5, 'Q4 FY26': 0.5, 'Q1 FY27': 0.5 }, totalHC: 2,   cost: '$60K'  },
    { project: 'Android EAP v1.3', person: 'Engineer C', role: 'PMO',          location: 'India Hyderabad', color: '#e65100', hc: {                  'Q3 FY26': 0.5, 'Q4 FY26': 0.5, 'Q1 FY27': 0.5 }, totalHC: 1.5, cost: '$18K'  },
    { project: 'Android EAP v1.3', person: 'Engineer D', role: 'SW Engineer',  location: 'Canada',          color: '#6a1b9a', hc: {                                  'Q4 FY26': 0.5, 'Q1 FY27': 0.5 }, totalHC: 1,   cost: '$30K'  },
    // ── ECARX SW Tools CCB ──
    { project: 'ECARX SW Tools CCB', person: 'Engineer D', role: 'SW Engineer',  location: 'Canada',          color: '#6a1b9a', hc: { 'Q2 FY26': 1,   'Q3 FY26': 1,   'Q4 FY26': 0.5                  }, totalHC: 2.5, cost: '$75K'  },
    { project: 'ECARX SW Tools CCB', person: 'Engineer E', role: 'SW Engineer',  location: 'India Bangalore', color: '#00838f', hc: {                  'Q3 FY26': 1,   'Q4 FY26': 1,   'Q1 FY27': 1   }, totalHC: 3,   cost: '$37K'  },
    { project: 'ECARX SW Tools CCB', person: 'Engineer F', role: 'Architect',    location: 'China Shanghai',  color: '#ad1457', hc: { 'Q2 FY26': 0.5, 'Q3 FY26': 0.5                                  }, totalHC: 1,   cost: '$27K'  },
  ];

  get allocProjectGroups() {
    const names = [...new Set(this.allocDetailData.map(r => r.project))];
    return names.map(name => {
      const rows = this.allocDetailData.filter(r => r.project === name);
      const totalByQ: Record<string, number> = {};
      this.allocQuarters.forEach(q => {
        const sum = rows.reduce((s, r) => s + (r.hc[q] || 0), 0);
        totalByQ[q] = sum > 0 ? sum : 0;
      });
      const totalHC = rows.reduce((s, r) => s + r.totalHC, 0);
      // cost strings are like '$49K' — strip $, K, commas and sum the K values directly
      const totalCostK = rows.reduce((s, r) => s + parseInt(r.cost.replace(/[$K,]/g, '')), 0);
      const totalCost = '$' + totalCostK + 'K';
      return { name, rows, totalByQ, totalHC, totalCost };
    });
  }

  toggleAllocProject(name: string) {
    if (this.expandedAllocProjects.has(name)) this.expandedAllocProjects.delete(name);
    else this.expandedAllocProjects.add(name);
    this.expandedAllocProjects = new Set(this.expandedAllocProjects);
  }

  toggleAllocPerson(name: string) {
    if (this.expandedAllocPersons.has(name)) this.expandedAllocPersons.delete(name);
    else this.expandedAllocPersons.add(name);
    this.expandedAllocPersons = new Set(this.expandedAllocPersons);
  }

  getPersonQTotal(personName: string, quarter: string): number {
    const rows = this.allocDetailData.filter(r => r.person === personName);
    const total = rows.reduce((s, r) => s + (r.hc[quarter] || 0), 0);
    return Math.round(total * 10) / 10;
  }

  getPersonQPct(personName: string, quarter: string): number {
    const val = this.getPersonQTotal(personName, quarter);
    // Max is always 1.0 for a person
    return val * 100;
  }

  getProjectQTotal(projName: string, quarter: string): number {
    const rows = this.allocDetailData.filter(r => r.project === projName);
    const total = rows.reduce((s, r) => s + (r.hc[quarter] || 0), 0);
    return Math.round(total * 10) / 10;
  }

  getProjectQPct(projName: string, quarter: string): number {
    const val = this.getProjectQTotal(projName, quarter);
    const maxForProject = Math.max(
      ...this.allocQuarters.map(q => this.getProjectQTotal(projName, q)), 0.01
    );
    return (val / maxForProject) * 100;
  }

  // Project colours for person view
  allocProjectLegend = [
    { name: 'Android EAP v1.3',       color: '#1565c0' },
    { name: 'ECARX SW Tools CCB',     color: '#2e7d32' },
    { name: 'Eris v2.0',              color: '#e65100' },
    { name: 'KRK1 New Features v1.0', color: '#6a1b9a' },
  ];

  private projColors: Record<string, string> = {
    'Android EAP v1.3': '#1565c0',
    'ECARX SW Tools CCB': '#2e7d32',
    'Eris v2.0': '#e65100',
    'KRK1 New Features v1.0': '#6a1b9a',
  };

  get allocPersonGroups() {
    const personNames = [...new Set(this.allocDetailData.map(r => r.person))].sort();
    return personNames.map(name => {
      const rows = this.allocDetailData.filter(r => r.person === name);
      const color = rows[0]?.color || '#999';
      const totalByQ: Record<string, number> = {};
      this.allocQuarters.forEach(q => {
        totalByQ[q] = rows.reduce((s, r) => s + (r.hc[q] || 0), 0);
      });
      const totalHC = rows.reduce((s, r) => s + r.totalHC, 0);
      // cost strings are like '$49K' — strip $, K, commas and sum the K values directly
      const totalCostK = rows.reduce((s, r) => s + parseInt(r.cost.replace(/[$K,]/g, '')), 0);
      const totalCost = '$' + totalCostK + 'K';
      const projects = rows.map(r => ({
        project: r.project,
        role: r.role,
        hc: r.hc,
        totalHC: r.totalHC,
        cost: r.cost,
        projColor: this.projColors[r.project] || '#999',
      }));
      return { name, color, totalByQ, totalHC, totalCost, projects };
    });
  }
}
