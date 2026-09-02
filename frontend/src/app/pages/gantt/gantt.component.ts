import { Component, ChangeDetectionStrategy, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { FormsModule } from '@angular/forms';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ApiService } from '../../services/api.service';
import { FilterBarComponent, FilterDef, FilterState } from '../../shared/filter-bar/filter-bar.component';
import { QuarterService } from '../../services/quarter.service';
import { inject } from '@angular/core';

interface Milestone { name: string; color: string; quarters: string[]; }
interface FunctionRow { name: string; location: string; hcType: string; hc: Record<string, number>; manager?: string; }
interface GanttProject {
  id: number; name: string; code: string; bu: string; color: string;
  expanded: boolean;
  versionId?: number;
  milestones: Milestone[];
  functions: FunctionRow[];
}

@Component({
  selector: 'app-gantt',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, MatIconModule, MatButtonModule, MatSelectModule, MatFormFieldModule, FormsModule, MatTooltipModule, MatProgressSpinnerModule, FilterBarComponent],
  template: `
    <div class="gantt-page">
      @if (loading) {
        <div style="display:flex;align-items:center;gap:12px;padding:24px;color:#888">
          <mat-spinner diameter="24"></mat-spinner><span>Loading live project data...</span>
        </div>
      }
      <div class="page-header">
        <div class="header-left">
          <mat-icon class="page-icon">show_chart</mat-icon>
          <div>
            <h2>Project HC Mountain View</h2>
            <p class="subtitle">Headcount ramp across quarters · Milestones marked · Click project to toggle function detail</p>
          </div>
        </div>
      </div>

      <!-- Quarter selector strip -->
      <div class="gantt-quarter-strip">
        <button class="gqs-nav" (click)="qs.prev()"><mat-icon>chevron_left</mat-icon></button>
        @for (q of qs.visibleQuarters(); track q) {
          <button class="gqs-pill"
            [class.gqs-selected]="qs.isSelected(q)"
            [class.gqs-current]="qs.isCurrent(q)"
            [class.gqs-past]="qs.isPast(q)"
            (click)="qs.jumpTo(q); cdr.detectChanges()"
            [matTooltip]="qs.isCurrent(q) ? 'Current quarter' : ''">
            {{ q }}
            @if (qs.isCurrent(q)) { <span class="gqs-dot"></span> }
          </button>
        }
        <button class="gqs-nav" (click)="qs.next()"><mat-icon>chevron_right</mat-icon></button>
        @if (!qs.isSelected(qs.currentQuarterLabel)) {
          <button class="gqs-today" (click)="qs.resetToToday(); cdr.detectChanges()">Today</button>
        }
      </div>

      <!-- Filters — unified filter bar -->
      <app-filter-bar
        [filters]="ganttFilterDefs"
        [options]="ganttFilterOptions"
        [selected]="ganttFilterSelected"
        [rowCount]="filteredProjects.length"
        (selectedChange)="onGanttFilterChange($event)">
      </app-filter-bar>

      <!-- Milestone legend -->
      <!-- Legend — two separate rows -->
      <div class="legend-wrap">
        @if (filteredProjects.length === 1 && filteredProjects[0].milestones.length > 0) {
          <div class="legend-row">
            <span class="legend-section-label">Milestones</span>
            @for (ms of visibleMilestoneLegend; track ms.name) {
              <span class="ms-legend-item">
                <span class="ms-dot" [style.background]="ms.color"></span> {{ ms.name }}
              </span>
            }
          </div>
        }
        <div class="legend-row">
          <span class="legend-section-label">Projects</span>
          @for (proj of filteredProjects; track proj.id) {
            <span class="ms-legend-item">
              <span class="ms-dot" [style.background]="proj.color"></span> {{ proj.name }}
            </span>
          }
        </div>
      </div>

      <!-- ── Mountain view ── -->
      <div class="chart-card">
          <div class="chart-card-header">
            <span class="chart-card-title">
              {{ chartMode === 'stacked' ? 'Combined HC Demand — All Projects Cumulative' : 'Actual HC per Project — Overlapping View' }}
            </span>
            <div class="chart-mode-toggle">
              <button class="mode-btn" [class.mode-active]="chartMode === 'overlap'" (click)="chartMode = 'overlap'">
                <mat-icon>show_chart</mat-icon> Overlapping
              </button>
              <button class="mode-btn" [class.mode-active]="chartMode === 'stacked'" (click)="chartMode = 'stacked'">
                <mat-icon>stacked_bar_chart</mat-icon> Cumulative
              </button>
              <button class="mode-btn" [class.mode-active]="showBaselineLine" (click)="showBaselineLine = !showBaselineLine">
                <mat-icon>space_bar</mat-icon> Org Baseline
              </button>
              <button class="mode-btn" [class.mode-active]="showCumulativeTrend && chartMode === 'overlap'" (click)="showCumulativeTrend = !showCumulativeTrend"
                [style.display]="chartMode === 'stacked' ? 'none' : ''">
                <mat-icon>trending_up</mat-icon> Trend Line
              </button>
            </div>
          </div>
          <!-- Legend -->
          <div class="combined-legend">
            @for (proj of filteredProjects; track proj.id) {
              <span class="leg-item">
                <span class="leg-swatch" [style.background]="proj.color + '99'"></span> {{ proj.name }}
              </span>
            }
            @if (showBaselineLine && orgBaselineHC) {
              <span class="leg-sep">|</span>
              <span class="leg-item">
                <span class="leg-baseline"></span> Org Baseline ({{ orgBaselineHC }} HC)
              </span>
            }
            @if (showCumulativeTrend) {
              <span class="leg-sep">|</span>
              <span class="leg-item">
                <span class="leg-line"></span> Cumulative Total
              </span>
            }
          </div>
          <div class="chart-wrap" style="position:relative">

            <!-- Crosshair tooltip — anchored inside chart-wrap -->
            @if (hoverQi >= 0) {
              <div class="crosshair-panel" [style.left.px]="hoverPanelX" [style.top.px]="32">
                <div class="crosshair-q">{{ activeQuarters[hoverQi] }}</div>
                @for (proj of filteredProjects; track proj.id) {
                  @if (getProjectTotal(proj, activeQuarters[hoverQi]) > 0) {
                    <div class="crosshair-row">
                      <span class="crosshair-dot" [style.background]="proj.color"></span>
                      <span class="crosshair-name">{{ proj.name }}</span>
                      <span class="crosshair-val">{{ getProjectTotal(proj, activeQuarters[hoverQi]) }} HC</span>
                    </div>
                  }
                }
                @if (showCumulativeTrend && chartMode === 'overlap') {
                  <div class="crosshair-total">
                    <span>Total</span>
                    <span>{{ getStackedTotal(activeQuarters[hoverQi]) }} HC</span>
                  </div>
                }
              </div>
            }

            <svg [attr.viewBox]="'0 0 ' + svgW + ' ' + svgH" class="mountain-svg" preserveAspectRatio="none"
              (mousemove)="onChartMouseMove($event)"
              (mouseleave)="hoverQi = -1">
              <!-- Y gridlines -->
              @for (tick of yTicks(chartMax); track tick) {
                <line [attr.x1]="padL" [attr.x2]="svgW - padR"
                      [attr.y1]="yPos(tick, chartMax)" [attr.y2]="yPos(tick, chartMax)"
                      stroke="#f0f0f0" stroke-width="1"/>
                <text [attr.x]="padL - 6" [attr.y]="yPos(tick, chartMax) + 4"
                      text-anchor="end" font-size="8" fill="#bbb">{{ tick }}</text>
              }
              <!-- X axis -->
              <line [attr.x1]="padL" [attr.x2]="svgW - padR"
                    [attr.y1]="svgH - padB" [attr.y2]="svgH - padB"
                    stroke="#ddd" stroke-width="1.5"/>

              <!-- Org baseline — horizontal dashed line at Jeff's org total HC -->
              @if (showBaselineLine) {
                <line [attr.x1]="padL" [attr.x2]="svgW - padR"
                      [attr.y1]="baselineLineY" [attr.y2]="baselineLineY"
                      stroke="#1565c0" stroke-width="2" stroke-dasharray="10,5"/>
                <!-- Badge label pinned at left edge -->
                <rect [attr.x]="padL + 4" [attr.y]="baselineLineY - 16"
                      width="116" height="15" rx="3" fill="#1565c0"/>
                <text [attr.x]="padL + 10" [attr.y]="baselineLineY - 5"
                      font-size="9" font-weight="700" fill="white">
                  {{ baselineIsAboveChart ? '↑ ' : '' }}Org Baseline · {{ orgBaselineHC }} HC
                </text>
              }

              <!-- Stacked / Cumulative mode -->
              @if (chartMode === 'stacked') {
                @for (proj of stackedLayers; track proj.id) {
                  <path [attr.d]="proj.areaD" [attr.fill]="proj.color" fill-opacity="0.2"/>
                  <path [attr.d]="proj.topLineD" [attr.stroke]="proj.color" fill="none"
                        stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" stroke-opacity="0.7"/>
                }
                @for (proj of stackedLayers; track proj.id) {
                  @for (q of activeQuarters; track q; let qi = $index) {
                    @if (getProjectTotal(getProjectById(proj.id), q) > 0) {
                      <circle [attr.cx]="xPos(qi)" [attr.cy]="yPos(getStackedTotalAt(proj.id, qi), chartMax)"
                              r="2" [attr.fill]="proj.color" stroke-width="0"
                              [matTooltip]="q + ': ' + getProjectTotal(getProjectById(proj.id), q) + ' HC'"/>
                    }
                  }
                }
                @for (q of activeQuarters; track q; let qi = $index) {
                  @if (getStackedTotal(q) > 0) {
                    <text [attr.x]="xPos(qi)" [attr.y]="yPos(getStackedTotal(q), chartMax) - 6"
                          text-anchor="middle" font-size="8" font-weight="600" fill="#555"
                          [matTooltip]="q + ' total: ' + getStackedTotal(q) + ' HC'">
                      {{ getStackedTotal(q) }}
                    </text>
                  }
                }
              }

              <!-- Milestone vertical markers — only shown when a single project is filtered -->
              @if (filteredProjects.length === 1) {
              @for (proj of filteredProjects; track proj.id) {
                @for (ms of proj.milestones; track ms.name) {
                  @for (mq of ms.quarters; track mq) {
                    @if (activeQuarters.indexOf(mq) >= 0) {
                      <!-- Thin colored vertical line -->
                      <line [attr.x1]="xPos(activeQuarters.indexOf(mq))"
                            [attr.x2]="xPos(activeQuarters.indexOf(mq))"
                            [attr.y1]="padT" [attr.y2]="svgH - padB"
                            [attr.stroke]="ms.color" stroke-width="1.5" stroke-opacity="0.5" stroke-dasharray="4,3"/>
                      <!-- Small colored diamond at top of the line -->
                      <polygon [attr.points]="msDiamondPoints(activeQuarters.indexOf(mq))"
                               [attr.fill]="ms.color" opacity="0.9"
                               [matTooltip]="proj.name + ' · ' + ms.name + ' · ' + mq"/>
                      <!-- Milestone name label -->
                      <text [attr.x]="xPos(activeQuarters.indexOf(mq)) + 4"
                            [attr.y]="padT + 10"
                            font-size="7" font-weight="700" [attr.fill]="ms.color" opacity="0.9">
                        {{ ms.name }}
                      </text>
                    }
                  }
                }
              }

              } <!-- end @if filteredProjects.length === 1 -->

              <!-- Overlapping mode -->
              @if (chartMode === 'overlap') {
              @for (proj of filteredProjects; track proj.id) {
                <path [attr.d]="overlapAreaPath(proj)" [attr.fill]="proj.color" fill-opacity="0.2"/>
                <path [attr.d]="overlapLinePath(proj)" [attr.stroke]="proj.color" fill="none"
                      stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" stroke-opacity="0.85"/>
                <!-- Dot + small label at every data point -->
                @for (q of activeQuarters; track q; let qi = $index) {
                  @if (getProjectTotal(proj, q) > 0) {
                    <circle [attr.cx]="xPos(qi)" [attr.cy]="yPos(getProjectTotal(proj, q), chartMax)"
                            r="2" [attr.fill]="proj.color" stroke-width="0"
                            [matTooltip]="proj.name + ' · ' + q + ': ' + getProjectTotal(proj, q) + ' HC'"/>
                    <!-- Labels removed — hover panel shows all values -->
                  }
                }
              }

              } <!-- end overlap @if -->

              <!-- Cumulative trend line — drawn on top of all project areas (overlap mode only) -->
              @if (showCumulativeTrend && chartMode === 'overlap') {
                <path [attr.d]="cumulativeTrendPath()" fill="none"
                      stroke="#c62828" stroke-width="2.5"
                      stroke-linejoin="round" stroke-linecap="round"
                      stroke-dasharray="6,3"/>
                @for (q of activeQuarters; track q; let qi = $index) {
                  @if (getStackedTotal(q) > 0) {
                    <circle [attr.cx]="xPos(qi)" [attr.cy]="yPos(getStackedTotal(q), chartMax)"
                            r="3" fill="#c62828" stroke="white" stroke-width="1.5"
                            [matTooltip]="'Total · ' + q + ': ' + getStackedTotal(q) + ' HC'"/>
                    <text [attr.x]="xPos(qi)" [attr.y]="yPos(getStackedTotal(q), chartMax) - 9"
                          text-anchor="middle" font-size="8" font-weight="700" fill="#c62828">
                      {{ getStackedTotal(q) }}
                    </text>
                  }
                }
              }

              <!-- Quarter labels — only active quarters -->
              @for (q of activeQuarters; track q; let qi = $index) {
                <text [attr.x]="xPos(qi)" [attr.y]="svgH - padB + 16"
                      text-anchor="middle" font-size="8" fill="#999">{{ q }}</text>
              }

              <!-- Crosshair vertical line -->
              @if (hoverQi >= 0) {
                <line [attr.x1]="xPos(hoverQi)" [attr.x2]="xPos(hoverQi)"
                      [attr.y1]="padT" [attr.y2]="svgH - padB"
                      stroke="#333" stroke-width="1" stroke-dasharray="4,3" opacity="0.5" pointer-events="none"/>
                <circle [attr.cx]="xPos(hoverQi)" [attr.cy]="svgH - padB"
                        r="3" fill="#333" opacity="0.5" pointer-events="none"/>
              }
            </svg>
          </div>
        </div>

      <!-- ── Individual project cards (expandable, shown below combined) ── -->
      @if (false) { <!-- kept for future use -->
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
                          text-anchor="end" font-size="8" fill="#bbb">{{ tick }}</text>
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
                          text-anchor="middle" font-size="8" fill="#999">{{ q }}</text>
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
    .filter-field-sm { width: 200px; }
    .filter-field ::ng-deep .mat-mdc-form-field-subscript-wrapper,
    .filter-field-sm ::ng-deep .mat-mdc-form-field-subscript-wrapper { display: none; }

    /* Legend */
    /* Legend — two rows */
    .legend-wrap { background: white; border: 1px solid #e8e8e8; border-radius: 8px; margin-top: 12px; margin-bottom: 16px; padding: 8px 16px; display: flex; flex-direction: column; gap: 6px; }
    .legend-row { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; font-size: 11px; }
    .legend-section-label { font-weight: 700; color: #1a1a2e; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; min-width: 70px; }
    .ms-legend-item { display: flex; align-items: center; gap: 4px; color: #555; font-size: 11px; }
    .ms-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }

    /* Combined chart card */
    .chart-card { background: white; border: 1px solid #e8e8e8; border-radius: 10px; padding: 16px 20px; margin-bottom: 20px; }
    .chart-card-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
    .chart-card-title { font-size: 14px; font-weight: 600; color: #1a1a2e; }
    .chart-mode-toggle { display: flex; border: 1px solid #e0e0e0; border-radius: 8px; overflow: hidden; }
    .mode-btn { display: flex; align-items: center; gap: 5px; padding: 6px 14px; border: none; background: white; cursor: pointer; font-size: 12px; font-family: inherit; color: #666; transition: all 0.15s; }
    .mode-btn mat-icon { font-size: 15px; width: 15px; height: 15px; }
    .mode-btn:first-child { border-right: 1px solid #e0e0e0; }
    .mode-active { background: #1a1a2e !important; color: white !important; }
    .baseline-control { display: flex; align-items: center; gap: 8px; font-size: 12px; color: #555; }
    .baseline-label { font-weight: 500; }
    .baseline-input { width: 72px; border: 1.5px solid #ddd; border-radius: 6px; padding: 4px 8px; font-size: 13px; font-weight: 700; color: #ED1C24; text-align: center; outline: none; font-family: inherit; }
    .baseline-input:focus { border-color: #ED1C24; }
    .combined-legend { display: flex; gap: 20px; align-items: center; margin-bottom: 12px; flex-wrap: wrap; }
    .leg-item { display: flex; align-items: center; gap: 6px; font-size: 12px; color: #555; }
    .leg-swatch { display: inline-block; width: 14px; height: 14px; border-radius: 3px; }
    .leg-line { display: inline-block; width: 24px; border-top: 2px dashed #ED1C24; }
    .leg-baseline { display: inline-block; width: 24px; border-top: 2px dashed #1565c0; }
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

    /* Crosshair tooltip */
    .crosshair-panel { position: absolute; top: 24px; background: rgba(26,26,46,0.92); color: white; border-radius: 8px; padding: 10px 14px; min-width: 160px; pointer-events: none; z-index: 10; backdrop-filter: blur(4px); box-shadow: 0 4px 16px rgba(0,0,0,0.3); }
    .crosshair-q { font-size: 11px; font-weight: 700; color: #aaa; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px; }
    .crosshair-row { display: flex; align-items: center; gap: 6px; padding: 3px 0; font-size: 12px; }
    .crosshair-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
    .crosshair-name { flex: 1; color: #ddd; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100px; }
    .crosshair-val { font-weight: 700; color: white; white-space: nowrap; }
    .crosshair-total { display: flex; justify-content: space-between; margin-top: 6px; padding-top: 6px; border-top: 1px solid rgba(255,255,255,0.15); font-size: 12px; font-weight: 700; color: #ED1C24; }

    /* Quarter strip */
    .gantt-quarter-strip { display: flex; align-items: center; gap: 4px; background: white; border: 1px solid #e8e8e8; border-radius: 8px; padding: 6px 10px; margin-bottom: 12px; overflow-x: auto; }
    .gantt-quarter-strip::-webkit-scrollbar { display: none; }
    .gqs-nav { background: none; border: 1px solid #e0e0e0; border-radius: 50%; width: 26px; height: 26px; display: flex; align-items: center; justify-content: center; cursor: pointer; flex-shrink: 0; color: #555; padding: 0; transition: all 0.15s; }
    .gqs-nav:hover { background: #f5f5f5; }
    .gqs-nav mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .gqs-pill { background: none; border: 1px solid transparent; border-radius: 16px; padding: 3px 10px; font-size: 11px; font-weight: 500; color: #888; cursor: pointer; white-space: nowrap; transition: all 0.15s; display: flex; align-items: center; gap: 3px; font-family: inherit; flex-shrink: 0; }
    .gqs-pill:hover { background: #f5f5f5; color: #333; border-color: #e0e0e0; }
    .gqs-past { color: #bbb; }
    .gqs-current { color: #1565c0; font-weight: 700; }
    .gqs-selected { background: #1a1a2e !important; color: white !important; border-color: #1a1a2e !important; }
    .gqs-dot { width: 5px; height: 5px; border-radius: 50%; background: #ED1C24; flex-shrink: 0; }
    .gqs-today { margin-left: 6px; background: none; border: 1.5px solid #ED1C24; border-radius: 12px; padding: 3px 10px; font-size: 11px; font-weight: 700; color: #ED1C24; cursor: pointer; font-family: inherit; transition: all 0.15s; flex-shrink: 0; }
    .gqs-today:hover { background: #ED1C24; color: white; }
  `]
})
export class GanttComponent implements OnInit {
  qs = inject(QuarterService);
  hoverQi = -1;
  hoverPanelX = 0;
  filterBU = '';
  loading = false;
  chartMode: 'stacked' | 'overlap' = 'overlap';
  showCumulativeTrend = false;
  showBaselineLine = true;
  orgBaselineHC = 240; // default until live count loads from RA_people

