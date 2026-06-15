import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatTableModule } from '@angular/material/table';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatDividerModule } from '@angular/material/divider';
import { MatTooltipModule } from '@angular/material/tooltip';
import { CommonModule } from '@angular/common';
import { ApiService } from '../../services/api.service';
import { NewProjectComponent } from '../new-project/new-project.component';

@Component({
  selector: 'app-projects',
  standalone: true,
  imports: [
    FormsModule, CommonModule,
    MatTableModule, MatButtonModule, MatIconModule,
    MatInputModule, MatFormFieldModule, MatSelectModule,
    MatProgressSpinnerModule, MatSnackBarModule, MatTooltipModule, MatDividerModule, NewProjectComponent
  ],
  template: `
    <!-- Summary tiles -->
    <div class="summary-bar">
      <!-- Total + budget combined -->
      <div class="summary-tile total" (click)="clearFilters()" style="cursor:pointer" matTooltip="Shows all projects">
        <mat-icon class="tile-icon">folder_open</mat-icon>
        <div class="tile-content">
          <span class="tile-value">{{ projects.length }}</span>
          <span class="tile-label">Total Projects</span>
          <span class="tile-sub">{{ getTotalBudget() }} total budget</span>
        </div>
      </div>
      <!-- Status breakdown tiles -->
      <div class="summary-tile active-tile" (click)="filterByStatus('active')" [class.tile-selected]="selectedStatuses.includes('active')"
        matTooltip="BU approved projects">
        <mat-icon class="tile-icon">check_circle</mat-icon>
        <div class="tile-content">
          <span class="tile-value">{{ countByStatus('active') }}</span>
          <span class="tile-label">Funded</span>
          <span class="tile-sub">{{ getStatusBudget('active') }}</span>
        </div>
      </div>
      <div class="summary-tile review-tile" (click)="filterByStatus('under review')" [class.tile-selected]="selectedStatuses.includes('under review')"
        matTooltip="Submitted to BU — awaiting approval or negotiation">
        <mat-icon class="tile-icon">hourglass_top</mat-icon>
        <div class="tile-content">
          <span class="tile-value">{{ countByStatus('under review') }}</span>
          <span class="tile-label">Under Review</span>
          <span class="tile-sub">{{ getStatusBudget('under review') }}</span>
        </div>
      </div>
      <div class="summary-tile pipeline-tile" (click)="filterByStatus('pipeline')" [class.tile-selected]="selectedStatuses.includes('pipeline')"
        matTooltip="Projects open for scoping and sizing & in negotiations">
        <mat-icon class="tile-icon">pending</mat-icon>
        <div class="tile-content">
          <span class="tile-value">{{ countByStatus('pipeline') }}</span>
          <span class="tile-label">Pipeline</span>
          <span class="tile-sub">{{ getStatusBudget('pipeline') }}</span>
        </div>
      </div>
      <div class="summary-tile paused-tile" (click)="filterByStatus('paused')" [class.tile-selected]="selectedStatuses.includes('paused')"
        matTooltip="Projects temporarily on-hold">
        <mat-icon class="tile-icon">pause_circle</mat-icon>
        <div class="tile-content">
          <span class="tile-value">{{ countByStatus('paused') }}</span>
          <span class="tile-label">Paused</span>
          <span class="tile-sub">{{ getStatusBudget('paused') }}</span>
        </div>
      </div>
      <div class="summary-tile cancelled-tile" (click)="filterByStatus('cancelled')" [class.tile-selected]="selectedStatuses.includes('cancelled')"
        matTooltip="Project Cancelled">
        <mat-icon class="tile-icon">cancel</mat-icon>
        <div class="tile-content">
          <span class="tile-value">{{ countByStatus('cancelled') }}</span>
          <span class="tile-label">Cancelled</span>
          <span class="tile-sub">{{ getStatusBudget('cancelled') }}</span>
        </div>
      </div>
      <div class="summary-tile closed-tile" (click)="filterByStatus('closed')" [class.tile-selected]="selectedStatuses.includes('closed')"
        matTooltip="Projects completed">
        <mat-icon class="tile-icon">archive</mat-icon>
        <div class="tile-content">
          <span class="tile-value">{{ countByStatus('closed') }}</span>
          <span class="tile-label">Closed</span>
          <span class="tile-sub">{{ getStatusBudget('closed') }}</span>
        </div>
      </div>
    </div>

    <!-- Page header -->
    <div class="page-header">
      <div class="header-left">
        <h2>Projects</h2>
        <span class="project-count">{{ filteredProjects.length }} of {{ projects.length }}</span>
      </div>
      <button mat-flat-button class="new-btn" (click)="showNewProject = true">
        <mat-icon>add</mat-icon> New Project
      </button>
    </div>

    <!-- Filters -->
    <div class="filters-row">
      <mat-form-field appearance="outline" class="search-field">
        <mat-label>Search by name or code</mat-label>
        <input matInput [(ngModel)]="searchText" (ngModelChange)="onFilterChange()" placeholder="e.g. ECARX or spg07.030">
        <mat-icon matSuffix>search</mat-icon>
      </mat-form-field>

      <mat-form-field appearance="outline" class="status-field">
        <mat-label>Status</mat-label>
        <mat-select multiple [(ngModel)]="selectedStatuses" (ngModelChange)="onStatusChange($event)">
          <mat-option value="__all_status__">All Status</mat-option>
          <mat-divider></mat-divider>
          <mat-option value="pipeline">Pipeline</mat-option>
          <mat-option value="under review">Under Review</mat-option>
          <mat-option value="active">Funded</mat-option>
          <mat-option value="paused">Paused</mat-option>
          <mat-option value="cancelled">Cancelled</mat-option>
          <mat-option value="closed">Closed</mat-option>
        </mat-select>
      </mat-form-field>

      <mat-form-field appearance="outline" class="bu-field">
        <mat-label>BU</mat-label>
        <mat-select multiple [(ngModel)]="selectedBUs" (ngModelChange)="onBUChange($event)">
          <mat-option value="__all_bus__">All BUs</mat-option>
          <mat-divider></mat-divider>
          @for (bu of uniqueBUs; track bu) {
            <mat-option [value]="bu">{{ bu }}</mat-option>
          }
        </mat-select>
      </mat-form-field>

      <mat-form-field appearance="outline" class="pm-field">
        <mat-label>Submitted By</mat-label>
        <mat-select multiple [(ngModel)]="selectedPMs" (ngModelChange)="onPMChange($event)">
          <mat-option value="__all_pms__">All PMs</mat-option>
          <mat-divider></mat-divider>
          @for (pm of uniquePMs; track pm) {
            <mat-option [value]="pm">{{ pm }}</mat-option>
          }
        </mat-select>
      </mat-form-field>

      @if (searchText || selectedStatuses.some(s => !s.startsWith('__all')) || selectedBUs.some(b => !b.startsWith('__all')) || selectedPMs.some(p => !p.startsWith('__all'))) {
        <button mat-stroked-button (click)="clearFilters()" class="clear-btn">
          <mat-icon>clear</mat-icon> Clear
        </button>
      }
    </div>

    @if (loading) {
      <div class="loading-state">
        <mat-spinner diameter="40"></mat-spinner>
        <p>Loading projects...</p>
      </div>
    } @else if (error) {
      <div class="error-state">
        <mat-icon>error_outline</mat-icon>
        <p>{{ error }}</p>
        <button mat-stroked-button (click)="loadProjects()">Retry</button>
      </div>
    } @else if (filteredProjects.length === 0) {
      <div class="no-results">
        <mat-icon>search_off</mat-icon>
        <p>No projects match your filters.</p>
      </div>
    } @else {
      <div class="table-card">
        <table mat-table [dataSource]="filteredProjects" class="projects-table">

          <ng-container matColumnDef="project_name">
            <th mat-header-cell *matHeaderCellDef (click)="sortBy('project_name')" class="sortable-header">
              Project Name <mat-icon class="sort-icon">{{ getSortIcon('project_name') }}</mat-icon>
            </th>
            <td mat-cell *matCellDef="let p">
              <div class="project-name-cell">
                <span class="project-name">{{ p.project_name }}</span>
              </div>
            </td>
          </ng-container>

          <ng-container matColumnDef="project_code">
            <th mat-header-cell *matHeaderCellDef (click)="sortBy('project_code')" class="sortable-header">
              Code <mat-icon class="sort-icon">{{ getSortIcon('project_code') }}</mat-icon>
            </th>
            <td mat-cell *matCellDef="let p"><span class="code-chip">{{ p.project_code }}</span></td>
          </ng-container>

          <ng-container matColumnDef="BU">
            <th mat-header-cell *matHeaderCellDef (click)="sortBy('BU')" class="sortable-header">
              BU <mat-icon class="sort-icon">{{ getSortIcon('BU') }}</mat-icon>
            </th>
            <td mat-cell *matCellDef="let p">{{ p.BU }}</td>
          </ng-container>

          <ng-container matColumnDef="top_level_team">
            <th mat-header-cell *matHeaderCellDef (click)="sortBy('top_level_team')" class="sortable-header">
              Team <mat-icon class="sort-icon">{{ getSortIcon('top_level_team') }}</mat-icon>
            </th>
            <td mat-cell *matCellDef="let p">{{ p.top_level_team }}</td>
          </ng-container>

          <ng-container matColumnDef="status">
            <th mat-header-cell *matHeaderCellDef (click)="sortBy('status')" class="sortable-header">
              Status <mat-icon class="sort-icon">{{ getSortIcon('status') }}</mat-icon>
            </th>
            <td mat-cell *matCellDef="let p">
              <span class="status-chip status-{{ p.status.replace(' ', '-') }}">
                {{ p.status === 'active' ? 'Funded' : p.status === 'under review' ? 'Under Review' : p.status }}
              </span>
            </td>
          </ng-container>

          <ng-container matColumnDef="actions">
            <th mat-header-cell *matHeaderCellDef></th>
            <td mat-cell *matCellDef="let p">
              <div class="actions-col">
              <!-- Project stats summary -->
              <div class="proj-stats">
                @if (p.sum_hc > 0) {
                  <span class="stat-chip" matTooltip="Total HC in latest version">
                    <mat-icon>people</mat-icon> {{ p.sum_hc | number:'1.1-1' }} HC
                    @if (p.prev_sum_hc > 0 && p.sum_hc !== p.prev_sum_hc) {
                      <span [class.delta-up]="p.sum_hc > p.prev_sum_hc" [class.delta-down]="p.sum_hc < p.prev_sum_hc">
                        {{ p.sum_hc > p.prev_sum_hc ? '▲' : '▼' }}{{ (p.sum_hc - p.prev_sum_hc) | number:'1.1-1' }}
                      </span>
                    }
                  </span>
                }
                @if (p.peak_hc > 0) {
                  <span class="stat-chip peak" matTooltip="Peak HC in any single quarter">
                    <mat-icon>trending_up</mat-icon> {{ p.peak_hc | number:'1.1-1' }} peak
                  </span>
                }
                @if (p.total_cost > 0) {
                  <span class="stat-chip cost" matTooltip="Total estimated cost">
                    <mat-icon>attach_money</mat-icon> {{ formatCost(p.total_cost) }}
                  </span>
                }
              </div>

              <button mat-stroked-button color="primary" class="enter-btn"
                [disabled]="p.status === 'cancelled' || p.status === 'closed' || p.status === 'active' || p.status === 'under review'"
                [matTooltip]="p.status === 'active' ? 'Sizing locked — BU approved' : p.status === 'under review' ? 'Submitted to BU — awaiting review' : p.status === 'cancelled' ? 'Project cancelled' : p.status === 'closed' ? 'Project closed' : ''"
                (click)="openSizing(p.project_id)">
                Enter Sizing
              </button>
              <!-- BU action buttons — elevated users only -->
              @if (p.status === 'under review' && isElevatedUser) {
                <button mat-stroked-button color="primary" class="bu-btn"
                  matTooltip="BU approves — project becomes Funded"
                  (click)="approveProject(p)">
                  <mat-icon>check_circle</mat-icon> Approve
                </button>
                <button mat-stroked-button color="warn" class="bu-btn"
                  matTooltip="BU wants changes — send back to Pipeline"
                  (click)="negotiateProject(p)">
                  <mat-icon>replay</mat-icon> Negotiate
                </button>
              }
              @if (['pipeline','paused','cancelled'].includes(p.status)) {
                <button mat-icon-button class="edit-btn"
                  matTooltip="Edit project details"
                  (click)="openEditProject(p)">
                  <mat-icon>edit</mat-icon>
                </button>
                <button mat-icon-button color="warn" class="delete-btn"
                  matTooltip="Delete project"
                  (click)="confirmDelete(p)">
                  <mat-icon>delete_outline</mat-icon>
                </button>
              }
              </div>
            </td>
          </ng-container>

          <tr mat-header-row *matHeaderRowDef="displayedColumns"></tr>
          <tr mat-row *matRowDef="let row; columns: displayedColumns;" class="table-row"></tr>
        </table>
      </div>
    }

    <!-- New Project slide-over panel -->
    @if (showNewProject) {
      <app-new-project [editProject]="projectToEdit" (closed)="onNewProjectClosed($event)"></app-new-project>
    }

    <!-- Delete confirmation dialog -->
    @if (projectToDelete) {
      <div class="confirm-backdrop" (click)="projectToDelete = null"></div>
      <div class="confirm-dialog">
        <div class="confirm-header">
          <mat-icon color="warn">delete_outline</mat-icon>
          <span>Delete Project</span>
        </div>
        <p class="confirm-body">
          Are you sure you want to delete <strong>{{ projectToDelete.project_name }}</strong>?
          This action cannot be undone.
        </p>
        <div class="confirm-actions">
          <button mat-stroked-button (click)="projectToDelete = null">Cancel</button>
          <button mat-flat-button color="warn" (click)="deleteProject()" [disabled]="deleting">
            @if (deleting) { <mat-spinner diameter="16"></mat-spinner> }
            @else { Delete }
          </button>
        </div>
      </div>
    }
  `,
  styles: [`
    /* Summary tiles */
    .summary-bar { display: flex; gap: 12px; margin-bottom: 24px; flex-wrap: wrap; align-items: stretch; }
    .summary-tile {
      display: flex; align-items: center; gap: 12px;
      background: white; border: 1px solid #e0e0e0; border-radius: 10px;
      padding: 14px 20px; min-width: 130px; cursor: pointer;
      transition: box-shadow 0.2s, transform 0.1s;
      border-left: 4px solid #e0e0e0;
    }
    .summary-tile:hover { box-shadow: 0 4px 12px rgba(0,0,0,0.1); transform: translateY(-1px); }
    .tile-selected { box-shadow: 0 4px 12px rgba(0,0,0,0.12); transform: translateY(-1px); outline: 2px solid currentColor; }
   /* Total tile — subtle highlight */
.summary-tile.total {
  border-left-color: #1a1a2e; cursor: default;
  min-width: 190px; padding: 18px 24px;
  background: #f0f2f8; border-color: #c8cee0;
}
.summary-tile.total .tile-value { font-size: 32px; color: #1a1a2e; }
.summary-tile.total .tile-label { color: #555; }
.summary-tile.total .tile-sub { color: #888; }
.summary-tile.total .tile-icon { color: #1a1a2e; font-size: 32px; width: 32px; height: 32px; }
    .summary-tile.active-tile { border-left-color: #4caf50; }
    .summary-tile.review-tile { border-left-color: #e65100; }
    .review-tile .tile-icon { color: #e65100; }
    .summary-tile.pipeline-tile { border-left-color: #1565c0; }
    .summary-tile.paused-tile { border-left-color: #ff9800; }
    .summary-tile.cancelled-tile { border-left-color: #ED1C24; }
    .summary-tile.closed-tile { border-left-color: #9e9e9e; }
    .tile-icon { font-size: 28px; width: 28px; height: 28px; color: #999; }
    .active-tile .tile-icon { color: #4caf50; }
    .pipeline-tile .tile-icon { color: #1565c0; }
    .paused-tile .tile-icon { color: #ff9800; }
    .cancelled-tile .tile-icon { color: #ED1C24; }
    .closed-tile .tile-icon { color: #9e9e9e; }
    .tile-content { display: flex; flex-direction: column; }
    .tile-value { font-size: 24px; font-weight: 700; color: #1a1a2e; line-height: 1; }
    .tile-label { font-size: 11px; color: #888; margin-top: 3px; text-transform: uppercase; letter-spacing: 0.5px; }
    .tile-sub { font-size: 11px; color: #aaa; margin-top: 2px; }

    /* Page header */
    .page-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
    .header-left { display: flex; align-items: baseline; gap: 12px; }
    .page-header h2 { margin: 0; font-size: 20px; font-weight: 600; color: #1a1a2e; }
    .project-count { color: #999; font-size: 13px; }
    .new-btn { background: #1a1a2e !important; color: white !important; }

    /* Filters */
    .filters-row { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; flex-wrap: wrap; }
    .search-field { width: 300px; }
    .status-field { width: 160px; }
    .bu-field { width: 140px; }
    .clear-btn { height: 40px; }

    /* Table */
    .table-card { background: white; border-radius: 10px; border: 1px solid #e0e0e0; overflow: hidden; }
    .projects-table { width: 100%; }
    th.mat-header-cell { background: #f8f9fa; font-weight: 600; color: #555; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; }
    .sortable-header { cursor: pointer; user-select: none; }
    .sortable-header:hover { background: #f0f0f0; }
    .sort-icon { font-size: 14px; width: 14px; height: 14px; vertical-align: middle; margin-left: 4px; color: #bbb; }
    .table-row:hover td { background: #fafeff; }

    .project-name-cell { display: flex; align-items: center; gap: 8px; }
    .project-name { font-weight: 500; color: #1a1a2e; }
    .code-chip { background: #f0f0f0; color: #555; padding: 2px 8px; border-radius: 4px; font-size: 12px; font-family: monospace; }

    .status-chip { padding: 4px 12px; border-radius: 12px; font-size: 12px; font-weight: 500; text-transform: capitalize; }
    .status-active    { background: #e8f5e9; color: #2e7d32; }
    .status-under-review { background: #fff3e0; color: #e65100; font-weight: 600; }
    .bu-btn { font-size: 12px; height: 32px; padding: 0 10px; }
    .status-pipeline  { background: #e3f2fd; color: #1565c0; }
    .status-paused    { background: #fff3e0; color: #e65100; }
    .status-cancelled { background: #ffebee; color: #c62828; }
    .status-closed    { background: #f5f5f5; color: #616161; }

    .enter-btn { font-size: 13px; }
    .actions-col { display: flex; align-items: center; gap: 4px; white-space: nowrap; }

    /* Project stats chips */
    .proj-stats { display: flex; gap: 6px; align-items: center; flex-wrap: nowrap; margin-right: 8px; }
    .stat-chip { display: flex; align-items: center; gap: 3px; padding: 3px 8px; border-radius: 12px; font-size: 11px; font-weight: 600; white-space: nowrap; background: #f0f0f0; color: #555; }
    .stat-chip mat-icon { font-size: 13px; width: 13px; height: 13px; }
    .stat-chip.peak { background: #e3f2fd; color: #1565c0; }
    .stat-chip.cost { background: #e8f5e9; color: #2e7d32; }
    .delta-up { color: #2e7d32; font-size: 10px; margin-left: 3px; }
    .delta-down { color: #ED1C24; font-size: 10px; margin-left: 3px; }
    .edit-btn mat-icon { font-size: 18px; width: 18px; height: 18px; color: #555; }
    .delete-btn mat-icon { font-size: 18px; width: 18px; height: 18px; }

    /* Delete confirmation dialog */
    .confirm-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.4); z-index: 999; }
    .confirm-dialog {
      position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
      background: white; border-radius: 12px; padding: 24px 28px; z-index: 1000;
      width: 380px; box-shadow: 0 8px 32px rgba(0,0,0,0.2);
    }
    .confirm-header { display: flex; align-items: center; gap: 10px; font-size: 16px; font-weight: 600; color: #c62828; margin-bottom: 12px; }
    .confirm-body { font-size: 14px; color: #444; line-height: 1.6; margin-bottom: 20px; }
    .confirm-actions { display: flex; justify-content: flex-end; gap: 10px; }

    /* New project button */
    .new-btn { background: #1a1a2e !important; color: white !important; }

    .loading-state, .error-state, .no-results {
      display: flex; flex-direction: column; align-items: center; padding: 48px; color: #aaa; gap: 12px; background: white; border-radius: 10px;
    }
    .error-state { color: #c62828; }
    .error-state mat-icon { font-size: 48px; width: 48px; height: 48px; }
  `]
})
export class ProjectsComponent implements OnInit {
  projects: any[] = [];
  filteredProjects: any[] = [];
  displayedColumns = ['project_name', 'project_code', 'BU', 'top_level_team', 'status', 'actions'];

