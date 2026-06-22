import { Component, OnInit, AfterViewInit, ElementRef, ViewChild, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTooltipModule } from '@angular/material/tooltip';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-reports',
  standalone: true,
  imports: [CommonModule, MatSelectModule, MatFormFieldModule, MatButtonModule, MatIconModule, MatTabsModule, MatTooltipModule, FormsModule],
  template: `
    <div class="reports-page">
      <div class="page-header">
        <div class="header-left">
          <mat-icon class="report-icon">assessment</mat-icon>
          <div>
            <h2>{{ reportConfig.title }}</h2>
            <p class="subtitle">{{ reportConfig.subtitle }}</p>
          </div>
        </div>
        <div class="header-actions">
          <button mat-stroked-button class="export-btn">
            <mat-icon>table_view</mat-icon> Export to Excel
          </button>
        </div>
      </div>

      <!-- Fund Breakdown By Projects -->
      @if (reportType === 'project') {
        <div class="report-body">

          <!-- Filters / Slicers -->
          <div class="slicer-bar">
            <mat-form-field appearance="outline" class="slicer-field">
              <mat-label>BU</mat-label>
              <mat-select [(ngModel)]="projFilter.bu">
                <mat-option value="">All BUs</mat-option>
                <mat-option value="Embedded">Embedded</mat-option>
                <mat-option value="Compute">Compute</mat-option>
              </mat-select>
            </mat-form-field>
            <mat-form-field appearance="outline" class="slicer-field">
              <mat-label>Funding Status</mat-label>
              <mat-select [(ngModel)]="projFilter.status">
                <mat-option value="">All</mat-option>
                <mat-option value="fully">Funded by BU</mat-option>
                <mat-option value="partial">Funding Under Review/Negotiation</mat-option>
              </mat-select>
            </mat-form-field>
            <mat-form-field appearance="outline" class="slicer-field">
              <mat-label>FY / Quarter</mat-label>
              <mat-select [(ngModel)]="projFilter.fy">
                <mat-option value="">All Quarters</mat-option>
                <mat-option value="Q2 FY26">Q2 FY26</mat-option>
                <mat-option value="Q3 FY26">Q3 FY26</mat-option>
                <mat-option value="Q4 FY26">Q4 FY26</mat-option>
                <mat-option value="Q1 FY27">Q1 FY27</mat-option>
              </mat-select>
            </mat-form-field>
            <mat-form-field appearance="outline" class="slicer-field">
              <mat-label>Reporting Manager</mat-label>
              <mat-select [(ngModel)]="projFilter.manager">
                <mat-option value="">All Managers</mat-option>
                <mat-option value="Alvin Huan">Alvin Huan</mat-option>
                <mat-option value="Fai Fan">Fai Fan</mat-option>
                <mat-option value="Jeffrey Weyman">Jeffrey Weyman</mat-option>
                <mat-option value="Luugi Marsan">Luugi Marsan</mat-option>
              </mat-select>
            </mat-form-field>
            @if (projFilter.bu || projFilter.status || projFilter.fy || projFilter.manager) {
              <button class="clear-filters-btn" (click)="clearProjFilter()">
                <mat-icon>close</mat-icon> Clear
              </button>
            }
          </div>

          <!-- KPI tiles -->
          <div class="summary-bar">
            <div class="summary-tile">
              <span class="tile-label">Total Sized Budget</span>
              <span class="tile-value">$3.12M</span>
            </div>
            <div class="summary-tile">
              <span class="tile-label">Total BU Approved</span>
              <span class="tile-value">$1.99M</span>
              <span class="tile-pct">64% of sized</span>
            </div>
            <div class="summary-tile">
              <span class="tile-label">Projects</span>
              <span class="tile-value">{{ filteredProjData.length }}</span>
            </div>
            <div class="summary-tile green">
              <span class="tile-label">Funded by BU</span>
              <span class="tile-value">{{ projFullyFundedCount }}</span>
              <span class="tile-pct">{{ filteredProjData.length ? ((projFullyFundedCount / filteredProjData.length) * 100 | number:'1.0-0') + '%' : '—' }} of projects</span>
            </div>
            <div class="summary-tile amber">
              <span class="tile-label">Under Review / Negotiation</span>
              <span class="tile-value">{{ projPartialFundedCount }}</span>
              <span class="tile-pct">{{ filteredProjData.length ? ((projPartialFundedCount / filteredProjData.length) * 100 | number:'1.0-0') + '%' : '—' }} of projects</span>
            </div>
            <!-- Not Funded removed — parked: add back if needed when BU rejects projects fully -->
          </div>

          <!-- Chart: Sized vs BU Approved -->
          <div class="chart-and-table">
            <div class="chart-panel">
              <h4>Sized vs BU Approved Budget by Project</h4>
              <div class="bar-chart">
                @for (row of filteredProjData; track row.project) {
                  <div class="bar-row">
                    <span class="bar-label">{{ row.project }}</span>
                    <div class="bar-track">
                      <div class="bar-fill approved" [style.width.%]="row.approvedPct"
                        [matTooltip]="'BU Approved: ' + row.approved">
                        @if (row.approvedPct > 12) { {{ row.approved }} }
                      </div>
                      @if (row.gapPct > 0) {
                        <div class="bar-fill gap-bar" [style.width.%]="row.gapPct"
                          [matTooltip]="'Gap (Sized but not funded): ' + row.gap">
                          @if (row.gapPct > 8) { {{ row.gap }} }
                        </div>
                      }
                    </div>
                    <div class="bar-status-wrap">
                      <span class="bar-total">{{ row.sized }}</span>
                      <span class="funding-chip"
                        [class.chip-full]="row.status === 'fully'"
                        [class.chip-partial]="row.status === 'partial'">
                        {{ row.status === 'fully' ? 'Funded by BU' : 'Under Review' }}
                      </span>
                    </div>
                  </div>
                }
              </div>
              <div class="chart-legend">
                <span class="legend-item"><span class="dot approved-dot"></span> BU Approved</span>
                <span class="legend-item"><span class="dot gap-dot"></span> Sized but not funded (gap)</span>
              </div>
            </div>

            <div class="table-panel">
              <h4>Budget Detail by Project & Quarter</h4>
              <table class="report-table">
                <thead>
                  <tr>
                    <th>Project</th><th>BU</th>
                    <th>Q2 FY26</th><th>Q3 FY26</th><th>Q4 FY26</th><th>Q1 FY27</th>
                    <th>Sized Total</th><th>BU Approved</th><th>Gap</th><th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  @for (row of filteredProjData; track row.project) {
                    <tr [class.row-partial]="row.status === 'partial'">
                      <td class="project-name">{{ row.project }}</td>
                      <td class="bu-col">{{ row.bu }}</td>
                      <td>{{ row.q2 }}</td>
                      <td>{{ row.q3 }}</td>
                      <td>{{ row.q4 }}</td>
                      <td>{{ row.q1fy27 }}</td>
                      <td class="total-col">{{ row.sized }}</td>
                      <td class="total-col approved-col">{{ row.approved }}</td>
                      <td class="gap-col" [class.has-gap]="row.gap !== '$0'">{{ row.gap }}</td>
                      <td>
                        <span class="funding-chip"
                          [class.chip-full]="row.status === 'fully'"
                          [class.chip-partial]="row.status === 'partial'">
                          {{ row.status === 'fully' ? 'Funded by BU' : 'Under Review / Negotiation' }}
                        </span>
                      </td>
                    </tr>
                  }
                  <tr class="grand-total-row">
                    <td colspan="2"><strong>Grand Total</strong></td>
                    <td><strong>$312K</strong></td>
                    <td><strong>$780K</strong></td>
                    <td><strong>$1,080K</strong></td>
                    <td><strong>$946K</strong></td>
                    <td><strong>$3.12M</strong></td>
                    <td><strong>$1.99M</strong></td>
                    <td class="has-gap"><strong>$1.13M</strong></td>
                    <td></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      }

      <!-- Fund Breakdown between Directors -->
      @if (reportType === 'manager') {
        <div class="report-body">
          <div class="summary-bar">
            <div class="summary-tile">
              <span class="tile-label">Total Projected Cost</span>
              <span class="tile-value">$3.12M</span>
            </div>
            <div class="summary-tile">
              <span class="tile-label">Directors</span>
              <span class="tile-value">{{ directorCostData.length }}</span>
            </div>
            <div class="summary-tile">
              <span class="tile-label">Total People</span>
              <span class="tile-value">21</span>
            </div>
          </div>

          <div class="chart-and-table">
            <!-- Visual: horizontal bars per director, color-coded, sized proportionally -->
            <div class="chart-panel">
              <h4>Projected Cost by Director</h4>
              <div class="dir-chart">
                @for (dir of directorCostData; track dir.name) {
                  <div class="dir-chart-row" (click)="toggleDirectorBar(dir.name)">
                    <div class="dir-chart-left">
                      <span class="dir-expand-icon">
                        <mat-icon>{{ expandedDirectorBars.has(dir.name) ? 'expand_less' : 'expand_more' }}</mat-icon>
                      </span>
                      <span class="dir-name">{{ dir.name }}</span>
                      <span class="dir-mgr-count">{{ dir.managers.length }} managers</span>
                    </div>
                    <div class="dir-bar-area">
                      <div class="dir-bar-outer">
                        <div class="dir-bar-fill" [style.width.%]="dir.pct" [style.background]="dir.color"
                          [matTooltip]="dir.name + ': ' + dir.cost">
                          @if (dir.pct > 15) { <span class="dir-bar-label">{{ dir.cost }}</span> }
                        </div>
                      </div>
                      <span class="dir-bar-total">{{ dir.cost }}</span>
                      <span class="dir-bar-pct">{{ dir.sharePct }}%</span>
                    </div>
                  </div>
                  <!-- Expanded: manager breakdown bars -->
                  @if (expandedDirectorBars.has(dir.name)) {
                    @for (mgr of dir.managers; track mgr.name) {
                      <div class="dir-chart-row mgr-bar-row">
                        <div class="dir-chart-left mgr-indent">
                          <span class="mgr-dot" [style.background]="dir.color + 'aa'"></span>
                          <span class="mgr-name">{{ mgr.name }}</span>
                        </div>
                        <div class="dir-bar-area">
                          <div class="dir-bar-outer mgr-bar-outer">
                            <div class="dir-bar-fill mgr-bar-fill" [style.width.%]="mgr.pct" [style.background]="dir.color + 'aa'"
                              [matTooltip]="mgr.name + ': ' + mgr.cost">
                              @if (mgr.pct > 20) { <span class="dir-bar-label">{{ mgr.cost }}</span> }
                            </div>
                          </div>
                          <span class="dir-bar-total">{{ mgr.cost }}</span>
                        </div>
                      </div>
                    }
                  }
                }
              </div>
              <div class="dir-legend">
                @for (dir of directorCostData; track dir.name) {
                  <span class="legend-item"><span class="dot" [style.background]="dir.color"></span> {{ dir.name }}</span>
                }
              </div>
            </div>

            <!-- Table: Director collapsed by default, click to expand managers -->
            <div class="table-panel">
              <h4>Cost Breakdown - Director / Manager</h4>
              <table class="report-table">
                <thead>
                  <tr><th>Director / Manager</th><th>% Share</th><th>Projected Cost</th></tr>
                </thead>
                <tbody>
                  @for (dir of directorCostData; track dir.name) {
                    <tr class="manager-row dir-table-row" (click)="toggleDirectorRow(dir.name)">
                      <td class="manager-name">
                        <mat-icon class="expand-icon">{{ expandedDirectorRows.has(dir.name) ? 'expand_less' : 'expand_more' }}</mat-icon>
                        <span class="dir-color-dot" [style.background]="dir.color"></span>
                        {{ dir.name }}
                        <span class="mgr-count-badge">{{ dir.managers.length }} managers</span>
                      </td>
                      <td class="pct-col">{{ dir.sharePct }}%</td>
                      <td class="total-col"><strong>{{ dir.cost }}</strong></td>
                    </tr>
                    @if (expandedDirectorRows.has(dir.name)) {
                      @for (mgr of dir.managers; track mgr.name) {
                        <tr class="resource-row">
                          <td class="resource-name">
                            <span class="mgr-dot-sm" [style.background]="dir.color + 'aa'"></span>
                            {{ mgr.name }}
                          </td>
                          <td class="pct-col">{{ mgr.pct | number:'1.0-0' }}%</td>
                          <td>{{ mgr.cost }}</td>
                        </tr>
                      }
                    }
                  }
                  <tr class="grand-total-row">
                    <td colspan="2"><strong>Grand Total</strong></td>
                    <td><strong>$3,118K</strong></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      }

      <!-- HC Distribution between Managers -->
      @if (reportType === 'director') {
        <div class="report-body">

          <!-- Filters -->
          <div class="slicer-bar">
            <mat-form-field appearance="outline" class="slicer-field">
              <mat-label>Fiscal Year</mat-label>
              <mat-select [(ngModel)]="hcFilter.fy" (ngModelChange)="onHcFyChange()">
                <mat-option value="FY26">FY26 (All Quarters)</mat-option>
                <mat-option value="FY27">FY27 (All Quarters)</mat-option>
                <mat-option value="FY28">FY28 (All Quarters)</mat-option>
              </mat-select>
            </mat-form-field>
            <mat-form-field appearance="outline" class="slicer-field">
              <mat-label>Quarter</mat-label>
              <mat-select [(ngModel)]="hcFilter.quarter">
                <mat-option value="">All Quarters</mat-option>
                @for (q of hcActiveQuarters; track q) {
                  <mat-option [value]="q">{{ q }}</mat-option>
                }
              </mat-select>
            </mat-form-field>
            <mat-form-field appearance="outline" class="slicer-field">
              <mat-label>HC Type</mat-label>
              <mat-select [(ngModel)]="hcFilter.hcType">
                <mat-option value="">All Types</mat-option>
                <mat-option value="Existing - FTE">Existing - FTE</mat-option>
                <mat-option value="Incremental - CONT">Incremental - CONT</mat-option>
              </mat-select>
            </mat-form-field>
            @if (hcFilter.quarter || hcFilter.hcType) {
              <button class="clear-filters-btn" (click)="clearHcFilter()">
                <mat-icon>close</mat-icon> Clear
              </button>
            }
          </div>

          <!-- Dynamic KPI tiles — one per active quarter -->
          <div class="summary-bar">
            <div class="summary-tile">
              <span class="tile-label">Total Approved HC</span>
              <span class="tile-value">{{ hcGrandTotal }}</span>
              <span class="tile-pct">{{ hcFilter.fy }}</span>
            </div>
            <div class="summary-tile">
              <span class="tile-label">Managers</span>
              <span class="tile-value">{{ hcManagerData.length }}</span>
            </div>
            @for (q of hcDisplayQuarters; track q) {
              <div class="summary-tile">
                <span class="tile-label">{{ q }}</span>
                <span class="tile-value">{{ getHcQTotal(q) }}</span>
              </div>
            }
          </div>

          <!-- Two-panel layout -->
          <div class="chart-and-table hc-layout">
            <!-- Horizontal bar chart — one row per manager, stacked quarters -->
            <div class="chart-panel hc-chart-panel">
              <h4>HC by Manager — {{ hcFilter.quarter || hcFilter.fy }}</h4>
              <div class="hc-hbar-chart">
                @for (mgr of hcManagerData; track mgr.name) {
                  @if (getMgrTotal(mgr) > 0) {
                    <div class="hc-hbar-row">
                      <span class="hc-hbar-label" [matTooltip]="mgr.name">{{ mgr.name }}</span>
                      <div class="hc-hbar-track">
                        @for (q of hcDisplayQuarters; track q) {
                          @if ((!hcFilter.quarter || hcFilter.quarter === q) && (mgr.hc[q] || 0) > 0) {
                            <div class="hc-hbar-seg"
                              [style.width.%]="getHcBarSegPct(mgr.hc[q] || 0)"
                              [style.background]="getHcQColor(q)"
                              [matTooltip]="q + ': ' + mgr.hc[q] + ' HC'">
                            </div>
                          }
                        }
                      </div>
                      <span class="hc-hbar-total">{{ getMgrTotal(mgr) }}</span>
                    </div>
                  }
                }
              </div>
              <div class="chart-legend" style="margin-top:12px;">
                @for (q of hcDisplayQuarters; track q) {
                  @if (!hcFilter.quarter || hcFilter.quarter === q) {
                    <span class="legend-item">
                      <span class="dot" [style.background]="getHcQColor(q)"></span> {{ q }}
                    </span>
                  }
                }
              </div>
            </div>

            <!-- Table -->
            <div class="table-panel">
              <h4>HC Reference Table</h4>
              <table class="report-table">
                <thead>
                  <tr>
                    <th>Manager</th>
                    @for (q of hcDisplayQuarters; track q) {
                      @if (!hcFilter.quarter || hcFilter.quarter === q) {
                        <th>{{ q }}</th>
                      }
                    }
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  @for (mgr of hcManagerData; track mgr.name) {
                    <tr>
                      <td class="manager-name">{{ mgr.name }}</td>
                      @for (q of hcDisplayQuarters; track q) {
                        @if (!hcFilter.quarter || hcFilter.quarter === q) {
                          <td>{{ mgr.hc[q] || '—' }}</td>
                        }
                      }
                      <td class="total-col">{{ getMgrTotal(mgr) }}</td>
                    </tr>
                  }
                  <tr class="grand-total-row">
                    <td><strong>Grand Total</strong></td>
                    @for (q of hcDisplayQuarters; track q) {
                      @if (!hcFilter.quarter || hcFilter.quarter === q) {
                        <td><strong>{{ getHcQTotal(q) }}</strong></td>
                      }
                    }
                    <td><strong>{{ hcGrandTotal }}</strong></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      }
    </div>
  `,
  styles: [`
    .reports-page { padding: 0; }
    .page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
    .header-left { display: flex; align-items: center; gap: 14px; }
    .report-icon { font-size: 32px; width: 32px; height: 32px; color: #ED1C24; }
    .page-header h2 { margin: 0; font-size: 22px; font-weight: 500; }
    .subtitle { margin: 2px 0 0; color: #666; font-size: 13px; }

    .report-body { display: flex; flex-direction: column; gap: 20px; }

    .summary-bar { display: flex; gap: 12px; flex-wrap: nowrap; }
    .summary-tile { background: white; border: 1px solid #e0e0e0; border-radius: 8px; padding: 14px 16px; flex: 1; min-width: 0; }
    .summary-tile.green { border-left: 4px solid #4caf50; }
    .summary-tile.amber { border-left: 4px solid #ff9800; }
    .summary-tile.red { border-left: 4px solid #ED1C24; }
    .tile-label { display: block; font-size: 10px; color: #888; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .tile-value { display: block; font-size: 22px; font-weight: 700; color: #1a1a2e; }
    .tile-pct { display: block; font-size: 11px; color: #aaa; margin-top: 3px; }

    .chart-and-table { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
    .chart-panel, .table-panel { background: white; border: 1px solid #e0e0e0; border-radius: 8px; padding: 20px; }
    .chart-panel h4, .table-panel h4 { margin: 0 0 16px; font-size: 14px; font-weight: 600; color: #333; }

    .bar-chart { display: flex; flex-direction: column; gap: 12px; }
    .bar-row { display: flex; align-items: center; gap: 10px; font-size: 12px; }
    .bar-label { width: 160px; text-align: right; color: #555; flex-shrink: 0; font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .bar-track { flex: 1; height: 28px; background: #f0f0f0; border-radius: 4px; overflow: hidden; display: flex; }
    .bar-fill { height: 100%; display: flex; align-items: center; padding: 0 8px; font-size: 11px; color: white; font-weight: 600; transition: width 0.3s; }
    .bar-fill.approved { background: #1a1a2e; }
    .bar-fill.pending { background: #90a4ae; }
    .bar-fill.manager-bar { border-radius: 0 4px 4px 0; }
    .bar-total { width: 70px; font-size: 12px; font-weight: 600; color: #333; flex-shrink: 0; }

    .chart-legend { display: flex; gap: 16px; margin-top: 12px; font-size: 12px; color: #666; }
    .legend-item { display: flex; align-items: center; gap: 6px; }
    .dot { width: 12px; height: 12px; border-radius: 50%; display: inline-block; }
    .approved-dot { background: #1a1a2e; }
    .pending-dot { background: #90a4ae; }
    .gap-dot { background: #ffcc80; }

    /* Slicer bar */
    .slicer-bar { display: flex; gap: 12px; flex-wrap: wrap; padding: 12px 0; margin-bottom: 8px; align-items: center; }
    .clear-filters-btn { display: flex; align-items: center; gap: 4px; padding: 0 14px; height: 40px; border: 1.5px solid #e0e0e0; border-radius: 20px; background: white; cursor: pointer; font-size: 13px; font-weight: 600; color: #555; font-family: inherit; transition: all 0.15s; white-space: nowrap; }
    .clear-filters-btn mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .clear-filters-btn:hover { background: #fdecea; border-color: #ED1C24; color: #ED1C24; }
    .slicer-field { width: 190px; }
    .slicer-field ::ng-deep .mat-mdc-form-field-subscript-wrapper { display: none; }

    /* Gap bar in chart */
    .bar-fill.gap-bar { background: #ffcc80; }

    /* Director chart */
    .dir-chart { display: flex; flex-direction: column; gap: 6px; }
    .dir-chart-row { display: flex; align-items: center; gap: 10px; cursor: pointer; padding: 4px 6px; border-radius: 6px; transition: background 0.12s; }
    .dir-chart-row:hover { background: #f5f5f5; }
    .dir-chart-left { display: flex; align-items: center; gap: 6px; width: 180px; flex-shrink: 0; }
    .dir-expand-icon mat-icon { font-size: 16px; width: 16px; height: 16px; color: #999; }
    .dir-name { font-size: 13px; font-weight: 600; color: #1a1a2e; }
    .dir-mgr-count { font-size: 10px; color: #aaa; }
    .dir-bar-area { display: flex; align-items: center; gap: 8px; flex: 1; }
    .dir-bar-outer { flex: 1; height: 28px; background: #f0f0f0; border-radius: 4px; overflow: hidden; }
    .dir-bar-fill { height: 100%; border-radius: 4px; display: flex; align-items: center; transition: width 0.4s; }
    .dir-bar-label { font-size: 11px; color: white; font-weight: 700; padding-left: 8px; white-space: nowrap; }
    .dir-bar-total { font-size: 12px; font-weight: 600; color: #333; width: 80px; text-align: right; flex-shrink: 0; }
    .dir-bar-pct { font-size: 11px; color: #aaa; width: 35px; text-align: right; flex-shrink: 0; }
    .dir-legend { display: flex; gap: 16px; margin-top: 12px; flex-wrap: wrap; font-size: 12px; color: #666; }

    /* Manager sub-rows in chart */
    .mgr-bar-row { padding-left: 20px !important; }
    .mgr-indent { padding-left: 24px !important; }
    .mgr-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
    .mgr-name { font-size: 12px; color: #555; }
    .mgr-bar-outer { height: 18px !important; }
    .mgr-bar-fill { height: 18px !important; opacity: 0.85; }

    /* Director table */
    .dir-table-row { cursor: pointer; }
    .dir-color-dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin: 0 6px; flex-shrink: 0; }
    .mgr-count-badge { font-size: 10px; color: #aaa; margin-left: 6px; }
    .pct-col { color: #666; font-size: 12px; width: 60px; }
    .mgr-dot-sm { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 8px; }
    .resource-name { padding-left: 36px !important; }

    /* Status chips in table */
    .funding-chip { font-size: 10px; padding: 2px 8px; border-radius: 10px; font-weight: 600; white-space: nowrap; }
    .chip-full { background: #e8f5e9; color: #2e7d32; }
    .chip-partial { background: #fff3e0; color: #e65100; }

    /* Table extras */
    .bu-col { color: #666; font-size: 12px; }
    .approved-col { color: #2e7d32; font-weight: 600; }
    .gap-col { color: #999; }
    .has-gap { color: #e65100 !important; font-weight: 600; }
    .row-partial { background: #fffbf5; }

    /* Bar status wrap */
    .bar-status-wrap { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; min-width: 110px; flex-shrink: 0; }
    .bar-total { font-size: 12px; font-weight: 600; color: #333; }
    .q2-dot { background: #1565c0; }
    .q3-dot { background: #ED1C24; }
    .q4-dot { background: #2e7d32; }

    /* HC distribution — grouped vertical bar chart */
    .hc-layout { gap: 16px; }
    .hc-chart-panel { flex: 1.2; }
    /* Horizontal bar chart */
    .hc-hbar-chart { display: flex; flex-direction: column; gap: 8px; padding: 4px 0; }
    .hc-hbar-row { display: flex; align-items: center; gap: 10px; }
    .hc-hbar-label { font-size: 12px; font-weight: 500; color: #333; min-width: 200px; max-width: 200px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-align: right; }
    .hc-hbar-track { flex: 1; height: 22px; background: #f5f5f5; border-radius: 4px; display: flex; overflow: hidden; }
    .hc-hbar-seg { height: 100%; transition: width 0.4s; }
    .hc-hbar-total { font-size: 12px; font-weight: 700; color: #1a1a2e; min-width: 36px; text-align: left; }

    .grouped-chart { display: flex; gap: 20px; align-items: flex-end; height: 160px; padding: 0 10px; }
    .grouped-row { display: flex; flex-direction: column; align-items: center; gap: 4px; flex: 1; }
    .bar-label { width: auto; text-align: center; font-size: 11px; color: #555; margin-top: 6px; }
    .grouped-bars { display: flex; gap: 3px; align-items: flex-end; }
    .mini-bar { width: 18px; border-radius: 3px 3px 0 0; display: flex; align-items: flex-start; justify-content: center; padding-top: 3px; font-size: 9px; color: white; font-weight: 600; min-height: 8px; }
    .q2-bar { background: #1565c0; }
    .q3-bar { background: #ED1C24; }
    .q4-bar { background: #2e7d32; }

    .report-table { width: 100%; border-collapse: collapse; font-size: 13px; }
    .report-table th { background: #f5f5f5; padding: 8px 12px; text-align: left; font-weight: 600; color: #444; border-bottom: 2px solid #e0e0e0; }
    .report-table td { padding: 8px 12px; border-bottom: 1px solid #f0f0f0; }
    .project-name, .manager-name { font-weight: 500; }
    .manager-row { background: #f8f9ff; }
    .manager-name { display: flex; align-items: center; gap: 4px; font-weight: 600; }
    .expand-icon { font-size: 16px; width: 16px; height: 16px; color: #666; }
    .resource-row td { padding-left: 28px; color: #555; font-size: 12px; }
    .total-col { font-weight: 600; color: #1a1a2e; }
    .grand-total-row { background: #1a1a2e; color: white; }
    .grand-total-row td { color: white; padding: 10px 12px; }
  `]
})
export class ReportsComponent implements OnInit {
  reportType = 'project';
  reportConfig: any = { title: 'Fund Breakdown By Projects', subtitle: '' };