  constructor(private api: ApiService, public cdr: ChangeDetectorRef) {}

  ngOnInit() { this.loadData(); this.loadOrgBaseline(); }

  loadData() {
    this.loading = true;
    this.api.getSizingSummary(true).subscribe({
      next: (res: any) => {
        const rows: any[] = res.data || [];
        this.buildProjects(rows);
        this.loading = false;
        this.cdr.detectChanges();
      },
      error: () => { this.loading = false; }
    });
  }

  loadOrgBaseline() {
    this.api.getOrgHeadcount('Weyman, Jeff').subscribe({
      next: (res: any) => {
        const total = res?.data?.total ?? 0;
        this.orgBaselineHC = total > 0 ? total : 240; // guard: 0 means name mismatch in DB, use fallback
        this.cdr.detectChanges();
      },
      error: () => {
        this.orgBaselineHC = 240;
        this.cdr.detectChanges();
      }
    });
  }

  buildProjects(rows: any[]) {
    // Group rows by project — capture version_id and project_id for milestone loading
    const projMap = new Map<string, any>();
    rows.forEach(r => {
      if (!projMap.has(r.project)) {
        projMap.set(r.project, { name: r.project, bu: r.bu || '', version_id: r.version_id, project_id: r.project_id, functions: [] });
      }
      projMap.get(r.project).functions.push({
        name: r.fn, location: r.location, hcType: r.hcType, hc: r.hc, manager: r.manager_name || ''
      });
    });

    const colors = [
      '#1565c0', // strong blue
      '#2e7d32', // forest green
      '#c62828', // red
      '#6a1b9a', // purple
      '#f57f17', // amber
      '#00838f', // teal
      '#ad1457', // pink/crimson
      '#4527a0', // deep purple
      '#558b2f', // olive green
      '#d84315', // deep orange
      '#00695c', // dark teal
      '#283593', // indigo
    ];
    let idx = 0;
    this.projects = [...projMap.values()].map(p => ({
      id: idx + 1,
      name: p.name,
      code: '',
      bu: p.bu,
      versionId: p.version_id,
      color: colors[idx++ % colors.length],
      expanded: false,
      milestones: [],
      functions: p.functions
    }));

    // Derive quarters from actual data
    const qSet = new Set<string>();
    rows.forEach(r => Object.keys(r.hc).forEach(q => qSet.add(q)));
    const parse = (s: string) => { const m = s.match(/Q(\d) FY(\d{2})/); return m ? parseInt(m[2]) * 4 + parseInt(m[1]) : 0; };
    this.quarters = [...qSet].sort((a, b) => parse(a) - parse(b));

    // Load milestones for each project from its version
    this.loadAllMilestones();
  }