  searchText = '';
  selectedStatus = '';   // kept for backward compat
  selectedBU = '';       // kept for backward compat
  selectedPM = '';       // kept for backward compat
  selectedStatuses: string[] = ['__all_status__'];
  selectedBUs: string[] = ['__all_bus__'];
  selectedPMs: string[] = ['__all_pms__'];
  loading = true;
  error = '';
  showNewProject = false;
  projectToDelete: any = null;
  projectToEdit: any = null;
  deleting = false;
  isElevatedUser = true; // Rahul is Senior Manager — always elevated. Wire to auth later.
  sortColumn = '';
  sortDirection: 'asc' | 'desc' = 'asc';

  constructor(
    private router: Router,
    private api: ApiService,
    private cdr: ChangeDetectorRef,
    private snackBar: MatSnackBar
  ) {}

  ngOnInit() { this.loadProjects(); this.loadBudgetSummary(); }

  get uniqueBUs(): string[] {
    return [...new Set(this.projects.map(p => p.BU).filter(Boolean))].sort();
  }

  get uniquePMs(): string[] {
    return [...new Set(this.projects.map(p => p.submitted_by).filter(Boolean))].sort();
  }

  countByStatus(status: string): number {
    return this.projects.filter(p => p.status === status).length;
  }

  // Live budget data from DB
  budgetSummary: Record<string, { count: number; total: number }> = {};
  grandTotalBudget = 0;