  constructor(private route: ActivatedRoute) {}

  ngOnInit() {
    this.route.data.subscribe(data => {
      this.reportType = data['reportType'] || 'project';
      const configs: any = {
        project: { title: 'Fund Breakdown By Projects', subtitle: 'Approved budget and headcount breakdown by project' },
        manager: { title: 'Fund Breakdown between Directors', subtitle: 'Projected cost breakdown by director and their direct reports' },
        director: { title: 'HC Distribution between Managers', subtitle: 'Approved headcount distribution across managers and their teams' }
      };
      this.reportConfig = configs[this.reportType] || configs.project;
    });
  }

  // Filter state for Fund Breakdown By Projects
  projFilter = { bu: '', status: '', fy: '', manager: '' };

  clearProjFilter() { this.projFilter = { bu: '', status: '', fy: '', manager: '' }; }
  clearHcFilter() { this.hcFilter = { fy: 'FY26', quarter: '', hcType: '' }; }

  // Sized = what PM submitted during sizing. Approved = what BU confirmed funding for.
  // status: 'fully' = approved === sized. 'partial' = approved < sized.
  // Real DB numbers as of June 2026:
  // Eris v2.0: 55.5 HC → $1.10M (active/funded)
  // KRK1 New Features v1.0: 39.9 HC → $886K (active/funded)
  // ECARX SW Tools CCB: 20 HC → $541K (pipeline, submitted)
  // Android EAP v1.3: 22 HC → $591K (pipeline, draft)
  // Total Sized: ~$3.12M | BU Approved (active only): ~$1.99M
  projectFundingData = [
    { project: 'Eris v2.0',              bu: 'Embedded', manager: 'Alvin Huan',    q2: '$110K', q3: '$275K', q4: '$374K', q1fy27: '$341K', sized: '$1.10M', approved: '$1.10M', gap: '$0',    approvedPct: 100, gapPct: 0,  status: 'fully'   },
    { project: 'KRK1 New Features v1.0', bu: 'Embedded', manager: 'Fai Fan',       q2: '$89K',  q3: '$222K', q4: '$310K', q1fy27: '$265K', sized: '$886K',   approved: '$886K',   gap: '$0',    approvedPct: 100, gapPct: 0,  status: 'fully'   },
    { project: 'ECARX SW Tools CCB',     bu: 'Embedded', manager: 'Jeffrey Weyman', q2: '$54K',  q3: '$135K', q4: '$189K', q1fy27: '$163K', sized: '$541K',   approved: '$0',      gap: '$541K', approvedPct: 0,   gapPct: 100, status: 'partial' },
    { project: 'Android EAP v1.3',       bu: 'Embedded', manager: 'Luugi Marsan',  q2: '$59K',  q3: '$148K', q4: '$207K', q1fy27: '$177K', sized: '$591K',   approved: '$0',      gap: '$591K', approvedPct: 0,   gapPct: 100, status: 'partial' },
  ];

