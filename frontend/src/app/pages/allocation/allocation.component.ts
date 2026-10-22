import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { Subject, takeUntil } from 'rxjs';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { FilterBarComponent, FilterDef, FilterState } from '../../shared/filter-bar/filter-bar.component';
import { StickyScrollbarDirective } from '../../directives/sticky-scrollbar.directive';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ApiService } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';
import { QuarterService } from '../../services/quarter.service';
import { HcLineChartComponent, HcPoint, HcPointKind } from '../../shared/hc-line-chart/hc-line-chart.component';
import { inject } from '@angular/core';

@Component({
  selector: 'app-allocation',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule, FormsModule,
    MatIconModule, MatButtonModule, MatSelectModule, MatFormFieldModule,
    MatInputModule, MatProgressSpinnerModule, MatSnackBarModule, MatTooltipModule,
    FilterBarComponent, StickyScrollbarDirective, HcLineChartComponent
  ],
  template: `
    <div class="alloc-page">

      <!-- Page header -->
      <div class="alloc-header">
        <div class="header-left">
          <mat-icon class="header-icon">people_alt</mat-icon>
          <div>
            <h2>Resource Allocation</h2>
            <p class="header-sub">Mark team capability per project · Algorithm computes HC assignments</p>
          </div>
        </div>

        <!-- Manager selector — elevated/admin only -->
        @if (isElevated) {
          <div class="mgr-selector">
            <span class="mgr-label">Viewing manager</span>
            <select class="mgr-select" [(ngModel)]="selectedManager" (ngModelChange)="onManagerChange()">
              <option value="">All Teams</option>
              @for (m of managerList; track m) {
                <option [value]="m">{{ m }}</option>
              }
            </select>
          </div>
        }
      </div>

      <!-- Tabs -->
      <div class="alloc-tabs">
        <button class="alloc-tab" [class.active]="activeTab === 'matrix'" (click)="setTab('matrix')">
          <mat-icon>grid_on</mat-icon> Eligibility Matrix
        </button>
        <!-- Steady State merged into Eligibility Matrix inline expansion -->
        <button class="alloc-tab" [class.active]="activeTab === 'summary'" (click)="setTab('summary')">
          <mat-icon>assignment</mat-icon> Project Allocation Summary
        </button>
        <button class="alloc-tab" [class.active]="activeTab === 'util'" (click)="setTab('util')">
          <mat-icon>bar_chart</mat-icon> Team Utilisation
        </button>
      </div>

      <!-- Loading -->
      @if (loading) {
        <div class="alloc-loading">
          <mat-spinner diameter="32"></mat-spinner>
          <span>Loading team data...</span>
        </div>
      } @else {

        <!-- ══ TAB 1: ELIGIBILITY MATRIX (+ Steady State inline) ══ -->
        @if (activeTab === 'matrix') {
          <div class="tab-content">

            <!-- Toolbar: assignment output download -->
            <div class="matrix-toolbar">
              <span class="matrix-toolbar-hint">Click a person to see their capacity, forecast and steady-state split.</span>
              @if (underReviewProjectCount > 0 || pipelineProjectCount > 0) {
                <div class="status-filter" role="group" aria-label="Filter projects by status">
                  <button type="button" class="exp-chip" [class.on]="projectStatusFilter === 'all'"
                    [attr.aria-pressed]="projectStatusFilter === 'all'" (click)="projectStatusFilter = 'all'">
                    All ({{ projects.length }})
                  </button>
                  <button type="button" class="exp-chip" [class.on]="projectStatusFilter === 'funded'"
                    [attr.aria-pressed]="projectStatusFilter === 'funded'" (click)="projectStatusFilter = 'funded'">
                    Funded ({{ fundedProjectCount }})
                  </button>
                  @if (pipelineProjectCount > 0) {
                    <button type="button" class="exp-chip" [class.on]="projectStatusFilter === 'pipeline'"
                      [attr.aria-pressed]="projectStatusFilter === 'pipeline'" (click)="projectStatusFilter = 'pipeline'">
                      Pipeline ({{ pipelineProjectCount }})
                    </button>
                  }
                  <button type="button" class="exp-chip" [class.on]="projectStatusFilter === 'review'"
                    [attr.aria-pressed]="projectStatusFilter === 'review'" (click)="projectStatusFilter = 'review'">
                    Under review ({{ underReviewProjectCount }})
                  </button>
                </div>
              }
              <div class="export-wrap">
                <button mat-flat-button color="primary" class="export-btn" type="button"
                  (click)="toggleExport()" [attr.aria-expanded]="showExport" aria-haspopup="dialog">
                  <mat-icon>download</mat-icon> Assignment Output
                </button>
                @if (showExport) {
                  <div class="export-backdrop" (click)="showExport = false"></div>
                  <div class="export-pop" role="dialog" aria-label="Download assignment output" (keydown.escape)="showExport = false">
                    <div class="export-title">Download assignment output</div>
                    <div class="export-sub">{{ selectedManager || 'All teams' }} · Excel (.xlsx)</div>

                    <div class="export-presets">
                      <button type="button" class="exp-chip" (click)="applyExportPreset('fy')">Current FY</button>
                      <button type="button" class="exp-chip" (click)="applyExportPreset('next4')">Next 4 quarters</button>
                      <button type="button" class="exp-chip" (click)="applyExportPreset('around')">Past 4 + next 8</button>
                      <button type="button" class="exp-chip" (click)="applyExportPreset('all')">All data</button>
                    </div>

                    <div class="exp-row">
                      <span class="exp-label">From</span>
                      <select class="exp-select" [ngModel]="exportFromFy" (ngModelChange)="exportFromFy = $event; exportAllData = false" aria-label="From fiscal year">
                        @for (fy of exportFyOptions; track fy) { <option [ngValue]="fy">FY{{ fy % 100 }}</option> }
                      </select>
                      <select class="exp-select exp-select--q" [ngModel]="exportFromQ" (ngModelChange)="exportFromQ = $event; exportAllData = false" aria-label="From quarter">
                        @for (q of [1,2,3,4]; track q) { <option [ngValue]="q">Q{{ q }}</option> }
                      </select>
                    </div>
                    <div class="exp-row">
                      <span class="exp-label">To</span>
                      <select class="exp-select" [ngModel]="exportToFy" (ngModelChange)="exportToFy = $event; exportAllData = false" aria-label="To fiscal year">
                        @for (fy of exportFyOptions; track fy) { <option [ngValue]="fy">FY{{ fy % 100 }}</option> }
                      </select>
                      <select class="exp-select exp-select--q" [ngModel]="exportToQ" (ngModelChange)="exportToQ = $event; exportAllData = false" aria-label="To quarter">
                        @for (q of [1,2,3,4]; track q) { <option [ngValue]="q">Q{{ q }}</option> }
                      </select>
                    </div>

                    <div class="exp-row">
                      <span class="exp-label">Columns</span>
                      <div class="exp-seg" role="group" aria-label="Column granularity">
                        <button type="button" [class.on]="exportFormat === 'monthly'" (click)="exportFormat = 'monthly'">Monthly</button>
                        <button type="button" [class.on]="exportFormat === 'weekly'" (click)="exportFormat = 'weekly'">Weekly</button>
                      </div>
                    </div>

                    <div class="exp-summary">{{ exportRangeSummary }}</div>

                    <div class="exp-actions">
                      <button mat-button type="button" (click)="showExport = false">Cancel</button>
                      <button mat-flat-button color="primary" type="button" [disabled]="exportBusy" (click)="downloadAssignment()">
                        @if (exportBusy) { <mat-spinner diameter="16" style="display:inline-block;margin-right:6px"></mat-spinner> }
                        Download
                      </button>
                    </div>
                  </div>
                }
              </div>
            </div>

            <!-- Filters for the matrix columns (same bar as Projects / Sizing / Gantt). Manager is chosen at the top of the page. -->
            <app-filter-bar class="matrix-fb"
              [filters]="matrixFilterDefs"
              [options]="matrixFilterOptions"
              [selected]="matrixFilterSelected"
              [rowCount]="matrixProjects.length"
              (selectedChange)="onMatrixFilterChange($event)">
            </app-filter-bar>

            <!-- KPI board: four compact tiles (2×2) + over-capacity gap + team load trend, all the same height -->
            @if (ssmFilteredPeople.length > 0) {
              <div class="kpi-board" [class.kpi-board--4]="!!selectedManager && !!planPreview">
                <div class="kpi-small-grid">
                  <div class="ss-kpi" style="border-left-color:#1565c0">
                    <div class="ss-kpi-label">People in View</div>
                    <div class="ss-kpi-value">{{ ssmFilteredPeople.length }}</div>
                    <div class="ss-kpi-sub">{{ selectedManager || 'All teams' }}</div>
                  </div>
                  <div class="ss-kpi" style="border-left-color:#e65100">
                    <div class="ss-kpi-label">Active SS Tasks</div>
                    <div class="ss-kpi-value">{{ getTeamSsTaskCount() }}</div>
                    <div class="ss-kpi-sub">Assigned to this team</div>
                  </div>
                  <div class="ss-kpi" style="border-left-color:#2e7d32">
                    <div class="ss-kpi-label">Total SS Effort</div>
                    <div class="ss-kpi-value">{{ getTeamSsEffort() | number:'1.1-1' }}</div>
                    <div class="ss-kpi-sub">HC across SS tasks</div>
                  </div>
                  <div class="ss-kpi" style="border-left-color:#6a1b9a">
                    <div class="ss-kpi-label">Avg SS / Person</div>
                    <div class="ss-kpi-value">{{ getTeamSsAvg() | number:'1.2-2' }}</div>
                    <div class="ss-kpi-sub">For people with SS tasks</div>
                  </div>
                </div>

                <!-- Needs attention: one line per project that still has demand nobody covers -->
                @if (selectedManager && planPreview) {
                  <div class="kpi-card attn-card" [class.attn-card--ok]="attnItems.length === 0">
                    <div class="kpi-card-head">
                      <span class="kpi-card-title">Needs attention</span>
                      @if (planLoading) { <mat-spinner diameter="12"></mat-spinner> }
                      @if (planDirty) { <span class="attn-unsaved">Unsaved ticks</span> }
                    </div>
                    <div class="attn-list">
                      @for (a of attnItems; track a.project_id) {
                        <button type="button" class="attn-row" [class.attn-row--on]="focusProjectId === a.project_id" (click)="setFocusProject(a.project_id, true)">
                          <span class="attn-dot" [class.attn-dot--hire]="a.kind === 'hire'"></span>
                          <span class="attn-name" [matTooltip]="a.name">{{ a.name }}</span>
                          <span class="attn-msg" [class.attn-msg--hire]="a.kind === 'hire'">{{ a.msg }}</span>
                        </button>
                      }
                      @if (attnItems.length === 0) {
                        <div class="gap-ok-note">All sized demand is covered by the team.</div>
                      }
                    </div>
                  </div>
                }

                <!-- Over-capacity gap: people whose load in the chosen quarter exceeds 1.0 HC -->
                @if (gapByQuarter.size > 0) {
                  <div class="kpi-card gap-card" [class.gap-card--ok]="gapInfo.over === 0">
                    <div class="kpi-card-head">
                      <span class="kpi-card-title">Over-capacity Gap</span>
                      <select class="gap-q-select" [ngModel]="gapQuarter" (ngModelChange)="onGapQuarterChange($event)" aria-label="Quarter for over-capacity gap">
                        @for (q of capacityQuarters; track q) { <option [value]="q">{{ q }}</option> }
                      </select>
                    </div>
                    <div class="gap-main">
                      <span class="gap-big" [class.gap-big--ok]="gapInfo.over === 0">{{ gapInfo.over > 0 ? '+' : '' }}{{ gapInfo.over | number:'1.2-2' }}</span>
                      <span class="kpi-unit">HC</span>
                      <span class="gap-count">
                        @if (gapInfo.people.length) { {{ gapInfo.people.length }} {{ gapInfo.people.length === 1 ? 'person' : 'people' }} above 1.0 HC }
                        @else { Nobody above 1.0 HC }
                      </span>
                    </div>
                    <div class="gap-list">
                      @for (p of gapPeopleShown; track p.name) {
                        <div class="gap-row">
                          <span class="gap-name" [matTooltip]="p.name">{{ shortName(p.name) }}</span>
                          <span class="gap-bar"><span class="gap-bar-fill" [style.width.%]="(p.over / gapMax) * 100"></span></span>
                          <span class="gap-val">+{{ p.over | number:'1.2-2' }}</span>
                        </div>
                      }
                      @if (gapInfo.people.length > gapPeopleShown.length) {
                        <div class="gap-more">+ {{ gapInfo.people.length - gapPeopleShown.length }} more</div>
                      }
                      @if (!gapInfo.people.length) {
                        <div class="gap-ok-note">Everyone is within capacity this quarter.</div>
                      }
                    </div>
                    <div class="gap-foot">
                      <span>Spare capacity <strong>{{ gapInfo.spare | number:'1.1-1' }} HC</strong></span>
                      @if (peakGap && peakGap.quarter !== gapQuarter) {
                        <button type="button" class="gap-peak" (click)="onGapQuarterChange(peakGap.quarter)">
                          Worst: {{ peakGap.quarter }} · +{{ peakGap.over | number:'1.2-2' }} &rarr;
                        </button>
                      }
                    </div>
                  </div>
                }

                <!-- Team load vs capacity — line chart -->
                @if (teamTrend.length > 0) {
                  <div class="kpi-card trend-card">
                    <div class="kpi-card-head">
                      <span class="kpi-card-title">Team Load vs Capacity</span>
                      <mat-icon class="kpi-info" tabindex="0"
                        matTooltip="Blue line = team HC load per quarter (all projects + steady state). Red dashed line = capacity (people × 1.0 HC). Solid = recorded/planned data, dashed = forecast beyond the data. Red dots mark quarters where the team is over-subscribed.">info_outline</mat-icon>
                      @if (trendSummary) {
                        <span class="trend-chip" [class.trend-chip--over]="trendSummary.overCount > 0">
                          {{ trendSummary.overCount > 0 ? 'Over in ' + trendSummary.overCount + (trendSummary.overCount === 1 ? ' qtr' : ' qtrs') : 'Within capacity' }}
                        </span>
                      }
                    </div>
                    <app-hc-line-chart [points]="teamTrend" [capacity]="teamCapacity" [nowLabel]="currentQuarter" [height]="124" />
                    @if (trendSummary; as t) {
                      <div class="trend-read">
                        <span>Now <strong>{{ t.nowValue | number:'1.1-1' }}</strong> of {{ teamCapacity | number:'1.0-1' }} HC ({{ t.pct }}%)</span>
                        @if (t.overCount > 0) {
                          <span class="trend-sep">·</span><span>Over from <strong>{{ t.firstOver }}</strong>, peak {{ t.peakValue | number:'1.1-1' }} in {{ t.peakLabel }}</span>
                        } @else {
                          <span class="trend-sep">·</span><span>Peak ahead {{ t.peakValue | number:'1.1-1' }} in {{ t.peakLabel }}</span>
                        }
                      </div>
                    }
                  </div>
                }
              </div>
            }

            <!-- Eligibility matrix -->
            <div class="matrix-wrap" stickyScrollbar>
              <table class="matrix-table">
                <thead>
                  <tr>
                    <th class="person-th">Resource</th>
                    @for (p of matrixProjects; track p.project_id) {
                      <th class="proj-th" [class.proj-th--review]="p.status === 'under review'" [class.proj-th--focus]="focusProjectId === p.project_id">
                        <div class="proj-th-name proj-th-name--btn" role="button" tabindex="0"
                          [attr.aria-pressed]="focusProjectId === p.project_id"
                          matTooltip="Show people's effort breakdown for this project's quarters"
                          (click)="setFocusProject(p.project_id)" (keydown.enter)="setFocusProject(p.project_id)">{{ p.project_name }}</div>
                        <div class="proj-th-meta">{{ p.BU }}</div>
                        @if (p.status === 'under review') {
                          <div class="review-badge">Under review</div>
                        } @else if (p.status === 'pipeline') {
                          <div class="review-badge review-badge--pipeline">Pipeline</div>
                        }
                        <div class="proj-th-buttons">
                          <button class="hc-info-btn" (click)="openHcPanel(p, $event)" matTooltip="View HC breakdown per quarter">
                            <mat-icon style="font-size:11px;width:11px;height:11px">bar_chart</mat-icon>
                          </button>
                          <button class="finetune-btn" (click)="openFineTune(p)" matTooltip="Fine-tune effort per person">
                            <mat-icon style="font-size:11px;width:11px;height:11px">tune</mat-icon>
                          </button>
                        </div>
                      </th>
                    }
                  </tr>
                </thead>
                <tbody>
                  @for (person of team; track person.person_id) {
                    <!-- Person row — click name to expand capacity -->
                    <tr [class.person-row--expanded]="isExpanded(person.person_id)">
                      <td class="person-td person-td--clickable"
                        (click)="toggleExpanded(person.person_id)">
                        <div class="person-name">
                          <mat-icon class="expand-chevron">{{ isExpanded(person.person_id) ? 'expand_less' : 'expand_more' }}</mat-icon>
                          {{ person.display_name }}
                        </div>
                        <div class="person-meta">{{ person.designation }} · {{ person.location }}</div>
                      </td>
                      @for (proj of matrixProjects; track proj.project_id) {
                        <td class="matrix-td" [class.matrix-td--review]="proj.status === 'under review'">
                          <select class="cap-select"
                            [class.val-yes]="getElig(person.person_id, proj.project_id) !== ''"
                            [value]="getElig(person.person_id, proj.project_id)"
                            (focus)="focusProjectId = proj.project_id"
                            (change)="onEligChange($event, person.person_id, proj.project_id)">
                            <option value="">— No</option>
                            <option value="yes">✓ Yes</option>
                          </select>
                          @if (planCell(person.person_id, proj.project_id); as pc) {
                            <div class="plan-chip" [matTooltip]="pc.tip">+{{ pc.max | number:'1.2-2' }} HC</div>
                          }
                        </td>
                      }
                    </tr>
                    <!-- Inline capacity expansion row -->
                    @if (isExpanded(person.person_id) && capacityQuarters.length > 0) {
                      <tr class="capacity-inline-row">
                        <td [attr.colspan]="matrixProjects.length + 1" class="capacity-inline-td">
                          <div class="capacity-inline-wrap">
                            <!-- Split layout: pinned left panel + scrollable cards -->
                            <div class="capacity-split">
                              <!-- LEFT — pinned person name + configure -->
                              <div class="capacity-pin">
                                @if (personForecastMap.get(person.person_id); as pf2) {
                                  <span class="pattern-badge-sm pattern-{{pf2.pattern}}">{{ patternLabel(pf2.pattern) }}</span>
                                  @if (pf2.dominant_project) {
                                    <div style="font-size:10px;color:#555;margin-top:4px">↑ <strong>{{ pf2.dominant_project }}</strong></div>
                                  }
                                }
                                <div class="capacity-pin-hint">Solid = actual · Dashed = forecast</div>
                                <!-- Steady-state tasks this person is actually carrying (HC is calculated in the backend), plus any added via Configure SS -->
                                @let ssNames = ssTasksInUse(person.person_id);
                                @if (ssNames.length) {
                                  <div class="pin-ss" style="margin-top:10px">
                                    <div class="pin-ss-head"><span>Steady state</span></div>
                                    @for (t of ssNames; track t.name) {
                                      <div class="pin-ss-row">
                                        <span class="ss-dot" [style.background]="t.color"></span>
                                        <span class="pin-ss-name" [matTooltip]="t.name">{{ t.name }}</span>
                                      </div>
                                    }
                                  </div>
                                }
                                <button class="ss-pc-configure" style="margin-top:auto" (click)="openPersonPanel(person)">
                                  <mat-icon style="font-size:13px;width:13px;height:13px">settings</mat-icon> Configure SS
                                </button>
                              </div>
                              <!-- RIGHT — scrollable cards -->
                              <div class="capacity-cards-scroll">
                            <!-- Slider anchored to current quarter, spans full width -->
                            @if (false) {
                              <div class="capacity-inline-slider">
                                <span class="cap-slider-label">{{ capacityQuarters[0] }}</span>
                                <input type="range" class="cap-slider-input"
                                  [min]="0" [max]="capacityQuarters.length - capacityWindowSize"
                                  [value]="capacityWindowStart"
                                  (input)="capacityWindowStart = +$any($event.target).value">
                                <span class="cap-slider-label">{{ capacityQuarters[capacityQuarters.length - 1] }}</span>
                                <span class="cap-slider-current">
                                  {{ displayedCapacityQuarters[0] }} → {{ displayedCapacityQuarters[displayedCapacityQuarters.length-1] }}
                                  @if (forecastData && displayedCapacityQuarters.some(q => isProjectedQuarter(q))) {
                                    <span style="color:#90caf9;margin-left:6px">· includes forecast</span>
                                  }
                                </span>
                              </div>
                            }
                            <!-- Effort breakdown: each bar is the person's 1.0 HC for the quarter; updates live with the ticks -->
                            <div class="bd-wrap">
                              @if (planBackendOld) {
                                <div class="bd-stale" role="alert">The backend is running an older version, so these bars show saved data only and will not change when you tick. Restart the backend (pm2 restart) and reload this page.</div>
                              }
                              @if (focusProject; as fp) {
                                @let rt = roomTag(person.person_id);
                                <div class="bd-head">
                                  <span class="bd-proj">{{ fp.project_name }}</span>
                                  <span class="bd-need">{{ focusNeedText }}</span>
                                  <span class="bd-tag" [class.bd-tag--ok]="rt.tone === 'ok'" [class.bd-tag--no]="rt.tone === 'no'" [class.bd-tag--good]="rt.tone === 'good'">{{ rt.text }}</span>
                                </div>
                              } @else {
                                <div class="bd-head"><span class="bd-need">All quarters from now. Each bar is 1.0 HC. Click a project name in the header (or a Yes box) to jump to that project's quarters.</span></div>
                              }
                              <div class="bd-rows">
                                @for (q of breakdownQuarters; track q) {
                                  @let st = stackFor(person.person_id, q);
                                  <div class="bd-row">
                                    <span class="bd-rq">{{ q }}</span>
                                    <div class="bd-hbar" [class.bd-hbar--over]="st.over > 0.004" role="img" [attr.aria-label]="q + ': ' + (st.total | number:'1.2-2') + ' of 1.0 HC used'">
                                      @for (s of st.projects; track s.project_id) {
                                        <div class="bd-seg" [class.bd-focus]="s.focus" [class.bd-auto]="s.auto > 0 && !s.focus"
                                          [style.width.%]="s.hc / st.scale * 100" [style.background]="s.focus ? null : s.color"
                                          [matTooltip]="s.name + ': ' + (s.hc | number:'1.2-2') + ' HC' + (s.auto > 0 ? ' (incl. +' + (s.auto | number:'1.2-2') + ' planned)' : '')">
                                          @if (s.hc >= 0.12) { <span>{{ s.auto > 0 ? '+ ' : '' }}{{ shortProj(s.name) }} {{ s.hc | number:'1.2-2' }}</span> }
                                        </div>
                                      }
                                      @for (s of st.ss; track s.name) {
                                        <div class="bd-seg bd-ss" [style.width.%]="s.hc / st.scale * 100" [matTooltip]="s.name + ' (steady state): ' + (s.hc | number:'1.2-2') + ' HC' + (s.was ? ' — was ' + (s.was | number:'1.2-2') : '')">
                                          @if (s.hc >= 0.12) { <span>{{ s.name }} {{ s.hc | number:'1.2-2' }}</span> }
                                        </div>
                                      }
                                      @if (st.free > 0.004) {
                                        <div class="bd-seg bd-free" [style.width.%]="st.free / st.scale * 100" [matTooltip]="'Free: ' + (st.free | number:'1.2-2') + ' HC'">
                                          @if (st.free >= 0.12) { <span>{{ st.free | number:'1.2-2' }} free</span> }
                                        </div>
                                      }
                                    </div>
                                    <span class="bd-rtot" [class.bd-rtot--over]="st.over > 0.004">{{ st.total | number:'1.2-2' }}</span>
                                  </div>
                                }
                              </div>
                            </div>

                              </div><!-- end capacity-cards-scroll -->
                            </div><!-- end capacity-split -->
                          </div>
                        </td>
                      </tr>
                    }
                  }
                </tbody>
              </table>
            </div>

            <!-- Capacity section moved inline into matrix rows above -->
            @if (false) {
              <div class="capacity-section">
                <div class="capacity-header">
                  <span class="capacity-title">Team Capacity per Quarter</span>
                  <span class="capacity-hint">Based on eligibility selections above · 1.0 HC = full-time · Red = over capacity</span>
                  @if (capacityQuarters.length > capacityWindowSize) {
                    <div class="capacity-slider-wrap">
                      <span class="capacity-range-label">{{ displayedCapacityQuarters[0] }} → {{ displayedCapacityQuarters[displayedCapacityQuarters.length-1] }}</span>
                      <input type="range" class="capacity-slider"
                        [min]="0" [max]="capacityQuarters.length - capacityWindowSize"
                        [value]="capacityWindowStart"
                        (input)="capacityWindowStart = +$any($event.target).value">
                    </div>
                  }
                </div>
                <div class="capacity-table-wrap">
                  <table class="capacity-table">
                    <thead>
                      <tr>
                        <th class="cap-person-th">Resource</th>
                        @for (q of displayedCapacityQuarters; track q) {
                          <th class="cap-q-th">{{ q }}</th>
                        }
                      </tr>
                    </thead>
                    <tbody>
                      @for (person of team; track person.person_id) {
                        <tr>
                          <td class="cap-person-td">{{ person.display_name }}</td>
                          @for (q of displayedCapacityQuarters; track q) {
                            @let hc = getPersonQuarterHC(person.person_id, q);
                            @let pct = getCapacityPct(person.person_id, q);
                            <td class="cap-q-td" [matTooltip]="hc + ' / 1.0 HC committed in ' + q">
                              <div class="cap-bar-wrap">
                                <div class="cap-bar"
                                  [style.width.%]="pct"
                                  [class.cap-bar--full]="hc >= 0.9 && hc <= 1.0"
                                  [class.cap-bar--over]="hc > 1.0"
                                  [class.cap-bar--available]="hc < 0.9">
                                </div>
                              </div>
                              <span class="cap-val" [class.cap-val--over]="hc > 1.0">
                                {{ hc > 0 ? (hc | number:'1.2-2') : '—' }}
                              </span>
                            </td>
                          }
                        </tr>
                      }
                    </tbody>
                  </table>
                </div>
              </div>
            }

            <div class="matrix-footer">
              <span class="matrix-count">{{ team.length }} people · {{ matrixProjects.length }} projects</span>
              <button mat-flat-button color="primary" (click)="saveMatrix()" [disabled]="saving">
                {{ saving ? 'Saving...' : 'Save Matrix' }}
              </button>
            </div>

            <!-- HC Info panel -->
            @if (showHcPanel && hcPanelProject) {
              <div class="hcp-backdrop" (click)="showHcPanel=false"></div>
              <div class="hcp-panel" role="dialog" aria-label="HC breakdown per quarter"
                [style.top.px]="hcPanelFlip ? null : hcPanelY" [style.bottom.px]="hcPanelFlip ? hcPanelY : null"
                [style.left.px]="hcPanelX" (keydown.escape)="showHcPanel=false">
                <div class="hcp-header">
                  <div>
                    <div class="hcp-title">{{ hcPanelProject.project_name }}</div>
                    <div class="hcp-sub">{{ selectedManager ? selectedManager : 'All teams' }} · per quarter</div>
                    <div class="hcp-legend">
                      <span class="hcp-key"><i class="hcp-dot" [style.background]="selectedManager ? '#1565c0' : '#2e7d32'"></i>{{ selectedManager ? 'Demand (this manager\\'s sizing)' : 'Demand (all sizing)' }}</span>
                      <span class="hcp-key"><i class="hcp-dot" style="background:#ef6c00"></i>{{ selectedManager ? 'Supply (team HC)' : 'Supply (all people HC)' }}</span>
                    </div>
                    @if (selectedManager && hcPanelRows.length > 0 && !hcPanelHasDemand) {
                      <div class="hcp-note">No sizing under {{ selectedManager }} for this project — showing team supply only.</div>
                    }
                  </div>
                  <button (click)="showHcPanel=false"
                    style="background:none;border:1px solid #e0e0e0;border-radius:50%;width:22px;height:22px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;padding:0;color:#888;font-size:12px;line-height:1">
                    ✕
                  </button>
                </div>
                <div class="hcp-body" [style.max-height.px]="hcPanelMaxH - 60">
                  @if (hcPanelRows.length === 0) {
                    <div style="color:#aaa;font-size:12px;padding:8px 0">No sizing or assigned HC found for this project.</div>
                  } @else {
                    @for (q of hcPanelVisibleRows; track q.quarter) {
                      <div class="hcp-qblock" [class.hcp-qblock--now]="q.quarter === currentQuarter">
                        @if (q.sized !== null) {
                          <div class="hcp-row">
                            <span class="hcp-q">{{ q.quarter }}</span>
                            <div class="hcp-bar-wrap">
                              <div class="hcp-bar" [style.width.%]="hcPanelMax > 0 ? (q.sized / hcPanelMax * 100) : 0"
                                [style.background]="selectedManager ? '#1565c0' : '#2e7d32'"></div>
                            </div>
                            <span class="hcp-val">{{ q.sized | number:'1.1-1' }} HC</span>
                          </div>
                        }
                        @if (q.team !== null) {
                          <div class="hcp-row">
                            <span class="hcp-q">{{ q.sized === null ? q.quarter : '' }}</span>
                            <div class="hcp-bar-wrap">
                              <div class="hcp-bar" [style.width.%]="hcPanelMax > 0 ? (q.team / hcPanelMax * 100) : 0" style="background:#ef6c00"></div>
                            </div>
                            <span class="hcp-val" style="color:#e65100">{{ q.team | number:'1.1-1' }} HC</span>
                          </div>
                        }
                      </div>
                    }
                    @if (hcPanelHiddenCount > 0) {
                      <button type="button" class="hcp-more" (click)="hcPanelShowAll = true">Show {{ hcPanelHiddenCount }} earlier quarters</button>
                    }
                  }
                </div>
              </div>
            }

            <!-- Fine-tune panel -->
            @if (showFineTune && fineTuneProject) {
              <div class="ft-overlay" (click)="showFineTune=false"></div>
              <div class="ft-panel">
                <div class="ft-header">
                  <div>
                    <div class="ft-title">Fine-tune Effort — {{ fineTuneProject.project_name }}</div>
                    <div class="ft-sub">Set HC per person per quarter · blank = algorithm decides · 0 = not assigned</div>
                  </div>
                  <button mat-icon-button (click)="showFineTune=false"><mat-icon>close</mat-icon></button>
                </div>
                <div class="ft-body">
                  @if (ftLoading) {
                    <div style="display:flex;align-items:center;gap:10px;padding:20px;color:#888">
                      <mat-spinner diameter="20"></mat-spinner> Loading...
                    </div>
                  } @else {
                    <div style="overflow-x:auto">
                      <table class="ft-table">
                        <thead>
                          <tr>
                            <th class="ft-person-hd">Person</th>
                            @for (q of ftQuarters; track q) { <th>{{ q }}</th> }
                            <th>Capacity</th>
                          </tr>
                        </thead>
                        <tbody>
                          @for (person of ftEligiblePeople; track person.person_id) {
                            <tr>
                              <td class="ft-person-td">
                                <div class="person-name">{{ person.display_name }}</div>
                                <div class="person-meta">{{ person.designation }} · {{ person.location }}</div>
                              </td>
                              @for (q of ftQuarters; track q) {
                                <td style="text-align:center;padding:4px">
                                  <input class="ft-input"
                                    type="number" min="0" max="1" step="0.05"
                                    [value]="getFtEffort(person.person_id, q)"
                                    (change)="setFtEffort(person.person_id, q, $event)"
                                    [placeholder]="getAutoHc(q)"
                                    [matTooltip]="'Auto: ' + getAutoHc(q) + ' HC (allotment ÷ eligible people)'">
                                </td>
                              }
                              <td style="text-align:center">
                                <div class="ft-cap-bar-wrap">
                                  <div class="ft-cap-bar"
                                    [style.width.%]="getPersonTotalEffort(person.person_id) * 100"
                                    [style.background]="getPersonTotalEffort(person.person_id) > 1 ? '#c62828' : '#2e7d32'">
                                  </div>
                                </div>
                                <span style="font-size:10px;color:#888">{{ getPersonTotalEffort(person.person_id) | number:'1.2-2' }} / 1.0</span>
                              </td>
                            </tr>
                          }
                        </tbody>
                      </table>
                    </div>
                  }
                </div>
                <div class="ft-footer">
                  <span style="font-size:12px;color:#888">Changes auto-save · leave blank to let algorithm decide</span>
                  <button mat-flat-button color="primary" (click)="saveFineTune()">
                    <mat-icon>save</mat-icon> Save All
                  </button>
                </div>
              </div>
            }

          </div>
        }

        <!-- ══ TAB 2: PROJECT ALLOCATION SUMMARY ══ -->
        @if (activeTab === 'summary') {
          <div class="tab-content">

            <!-- KPI tiles -->
            <div class="kpi-bar">
              <div class="kpi-tile green">
                <span class="kpi-val">{{ coveredCount }}</span>
                <span class="kpi-label">Eligible assigned</span>
              </div>
              <div class="kpi-tile amber">
                <span class="kpi-val">{{ fallbackCount }}</span>
                <span class="kpi-label">Partially covered</span>
              </div>
              <div class="kpi-tile red">
                <span class="kpi-val">{{ gapCount }}</span>
                <span class="kpi-label">Gap</span>
              </div>
              @if (provisionalCount > 0) {
                <div class="kpi-tile prov">
                  <span class="kpi-val">{{ provisionalCount }}</span>
                  <span class="kpi-label">Provisional (under review)</span>
                </div>
              }
              <div class="kpi-tile">
                <span class="kpi-val">{{ summaryData.length }}</span>
                <span class="kpi-label">Total projects</span>
              </div>
            </div>

            <!-- Accordion per project -->
            @for (proj of summaryData; track proj.project_id) {
              <div class="pas-card">
                <div class="pas-header" (click)="toggleProject(proj.project_id)">
                  <mat-icon class="pas-icon">folder</mat-icon>
                  <span class="pas-name">{{ proj.project_name }}</span>
                  <div class="pas-chips">
                    <span class="chip chip-bu">{{ proj.BU }}</span>
                    <span class="chip chip-hc">{{ proj.total_sized_hc | number:'1.1-1' }} HC sized</span>
                    @if (proj.status === 'covered') {
                      <span class="chip chip-ok">✓ {{ proj.eligible_count }} Eligible</span>
                    } @else if (proj.status === 'fallback') {
                      <span class="chip chip-warn">⚠ Partial — some eligible</span>
                    } @else if (proj.status === 'provisional') {
                      <span class="chip chip-prov">Provisional — under review</span>
                    } @else {
                      <span class="chip chip-gap">⚡ Gap</span>
                    }
                  </div>
                  <mat-icon class="pas-chevron">{{ expandedProjects.has(proj.project_id) ? 'expand_less' : 'expand_more' }}</mat-icon>
                </div>

                @if (expandedProjects.has(proj.project_id)) {
                  <div class="pas-body">
                    @if (proj.assigned.length === 0) {
                      <div class="pas-gap-msg">
                        <mat-icon style="color:#c62828">warning</mat-icon>
                        No team member marked as Expert or Capable for this project.
                        Go to the Eligibility Matrix to assign resources.
                      </div>
                    } @else {
                      <table class="alloc-table">
                        <thead>
                          <tr>
                            <th>Resource</th>
                            <th>Location</th>
                            <th>Capability</th>
                            <th>Est. HC Allocation</th>
                            <th>Assignment</th>
                          </tr>
                        </thead>
                        <tbody>
                          @for (a of proj.assigned; track a.person_id) {
                            <tr [class.row-standby]="a.assignment_type === 'standby'">
                              <td>
                                <div class="person-pill">
                                  <div class="avatar" [style.background]="getColor(a.display_name)">
                                    {{ getInitials(a.display_name) }}
                                  </div>
                                  {{ a.display_name }}
                                </div>
                              </td>
                              <td>{{ a.location }}</td>
                              <td>
                                <span class="cap-badge eligible">✓ Eligible</span>
                              </td>
                              <td>
                                @if (a.assignment_type !== 'standby') {
                                  <div class="hc-bar-wrap">
                                    <div class="hc-bar-fill"
                                      [style.width.%]="Math.min(100, (a.allocated_hc / proj.total_sized_hc) * 100)"
                                      [style.background]="'#2e7d32'">
                                    </div>
                                  </div>
                                  <strong style="color:#2e7d32">
                                    {{ a.allocated_hc | number:'1.1-1' }} HC
                                  </strong>
                                } @else {
                                  <span style="color:#aaa">—</span>
                                }
                              </td>
                              <td>
                                <span class="status-chip sc-ok">✓ Assigned</span>
                              </td>
                            </tr>
                          }
                        </tbody>
                      </table>
                    }
                  </div>
                }
              </div>
            }
          </div>
        }

        <!-- ══ TAB 3: TEAM UTILISATION ══ -->
        @if (activeTab === 'util') {
          <div class="tab-content">
            <!-- Unified filter bar — same component as Projects / Sizing / Sizing View -->
            <app-filter-bar
              [filters]="utilFilterDefs"
              [options]="utilFilterOptions"
              [selected]="utilFilterSelected"
              [rowCount]="filteredUtilTeam.length"
              (selectedChange)="onUtilFilterChange($event)">
            </app-filter-bar>

            <div class="util-grid">
              @for (person of filteredUtilTeam; track person.person_id) {
                <div class="util-card">
                  <div class="util-card-header">
                    <div class="avatar" [style.background]="getColor(person.display_name)" style="width:34px;height:34px;font-size:11px">
                      {{ getInitials(person.display_name) }}
                    </div>
                    <div class="util-info">
                      <div class="util-name">{{ person.display_name }}</div>
                      <div class="util-meta">{{ person.designation }}</div>
                      <div class="util-meta">{{ person.location }} · {{ person.employment_type }}</div>
                    </div>
                  </div>

                  <!-- Capacity breakdown bar -->
                  <div class="util-load-bar" style="height:10px;margin-bottom:6px">
                    <div style="position:absolute;left:0;top:0;height:100%;background:#90caf9;border-radius:3px;transition:width 0.3s"
                      [style.width.%]="clamp(getSsProjectEffort(person.person_id) * 100, 0, 100)"></div>
                    <div style="position:absolute;height:100%;background:#2e7d32;border-radius:3px;transition:width 0.3s"
                      [style.left.%]="clamp(getSsProjectEffort(person.person_id) * 100, 0, 100)"
                      [style.width.%]="clamp(getSsmPersonTotal(person.person_id) * 100, 0, 100 - getSsProjectEffort(person.person_id) * 100)"></div>
                  </div>
                  <div style="display:flex;justify-content:space-between;font-size:10px;color:#aaa;margin-bottom:8px">
                    <span>Projects: <strong>{{ getSsProjectEffort(person.person_id) | number:'1.2-2' }}</strong> HC</span>
                    <span>SS: <strong>{{ getSsmPersonTotal(person.person_id) | number:'1.2-2' }}</strong> HC</span>
                    <span [style.color]="(getSsProjectEffort(person.person_id) + getSsmPersonTotal(person.person_id)) > 1 ? '#c62828' : '#2e7d32'">
                      Avail: <strong>{{ (1 - getSsProjectEffort(person.person_id) - getSsmPersonTotal(person.person_id)) | number:'1.2-2' }}</strong>
                    </span>
                  </div>

                  <!-- Projects list -->
                  <div class="util-projects">
                    @for (proj of getPersonProjects(person.person_id); track proj.project_id) {
                      <div class="util-proj-row">
                        <span class="util-proj-name">{{ proj.project_name }}</span>
                        <span style="font-size:10px;font-weight:700;color:#1565c0;white-space:nowrap">
                          {{ getSsProjectEffort(person.person_id) | number:'1.2-2' }} HC
                        </span>
                      </div>
                    }
                    @if (getPersonProjects(person.person_id).length === 0) {
                      <div class="util-no-assign">No projects assigned</div>
                    }
                  </div>

                  <!-- SS tasks list -->
                  @if (getPersonSsTasks(person.person_id).length > 0) {
                    <div class="util-projects" style="margin-top:6px;border-top:1px solid #f5f5f5;padding-top:6px">
                      @for (ss of getPersonSsTasks(person.person_id); track ss.task_id) {
                        @if (getSsmEffort(person.person_id, ss.task_id) > 0) {
                          <div class="util-proj-row">
                            <span class="util-proj-name" style="color:#e65100">{{ ss.task_name }}</span>
                            <span style="font-size:10px;font-weight:700;color:#e65100;white-space:nowrap">
                              {{ getSsmEffort(person.person_id, ss.task_id) | number:'1.2-2' }} HC
                            </span>
                          </div>
                        }
                      }
                    </div>
                  }
                </div>
              }

              @if (filteredUtilTeam.length === 0) {
                <div class="util-empty">No team members match the current filters.</div>
              }
            </div>
          </div>
        }
        @if (activeTab === 'steady') {
          <div class="tab-content">

            @if (ssTasksLoading) {
              <div class="alloc-loading"><mat-spinner diameter="32"></mat-spinner><span>Loading steady state tasks...</span></div>
            }

            <!-- KPI tiles -->
            <div class="ss-kpi-row">
              <div class="ss-kpi" style="border-left-color:#1565c0">
                <div class="ss-kpi-label">People in View</div>
                <div class="ss-kpi-value">{{ ssmFilteredPeople.length }}</div>
                <div class="ss-kpi-sub">{{ selectedManager || 'All teams' }}</div>
              </div>
              <div class="ss-kpi" style="border-left-color:#e65100">
                <div class="ss-kpi-label">Active SS Tasks</div>
                <div class="ss-kpi-value">{{ getTeamSsTaskCount() }}</div>
                <div class="ss-kpi-sub">Tasks assigned to this team</div>
              </div>
              <div class="ss-kpi" style="border-left-color:#2e7d32">
                <div class="ss-kpi-label">Total SS Effort</div>
                <div class="ss-kpi-value">{{ getTeamSsEffort() | number:'1.1-1' }}</div>
                <div class="ss-kpi-sub">HC across team's SS tasks</div>
              </div>
              <div class="ss-kpi" style="border-left-color:#6a1b9a">
                <div class="ss-kpi-label">Avg SS per Person</div>
                <div class="ss-kpi-value">{{ getTeamSsAvg() | number:'1.2-2' }}</div>
                <div class="ss-kpi-sub">For people with SS assignments</div>
              </div>
            </div>

            <!-- ── NEW: Person-centric distribution view ── -->
            <div class="ss-dist-card">
              <div class="ss-card-header" style="justify-content:space-between">
                <div style="display:flex;align-items:center;gap:8px">
                  <mat-icon style="color:#e65100">people</mat-icon>
                  <span class="ss-card-title">Steady State Distribution</span>
                  @if (ssDirty) { <span class="ss-unsaved">Unsaved changes</span> }
                </div>
                <div style="display:flex;gap:8px">
                  @if (ssDirty) {
                    <button mat-stroked-button style="font-size:12px;height:34px;color:#c62828;border-color:#c62828" (click)="ssDiscard()">
                      <mat-icon>undo</mat-icon> Discard
                    </button>
                    <button mat-flat-button style="font-size:12px;height:34px;background:#2e7d32;color:white" (click)="ssSave()">
                      <mat-icon>save</mat-icon> Save
                    </button>
                  }
                  <button mat-stroked-button style="font-size:12px;height:34px" (click)="autoDistributeSteadyState()">
                    <mat-icon>auto_fix_high</mat-icon> Recalculate
                  </button>
                </div>
              </div>

              <div class="ss-dist-grid">
                @for (person of ssmFilteredPeople; track person.person_id) {
                  <div class="ss-person-card" [class.ss-person-over]="getSsmPersonTotal(person.person_id) > 1">
                    <!-- Person header -->
                    <div class="ss-pc-header">
                      <div>
                        <div class="person-name" style="font-size:13px">{{ person.display_name }}</div>
                        <div class="person-meta">{{ person.designation }} · {{ person.location }}</div>
                      </div>
                      <div style="text-align:right">
                        <div style="font-size:11px;color:#888">SS Effort</div>
                        <div style="font-size:16px;font-weight:800"
                          [style.color]="getSsmPersonTotal(person.person_id) > 1 ? '#c62828' : '#2e7d32'">
                          {{ getSsmPersonTotal(person.person_id) | number:'1.2-2' }} HC
                        </div>
                      </div>
                    </div>

                    <!-- Capacity bar -->
                    <div class="ss-pc-bar-wrap">
                      <div class="ss-pc-bar-proj" [style.width.%]="clamp(getSsProjectEffort(person.person_id) * 100, 0, 100)"
                        matTooltip="Project allocations"></div>
                      <div class="ss-pc-bar-ss" [style.width.%]="clamp(getSsmPersonTotal(person.person_id) * 100, 0, 100 - getSsProjectEffort(person.person_id) * 100)" [style.background]="(getSsProjectEffort(person.person_id) + getSsmPersonTotal(person.person_id)) > 1 ? '#c62828' : '#2e7d32'" matTooltip="Steady state"></div>
                    </div>
                    <div style="display:flex;justify-content:space-between;font-size:10px;color:#aaa;margin-top:2px">
                      <span>Projects: {{ getSsProjectEffort(person.person_id) | number:'1.2-2' }} HC</span>
                      <span>Available: {{ (1 - getSsProjectEffort(person.person_id) - getSsmPersonTotal(person.person_id)) | number:'1.2-2' }} HC</span>
                    </div>

                    <!-- SS task distribution -->
                    @if (getPersonSsTasks(person.person_id).length > 0) {
                      <div class="ss-pc-tasks">
                        @for (entry of getPersonSsTasks(person.person_id); track entry.task_id) {
                          <div class="ss-pc-task-row">
                            <span class="ss-dot" [style.background]="entry.color"></span>
                            <span class="ss-pc-task-name">{{ entry.task_name }}</span>
                            <input class="ss-pc-hc-input"
                              type="number" min="0" max="1" step="0.05"
                              [value]="getSsmEffort(person.person_id, entry.task_id)"
                              (change)="setSsmEffort(person.person_id, entry.task_id, $event)"
                              [matTooltip]="'Auto: ' + entry.auto_hc + ' HC'">
                          </div>
                        }
                      </div>
                    } @else {
                      <div style="font-size:11px;color:#aaa;font-style:italic;padding:8px 0">
                        No SS tasks assigned — click name to configure
                      </div>
                    }

                    <button class="ss-pc-configure" (click)="openPersonPanel(person)">
                      <mat-icon style="font-size:13px;width:13px;height:13px">settings</mat-icon>
                      Configure tasks
                    </button>
                  </div>
                }
              </div>
            </div>


            <!-- People picker panel -->
            @if (ssShowPicker) {
              <div class="ss-overlay" (click)="ssShowPicker=false"></div>
              <div class="ss-panel" style="width:720px">
                <div class="ss-panel-header">
                  <div>
                    <span class="ss-panel-title">Assign People — {{ ssPickerTask?.name }}</span>
                    <div style="font-size:11px;color:#aaa;margin-top:3px">
                      Step 1: toggle people on/off · Step 2: set HC per quarter
                    </div>
                  </div>
                  <button mat-icon-button (click)="ssShowPicker=false"><mat-icon>close</mat-icon></button>
                </div>
                <div class="ss-panel-body" style="gap:16px">

                  <!-- Step 1 — people toggle -->
                  <div style="font-size:11px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px">
                    Step 1 — Select people
                  </div>
                  <input class="ss-input" type="text" [(ngModel)]="ssPickerSearch"
                    placeholder="Search name, designation, location..." style="margin-bottom:8px">
                  <div style="display:flex;flex-direction:column;gap:2px;max-height:200px;overflow-y:auto;border:1px solid #f0f0f0;border-radius:6px;padding:4px">
                    @for (p of ssFilteredPeople; track p.person_id) {
                      <div class="ss-person-row" [class.ss-selected]="ssIsAssigned(p)"
                        (click)="ssToggleAssign(p)">
                        <div class="avatar" [style.background]="getColor(p.display_name)"
                          style="width:26px;height:26px;font-size:10px;flex-shrink:0">{{ getInitials(p.display_name) }}</div>
                        <div style="flex:1;min-width:0">
                          <div style="font-weight:600;font-size:12px">{{ p.display_name }}</div>
                          <div style="font-size:10px;color:#aaa">{{ p.designation }} · {{ p.location }}</div>
                        </div>
                        @if (ssIsAssigned(p)) {
                          <span style="font-size:10px;color:#2e7d32;font-weight:700">
                            {{ getSsPersonTotal(p.person_id) | number:'1.2-2' }} HC
                          </span>
                        }
                        <mat-icon style="font-size:16px;width:16px;height:16px"
                          [style.color]="ssIsAssigned(p) ? '#2e7d32' : '#ddd'">
                          {{ ssIsAssigned(p) ? 'check_circle' : 'radio_button_unchecked' }}
                        </mat-icon>
                      </div>
                    }
                  </div>

                  <!-- Step 2 — quarterly HC per assigned person -->
                  @if (ssPickerTask?.assignedPeople?.length > 0) {
                    <div style="font-size:11px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:0.5px;margin-top:8px;margin-bottom:4px">
                      Step 2 — Set HC per quarter
                    </div>
                    <div style="font-size:11px;color:#aaa;margin-bottom:8px">
                      Budget: <strong>{{ ssPickerTask?.totalHc }} HC</strong> total ·
                      Assigned: <strong>{{ getSsTaskTotalEffort() | number:'1.2-2' }} HC</strong> ·
                      <span [style.color]="getSsTaskTotalEffort() > (ssPickerTask?.totalHc || 0) ? '#c62828' : '#2e7d32'">
                        {{ getSsTaskTotalEffort() > (ssPickerTask?.totalHc || 0) ? '⚠ Over budget' : 'Within budget' }}
                      </span>
                    </div>
                    <div style="overflow-x:auto">
                      <table class="ft-table">
                        <thead>
                          <tr>
                            <th class="ft-person-hd">Person</th>
                            @for (q of ssEffortQuarters; track q) { <th>{{ q }}</th> }
                            <th>Avg HC</th>
                          </tr>
                        </thead>
                        <tbody>
                          @for (p of ssPickerTask?.assignedPeople; track p.person_id) {
                            <tr>
                              <td class="ft-person-td" style="min-width:140px">
                                <div class="avatar" [style.background]="getColor(p.display_name)"
                                  style="width:22px;height:22px;font-size:9px;flex-shrink:0">{{ getInitials(p.display_name) }}</div>
                                <span style="font-size:11px;font-weight:600">{{ p.display_name }}</span>
                              </td>
                              @for (q of ssEffortQuarters; track q) {
                                <td style="text-align:center;padding:3px">
                                  <input class="ft-input"
                                    type="number" min="0" max="1" step="0.05"
                                    [value]="getSsEffort(p.person_id, q)"
                                    (change)="setSsEffort(p.person_id, q, $event)"
                                    placeholder="0">
                                </td>
                              }
                              <td style="text-align:center;font-size:11px;font-weight:700;color:#1565c0">
                                {{ getSsPersonTotal(p.person_id) | number:'1.2-2' }}
                              </td>
                            </tr>
                          }
                        </tbody>
                      </table>
                    </div>
                  }

                </div>
                <div class="ss-panel-footer">
                  <span style="font-size:12px;color:#888;flex:1">{{ ssPickerTask?.assignedPeople?.length || 0 }} people assigned</span>
                  <button mat-stroked-button (click)="ssShowPicker=false">Cancel</button>
                  <button mat-flat-button color="primary" (click)="saveSsEffort()">Save</button>
                </div>
              </div>
            }

            <!-- Attribution panel -->
            @if (ssShowAttrPanel) {
              <div class="ss-overlay" (click)="ssShowAttrPanel=false"></div>
              <div class="ss-panel">
                <div class="ss-panel-header">
                  <span class="ss-panel-title">{{ ssAttrTask ? 'Manage — ' + ssAttrTask.name : 'Add Attribution' }}</span>
                  <button mat-icon-button (click)="ssShowAttrPanel=false"><mat-icon>close</mat-icon></button>
                </div>
                <div class="ss-panel-body">
                  <div class="ss-form-group">
                    <label class="ss-form-label">Steady-State Task</label>
                    <select class="ss-input" [(ngModel)]="ssNewAttr.taskName" (ngModelChange)="ssCheckBudget()">
                      <option value="">— Select task —</option>
                      @for (t of steadyStateTasks; track t.name) {
                        @if (t.attributable) { <option [value]="t.name">{{ t.name }} ({{ t.totalHc }} HC)</option> }
                      }
                    </select>
                  </div>
                  <div class="ss-form-group">
                    <label class="ss-form-label">Project</label>
                    <select class="ss-input" [(ngModel)]="ssNewAttr.project">
                      <option value="">— Select project —</option>
                      @for (p of ssProjects; track p) { <option [value]="p">{{ p }}</option> }
                    </select>
                  </div>
                  <div class="ss-form-group">
                    <label class="ss-form-label">HC to Attribute</label>
                    <input class="ss-input" type="number" [(ngModel)]="ssNewAttr.hc" min="0.5" step="0.5"
                      placeholder="e.g. 2" (ngModelChange)="ssCheckBudget()">
                  </div>
                  <div style="display:flex;gap:12px">
                    <div class="ss-form-group" style="flex:1">
                      <label class="ss-form-label">Start Quarter</label>
                      <select class="ss-input" [(ngModel)]="ssNewAttr.startQ">
                        @for (q of ssQuarters; track q) { <option [value]="q">{{ q }}</option> }
                      </select>
                    </div>
                    <div class="ss-form-group" style="flex:1">
                      <label class="ss-form-label">End Quarter <span style="font-weight:400;color:#aaa">(optional)</span></label>
                      <select class="ss-input" [(ngModel)]="ssNewAttr.endQ">
                        <option value="">No end (indefinite)</option>
                        @for (q of ssQuarters; track q) { <option [value]="q">{{ q }}</option> }
                      </select>
                    </div>
                  </div>
                  <div class="ss-form-group">
                    <label class="ss-form-label">Notes (optional)</label>
                    <textarea class="ss-input" rows="2" [(ngModel)]="ssNewAttr.notes"
                      placeholder="Why is this HC attributed to this project?"></textarea>
                  </div>
                  @if (ssNewAttr.taskName && ssNewAttr.hc) {
                    <div class="ss-alert" [class.ss-alert-ok]="!ssOverBudget" [class.ss-alert-warn]="ssOverBudget">
                      <mat-icon style="font-size:16px;width:16px;height:16px"
                        [style.color]="ssOverBudget ? '#c62828' : '#2e7d32'">
                        {{ ssOverBudget ? 'warning' : 'check_circle' }}
                      </mat-icon>
                      <span>{{ ssBudgetMsg }}</span>
                    </div>
                    <div class="ss-val-bar">
                      <div [style.width]="ssUsedPct + '%'" style="height:100%;background:#2e7d32;transition:width 0.3s"></div>
                      <div [style.width]="ssNewPct + '%'" [style.background]="ssOverBudget?'#c62828':'#81c784'" style="height:100%;transition:width 0.3s"></div>
                    </div>
                  }
                </div>
                <div class="ss-panel-footer">
                  <button mat-stroked-button (click)="ssShowAttrPanel=false">Cancel</button>
                  <button mat-flat-button color="primary" [disabled]="ssOverBudget" (click)="ssSaveAttr()">Save Attribution</button>
                </div>
              </div>
            }

          </div>
        }

        <!-- ══ TAB 5: ASSIGNMENT OUTPUT ══ -->
        @if (activeTab === 'compute') {
          <div class="tab-content">

            @if (computeLoading) {
              <div class="alloc-loading"><mat-spinner diameter="32"></mat-spinner><span>Running assignment algorithm...</span></div>
            } @else if (!computeResult) {
              <div class="compute-empty">
                <mat-icon style="font-size:48px;width:48px;height:48px;color:#ddd">calculate</mat-icon>
                <p>Run the algorithm to see how your team maps to project demand.</p>
                <button mat-flat-button color="primary" (click)="runCompute()">
                  <mat-icon>play_arrow</mat-icon> Run Assignment Algorithm
                </button>
              </div>
            } @else {

              <!-- Header + re-run -->
              <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
                <div>
                  <span style="font-size:14px;font-weight:700;color:#1a1a2e">Assignment Output</span>
                  <span style="font-size:11px;color:#aaa;margin-left:10px">
                    {{ computeResult.totals.people }} people · {{ computeResult.totals.projects }} projects · {{ computeResult.totals.quarters }} quarters
                  </span>
                </div>
                <div style="display:flex;gap:8px">
                  <button mat-stroked-button (click)="exportAssignment('monthly')" matTooltip="Export — same HC per month">
                    <mat-icon>calendar_month</mat-icon> Monthly
                  </button>
                  <button mat-stroked-button (click)="exportAssignment('weekly')" matTooltip="Export — same HC per week">
                    <mat-icon>view_week</mat-icon> Weekly
                  </button>
                  <button mat-stroked-button (click)="runCompute()">
                    <mat-icon>refresh</mat-icon> Re-run
                  </button>
                </div>
              </div>

              <!-- Gap summary cards -->
              <div class="section-label-row">Gap Summary by Project</div>
              <div class="compute-gap-grid">
                @for (proj of computeResult.gap_summary; track proj.project_id) {
                  <div class="compute-gap-card" [class.gap-ok]="proj.total_gap >= 0" [class.gap-bad]="proj.total_gap < 0">
                    <div class="cgc-name">{{ proj.project_name }}</div>
                    <div class="cgc-bu">{{ proj.BU }}</div>
                    <div class="cgc-nums">
                      <div class="cgc-stat">
                        <div class="cgc-val">{{ proj.total_demand }}</div>
                        <div class="cgc-lbl">Demand HC</div>
                      </div>
                      <div class="cgc-stat">
                        <div class="cgc-val" style="color:#2e7d32">{{ proj.total_supply }}</div>
                        <div class="cgc-lbl">Matched</div>
                      </div>
                      <div class="cgc-stat">
                        <div class="cgc-val" [style.color]="proj.total_gap < 0 ? '#c62828' : '#2e7d32'">
                          {{ proj.total_gap >= 0 ? '+' : '' }}{{ proj.total_gap }}
                        </div>
                        <div class="cgc-lbl">Gap</div>
                      </div>
                    </div>
                    <!-- Per-quarter mini bars -->
                    <div class="cgc-bar-row">
                      @for (q of proj.quarters; track q.quarter) {
                        <div class="cgc-q-bar"
                          [style.background]="q.gap < 0 ? '#ffebee' : '#e8f5e9'"
                          [matTooltip]="q.quarter + ': demand=' + q.demand + ' supply=' + q.supply + ' gap=' + q.gap">
                          <div class="cgc-q-fill"
                            [style.height.%]="q.demand > 0 ? (q.supply / q.demand * 100) : 100"
                            [style.background]="q.gap < 0 ? '#ef9a9a' : '#a5d6a7'">
                          </div>
                        </div>
                      }
                    </div>
                  </div>
                }
              </div>

              <!-- Person assignment matrix -->
              <div class="section-label-row" style="margin-top:20px">Person Assignment Matrix</div>
              <div style="overflow-x:auto;background:white;border:1px solid #e0e0e0;border-radius:10px">
                <table class="compute-matrix">
                  <thead>
                    <tr>
                      <th class="cm-person-hd">Person</th>
                      @for (q of computeResult.quarters.slice(0, 12); track q) {
                        <th>{{ q }}</th>
                      }
                    </tr>
                  </thead>
                  <tbody>
                    @for (p of computeResult.person_matrix; track p.person_id) {
                      @if (hasAnyAssignment(p)) {
                        <tr>
                          <td class="cm-person-td">
                            <div class="avatar" [style.background]="getColor(p.display_name)"
                              style="width:24px;height:24px;font-size:9px;flex-shrink:0">
                              {{ getInitials(p.display_name) }}
                            </div>
                            <div>
                              <div style="font-weight:600;font-size:11px">{{ p.display_name }}</div>
                              <div style="font-size:10px;color:#aaa">{{ p.location }}</div>
                            </div>
                          </td>
                          @for (q of computeResult.quarters.slice(0, 12); track q) {
                            <td class="cm-cell">
                              @if (p.assignments[q]) {
                                <div class="cm-assign-chip"
                                  [style.background]="getProjectColor(p.assignments[q].project_id)"
                                  [matTooltip]="p.assignments[q].project_name + ' · ' + p.assignments[q].hc + ' HC · ' + p.assignments[q].assigned ? 'Eligible' : ''">
                                  {{ p.assignments[q].hc }}
                                </div>
                              } @else {
                                <span style="color:#eee;font-size:10px">—</span>
                              }
                            </td>
                          }
                        </tr>
                      }
                    }
                  </tbody>
                </table>
              </div>
            }

          </div>
        }

      }

      <!-- Person SS configure panel — always rendered so it works from any tab -->
      @if (showPersonPanel && personPanelData) {
        <div class="ss-overlay" (click)="showPersonPanel=false"></div>
        <div class="ss-panel" style="width:460px">
          <div class="ss-panel-header">
            <div>
              <span class="ss-panel-title">{{ personPanelData.display_name }}</span>
              <div style="font-size:11px;color:#aaa;margin-top:2px">
                {{ personPanelData.designation }} · {{ personPanelData.location }}
              </div>
            </div>
            <button mat-icon-button (click)="showPersonPanel=false"><mat-icon>close</mat-icon></button>
          </div>
          <div class="ss-panel-body">
            <!-- Capacity overview -->
            <div class="ss-panel-section-label">Capacity Overview · 1.0 HC total</div>
            <div style="display:flex;gap:10px;margin-bottom:12px;flex-shrink:0">
              <div class="ss-cap-tile" style="background:#e3f2fd">
                <div style="font-size:18px;font-weight:800;color:#1565c0">{{ getSsProjectEffort(personPanelData.person_id) | number:'1.2-2' }}</div>
                <div style="font-size:10px;color:#888">Projects</div>
              </div>
              <div class="ss-cap-tile" style="background:#fff3e0">
                <div style="font-size:18px;font-weight:800;color:#e65100">{{ getSsmPersonTotal(personPanelData.person_id) | number:'1.2-2' }}</div>
                <div style="font-size:10px;color:#888">Steady State</div>
              </div>
              <div class="ss-cap-tile"
                [style.background]="(1 - getSsProjectEffort(personPanelData.person_id) - getSsmPersonTotal(personPanelData.person_id)) < 0 ? '#ffebee' : '#e8f5e9'">
                <div style="font-size:18px;font-weight:800;"
                  [style.color]="(1 - getSsProjectEffort(personPanelData.person_id) - getSsmPersonTotal(personPanelData.person_id)) < 0 ? '#c62828' : '#2e7d32'">
                  {{ (1 - getSsProjectEffort(personPanelData.person_id) - getSsmPersonTotal(personPanelData.person_id)) | number:'1.2-2' }}
                </div>
                <div style="font-size:10px;color:#888">Unallocated</div>
              </div>
            </div>
            <div class="ss-pc-bar-wrap" style="margin-bottom:16px">
              <div [style.width.%]="clamp(getSsProjectEffort(personPanelData.person_id) * 100, 0, 100)" style="height:100%;background:#1565c0;border-radius:3px 0 0 3px"></div>
              <div [style.width.%]="clamp(getSsmPersonTotal(personPanelData.person_id) * 100, 0, 100)"
                [style.background]="(getSsProjectEffort(personPanelData.person_id) + getSsmPersonTotal(personPanelData.person_id)) > 1 ? '#c62828' : '#e65100'"
                style="height:100%;border-radius:0 3px 3px 0"></div>
            </div>
            <!-- Eligible projects -->
            <div class="ss-panel-section-label">Eligible Projects</div>
            @if (personPanelProjects.length === 0) {
              <div class="ss-empty-note">Not marked eligible for any projects</div>
            } @else {
              <div style="margin-bottom:16px;flex-shrink:0">
                @for (proj of personPanelProjects; track proj.project_id) {
                  <div class="ss-elig-proj">
                    <span class="ss-elig-proj-name">{{ proj.project_name }}</span>
                    <span class="ss-elig-chip">Eligible</span>
                  </div>
                }
              </div>
            }
            <!-- Eligible SS tasks -->
            <div class="ss-panel-section-label">Eligible Steady State Tasks <span class="ss-panel-hint"> · check to include in auto-distribution</span></div>
            <div class="ss-task-list">
              @for (task of steadyStateTasks; track task.task_id) {
                <label class="ss-task-row" [style.background]="isPersonSsEligible(personPanelData.person_id, task.task_id) ? '#e8f5e9' : '#f9f9f9'">
                  <input type="checkbox"
                    [checked]="isPersonSsEligible(personPanelData.person_id, task.task_id)"
                    (change)="togglePersonSsEligibility(personPanelData.person_id, task.task_id)">
                  <span class="ss-dot" [style.background]="task.color || '#888'"></span>
                  <span class="ss-task-name">{{ task.name }}</span>
                </label>
              }
            </div>
            <!-- Historical allocation -->
            @if (personHistory.length > 0 || historyQuarters.length > 0) {
              <div class="ss-hist-section">
              <div class="ss-panel-section-label">Historical Allocation <span class="ss-panel-hint"> · from retro data (last 8 quarters)</span></div>
              <div class="ss-hist-table-wrap">
                <table class="ss-hist-table">
                  <thead><tr><th>Task</th>@for (q of historyQuarters; track q) { <th>{{ q }}</th> }</tr></thead>
                  <tbody>
                    @for (row of historyRows; track row.task_code) {
                      <tr>
                        <td>{{ row.task_name }}</td>
                        @for (q of historyQuarters; track q) {
                          <td [style.color]="(row.data[q] || 0) > 0 ? '#1565c0' : '#ccc'" style="font-weight:600">
                            {{ (row.data[q] || 0) > 0 ? (row.data[q] | number:'1.2-2') : '—' }}
                          </td>
                        }
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
              </div>
            }
          </div>
          <div class="ss-panel-footer">
            <span style="font-size:11px;color:#aaa;flex:1">Changes save automatically</span>
            <button mat-flat-button color="primary" (click)="showPersonPanel=false">Done</button>
          </div>
        </div>
      }

    </div>
  `,
  styles: [`
    .alloc-page { display: flex; flex-direction: column; gap: 0; }

    /* Header */
    .alloc-header { display: flex; align-items: center; gap: 12px; padding: 16px 24px; background: white; border-bottom: 1px solid #e8e8e8; }
    .header-icon { font-size: 28px; width: 28px; height: 28px; color: #ED1C24; }
    .alloc-header h2 { font-size: 18px; font-weight: 600; margin: 0; }
    .header-sub { font-size: 12px; color: #888; margin: 2px 0 0; }
    .mgr-selector { margin-left: auto; }
    .mgr-selector { display: flex; align-items: center; gap: 8px; }
    .mgr-label { font-size: 12px; color: #666; white-space: nowrap; }
    .mgr-select {
      min-width: 280px; border: 1px solid #d0d0d0; border-radius: 6px;
      padding: 7px 12px; font-size: 13px; font-family: inherit; background: white;
      cursor: pointer; outline: none; transition: border 0.15s; height: 38px;
    }
    .mgr-select:focus { border-color: #1565c0; }

    /* Tabs */
    .alloc-tabs { display: flex; gap: 0; background: white; border-bottom: 1px solid #e0e0e0; padding: 0 24px; }
    .alloc-tab { display: flex; align-items: center; gap: 6px; padding: 12px 18px; border: none; background: none; cursor: pointer; font-size: 13px; color: #666; border-bottom: 2px solid transparent; font-family: inherit; transition: all 0.15s; }
    .alloc-tab mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .alloc-tab.active { color: #1565c0; border-bottom-color: #1565c0; font-weight: 600; }
    .alloc-tab:hover:not(.active) { color: #333; background: #f8f9fa; }

    /* Loading */
    .alloc-loading { display: flex; align-items: center; gap: 12px; padding: 40px; color: #888; }

    /* Tab content */
    .tab-content { padding: 20px 24px; }

    /* Info banner */
    .tab-info { display: flex; align-items: flex-start; gap: 8px; background: #e8f0fe; border-left: 4px solid #1565c0; border-radius: 6px; padding: 10px 14px; font-size: 12px; color: #1a237e; margin-bottom: 16px; line-height: 1.6; }

    /* Matrix */
    .matrix-wrap { overflow-x: auto; background: white; border: 1px solid #e0e0e0; border-radius: 10px; margin-bottom: 12px; }
    .matrix-table { border-collapse: collapse; width: max-content; min-width: 100%; }
    .matrix-table thead tr { background: #1a1a2e; }
    .person-th { color: white; padding: 10px 14px; font-size: 11px; font-weight: 600; text-align: left; min-width: 200px; white-space: nowrap; }
    .proj-th { color: white; padding: 8px 10px; font-size: 11px; font-weight: 600; text-align: center; min-width: 140px; vertical-align: top; }
    .proj-th-name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 130px; text-align: center; }
    .proj-th-meta { font-size: 9px; color: #90caf9; font-weight: 400; margin-top: 2px; text-align: center; }
    .proj-th-buttons { display: flex; flex-direction: row; align-items: center; justify-content: center; gap: 4px; margin-top: 6px; }
    .matrix-table tbody tr { border-bottom: 1px solid #f0f0f0; }
    .matrix-table tbody tr:hover td { background: #f5f7ff; }
    .person-td { padding: 8px 14px; background: #fafafa; border-right: 1px solid #e8e8e8; }
    .person-name { font-size: 12px; font-weight: 600; color: #1a1a2e; }
    .person-meta { font-size: 10px; color: #aaa; margin-top: 1px; }
    .matrix-td { text-align: center; padding: 6px 8px; position: relative; }
    .cap-select { border: 1px solid #e0e0e0; border-radius: 6px; padding: 4px 8px; font-size: 12px; font-family: inherit; background: white; cursor: pointer; width: 80px; outline: none; transition: all 0.12s; }
    .cap-select:focus { border-color: #1565c0; }
    .cap-select.val-yes { background: #e8f5e9; border-color: #2e7d32; color: #2e7d32; font-weight: 600; }
    .hc-info-btn { background: rgba(255,255,255,0.15); border: 1px solid rgba(255,255,255,0.35); border-radius: 10px; padding: 3px 9px; font-size: 10px; color: white; cursor: pointer; display: flex; align-items: center; gap: 3px; font-family: inherit; transition: all 0.15s; white-space: nowrap; }
    .hc-info-btn:hover { background: rgba(255,255,255,0.3); }
    .hcp-backdrop { position: fixed; inset: 0; z-index: 299; }
    .hcp-panel { position: fixed; background: white; border: 1px solid #e0e0e0; border-radius: 10px; box-shadow: 0 8px 32px rgba(0,0,0,0.15); z-index: 300; width: 300px; }
    .hcp-header { display: flex; align-items: flex-start; justify-content: space-between; padding: 12px 14px 8px; border-bottom: 1px solid #f0f0f0; gap: 8px; }
    .hcp-title { font-size: 13px; font-weight: 700; color: #1a1a2e; flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .hcp-sub { font-size: 10px; color: #aaa; margin-top: 2px; }
    .hcp-body { padding: 10px 16px 14px; display: flex; flex-direction: column; gap: 6px; max-height: 300px; overflow-y: auto; }
    .hcp-legend { display: flex; flex-wrap: wrap; gap: 4px 12px; margin-top: 6px; }
    .hcp-note { margin-top: 6px; font-size: 10px; color: #8a4b00; background: #fff8e1; border-radius: 5px; padding: 4px 6px; }
    .hcp-key { display: inline-flex; align-items: center; gap: 5px; font-size: 10px; color: #666; }
    .hcp-dot { width: 8px; height: 8px; border-radius: 2px; display: inline-block; }
    .hcp-qblock { display: flex; flex-direction: column; gap: 3px; padding: 3px 0; }
    .hcp-qblock--now { background: #f1f6ff; margin: 0 -8px; padding: 3px 8px; border-radius: 6px; }
    .hcp-more { background: none; border: 1px dashed #c5cae9; border-radius: 6px; color: #3949ab; font-size: 11px; padding: 5px; cursor: pointer; font-family: inherit; }
    .hcp-more:focus-visible { outline: 2px solid #1a237e; outline-offset: 2px; }
    .hcp-row { display: flex; align-items: center; gap: 8px; font-size: 12px; }
    .hcp-q { width: 64px; flex-shrink: 0; color: #888; font-size: 11px; }
    .hcp-bar-wrap { flex: 1; height: 8px; background: #f0f0f0; border-radius: 4px; overflow: hidden; }
    .hcp-bar { height: 100%; border-radius: 4px; transition: width 0.3s; }
    .hcp-val { width: 52px; text-align: right; font-weight: 700; color: #1a1a2e; flex-shrink: 0; font-size: 11px; }
    .finetune-btn { background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.25); border-radius: 10px; padding: 3px 9px; font-size: 10px; color: #b3e5fc; cursor: pointer; display: flex; align-items: center; gap: 3px; font-family: inherit; transition: all 0.15s; white-space: nowrap; }
    .finetune-btn:hover { background: rgba(255,255,255,0.25); color: white; }
    .ft-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.25); z-index: 200; }
    .ft-panel { position: fixed; right: 0; top: 56px; bottom: 0; width: 700px; background: white; box-shadow: -4px 0 24px rgba(0,0,0,0.15); z-index: 201; display: flex; flex-direction: column; }
    .ft-header { padding: 18px 20px; border-bottom: 1px solid #e0e0e0; display: flex; align-items: flex-start; justify-content: space-between; flex-shrink: 0; }
    .ft-title { font-size: 15px; font-weight: 700; color: #1a1a2e; }
    .ft-sub { font-size: 11px; color: #aaa; margin-top: 3px; }
    .ft-body { flex: 1; overflow: auto; padding: 16px; }
    .ft-footer { padding: 14px 20px; border-top: 1px solid #e0e0e0; display: flex; justify-content: space-between; align-items: center; flex-shrink: 0; }
    .ft-table { border-collapse: collapse; font-size: 12px; min-width: 100%; }
    .ft-table th { background: #f8f9fa; padding: 8px 10px; text-align: center; font-size: 11px; font-weight: 600; color: #888; border: 1px solid #e0e0e0; white-space: nowrap; }
    .ft-person-hd { text-align: left !important; min-width: 160px; position: sticky; left: 0; background: #f8f9fa; }
    .ft-table td { padding: 6px 8px; border: 1px solid #f0f0f0; vertical-align: middle; }
    .ft-person-td { background: #fafafa; position: sticky; left: 0; padding: 8px 14px !important; border-right: 1px solid #e0e0e0; min-width: 180px; vertical-align: middle; }
    .ft-input { width: 56px; border: 1.5px solid #e0e0e0; border-radius: 6px; padding: 4px 6px; font-size: 12px; text-align: center; font-family: inherit; }
    .ft-input:focus { outline: none; border-color: #1565c0; }
    .ft-cap-bar-wrap { height: 6px; background: #f0f0f0; border-radius: 3px; overflow: hidden; width: 60px; margin: 0 auto 2px; }
    .ft-cap-bar { height: 100%; border-radius: 3px; transition: width 0.3s; }
    .cap-badge.eligible { background: #e8f5e9; color: #2e7d32; }
    .cap-select.val-yes { background: #fff8e1; border-color: #f9a825; color: #e65100; font-weight: 600; }
    app-filter-bar.matrix-fb { display: block; margin-bottom: 16px; }
    .proj-th--focus { background: rgba(144,202,249,.18); box-shadow: inset 0 -3px 0 #90caf9; }
    .proj-th-name--btn { cursor: pointer; text-decoration: underline dotted rgba(255,255,255,.5); text-underline-offset: 3px; }
    .proj-th-name--btn:focus-visible { outline: 2px solid #90caf9; outline-offset: 2px; }
    .kpi-board.kpi-board--4 { grid-template-columns: minmax(240px, 3.4fr) minmax(250px, 3.4fr) minmax(220px, 2.6fr) minmax(360px, 5fr); }
    .attn-card { border-left-color: #e0a100; }
    .attn-card--ok { border-left-color: #2e7d32; }
    .attn-unsaved { margin-left: auto; font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: .3px; padding: 1px 7px; border-radius: 9px; background: #fff3e0; color: #8a4b00; }
    .attn-list { display: flex; flex-direction: column; gap: 2px; margin-top: 6px; max-height: 118px; overflow-y: auto; }
    .attn-row { display: flex; align-items: baseline; gap: 8px; border: none; background: none; text-align: left; padding: 3px 4px; border-radius: 5px; cursor: pointer; font-family: inherit; font-size: 12px; color: #222; }
    .attn-row:hover, .attn-row--on { background: #f1f6fd; }
    .attn-row:focus-visible { outline: 2px solid #1565c0; }
    .attn-dot { width: 8px; height: 8px; border-radius: 50%; background: #e0a100; flex: none; align-self: center; }
    .attn-dot--hire { background: #c62828; }
    .attn-name { font-weight: 600; max-width: 130px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: none; }
    .attn-msg { color: #6a4c00; }
    .attn-msg--hire { color: #b71c1c; font-weight: 600; }
    .bd-wrap { margin-bottom: 8px; }
    .bd-head { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 8px; font-size: 12px; }
    .bd-proj { font-weight: 700; color: #0d47a1; font-size: 13px; }
    .bd-stale { margin-bottom: 8px; padding: 6px 10px; border-radius: 6px; background: #fdecec; color: #b71c1c; font-size: 12px; font-weight: 600; border: 1px solid #f3c2c2; }
    .bd-need { color: #555; }
    .bd-tag { font-weight: 600; border-radius: 8px; padding: 2px 10px; background: #e8f1fd; color: #0d47a1; }
    .bd-tag--no { background: #fdecec; color: #b71c1c; }
    .bd-tag--good { background: #e6f4ea; color: #1b5e20; }
    .bd-rows { display: flex; flex-direction: column; gap: 3px; max-height: 440px; overflow-y: auto; padding-right: 4px; }
    .bd-row { display: flex; align-items: center; gap: 10px; }
    .bd-rq { flex: none; width: 62px; font-size: 11px; color: #555; }
    .bd-hbar { flex: 1 1 auto; max-width: 720px; height: 22px; display: flex; border: 1px solid #cfd4dc; border-radius: 4px; overflow: hidden; background: #fff; }
    .bd-hbar--over { border-color: #c62828; box-shadow: 0 0 0 1px #c62828; }
    .bd-rtot { flex: none; width: 40px; font-size: 11px; font-weight: 600; color: #333; }
    .bd-rtot--over { color: #c62828; }
    .bd-seg { display: flex; align-items: center; justify-content: center; color: #fff; font-size: 9.5px; font-weight: 600; border-left: 1px solid rgba(255,255,255,.6); overflow: hidden; white-space: nowrap; padding: 0 3px; flex: none; }
    .bd-seg span { overflow: hidden; text-overflow: ellipsis; }
    .bd-free { background: repeating-linear-gradient(45deg, #fff, #fff 5px, #f1f3f5 5px, #f1f3f5 10px); color: #556; border: 1px dashed #adb5bd; }
    .bd-ss { background: #ffe8cc; color: #7a3f00; }
    .bd-focus { background: #1565c0; box-shadow: inset 0 0 0 2px #0d47a1; font-size: 10.5px; }
    .bd-auto { box-shadow: inset 0 0 0 2px #0d47a1; }
    .plan-chip { position: absolute; left: 50%; bottom: 1px; transform: translateX(-50%); padding: 0 6px; border-radius: 8px; background: #e3f2fd; color: #0d47a1; font-size: 9px; font-weight: 600; font-style: italic; line-height: 13px; white-space: nowrap; cursor: default; }
    .matrix-footer { display: flex; align-items: center; justify-content: space-between; padding: 8px 0; }
    .matrix-count { font-size: 12px; color: #888; }
    /* Person row expand */
    .person-td--clickable { cursor: pointer; user-select: none; }
    .person-td--clickable:hover .person-name { color: #1565c0; }
    .expand-chevron { font-size: 14px; width: 14px; height: 14px; vertical-align: middle; color: #aaa; margin-right: 4px; }
    .person-row--expanded .person-name { color: #1565c0; }
    /* Inline capacity expansion */
    .capacity-inline-row td { padding: 0 !important; border-bottom: 2px solid #1565c0 !important; }
    .capacity-inline-td { background: #f8faff; overflow: hidden; }
    .capacity-inline-wrap { padding: 0; overflow-x: auto; display: flex; }
    /* Split: sticky left info panel + scrollable right cards */
    .capacity-split { display: flex; align-items: stretch; min-width: max-content; width: 100%; }
    .capacity-pin { width: 240px; flex-shrink: 0; padding: 14px 12px; background: white; border-right: 2px solid #e8eaf0; display: flex; flex-direction: column; gap: 4px; position: sticky; left: 0; z-index: 3; }
    .capacity-pin-name { font-size: 13px; font-weight: 700; color: #1a1a2e; }
    .capacity-pin-meta { font-size: 10px; color: #888; }
    .capacity-pin-hint { font-size: 9px; color: #bbb; line-height: 1.5; margin-top: 6px; }
    .capacity-cards-scroll { flex: 1; padding: 14px 12px; }
    .capacity-inline-slider { display: flex; align-items: center; gap: 8px; padding: 6px 0 10px; border-bottom: 1px solid #f0f0f0; margin-bottom: 10px; }
    .cap-slider-input { flex: 1; accent-color: #1565c0; cursor: pointer; }
    .cap-slider-label { font-size: 10px; color: #aaa; white-space: nowrap; }
    .cap-slider-current { font-size: 11px; font-weight: 600; color: #1565c0; white-space: nowrap; margin-left: 8px; }
    /* Person trend tile */
    .person-trend-tile { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; padding: 6px 10px; background: #f8faff; border-radius: 8px; border: 1px solid #e8f0fe; }
    .dominant-proj-label { font-size: 11px; color: #555; }
    .pattern-badge-sm { font-size: 9px; font-weight: 700; padding: 2px 7px; border-radius: 8px; }
    .pattern-stable    { background: #e8f5e9; color: #2e7d32; }
    .pattern-ramp_up   { background: #e3f2fd; color: #1565c0; }
    .pattern-ramp_down { background: #fff3e0; color: #e65100; }
    /* Projected card styling — clearly distinct from actual */
    .cap-q-card--projected { border: 2px dashed #1565c0 !important; background: #e8f4fd !important; }
    .cap-q-card--projected .cap-q-card-bar.cap-bar--available { background: #90caf9 !important; }
    .cap-q-card--projected .cap-q-card-bar.cap-bar--full { background: #64b5f6 !important; }
    .cap-q-card--projected .cap-q-card-bar.cap-bar--over { background: #e53935 !important; }
    .cap-q-card--projected .cap-q-card-label { color: #1565c0; font-weight: 700; }
    .proj-badge { font-size: 8px; font-weight: 700; background: #1565c0; color: white; padding: 1px 5px; border-radius: 4px; margin-left: 4px; vertical-align: middle; letter-spacing: 0.3px; }
    /* Team sparkline KPI */
    .forecast-kpi { flex-direction: column; gap: 4px; }

    /* Matrix toolbar + assignment output popover */
    .matrix-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
    .matrix-toolbar-hint { font-size: 12px; color: #888; }
    .status-filter { display: flex; gap: 6px; margin-left: auto; margin-right: 12px; }
    .status-filter .exp-chip.on { background: #1a237e; border-color: #1a237e; color: #fff; }
    .status-filter .exp-chip:focus-visible { outline: 2px solid #1a237e; outline-offset: 2px; }
    .review-badge { display: inline-block; margin-top: 4px; padding: 1px 7px; border-radius: 9px; background: #fff3e0; color: #8a4b00; font-size: 9px; font-weight: 700; letter-spacing: .3px; text-transform: uppercase; }
    .review-badge--pipeline { background: #e3f2fd; color: #0d47a1; }
    .proj-th--review { box-shadow: inset 0 -3px 0 #f9a825; }
    .matrix-td--review { background: #fffaf0; }
    .kpi-tile.prov { border-left-color: #7e57c2; }
    .kpi-tile.prov .kpi-val { color: #5e35b1; }
    .chip-prov { background: #ede7f6; color: #4527a0; }
    .export-wrap { position: relative; }
    .export-btn mat-icon { margin-right: 4px; }
    .export-backdrop { position: fixed; inset: 0; z-index: 90; }
    .export-pop { position: absolute; right: 0; top: calc(100% + 8px); width: 340px; background: #fff; border: 1px solid #e0e0e0; border-radius: 12px; box-shadow: 0 10px 32px rgba(0,0,0,0.18); padding: 16px 18px; z-index: 91; }
    .export-title { font-size: 14px; font-weight: 700; color: #1a1a2e; }
    .export-sub { font-size: 11px; color: #888; margin: 2px 0 12px; }
    .export-presets { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 14px; }
    .exp-chip { border: 1px solid #d5dbe6; background: #f6f8fb; color: #37474f; font-size: 11px; font-weight: 600; padding: 4px 10px; border-radius: 14px; cursor: pointer; font-family: inherit; }
    .exp-chip:hover { background: #e3f2fd; border-color: #90caf9; color: #1565c0; }
    .exp-row { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
    .exp-label { width: 58px; font-size: 11px; font-weight: 700; color: #888; text-transform: uppercase; letter-spacing: 0.4px; }
    .exp-select { height: 34px; border: 1px solid #ddd; border-radius: 8px; padding: 0 8px; font-size: 13px; font-family: inherit; background: #fff; outline: none; flex: 1; }
    .exp-select--q { flex: 0 0 76px; }
    .exp-select:focus { border-color: #1565c0; }
    .exp-seg { display: flex; border: 1px solid #ddd; border-radius: 8px; overflow: hidden; }
    .exp-seg button { border: none; background: #fff; padding: 7px 16px; font-size: 12px; font-weight: 600; color: #666; cursor: pointer; font-family: inherit; }
    .exp-seg button.on { background: #1565c0; color: #fff; }
    .exp-summary { background: #f3f6fb; color: #455a64; font-size: 11px; border-radius: 8px; padding: 8px 10px; margin: 4px 0 12px; }
    .exp-actions { display: flex; justify-content: flex-end; gap: 8px; }

    /* KPI board — fixed-height row: 2×2 small tiles | gap card | trend card */
    .kpi-board { display: grid; grid-template-columns: minmax(300px, 5fr) minmax(250px, 3.2fr) minmax(360px, 5fr); gap: 12px; margin-bottom: 14px; align-items: stretch; }
    .kpi-small-grid { display: grid; grid-template-columns: 1fr 1fr; grid-auto-rows: 1fr; gap: 12px; }
    .kpi-small-grid .ss-kpi { min-width: 0; padding: 10px 14px; display: flex; flex-direction: column; justify-content: center; }
    .kpi-small-grid .ss-kpi-value { font-size: 24px; line-height: 1.1; }
    .kpi-card { background: #fff; border: 1px solid #e0e0e0; border-radius: 8px; padding: 12px 16px; display: flex; flex-direction: column; min-width: 0; border-left: 4px solid #1565c0; }
    .gap-card { border-left-color: #c62828; }
    .gap-card--ok { border-left-color: #2e7d32; }
    .kpi-card-head { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
    .kpi-card-title { font-size: 10px; color: #888; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; }
    .gap-q-select { margin-left: auto; border: 1px solid #ddd; border-radius: 6px; font-size: 11px; font-weight: 700; color: #455a64; padding: 2px 6px; background: #fff; font-family: inherit; cursor: pointer; }
    .kpi-unit { font-size: 12px; font-weight: 600; color: #888; }
    .gap-main { display: flex; align-items: baseline; gap: 6px; flex-wrap: wrap; margin-bottom: 6px; }
    .gap-big { font-size: 30px; font-weight: 800; color: #c62828; line-height: 1.05; font-variant-numeric: tabular-nums; }
    .gap-big--ok { color: #2e7d32; }
    .gap-count { font-size: 11px; color: #78859a; margin-left: 4px; }
    .gap-list { display: flex; flex-direction: column; gap: 4px; flex: 1; min-height: 0; }
    .gap-row { display: grid; grid-template-columns: 78px 1fr 46px; align-items: center; gap: 8px; font-size: 11px; }
    .gap-name { font-weight: 700; color: #1a1a2e; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .gap-bar { height: 6px; background: #fdecea; border-radius: 3px; overflow: hidden; }
    .gap-bar-fill { display: block; height: 100%; background: #e53935; border-radius: 3px; }
    .gap-val { text-align: right; color: #c62828; font-weight: 700; font-variant-numeric: tabular-nums; }
    .gap-more { font-size: 10px; color: #90a4ae; }
    .gap-ok-note { font-size: 12px; color: #607d8b; padding-top: 2px; }
    .gap-foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; border-top: 1px solid #f0f2f6; margin-top: 8px; padding-top: 6px; font-size: 11px; color: #78859a; }
    .gap-foot strong { color: #1a1a2e; }
    .gap-peak { background: none; border: none; padding: 0; font-size: 11px; font-weight: 700; color: #c62828; cursor: pointer; font-family: inherit; }
    .gap-peak:hover { text-decoration: underline; }
    .kpi-info { font-size: 15px; width: 15px; height: 15px; color: #90a4ae; cursor: help; }
    .trend-chip { margin-left: auto; font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 10px; background: #e8f5e9; color: #2e7d32; white-space: nowrap; }
    .trend-chip--over { background: #ffebee; color: #c62828; }
    .trend-read { display: flex; flex-wrap: wrap; gap: 0 6px; font-size: 11px; color: #607d8b; line-height: 1.35; margin-top: 2px; }
    .trend-sep { color: #b0bec5; }
    .trend-read strong { color: #1a1a2e; }
    @media (max-width: 1320px) {
      .kpi-board { grid-template-columns: 1fr 1fr; }
      .kpi-small-grid { grid-column: 1 / -1; grid-template-columns: repeat(4, 1fr); }
    }
    .team-sparkline { display: flex; align-items: flex-end; gap: 2px; height: 32px; }
    .spark-seg { width: 8px; border-radius: 2px 2px 0 0; flex-shrink: 0; }
    .spark-seg-actual { background: #1565c0; }
    .spark-seg-proj   { background: #90caf9; opacity: 0.8; }
    /* SS inline section inside expanded person row */
    .pin-ss-head { display: flex; align-items: center; justify-content: space-between; font-size: 11px; font-weight: 700; color: #333; margin-bottom: 4px; }
    .pin-ss-total { font-weight: 700; color: #e65100; }
    .pin-ss-total--over { color: #c62828; }
    .pin-ss-row { display: flex; align-items: center; gap: 6px; padding: 2px 0; font-size: 11px; color: #333; }
    .pin-ss-row--off { color: #888; }
    .pin-ss-name { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .pin-ss-input { width: 46px; padding: 2px 4px; font-size: 11px; margin-left: 0; }
    .pin-ss-actions { display: flex; gap: 6px; margin-top: 6px; }
    .ss-inline-section { margin-top: 16px; padding-top: 12px; border-top: 1px dashed #e0e0e0; }
    .ss-inline-header { display: flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 600; color: #333; margin-bottom: 6px; }
    .ss-inline-total { font-size: 11px; font-weight: 600; color: #555; }
    .ss-inline-over { color: #e53935; }
    .ss-inline-tasks { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
    .ss-inline-task-row { display: flex; align-items: center; gap: 6px; font-size: 11px; background: #f8f8f8; border-radius: 6px; padding: 4px 8px; }
    .ss-inline-task-name { color: #333; }
    .capacity-inline-header { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; flex-wrap: wrap; }
    .capacity-inline-title { font-size: 13px; font-weight: 700; color: #1a1a2e; }
    .capacity-inline-hint { font-size: 11px; color: #888; }
    .capacity-inline-quarters { display: flex; gap: 8px; overflow-x: auto; padding-bottom: 4px; }
    /* Per-quarter card */
    .cap-q-card { min-width: 160px; background: white; border: 1px solid #e8e8e8; border-radius: 8px; padding: 10px 10px; display: flex; flex-direction: column; align-items: center; gap: 4px; flex-shrink: 0; }
    .cap-q-card--over { border-color: #ef9a9a; background: #fff5f5; }
    .cap-q-card--full { border-color: #ffcc80; background: #fffdf5; }
    .cap-q-card-label { font-size: 11px; font-weight: 700; color: #666; white-space: nowrap; }
    .cap-q-card-bar-wrap { width: 44px; height: 48px; background: #f0f0f0; border-radius: 3px; display: flex; align-items: flex-end; overflow: hidden; }
    .cap-q-card-bar { width: 100%; border-radius: 3px 3px 0 0; transition: height 0.2s; }
    .cap-q-card-val { font-size: 12px; font-weight: 700; color: #333; }
    .cap-val--over { color: #e53935; }
    /* Project breakdown inside card */
    .cap-q-projects { width: 100%; display: flex; flex-direction: column; gap: 3px; margin-top: 4px; border-top: 1px solid #f0f0f0; padding-top: 6px; }
    .cap-q-proj { display: flex; align-items: center; gap: 5px; font-size: 10px; }
    .cap-q-proj-dot { width: 6px; height: 6px; border-radius: 50%; background: #1565c0; flex-shrink: 0; }
    .cap-q-proj-name { color: #333; flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .cap-q-proj-hc { color: #1565c0; font-weight: 700; white-space: nowrap; min-width: 28px; text-align: right; }

    /* ── Capacity section ── */
    .capacity-section { margin-top: 16px; background: white; border: 1px solid #e0e0e0; border-radius: 10px; overflow: hidden; }
    .capacity-header { display: flex; align-items: center; gap: 12px; padding: 12px 16px; border-bottom: 1px solid #f0f0f0; background: #fafafa; flex-wrap: wrap; }
    .capacity-title { font-size: 13px; font-weight: 700; color: #1a1a2e; }
    .capacity-hint { font-size: 11px; color: #888; }
    .capacity-slider-wrap { display: flex; align-items: center; gap: 8px; margin-left: auto; }
    .capacity-range-label { font-size: 11px; font-weight: 600; color: #1565c0; white-space: nowrap; }
    .capacity-slider { width: 160px; accent-color: #1565c0; cursor: pointer; }
    .capacity-table-wrap { overflow-x: auto; }
    .capacity-table { border-collapse: collapse; width: max-content; min-width: 100%; }
    .cap-person-th { background: #1a1a2e; color: white; font-size: 12px; font-weight: 600; padding: 8px 16px; text-align: left; min-width: 180px; position: sticky; left: 0; z-index: 2; }
    .cap-q-th { background: #1a1a2e; color: white; font-size: 11px; font-weight: 600; padding: 8px 12px; text-align: center; min-width: 90px; white-space: nowrap; }
    .cap-person-td { font-size: 12px; font-weight: 600; color: #1a1a2e; padding: 8px 16px; border-bottom: 1px solid #f0f0f0; position: sticky; left: 0; background: white; z-index: 1; white-space: nowrap; }
    .cap-q-td { padding: 6px 12px; border-bottom: 1px solid #f0f0f0; text-align: center; min-width: 90px; }
    .cap-bar-wrap { width: 100%; height: 6px; background: #f0f0f0; border-radius: 3px; overflow: hidden; margin-bottom: 3px; }
    .cap-bar { height: 100%; border-radius: 3px; transition: width 0.2s ease; max-width: 100%; }
    .cap-bar--available { background: #4caf50; }
    .cap-bar--full { background: #ff9800; }
    .cap-bar--over { background: #e53935; }
    .cap-val { font-size: 11px; font-weight: 600; color: #555; }
    .cap-val--over { color: #e53935; }

    /* KPI bar */
    .kpi-bar { display: flex; gap: 12px; margin-bottom: 16px; flex-wrap: wrap; }
    .kpi-tile { background: white; border: 1px solid #e0e0e0; border-radius: 8px; padding: 12px 16px; min-width: 130px; border-left: 4px solid #1a1a2e; }
    .kpi-tile.green { border-left-color: #2e7d32; }
    .kpi-tile.amber { border-left-color: #f9a825; }
    .kpi-tile.red { border-left-color: #c62828; }
    .kpi-val { display: block; font-size: 24px; font-weight: 700; color: #1a1a2e; }
    .kpi-tile.green .kpi-val { color: #2e7d32; }
    .kpi-tile.amber .kpi-val { color: #e65100; }
    .kpi-tile.red .kpi-val { color: #c62828; }
    .kpi-label { display: block; font-size: 10px; color: #888; text-transform: uppercase; letter-spacing: 0.4px; margin-top: 2px; }

    /* Project accordion */
    .pas-card { background: white; border: 1px solid #e0e0e0; border-radius: 10px; margin-bottom: 10px; overflow: hidden; }
    .pas-header { display: flex; align-items: center; gap: 10px; padding: 14px 18px; cursor: pointer; transition: background 0.12s; }
    .pas-header:hover { background: #f8f9fa; }
    .pas-icon { color: #1565c0; font-size: 18px; width: 18px; height: 18px; }
    .pas-name { font-weight: 700; font-size: 14px; flex: 1; }
    .pas-chips { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    .chip { font-size: 11px; padding: 3px 10px; border-radius: 10px; font-weight: 600; }
    .chip-bu { background: #f5f5f5; color: #555; }
    .chip-hc { background: #e3f2fd; color: #1565c0; }
    .chip-ok { background: #e8f5e9; color: #2e7d32; }
    .chip-warn { background: #fff3e0; color: #e65100; }
    .chip-gap { background: #ffebee; color: #c62828; }
    .pas-chevron { color: #aaa; font-size: 20px; width: 20px; height: 20px; margin-left: 4px; }
    .pas-body { border-top: 1px solid #f0f0f0; }
    .pas-gap-msg { display: flex; align-items: center; gap: 8px; padding: 16px 18px; color: #c62828; font-size: 12px; }

    /* Allocation table */
    .alloc-table { width: 100%; border-collapse: collapse; font-size: 12px; }
    .alloc-table th { background: #f5f5f5; padding: 8px 14px; text-align: left; font-size: 11px; font-weight: 600; color: #666; text-transform: uppercase; letter-spacing: 0.3px; border-bottom: 1px solid #e8e8e8; }
    .alloc-table td { padding: 10px 14px; border-bottom: 1px solid #f5f5f5; vertical-align: middle; }
    .alloc-table tr:last-child td { border-bottom: none; }
    .alloc-table tr.row-standby td { opacity: 0.55; }
    .person-pill { display: flex; align-items: center; gap: 8px; }
    .avatar { border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 700; color: white; flex-shrink: 0; width: 28px; height: 28px; font-size: 10px; }
    .cap-badge { font-size: 11px; padding: 2px 8px; border-radius: 8px; font-weight: 600; }
    .cap-badge.eligible { background: #fff8e1; color: #e65100; }
    .cap-badge.eligible { background: #e3f2fd; color: #1565c0; }
    .cap-badge.standby { background: #f5f5f5; color: #aaa; }
    .hc-bar-wrap { width: 100px; height: 6px; background: #f0f0f0; border-radius: 3px; display: inline-block; vertical-align: middle; margin-right: 8px; overflow: hidden; }
    .hc-bar-fill { height: 6px; border-radius: 3px; }
    .status-chip { font-size: 10px; padding: 2px 8px; border-radius: 8px; font-weight: 700; }
    .sc-ok { background: #e8f5e9; color: #2e7d32; }
    .sc-warn { background: #fff3e0; color: #e65100; }
    .sc-grey { background: #f5f5f5; color: #aaa; }

    /* Utilisation */
    .util-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px; }
    .util-card { background: white; border: 1px solid #e0e0e0; border-radius: 8px; padding: 14px; }
    .util-card-header { display: flex; align-items: flex-start; gap: 10px; margin-bottom: 10px; }
    .util-info { flex: 1; }
    .util-name { font-size: 13px; font-weight: 700; color: #1a1a2e; }
    .util-meta { font-size: 10px; color: #aaa; margin-top: 1px; }
    .util-projects { margin-bottom: 10px; border-top: 1px solid #f5f5f5; padding-top: 8px; min-height: 30px; }
    .util-proj-row { display: flex; justify-content: space-between; align-items: center; font-size: 11px; color: #555; padding: 3px 0; }
    .util-proj-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .util-cap-badge { font-size: 12px; flex-shrink: 0; }
    .util-cap-badge.eligible { color: #e65100; }
    .util-no-assign { font-size: 11px; color: #ccc; font-style: italic; padding: 4px 0; }
    .util-load-bar { position: relative; height: 6px; background: #f0f0f0; border-radius: 3px; margin-top: 8px; overflow: hidden; }
    .util-load-fill { height: 6px; border-radius: 3px; transition: width 0.3s; }
    .util-load-label { font-size: 10px; color: #888; margin-top: 4px; display: block; }
    .util-empty { grid-column: 1/-1; padding: 32px; text-align: center; color: #aaa; font-size: 13px; }

    /* ── Steady State Projects tab ── */
    .ss-kpi-row { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 16px; }
    .ss-kpi { flex: 1; min-width: 120px; background: white; border: 1px solid #e0e0e0; border-radius: 8px; padding: 12px 14px; border-left: 4px solid; }
    .ss-kpi-label { font-size: 10px; color: #888; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }
    .ss-kpi-value { font-size: 24px; font-weight: 800; color: #1a1a2e; }
    .ss-kpi-sub { font-size: 11px; color: #aaa; margin-top: 1px; }
    .ss-card { background: white; border: 1px solid #e0e0e0; border-radius: 10px; overflow: hidden; margin-bottom: 16px; }
    .ss-card-header { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; border-bottom: 1px solid #f0f0f0; background: #fafafa; }
    .ss-card-title { font-size: 14px; font-weight: 700; color: #1a1a2e; }
    .ss-count-chip { background: #e0e0e0; color: #555; font-size: 11px; padding: 2px 8px; border-radius: 10px; font-weight: 700; }
    .ss-hint { font-size: 11px; color: #aaa; }
    .ss-dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; flex-shrink: 0; }
    .ss-badge { display: inline-block; padding: 2px 9px; border-radius: 10px; font-weight: 700; font-size: 11px; }
    .ss-badge.green { background: #e8f5e9; color: #2e7d32; }
    .ss-badge.grey { background: #f5f5f5; color: #555; }
    .ss-badge.blue { background: #e3f2fd; color: #1565c0; }
    .ss-hc-input { width: 60px; border: 1.5px solid #e0e0e0; border-radius: 6px; padding: 4px 8px; font-size: 13px; font-weight: 700; text-align: center; font-family: inherit; }
    .ss-hc-input:focus { outline: none; border-color: #1565c0; }
    .ss-overflow-chip { background: #e3f2fd; color: #1565c0; font-size: 10px; font-weight: 700; padding: 0 7px; border-radius: 10px; cursor: pointer; height: 24px; display: flex; align-items: center; }
    .ss-add-btn { width: 24px; height: 24px; border-radius: 50%; background: #e3f2fd; color: #1565c0; display: flex; align-items: center; justify-content: center; cursor: pointer; flex-shrink: 0; border: 1.5px dashed #90caf9; }
    .ss-add-btn:hover { background: #bbdefb; }
    .ss-table { width: 100%; border-collapse: collapse; font-size: 13px; table-layout: fixed; }
    .ss-table th { background: #f8f9fa; padding: 8px 14px; text-align: left; font-size: 11px; font-weight: 600; color: #888; border-bottom: 1px solid #e0e0e0; }
    .ss-table th:first-child { width: 280px; }
    .ss-table th:nth-child(2) { width: 120px; }
    .ss-table td { padding: 10px 14px; border-bottom: 1px solid #f5f5f5; vertical-align: middle; }
    .ss-table td:first-child { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 280px; }
    .ss-matrix { border-collapse: collapse; width: 100%; font-size: 12px; }
    .ss-matrix th { background: #f8f9fa; padding: 8px 10px; text-align: center; font-weight: 600; color: #888; border: 1px solid #e0e0e0; font-size: 11px; white-space: nowrap; }
    .ss-matrix td { padding: 5px 6px; border: 1px solid #f0f0f0; text-align: center; vertical-align: middle; }
    .ss-task-row td { font-weight: 600; }
    .ss-attr-row td { background: #fafcff; }
    .ss-mini-bar { height: 20px; border-radius: 4px; display: flex; overflow: hidden; }
    .ss-mini-seg { height: 100%; display: flex; align-items: center; justify-content: center; font-size: 9px; font-weight: 700; min-width: 2px; }
    .ss-alert { display: flex; align-items: center; gap: 8px; padding: 10px 14px; font-size: 12px; margin: 10px 16px 0; border-radius: 6px; }
    .ss-alert-ok { background: #e8f5e9; border: 1px solid #c8e6c9; color: #1b5e20; }
    .ss-alert-warn { background: #ffebee; border: 1px solid #ffcdd2; color: #b71c1c; }
    .ss-unsaved { background: #fff3e0; color: #e65100; font-size: 11px; font-weight: 600; padding: 2px 10px; border-radius: 10px; border: 1px solid #ffe0b2; }
    .ss-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.25); z-index: 200; }
    .ss-panel { position: fixed; right: 0; top: 56px; bottom: 0; width: 400px; background: white; box-shadow: -4px 0 24px rgba(0,0,0,0.15); z-index: 201; display: flex; flex-direction: column; }
    .ss-panel-header { padding: 18px 20px; border-bottom: 1px solid #e0e0e0; display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; }
    .ss-panel-title { font-size: 15px; font-weight: 700; color: #1a1a2e; }
    .ss-panel-body { flex: 1; overflow-y: auto; padding: 20px; display: flex; flex-direction: column; min-height: 0; }
    .ss-panel-footer { padding: 14px 20px; border-top: 1px solid #e0e0e0; display: flex; gap: 10px; justify-content: flex-end; align-items: center; flex-shrink: 0; }
    /* Person SS configure panel */
    .ss-panel-section-label { font-size: 10px; font-weight: 700; color: #888; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px; flex-shrink: 0; }
    .ss-panel-section-label .ss-panel-hint { font-weight: 400; color: #aaa; text-transform: none; letter-spacing: 0; }
    .ss-cap-tile { flex: 1; border-radius: 8px; padding: 10px 8px; text-align: center; }
    .ss-pc-bar-wrap { height: 8px; background: #e0e0e0; border-radius: 4px; overflow: hidden; display: flex; flex-shrink: 0; }
    .ss-empty-note { color: #aaa; font-size: 12px; font-style: italic; margin-bottom: 16px; }
    .ss-elig-proj { display: flex; align-items: center; justify-content: space-between; padding: 8px 10px; background: #f9f9f9; border-radius: 6px; margin-bottom: 4px; flex-shrink: 0; }
    .ss-elig-proj-name { font-size: 12px; font-weight: 600; color: #1a1a2e; }
    .ss-elig-chip { font-size: 10px; font-weight: 700; background: #e8f5e9; color: #2e7d32; padding: 2px 9px; border-radius: 10px; }
    .ss-task-list { display: flex; flex-direction: column; gap: 4px; flex: 0 0 auto; max-height: 380px; overflow-y: auto; padding-right: 4px; margin-bottom: 4px; }
    .ss-hist-section { margin-top: auto; padding-top: 16px; flex-shrink: 0; }
    .ss-task-row { display: flex; align-items: center; gap: 10px; padding: 7px 10px; border-radius: 6px; cursor: pointer; font-size: 12px; flex-shrink: 0; transition: background 0.12s; }
    .ss-task-row input[type=checkbox] { margin: 0; flex-shrink: 0; cursor: pointer; }
    .ss-task-name { flex: 1; color: #333; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .ss-hist-table-wrap { overflow-x: auto; flex-shrink: 0; margin: 0 -20px; padding: 0 20px; }
    .ss-hist-table { border-collapse: collapse; font-size: 11px; width: 100%; }
    .ss-hist-table th { text-align: center; padding: 5px 8px; background: #f8f9fa; border-bottom: 1px solid #e0e0e0; font-size: 10px; font-weight: 700; color: #666; white-space: nowrap; }
    .ss-hist-table th:first-child, .ss-hist-table td:first-child { text-align: left; white-space: nowrap; position: sticky; left: 0; background: white; }
    .ss-hist-table th:first-child { background: #f8f9fa; }
    .ss-hist-table td { text-align: center; padding: 4px 8px; border-bottom: 1px solid #f5f5f5; }
    .ss-hist-table td:first-child { color: #555; }
    .ss-form-group { margin-bottom: 14px; }
    .ss-form-label { font-size: 10px; font-weight: 700; color: #888; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 5px; display: block; }
    .ss-input { width: 100%; border: 1.5px solid #e0e0e0; border-radius: 6px; padding: 8px 10px; font-size: 13px; font-family: inherit; outline: none; resize: vertical; }
    .ss-input:focus { border-color: #1565c0; }
    /* Steady state distribution card */
    .ss-dist-card { background: white; border: 1px solid #e0e0e0; border-radius: 10px; overflow: hidden; margin-bottom: 16px; }
    .ss-dist-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px; padding: 16px; }
    .ss-person-card { background: #fafafa; border: 1px solid #e8e8e8; border-radius: 8px; padding: 14px; }
    .ss-person-over { background: #fff5f5; border-color: #ffcdd2; }
    .ss-pc-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px; }
    .ss-pc-bar-wrap { height: 8px; background: #f0f0f0; border-radius: 4px; overflow: hidden; display: flex; }
    .ss-pc-bar-proj { height: 100%; background: #90caf9; transition: width 0.3s; flex-shrink: 0; }
    .ss-pc-bar-ss { height: 100%; transition: width 0.3s; flex-shrink: 0; }
    .ss-pc-tasks { margin-top: 10px; display: flex; flex-direction: column; gap: 5px; }
    .ss-pc-task-row { display: flex; align-items: center; gap: 6px; font-size: 12px; }
    .ss-pc-task-name { flex: 1; color: #555; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .ss-pc-hc-input { width: 52px; border: 1.5px solid #e0e0e0; border-radius: 6px; padding: 3px 6px; font-size: 12px; text-align: center; font-family: inherit; margin-left: auto; flex-shrink: 0; }
    .ss-pc-hc-input:focus { outline: none; border-color: #e65100; }
    .ss-pc-configure { background: none; border: none; color: #1565c0; font-size: 11px; cursor: pointer; display: flex; align-items: center; gap: 3px; margin-top: 8px; font-family: inherit; padding: 0; }
    .ss-pc-configure:hover { text-decoration: underline; }

    /* Steady state effort matrix */
    .ss-effort-matrix { border-collapse: collapse; width: 100%; font-size: 12px; }
    .ssm-person-hd { text-align: left; min-width: 220px; padding: 10px 14px; background: #1a1a2e; color: white; font-size: 11px; font-weight: 600; position: sticky; left: 0; z-index: 3; }
    .ssm-task-hd { background: #1a1a2e; color: white; padding: 8px 10px; text-align: center; min-width: 130px; border-left: 1px solid rgba(255,255,255,0.1); vertical-align: middle; }
    .ssm-task-hd-inner { display: flex; align-items: center; gap: 5px; justify-content: center; margin-bottom: 2px; }
    .ssm-task-name { font-size: 11px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 110px; }
    .ssm-task-code { font-size: 9px; color: #90caf9; font-weight: 400; margin-top: 1px; }
    .ssm-total-hd { background: #1a1a2e; color: #aaa; padding: 8px 10px; text-align: center; font-size: 10px; font-weight: 600; white-space: nowrap; min-width: 60px; }
    .ssm-budget-row { background: #f8f9fa; }
    .ssm-budget-row td { padding: 5px 8px; border-bottom: 2px solid #e0e0e0; }
    .ssm-person-td { padding: 8px 14px; background: #fafafa; position: sticky; left: 0; z-index: 1; border-right: 1px solid #e8e8e8; min-width: 220px; vertical-align: middle; }
    .ssm-cell { text-align: center; padding: 4px 6px; border-bottom: 1px solid #f5f5f5; border-left: 1px solid #f5f5f5; }
    .ssm-input { width: 54px; border: 1.5px solid #e0e0e0; border-radius: 6px; padding: 4px 6px; font-size: 12px; text-align: center; font-family: inherit; color: #555; }
    .ssm-input:focus { outline: none; border-color: #1565c0; }
    .ssm-input-set { border-color: #2e7d32; background: #f0fdf4; color: #2e7d32; font-weight: 700; }
    .ssm-input:not(.ssm-input-set) { color: #ddd; }
    .ssm-input::placeholder { color: #ddd; }
    .ssm-total-cell { text-align: center; padding: 4px 10px; font-size: 12px; border-bottom: 1px solid #f5f5f5; white-space: nowrap; }
    .ssm-row-over { background: #fff5f5 !important; }
    .ssm-legend-over { font-size: 11px; color: #888; }
    .ss-person-row { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 6px; cursor: pointer; transition: background 0.12s; }
    .ss-person-row:hover { background: #f5f5f5; }
    .ss-selected { background: #e8f5e9 !important; }
    .ss-val-bar { height: 8px; background: #e0e0e0; border-radius: 4px; overflow: hidden; display: flex; margin-top: 6px; }

    /* ── Assignment Output tab ── */
    .compute-empty { display: flex; flex-direction: column; align-items: center; gap: 16px; padding: 60px 0; color: #aaa; }
    .compute-empty p { font-size: 14px; color: #888; }
    .section-label-row { font-size: 11px; font-weight: 700; color: #888; text-transform: uppercase; letter-spacing: 0.8px; margin-bottom: 10px; padding-bottom: 6px; border-bottom: 1px solid #f0f0f0; }
    .compute-gap-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; }
    .compute-gap-card { background: white; border: 1px solid #e0e0e0; border-radius: 10px; padding: 14px 16px; border-left: 4px solid #e0e0e0; }
    .gap-ok { border-left-color: #2e7d32; }
    .gap-bad { border-left-color: #c62828; }
    .cgc-name { font-size: 13px; font-weight: 700; color: #1a1a2e; margin-bottom: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .cgc-bu { font-size: 10px; color: #aaa; margin-bottom: 10px; }
    .cgc-nums { display: flex; gap: 12px; margin-bottom: 10px; }
    .cgc-stat { flex: 1; text-align: center; }
    .cgc-val { font-size: 18px; font-weight: 800; color: #1a1a2e; }
    .cgc-lbl { font-size: 9px; color: #aaa; text-transform: uppercase; letter-spacing: 0.5px; }
    .cgc-bar-row { display: flex; gap: 2px; height: 20px; align-items: flex-end; }
    .cgc-q-bar { flex: 1; height: 100%; border-radius: 2px; overflow: hidden; display: flex; flex-direction: column; justify-content: flex-end; position: relative; }
    .cgc-q-fill { width: 100%; border-radius: 2px; transition: height 0.3s; }
    .compute-matrix { border-collapse: collapse; width: 100%; font-size: 11px; }
    .compute-matrix th { background: #1a1a2e; color: white; padding: 8px 6px; text-align: center; font-size: 10px; white-space: nowrap; font-weight: 600; }
    .cm-person-hd { text-align: left !important; min-width: 180px; position: sticky; left: 0; background: #1a1a2e; z-index: 2; }
    .compute-matrix td { padding: 5px 4px; border-bottom: 1px solid #f5f5f5; text-align: center; vertical-align: middle; }
    .cm-person-td { text-align: left !important; display: flex; align-items: center; gap: 8px; padding: 6px 10px !important; background: #fafafa; position: sticky; left: 0; z-index: 1; border-right: 1px solid #e8e8e8; min-width: 180px; }
    .compute-matrix tr:hover td { background: #f5f7ff; }
    .compute-matrix tr:hover .cm-person-td { background: #eef2ff; }
    .cm-cell { min-width: 64px; }
    .cm-assign-chip { display: inline-block; padding: 2px 8px; border-radius: 8px; color: white; font-size: 10px; font-weight: 700; cursor: default; }
  `]
})
export class AllocationComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  Math = Math;

  qs = inject(QuarterService);
  activeTab: 'matrix' | 'summary' | 'util' | 'steady' | 'compute' = 'matrix';

  // ── HC info panel ────────────────────────────────────────────────────────────
  showHcPanel = false;
  hcPanelProject: any = null;
  hcPanelX = 0;
  hcPanelY = 0;            // distance from the top (opens below the button) or from the bottom (when flipped up)
  hcPanelFlip = false;
  hcPanelMaxH = 360;
  /** One row per quarter: `sized` = sizing allotment (or total project sizing for All Teams), `team` = HC the manager's people carry on the project. */
  hcPanelRows: { quarter: string; sized: number | null; team: number | null }[] = [];
  hcPanelShowAll = false;
  get hcPanelHasDemand(): boolean { return this.hcPanelRows.some(r => r.sized !== null); }
  get hcPanelMax(): number { return Math.max(...this.hcPanelRows.map(q => Math.max(q.sized ?? 0, q.team ?? 0)), 1); }
  /** Default view starts 4 quarters before the current one; older history is one click away. */
  private get hcPanelCutoff(): number { return this.parseQ(this.currentQuarter) - 4; }
  get hcPanelVisibleRows() {
    return this.hcPanelShowAll ? this.hcPanelRows : this.hcPanelRows.filter(r => this.parseQ(r.quarter) >= this.hcPanelCutoff);
  }
  get hcPanelHiddenCount(): number { return this.hcPanelRows.length - this.hcPanelVisibleRows.length; }

  private hcPanelBtn: HTMLElement | null = null;

  /** Anchors the panel to its button (fixed viewport coordinates). Opens below the button; with little room below it opens
   *  above, hugging the button via `bottom` (the panel height is unknown, so it is never guessed).
   *  Returns false when the button is no longer visible in the viewport. */
  private positionHcPanel(): boolean {
    const btn = this.hcPanelBtn;
    if (!btn || !btn.isConnected) return false;
    const rect = btn.getBoundingClientRect();
    if (rect.bottom < 0 || rect.top > window.innerHeight || rect.right < 0 || rect.left > window.innerWidth) return false;
    const panelW = 300;
    let x = rect.left;
    if (x + panelW > window.innerWidth - 16) x = rect.right - panelW;
    this.hcPanelX = Math.max(8, x);
    const spaceBelow = window.innerHeight - rect.bottom - 12;
    const spaceAbove = rect.top - 12;
    this.hcPanelFlip = spaceBelow < 220 && spaceAbove > spaceBelow;
    const room = this.hcPanelFlip ? spaceAbove : spaceBelow;
    this.hcPanelMaxH = Math.max(120, Math.min(360, room - 8));
    this.hcPanelY = this.hcPanelFlip ? window.innerHeight - rect.top + 4 : rect.bottom + 4;
    return true;
  }

  openHcPanel(proj: any, event: MouseEvent) {
    event.stopPropagation();
    this.hcPanelProject = proj;
    this.showHcPanel = true;

    this.hcPanelBtn = (event.target as HTMLElement).closest('button');
    this.positionHcPanel();

    this.hcPanelShowAll = false;
    if (this.selectedManager) {
      // Manager view: sizing allotment (if the manager is named in the sizing) next to the HC their people carry
      const sized: Record<string, number> = this.managerAllotment.find(p => p.project_id === proj.project_id)?.quarters || {};
      const team: Record<string, number> = proj.teamHcByQuarter || {};
      const quarters = new Set([...Object.keys(sized), ...Object.keys(team)]);
      this.hcPanelRows = [...quarters]
        .map(q => ({ quarter: q, sized: q in sized ? Number(sized[q]) : null, team: q in team ? Number(team[q]) : null }))
        .sort((a, b) => this.parseQ(a.quarter) - this.parseQ(b.quarter));
    } else {
      // All Teams — show total project sizing per quarter from DB
      this.hcPanelRows = [];
      this.api.getProjectQuarterlyTotals(proj.project_id).subscribe({
        next: (res: any) => {
          this.hcPanelRows = ((res.data || []) as { quarter: string; hc: number | null; team: number | null }[])
            .map(q => ({ quarter: q.quarter, sized: q.hc, team: q.team }));
          this.cdr.detectChanges();
        },
        error: () => { this.hcPanelRows = []; }
      });
    }
    this.cdr.detectChanges();
  }

  private parseQ(s: string): number {
    const m = s.match(/Q(\d) FY(\d{2})/);
    return m ? parseInt(m[2]) * 4 + parseInt(m[1]) : 0;
  }

  // ── Fine-tune panel ──────────────────────────────────────────────────────────
  showFineTune = false;
  fineTuneProject: any = null;
  ftLoading = false;
  ftQuarters: string[] = [];
  ftEligiblePeople: any[] = [];
  // Map: "personId_quarter" → effort_hc
  ftEffortMap = new Map<string, number>();

  openFineTune(proj: any) {
    this.fineTuneProject = proj;
    this.showFineTune = true;
    this.ftLoading = true;
    this.ftEffortMap.clear();

    // Build quarter list from sizing data quarters (last 2 + next 6 from current)
    this.ftQuarters = this.qs ? this.qs.generateRange(this.qs.currentQuarterLabel, 2, 6) : [];

    // Eligible people = team members with Yes for this project
    this.ftEligiblePeople = this.team.filter(p =>
      this.getElig(p.person_id, proj.project_id) !== ''
    );

    // Load existing effort overrides from DB
    this.api.getEffort(proj.project_id).subscribe({
      next: (res: any) => {
        for (const row of (res.data || [])) {
          const q = `Q${row.quarter} FY${String(row.fiscal_year).slice(-2)}`;
          this.ftEffortMap.set(`${row.person_id}_${q}`, Number(row.effort_hc));
        }
        this.ftLoading = false;
        this.cdr.detectChanges();
      },
      error: () => { this.ftLoading = false; this.cdr.detectChanges(); }
    });
  }

  getFtEffort(personId: number, q: string): number | string {
    const v = this.ftEffortMap.get(`${personId}_${q}`);
    return v !== undefined ? v : '';
  }

  // Auto value = manager's allotment for this quarter ÷ number of eligible people
  getAutoHc(q: string): string {
    if (!this.fineTuneProject || !this.ftEligiblePeople.length) return 'auto';
    const allotment = this.getAllotmentForProject(this.fineTuneProject.project_id);
    const hc = allotment[q];
    if (!hc) return 'auto';
    const perPerson = Math.round((hc / this.ftEligiblePeople.length) * 100) / 100;
    return perPerson > 0 ? String(perPerson) : 'auto';
  }

  setFtEffort(personId: number, q: string, event: Event) {
    const val = parseFloat((event.target as HTMLInputElement).value);
    const key = `${personId}_${q}`;
    if (isNaN(val) || val <= 0) this.ftEffortMap.delete(key);
    else this.ftEffortMap.set(key, Math.min(1, val));
    this.cdr.detectChanges();
  }

  getPersonTotalEffort(personId: number): number {
    let total = 0;
    for (const [key, val] of this.ftEffortMap.entries()) {
      if (key.startsWith(`${personId}_`)) total += val;
    }
    // Average across quarters for the display bar
    return this.ftQuarters.length ? Math.round(total / this.ftQuarters.length * 100) / 100 : 0;
  }

  saveFineTune() {
    if (!this.fineTuneProject) return;
    const records: any[] = [];
    for (const [key, effort_hc] of this.ftEffortMap.entries()) {
      const [personIdStr, q] = key.split('_');
      const m = q.match(/Q(\d) FY(\d{2})/);
      if (!m) continue;
      records.push({
        person_id: parseInt(personIdStr),
        fiscal_year: 2000 + parseInt(m[2]),
        quarter: parseInt(m[1]),
        effort_hc
      });
    }
    this.api.saveEffortBulk(
      this.fineTuneProject.project_id, records,
      this.auth.user()?.email
    ).subscribe({
      next: () => {
        this.snackBar.open('Effort allocations saved', 'Close', { duration: 3000, horizontalPosition: 'end', verticalPosition: 'top' });
        this.showFineTune = false;
      },
      error: () => this.snackBar.open('Failed to save', 'Close', { duration: 3000, horizontalPosition: 'end', verticalPosition: 'top', panelClass: ['snack-error'] })
    });
  }

  // Compute engine state
  computeLoading = false;
  computeResult: any = null;
  private _projectColors = ['#1565c0','#2e7d32','#c62828','#6a1b9a','#e65100','#00695c','#0277bd','#558b2f','#bf360c','#37474f'];
  private _projColorMap: Record<number, string> = {};
  loading = false;
  saving = false;

  selectedManager = '';
  managerList: string[] = [];
  team: any[] = [];
  projects: any[] = [];
  summaryData: any[] = [];

  // eligibility map: "person_id:project_id" → capability
  eligibilityMap: Map<string, string> = new Map();

  expandedProjects = new Set<number>();

  // Unified filter bar state — same pattern as Projects / Sizing / Sizing View
  utilFilterSelected: FilterState = { location: [], employment: [], status: [] };
  filteredUtilTeam: any[] = [];

  readonly utilFilterDefs: FilterDef[] = [
    { key: 'location',   label: 'Location',   width: '155px' },
    { key: 'employment', label: 'Employment',  width: '145px' },
    { key: 'status',     label: 'Show',        width: '160px' },
  ];

  get utilFilterOptions(): { [key: string]: string[] } {
    const sel = this.utilFilterSelected;
    const locationOpts = [...new Set(this.team.map(p => p.location).filter(Boolean))].sort();
    const afterLoc = sel['location'].length
      ? this.team.filter(p => sel['location'].includes(p.location))
      : this.team;
    const empOpts = [...new Set(afterLoc.map(p => p.employment_type).filter(Boolean))].sort();
    return {
      location: locationOpts,
      employment: empOpts,
      status: ['Has assignments', 'No assignments'],
    };
  }

  onUtilFilterChange(state: FilterState) {
    this.utilFilterSelected = state;
    this.applyUtilFilter();
  }

  constructor(
    private api: ApiService,
    private auth: AuthService,
    private snackBar: MatSnackBar,
    private cdr: ChangeDetectorRef
  ) {}

  get isElevated(): boolean { return this.auth.isElevated(); }

  get currentManagerName(): string {
    const u = this.auth.user();
    if (!u) return '';
    // Map email to display_name format in RA_people
    return u.name; // will be matched against reporting_manager field
  }

  ngOnInit() {
    this.loadManagerList();
    // Capture phase: also catches scrolling of inner containers, not just the window.
    document.addEventListener('scroll', this.onAnyScroll, true);
    window.addEventListener('resize', this.onAnyScroll);
  }

  ngOnDestroy() {
    document.removeEventListener('scroll', this.onAnyScroll, true);
    window.removeEventListener('resize', this.onAnyScroll);
    this.destroy$.next();
    this.destroy$.complete();
  }

  /** Keeps the HC panel glued to its button while the page (or any inner container) scrolls or resizes. */
  private onAnyScroll = (e: Event) => {
    if (!this.showHcPanel || !this.hcPanelBtn) return;
    const target = e.target as HTMLElement | null;
    if (target && typeof target.closest === 'function' && target.closest('.hcp-panel')) return; // scrolling inside the panel itself
    if (!this.positionHcPanel()) this.showHcPanel = false;   // button scrolled out of view → close
    this.cdr.detectChanges();
  };

  loadManagerList() {
    this.api.getAllocationTeam('').pipe(takeUntil(this.destroy$)).subscribe({
      next: (res: any) => {
        const mgrs = [...new Set((res.data || []).map((p: any) => p.reporting_manager).filter(Boolean))].sort();
        this.managerList = mgrs as string[];
        if (!this.isElevated) {
          this.selectedManager = this.currentManagerName;
          this.loadManagerAllotment();
        }
        this.loadData();
      },
      error: () => {
        // Manager list failed — still try to load data
        this.loadData();
      }
    });
  }

  // Capacity view data
  capacityQuarters: string[] = [];
  capacityWindowStart = 0;
  readonly capacityWindowSize = 999; // show all quarters — container scrolls horizontally
  // Retro HC: person_id → quarter → total HC
  personRetroHC: Map<number, Record<string, number>> = new Map();
  // Breakdown: person_id → quarter → [{project_name, hc}]
  personRetroBreakdown: Map<number, Record<string, {name: string; hc: number; is_ss?: boolean}[]>> = new Map();
  // Which person row is expanded inline
  expandedPeople = new Set<number>();   // several people can stay open at once, to compare them
  isExpanded(id: number): boolean { return this.expandedPeople.has(id); }
  toggleExpanded(id: number) { if (this.expandedPeople.has(id)) this.expandedPeople.delete(id); else this.expandedPeople.add(id); }

  /** Current quarter — calendar based, same convention the capacity cards and forecast use (Oct 2026 = Q4 FY26). */
  get currentQuarter(): string {
    const now = new Date();
    return `Q${Math.ceil((now.getMonth() + 1) / 3)} FY${String(now.getFullYear()).slice(-2)}`;
  }

  private qNum(label: string): number {
    const m = label.match(/Q(\d) FY(\d{2})/);
    return m ? (2000 + parseInt(m[2])) * 4 + parseInt(m[1]) : 0;
  }

  // Current-quarter split per person from retro data: project work vs steady-state work already recorded
  personCurrentLoad: Map<number, { projectHc: number; ssHc: number; ssItems: { name: string; hc: number }[] }> = new Map();

  // ── Team trend line (tile) + over-capacity gap KPI ─────────────────────────
  teamTrend: HcPoint[] = [];
  teamCapacity = 0;
  trendSummary: { nowValue: number; pct: number; peakLabel: string; peakValue: number; overCount: number; firstOver: string | null } | null = null;
  gapQuarter = '';
  gapByQuarter: Map<string, { over: number; spare: number; people: { name: string; over: number }[] }> = new Map();
  peakGap: { quarter: string; over: number } | null = null;

  /** Rebuild everything derived from capacity + forecast data. Cheap; called after either loader finishes. */
  rebuildTrend() {
    if (!this.capacityQuarters.length || !this.forecastData) return;
    const fd = this.forecastData;
    const actual: string[] = fd.actual_quarters || [];
    const curKey = this.qNum(this.currentQuarter);
    this.teamCapacity = Number(fd.team_size) || this.team.length;

    // Team line: HC load per quarter across the whole window (4 back → 5 years ahead)
    const pts: HcPoint[] = [];
    for (const q of this.capacityQuarters) {
      const isData = actual.includes(q);
      const value = isData ? Number(fd.team?.actual?.[q] || 0) : Number(fd.team?.forecast?.[q] || 0);
      const kind: HcPointKind = !isData ? 'forecast' : (this.qNum(q) <= curKey ? 'actual' : 'planned');
      pts.push({ label: q, value: Math.round(value * 100) / 100, kind });
    }
    this.teamTrend = pts;

    const nowPt = pts.find(p => p.label === this.currentQuarter) || pts[Math.min(4, pts.length - 1)];
    const future = pts.filter(p => this.qNum(p.label) >= curKey);
    const peak = future.reduce((m, p) => (p.value > m.value ? p : m), future[0] || nowPt);
    const overPts = future.filter(p => this.teamCapacity > 0 && p.value > this.teamCapacity + 0.0001);
    this.trendSummary = nowPt ? {
      nowValue: nowPt.value,
      pct: this.teamCapacity > 0 ? Math.round((nowPt.value / this.teamCapacity) * 100) : 0,
      peakLabel: peak?.label || '', peakValue: peak?.value || 0,
      overCount: overPts.length, firstOver: overPts[0]?.label || null
    } : null;

    // Per-quarter over-capacity gap (sum of each person's load above 1.0 HC) + spare capacity
    this.gapByQuarter = new Map();
    let worst: { quarter: string; over: number } | null = null;
    for (const q of this.capacityQuarters) {
      const projected = !actual.includes(q);
      let over = 0, spare = 0;
      const people: { name: string; over: number }[] = [];
      for (const p of this.team) {
        const hc = projected ? this.getPersonForecastHC(p.person_id, q) : this.getPersonQuarterHC(p.person_id, q);
        if (hc > 1.0001) { const o = Math.round((hc - 1) * 100) / 100; over += o; people.push({ name: p.display_name, over: o }); }
        else spare += Math.max(0, 1 - hc);
      }
      over = Math.round(over * 100) / 100;
      this.gapByQuarter.set(q, { over, spare: Math.round(spare * 100) / 100, people });
      if (over > 0 && this.qNum(q) >= curKey - 4 && (!worst || over > worst.over)) worst = { quarter: q, over };
    }
    this.peakGap = worst;
    if (!this.gapQuarter || !this.capacityQuarters.includes(this.gapQuarter)) {
      this.gapQuarter = this.capacityQuarters.includes(this.currentQuarter) ? this.currentQuarter : this.capacityQuarters[0];
    }
    this.cdr.markForCheck();
  }

  get gapInfo() { return this.gapByQuarter.get(this.gapQuarter) || { over: 0, spare: 0, people: [] }; }
  /** Over-booked people for the gap card, worst first, capped so the card keeps a fixed height. */
  get gapPeopleShown() { return [...this.gapInfo.people].sort((a, b) => b.over - a.over).slice(0, 4); }
  /** Bar scale: at least 0.5 HC so a +0.10 overage doesn't fill the whole bar. */
  get gapMax(): number { return Math.max(...this.gapInfo.people.map(p => p.over), 0.5); }
  onGapQuarterChange(q: string) { this.gapQuarter = q; this.cdr.markForCheck(); }

  get displayedCapacityQuarters(): string[] {
    const end = Math.min(this.capacityQuarters.length, this.capacityWindowStart + this.capacityWindowSize);
    return this.capacityQuarters.slice(this.capacityWindowStart, end);
  }

  // ── Forecast data (Phase 3 & 4) ───────────────────────────────────────────
  forecastData: any = null;
  // person_id → { forecast: {quarter→hc}, pattern, dominant_project }
  personForecastMap: Map<number, { forecast: Record<string, number>; pattern: string; dominant_project: string | null }> = new Map();

  loadForecastData(mgr?: string) {
    this.api.getForecast(mgr, 21).subscribe({
      next: (res: any) => {
        this.forecastData = res.data;
        this.personForecastMap = new Map();
        for (const person of (res.data?.people || [])) {
          const fMap: Record<string, number> = {};
          for (const proj of (person.projects || [])) {
            for (const [q, hc] of Object.entries(proj.forecast || {})) {
              fMap[q] = (fMap[q] || 0) + Number(hc);
            }
          }
          this.personForecastMap.set(Number(person.person_id), {
            forecast: fMap,
            pattern: person.pattern || 'stable',
            dominant_project: person.dominant_project || null,
          });
        }
        this.rebuildTrend();
        this.cdr.markForCheck();
      },
      error: () => {}
    });
  }

  getPersonForecastHC(personId: number, quarter: string): number {
    return this.personForecastMap.get(Number(personId))?.forecast?.[quarter] || 0;
  }

  isProjectedQuarter(quarter: string): boolean {
    if (!this.forecastData) return false;
    return !this.forecastData.actual_quarters?.includes(quarter);
  }

  patternLabel(p: string): string {
    return p === 'ramp_up' ? '↑ Increasing' : p === 'ramp_down' ? '↓ Decreasing' : '→ Stable';
  }

  /** Load capacity data for any manager — called from both loadData branches */
  loadCapacityData(mgr?: string) {
    this.api.getPersonCapacity(mgr).subscribe({
      next: (capRes: any) => {
        this.personRetroHC = new Map();
        this.personRetroBreakdown = new Map();
        this.personCurrentLoad = new Map();
        const nowQLabel = this.currentQuarter;
        const qSet = new Set<string>();
        for (const person of (capRes?.data || [])) {
          const qMap: Record<string, number> = {};
          const bMap: Record<string, {name: string; hc: number; is_ss?: boolean}[]> = {};
          let cur = { projectHc: 0, ssHc: 0, ssItems: [] as { name: string; hc: number }[] };
          for (const entry of (person.quarters || [])) {
            const alloc = Number(entry.allocated) || 0;
            if (alloc > 0) {
              qMap[entry.quarter] = alloc;
              bMap[entry.quarter] = (entry.projects || []).map((p: any) => ({ name: p.name, hc: Number(p.hc), is_ss: !!p.is_ss }));
              qSet.add(entry.quarter);
              if (entry.quarter === nowQLabel) {
                cur = {
                  projectHc: Number(entry.project_hc) || 0,
                  ssHc: Number(entry.ss_hc) || 0,
                  ssItems: (entry.projects || []).filter((p: any) => p.is_ss).map((p: any) => ({ name: p.name, hc: Number(p.hc) }))
                };
              }
            }
          }
          this.personRetroHC.set(Number(person.person_id), qMap);
          this.personRetroBreakdown.set(Number(person.person_id), bMap);
          this.personCurrentLoad.set(Number(person.person_id), cur);
        }
        // Generate full window: 4 quarters before current + 5 years forward
        // So the default view always shows some actual history AND forecast
        const now = new Date();
        const curFY = now.getFullYear();
        const curQ = Math.ceil((now.getMonth() + 1) / 3);
        const allQuarters: string[] = [];
        // Start 4 quarters back for context
        for (let offset = -4; offset <= 20; offset++) {
          let fy = curFY, q = curQ + offset;
          while (q <= 0) { q += 4; fy--; }
          while (q > 4)  { q -= 4; fy++; }
          allQuarters.push(`Q${q} FY${String(fy).slice(-2)}`);
        }
        this.capacityQuarters = allQuarters;
        // Default: start at index 0 (4 quarters back) so user sees 4 actual + 4 forecast immediately
        this.capacityWindowStart = 0;
        this.rebuildTrend();
        this.ssReady.cap = true;
        this.tryReconcileSs();
        this.cdr.markForCheck();
      },
      error: () => {}
    });
  }

  /** HC per person per quarter — reads directly from uploaded effort data (RA_person_project_effort).
   *  This covers all quarters the user has uploaded, including through FY30 Q4.
   *  Future eligibility-based projection is separate (Phase 2). */
  getPersonQuarterHC(personId: number, quarter: string): number {
    return this.personRetroHC.get(Number(personId))?.[quarter] || 0;
  }

  /** Capacity bar pct (capped at 120% so over-threshold is visible) */
  getCapacityPct(personId: number, quarter: string): number {
    return Math.min(this.getPersonQuarterHC(personId, quarter) * 100, 120);
  }

  loadData() {
    this.loading = true;
    const mgr = this.selectedManager || undefined;

    if (mgr) {
      // Manager selected — load only their scoped projects (via sizing manager_name)
      Promise.all([
        this.api.getManagerProjects(mgr).toPromise(),
        this.api.getAllocationEligibility(mgr).toPromise(),
      ]).then(([mgrProjRes, eligRes]: any[]) => {
        const payload = mgrProjRes?.data || {};
        this.team = payload.team || [];
        this.projects = payload.projects || [];
        this.managerAllotment = (payload.projects || []).map((p: any) => ({
          project_id: p.project_id,
          project_name: p.project_name,
          quarters: p.hcByQuarter || {},
          hcByLocationQuarter: p.hcByLocationQuarter || {}
        }));
        // Build capacity quarters from HC data; fall back to current FY ± 2 years
        const qSet = new Set<string>();
        for (const p of this.managerAllotment) Object.keys(p.quarters).forEach(q => qSet.add(q));
        if (qSet.size === 0) {
          // No HC data — generate standard window so capacity section still renders
          const now = new Date();
          const curFY = now.getFullYear();
          for (let fy = curFY - 1; fy <= curFY + 3; fy++) {
            for (let q = 1; q <= 4; q++) qSet.add(`Q${q} FY${String(fy).slice(-2)}`);
          }
        }
        // Sort by fiscal year then quarter
        this.capacityQuarters = Array.from(qSet).sort((a, b) => {
          const parseQ = (s: string) => { const m = s.match(/Q(\d) FY(\d{2})/); return m ? parseInt(m[2]) * 10 + parseInt(m[1]) : 0; };
          return parseQ(a) - parseQ(b);
        });
        this.filteredUtilTeam = [...this.team];
        this.eligibilityMap.clear();
        // Merge both eligibility sources
        const allElig = [...(payload.eligibility || []), ...(eligRes?.data || [])];
        allElig.forEach((e: any) => {
          this.eligibilityMap.set(`${e.person_id}:${e.project_id}`, e.capability);
        });
        this.loading = false;
        this.cdr.markForCheck();
        this.loadSummary();
        this.savedEligSnap = this.eligSnapshot();
        this.planDirty = false;
        this.planHireByProject = new Map();
        this.refreshPlanPreview();
        // SS auto-distribution needs capacity + SS tasks + SS effort + SS eligibility; it runs once all four are in.
        this.ssReady = { cap: false, tasks: this.steadyStateTasks.length > 0, eff: false, elig: false };
        this.ssReconciled = false;
        this.loadCapacityData(mgr);
        this.loadForecastData(mgr);   // Phase 4 — precomputed backend forecast
        if (this.steadyStateTasks.length === 0) this.loadSteadyStateTasks();
        this.loadSteadyStateEffort();
        this.loadSsEligibility();
      }).catch((err) => {
        console.error('loadData error:', err);
        this.loading = false;
        this.cdr.detectChanges();
      });
    } else {
      // No manager — show all projects
      Promise.all([
        this.api.getAllocationTeam(mgr).toPromise(),
        this.api.getProjects().toPromise(),
        this.api.getAllocationEligibility(mgr).toPromise(),
      ]).then(([teamRes, projRes, eligRes]: any[]) => {
        this.team = (teamRes?.data || []);
        this.projects = (projRes?.data || []).filter((p: any) =>
          !['cancelled','closed'].includes(p.status) && p.is_test !== 1 && p.is_test !== true
        );
        this.filteredUtilTeam = [...this.team];
        this.eligibilityMap.clear();
        (eligRes?.data || []).forEach((e: any) => {
          this.eligibilityMap.set(`${e.person_id}:${e.project_id}`, e.capability);
        });
        this.loading = false;
        this.cdr.markForCheck();
        this.loadSummary();
        this.loadCapacityData(mgr);
      }).catch((err) => {
        console.error('loadData error:', err);
        this.loading = false;
        this.cdr.markForCheck();
      });
    }
  }

  loadSummary() {
    const mgr = this.selectedManager || undefined;
    this.api.getAllocationSummary(mgr).pipe(takeUntil(this.destroy$)).subscribe({
      next: (res: any) => {
        this.summaryData = res.data || [];
        this.cdr.detectChanges();
      },
      error: () => {
        this.summaryData = [];
        this.cdr.detectChanges();
      }
    });
  }

  onManagerChange() {
    this.expandedPeople.clear();
    this.focusProjectId = null;
    this.matrixFilterSelected = { bu: [], project: [] };
    this.planPreview = null;
    this.managerAllotment = [];
    this.capacityQuarters = [];
    this.loadData();
  }

  // Manager allotment — per project per quarter from sizing data
  managerAllotment: { project_id: number; project_name: string; quarters: Record<string, number> }[] = [];

  loadManagerAllotment() {
    if (!this.selectedManager) { this.managerAllotment = []; return; }
    this.api.getManagerAllotment(this.selectedManager).subscribe({
      next: (res: any) => {
        this.managerAllotment = res.data?.projects || [];
        // Filter eligibility matrix projects to only manager's allotted projects
        if (this.managerAllotment.length > 0) {
          const mgrProjectIds = new Set(this.managerAllotment.map(p => p.project_id));
          // Under-review projects are shown to every manager, so they are never filtered out here.
          this.projects = this.projects.filter(p => p.status === 'under review' || mgrProjectIds.has(p.project_id));
        }
        this.cdr.detectChanges();
      },
      error: () => {}
    });
  }

  getAllotmentForProject(projectId: number): Record<string, number> {
    return this.managerAllotment.find(p => p.project_id === projectId)?.quarters || {};
  }

  getAllotmentTotal(projectId: number): number {
    const q = this.getAllotmentForProject(projectId);
    const vals = Object.values(q);
    return vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10 : 0;
  }

  setTab(tab: 'matrix' | 'summary' | 'util' | 'steady' | 'compute') {
    this.activeTab = tab;
    if (tab === 'summary') this.loadSummary();
    if (tab === 'util') this.applyUtilFilter();
    if (tab === 'steady') {
      if (this.steadyStateTasks.length === 0) this.loadSteadyStateTasks();
      if (this.orgBaseline === 0) this.loadOrgBaseline();
      this.loadSteadyStateEffort();
      this.loadSsEligibility();
      // Ensure allotment data is loaded for auto-distribution calculation
      if (this.selectedManager && this.managerAllotment.length === 0) {
        this.loadManagerAllotment();
      }
    }
  }

  // ── Assignment output download (range picker) ──────────────────────────────
  showExport = false;
  exportBusy = false;
  exportFormat: 'monthly' | 'weekly' = 'monthly';
  exportFromFy = 0; exportFromQ = 1;
  exportToFy = 0;   exportToQ = 4;
  exportAllData = false;   // true only while the "All data" preset is active; editing any dropdown switches it off

  /** Fiscal years offered in the pickers: 3 back → 7 ahead of today (covers uploaded plan data through FY30+). */
  get exportFyOptions(): number[] {
    const cur = new Date().getFullYear();
    return Array.from({ length: 11 }, (_, i) => cur - 3 + i);
  }

  private keyToParts(k: number) { return { fy: Math.floor((k - 1) / 4), q: ((k - 1) % 4) + 1 }; }
  private partsToLabel(fy: number, q: number) { return `Q${q} FY${String(fy).slice(-2)}`; }

  toggleExport() {
    this.showExport = !this.showExport;
    if (this.showExport && !this.exportFromFy) this.applyExportPreset('around');
    this.cdr.markForCheck();
  }

  applyExportPreset(kind: 'fy' | 'next4' | 'around' | 'all') {
    const now = new Date();
    const curFy = now.getFullYear();
    const curQ = Math.ceil((now.getMonth() + 1) / 3);
    const curKey = curFy * 4 + curQ;
    this.exportAllData = kind === 'all';
    let from = curKey, to = curKey;
    if (kind === 'fy')      { from = curFy * 4 + 1; to = curFy * 4 + 4; }
    if (kind === 'next4')   { from = curKey; to = curKey + 3; }
    if (kind === 'around')  { from = curKey - 4; to = curKey + 8; }
    if (kind === 'all')     { from = curKey - 4; to = curKey + 20; }   // shown in the pickers; backend uses full data range
    const f = this.keyToParts(from), t = this.keyToParts(to);
    this.exportFromFy = f.fy; this.exportFromQ = f.q;
    this.exportToFy = t.fy;   this.exportToQ = t.q;
    this.cdr.markForCheck();
  }

  get exportRangeSummary(): string {
    let a = this.exportFromFy * 4 + this.exportFromQ, b = this.exportToFy * 4 + this.exportToQ;
    if (b < a) [a, b] = [b, a];
    const n = b - a + 1;
    const cols = this.exportFormat === 'monthly' ? n * 3 : n * 13;
    const f = this.keyToParts(a), t = this.keyToParts(b);
    if (this.exportAllData) return 'Every quarter that has data · ' + (this.exportFormat === 'monthly' ? 'monthly' : 'weekly') + ' columns';
    return `${this.partsToLabel(f.fy, f.q)} → ${this.partsToLabel(t.fy, t.q)} · ${n} quarter${n === 1 ? '' : 's'} · ${cols} ${this.exportFormat === 'monthly' ? 'month' : 'week'} columns${n > 64 ? ' (capped at 64 quarters)' : ''}`;
  }

  downloadAssignment() {
    let a = this.exportFromFy * 4 + this.exportFromQ, b = this.exportToFy * 4 + this.exportToQ;
    if (b < a) [a, b] = [b, a];
    const f = this.keyToParts(a), t = this.keyToParts(b);
    const from = this.exportAllData ? undefined : this.partsToLabel(f.fy, f.q);
    const to = this.exportAllData ? undefined : this.partsToLabel(t.fy, t.q);
    this.exportAssignment(this.exportFormat, from, to);
  }

  exportAssignment(format: 'monthly' | 'weekly', from?: string, to?: string) {
    const mgr = this.selectedManager || undefined;
    this.exportBusy = true;
    this.cdr.markForCheck();
    this.api.exportAllocation(mgr, format, from, to).subscribe({
      next: (blob: Blob) => {
        const safe = (s: string) => s.replace(/[^A-Za-z0-9_-]+/g, '_');
        const range = from && to ? `_${from.replace(' ', '')}-${to.replace(' ', '')}` : '_AllData';
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Assignment_${format}_${safe(mgr || 'AllTeams')}${range}.xlsx`;
        a.click();
        URL.revokeObjectURL(url);
        this.exportBusy = false;
        this.showExport = false;
        this.snackBar.open('Assignment output downloaded', 'Close', { duration: 2500, horizontalPosition: 'end', verticalPosition: 'top' });
        this.cdr.markForCheck();
      },
      error: () => {
        this.exportBusy = false;
        this.snackBar.open('Export failed — no data for that team/range, or the backend needs a restart', 'Close', { duration: 4500, horizontalPosition: 'end', verticalPosition: 'top' });
        this.cdr.markForCheck();
      }
    });
  }

  /** "Chamarty, PhaniMadhav (Phani)" → "Phani" · "Arya, Rahul" → "Rahul" */
  shortName(n: string): string {
    const nick = n.match(/\(([^)]+)\)/);
    if (nick) return nick[1];
    const parts = n.split(',');
    return (parts[1] || parts[0]).trim().split(' ')[0];
  }

  runCompute() {
    this.computeLoading = true;
    this.computeResult = null;
    this.api.computeAllocation(this.selectedManager || undefined).subscribe({
      next: (res: any) => {
        this.computeResult = res.data;
        // Build project color map from gap_summary order
        this._projColorMap = {};
        (res.data.gap_summary || []).forEach((p: any, i: number) => {
          this._projColorMap[p.project_id] = this._projectColors[i % this._projectColors.length];
        });
        this.computeLoading = false;
        this.cdr.detectChanges();
      },
      error: (err: any) => {
        console.error('compute error', err);
        this.computeLoading = false;
        this.cdr.detectChanges();
      }
    });
  }

  getProjectColor(projectId: number): string {
    return this._projColorMap[projectId] || '#888';
  }

  hasAnyAssignment(person: any): boolean {
    return Object.keys(person.assignments || {}).length > 0;
  }

  // ── STEADY STATE PROJECTS ─────────────────────────────────────────────────

  // Generate quarters dynamically: 2 quarters back → 5 years forward
  get ssQuarters(): string[] {
    const now = new Date();
    const curCalMonth = now.getMonth() + 1; // 1-12
    const curCalYear = now.getFullYear();
    // AMD fiscal quarter: month 2-4=Q1, 5-7=Q2, 8-10=Q3, 11-1=Q4
    // FY = calYear if month >= 2, else calYear - 1
    const calToFiscal = (calYear: number, calMonth: number): { fy: number; q: number } => {
      const fy = calMonth >= 2 ? calYear : calYear - 1;
      const q = calMonth >= 2 && calMonth <= 4 ? 1
              : calMonth >= 5 && calMonth <= 7 ? 2
              : calMonth >= 8 && calMonth <= 10 ? 3 : 4;
      return { fy, q };
    };
    const startFiscal = calToFiscal(curCalYear, curCalMonth);
    // Go 2 quarters back from current
    let { fy, q } = startFiscal;
    for (let i = 0; i < 2; i++) { q--; if (q < 1) { q = 4; fy--; } }
    const quarters: string[] = [];
    for (let i = 0; i < 28; i++) { // 28 quarters = 7 years
      quarters.push(`Q${q} FY${String(fy).slice(-2)}`);
      q++; if (q > 4) { q = 1; fy++; }
    }
    return quarters;
  }
  ssProjects = ['Arcadia v4.0','Camelot-Arthur','Camelot-Lancelot','Capitola C90 v1.0 r1','ECARX SW Tools CCB','Eris v2.0','KRK1 New Features v1.0'];
  ssDirty = false;
  ssShowPicker = false;
  ssPickerTask: any = null;
  ssPickerSearch = '';
  ssShowAttrPanel = false;
  ssAttrTask: any = null;
  ssNewAttr = { taskName: '', project: '', hc: 0, startQ: 'Q1 FY27', endQ: '', notes: '' };
  ssOverBudget = false;
  ssBudgetMsg = '';
  ssUsedPct = 0;
  ssNewPct = 0;

  steadyStateTasks: { task_id: number; name: string; task_code: string; color: string; totalHc: number; attributable: boolean;
    assignedPeople: any[];
    attributions: { project: string; hc: number; startQ: string; endQ: string }[];
    saving?: boolean; }[] = [];
  ssTasksLoading = false;

  loadSteadyStateTasks() {
    this.ssTasksLoading = true;
    this.api.getSteadyStateTasks().pipe(takeUntil(this.destroy$)).subscribe({
      next: (res: any) => {
        this.steadyStateTasks = (res.data || []).map((t: any) => ({
          task_id: t.task_id,
          name: t.task_name,
          task_code: t.task_code || '',
          color: t.color || '#607d8b',
          totalHc: Number(t.total_hc) || 0,
          attributable: !!t.is_attributable,
          assignedPeople: [],
          attributions: [],
          saving: false
        }));
        this.ssTasksLoading = false;
        this.ssReady.tasks = true;
        this.tryReconcileSs();
        this.cdr.detectChanges();
      },
      error: () => {
        this.ssTasksLoading = false;
        this.steadyStateTasks = [];
        this.snackBar.open('Could not load steady state tasks — check backend connection', 'Close', { duration: 4000, horizontalPosition: 'end', verticalPosition: 'top' });
        this.cdr.detectChanges();
      }
    });
  }

  saveTaskHc(task: any) {
    task.saving = true;
    this.api.updateSteadyStateTask(task.task_id, { total_hc: task.totalHc }).subscribe({
      next: () => {
        task.saving = false;
        this.snackBar.open('HC updated', 'Close', { duration: 2000, horizontalPosition: 'end', verticalPosition: 'top' });
        this.cdr.detectChanges();
      },
      error: () => {
        task.saving = false;
        this.snackBar.open('Failed to save HC', 'Close', { duration: 3000, horizontalPosition: 'end', verticalPosition: 'top', panelClass: ['snack-error'] });
        this.cdr.detectChanges();
      }
    });
  }

  orgBaseline = 0;
  get totalSteadyHc(): number { return Math.round(this.steadyStateTasks.reduce((s, t) => s + (t.totalHc || 0), 0) * 10) / 10; }
  get totalAttributed(): number { return Math.round(this.steadyStateTasks.reduce((s, t) => s + this.ssGetAttributed(t), 0) * 10) / 10; }
  get totalStandalone(): number { return Math.round(this.steadyStateTasks.reduce((s, t) => s + this.ssGetStandalone(t), 0) * 10) / 10; }

  loadOrgBaseline() {
    this.api.getOrgHeadcount('Weyman, Jeff').pipe(takeUntil(this.destroy$)).subscribe({
      next: (res: any) => {
        this.orgBaseline = res?.data?.total > 0 ? res.data.total : 240;
        this.cdr.detectChanges();
      },
      error: () => { this.orgBaseline = 240; this.cdr.detectChanges(); }
    });
  }

  ssGetAttributed(task: any): number { return task.attributions.reduce((s: number, a: any) => s + a.hc, 0); }
  ssGetStandalone(task: any): number { return Math.max(0, task.totalHc - this.ssGetAttributed(task)); }

  ssIsAttrActive(attr: { startQ: string; endQ: string }, q: string): boolean {
    const parse = (s: string) => { const m = s.match(/Q(\d) FY(\d{2})/); return m ? parseInt(m[2]) * 4 + parseInt(m[1]) : 0; };
    const qn = parse(q); const end = attr.endQ ? parse(attr.endQ) : 9999;
    return qn >= parse(attr.startQ) && qn <= end;
  }

  ssGetBarSegs(task: any, q: string): { label: string; hc: number; pct: number; color: string; standalone: boolean }[] {
    const projColors: Record<string,string> = { 'Arcadia v4.0':'#1565c0','Camelot-Arthur':'#2e7d32','Capitola C90 v1.0 r1':'#c62828','ECARX SW Tools CCB':'#e65100','Eris v2.0':'#558b2f','KRK1 New Features v1.0':'#6a1b9a' };
    const segs: any[] = [];
    let used = 0;
    for (const a of task.attributions) {
      if (this.ssIsAttrActive(a, q)) {
        segs.push({ label: a.project, hc: a.hc, pct: (a.hc / task.totalHc) * 100, color: projColors[a.project] || '#888', standalone: false });
        used += a.hc;
      }
    }
    const rem = task.totalHc - used;
    if (rem > 0) segs.push({ label: 'Standalone', hc: rem, pct: (rem / task.totalHc) * 100, color: '#e0e0e0', standalone: true });
    return segs;
  }

  // People picker
  get ssFilteredPeople(): any[] {
    const s = this.ssPickerSearch.toLowerCase();
    return this.team.filter((p: any) =>
      !s || p.display_name?.toLowerCase().includes(s) ||
      p.designation?.toLowerCase().includes(s) ||
      p.location?.toLowerCase().includes(s)
    );
  }

  // ── Person detail panel ──────────────────────────────────────────────────────
  showPersonPanel = false;
  personPanelData: any = null;
  personPanelProjects: any[] = [];
  personPanelSsEffort: { task_name: string; effort: number }[] = [];
  personHistory: any[] = [];
  historyQuarters: string[] = [];
  historyRows: { task_code: string; task_name: string; data: Record<string, number> }[] = [];

  clamp(val: number, min: number, max: number): number { return Math.min(Math.max(val, min), max); }

  // SS eligibility map: "personId_taskId" → true
  ssEligibilityMap = new Map<string, boolean>();

  loadSsEligibility() {
    this.api.getSsEligibility().subscribe({
      next: (res: any) => {
        this.ssEligibilityMap.clear();
        (res.data || []).forEach((r: any) => this.ssEligibilityMap.set(`${r.person_id}_${r.task_id}`, true));
        this.ssReady.elig = true;
        this.tryReconcileSs();
        this.cdr.detectChanges();
      },
      error: () => {}
    });
  }

  isPersonSsEligible(personId: number, taskId: number): boolean {
    return this.ssEligibilityMap.get(`${personId}_${taskId}`) === true;
  }

  togglePersonSsEligibility(personId: number, taskId: number) {
    const key = `${personId}_${taskId}`;
    if (this.ssEligibilityMap.has(key)) { this.ssEligibilityMap.delete(key); this.ssAddedKeys.delete(key); }
    else { this.ssEligibilityMap.set(key, true); this.ssAddedKeys.add(key); }

    // Save immediately
    const taskIds = this.steadyStateTasks
      .filter(t => this.ssEligibilityMap.get(`${personId}_${t.task_id}`))
      .map(t => t.task_id);
    this.api.saveSsEligibilityBulk(personId, taskIds, this.auth.user()?.email).subscribe({ error: () => {} });
    this.cdr.detectChanges();
  }

  openPersonPanel(person: any) {
    this.personPanelData = person;
    this.showPersonPanel = true;

    // Eligible projects from eligibility map
    this.personPanelProjects = this.projects
      .filter(p => this.getElig(person.person_id, p.project_id) !== '')
      .map(p => ({ project_id: p.project_id, project_name: p.project_name }));

    // Steady state effort for this person
    this.personPanelSsEffort = [];
    for (const task of this.steadyStateTasks) {
      const effort = this.getSsmEffort(person.person_id, task.task_id);
      if (effort > 0) {
        this.personPanelSsEffort.push({ task_name: task.name, effort });
      }
    }
    // Load historical allocation from retro data
    this.personHistory = [];
    this.historyQuarters = [];
    this.historyRows = [];
    const nowYear = new Date().getFullYear();
    this.api.getHistoryPersonSummary(person.display_name, nowYear - 2, nowYear + 1).subscribe({
      next: (res: any) => {
        const rows: any[] = res.data || [];
        this.personHistory = rows;
        const parseQ = (s: string) => { const m = s.match(/Q(\d) FY(\d{2})/); return m ? parseInt(m[2]) * 4 + parseInt(m[1]) : 0; };
        const qSet = new Set<string>(rows.map((r: any) => r.quarter_label));
        this.historyQuarters = [...qSet].sort((a, b) => parseQ(a) - parseQ(b)).slice(-8);
        const taskMap = new Map<string, { task_code: string; task_name: string; data: Record<string, number> }>();
        rows.forEach((r: any) => {
          if (!taskMap.has(r.task_code)) taskMap.set(r.task_code, { task_code: r.task_code, task_name: r.task_name, data: {} });
          taskMap.get(r.task_code)!.data[r.quarter_label] = Number(r.effort_hc);
        });
        this.historyRows = [...taskMap.values()].sort((a: any, b: any) => a.task_name.localeCompare(b.task_name));
        this.cdr.detectChanges();
      },
      error: () => {}
    });
    this.cdr.detectChanges();
  }

  // ── Steady State Effort Matrix (people × tasks) ─────────────────────────────
  // Map: "personId_taskId" → effort_hc
  ssmEffortMap = new Map<string, number>();

  get ssmFilteredPeople(): any[] {
    // Show all team members
    return this.team;
  }

  getSsmEffort(personId: number, taskId: number): number {
    return this.ssmEffortMap.get(`${personId}_${taskId}`) || 0;
  }

  setSsmEffort(personId: number, taskId: number, event: Event) {
    const val = parseFloat((event.target as HTMLInputElement).value);
    const key = `${personId}_${taskId}`;
    if (isNaN(val) || val <= 0) this.ssmEffortMap.delete(key);
    else this.ssmEffortMap.set(key, Math.min(1, Math.round(val * 100) / 100));
    this.ssDirty = true;
    this.cdr.detectChanges();
  }

  /** Project work for a person in the CURRENT quarter, straight from the retro/plan data the cards show
   *  (non-steady-state rows, plus any steady-state row that isn't a configured SS task). */
  getSsProjectEffort(personId: number): number {
    const load = this.personCurrentLoad.get(Number(personId));
    if (!load) return 0;
    const matched = this.matchedRetroSs(load.ssItems).reduce((s, x) => s + x.hc, 0);
    const unmatched = Math.max(0, load.ssHc - matched);
    return Math.round((load.projectHc + unmatched) * 100) / 100;
  }

  private normTaskName(s: string): string { return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }

  /** Retro steady-state rows that correspond to a configured SS task (matched by name). */
  private matchedRetroSs(items: { name: string; hc: number }[]): { task_id: number; hc: number }[] {
    const out: { task_id: number; hc: number }[] = [];
    for (const it of items) {
      const t = this.steadyStateTasks.find(x => this.normTaskName(x.name) === this.normTaskName(it.name));
      if (t) out.push({ task_id: t.task_id, hc: it.hc });
    }
    return out;
  }

  // Get SS tasks assigned to a person with their values
  /** Steady-state tasks to list for a person: the ones that actually carry HC in any quarter shown (bars) or now,
   *  plus any task added for them via Configure SS during this session. Names only; HC is calculated in the backend. */
  ssTasksInUse(personId: number): { name: string; color: string }[] {
    const norm = (n: string) => String(n || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const color = (n: string) => this.steadyStateTasks.find(t => norm(t.name) === norm(n))?.color || '#607d8b';
    const names = new Map<string, string>();
    const add = (n: string) => { if (n && !names.has(norm(n))) names.set(norm(n), n); };
    for (const q of this.breakdownQuarters) (this.planBreakdown[personId]?.[q]?.ss || []).forEach((x: any) => add(x.name));
    Object.values(this.personRetroBreakdown.get(personId) || {}).forEach(rows => rows.filter(r => r.is_ss && r.hc > 0).forEach(r => add(r.name)));
    for (const t of this.steadyStateTasks) {
      if (this.getSsmEffort(personId, t.task_id) > 0 || this.ssAddedKeys.has(`${personId}_${t.task_id}`)) add(t.name);
    }
    return [...names.values()].sort((a, b) => a.localeCompare(b)).map(name => ({ name, color: color(name) }));
  }
  private ssAddedKeys = new Set<string>();

  getPersonSsTasks(personId: number): { task_id: number; task_name: string; color: string; auto_hc: number }[] {
    const result: { task_id: number; task_name: string; color: string; auto_hc: number }[] = [];
    for (const task of this.steadyStateTasks) {
      const effort = this.getSsmEffort(personId, task.task_id);
      if (effort > 0 || this.isPersonSsEligible(personId, task.task_id)) {
        result.push({ task_id: task.task_id, task_name: task.name, color: task.color, auto_hc: effort });
      }
    }
    // Tasks with HC first, then the rest alphabetically — Management etc. stay on top
    return result.sort((a, b) => (b.auto_hc > 0 ? 1 : 0) - (a.auto_hc > 0 ? 1 : 0) || a.task_name.localeCompare(b.task_name));
  }

  // ── SS auto-distribution (availability based) ──────────────────────────────
  private ssReady = { cap: false, tasks: false, eff: false, elig: false };
  private ssReconciled = false;
  private ssManualPeople = new Set<number>();
  private ssBaseline = new Map<string, number>();

  private tryReconcileSs() {
    if (this.ssReconciled || !this.selectedManager) return;
    const r = this.ssReady;
    if (r.cap && r.tasks && r.eff && r.elig) {
      this.ssReconciled = true;
      const force = this.forceSsNext;
      this.forceSsNext = false;
      this.runSsDistribution(force);
    }
  }

  /** Desired SS split for one person, current quarter:
   *   1. steady-state work already in the retro data (e.g. Management 0.2) is kept as-is,
   *   2. availability = 1.0 − project HC − that retro SS HC (never negative),
   *   3. availability is shared equally (cent-exact) across the person's SS-eligible tasks not already in the retro data,
   *   4. no availability → every other SS task is 0. */
  private desiredSsForPerson(personId: number): Map<number, number> {
    const load = this.personCurrentLoad.get(Number(personId)) || { projectHc: 0, ssHc: 0, ssItems: [] };
    const desired = new Map<number, number>();
    let retroSsTotal = 0;
    for (const m of this.matchedRetroSs(load.ssItems)) {
      desired.set(m.task_id, Math.round(((desired.get(m.task_id) || 0) + m.hc) * 100) / 100);
    }
    retroSsTotal = load.ssHc;
    const remainingCents = Math.max(0, Math.round((1 - load.projectHc - retroSsTotal) * 100));
    const open = this.steadyStateTasks.filter(t => !desired.has(t.task_id) && this.isPersonSsEligible(personId, t.task_id));
    if (open.length && remainingCents > 0) {
      const base = Math.floor(remainingCents / open.length);
      let extra = remainingCents - base * open.length;
      for (const t of open) {
        desired.set(t.task_id, (base + (extra > 0 ? 1 : 0)) / 100);
        if (extra > 0) extra--;
      }
    }
    return desired;
  }

  /** force=true (explicit matrix save) also recalculates people whose SS was set by hand. */
  private runSsDistribution(force: boolean) {
    const changedPeople: { person_id: number; items: { task_id: number; effort_hc: number }[] }[] = [];
    for (const person of this.team) {
      const pid = Number(person.person_id);
      if (!force && this.ssManualPeople.has(pid)) continue;
      const desired = this.desiredSsForPerson(pid);
      let differs = false;
      for (const t of this.steadyStateTasks) {
        const cur = this.ssmEffortMap.get(`${pid}_${t.task_id}`) || 0;
        const want = desired.get(t.task_id) || 0;
        if (Math.abs(cur - want) > 0.004) { differs = true; break; }
      }
      if (!differs) continue;
      changedPeople.push({
        person_id: pid,
        items: [...desired.entries()].filter(([, hc]) => hc > 0).map(([task_id, effort_hc]) => ({ task_id, effort_hc }))
      });
    }
    if (!changedPeople.length) { if (force) this.snackBar.open('Steady state already up to date', 'Close', { duration: 2000, horizontalPosition: 'end', verticalPosition: 'top' }); return; }

    // Apply locally right away so the UI is correct before the save round-trip finishes
    for (const cp of changedPeople) {
      for (const t of this.steadyStateTasks) this.ssmEffortMap.delete(`${cp.person_id}_${t.task_id}`);
      for (const it of cp.items) this.ssmEffortMap.set(`${cp.person_id}_${it.task_id}`, it.effort_hc);
      this.ssManualPeople.delete(cp.person_id);
    }
    this.ssBaseline = new Map(this.ssmEffortMap);
    this.cdr.markForCheck();

    // distribute endpoint wipes + re-inserts per person, so send each changed person's full list (an empty list still needs a marker row to wipe)
    const distributions: { person_id: number; task_id: number; effort_hc: number }[] = [];
    for (const cp of changedPeople) {
      if (!cp.items.length && this.steadyStateTasks.length) distributions.push({ person_id: cp.person_id, task_id: this.steadyStateTasks[0].task_id, effort_hc: 0 });
      cp.items.forEach(it => distributions.push({ person_id: cp.person_id, ...it }));
    }
    this.api.distributeSsEffort(distributions, 'auto').subscribe({
      next: () => { if (force) this.snackBar.open('Steady state recalculated from availability', 'Close', { duration: 3000, horizontalPosition: 'end', verticalPosition: 'top' }); },
      error: () => this.snackBar.open('Could not save steady-state update', 'Close', { duration: 3000, horizontalPosition: 'end', verticalPosition: 'top', panelClass: ['snack-error'] })
    });
  }


  getTeamSsTaskCount(): number {
    const activeTasks = new Set<number>();
    const teamPersonIds = new Set(this.ssmFilteredPeople.map(p => p.person_id));
    for (const [key, val] of this.ssmEffortMap.entries()) {
      if (val > 0) {
        const personId = parseInt(key.split("_")[0]);
        if (teamPersonIds.has(personId)) {
          const taskId = parseInt(key.split("_")[1]);
          activeTasks.add(taskId);
        }
      }
    }
    return activeTasks.size;
  }

  getTeamSsEffort(): number {
    let total = 0;
    for (const person of this.ssmFilteredPeople) { total += this.getSsmPersonTotal(person.person_id); }
    return Math.round(total * 100) / 100;
  }

  getTeamSsAvg(): number {
    const assigned = this.ssmFilteredPeople.filter(p => this.getSsmPersonTotal(p.person_id) > 0);
    if (!assigned.length) return 0;
    const total = assigned.reduce((s, p) => s + this.getSsmPersonTotal(p.person_id), 0);
    return Math.round((total / assigned.length) * 100) / 100;
  }

  getTotalSsmEffort(): number {
    let total = 0;
    for (const val of this.ssmEffortMap.values()) total += val;
    return Math.round(total * 100) / 100;
  }

  getOverAllocatedCount(): number {
    return this.ssmFilteredPeople.filter(p => this.getSsmPersonTotal(p.person_id) > 1.0).length;
  }

  getSsmPersonTotal(personId: number): number {
    let total = 0;
    for (const [key, val] of this.ssmEffortMap.entries()) {
      if (key.startsWith(`${personId}_`)) total += val;
    }
    return Math.round(total * 100) / 100;
  }

  getSsTaskAssigned(task: any): number {
    let total = 0;
    for (const [key, val] of this.ssmEffortMap.entries()) {
      if (key.endsWith(`_${task.task_id}`)) total += val;
    }
    return Math.round(total * 100) / 100;
  }

  // Steady state quarterly effort map: "personId_quarter" → hc
  ssEffortMap = new Map<string, number>();
  ssEffortQuarters: string[] = [];

  ssOpenPicker(task: any) {
    this.ssPickerTask = task;
    this.ssPickerSearch = '';
    this.ssShowPicker = true;
    this.ssShowAttrPanel = false;
    // Generate quarters: 2 back, 6 forward from current
    this.ssEffortQuarters = this.qs.generateRange(this.qs.currentQuarterLabel, 2, 6);
    // Load existing effort from task's assignedPeople effortMap if any
    this.ssEffortMap = new Map(task._effortMap || []);
  }

  getSsEffort(personId: number, q: string): number | string {
    const v = this.ssEffortMap.get(`${personId}_${q}`);
    return v !== undefined ? v : '';
  }

  setSsEffort(personId: number, q: string, event: Event) {
    const val = parseFloat((event.target as HTMLInputElement).value);
    const key = `${personId}_${q}`;
    if (isNaN(val) || val <= 0) this.ssEffortMap.delete(key);
    else this.ssEffortMap.set(key, Math.min(1, val));
    this.cdr.detectChanges();
  }

  getSsPersonTotal(personId: number): number {
    let total = 0; let count = 0;
    for (const [key, val] of this.ssEffortMap.entries()) {
      if (key.startsWith(`${personId}_`)) { total += val; count++; }
    }
    return count ? Math.round((total / count) * 100) / 100 : 0;
  }

  getSsTaskTotalEffort(): number {
    if (!this.ssPickerTask?.assignedPeople?.length) return 0;
    return Math.round(
      this.ssPickerTask.assignedPeople.reduce((s: number, p: any) => s + this.getSsPersonTotal(p.person_id), 0) * 100
    ) / 100;
  }

  saveSsEffort() {
    if (this.ssPickerTask) {
      // Persist effort map on task object so it survives panel close
      this.ssPickerTask._effortMap = [...this.ssEffortMap.entries()];
      this.ssDirty = true;
    }
    this.ssShowPicker = false;
    this.snackBar.open('Effort saved — push to DB when ready', 'Close', { duration: 3000, horizontalPosition: 'end', verticalPosition: 'top' });
    this.cdr.detectChanges();
  }
  ssIsAssigned(p: any): boolean { return this.ssPickerTask?.assignedPeople?.some((a: any) => a.person_id === p.person_id) ?? false; }
  ssToggleAssign(p: any) {
    if (!this.ssPickerTask) return;
    const idx = this.ssPickerTask.assignedPeople.findIndex((a: any) => a.person_id === p.person_id);
    if (idx >= 0) this.ssPickerTask.assignedPeople.splice(idx, 1);
    else this.ssPickerTask.assignedPeople.push(p);
  }

  // Attribution panel
  ssOpenAttrPanel(task: any) {
    this.ssAttrTask = task;
    this.ssNewAttr = { taskName: task?.name || '', project: '', hc: 0, startQ: 'Q1 FY27', endQ: '', notes: '' };
    this.ssOverBudget = false; this.ssBudgetMsg = '';
    this.ssShowAttrPanel = true; this.ssShowPicker = false;
  }

  ssCheckBudget() {
    const task = this.steadyStateTasks.find(t => t.name === this.ssNewAttr.taskName);
    if (!task || !this.ssNewAttr.hc) { this.ssBudgetMsg = ''; return; }
    const used = this.ssGetAttributed(task);
    const afterAdd = used + Number(this.ssNewAttr.hc);
    this.ssOverBudget = afterAdd > task.totalHc;
    this.ssUsedPct = Math.min((used / task.totalHc) * 100, 100);
    this.ssNewPct = Math.min((Number(this.ssNewAttr.hc) / task.totalHc) * 100, 100);
    const rem = task.totalHc - afterAdd;
    this.ssBudgetMsg = this.ssOverBudget
      ? `Over budget by ${(afterAdd - task.totalHc).toFixed(1)} HC`
      : `Within budget — ${rem.toFixed(1)} HC remaining after this`;
  }

  ssSaveAttr() {
    const task = this.steadyStateTasks.find(t => t.name === this.ssNewAttr.taskName);
    if (!task || !this.ssNewAttr.project || !this.ssNewAttr.hc || this.ssOverBudget) return;
    task.attributions.push({ project: this.ssNewAttr.project, hc: Number(this.ssNewAttr.hc), startQ: this.ssNewAttr.startQ, endQ: this.ssNewAttr.endQ || 'Q4 FY28' });
    this.ssShowAttrPanel = false; this.ssDirty = true;
    this.snackBar.open('Attribution added — click Save Changes to persist', 'Close', { duration: 3000, horizontalPosition: 'end', verticalPosition: 'top' });
  }

  ssRemoveAttr(task: any, attr: any) {
    task.attributions = task.attributions.filter((a: any) => a !== attr);
    this.ssDirty = true;
  }

  ssSave() {
    // Only send what the user actually changed since the last load (incl. values cleared to 0)
    const records: any[] = [];
    const keys = new Set<string>([...this.ssmEffortMap.keys(), ...this.ssBaseline.keys()]);
    keys.forEach(key => {
      const now = this.ssmEffortMap.get(key) || 0;
      const before = this.ssBaseline.get(key) || 0;
      if (Math.abs(now - before) < 0.004) return;
      const parts = key.split('_');
      records.push({ task_id: parseInt(parts[1]), person_id: parseInt(parts[0]), effort_hc: now });
    });
    if (!records.length) { this.ssDirty = false; this.cdr.markForCheck(); return; }
    // Tag as manual so availability-based auto-distribution won't overwrite these people on the next load
    this.api.saveSteadyStateEffortBulk(records, `manual:${this.auth.user()?.email || ''}`).subscribe({
      next: (res: any) => {
        records.forEach(r => this.ssManualPeople.add(r.person_id));
        this.ssBaseline = new Map(this.ssmEffortMap);
        this.ssDirty = false;
        this.snackBar.open('Steady state effort saved', 'Close', { duration: 3000, horizontalPosition: 'end', verticalPosition: 'top' });
        this.cdr.detectChanges();
      },
      error: (err: any) => {
        // Data may still have saved — verify in DB before assuming failure
        console.warn('Save response error (data may still be saved):', err?.status, err?.message);
        this.ssDirty = false;
        this.snackBar.open('Saved — verify in DB if unsure', 'Close', { duration: 3000, horizontalPosition: 'end', verticalPosition: 'top' });
        this.cdr.detectChanges();
      }
    });
  }

  ssDiscard() {
    this.ssDirty = false;
    this.loadSteadyStateEffort();
    this.snackBar.open('Changes discarded', 'Close', { duration: 2000, horizontalPosition: 'end', verticalPosition: 'top' });
  }

  loadSteadyStateEffort() {
    this.api.getSteadyStateEffort().subscribe({
      next: (res: any) => {
        this.ssmEffortMap.clear();
        this.ssManualPeople = new Set();
        (res.data || []).forEach((r: any) => {
          this.ssmEffortMap.set(`${r.person_id}_${r.task_id}`, Number(r.effort_hc));
          // Rows saved by hand through "Save SS" are tagged "manual:<email>" — auto-distribution leaves those people alone
          if (String(r.assigned_by || '').startsWith('manual:')) this.ssManualPeople.add(Number(r.person_id));
        });
        this.ssBaseline = new Map(this.ssmEffortMap);
        this.ssReady.eff = true;
        this.tryReconcileSs();
        this.cdr.detectChanges();
      },
      error: () => {}
    });
  }

  // ── MATRIX ──
  getElig(personId: number, projectId: number): string {
    return this.eligibilityMap.get(`${personId}:${projectId}`) || '';
  }

  onEligChange(event: Event, personId: number, projectId: number) {
    const val = (event.target as HTMLSelectElement).value;
    const key = `${personId}:${projectId}`;
    if (val) this.eligibilityMap.set(key, val);
    else this.eligibilityMap.delete(key);
    this.schedulePlanPreview(val ? { personId, projectId } : undefined);
  }

  // ── ASSIGNMENT PLAN PREVIEW ──
  // Unsaved ticks live only in the browser. Every change asks the backend engine for a dry run (nothing is
  // written); Save Matrix then stores the ticks and writes the same plan to the database.
  planPreview: any = null;
  planSummary: any = {};
  planBreakdown: Record<string, Record<string, any>> = {};
  attnItems: { project_id: number; name: string; kind: 'hire' | 'open'; msg: string }[] = [];
  focusProjectId: number | null = null;
  readonly bdHeight = 150;
  planLoading = false;
  planBackendOld = false;
  planDirty = false;
  private planTimer: any = null;
  private planSeq = 0;
  private planCellMap = new Map<string, { max: number; tip: string }>();
  private planHireByProject = new Map<number, number>();
  private savedEligSnap = '';
  private forceSsNext = false;

  private eligSnapshot(): string {
    return [...this.eligibilityMap.entries()].filter(([, v]) => !!v).map(([k, v]) => `${k}=${v}`).sort().join('|');
  }

  planCell(personId: number, projectId: number): { max: number; tip: string } | null {
    return this.planCellMap.get(`${personId}:${projectId}`) || null;
  }

  /** Debounced dry run. `tick` = the cell just ticked Yes (so we can warn when it leaves demand nobody can absorb). */
  schedulePlanPreview(tick?: { personId: number; projectId: number }) {
    if (!this.selectedManager) return;
    this.planDirty = this.eligSnapshot() !== this.savedEligSnap;
    if (this.planTimer) clearTimeout(this.planTimer);
    this.planTimer = setTimeout(() => this.refreshPlanPreview(tick), 250);
  }

  refreshPlanPreview(tick?: { personId: number; projectId: number }) {
    if (!this.selectedManager) return;
    const seq = ++this.planSeq;
    this.planLoading = true;
    const pending: { person_id: number; project_id: number; capability: string }[] = [];
    this.team.forEach(person => this.projects.forEach(proj => {
      pending.push({ person_id: person.person_id, project_id: proj.project_id, capability: this.eligibilityMap.get(`${person.person_id}:${proj.project_id}`) || '' });
    }));
    this.api.previewAssignmentPlan(this.selectedManager, pending).pipe(takeUntil(this.destroy$)).subscribe({
      next: (res: any) => {
        if (seq !== this.planSeq) return;   // a newer request is in flight
        this.applyPlan(res?.data || null, tick);
        this.planLoading = false;
        this.cdr.markForCheck();
      },
      error: () => { if (seq === this.planSeq) { this.planLoading = false; this.cdr.markForCheck(); } }
    });
  }

  private applyPlan(plan: any, tick?: { personId: number; projectId: number }) {
    this.planPreview = plan;
    this.planCellMap = new Map();
    this.attnItems = [];
    if (!plan) { this.planBreakdown = {}; return; }
    this.planSummary = plan.summary || {};
    this.planBreakdown = plan.breakdown || {};
    this.planBackendOld = !plan.breakdown;   // an older backend build answers without the live breakdown
    const provisional = new Set<number>(plan.provisional || []);

    // chips in the matrix cells: HC per quarter the engine puts on this person for this project
    const byCell = new Map<string, { label: string; hc: number }[]>();
    for (const a of plan.assignments || []) {
      const k = `${a.person_id}:${a.project_id}`;
      if (!byCell.has(k)) byCell.set(k, []);
      byCell.get(k)!.push({ label: a.label, hc: a.hc });
    }
    byCell.forEach((list, k) => {
      const max = Math.max(...list.map(x => x.hc));
      const shown = list.slice(0, 6).map(x => `${x.label}: ${x.hc.toFixed(2)}`).join(', ') + (list.length > 6 ? ` … (+${list.length - 6} more quarters)` : '');
      this.planCellMap.set(k, { max, tip: `Planned from steady state — ${shown}` });
    });

    // one line per project that still has demand nobody covers: peak HC to hire, or "no one selected"
    const per = new Map<number, { name: string; hire: Record<string, number>; open: Record<string, number> }>();
    (plan.gaps || []).forEach((g: any) => {
      if (!per.has(g.project_id)) per.set(g.project_id, { name: g.project_name, hire: {}, open: {} });
      const t = g.kind === 'no_capacity' ? per.get(g.project_id)!.hire : per.get(g.project_id)!.open;
      t[g.label] = (t[g.label] || 0) + g.hc;
    });
    const peak = (rec: Record<string, number>) => {
      let best = 0, label = '';
      Object.entries(rec).forEach(([l, v]) => { if (v > best) { best = v; label = l; } });
      return { best, label };
    };
    per.forEach((v, pid) => {
      const h = peak(v.hire), o = peak(v.open);
      const tag = provisional.has(pid) ? ' · under review' : '';
      if (h.best > 0.004) this.attnItems.push({ project_id: pid, name: v.name, kind: 'hire', msg: `Hire ${h.best.toFixed(2)} HC · peak ${h.label}${tag}` });
      else if (o.best > 0.004) this.attnItems.push({ project_id: pid, name: v.name, kind: 'open', msg: `No one selected · up to ${o.best.toFixed(2)} HC (${o.label})${tag}` });
    });
    this.attnItems.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'hire' ? -1 : 1) || a.name.localeCompare(b.name));

    // warn when the tick just made leaves demand nobody can absorb (HC to hire) — the user may keep it (override) or undo
    const hireNow = new Map<number, number>();
    (plan.gaps || []).filter((g: any) => g.kind === 'no_capacity').forEach((g: any) => hireNow.set(g.project_id, (hireNow.get(g.project_id) || 0) + g.hc));
    if (tick) {
      const before = this.planHireByProject.get(tick.projectId) || 0, now = hireNow.get(tick.projectId) || 0;
      if (now > before + 0.0005) {
        const proj = this.projects.find(p => p.project_id === tick.projectId);
        const first = (plan.gaps || []).find((g: any) => g.project_id === tick.projectId && g.kind === 'no_capacity');
        const ref = this.snackBar.open(
          `${proj?.project_name || 'This project'}: ${now.toFixed(2)} HC-quarters of demand can't be absorbed by the people ticked${first ? ` (from ${first.label})` : ''} — that is a hiring gap. Keep the tick to override, or undo.`,
          'Undo', { duration: 9000, horizontalPosition: 'end', verticalPosition: 'top', panelClass: ['snack-warn'] });
        ref.onAction().subscribe(() => {
          this.eligibilityMap.delete(`${tick.personId}:${tick.projectId}`);
          this.schedulePlanPreview();
        });
      }
    }
    this.planHireByProject = hireNow;
  }

  // ── EFFORT BREAKDOWN (stacked 1.0 HC bars) ──
  /** Click a project name in the header (or a line in "Needs attention") to focus it; click again to release. */
  setFocusProject(projectId: number, fromTile = false) {
    this.focusProjectId = (!fromTile && this.focusProjectId === projectId) ? null : projectId;
  }

  get focusProject(): any | null {
    return this.focusProjectId == null ? null : (this.projects.find(p => p.project_id === this.focusProjectId) || null);
  }

  private get focusPlanProject(): any | null {
    return this.focusProjectId == null ? null : ((this.planPreview?.projects || []).find((p: any) => p.project_id === this.focusProjectId) || null);
  }

  /** Quarters shown: the focus project's sized window; without one, the next 8 quarters. */
  get breakdownQuarters(): string[] {
    const fp = this.focusPlanProject;
    if (fp && fp.quarters?.length) return fp.quarters.map((q: any) => q.label);
    // No project focused: every quarter the preview covers, from the current one onward
    const key = (l: string) => { const m = l.match(/Q(\d) FY(\d{2})/); return m ? parseInt(m[2]) * 4 + parseInt(m[1]) : 0; };
    const labels = new Set<string>();
    Object.values(this.planBreakdown).forEach(byQ => Object.keys(byQ).forEach(l => labels.add(l)));
    if (labels.size) return [...labels].sort((x, y) => key(x) - key(y));
    return this.capacityQuarters.filter(l => key(l) >= key(this.currentQuarter));
  }

  get focusNeedText(): string {
    const fp = this.focusPlanProject;
    if (!fp || !fp.quarters?.length) return 'No sized demand for this manager in current or future quarters.';
    const d = fp.quarters.map((q: any) => q.demand);
    const lo = Math.min(...d), hi = Math.max(...d);
    const hc = lo === hi ? lo.toFixed(2) : `${lo.toFixed(2)}–${hi.toFixed(2)}`;
    const first = fp.quarters[0].label, last = fp.quarters[fp.quarters.length - 1].label;
    const prov = (this.planPreview?.provisional || []).includes(fp.project_id) ? ' · under review: planned and saved like a funded project' : '';
    return `needs ${hc} HC per quarter · ${first} → ${last} (${fp.quarters.length} quarters)${prov}`;
  }

  shortProj(name: string): string { return String(name || '').replace(/^Embedded /, ''); }

  // Each project keeps one colour for the whole session (assigned in order of first appearance)
  private breakdownColors = new Map<string, string>();
  private projectColor(name: string): string {
    const palette = ['#5c7cfa', '#12b886', '#d9480f', '#7048e8', '#c2255c', '#2b8a3e', '#1098ad', '#a9722e', '#e67700', '#495057'];
    if (!this.breakdownColors.has(name)) this.breakdownColors.set(name, palette[this.breakdownColors.size % palette.length]);
    return this.breakdownColors.get(name)!;
  }

  /** What one person's 1.0 HC looks like in a quarter. Uses the live preview when there is one, else saved data. */
  stackFor(personId: number, label: string): { projects: any[]; ss: any[]; free: number; over: number; total: number; scale: number } {
    const fpId = this.focusProjectId;
    const bd = this.planBreakdown[personId]?.[label];
    let projects: any[] = [], ss: any[] = [], free = 0, over = 0;
    if (bd) {
      projects = bd.projects.map((x: any) => ({ project_id: x.project_id, name: x.name, hc: x.hc, auto: x.auto || 0 }));
      ss = bd.ss.map((x: any) => ({ name: x.name, hc: x.hc, was: x.was }));
      free = bd.free; over = bd.over;
    } else {
      const rows = this.personRetroBreakdown.get(personId)?.[label] || [];
      projects = rows.filter(r => !r.is_ss && r.hc > 0).map((r, i) => ({ project_id: -1 - i, name: r.name, hc: r.hc, auto: 0 }));
      ss = rows.filter(r => r.is_ss && r.hc > 0).map(r => ({ name: r.name, hc: r.hc }));
      const total = projects.reduce((a, x) => a + x.hc, 0) + ss.reduce((a, x) => a + x.hc, 0);
      free = Math.max(0, 1 - total); over = Math.max(0, total - 1);
    }
    const out = projects.map(x => ({ ...x, focus: fpId != null && x.project_id === fpId, color: this.projectColor(x.name) }));
    out.sort((a, b) => (Number(b.focus) - Number(a.focus)) || (b.hc - a.hc));
    const total = out.reduce((a, x) => a + x.hc, 0) + ss.reduce((a, x) => a + x.hc, 0);
    return { projects: out, ss, free, over, total, scale: Math.max(1, total) };
  }

  /** The one-line verdict above a person's bars: is there room for the focus project, or what they get. */
  roomTag(personId: number): { text: string; tone: 'ok' | 'no' | 'good' } {
    const fpId = this.focusProjectId;
    const name = this.focusProject?.project_name || 'this project';
    if (fpId == null) return { text: '', tone: 'ok' };
    const quarters = this.breakdownQuarters;
    const fmt = (lo: number, hi: number) => (Math.abs(hi - lo) < 0.005 ? hi.toFixed(2) : `${lo.toFixed(2)}–${hi.toFixed(2)}`);
    const ticked = !!this.eligibilityMap.get(`${personId}:${fpId}`);
    const stacks = quarters.map(q => this.stackFor(personId, q));
    if (ticked) {
      const auto = stacks.map(st => st.projects.find(p => p.project_id === fpId)?.auto || 0).filter(v => v > 0.004);
      const have = stacks.map(st => st.projects.find(p => p.project_id === fpId)?.hc || 0);
      if (auto.length) return { text: `Gets +${fmt(Math.min(...auto), Math.max(...auto))} ${name} per quarter, taken from steady state`, tone: 'good' };
      if (Math.max(...have) > 0.004) return { text: `Already carries ${fmt(Math.min(...have), Math.max(...have))} on ${name} — nothing more to assign`, tone: 'good' };
      return { text: 'Ticked, but no room: fully booked on projects in these quarters', tone: 'no' };
    }
    const room = stacks.map(st => st.free + st.ss.reduce((a, x) => a + x.hc, 0));
    const hi = Math.max(...room), lo = Math.min(...room);
    if (hi < 0.005) return { text: 'No room: already fully booked on projects', tone: 'no' };
    return { text: `Room for ${name}: ${fmt(lo, hi)} per quarter (from steady state)`, tone: 'ok' };
  }

  saveMatrix() {
    this.saving = true;
    const records: any[] = [];
    this.team.forEach(person => {
      this.projects.forEach(proj => {
        records.push({
          person_id: person.person_id,
          project_id: proj.project_id,
          capability: this.eligibilityMap.get(`${person.person_id}:${proj.project_id}`) || ''
        });
      });
    });

    this.api.bulkSaveAllocationEligibility(records, this.auth.user()?.email || '').subscribe({
      next: () => {
        this.savedEligSnap = this.eligSnapshot();
        this.planDirty = false;
        if (!this.selectedManager) {
          this.saving = false;
          this.snackBar.open('Matrix saved', 'Close', { duration: 2000, horizontalPosition: 'end', verticalPosition: 'top' });
          this.loadSummary();
          return;
        }
        // Write the engine's plan (same calculation as the preview) and reload so the cards show it
        this.api.saveAssignmentPlan(this.selectedManager).subscribe({
          next: (res: any) => {
            this.saving = false;
            const s = res?.data?.summary;
            this.snackBar.open(
              `Matrix saved — ${s ? s.assigned_hc.toFixed(2) + ' HC-quarters assigned from steady state' : 'plan written'}${s && s.hiring_gap_hc > 0 ? `, ${s.hiring_gap_hc.toFixed(2)} HC-quarters to hire` : ''}`,
              'Close', { duration: 4000, horizontalPosition: 'end', verticalPosition: 'top' });
            this.forceSsNext = true;   // steady-state tasks follow the new availability
            this.loadData();
          },
          error: () => {
            this.saving = false;
            this.snackBar.open('Ticks saved, but the assignment plan could not be written', 'Close', { duration: 4000, panelClass: ['snack-error'], horizontalPosition: 'end', verticalPosition: 'top' });
          }
        });
      },
      error: () => {
        this.saving = false;
        this.snackBar.open('Failed to save', 'Close', { duration: 3000, panelClass: ['snack-error'], horizontalPosition: 'end', verticalPosition: 'top' });
      }
    });
  }

  /** Explicit "recalculate" (matrix saved / button): availability-based, overrides hand-set values. */
  autoDistributeSteadyState() {
    if (!this.selectedManager) return;
    this.runSsDistribution(true);
  }

  // ── SUMMARY ──
  get coveredCount(): number { return this.summaryData.filter(p => p.status === 'covered').length; }
  get fallbackCount(): number { return this.summaryData.filter(p => p.status === 'fallback').length; }
  get gapCount(): number { return this.summaryData.filter(p => p.status === 'gap').length; }
  get provisionalCount(): number { return this.summaryData.filter(p => p.status === 'provisional').length; }

  // Eligibility matrix: `projects` holds every project (used when saving); `matrixProjects` is the filtered view.
  // Buckets are exclusive: under review | pipeline (not yet submitted) | funded (everything else, e.g. active).
  projectStatusFilter: 'all' | 'funded' | 'pipeline' | 'review' = 'all';
  get underReviewProjectCount(): number { return this.projects.filter(p => p.status === 'under review').length; }
  get pipelineProjectCount(): number { return this.projects.filter(p => p.status === 'pipeline').length; }
  get fundedProjectCount(): number { return this.projects.length - this.underReviewProjectCount - this.pipelineProjectCount; }
  /** Projects after the status chips (All / Funded / Pipeline / Under review). */
  private get statusFilteredProjects(): any[] {
    if (this.projectStatusFilter === 'funded') return this.projects.filter(p => p.status !== 'under review' && p.status !== 'pipeline');
    if (this.projectStatusFilter === 'pipeline') return this.projects.filter(p => p.status === 'pipeline');
    if (this.projectStatusFilter === 'review') return this.projects.filter(p => p.status === 'under review');
    return this.projects;
  }
  get matrixProjects(): any[] {
    const sel = this.matrixFilterSelected;
    return this.statusFilteredProjects.filter(p =>
      (!sel['bu'].length || sel['bu'].includes(p.BU)) &&
      (!sel['project'].length || sel['project'].includes(p.project_name)));
  }

  // BU / Project filters for the matrix columns (cascading: the project list narrows to the chosen BUs)
  matrixFilterSelected: FilterState = { bu: [], project: [] };
  readonly matrixFilterDefs: FilterDef[] = [
    { key: 'bu',      label: 'BU',      width: '150px' },
    { key: 'project', label: 'Project', width: '230px' },
  ];
  get matrixFilterOptions(): { [key: string]: string[] } {
    const sel = this.matrixFilterSelected;
    const base = this.statusFilteredProjects;
    const bu = [...new Set(base.map(p => p.BU).filter(Boolean))].sort();
    const afterBu = sel['bu'].length ? base.filter(p => sel['bu'].includes(p.BU)) : base;
    const project = [...new Set(afterBu.map(p => p.project_name))].sort();
    return { bu, project };
  }
  onMatrixFilterChange(state: FilterState) {
    const next: FilterState = { bu: state['bu'] || [], project: state['project'] || [] };
    // drop project picks that the BU choice no longer covers
    const allowed = new Set(this.statusFilteredProjects.filter(p => !next['bu'].length || next['bu'].includes(p.BU)).map(p => p.project_name));
    next['project'] = next['project'].filter(n => allowed.has(n));
    this.matrixFilterSelected = next;
    this.cdr.markForCheck();
  }

  toggleProject(id: number) {
    if (this.expandedProjects.has(id)) this.expandedProjects.delete(id);
    else this.expandedProjects.add(id);
  }

  // ── UTILISATION ──
  get uniqueLocations(): string[] {
    return [...new Set(this.team.map(p => p.location).filter(Boolean))].sort();
  }

  applyUtilFilter() {
    const sel = this.utilFilterSelected;
    this.filteredUtilTeam = this.team.filter(p => {
      if (sel['location'].length && !sel['location'].includes(p.location)) return false;
      if (sel['employment'].length && !sel['employment'].includes(p.employment_type)) return false;
      if (sel['status'].includes('Has assignments') && this.getPersonProjects(p.person_id).length === 0) return false;
      if (sel['status'].includes('No assignments') && this.getPersonProjects(p.person_id).length > 0) return false;
      return true;
    });
  }

  clearUtilFilters() {
    this.utilFilterSelected = { location: [], employment: [], status: [] };
    this.filteredUtilTeam = [...this.team];
  }

  getPersonProjects(personId: number): { project_id: number; project_name: string; capability: string }[] {
    const result: any[] = [];
    this.projects.forEach(proj => {
      const cap = this.eligibilityMap.get(`${personId}:${proj.project_id}`);
      if (cap) result.push({ project_id: proj.project_id, project_name: proj.project_name, capability: cap });
    });
    return result;
  }

  // ── Helpers ──
  getInitials(name: string): string {
    if (!name) return '?';
    const parts = name.replace(/[,(].*/, '').trim().split(/[\s,]+/).filter(Boolean);
    return parts.slice(0, 2).map(p => p[0]).join('').toUpperCase();
  }

  getColor(name: string): string {
    const colors = ['#1565c0','#2e7d32','#c62828','#6a1b9a','#00695c','#bf360c','#37474f','#4a148c','#827717','#e65100','#006064','#880e4f','#1b5e20'];
    let hash = 0;
    for (const c of name) hash = ((hash << 5) - hash) + c.charCodeAt(0);
    return colors[Math.abs(hash) % colors.length];
  }
}