  loadBudgetSummary() {
    this.api.getProjectBudgetSummary().subscribe({
      next: (res: any) => {
        this.budgetSummary = res.data.summary || {};
        this.grandTotalBudget = res.data.grandTotal || 0;
        this.cdr.detectChanges();
      },
      error: () => {} // silently fail — tiles show $0 if no rates configured
    });
  }

  getStatusBudget(status: string): string {
    const total = this.budgetSummary[status]?.total || 0;
    if (total === 0) return '$0';
    if (total >= 1_000_000) return '$' + (total / 1_000_000).toFixed(2) + 'M';
    if (total >= 1_000) return '$' + (total / 1_000).toFixed(0) + 'K';
    return '$' + total.toFixed(0);
  }

  getTotalBudget(): string {
    const total = this.grandTotalBudget;
    if (total === 0) return '$0';
    if (total >= 1_000_000) return '$' + (total / 1_000_000).toFixed(2) + 'M';
    if (total >= 1_000) return '$' + (total / 1_000).toFixed(0) + 'K';
    return '$' + total.toFixed(0);
  }

  filterByStatus(status: string) {
    // Toggle: if this status is already the only filter, clear; otherwise set it exclusively
    const mapped = status === 'active' ? 'active' : status;
    const activeStatuses = this.selectedStatuses.filter(s => !s.startsWith('__all'));
    if (activeStatuses.length === 1 && activeStatuses[0] === mapped) {
      // Clicking same tile again → clear filter (show all)
      this.selectedStatuses = ['__all_status__'];
    } else {
      // Set this status exclusively
      this.selectedStatuses = [mapped];
    }
    this.onFilterChange();
  }