  get filteredProjData() {
    return this.projectFundingData.filter(r => {
      const matchBU = !this.projFilter.bu || r.bu === this.projFilter.bu;
      const matchStatus = !this.projFilter.status || r.status === this.projFilter.status;
      const matchManager = !this.projFilter.manager || r.manager === this.projFilter.manager;
      return matchBU && matchStatus && matchManager;
    });
  }

  get projFullyFundedCount() { return this.filteredProjData.filter(r => r.status === 'fully').length; }
  get projPartialFundedCount() { return this.filteredProjData.filter(r => r.status === 'partial').length; }

  managerData = [
    { manager: 'Manager A', cost: '$956,550', pct: 52, color: '#1a1a2e',
      resources: [{ name: 'Resource A1', cost: '$868,985' }, { name: 'Resource A2', cost: '$87,565' }] },
  ];

  // Director → Manager hierarchy for "Fund Breakdown between Directors"
  expandedDirectorRows = new Set<string>();
  expandedDirectorBars = new Set<string>();

  // Org structure from MS Teams — Jeff Weyman (Sr. Director) with direct reports,
  // Tim Writer (Director) with his direct reports listed as sub-managers.
  // Total budget $3.12M distributed across teams proportionally.
  directorCostData = [
    {
      name: 'Jeff Weyman', cost: '$3.12M', pct: 100, sharePct: 100, color: '#1a1a2e',
      managers: [
        { name: 'Alvin Huan',       cost: '$1.10M', pct: 35 },   // Eris v2.0
        { name: 'Fai Fan',          cost: '$886K',  pct: 28 },   // KRK1
        { name: 'Luugi Marsan',     cost: '$591K',  pct: 19 },   // Android EAP
        { name: 'Tim Writer',       cost: '$541K',  pct: 17 },   // ECARX (via Tim's team)
        { name: 'Donald Cheung',    cost: '$0',     pct: 0  },
        { name: 'Alexander Deucher',cost: '$0',     pct: 0  },
        { name: 'Ray Huang',        cost: '$0',     pct: 0  },
        { name: 'Shimmer Huang',    cost: '$0',     pct: 0  },
        { name: 'Hui Yu',           cost: '$0',     pct: 0  },
      ]
    },
    {
      name: 'Tim Writer', cost: '$541K', pct: 17, sharePct: 17, color: '#ED1C24',
      managers: [
        { name: 'Slava Abramov',           cost: '$108K', pct: 20 },
        { name: 'Veerabadhran Gopalakrishnan', cost: '$97K', pct: 18 },
        { name: 'Pierre Jabbour',          cost: '$81K',  pct: 15 },
        { name: 'Leo Liu',                 cost: '$65K',  pct: 12 },
        { name: 'Pierre-Eric Pelloux-Prayer', cost: '$54K', pct: 10 },
        { name: 'Kenny Ho',                cost: '$54K',  pct: 10 },
        { name: 'Cordell Bloor',           cost: '$27K',  pct: 5  },
        { name: 'Tim Flink',               cost: '$27K',  pct: 5  },
        { name: 'Christian Koenig',        cost: '$14K',  pct: 3  },
        { name: 'Geoffrey McRae',          cost: '$7K',   pct: 1  },
        { name: 'Tom Rix',                 cost: '$4K',   pct: 1  },
        { name: 'Tom StDenis',             cost: '$3K',   pct: 1  },
      ]
    },
  ];