  loadAllMilestones() {
    const msColors: Record<string, string> = {
      Concept: '#9c27b0', Feasibility: '#3f51b5', BTO: '#03a9f4',
      'Bring Up Exit': '#4caf50', AFEr: '#8bc34a', AFOr: '#ff9800', GA: '#ED1C24',
      LSD: '#00796b', ES: '#388e3c', PC: '#689f38', PR: '#afb42b',
      LSC: '#0097a7',
    };
    this.projects.forEach(proj => {
      if (!proj.versionId) return;
      this.api.getMilestones(proj.versionId).subscribe({
        next: (res: any) => {
          const dbMs: { milestone_name: string; start_date: string; end_date: string }[] = res.data || [];
          proj.milestones = dbMs
            .filter(m => m.start_date)
            .map(m => {
              const quarters: string[] = [];
              if (m.start_date) quarters.push(this.dateToQuarter(m.start_date));
              if (m.end_date) {
                const eq = this.dateToQuarter(m.end_date);
                if (!quarters.includes(eq)) quarters.push(eq);
              }
              return { name: m.milestone_name, color: msColors[m.milestone_name] || '#888', quarters };
            });
          this.cdr.detectChanges();
        },
        error: () => {}
      });
    });
  }

  dateToQuarter(dateStr: string): string {
    if (!dateStr) return '';
    const [y, m] = dateStr.split('-').map(Number);
    const q = Math.ceil(m / 3);
    // AMD fiscal year: FY starts in Feb, so month 2 (Feb) = start of new FY
    // FY = calendar year if month >= 2, else calendar year (Jan is still prior FY)
    const fy = m >= 2 ? y : y - 1;
    return `Q${q} FY${String(fy).slice(-2)}`;
  }

