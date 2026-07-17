import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { ApiService } from '../../services/api.service';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { FormsModule } from '@angular/forms';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import * as XLSX from 'xlsx';

@Component({
  selector: 'app-views',
  standalone: true,
  imports: [CommonModule, MatSelectModule, MatFormFieldModule, MatButtonModule, MatIconModule, FormsModule, MatTooltipModule, MatProgressSpinnerModule],
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
          <div class="export-group">
            <button mat-stroked-button class="export-btn" (click)="exportExcel()">
              <mat-icon>table_chart</mat-icon> Excel
            </button>
            <button mat-stroked-button class="export-btn" (click)="exportPdf()">
              <mat-icon>picture_as_pdf</mat-icon> PDF
            </button>
          </div>
          <button mat-stroked-button class="refresh-btn" (click)="refreshSizingData()">
            <mat-icon>refresh</mat-icon> Refresh
          </button>
        </div>
      </div>

      <!-- Slicer bar — compact multi-select with inline search -->
      <div class="slicer-bar">

        <mat-form-field appearance="outline" class="sf">
          <mat-label>BU</mat-label>
          <mat-select [(ngModel)]="filters.bus" multiple disableOptionCentering (ngModelChange)="onFilterChange()">
            <div class="fs-wrap"><input class="fs-input" [(ngModel)]="filterSearch.bu" placeholder="Search…" (click)="$event.stopPropagation()" (keydown)="$event.stopPropagation()"></div>
            @for (bu of searchFilter(sizingBuOptions, filterSearch.bu); track bu) {
              <mat-option [value]="bu">{{ bu }}</mat-option>
            }
          </mat-select>
        </mat-form-field>

        <mat-form-field appearance="outline" class="sf sf-wide">
          <mat-label>Project</mat-label>
          <mat-select [(ngModel)]="filters.projects" multiple disableOptionCentering (ngModelChange)="onFilterChange()">
            <div class="fs-wrap"><input class="fs-input" [(ngModel)]="filterSearch.project" placeholder="Search…" (click)="$event.stopPropagation()" (keydown)="$event.stopPropagation()"></div>
            @for (name of searchFilter(sizingProjectNames, filterSearch.project); track name) {
              <mat-option [value]="name">{{ name }}</mat-option>
            }
          </mat-select>
        </mat-form-field>

        <mat-form-field appearance="outline" class="sf">
          <mat-label>Quarter</mat-label>
          <mat-select [(ngModel)]="filters.quarters" multiple disableOptionCentering (ngModelChange)="onFilterChange()">
            @for (q of sizingQuarters; track q) {
              <mat-option [value]="q">{{ q }}</mat-option>
            }
          </mat-select>
        </mat-form-field>

        <mat-form-field appearance="outline" class="sf">
          <mat-label>HC Type</mat-label>
          <mat-select [(ngModel)]="filters.hcTypes" multiple disableOptionCentering (ngModelChange)="onFilterChange()">
            <div class="fs-wrap"><input class="fs-input" [(ngModel)]="filterSearch.hcType" placeholder="Search…" (click)="$event.stopPropagation()" (keydown)="$event.stopPropagation()"></div>
            @for (item of searchFilter(sizingHcTypeOptions, filterSearch.hcType); track item) {
              <mat-option [value]="item">{{ item }}</mat-option>
            }
          </mat-select>
        </mat-form-field>

        <mat-form-field appearance="outline" class="sf">
          <mat-label>Location</mat-label>
          <mat-select [(ngModel)]="filters.locations" multiple disableOptionCentering (ngModelChange)="onFilterChange()">
            <div class="fs-wrap"><input class="fs-input" [(ngModel)]="filterSearch.location" placeholder="Search…" (click)="$event.stopPropagation()" (keydown)="$event.stopPropagation()"></div>
            @for (loc of searchFilter(sizingLocationOptions, filterSearch.location); track loc) {
              <mat-option [value]="loc">{{ loc }}</mat-option>
            }
          </mat-select>
        </mat-form-field>

        @if (viewType === 'sizing') {
          <mat-form-field appearance="outline" class="sf">
            <mat-label>Status</mat-label>
            <mat-select [(ngModel)]="filters.statuses" multiple disableOptionCentering (ngModelChange)="onFilterChange()">
              <mat-option value="draft">Draft</mat-option>
              <mat-option value="submitted">Submitted</mat-option>
              <mat-option value="locked">Locked</mat-option>
              <mat-option value="bu_approved">BU Approved</mat-option>
            </mat-select>
          </mat-form-field>
        }

        @if (hasActiveFilters) {
          <button class="clear-btn" (click)="clearViewFilters()">
            <mat-icon>close</mat-icon> Clear filters
          </button>
          <span class="row-count">{{ sizingFilteredRows.length }}/{{ sizingAllRows.length }} rows</span>
        }
      </div>

      <!-- View content -->
      @if (viewType === 'sizing') {
        <div class="sizing-view">

          <!-- Live data badge + loading state -->
          @if (sizingLoading) {
            <div class="live-loading-banner">
              <mat-spinner diameter="16"></mat-spinner>
              <span>Loading live sizing data from database...</span>
            </div>
          } @else if (sizingAllRows.length > 0) {
            <div class="live-data-banner">
              <mat-icon style="font-size:16px;width:16px;height:16px;color:#2e7d32">check_circle</mat-icon>
              <span><strong>Live Data</strong> — Showing real sizing submissions from {{ sizingProjectCount }} active project{{ sizingProjectCount !== 1 ? 's' : '' }}</span>
            </div>
          } @else {
            <div class="mockup-banner">
              <mat-icon>info</mat-icon>
              <span>No submitted sizing data found. Data will appear here once PMs submit their sizing entries.</span>
            </div>
          }

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
              <!-- Per-project version status badges -->
              <div class="proj-version-badges">
                @for (proj of sizingProjectVersions; track proj.name) {
                  <span class="proj-ver-badge" [class.badge-draft]="proj.status === 'draft'"
                    [class.badge-submitted]="proj.status === 'submitted'"
                    [class.badge-locked]="proj.status === 'locked' || proj.status === 'bu_approved'"
                    [matTooltip]="proj.name + ' — v' + proj.versionId + ' (' + proj.status + ')'">
                    {{ proj.name | slice:0:12 }}{{ proj.name.length > 12 ? '…' : '' }}
                    <span class="ver-status-dot">{{ proj.status === 'draft' ? '✎' : proj.status === 'submitted' ? '⏳' : '✓' }}</span>
                  </span>
                }
              </div>
              <div class="hc-type-legend">
                @for (item of sizingHcTypeLegend; track item.type) {
                  <span class="legend-dot" [style.background]="item.color"></span>
                  <span style="margin-right:14px">{{ item.type }}</span>
                }
              </div>
            </div>
            <div class="sizing-table-wrap">
              <table class="sizing-matrix-table">
                <thead>
                  <tr>
                    <th class="col-team">Project</th>
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
                  @for (row of sizingFilteredRows; track row.fn + row.project) {
                    <tr>
                      <td class="col-team">{{ row.project }}</td>
                      <td class="col-fn">{{ row.fn }}</td>
                      <td class="col-loc">{{ row.location }}</td>
                      <td class="col-type">
                        <span class="type-dot" [style.background]="getHcTypeColor(row.hcType)"></span>
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

          <!-- PBI reference — coming soon button + modal -->
          <div class="pbi-coming-soon">
            <button mat-stroked-button (click)="showPbiModal = true" class="pbi-btn">
              <mat-icon>bar_chart</mat-icon>
              Power BI Integrated View
              <span class="cs-tag-inline">Coming Soon</span>
            </button>
            <span class="pbi-hint">Full Power BI dashboard will be embedded here once integration is complete</span>
          </div>

          <!-- PBI modal overlay -->
          @if (showPbiModal) {
            <div class="pbi-modal-overlay" (click)="showPbiModal = false">
              <div class="pbi-modal" (click)="$event.stopPropagation()">
                <div class="pbi-modal-header">
                  <span><mat-icon>bar_chart</mat-icon> Power BI Sizing View — Reference</span>
                  <div style="display:flex;align-items:center;gap:8px">
                    <span class="cs-tag-inline">Coming Soon</span>
                    <button mat-icon-button (click)="showPbiModal = false"><mat-icon>close</mat-icon></button>
                  </div>
                </div>
                <div class="pbi-modal-body">
                  <div class="pbi-modal-note">
                    <mat-icon>info</mat-icon>
                    This is a reference screenshot of the Power BI view. The live embedded dashboard is coming soon.
                  </div>
                  <img src="powerbi-sizing.png" alt="Power BI Sizing Reference" style="width:100%;border-radius:6px;" />
                </div>
              </div>
            </div>
          }

        </div>
      }

      @if (viewType === 'gap') {
        <div class="gap-view">
          <div class="mockup-banner">
            <mat-icon>info</mat-icon>
            <span><strong>Preview Mode</strong> — This view shows sample data for demonstration. Live data wiring coming soon.</span>
          </div>
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
                @for (proj of filteredGapProjectGroups; track proj.name) {
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
          <div class="mockup-banner">
            <mat-icon>info</mat-icon>
            <span><strong>Preview Mode</strong> — This view shows sample data for demonstration. Live data wiring coming soon.</span>
          </div>

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
    .export-group { display: flex; gap: 6px; }
    .export-btn, .refresh-btn { font-size: 13px; }

    /* ── Filter bar ── */
    .slicer-bar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 16px; }
    .sf { width: 148px; flex-shrink: 0; }
    .sf-wide { width: 200px; }
    .sf ::ng-deep .mat-mdc-form-field-subscript-wrapper { display: none; }
    .sf ::ng-deep .mat-mdc-text-field-wrapper { background: white; }

    /* Inline search in panel — rendered via ::ng-deep on a global panelClass */
    .fs-wrap { padding: 6px 8px 4px; background: white; border-bottom: 1px solid #f0f0f0; position: sticky; top: 0; z-index: 1; }
    .fs-input { width: 100%; box-sizing: border-box; border: 1px solid #e0e0e0; border-radius: 4px; padding: 4px 8px; font-size: 12px; font-family: inherit; outline: none; }
    .fs-input:focus { border-color: #1565c0; }

    .clear-btn { display: inline-flex; align-items: center; gap: 4px; height: 36px; padding: 0 12px; border: 1px solid #ddd; border-radius: 6px; background: white; cursor: pointer; font-size: 12px; color: #666; font-family: inherit; white-space: nowrap; transition: all 0.15s; }
    .clear-btn mat-icon { font-size: 15px; width: 15px; height: 15px; }
    .clear-btn:hover { background: #fdecea; border-color: #ED1C24; color: #ED1C24; }
    .row-count { font-size: 11px; color: #1565c0; background: #e3f2fd; border: 1px solid #90caf9; padding: 3px 10px; border-radius: 10px; font-weight: 600; white-space: nowrap; }

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
    .sizing-matrix-header { display: flex; justify-content: space-between; align-items: center; padding: 14px 18px; border-bottom: 1px solid #f0f0f0; flex-wrap: wrap; gap: 8px; }
    .proj-version-badges { display: flex; flex-wrap: wrap; gap: 6px; }
    .proj-ver-badge { display: flex; align-items: center; gap: 4px; font-size: 11px; font-weight: 600; padding: 3px 10px; border-radius: 10px; border: 1px solid; }
    .badge-draft { background: #fff8e1; color: #f57f17; border-color: #ffe082; }
    .badge-submitted { background: #e3f2fd; color: #1565c0; border-color: #90caf9; }
    .badge-locked { background: #e8f5e9; color: #2e7d32; border-color: #a5d6a7; }
    .ver-status-dot { font-size: 12px; }
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
    .mockup-banner { display: flex; align-items: center; gap: 10px; background: #fff8e1; border: 1px solid #ffe082; border-left: 4px solid #f9a825; border-radius: 6px; padding: 10px 16px; font-size: 13px; color: #5d4037; }
    .mockup-banner mat-icon { color: #f9a825; font-size: 18px; width: 18px; height: 18px; flex-shrink: 0; }
    .live-data-banner { display: flex; align-items: center; gap: 10px; background: #e8f5e9; border: 1px solid #a5d6a7; border-left: 4px solid #2e7d32; border-radius: 6px; padding: 10px 16px; font-size: 13px; color: #1b5e20; }
    .live-loading-banner { display: flex; align-items: center; gap: 10px; background: #f3f3f3; border: 1px solid #e0e0e0; border-radius: 6px; padding: 10px 16px; font-size: 13px; color: #666; }
    /* PBI coming soon */
    .pbi-coming-soon { display: flex; align-items: center; gap: 16px; padding: 16px; background: #f8f9fa; border: 1px solid #e8e8e8; border-radius: 10px; margin-top: 8px; }
    .pbi-btn { display: flex; align-items: center; gap: 8px; border-color: #1a1a2e; color: #1a1a2e; }
    .pbi-hint { font-size: 12px; color: #aaa; font-style: italic; }
    .cs-tag-inline { font-size: 10px; background: #fff3e0; color: #e65100; padding: 1px 7px; border-radius: 8px; font-weight: 700; }
    /* PBI Modal */
    .pbi-modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 1000; display: flex; align-items: center; justify-content: center; }
    .pbi-modal { background: white; border-radius: 12px; width: 90%; max-width: 1100px; max-height: 90vh; display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 24px 60px rgba(0,0,0,0.3); }
    .pbi-modal-header { display: flex; align-items: center; justify-content: space-between; padding: 14px 20px; background: #1a1a2e; color: white; font-size: 14px; font-weight: 600; gap: 10px; }
    .pbi-modal-header mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .pbi-modal-body { overflow-y: auto; padding: 16px; }
    .pbi-modal-note { display: flex; align-items: center; gap: 8px; background: #fff8e1; border: 1px solid #ffe082; border-radius: 6px; padding: 10px 14px; font-size: 12px; color: #5d4037; margin-bottom: 12px; }
    .pbi-modal-note mat-icon { color: #f9a825; font-size: 16px; width: 16px; height: 16px; }
    .gap-view { display: flex; flex-direction: column; gap: 16px; }
    .gap-filter-bar { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
    .gap-filter-field { width: 220px; }
    .gap-filter-field ::ng-deep .mat-mdc-form-field-subscript-wrapper { display: none; }
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

  // Multi-select filter model — arrays instead of single strings
  filters: any = { bus: [], projects: [], quarters: [], hcTypes: [], locations: [], statuses: [] };

  // Per-filter search strings for the inline search inputs
  filterSearch: any = { bu: '', project: '', quarter: '', hcType: '', location: '' };

  showPbiModal = false;

  get hasActiveFilters(): boolean {
    return this.filters.bus.length > 0 || this.filters.projects.length > 0 ||
           this.filters.quarters.length > 0 || this.filters.hcTypes.length > 0 ||
           this.filters.locations.length > 0 || this.filters.statuses.length > 0;
  }

  clearViewFilters() {
    this.filters = { bus: [], projects: [], quarters: [], hcTypes: [], locations: [], statuses: [] };
    this.filterSearch = { bu: '', project: '', quarter: '', hcType: '', location: '' };
    this.computeFilteredRows();
  }

  onFilterChange() { this.computeFilteredRows(); }

  searchFilter(options: string[], term: string): string[] {
    if (!term?.trim()) return options;
    const t = term.toLowerCase();
    return options.filter(o => o.toLowerCase().includes(t));
  }

  // ── Sizing view ──
  sizingMetric: 'hc' | 'peak' | 'cost' = 'hc';

  // Derived from actual data — computed once when data loads, not recalculated on each filter change
  private _sizingQuarters: string[] = [];
  get sizingQuarters(): string[] { return this._sizingQuarters; }

  private computeSizingQuarters() {
    const all = new Set<string>();
    this.sizingAllRows.forEach(r => Object.keys(r.hc).forEach(q => all.add(q)));
    const parse = (s: string) => { const m = s.match(/Q(\d) FY(\d{2})/); return m ? parseInt(m[2]) * 4 + parseInt(m[1]) : 0; };
    this._sizingQuarters = [...all].sort((a, b) => parse(a) - parse(b));
  }

  // Sizing rows — loaded from DB via /api/versions/sizing-summary
  sizingLoading = false;
  sizingAllRows: { project: string; bu: string; team: string; fn: string; location: string; hcType: string; hc: Record<string, number>; version_status?: string; version_id?: number }[] = [];

  // Pre-computed filtered rows — recomputed only when filters change, not on every render cycle
  private _filteredRows: any[] = [];
  get sizingFilteredRows() { return this._filteredRows; }

  computeFilteredRows() {
    this._filteredRows = this.sizingAllRows.filter(r => {
      const matchBu       = !this.filters.bus.length       || this.filters.bus.includes(r.bu);
      const matchProject  = !this.filters.projects.length  || this.filters.projects.includes(r.project);
      const matchHcType   = !this.filters.hcTypes.length   || this.filters.hcTypes.includes(r.hcType);
      const matchLocation = !this.filters.locations.length || this.filters.locations.includes(r.location);
      const matchStatus   = !this.filters.statuses.length  || this.filters.statuses.includes(r.version_status);
      const matchQuarter  = !this.filters.quarters.length  ||
        this.filters.quarters.some((q: string) => (r.hc[q] || 0) > 0);
      return matchBu && matchProject && matchHcType && matchLocation && matchStatus && matchQuarter;
    });
  }

  // ── Data-driven filter option lists ──
  get sizingBuOptions(): string[] {
    return [...new Set(this.sizingAllRows.map(r => r.bu).filter(Boolean))].sort();
  }

  get sizingHcTypeOptions(): string[] {
    return [...new Set(this.sizingAllRows.map(r => r.hcType).filter(Boolean))].sort();
  }

  get sizingLocationOptions(): string[] {
    return [...new Set(this.sizingAllRows.map(r => r.location).filter(Boolean))].sort();
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

  // Color palette for HC types — dynamically assigned
  private hcTypeColorMap: Record<string, string> = {};
  private hcTypeColors = ['#1565c0','#2e7d32','#e65100','#6a1b9a','#00695c','#c62828','#0277bd','#558b2f'];

  getHcTypeColor(hcType: string): string {
    if (!this.hcTypeColorMap[hcType]) {
      const idx = Object.keys(this.hcTypeColorMap).length % this.hcTypeColors.length;
      this.hcTypeColorMap[hcType] = this.hcTypeColors[idx];
    }
    return this.hcTypeColorMap[hcType];
  }

  get sizingHcTypeLegend(): { type: string; color: string }[] {
    const types = [...new Set(this.sizingFilteredRows.map(r => r.hcType))].filter(Boolean).sort();
    return types.map(t => ({ type: t, color: this.getHcTypeColor(t) }));
  }

  get sizingProjectVersions(): { name: string; status: string; versionId: number }[] {
    const seen = new Map<string, { name: string; status: string; versionId: number }>();
    this.sizingFilteredRows.forEach(r => {
      if (!seen.has(r.project)) {
        seen.set(r.project, {
          name: r.project,
          status: r.version_status || 'unknown',
          versionId: r.version_id || 0
        });
      }
    });
    return Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  get sizingProjectNames(): string[] {
    return [...new Set(this.sizingAllRows.map(r => r.project))].sort();
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

  constructor(private route: ActivatedRoute, private api: ApiService) {
    this.buildGapGroups();
    this.route.data.subscribe(data => {
      this.viewType = data['viewType'] || 'sizing';
      this.viewConfig = {
        sizing: { title: 'Sizing View', subtitle: 'Headcount sizing submissions by project, version, and quarter', icon: 'table_chart' },
        gap: { title: 'Gap Analysis View', subtitle: 'Sized vs allocated headcount — identify understaffed projects', icon: 'compare_arrows' },
        allocation: { title: 'Allocation View', subtitle: 'Named headcount assignments per project and month', icon: 'people' }
      }[this.viewType] || this.viewConfig;

      if (this.viewType === 'sizing') {
        this.loadSizingData();
      }
    });
  }

  loadSizingData(forceRefresh = false) {
    this.sizingLoading = true;
    this.api.getSizingSummary(forceRefresh).subscribe({
      next: (res: any) => {
        this.sizingAllRows = res.data || [];
        this.computeSizingQuarters();
        this.computeFilteredRows();  // always recompute — applies any active filters to fresh data
        this.sizingLoading = false;
      },
      error: () => { this.sizingLoading = false; }
    });
  }

  refreshSizingData() { this.loadSizingData(true); }

  // ── Shared rate map ──
  private readonly rateMap: Record<string, number> = {
    'Canada': 30138, 'US': 30138, 'USA': 30138,
    'India Bangalore': 12203, 'India Hyderabad': 12203,
    'China Shanghai': 27275, 'Global': 31000, 'Taiwan': 24975,
    'Japan': 27000, 'UK': 28000, 'France': 25000, 'Germany': 25000,
    'Serbia': 15000, 'Bulgaria': 14000, 'Greece': 14000,
    'Brazil': 16000, 'Mexico': 15000,
  };

  private getRate(location: string) { return this.rateMap[location] || 20000; }

  // ── Excel export — all 3 metrics + bar chart summary sheet ──
  exportExcel() {
    const rows = this.sizingFilteredRows;  // already filtered
    // Quarters: only those that appear in filtered rows with HC > 0
    const quarters = this.sizingQuarters.filter(q => rows.some(r => (r.hc[q] || 0) > 0));
    const today = new Date().toISOString().slice(0, 10);

    // ── Sheet 1: Bar Chart Summary (all 3 metrics by quarter) ──
    const chartHeader = ['Quarter', 'Total HC', 'Peak HC', 'Total Cost ($)'];
    const chartData = quarters.map(q => {
      const totalHC = Math.round(rows.reduce((s, r) => s + (r.hc[q] || 0), 0) * 10) / 10;
      const peakHC  = Math.round(Math.max(...rows.map(r => r.hc[q] || 0)) * 10) / 10;
      const cost    = Math.round(rows.reduce((s, r) => s + (r.hc[q] || 0) * this.getRate(r.location), 0));
      return [q, totalHC, peakHC, cost];
    });
    const wsSummary = XLSX.utils.aoa_to_sheet([chartHeader, ...chartData]);
    wsSummary['!cols'] = [{wch:12},{wch:12},{wch:12},{wch:16}];

    // ── Sheet 2: Detail table — all 3 metrics per row ──
    const header = [
      'Project', 'Function', 'Location', 'HC Type', 'Version Status',
      ...quarters,
      'Total HC', 'Peak HC (quarter)', 'Total Cost ($)'
    ];
    const data = rows.map(r => {
      const qVals = quarters.map(q => r.hc[q] || 0);
      const totalHC = Math.round(qVals.reduce((s, v) => s + v, 0) * 10) / 10;
      const peakHC  = Math.round(Math.max(...qVals) * 10) / 10;
      const cost    = Math.round(totalHC * this.getRate(r.location));
      return [r.project, r.fn, r.location, r.hcType, r.version_status || '', ...qVals, totalHC, peakHC, cost];
    });
    const totalsHC  = quarters.map(q => Math.round(rows.reduce((s, r) => s + (r.hc[q] || 0), 0) * 10) / 10);
    const grandHC   = Math.round(totalsHC.reduce((s, v) => s + v, 0) * 10) / 10;
    const grandPeak = Math.round(Math.max(...quarters.map(q => rows.reduce((s, r) => s + (r.hc[q] || 0), 0))) * 10) / 10;
    const grandCost = Math.round(rows.reduce((s, r) => {
      const hc = quarters.reduce((qs, q) => qs + (r.hc[q] || 0), 0);
      return s + hc * this.getRate(r.location);
    }, 0));
    const totalsRow = ['', '', '', '', 'TOTAL', ...totalsHC, grandHC, grandPeak, grandCost];

    const wsDetail = XLSX.utils.aoa_to_sheet([header, ...data, totalsRow]);
    wsDetail['!cols'] = [
      {wch:28},{wch:24},{wch:18},{wch:22},{wch:12},
      ...quarters.map(() => ({wch:9})),
      {wch:10},{wch:14},{wch:14}
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, wsSummary, 'Chart Summary');
    XLSX.utils.book_append_sheet(wb, wsDetail, 'Headcount Detail');
    XLSX.writeFile(wb, `AMD_Sizing_View_${today}.xlsx`);
  }

  // ── PDF export — bar chart (all 3 metrics) + full detail table ──
  exportPdf() {
    const rows = this.sizingFilteredRows;  // already filtered
    const quarters = this.sizingQuarters.filter(q => rows.some(r => (r.hc[q] || 0) > 0));
    const today = new Date().toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' });

    // Build chart data for all 3 metrics
    const chartRows = quarters.map(q => {
      const totalHC = Math.round(rows.reduce((s, r) => s + (r.hc[q] || 0), 0) * 10) / 10;
      const peakHC  = Math.round(Math.max(...rows.map(r => r.hc[q] || 0)) * 10) / 10;
      const cost    = Math.round(rows.reduce((s, r) => s + (r.hc[q] || 0) * this.getRate(r.location), 0) / 1000);
      return { q, totalHC, peakHC, cost };
    });
    const maxHC   = Math.max(...chartRows.map(r => r.totalHC), 1);
    const maxCost = Math.max(...chartRows.map(r => r.cost), 1);

    const barChartHtml = `
      <div class="chart-section">
        <h3 class="section-title">HC & Cost by Quarter</h3>
        <table class="chart-table">
          <thead><tr><th>Quarter</th><th>Total HC</th><th>Peak HC</th><th>Cost ($K)</th>
            <th style="width:260px">Bar (Total HC)</th></tr></thead>
          <tbody>
            ${chartRows.map(r => `<tr>
              <td>${r.q}</td>
              <td style="font-weight:700;color:#1565c0">${r.totalHC}</td>
              <td style="font-weight:700;color:#e65100">${r.peakHC}</td>
              <td style="font-weight:700;color:#2e7d32">$${r.cost}K</td>
              <td>
                <div style="display:flex;gap:3px;align-items:center">
                  <div style="height:14px;background:#1565c0;border-radius:2px;width:${Math.round((r.totalHC/maxHC)*180)}px"></div>
                  <div style="height:14px;background:#e65100;border-radius:2px;width:${Math.round((r.peakHC/maxHC)*180)}px;opacity:0.7"></div>
                </div>
              </td>
            </tr>`).join('')}
          </tbody>
        </table>
        <div class="legend">
          <span class="leg-dot" style="background:#1565c0"></span> Total HC &nbsp;
          <span class="leg-dot" style="background:#e65100"></span> Peak HC &nbsp;
          <span class="leg-dot" style="background:#2e7d32"></span> Cost
        </div>
      </div>`;

    // Detail table rows with all 3 metrics
    const tableRows = rows.map(r => {
      const qVals  = quarters.map(q => r.hc[q] || 0);
      const totalHC = Math.round(qVals.reduce((s, v) => s + v, 0) * 10) / 10;
      const peakHC  = Math.round(Math.max(...qVals) * 10) / 10;
      const cost    = '$' + Math.round(totalHC * this.getRate(r.location) / 1000) + 'K';
      const qCells  = quarters.map(q => `<td class="num">${(r.hc[q] || 0) > 0 ? r.hc[q] : '—'}</td>`).join('');
      return `<tr>
        <td>${r.project}</td><td>${r.fn}</td><td>${r.location}</td><td>${r.hcType}</td>
        ${qCells}
        <td class="num ttl">${totalHC}</td>
        <td class="num pk">${peakHC}</td>
        <td class="num cst">${cost}</td>
      </tr>`;
    }).join('');

    const grandHC   = Math.round(rows.reduce((s, r) => s + quarters.reduce((qs, q) => qs + (r.hc[q] || 0), 0), 0) * 10) / 10;
    const grandPeak = Math.round(Math.max(...quarters.map(q => rows.reduce((s, r) => s + (r.hc[q] || 0), 0))) * 10) / 10;
    const grandCost = '$' + Math.round(rows.reduce((s, r) => {
      const hc = quarters.reduce((qs, q) => qs + (r.hc[q] || 0), 0);
      return s + hc * this.getRate(r.location);
    }, 0) / 1000) + 'K';
    const qTotalCells = quarters.map(q =>
      `<td class="num ttl">${Math.round(rows.reduce((s, r) => s + (r.hc[q] || 0), 0) * 10) / 10}</td>`
    ).join('');

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
    <title>AMD Sizing View — ${today}</title>
    <style>
      body { font-family: Arial, sans-serif; font-size: 9.5px; color: #1a1a2e; margin: 16px 20px; }
      h1 { font-size: 17px; margin: 0 0 2px; color: #1a1a2e; }
      .meta { color: #888; font-size: 10px; margin-bottom: 18px; }
      .section-title { font-size: 12px; font-weight: 700; color: #1a1a2e; margin: 0 0 8px; }
      .chart-section { margin-bottom: 24px; }
      .chart-table, .detail-table { width: 100%; border-collapse: collapse; font-size: 8.5px; }
      .chart-table th, .detail-table th { background: #1a1a2e; color: white; padding: 5px 7px; text-align: left; }
      .chart-table td, .detail-table td { padding: 4px 7px; border-bottom: 1px solid #eee; }
      .chart-table tr:nth-child(even) td, .detail-table tr:nth-child(even) td { background: #f9f9f9; }
      .total-row td { background: #e8f0ff !important; font-weight: bold; border-top: 2px solid #1565c0; }
      .num { text-align: center; }
      .ttl { color: #1565c0; font-weight: 700; }
      .pk  { color: #e65100; font-weight: 700; }
      .cst { color: #2e7d32; font-weight: 700; }
      .legend { display: flex; gap: 16px; font-size: 9px; color: #555; margin-top: 6px; align-items: center; }
      .leg-dot { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 3px; }
      @media print { @page { size: landscape; margin: 8mm; } }
    </style></head><body>
    <h1>AMD Sizing Portal — Sizing View</h1>
    <div class="meta">Exported ${today} &nbsp;·&nbsp; ${rows.length} function rows &nbsp;·&nbsp;
      ${new Set(rows.map(r => r.project)).size} projects &nbsp;·&nbsp;
      Grand Total: <strong>${grandHC} HC</strong> &nbsp; Peak: <strong>${grandPeak} HC</strong> &nbsp; Cost: <strong>${grandCost}</strong>
    </div>

    ${barChartHtml}

    <h3 class="section-title">Headcount Detail by Function</h3>
    <table class="detail-table">
      <thead><tr>
        <th>Project</th><th>Function</th><th>Location</th><th>HC Type</th>
        ${quarters.map(q => `<th class="num">${q}</th>`).join('')}
        <th class="num">Total HC</th><th class="num">Peak HC</th><th class="num">Cost</th>
      </tr></thead>
      <tbody>${tableRows}</tbody>
      <tfoot><tr class="total-row">
        <td colspan="4"><strong>TOTAL</strong></td>
        ${qTotalCells}
        <td class="num ttl">${grandHC}</td>
        <td class="num pk">${grandPeak}</td>
        <td class="num cst">${grandCost}</td>
      </tr></tfoot>
    </table>
    <script>window.onload = () => { window.print(); }</script>
    </body></html>`;

    const win = window.open('', '_blank');
    if (win) { win.document.write(html); win.document.close(); }
  }

  gapQuarters = ['Q2 FY26', 'Q3 FY26', 'Q4 FY26', 'Q1 FY27', 'Q2 FY27'];
  expandedGapProjects = new Set<string>();
  gapProjectGroups: { name: string; rows: any[]; totalByQ: Record<string, number>; totalGap: number }[] = [];

  // Gap filters
  gapFilter = { project: '', region: '' };

  get gapProjectNames(): string[] {
    return [...new Set(this.gapMatrixData.map(r => r.project))];
  }

  // Matches a location string against filters.location
  matchesRegion(location: string): boolean {
    if (!this.filters.location) return true;
    if (this.filters.location === 'India') return location.toLowerCase().startsWith('india');
    return location === this.filters.location;
  }

  get filteredGapProjectGroups() {
    return this.gapProjectGroups
      .filter(proj => !this.filters.project || proj.name === this.filters.project)
      .map(proj => {
        const rows = this.filters.location
          ? proj.rows.filter((r: any) => this.matchesRegion(r.location))
          : proj.rows;
        const totalByQ: Record<string, number> = {};
        this.gapQuarters.forEach(q => {
          totalByQ[q] = rows.reduce((sum: number, r: any) => sum + (r.gaps[q] || 0), 0);
        });
        const totalGap = rows.reduce((sum: number, r: any) => sum + r.totalGap, 0);
        return { ...proj, rows, totalByQ, totalGap };
      })
      .filter(proj => proj.rows.length > 0);
  }

  applyGapFilter() {
    this.expandedGapProjects = new Set<string>();
  }

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