  toggleDirectorRow(name: string) {
    if (this.expandedDirectorRows.has(name)) this.expandedDirectorRows.delete(name);
    else this.expandedDirectorRows.add(name);
    this.expandedDirectorRows = new Set(this.expandedDirectorRows);
  }

  toggleDirectorBar(name: string) {
    if (this.expandedDirectorBars.has(name)) this.expandedDirectorBars.delete(name);
    else this.expandedDirectorBars.add(name);
    this.expandedDirectorBars = new Set(this.expandedDirectorBars);
  }

  directorData = [
    { name: 'Manager A', q2: 0.2, q3: 1.2, q4: 1.2 },
    { name: 'Manager B', q2: 1,   q3: 1,   q4: 1   },
  ];

  // HC Distribution between Managers — full multi-FY data
  hcFilter = { fy: 'FY26', quarter: '', hcType: '' };

  hcAllQuarters: Record<string, string[]> = {
    FY26: ['Q1 FY26', 'Q2 FY26', 'Q3 FY26', 'Q4 FY26'],
    FY27: ['Q1 FY27', 'Q2 FY27', 'Q3 FY27', 'Q4 FY27'],
    FY28: ['Q1 FY28', 'Q2 FY28', 'Q3 FY28', 'Q4 FY28'],
  };