  loadProjects() {
    this.loading = true;
    this.error = '';
    this.api.getProjects().subscribe({
      next: (response: any) => {
        this.projects = response.data;
        this.filteredProjects = [...this.projects];
        this.loading = false;
        this.cdr.detectChanges();
      },
      error: () => {
        this.error = 'Failed to load projects. Is the backend running?';
        this.loading = false;
        this.snackBar.open('Could not load projects — check backend connection', 'Dismiss', {
          duration: 5000, horizontalPosition: 'end', verticalPosition: 'top',
          panelClass: ['snack-error']
        });
        this.cdr.detectChanges();
      }
    });
  }

  // Smart multiselect handlers — "All" and specific options are mutually exclusive
  onStatusChange(values: string[]) {
    if (values.length === 0) {
      this.selectedStatuses = ['__all_status__'];
      this.onFilterChange();
      return;
    }
    const justPickedAll = values[values.length - 1] === '__all_status__';
    if (justPickedAll) {
      // All Status was the last thing clicked — reset to All only
      this.selectedStatuses = ['__all_status__'];
    } else {
      // Real option clicked — strip out the All sentinel
      this.selectedStatuses = values.filter(v => v !== '__all_status__');
      if (this.selectedStatuses.length === 0) this.selectedStatuses = ['__all_status__'];
    }
    this.onFilterChange();
  }

