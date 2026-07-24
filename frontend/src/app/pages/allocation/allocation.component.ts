import { Component, OnInit } from '@angular/core';
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
import { MatTooltipModule } from '@angular/material/tooltip';
import { ApiService } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-allocation',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    MatIconModule, MatButtonModule, MatSelectModule, MatFormFieldModule,
    MatInputModule, MatProgressSpinnerModule, MatSnackBarModule, MatTooltipModule,
    FilterBarComponent
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

        <!-- ══ TAB 1: ELIGIBILITY MATRIX ══ -->
        @if (activeTab === 'matrix') {
          <div class="tab-content">

            <div class="matrix-wrap">
              <table class="matrix-table">
                <thead>
                  <tr>
                    <th class="person-th">Team Member</th>
                    @for (p of projects; track p.project_id) {
                      <th class="proj-th">
                        <div class="proj-th-name">{{ p.project_name }}</div>
                        <div class="proj-th-meta">{{ p.BU }} · {{ p.total_sized_hc | number:'1.1-1' }} HC</div>
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
                            [class.val-capable]="getElig(person.person_id, proj.project_id) === 'capable'"
                            [class.val-expert]="getElig(person.person_id, proj.project_id) === 'expert'"
                            [value]="getElig(person.person_id, proj.project_id)"
                            (change)="onEligChange($event, person.person_id, proj.project_id)">
                            <option value="">○ No Exposure</option>
                            <option value="capable">✓ Capable</option>
                            <option value="expert">⭐ Expert</option>
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
          </div>
        }

        <!-- ══ TAB 2: PROJECT ALLOCATION SUMMARY ══ -->
        @if (activeTab === 'summary') {
          <div class="tab-content">

            <!-- KPI tiles -->
            <div class="kpi-bar">
              <div class="kpi-tile green">
                <span class="kpi-val">{{ coveredCount }}</span>
                <span class="kpi-label">Expert covered</span>
              </div>
              <div class="kpi-tile amber">
                <span class="kpi-val">{{ fallbackCount }}</span>
                <span class="kpi-label">Fallback assigned</span>
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
                      <span class="chip chip-ok">✓ {{ proj.experts_count }} Expert{{ proj.experts_count > 1 ? 's' : '' }}</span>
                    } @else if (proj.status === 'fallback') {
                      <span class="chip chip-warn">⚠ Fallback — {{ proj.capable_count }} Capable</span>
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
                            <th>Person</th>
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
                                @if (a.assignment_type === 'expert') {
                                  <span class="cap-badge expert">⭐ Expert</span>
                                } @else if (a.assignment_type === 'fallback') {
                                  <span class="cap-badge capable">✓ Capable</span>
                                } @else {
                                  <span class="cap-badge standby">On standby</span>
                                }
                              </td>
                              <td>
                                @if (a.assignment_type !== 'standby') {
                                  <div class="hc-bar-wrap">
                                    <div class="hc-bar-fill"
                                      [style.width.%]="Math.min(100, (a.allocated_hc / proj.total_sized_hc) * 100)"
                                      [style.background]="a.assignment_type === 'expert' ? '#2e7d32' : '#f9a825'">
                                    </div>
                                  </div>
                                  <strong [style.color]="a.assignment_type === 'expert' ? '#2e7d32' : '#e65100'">
                                    {{ a.allocated_hc | number:'1.1-1' }} HC
                                  </strong>
                                } @else {
                                  <span style="color:#aaa">—</span>
                                }
                              </td>
                              <td>
                                @if (a.assignment_type === 'expert') {
                                  <span class="status-chip sc-ok">✓ Primary</span>
                                } @else if (a.assignment_type === 'fallback') {
                                  <span class="status-chip sc-warn">⚠ Fallback</span>
                                } @else {
                                  <span class="status-chip sc-grey">Standby</span>
                                }
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
                        <span class="util-cap-badge" [class.expert]="proj.capability==='expert'">
                          {{ proj.capability === 'expert' ? '⭐' : '✓' }}
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
                    @let expertCount = getPersonProjects(person.person_id).filter(p => p.capability === 'expert').length;
                    <div class="util-load-fill"
                      [style.width.%]="Math.min(100, projCount * 25)"
                      [style.background]="projCount >= 4 ? '#c62828' : projCount >= 3 ? '#f9a825' : '#2e7d32'">
                    </div>
                    <span class="util-load-label">{{ projCount }} project{{ projCount !== 1 ? 's' : '' }}
                      @if (expertCount > 0) { · {{ expertCount }} expert }
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
    .matrix-table { border-collapse: collapse; width: 100%; }
    .matrix-table thead tr { background: #1a1a2e; }
    .person-th { color: white; padding: 10px 14px; font-size: 11px; font-weight: 600; text-align: left; min-width: 200px; white-space: nowrap; }
    .proj-th { color: white; padding: 8px 10px; font-size: 11px; font-weight: 600; text-align: center; min-width: 140px; }
    .proj-th-name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 130px; }
    .proj-th-meta { font-size: 9px; color: #90caf9; font-weight: 400; margin-top: 2px; }
    .matrix-table tbody tr { border-bottom: 1px solid #f0f0f0; }
    .matrix-table tbody tr:hover td { background: #f5f7ff; }
    .person-td { padding: 8px 14px; background: #fafafa; border-right: 1px solid #e8e8e8; }
    .person-name { font-size: 12px; font-weight: 600; color: #1a1a2e; }
    .person-meta { font-size: 10px; color: #aaa; margin-top: 1px; }
    .matrix-td { text-align: center; padding: 6px 8px; }
    .cap-select { border: 1px solid #e0e0e0; border-radius: 6px; padding: 5px 8px; font-size: 12px; font-family: inherit; background: white; cursor: pointer; width: 115px; outline: none; transition: all 0.12s; }
    .cap-select:focus { border-color: #1565c0; }
    .cap-select.val-capable { background: #e3f2fd; border-color: #1565c0; color: #1565c0; font-weight: 600; }
    .cap-select.val-expert { background: #fff8e1; border-color: #f9a825; color: #e65100; font-weight: 600; }
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
    .cap-badge.expert { background: #fff8e1; color: #e65100; }
    .cap-badge.capable { background: #e3f2fd; color: #1565c0; }
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
    .util-cap-badge.expert { color: #e65100; }
    .util-no-assign { font-size: 11px; color: #ccc; font-style: italic; padding: 4px 0; }
    .util-load-bar { position: relative; height: 6px; background: #f0f0f0; border-radius: 3px; margin-top: 8px; overflow: hidden; }
    .util-load-fill { height: 6px; border-radius: 3px; transition: width 0.3s; }
    .util-load-label { font-size: 10px; color: #888; margin-top: 4px; display: block; }
    .util-empty { grid-column: 1/-1; padding: 32px; text-align: center; color: #aaa; font-size: 13px; }
  `]
})
export class AllocationComponent implements OnInit {
  Math = Math;

  activeTab: 'matrix' | 'summary' | 'util' = 'matrix';
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
    private snackBar: MatSnackBar
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
      this.projects = (projRes?.data || []).filter((p: any) => !['cancelled','closed'].includes(p.status));
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

  onManagerChange() { this.loadData(); }

  setTab(tab: 'matrix' | 'summary' | 'util') {
    this.activeTab = tab;
    if (tab === 'summary') this.loadSummary();
    if (tab === 'util') this.applyUtilFilter();
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