  hcQColors: Record<string, string> = {
    'Q1': '#1565c0', 'Q2': '#ED1C24', 'Q3': '#2e7d32', 'Q4': '#6a1b9a'
  };

  // Real HC data per manager, derived from submitted sizing versions in DB:
  // HC distribution across all managers under Jeff Weyman and Tim Writer.
  // Real project managers have HC from DB. Tim Writer's team split proportionally by team size.
  hcManagerData: { name: string; hc: Record<string, number> }[] = [
    // ── Jeff Weyman direct reports with active projects ──
    { name: 'Alvin Huan',       hc: { 'Q1 FY26': 0, 'Q2 FY26': 5.5,  'Q3 FY26': 13.5, 'Q4 FY26': 18.5, 'Q1 FY27': 17.5, 'Q2 FY27': 0,   'Q3 FY27': 0,   'Q4 FY27': 0   } },
    { name: 'Fai Fan',          hc: { 'Q1 FY26': 0, 'Q2 FY26': 4.0,  'Q3 FY26': 9.9,  'Q4 FY26': 13.5, 'Q1 FY27': 12.5, 'Q2 FY27': 0,   'Q3 FY27': 0,   'Q4 FY27': 0   } },
    { name: 'Luugi Marsan',     hc: { 'Q1 FY26': 0, 'Q2 FY26': 2.0,  'Q3 FY26': 5.5,  'Q4 FY26': 7.5,  'Q1 FY27': 7.0,  'Q2 FY27': 0,   'Q3 FY27': 0,   'Q4 FY27': 0   } },
    { name: 'Donald Cheung',    hc: { 'Q1 FY26': 0, 'Q2 FY26': 0,    'Q3 FY26': 0,    'Q4 FY26': 0,    'Q1 FY27': 0,    'Q2 FY27': 0,   'Q3 FY27': 0,   'Q4 FY27': 0   } },
    { name: 'Alexander Deucher',hc: { 'Q1 FY26': 0, 'Q2 FY26': 0,    'Q3 FY26': 0,    'Q4 FY26': 0,    'Q1 FY27': 0,    'Q2 FY27': 0,   'Q3 FY27': 0,   'Q4 FY27': 0   } },
    { name: 'Ray Huang',        hc: { 'Q1 FY26': 0, 'Q2 FY26': 0,    'Q3 FY26': 0,    'Q4 FY26': 0,    'Q1 FY27': 0,    'Q2 FY27': 0,   'Q3 FY27': 0,   'Q4 FY27': 0   } },
    { name: 'Shimmer Huang',    hc: { 'Q1 FY26': 0, 'Q2 FY26': 0,    'Q3 FY26': 0,    'Q4 FY26': 0,    'Q1 FY27': 0,    'Q2 FY27': 0,   'Q3 FY27': 0,   'Q4 FY27': 0   } },
    { name: 'Hui Yu',           hc: { 'Q1 FY26': 0, 'Q2 FY26': 0,    'Q3 FY26': 0,    'Q4 FY26': 0,    'Q1 FY27': 0,    'Q2 FY27': 0,   'Q3 FY27': 0,   'Q4 FY27': 0   } },
    // ── Tim Writer's direct reports — ECARX project (20 HC Q2–Q4 FY26) split by team size ──
    { name: 'Slava Abramov',              hc: { 'Q1 FY26': 0, 'Q2 FY26': 0.5, 'Q3 FY26': 1.5, 'Q4 FY26': 2.0, 'Q1 FY27': 0, 'Q2 FY27': 0, 'Q3 FY27': 0, 'Q4 FY27': 0 } },
    { name: 'Veerabadhran Gopalakrishnan',hc: { 'Q1 FY26': 0, 'Q2 FY26': 0.5, 'Q3 FY26': 1.5, 'Q4 FY26': 2.0, 'Q1 FY27': 0, 'Q2 FY27': 0, 'Q3 FY27': 0, 'Q4 FY27': 0 } },
    { name: 'Pierre Jabbour',             hc: { 'Q1 FY26': 0, 'Q2 FY26': 0.5, 'Q3 FY26': 1.0, 'Q4 FY26': 1.5, 'Q1 FY27': 0, 'Q2 FY27': 0, 'Q3 FY27': 0, 'Q4 FY27': 0 } },
    { name: 'Leo Liu',                    hc: { 'Q1 FY26': 0, 'Q2 FY26': 0.5, 'Q3 FY26': 1.0, 'Q4 FY26': 1.0, 'Q1 FY27': 0, 'Q2 FY27': 0, 'Q3 FY27': 0, 'Q4 FY27': 0 } },
    { name: 'Pierre-Eric Pelloux-Prayer', hc: { 'Q1 FY26': 0, 'Q2 FY26': 0.5, 'Q3 FY26': 1.0, 'Q4 FY26': 1.0, 'Q1 FY27': 0, 'Q2 FY27': 0, 'Q3 FY27': 0, 'Q4 FY27': 0 } },
    { name: 'Kenny Ho',                   hc: { 'Q1 FY26': 0, 'Q2 FY26': 0,   'Q3 FY26': 0.5, 'Q4 FY26': 1.0, 'Q1 FY27': 0, 'Q2 FY27': 0, 'Q3 FY27': 0, 'Q4 FY27': 0 } },
    { name: 'Cordell Bloor',              hc: { 'Q1 FY26': 0, 'Q2 FY26': 0,   'Q3 FY26': 0.5, 'Q4 FY26': 0.5, 'Q1 FY27': 0, 'Q2 FY27': 0, 'Q3 FY27': 0, 'Q4 FY27': 0 } },
    { name: 'Tim Flink',                  hc: { 'Q1 FY26': 0, 'Q2 FY26': 0,   'Q3 FY26': 0,   'Q4 FY26': 0.5, 'Q1 FY27': 0, 'Q2 FY27': 0, 'Q3 FY27': 0, 'Q4 FY27': 0 } },
    { name: 'Christian Koenig',           hc: { 'Q1 FY26': 0, 'Q2 FY26': 0,   'Q3 FY26': 0,   'Q4 FY26': 0.5, 'Q1 FY27': 0, 'Q2 FY27': 0, 'Q3 FY27': 0, 'Q4 FY27': 0 } },
    { name: 'Geoffrey McRae',             hc: { 'Q1 FY26': 0, 'Q2 FY26': 0,   'Q3 FY26': 0,   'Q4 FY26': 0.5, 'Q1 FY27': 0, 'Q2 FY27': 0, 'Q3 FY27': 0, 'Q4 FY27': 0 } },
    { name: 'Tom Rix',                    hc: { 'Q1 FY26': 0, 'Q2 FY26': 0,   'Q3 FY26': 0,   'Q4 FY26': 0,   'Q1 FY27': 0, 'Q2 FY27': 0, 'Q3 FY27': 0, 'Q4 FY27': 0 } },
    { name: 'Tom StDenis',                hc: { 'Q1 FY26': 0, 'Q2 FY26': 0,   'Q3 FY26': 0,   'Q4 FY26': 0,   'Q1 FY27': 0, 'Q2 FY27': 0, 'Q3 FY27': 0, 'Q4 FY27': 0 } },
  ];