  onBUChange(values: string[]) {
    if (values.length === 0) {
      this.selectedBUs = ['__all_bus__'];
      this.onFilterChange();
      return;
    }
    const justPickedAll = values[values.length - 1] === '__all_bus__';
    if (justPickedAll) {
      this.selectedBUs = ['__all_bus__'];
    } else {
      this.selectedBUs = values.filter(v => v !== '__all_bus__');
      if (this.selectedBUs.length === 0) this.selectedBUs = ['__all_bus__'];
    }
    this.onFilterChange();
  }

  onPMChange(values: string[]) {
    if (values.length === 0) {
      this.selectedPMs = ['__all_pms__'];
      this.onFilterChange();
      return;
    }
    const justPickedAll = values[values.length - 1] === '__all_pms__';
    if (justPickedAll) {
      this.selectedPMs = ['__all_pms__'];
    } else {
      this.selectedPMs = values.filter(v => v !== '__all_pms__');
      if (this.selectedPMs.length === 0) this.selectedPMs = ['__all_pms__'];
    }
    this.onFilterChange();
  }

  onFilterChange() {
    // Filter out sentinel "All" values before applying
    const activeStatuses = this.selectedStatuses.filter(s => !s.startsWith('__all'));
    const activeBUs = this.selectedBUs.filter(b => !b.startsWith('__all'));
    const activePMs = this.selectedPMs.filter(p => !p.startsWith('__all'));

    this.filteredProjects = this.projects.filter(p => {
      const matchesSearch = !this.searchText ||
        p.project_name.toLowerCase().includes(this.searchText.toLowerCase()) ||
        p.project_code.toLowerCase().includes(this.searchText.toLowerCase());
      const matchesStatus = !activeStatuses.length || activeStatuses.includes(p.status);
      const matchesBU = !activeBUs.length || activeBUs.includes(p.BU);
      const matchesPM = !activePMs.length || activePMs.includes(p.submitted_by);
      return matchesSearch && matchesStatus && matchesBU && matchesPM;
    });
    this.applySort();
  }

