import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatTableModule } from '@angular/material/table';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatCardModule } from '@angular/material/card';
import { MatDividerModule } from '@angular/material/divider';

interface Quarter {
  fiscal_year: number;
  quarter: number;
  label: string;
}

interface SizingRow {
  function_contact: string;
  location: string;
  hc_type: string;
  quarters: { [label: string]: number | null };
}

@Component({
  selector: 'app-sizing',
  standalone: true,
  imports: [
    FormsModule,
    MatTableModule, MatButtonModule, MatIconModule,
    MatInputModule, MatSelectModule, MatCardModule, MatDividerModule
  ],
  template: `
    <div class="sizing-header">
      <button mat-icon-button (click)="goBack()">
        <mat-icon>arrow_back</mat-icon>
      </button>
      <div>
        <h2>Enter Sizing</h2>
        <p class="project-label">{{ project.project_name }}</p>
      </div>
    </div>

    <mat-card class="sizing-card">
      <div class="table-wrapper">
        <table mat-table [dataSource]="rows" class="sizing-table">

          <ng-container matColumnDef="function_contact">
            <th mat-header-cell *matHeaderCellDef>Function</th>
            <td mat-cell *matCellDef="let row">
              <mat-select [(ngModel)]="row.function_contact" class="cell-select" placeholder="Select">
                @for (f of functions; track f) {
                  <mat-option [value]="f">{{ f }}</mat-option>
                }
              </mat-select>
            </td>
          </ng-container>

          <ng-container matColumnDef="location">
            <th mat-header-cell *matHeaderCellDef>Location</th>
            <td mat-cell *matCellDef="let row">
              <mat-select [(ngModel)]="row.location" class="cell-select" placeholder="Select">
                @for (l of locations; track l) {
                  <mat-option [value]="l">{{ l }}</mat-option>
                }
              </mat-select>
            </td>
          </ng-container>

          <ng-container matColumnDef="hc_type">
            <th mat-header-cell *matHeaderCellDef>HC Type</th>
            <td mat-cell *matCellDef="let row">
              <mat-select [(ngModel)]="row.hc_type" class="cell-select" placeholder="Select">
                @for (h of hcTypes; track h) {
                  <mat-option [value]="h">{{ h }}</mat-option>
                }
              </mat-select>
            </td>
          </ng-container>

          @for (q of quarters; track q.label) {
            <ng-container [matColumnDef]="q.label">
              <th mat-header-cell *matHeaderCellDef>{{ q.label }}</th>
              <td mat-cell *matCellDef="let row">
                <input
                  type="number"
                  [(ngModel)]="row.quarters[q.label]"
                  class="quarter-input"
                  min="0"
                  step="0.1"
                  placeholder="0">
              </td>
            </ng-container>
          }

          <ng-container matColumnDef="actions">
            <th mat-header-cell *matHeaderCellDef></th>
            <td mat-cell *matCellDef="let row; let i = index">
              <button mat-icon-button color="warn" (click)="removeRow(i)">
                <mat-icon>delete</mat-icon>
              </button>
            </td>
          </ng-container>

          <tr mat-header-row *matHeaderRowDef="displayedColumns; sticky: true"></tr>
          <tr mat-row *matRowDef="let row; columns: displayedColumns;"></tr>
        </table>
      </div>

      <div class="table-actions">
        <button mat-stroked-button (click)="addRow()">
          <mat-icon>add</mat-icon> Add Function Row
        </button>
        <button mat-stroked-button (click)="addQuarter()">
          <mat-icon>date_range</mat-icon> Add Quarter
        </button>
      </div>

      <mat-divider></mat-divider>

      <div class="form-actions">
        <button mat-stroked-button (click)="goBack()">Cancel</button>
        <button mat-stroked-button color="primary" (click)="saveDraft()">Save Draft</button>
        <button mat-flat-button color="primary" (click)="submit()">Submit</button>
      </div>
    </mat-card>
  `,
  styles: [`
    .sizing-header { display: flex; align-items: center; gap: 8px; margin-bottom: 20px; }
    .sizing-header h2 { margin: 0; font-size: 22px; font-weight: 500; }
    .project-label { margin: 2px 0 0 0; color: #666; font-size: 14px; }
    .table-wrapper { overflow-x: auto; }
    .sizing-table { width: 100%; min-width: 800px; }
    .cell-select { width: 140px; font-size: 13px; }
    .quarter-input {
      width: 60px; border: 1px solid #ddd; border-radius: 4px;
      padding: 4px 6px; font-size: 13px; text-align: center;
    }
    .quarter-input:focus { outline: none; border-color: #1976d2; }
    .table-actions { display: flex; gap: 12px; padding: 12px 16px; }
    .form-actions { display: flex; gap: 12px; justify-content: flex-end; padding: 12px 16px; }
  `]
})
export class SizingComponent implements OnInit {
  projectId!: number;
  project = { project_name: 'Loading...', status: 'active' };

  quarters: Quarter[] = [
    { fiscal_year: 2026, quarter: 1, label: 'Q1 FY26' },
    { fiscal_year: 2026, quarter: 2, label: 'Q2 FY26' },
    { fiscal_year: 2026, quarter: 3, label: 'Q3 FY26' },
    { fiscal_year: 2026, quarter: 4, label: 'Q4 FY26' },
  ];

  rows: SizingRow[] = [];
  functions = ['Embedded Engineering', 'QA', 'DevOps', 'Software Engineering', 'Systems Engineering'];
  locations = ['US', 'India', 'China', 'Germany'];
  hcTypes = ['New - FTE', 'Existing - FTE', 'Contractor', 'Incremental'];

  get displayedColumns(): string[] {
    return ['function_contact', 'location', 'hc_type', ...this.quarters.map(q => q.label), 'actions'];
  }

  constructor(private route: ActivatedRoute, private router: Router) {}

  ngOnInit() {
    this.projectId = +this.route.snapshot.paramMap.get('projectId')!;
    const mockProjects: { [key: number]: string } = {
      1: 'ECARX SW Tools CCB', 2: 'Android EAP v1.3',
      3: 'Eris v2.0', 4: 'KRK1 New Features v1.0'
    };
    this.project.project_name = mockProjects[this.projectId] || 'Unknown Project';
    this.addRow();
  }

  addRow() {
    const newRow: SizingRow = { function_contact: '', location: '', hc_type: '', quarters: {} };
    this.quarters.forEach(q => newRow.quarters[q.label] = null);
    this.rows = [...this.rows, newRow];
  }

  addQuarter() {
    const last = this.quarters[this.quarters.length - 1];
    let nextQ = last.quarter + 1;
    let nextFY = last.fiscal_year;
    if (nextQ > 4) { nextQ = 1; nextFY++; }
    const label = `Q${nextQ} FY${String(nextFY).slice(-2)}`;
    this.quarters = [...this.quarters, { fiscal_year: nextFY, quarter: nextQ, label }];
    this.rows = this.rows.map(r => ({ ...r, quarters: { ...r.quarters, [label]: null } }));
  }

  removeRow(index: number) {
    this.rows = this.rows.filter((_, i) => i !== index);
  }

  goBack() { this.router.navigate(['/projects']); }

  saveDraft() {
    console.log('Draft:', { projectId: this.projectId, rows: this.rows });
    alert('Draft saved! (API integration pending)');
  }

  submit() {
    console.log('Submit:', { projectId: this.projectId, rows: this.rows });
    alert('Submitted! (API integration pending)');
  }
}