  get hcActiveQuarters(): string[] { return this.hcAllQuarters[this.hcFilter.fy] || []; }
  get hcDisplayQuarters(): string[] { return this.hcActiveQuarters; }

  onHcFyChange() { this.hcFilter.quarter = ''; }

  getHcQTotal(q: string): number {
    return Math.round(this.hcManagerData.reduce((s, m) => s + (m.hc[q] || 0), 0) * 10) / 10;
  }

  getMgrTotal(mgr: { hc: Record<string, number> }): number {
    const qs = this.hcFilter.quarter ? [this.hcFilter.quarter] : this.hcDisplayQuarters;
    return Math.round(qs.reduce((s, q) => s + (mgr.hc[q] || 0), 0) * 10) / 10;
  }

  get hcGrandTotal(): number {
    const qs = this.hcFilter.quarter ? [this.hcFilter.quarter] : this.hcDisplayQuarters;
    return Math.round(qs.reduce((s, q) => s + this.getHcQTotal(q), 0) * 10) / 10;
  }

  getHcBarWidth(val: number): number {
    const max = Math.max(...this.hcManagerData.map(m => this.getMgrTotal(m)), 0.01);
    return (val / max) * 100;
  }

  getHcVBarPct(val: number): number {
    const qs = this.hcFilter.quarter ? [this.hcFilter.quarter] : this.hcDisplayQuarters;
    const max = Math.max(...this.hcManagerData.flatMap(m => qs.map(q => m.hc[q] || 0)), 0.01);
    return (val / max) * 100;
  }

  // Segment width % relative to the manager with the highest total HC (for horizontal stacked bars)
  getHcBarSegPct(val: number): number {
    const maxTotal = Math.max(...this.hcManagerData.map(m => this.getMgrTotal(m)), 0.01);
    return (val / maxTotal) * 100;
  }

  getHcQColor(q: string): string {
    const qNum = q.split(' ')[0]; // "Q1", "Q2" etc.
    return this.hcQColors[qNum] || '#1a1a2e';
  }
}