  clearFilters() {
    this.searchText = '';
    this.selectedStatuses = ['__all_status__'];
    this.selectedBUs = ['__all_bus__'];
    this.selectedPMs = ['__all_pms__'];
    this.selectedStatus = '';
    this.selectedBU = '';
    this.selectedPM = '';
    this.filteredProjects = [...this.projects];
    this.applySort();
  }

  openEditProject(project: any) {
    this.projectToEdit = project;
    this.showNewProject = true; // reuse new project panel with pre-filled data
  }

  confirmDelete(project: any) {
    this.projectToDelete = project;
  }

  deleteProject() {
    if (!this.projectToDelete) return;
    this.deleting = true;
    this.api.updateProject(this.projectToDelete.project_id, { status: 'cancelled' }).subscribe({
      next: () => {
        this.snackBar.open(`"${this.projectToDelete.project_name}" has been removed`, 'Close', {
          duration: 3000, horizontalPosition: 'end', verticalPosition: 'top'
        });
        this.projectToDelete = null;
        this.deleting = false;
        this.loadProjects();
      },
      error: () => {
        this.deleting = false;
        this.snackBar.open('Failed to delete project', 'Close', {
          duration: 4000, horizontalPosition: 'end', verticalPosition: 'top',
          panelClass: ['snack-error']
        });
      }
    });
  }

