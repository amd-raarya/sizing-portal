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
import { CommonModule } from '@angular/common';
import { ApiService } from '../../services/api.service';

@Component({
  selector: 'app-projects',
  standalone: true,
  imports: [
    FormsModule, CommonModule,
    MatTableModule, MatButtonModule, MatIconModule,
    MatInputModule, MatFormFieldModule, MatSelectModule,
    MatProgressSpinnerModule, MatSnackBarModule
  ],
  template: `
    <!-- Summary tiles -->
    <div class="summary-bar">
      <!-- Total + budget combined -->
      <div class="summary-tile total">
        <mat-icon class="tile-icon">folder_open</mat-icon>
        <div class="tile-content">
          <span class="tile-value">{{ projects.length }}</span>
          <span class="tile-label">Total Projects</span>
          <span class="tile-sub">$1.86M total budget</span>
        </div>
      </div>
      <!-- Status breakdown tiles -->
      <div class="summary-tile active-tile" (click)="filterByStatus('active')" [class.tile-selected]="selectedStatus === 'active'">
        <mat-icon class="tile-icon">check_circle</mat-icon>
        <div class="tile-content">
          <span class="tile-value">{{ countByStatus('active') }}</span>
          <span class="tile-label">Active</span>
          <span class="tile-sub">{{ getStatusBudget('active') }}</span>
        </div>
      </div>
      <div class="summary-tile pipeline-tile" (click)="filterByStatus('pipeline')" [class.tile-selected]="selectedStatus === 'pipeline'">
        <mat-icon class="tile-icon">pending</mat-icon>
        <div class="tile-content">
          <span class="tile-value">{{ countByStatus('pipeline') }}</span>
          <span class="tile-label">Pipeline</span>
          <span class="tile-sub">{{ getStatusBudget('pipeline') }}</span>
        </div>
      </div>
      <div class="summary-tile paused-tile" (click)="filterByStatus('paused')" [class.tile-selected]="selectedStatus === 'paused'">
        <mat-icon class="tile-icon">pause_circle</mat-icon>
        <div class="tile-content">
          <span class="tile-value">{{ countByStatus('paused') }}</span>
          <span class="tile-label">Paused</span>
          <span class="tile-sub">{{ getStatusBudget('paused') }}</span>
        </div>
      </div>
      <div class="summary-tile cancelled-tile" (click)="filterByStatus('cancelled')" [class.tile-selected]="selectedStatus === 'cancelled'">
        <mat-icon class="tile-icon">cancel</mat-icon>
        <div class="tile-content">
          <span class="tile-value">{{ countByStatus('cancelled') }}</span>
          <span class="tile-label">Cancelled</span>
          <span class="tile-sub">{{ getStatusBudget('cancelled') }}</span>
        </div>
      </div>
      <div class="summary-tile closed-tile" (click)="filterByStatus('closed')" [class.tile-selected]="selectedStatus === 'closed'">
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
      <button mat-flat-button class="new-btn" disabled>
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
        <mat-select [(ngModel)]="selectedStatus" (ngModelChange)="onFilterChange()">
          <mat-option value="">All Statuses</mat-option>
          <mat-option value="pipeline">Pipeline</mat-option>
          <mat-option value="active">Active</mat-option>
          <mat-option value="paused">Paused</mat-option>
          <mat-option value="cancelled">Cancelled</mat-option>
          <mat-option value="closed">Closed</mat-option>
        </mat-select>
      </mat-form-field>

      <mat-form-field appearance="outline" class="bu-field">
        <mat-label>BU</mat-label>
        <mat-select [(ngModel)]="selectedBU" (ngModelChange)="onFilterChange()">
          <mat-option value="">All BUs</mat-option>
          @for (bu of uniqueBUs; track bu) {
            <mat-option [value]="bu">{{ bu }}</mat-option>
          }
        </mat-select>
      </mat-form-field>

      @if (searchText || selectedStatus || selectedBU) {
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
              <span class="status-chip status-{{ p.status }}">{{ p.status }}</span>
            </td>
          </ng-container>

          <ng-container matColumnDef="actions">
            <th mat-header-cell *matHeaderCellDef></th>
            <td mat-cell *matCellDef="let p">
              <button mat-stroked-button color="primary" class="enter-btn"
                [disabled]="p.status === 'cancelled' || p.status === 'closed'"
                (click)="openSizing(p.project_id)">
                Enter Sizing
              </button>
            </td>
          </ng-container>

          <tr mat-header-row *matHeaderRowDef="displayedColumns"></tr>
          <tr mat-row *matRowDef="let row; columns: displayedColumns;" class="table-row"></tr>
        </table>
      </div>
    }
  `,
  styles: [`
    /* Summary tiles */
    .summary-bar { display: flex; gap: 12px; margin-bottom: 24px; flex-wrap: wrap; }
    .summary-tile {
      display: flex; align-items: center; gap: 12px;
      background: white; border: 1px solid #e0e0e0; border-radius: 10px;
      padding: 14px 20px; min-width: 130px; cursor: pointer;
      transition: box-shadow 0.2s, transform 0.1s;
      border-left: 4px solid #e0e0e0;
    }
    .summary-tile:hover { box-shadow: 0 4px 12px rgba(0,0,0,0.1); transform: translateY(-1px); }
    .tile-selected { box-shadow: 0 4px 12px rgba(0,0,0,0.12); transform: translateY(-1px); outline: 2px solid currentColor; }
    .summary-tile.total { border-left-color: #1a1a2e; cursor: default; }
    .summary-tile.active-tile { border-left-color: #4caf50; }
    .summary-tile.pipeline-tile { border-left-color: #1565c0; }
    .summary-tile.paused-tile { border-left-color: #ff9800; }
    .summary-tile.cancelled-tile { border-left-color: #ED1C24; }
    .summary-tile.closed-tile { border-left-color: #9e9e9e; }
    .tile-icon { font-size: 28px; width: 28px; height: 28px; color: #999; }
    .total .tile-icon { color: #1a1a2e; }
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
    .status-pipeline  { background: #e3f2fd; color: #1565c0; }
    .status-paused    { background: #fff3e0; color: #e65100; }
    .status-cancelled { background: #ffebee; color: #c62828; }
    .status-closed    { background: #f5f5f5; color: #616161; }

    .enter-btn { font-size: 13px; }

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
  selectedStatus = '';
  selectedBU = '';
  loading = true;
  error = '';
  sortColumn = '';
  sortDirection: 'asc' | 'desc' = 'asc';

  constructor(
    private router: Router,
    private api: ApiService,
    private cdr: ChangeDetectorRef,
    private snackBar: MatSnackBar
  ) {}

  ngOnInit() { this.loadProjects(); }

  get uniqueBUs(): string[] {
    return [...new Set(this.projects.map(p => p.BU).filter(Boolean))].sort();
  }

  countByStatus(status: string): number {
    return this.projects.filter(p => p.status === status).length;
  }

  // Sample budget breakdown per status — in real build this comes from DB
  getStatusBudget(status: string): string {
    const budgets: Record<string, string> = {
      active: '$1.86M', pipeline: '$0', paused: '$0', cancelled: '$0', closed: '$0'
    };
    return budgets[status] ?? '$0';
  }

  filterByStatus(status: string) {
    this.selectedStatus = this.selectedStatus === status ? '' : status;
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

  onFilterChange() {
    this.filteredProjects = this.projects.filter(p => {
      const matchesSearch = !this.searchText ||
        p.project_name.toLowerCase().includes(this.searchText.toLowerCase()) ||
        p.project_code.toLowerCase().includes(this.searchText.toLowerCase());
      const matchesStatus = !this.selectedStatus || p.status === this.selectedStatus;
      const matchesBU = !this.selectedBU || p.BU === this.selectedBU;
      return matchesSearch && matchesStatus && matchesBU;
    });
    this.applySort();
  }

  clearFilters() {
    this.searchText = '';
    this.selectedStatus = '';
    this.selectedBU = '';
    this.filteredProjects = [...this.projects];
    this.applySort();
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
}