  // SVG layout constants
  readonly svgW = 900;
  readonly svgH = 320;
  readonly svgHsm = 220;
  readonly padL = 36;
  readonly padR = 20;
  readonly padT = 24;
  readonly padB = 28;

  quarters: string[] = [];

  get colW(): number {
    const len = this.activeQuarters.length;
    return (this.svgW - this.padL - this.padR) / Math.max(len - 1, 1);
  }

  // xPos based on activeQuarters index
  xPos(qi: number): number {
    const usableW = this.svgW - this.padL - this.padR;
    const len = Math.max(this.activeQuarters.length - 1, 1);
    return this.padL + (qi / len) * usableW;
  }

  // When a single project is selected and its milestones are loaded, show only those.
  // Otherwise show the full standard milestone list.
  get visibleMilestoneLegend(): { name: string; color: string }[] {
    if (this.filteredProjects.length === 1 && this.filteredProjects[0].milestones.length > 0) {
      // Deduplicate by name (a milestone may span two quarters)
      const seen = new Set<string>();
      return this.filteredProjects[0].milestones
        .filter(m => { if (seen.has(m.name)) return false; seen.add(m.name); return true; })
        .map(m => ({ name: m.name, color: m.color }));
    }
    // Default: show standard milestone types
    return [
      { name: 'Concept',       color: '#9c27b0' },
      { name: 'Feasibility',   color: '#3f51b5' },
      { name: 'BTO',           color: '#03a9f4' },
      { name: 'Bring Up Exit', color: '#4caf50' },
      { name: 'AFEr',          color: '#8bc34a' },
      { name: 'AFOr',          color: '#ff9800' },
      { name: 'GA',            color: '#ED1C24' },
    ];
  }

