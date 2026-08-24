import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
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
import { inject } from '@angular/core';

@Component({
  selector: 'app-allocation',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    MatIconModule, MatButtonModule, MatSelectModule, MatFormFieldModule,
    MatInputModule, MatProgressSpinnerModule, MatSnackBarModule, MatTooltipModule,
    FilterBarComponent, StickyScrollbarDirective
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
        <button class="alloc-tab" [class.active]="activeTab === 'steady'" (click)="setTab('steady')">
          <mat-icon>all_inclusive</mat-icon> Steady State Projects
        </button>
        <button class="alloc-tab" [class.active]="activeTab === 'summary'" (click)="setTab('summary')">
          <mat-icon>assignment</mat-icon> Project Allocation Summary
        </button>
        <button class="alloc-tab" [class.active]="activeTab === 'util'" (click)="setTab('util')">
          <mat-icon>bar_chart</mat-icon> Team Utilisation
        </button>
        <button class="alloc-tab" [class.active]="activeTab === 'compute'" (click)="setTab('compute')">
          <mat-icon>calculate</mat-icon> Assignment Output
        </button>
      </div>

      <!-- Loading -->
      @if (loading) {
        <div class="alloc-loading">
          <mat-spinner diameter="32"></mat-spinner>
          <span>Loading team data...</span>
        </div>
      } @else {

        <!-- ══ TAB 1: ELIGIBILITY MATRIX ══ -->
        @if (activeTab === 'matrix') {
          <div class="tab-content">

            <div class="matrix-wrap" stickyScrollbar>
              <table class="matrix-table">
                <thead>
                  <tr>
                    <th class="person-th">Resource</th>
                    @for (p of projects; track p.project_id) {
                      <th class="proj-th">
                        <div class="proj-th-name">{{ p.project_name }}</div>
                        <div class="proj-th-meta">{{ p.BU }} · {{ p.total_sized_hc | number:'1.1-1' }} HC</div>
                        <div class="proj-th-buttons">
                          <button class="hc-info-btn" (click)="openHcPanel(p, $event)"
                            matTooltip="View HC breakdown per quarter">
                            <mat-icon style="font-size:11px;width:11px;height:11px">bar_chart</mat-icon>
                            {{ selectedManager ? 'My allotment' : 'HC sizing' }}
                          </button>
                          <button class="finetune-btn" (click)="openFineTune(p)"
                            matTooltip="Fine-tune effort allocation per person per quarter">
                            <mat-icon style="font-size:11px;width:11px;height:11px">tune</mat-icon> Fine-tune
                          </button>
                        </div>
                      </th>
                    }
                  </tr>
                </thead>
                <tbody>
                  @for (person of team; track person.person_id) {
                    <tr>
                      <td class="person-td">
                        <div class="person-name">{{ person.display_name }}</div>
                        <div class="person-meta">{{ person.designation }} · {{ person.location }}</div>
                      </td>
                      @for (proj of projects; track proj.project_id) {
                        <td class="matrix-td">
                          <select class="cap-select"
                            [class.val-yes]="getElig(person.person_id, proj.project_id) !== ''"
                            [value]="getElig(person.person_id, proj.project_id)"
                            (change)="onEligChange($event, person.person_id, proj.project_id)">
                            <option value="">— No</option>
                            <option value="yes">✓ Yes</option>
                          </select>
                        </td>
                      }
                    </tr>
                  }
                </tbody>
              </table>
            </div>

            <div class="matrix-footer">
              <span class="matrix-count">{{ team.length }} people · {{ projects.length }} projects</span>
              <button mat-flat-button color="primary" (click)="saveMatrix()" [disabled]="saving">
                {{ saving ? 'Saving...' : 'Save Matrix' }}
              </button>
            </div>

            <!-- HC Info panel -->
            @if (showHcPanel && hcPanelProject) {
              <div class="hcp-backdrop" (click)="showHcPanel=false"></div>
              <div class="hcp-panel" [style.top.px]="hcPanelY" [style.left.px]="hcPanelX">
                <div class="hcp-header">
                  <div>
                    <div class="hcp-title">{{ hcPanelProject.project_name }}</div>
                    <div class="hcp-sub">{{ selectedManager ? selectedManager + ' allotment' : 'Total project sizing' }} · per quarter</div>
                  </div>
                  <button (click)="showHcPanel=false"
                    style="background:none;border:1px solid #e0e0e0;border-radius:50%;width:22px;height:22px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;padding:0;color:#888;font-size:12px;line-height:1">
                    ✕
                  </button>
                </div>
                <div class="hcp-body">
                  @if (hcPanelQuarters.length === 0) {
                    <div style="color:#aaa;font-size:12px;padding:8px 0">No sizing data found for this filter.</div>
                  } @else {
                    @for (q of hcPanelQuarters; track q.quarter) {
                      <div class="hcp-row">
                        <span class="hcp-q">{{ q.quarter }}</span>
                        <div class="hcp-bar-wrap">
                          <div class="hcp-bar" [style.width.%]="hcPanelMax > 0 ? (q.hc / hcPanelMax * 100) : 0"
                            [style.background]="selectedManager ? '#1565c0' : '#2e7d32'"></div>
                        </div>
                        <span class="hcp-val">{{ q.hc | number:'1.1-1' }} HC</span>
                      </div>
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
                                <div class="avatar-sm" [style.background]="getColor(person.display_name)">{{ getInitials(person.display_name) }}</div>
                                <div>
                                  <div style="font-weight:600;font-size:12px">{{ person.display_name }}</div>
                                  <div style="font-size:10px;color:#aaa">{{ person.location }}</div>
                                </div>
                              </td>
                              @for (q of ftQuarters; track q) {
                                <td style="text-align:center;padding:4px">
                                  <input class="ft-input"
                                    type="number" min="0" max="1" step="0.05"
                                    [value]="getFtEffort(person.person_id, q)"
                                    (change)="setFtEffort(person.person_id, q, $event)"
                                    placeholder="auto">
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

                  <!-- Projects assigned -->
                  <div class="util-projects">
                    @for (proj of getPersonProjects(person.person_id); track proj.project_id) {
                      <div class="util-proj-row">
                        <span class="util-proj-name">{{ proj.project_name }}</span>
                        <span class="util-cap-badge" [class.eligible]="proj.capability==='yes'">
                          {{ proj.capability === 'yes' ? '✓' : '✓' }}
                        </span>
                      </div>
                    }
                    @if (getPersonProjects(person.person_id).length === 0) {
                      <div class="util-no-assign">No projects assigned</div>
                    }
                  </div>

                  <!-- Estimated project count indicator -->
                  <div class="util-load-bar">
                    @let projCount = getPersonProjects(person.person_id).length;
                    @let expertCount = getPersonProjects(person.person_id).filter(p => p.capability === 'yes').length;
                    <div class="util-load-fill"
                      [style.width.%]="Math.min(100, projCount * 25)"
                      [style.background]="projCount >= 4 ? '#c62828' : projCount >= 3 ? '#f9a825' : '#2e7d32'">
                    </div>
                    <span class="util-load-label">{{ projCount }} project{{ projCount !== 1 ? 's' : '' }}
                      @if (expertCount > 0) { · {{ expertCount }} eligible }
                    </span>
                  </div>
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
                <div class="ss-kpi-label">Steady State Tasks</div>
                <div class="ss-kpi-value">{{ steadyStateTasks.length }}</div>
                <div class="ss-kpi-sub">Across all functions</div>
              </div>
              <div class="ss-kpi" style="border-left-color:#2e7d32">
                <div class="ss-kpi-label">Total Effort Assigned</div>
                <div class="ss-kpi-value">{{ getTotalSsmEffort() | number:'1.1-1' }}</div>
                <div class="ss-kpi-sub">HC across all people & tasks</div>
              </div>
              <div class="ss-kpi" style="border-left-color:#6a1b9a">
                <div class="ss-kpi-label">Avg Effort per Person</div>
                <div class="ss-kpi-value">{{ ssmFilteredPeople.length ? (getTotalSsmEffort() / ssmFilteredPeople.length | number:'1.2-2') : '0' }}</div>
                <div class="ss-kpi-sub">Out of 1.0 max per person</div>
              </div>
              <div class="ss-kpi" [style.border-left-color]="getOverAllocatedCount() > 0 ? '#c62828' : '#607d8b'">
                <div class="ss-kpi-label">Over-Allocated</div>
                <div class="ss-kpi-value" [style.color]="getOverAllocatedCount() > 0 ? '#c62828' : '#1a1a2e'">{{ getOverAllocatedCount() }}</div>
                <div class="ss-kpi-sub">{{ getOverAllocatedCount() > 0 ? 'People exceeding 1.0 HC' : 'Everyone within capacity' }}</div>
              </div>
            </div>

            <!-- People × Tasks Matrix -->
            <div class="ss-card">
              <div class="ss-card-header" style="justify-content:space-between">
                <div style="display:flex;align-items:center;gap:8px">
                  <mat-icon style="color:#e65100">grid_on</mat-icon>
                  <span class="ss-card-title">Steady State Projects — Effort Matrix</span>
                  <span class="ss-hint">Enter HC per person per task · saves on blur · elevated users can edit budgets</span>
                  @if (ssDirty) { <span class="ss-unsaved">Unsaved changes</span> }
                </div>
                <div style="display:flex;gap:8px">
                  @if (ssDirty) {
                    <button mat-stroked-button style="font-size:12px;height:34px;color:#c62828;border-color:#c62828" (click)="ssDiscard()">
                      <mat-icon>undo</mat-icon> Discard
                    </button>
                    <button mat-flat-button style="font-size:12px;height:34px;background:#2e7d32;color:white" (click)="ssSave()">
                      <mat-icon>save</mat-icon> Save Changes
                    </button>
                  }
                </div>
              </div>

              <div style="overflow-x:auto" stickyScrollbar>
                <table class="ss-effort-matrix">
                  <thead>
                    <tr>
                      <th class="ssm-person-hd">Resource</th>
                      @for (task of steadyStateTasks; track task.task_id) {
                        <th class="ssm-task-hd" [matTooltip]="task.name">
                          <div class="ssm-task-hd-inner">
                            <span class="ssm-task-name">{{ task.name }}</span>
                          </div>
                          @if (task.task_code) {
                            <div class="ssm-task-code">{{ task.task_code }}</div>
                          }
                        </th>
                      }
                      <th class="ssm-total-hd">Total</th>
                      <th class="ssm-total-hd">Gap</th>
                    </tr>
                    <!-- Assigned HC summary row -->
                    <tr class="ssm-budget-row">
                      <td class="ssm-person-hd" style="font-size:10px;color:#888;font-weight:600;letter-spacing:0.5px">ASSIGNED HC</td>
                      @for (task of steadyStateTasks; track task.task_id) {
                        <td style="text-align:center;padding:4px">
                          <span style="font-size:11px;font-weight:700;color:#2e7d32">
                            {{ getSsTaskAssigned(task) > 0 ? (getSsTaskAssigned(task) | number:'1.1-1') : '—' }}
                          </span>
                        </td>
                      }
                      <td></td><td></td>
                    </tr>
                  </thead>
                  <tbody>
                    @for (person of ssmFilteredPeople; track person.person_id) {
                      <tr [class.ssm-row-over]="getSsmPersonTotal(person.person_id) > 1">
                        <td class="ssm-person-td">
                          <div class="person-name">{{ person.display_name }}</div>
                          <div class="person-meta">{{ person.designation }} · {{ person.location }}</div>
                        </td>
                        @for (task of steadyStateTasks; track task.task_id) {
                          <td class="ssm-cell">
                            <input class="ssm-input"
                              type="number" min="0" max="1" step="0.05"
                              [value]="getSsmEffort(person.person_id, task.task_id) || ''"
                              (change)="setSsmEffort(person.person_id, task.task_id, $event)"
                              placeholder="—"
                              [class.ssm-input-set]="getSsmEffort(person.person_id, task.task_id) > 0">
                          </td>
                        }
                        <td class="ssm-total-cell">
                          <span [style.color]="getSsmPersonTotal(person.person_id) > 1 ? '#c62828' : '#1a1a2e'"
                                [style.fontWeight]="getSsmPersonTotal(person.person_id) > 1 ? '700' : '400'">
                            {{ getSsmPersonTotal(person.person_id) | number:'1.2-2' }}
                          </span>
                        </td>
                        <td class="ssm-total-cell">
                          <span [style.color]="1 - getSsmPersonTotal(person.person_id) < 0 ? '#c62828' : '#aaa'">
                            {{ (1 - getSsmPersonTotal(person.person_id)) | number:'1.2-2' }}
                          </span>
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>

              <div style="display:flex;gap:16px;flex-wrap:wrap;padding:10px 16px;font-size:11px;color:#888;border-top:1px solid #f5f5f5;align-items:center">
                <span>Each cell = fraction of person's time (0–1) · 0.5 = 50% · 1.0 = full time</span>
                <span class="ssm-legend-over">⚠ Red row = person over-allocated (&gt;1.0 total)</span>
                <span class="ssm-legend-over" style="color:#c62828">⚠ Red badge = task over budget</span>
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
                <button mat-stroked-button (click)="runCompute()">
                  <mat-icon>refresh</mat-icon> Re-run
                </button>
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
    .proj-th-buttons { display: flex; flex-direction: column; align-items: center; gap: 4px; margin-top: 6px; }
    .matrix-table tbody tr { border-bottom: 1px solid #f0f0f0; }
    .matrix-table tbody tr:hover td { background: #f5f7ff; }
    .person-td { padding: 8px 14px; background: #fafafa; border-right: 1px solid #e8e8e8; }
    .person-name { font-size: 12px; font-weight: 600; color: #1a1a2e; }
    .person-meta { font-size: 10px; color: #aaa; margin-top: 1px; }
    .matrix-td { text-align: center; padding: 6px 8px; }
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
    .hcp-row { display: flex; align-items: center; gap: 8px; font-size: 12px; }
    .hcp-q { width: 64px; flex-shrink: 0; color: #888; font-size: 11px; }
    .hcp-bar-wrap { flex: 1; height: 8px; background: #f0f0f0; border-radius: 4px; overflow: hidden; }
    .hcp-bar { height: 100%; border-radius: 4px; transition: width 0.3s; }
    .hcp-val { width: 52px; text-align: right; font-weight: 700; color: #1a1a2e; flex-shrink: 0; font-size: 11px; }
    .finetune-btn { background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.25); border-radius: 10px; padding: 3px 9px; font-size: 10px; color: #b3e5fc; cursor: pointer; display: flex; align-items: center; gap: 3px; font-family: inherit; transition: all 0.15s; white-space: nowrap; }
    .finetune-btn:hover { background: rgba(255,255,255,0.25); color: white; }
    .ft-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.25); z-index: 200; }
    .ft-panel { position: fixed; right: 0; top: 0; bottom: 0; width: 700px; background: white; box-shadow: -4px 0 24px rgba(0,0,0,0.15); z-index: 201; display: flex; flex-direction: column; }
    .ft-header { padding: 18px 20px; border-bottom: 1px solid #e0e0e0; display: flex; align-items: flex-start; justify-content: space-between; flex-shrink: 0; }
    .ft-title { font-size: 15px; font-weight: 700; color: #1a1a2e; }
    .ft-sub { font-size: 11px; color: #aaa; margin-top: 3px; }
    .ft-body { flex: 1; overflow: auto; padding: 16px; }
    .ft-footer { padding: 14px 20px; border-top: 1px solid #e0e0e0; display: flex; justify-content: space-between; align-items: center; flex-shrink: 0; }
    .ft-table { border-collapse: collapse; font-size: 12px; min-width: 100%; }
    .ft-table th { background: #f8f9fa; padding: 8px 10px; text-align: center; font-size: 11px; font-weight: 600; color: #888; border: 1px solid #e0e0e0; white-space: nowrap; }
    .ft-person-hd { text-align: left !important; min-width: 160px; position: sticky; left: 0; background: #f8f9fa; }
    .ft-table td { padding: 6px 8px; border: 1px solid #f0f0f0; vertical-align: middle; }
    .ft-person-td { display: flex; align-items: center; gap: 8px; background: #fafafa; position: sticky; left: 0; padding: 6px 10px !important; border-right: 1px solid #e0e0e0; min-width: 160px; }
    .ft-input { width: 56px; border: 1.5px solid #e0e0e0; border-radius: 6px; padding: 4px 6px; font-size: 12px; text-align: center; font-family: inherit; }
    .ft-input:focus { outline: none; border-color: #1565c0; }
    .ft-cap-bar-wrap { height: 6px; background: #f0f0f0; border-radius: 3px; overflow: hidden; width: 60px; margin: 0 auto 2px; }
    .ft-cap-bar { height: 100%; border-radius: 3px; transition: width 0.3s; }
    .cap-badge.eligible { background: #e8f5e9; color: #2e7d32; }
    .cap-select.val-yes { background: #fff8e1; border-color: #f9a825; color: #e65100; font-weight: 600; }
    .matrix-footer { display: flex; align-items: center; justify-content: space-between; padding: 8px 0; }
    .matrix-count { font-size: 12px; color: #888; }

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
    .ss-panel { position: fixed; right: 0; top: 0; bottom: 0; width: 400px; background: white; box-shadow: -4px 0 24px rgba(0,0,0,0.15); z-index: 201; display: flex; flex-direction: column; }
    .ss-panel-header { padding: 18px 20px; border-bottom: 1px solid #e0e0e0; display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; }
    .ss-panel-title { font-size: 15px; font-weight: 700; color: #1a1a2e; }
    .ss-panel-body { flex: 1; overflow-y: auto; padding: 20px; display: flex; flex-direction: column; min-height: 0; }
    .ss-panel-footer { padding: 14px 20px; border-top: 1px solid #e0e0e0; display: flex; gap: 10px; justify-content: flex-end; align-items: center; flex-shrink: 0; }
    .ss-form-group { margin-bottom: 14px; }
    .ss-form-label { font-size: 10px; font-weight: 700; color: #888; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 5px; display: block; }
    .ss-input { width: 100%; border: 1.5px solid #e0e0e0; border-radius: 6px; padding: 8px 10px; font-size: 13px; font-family: inherit; outline: none; resize: vertical; }
    .ss-input:focus { border-color: #1565c0; }
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
export class AllocationComponent implements OnInit {
  Math = Math;

  qs = inject(QuarterService);
  activeTab: 'matrix' | 'summary' | 'util' | 'steady' | 'compute' = 'matrix';

  // ── HC info panel ────────────────────────────────────────────────────────────
  showHcPanel = false;
  hcPanelProject: any = null;
  hcPanelX = 0;
  hcPanelY = 0;
  hcPanelQuarters: { quarter: string; hc: number }[] = [];
  get hcPanelMax(): number { return Math.max(...this.hcPanelQuarters.map(q => q.hc), 1); }

  openHcPanel(proj: any, event: MouseEvent) {
    event.stopPropagation();
    this.hcPanelProject = proj;
    this.showHcPanel = true;

    // Position near clicked button — use fixed viewport coordinates
    const rect = (event.target as HTMLElement).closest('button')!.getBoundingClientRect();
    const panelW = 300;
    // Flip left if too close to right edge
    let x = rect.left;
    if (x + panelW > window.innerWidth - 16) x = rect.right - panelW;
    this.hcPanelX = Math.max(8, x);
    // Flip up if too close to bottom
    const panelH = 360;
    let y = rect.bottom + 4;
    if (y + panelH > window.innerHeight - 16) y = rect.top - panelH - 4;
    this.hcPanelY = Math.max(8, y);

    if (this.selectedManager && this.managerAllotment.length > 0) {
      // Show manager's allotment per quarter
      const allotment = this.managerAllotment.find(p => p.project_id === proj.project_id);
      this.hcPanelQuarters = allotment
        ? Object.entries(allotment.quarters)
            .map(([q, hc]) => ({ quarter: q, hc: hc as number }))
            .sort((a, b) => this.parseQ(a.quarter) - this.parseQ(b.quarter))
        : [];
    } else {
      // All Teams — show total project sizing per quarter from DB
      this.hcPanelQuarters = [];
      this.api.getProjectQuarterlyTotals(proj.project_id).subscribe({
        next: (res: any) => {
          this.hcPanelQuarters = res.data || [];
          this.cdr.detectChanges();
        },
        error: () => { this.hcPanelQuarters = []; }
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
  }

  loadManagerList() {
    // Load distinct reporting managers from RA_people
    this.api.getAllocationTeam('').subscribe({
      next: (res: any) => {
        const mgrs = [...new Set((res.data || []).map((p: any) => p.reporting_manager).filter(Boolean))].sort();
        this.managerList = mgrs as string[];
        // Set default manager based on logged-in user
        if (!this.isElevated) {
          this.selectedManager = this.currentManagerName;
          this.loadManagerAllotment();
        }
        this.loadData();
      },
      error: () => this.loadData()
    });
  }

  loadData() {
    this.loading = true;
    const mgr = this.selectedManager || undefined;

    // Load team + projects + eligibility in parallel
    Promise.all([
      this.api.getAllocationTeam(mgr).toPromise(),
      this.api.getProjects().toPromise(),
      this.api.getAllocationEligibility(mgr).toPromise(),
    ]).then(([teamRes, projRes, eligRes]: any[]) => {
      this.team = teamRes?.data || [];
      this.projects = (projRes?.data || []).filter((p: any) =>
        !['cancelled','closed'].includes(p.status) && p.is_test !== 1 && p.is_test !== true
      );
      this.filteredUtilTeam = [...this.team];

      // Build eligibility map
      this.eligibilityMap.clear();
      (eligRes?.data || []).forEach((e: any) => {
        this.eligibilityMap.set(`${e.person_id}:${e.project_id}`, e.capability);
      });

      this.loadSummary();
      this.loading = false;
    }).catch(() => { this.loading = false; });
  }

  loadSummary() {
    const mgr = this.selectedManager || undefined;
    this.api.getAllocationSummary(mgr).subscribe({
      next: (res: any) => { this.summaryData = res.data || []; },
      error: () => {}
    });
  }

  onManagerChange() {
    this.loadData();
    if (this.selectedManager) this.loadManagerAllotment();
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
          this.projects = this.projects.filter(p => mgrProjectIds.has(p.project_id));
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
    }
  }

  runCompute() {
    this.computeLoading = true;
    this.computeResult = null;
    this.api.computeAllocation().subscribe({
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
    this.api.getSteadyStateTasks().subscribe({
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
        this.cdr.detectChanges();
      },
      error: () => {
        this.ssTasksLoading = false;
        this.snackBar.open('Could not load steady state tasks — deploy backend first', 'Close', { duration: 4000, horizontalPosition: 'end', verticalPosition: 'top' });
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
    this.api.getOrgHeadcount('Weyman, Jeff').subscribe({
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
    this.ssDirty = false;
    this.snackBar.open('Changes saved (mockup — DB wiring coming soon)', 'Close', { duration: 3000, horizontalPosition: 'end', verticalPosition: 'top' });
  }

  ssDiscard() { this.ssDirty = false; this.snackBar.open('Changes discarded', 'Close', { duration: 2000, horizontalPosition: 'end', verticalPosition: 'top' }); }

  // ── MATRIX ──
  getElig(personId: number, projectId: number): string {
    return this.eligibilityMap.get(`${personId}:${projectId}`) || '';
  }

  onEligChange(event: Event, personId: number, projectId: number) {
    const val = (event.target as HTMLSelectElement).value;
    const key = `${personId}:${projectId}`;
    if (val) this.eligibilityMap.set(key, val);
    else this.eligibilityMap.delete(key);
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
        this.saving = false;
        this.snackBar.open('Matrix saved successfully', 'Close', { duration: 3000, horizontalPosition: 'end', verticalPosition: 'top' });
        this.loadSummary();
      },
      error: () => {
        this.saving = false;
        this.snackBar.open('Failed to save', 'Close', { duration: 3000, panelClass: ['snack-error'], horizontalPosition: 'end', verticalPosition: 'top' });
      }
    });
  }

  // ── SUMMARY ──
  get coveredCount(): number { return this.summaryData.filter(p => p.status === 'covered').length; }
  get fallbackCount(): number { return this.summaryData.filter(p => p.status === 'fallback').length; }
  get gapCount(): number { return this.summaryData.filter(p => p.status === 'gap').length; }

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
