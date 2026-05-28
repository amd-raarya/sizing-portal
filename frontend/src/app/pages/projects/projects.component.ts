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
import { ApiService } from '../../services/api.service';

@Component({
  selector: 'app-projects',
  standalone: true,
  imports: [
    FormsModule,
    MatTableModule, MatButtonModule, MatIconModule,
    MatInputModule, MatFormFieldModule, MatSelectModule,
    MatProgressSpinnerModule
  ],
  template: `
    <div class="page-header">
      <h2>Projects</h2>
      <span class="project-count">{{ filteredProjects.length }} of {{ projects.length }} projects</span>
    </div>

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

      @if (searchText || selectedStatus) {
        <button mat-stroked-button (click)="clearFilters()">
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
      <table mat-table [dataSource]="filteredProjects" class="mat-elevation-z2 projects-table">

        <ng-container matColumnDef="project_name">
          <th mat-header-cell *matHeaderCellDef (click)="sortBy('project_name')" class="sortable-header">
            Project Name <mat-icon class="sort-icon">{{ getSortIcon('project_name') }}</mat-icon>
          </th>
          <td mat-cell *matCellDef="let p">{{ p.project_name }}</td>
        </ng-container>

        <ng-container matColumnDef="project_code">
          <th mat-header-cell *matHeaderCellDef (click)="sortBy('project_code')" class="sortable-header">
            Code <mat-icon class="sort-icon">{{ getSortIcon('project_code') }}</mat-icon>
          </th>
          <td mat-cell *matCellDef="let p">{{ p.project_code }}</td>
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
            <button mat-stroked-button color="primary"
              [disabled]="p.status === 'cancelled' || p.status === 'closed'"
              (click)="openSizing(p.project_id)">
              Enter Sizing
            </button>
          </td>
        </ng-container>

        <tr mat-header-row *matHeaderRowDef="displayedColumns"></tr>
        <tr mat-row *matRowDef="let row; columns: displayedColumns;"></tr>
      </table>
    }
  `,
  styles: [`
    .page-header { display: flex; align-items: baseline; gap: 12px; margin-bottom: 16px; }
    .page-header h2 { margin: 0; font-size: 24px; font-weight: 500; }
    .project-count { color: #888; font-size: 13px; }
    .filters-row { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; flex-wrap: wrap; }
    .search-field { width: 320px; }
    .status-field { width: 180px; }
    .projects-table { width: 100%; }
    .sortable-header { cursor: pointer; user-select: none; }
    .sortable-header:hover { background: #f5f5f5; }
    .sort-icon { font-size: 16px; width: 16px; height: 16px; vertical-align: middle; margin-left: 4px; color: #999; }
    .status-chip { padding: 4px 12px; border-radius: 12px; font-size: 12px; font-weight: 500; text-transform: capitalize; }
    .status-active    { background: #e8f5e9; color: #2e7d32; }
    .status-pipeline  { background: #e3f2fd; color: #1565c0; }
    .status-paused    { background: #fff3e0; color: #e65100; }
    .status-cancelled { background: #ffebee; color: #c62828; }
    .status-closed    { background: #f5f5f5; color: #616161; }
    .loading-state, .error-state, .no-results {
      display: flex; flex-direction: column; align-items: center; padding: 48px; color: #aaa; gap: 12px;
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
  loading = true;
  error = '';

  sortColumn = '';
  sortDirection: 'asc' | 'desc' = 'asc';

  constructor(private router: Router, private api: ApiService, private cdr: ChangeDetectorRef) {}

  ngOnInit() { this.loadProjects(); }

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
      error: (err: any) => {
        this.error = 'Failed to load projects. Please try again.';
        this.loading = false;
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
      return matchesSearch && matchesStatus;
    });
    this.applySort();
  }

  clearFilters() {
    this.searchText = '';
    this.selectedStatus = '';
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
      return this.sortDirection === 'asc'
        ? valA.localeCompare(valB)
        : valB.localeCompare(valA);
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