  projects: GanttProject[] = [];
  // --- old mockup removed ---
  _old_projects: GanttProject[] = [
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

  get uniqueBUs(): string[] {
    return [...new Set(this.projects.map(p => p.bu).filter(Boolean))].sort();
  }

  // Only quarters that have any HC across filtered projects
  get activeQuarters(): string[] {
    const all = this.quarters.filter(q => this.getStackedTotal(q) > 0);
    const selected = this.qs.selectedQuarter();
    const parse = (s: string) => { const m = s.match(/Q(\d) FY(\d{2})/); return m ? parseInt(m[2]) * 4 + parseInt(m[1]) : 0; };
    const selectedKey = parse(selected);
    // Show from selected quarter onwards; if selected is beyond data range show all
    const fromSelected = all.filter(q => parse(q) >= selectedKey);
    return fromSelected.length > 0 ? fromSelected : all;
  }

  // ── Unified filter bar ──────────────────────────────────────────────────
  ganttFilterSelected: FilterState = { bu: [], project: [], manager: [], hcType: [], location: [] };

  readonly ganttFilterDefs: FilterDef[] = [
    { key: 'bu',       label: 'BU',       width: '140px' },
    { key: 'project',  label: 'Project',  width: '200px' },
    { key: 'manager',  label: 'Manager',  width: '180px' },
    { key: 'hcType',   label: 'HC Type',  width: '165px' },
    { key: 'location', label: 'Location', width: '155px' },
  ];

  get ganttFilterOptions(): { [key: string]: string[] } {
    const sel = this.ganttFilterSelected;

    const buOpts = this.uniqueBUs;

    const afterBu = sel['bu'].length
      ? this.projects.filter(p => sel['bu'].includes(p.bu))
      : this.projects;
    const projOpts = [...new Set(afterBu.map(p => p.name))].sort();

    const afterProj = sel['project'].length
      ? afterBu.filter(p => sel['project'].includes(p.name))
      : afterBu;
    const hcTypeOpts = [...new Set(afterProj.flatMap(p => p.functions.map((f: any) => f.hcType)).filter(Boolean))].sort();

    const afterHcType = sel['hcType'].length
      ? afterProj.map(p => ({ ...p, functions: p.functions.filter((f: any) => sel['hcType'].includes(f.hcType)) }))
      : afterProj;
    const locationOpts = [...new Set(afterHcType.flatMap(p => p.functions.map((f: any) => f.location)).filter(Boolean))].sort();
    const managerOpts = [...new Set(afterProj.flatMap(p => p.functions.map((f: any) => f.manager).filter(Boolean)))].sort();

    return { bu: buOpts, project: projOpts, manager: managerOpts, hcType: hcTypeOpts, location: locationOpts };
  }

  onGanttFilterChange(state: FilterState) {
    this.ganttFilterSelected = state;
  }

  get filteredProjects(): GanttProject[] {
    const sel = this.ganttFilterSelected;
    return this.projects
      .filter(p => {
        const matchBu   = !sel['bu'].length     || sel['bu'].includes(p.bu);
        const matchProj = !sel['project'].length || sel['project'].includes(p.name);
        return matchBu && matchProj;
      })
      .map(p => {
        // Filter functions by hcType and location — affects the HC totals in the chart
        const fns = p.functions.filter((f: any) => {
          const matchHcType   = !sel['hcType'].length   || sel['hcType'].includes(f.hcType);
          const matchLocation = !sel['location'].length  || sel['location'].includes(f.location);
          const matchManager  = !sel['manager']?.length  || sel['manager'].includes(f.manager || '');
          return matchHcType && matchLocation && matchManager;
        });
        return { ...p, functions: fns };
      })
      .filter(p => p.functions.length > 0); // hide projects with no matching functions
  }

  // Sort largest-peak first so smaller areas render on top
  get sortedBySize(): GanttProject[] {
    return [...this.filteredProjects].sort((a, b) => this.getProjPeak(b) - this.getProjPeak(a));
  }

  // AMD baseline HC — editable by user in the chart header
  baselineHC = 40;

  // Get cumulative stacked total up to and including a specific project at a quarter index
  getStackedTotalAt(projId: number, qi: number): number {
    const q = this.activeQuarters[qi];
    let cum = 0;
    for (const p of this.filteredProjects) {
      cum += this.getProjectTotal(p, q);
      if (p.id === projId) break;
    }
    return Math.round(cum * 10) / 10;
  }

  getProjectById(id: number): GanttProject {
    return this.filteredProjects.find(p => p.id === id) || { id: 0, name: '', code: '', bu: '', color: '', expanded: false, milestones: [], functions: [] };
  }

  // Stacked total across all projects per quarter
  getStackedTotal(q: string): number {
    return Math.round(
      this.filteredProjects.reduce((s, p) => s + this.getProjectTotal(p, q), 0) * 10
    ) / 10;
  }

  get chartMax(): number {
    const projPeak = Math.max(...this.filteredProjects.map(p => this.getProjPeak(p)), 1);
    const stackedPeak = (this.chartMode === 'stacked' || this.showCumulativeTrend)
      ? Math.max(...this.activeQuarters.map(q => this.getStackedTotal(q)), 1)
      : 0;
    return Math.max(projPeak, stackedPeak) * 1.15;
  }

  // Y position for baseline, clamped to top of chart area if baseline > chartMax
  get baselineLineY(): number {
    if (this.orgBaselineHC <= this.chartMax) {
      return this.yPos(this.orgBaselineHC, this.chartMax);
    }
    return this.padT; // clamped to top
  }

  get baselineIsAboveChart(): boolean {
    return this.orgBaselineHC > this.chartMax;
  }

  get combinedMax(): number { return this.chartMax; }

  // Builds stacked layer data — each project's band sits on top of cumulative sum below it
  get stackedLayers(): { id: number; color: string; areaD: string; topLineD: string }[] {
    const projects = this.filteredProjects;
    const max = this.chartMax;
    const baseline = this.svgH - this.padB;

    // Cumulative bottom per quarter index
    const aq = this.activeQuarters;
    const cumulative = new Array(aq.length).fill(0);

    return projects.map(proj => {
      const topPts = aq.map((q, i) => {
        const bottom = cumulative[i];
        const top = bottom + this.getProjectTotal(proj, q);
        return { x: this.xPos(i), topY: this.yPos(top, max), botY: this.yPos(bottom, max), top, bottom };
      });

      // Update cumulative for next layer
      aq.forEach((q, i) => {
        cumulative[i] += this.getProjectTotal(proj, q);
      });

      if (topPts.every(p => p.top === p.bottom)) return { id: proj.id, color: proj.color, areaD: '', topLineD: '' };

      // Draw across ALL quarters — zero-HC quarters sit at bottom (no gap)
      // Area: top edge forward, bottom edge backward
      const topEdge = topPts.map(p => `${p.x},${p.topY}`).join(' L ');
      const botEdge = [...topPts].reverse().map(p => `${p.x},${p.botY}`).join(' L ');
      const areaD = `M ${topPts[0].x},${topPts[0].botY} L ${topEdge} L ${topPts[topPts.length-1].x},${topPts[topPts.length-1].botY} L ${botEdge} Z`;
      const topLineD = 'M ' + topPts.map(p => `${p.x},${p.topY}`).join(' L ');

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
  _xPosOld(qi: number): number {
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
    const step = max <= 5 ? 1 : max <= 15 ? 2 : max <= 30 ? 5 : max <= 60 ? 10 : max <= 150 ? 25 : 50;
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

  // Build full path across all quarters — zero-HC quarters default to zero (no gaps)
  private buildSegments(proj: GanttProject, yFn: (v: number) => number): { lineD: string; areaD: string }[] {
    const pts = this.activeQuarters.map((q, i) => ({
      x: this.xPos(i), y: yFn(this.getProjectTotal(proj, q)), v: this.getProjectTotal(proj, q)
    }));
    if (pts.every(p => p.v === 0)) return [];
    const baseline = this.svgH - this.padB;
    const lineD = 'M ' + pts.map(p => `${p.x},${p.y}`).join(' L ');
    const areaD = `M ${pts[0].x},${baseline} L ${pts.map(p => `${p.x},${p.y}`).join(' L ')} L ${pts[pts.length-1].x},${baseline} Z`;
    return [{ lineD, areaD }];
  }

  // Show cumulative label only at first, last, local peaks and local troughs
  isCumulativeKeyPoint(qi: number): boolean {
    const aq = this.activeQuarters;
    const n = aq.length;
    if (qi === 0 || qi === n - 1) return true;
    const prev = this.getStackedTotal(aq[qi - 1]);
    const curr = this.getStackedTotal(aq[qi]);
    const next = this.getStackedTotal(aq[qi + 1]);
    return (curr >= prev && curr >= next) || (curr <= prev && curr <= next); // local peak or trough
  }

  // Project label Y — when cumulative trend is on, go below the dot to avoid red labels above.
  // But if the dot is too close to the X axis, flip back above to avoid quarter label collision.
  projectLabelY(val: number): number {
    const dotY = this.yPos(val, this.chartMax);
    const xAxisY = this.svgH - this.padB;
    if (!this.showCumulativeTrend) return dotY - 5;           // trend off: always above
    if (dotY > xAxisY - 22) return dotY - 5;                 // near bottom: flip above
    return dotY + 13;                                         // normal: below
  }

  // Crosshair — snap to nearest quarter on mouse move
  onChartMouseMove(event: MouseEvent) {
    const svg = event.currentTarget as SVGElement;
    const rect = svg.getBoundingClientRect();
    const rawX = (event.clientX - rect.left) / rect.width * this.svgW;
    const aq = this.activeQuarters;
    if (!aq.length) return;
    // Find closest quarter index
    let closest = 0;
    let minDist = Math.abs(rawX - this.xPos(0));
    for (let i = 1; i < aq.length; i++) {
      const d = Math.abs(rawX - this.xPos(i));
      if (d < minDist) { minDist = d; closest = i; }
    }
    this.hoverQi = closest;
    // Position panel relative to the svg element — in px within svg width
    const panelW = 180;
    const lineXPx = this.xPos(closest) / this.svgW * rect.width;
    // Flip to left side if too close to right edge
    this.hoverPanelX = lineXPx + panelW + 16 > rect.width
      ? lineXPx - panelW - 8
      : lineXPx + 12;
  }

  // Cumulative trend line — sum of all projects per quarter
  cumulativeTrendPath(): string {
    const pts = this.activeQuarters
      .map((q, i) => ({ x: this.xPos(i), y: this.yPos(this.getStackedTotal(q), this.chartMax), v: this.getStackedTotal(q) }))
      .filter(p => p.v > 0);
    if (pts.length < 2) return '';
    return 'M ' + pts.map(p => `${p.x},${p.y}`).join(' L ');
  }

  // Overlap mode — each project drawn from zero, only where HC > 0
  overlapLinePath(proj: GanttProject): string {
    return this.buildSegments(proj, v => this.yPos(v, this.chartMax)).map(s => s.lineD).join(' ');
  }

  overlapAreaPath(proj: GanttProject): string {
    return this.buildSegments(proj, v => this.yPos(v, this.chartMax)).map(s => s.areaD).join(' ');
  }

  diamondPoints(qi: number, val: number, max: number): string {
    const cx = this.xPos(qi);
    const cy = this.yPos(val, max);
    const s = 6;
    return `${cx},${cy - s} ${cx + s},${cy} ${cx},${cy + s} ${cx - s},${cy}`;
  }

  // Diamond pinned at the top of the chart area for milestone markers
  msDiamondPoints(qi: number): string {
    const cx = this.xPos(qi);
    const cy = this.padT + 16; // just below the top edge
    const s = 5;
    return `${cx},${cy - s} ${cx + s},${cy} ${cx},${cy + s} ${cx - s},${cy}`;
  }
}