  sortBy(column: string) {
    if (this.sortColumn === column) {
      this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      this.sortColumn = column;
      this.sortDirection = 'asc';
    }
    this.applySort();
  }

  applySort() {
    if (!this.sortColumn) return;
    this.filteredProjects = [...this.filteredProjects].sort((a, b) => {
      const valA = (a[this.sortColumn] || '').toString().toLowerCase();
      const valB = (b[this.sortColumn] || '').toString().toLowerCase();
      return this.sortDirection === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
    });
  }

  getSortIcon(column: string): string {
    if (this.sortColumn !== column) return 'unfold_more';
    return this.sortDirection === 'asc' ? 'arrow_upward' : 'arrow_downward';
  }

  openSizing(projectId: number) {
    this.router.navigate(['/sizing', projectId]);
  }

  approveProject(project: any) {
    this.api.approveProject(project.project_id).subscribe({
      next: () => {
        this.snackBar.open(`"${project.project_name}" approved — now Funded`, 'Close', { duration: 3000, horizontalPosition: 'end', verticalPosition: 'top' });
        this.loadProjects();
        this.loadBudgetSummary();
      },
      error: () => this.snackBar.open('Failed to approve project', 'Close', { duration: 3000, horizontalPosition: 'end', verticalPosition: 'top', panelClass: ['snack-error'] })
    });
  }

  negotiateProject(project: any) {
    this.api.negotiateProject(project.project_id).subscribe({
      next: () => {
        this.snackBar.open(`"${project.project_name}" sent back to Pipeline for revision`, 'Close', { duration: 3000, horizontalPosition: 'end', verticalPosition: 'top' });
        this.loadProjects();
        this.loadBudgetSummary();
      },
      error: () => this.snackBar.open('Failed to update project', 'Close', { duration: 3000, horizontalPosition: 'end', verticalPosition: 'top', panelClass: ['snack-error'] })
    });
  }

  formatCost(value: number): string {
    if (!value) return '$0';
    if (value >= 1_000_000) return '$' + (value / 1_000_000).toFixed(2) + 'M';
    if (value >= 1_000) return '$' + (value / 1_000).toFixed(0) + 'K';
    return '$' + Math.round(value);
  }

  onNewProjectClosed(saved: boolean) {
    this.showNewProject = false;
    this.projectToEdit = null;
    if (saved) { this.loadProjects(); this.loadBudgetSummary(); }
  }
}
