import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatTableModule } from '@angular/material/table';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatCardModule } from '@angular/material/card';
import { MatDividerModule } from '@angular/material/divider';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ApiService } from '../../services/api.service';

interface Quarter { fiscal_year: number; quarter: number; label: string; }
interface SizingRow {
  staging_id?: number;
  function_contact: string; location: string; hc_type: string;
  scope: string; assumptions: string; risks: string; notes: string;
  quarters: { [label: string]: number | null };
}

@Component({
  selector: 'app-sizing',
  standalone: true,
  imports: [
    FormsModule, MatTableModule, MatButtonModule, MatIconModule,
    MatInputModule, MatSelectModule, MatCardModule, MatDividerModule,
    MatSnackBarModule, MatProgressSpinnerModule
  ],
  template: `
    <div class="sizing-header">
      <button mat-icon-button (click)="goBack()"><mat-icon>arrow_back</mat-icon></button>
      <div>
        <h2>Enter Sizing</h2>
        <p class="project-label">{{ project.project_name }}</p>
      </div>
      @if (versionId) {
        <span class="version-badge">Draft #{{ versionId }}</span>
      }
    </div>

    @if (loading) {
      <div class="loading-state">
        <mat-spinner diameter="40"></mat-spinner>
        <p>Loading project...</p>
      </div>
    } @else {
      <mat-card class="sizing-card">
        <div class="table-wrapper">
          <table mat-table [dataSource]="rows" class="sizing-table">

            <ng-container matColumnDef="function_contact" sticky>
              <th mat-header-cell *matHeaderCellDef>Function</th>
              <td mat-cell *matCellDef="let row; let i = index">
                <input list="fn-list-{{ i }}" [(ngModel)]="row.function_contact"
                  (blur)="onFunctionBlur(row)" class="text-input fn-input" placeholder="Type or select...">
                <datalist id="fn-list-{{ i }}">
                  @for (s of functionSuggestions; track s) { <option [value]="s"></option> }
                </datalist>
              </td>
            </ng-container>

            <ng-container matColumnDef="location">
              <th mat-header-cell *matHeaderCellDef>Location</th>
              <td mat-cell *matCellDef="let row">
                <mat-select [(ngModel)]="row.location" class="cell-select" placeholder="Select">
                  @for (l of locations; track l) { <mat-option [value]="l">{{ l }}</mat-option> }
                </mat-select>
              </td>
            </ng-container>

            <ng-container matColumnDef="hc_type">
              <th mat-header-cell *matHeaderCellDef>HC Type</th>
              <td mat-cell *matCellDef="let row">
                <mat-select [(ngModel)]="row.hc_type" class="cell-select" placeholder="Select">
                  @for (h of hcTypes; track h) { <mat-option [value]="h">{{ h }}</mat-option> }
                </mat-select>
              </td>
            </ng-container>

            <ng-container matColumnDef="scope">
              <th mat-header-cell *matHeaderCellDef>Scope</th>
              <td mat-cell *matCellDef="let row">
                <input [(ngModel)]="row.scope" class="text-input" placeholder="Scope...">
              </td>
            </ng-container>

            <ng-container matColumnDef="assumptions">
              <th mat-header-cell *matHeaderCellDef>Assumptions</th>
              <td mat-cell *matCellDef="let row">
                <input [(ngModel)]="row.assumptions" class="text-input" placeholder="Assumptions...">
              </td>
            </ng-container>

            <ng-container matColumnDef="risks">
              <th mat-header-cell *matHeaderCellDef>Risks</th>
              <td mat-cell *matCellDef="let row">
                <input [(ngModel)]="row.risks" class="text-input" placeholder="Risks...">
              </td>
            </ng-container>

            <ng-container matColumnDef="notes">
              <th mat-header-cell *matHeaderCellDef>Notes</th>
              <td mat-cell *matCellDef="let row">
                <input [(ngModel)]="row.notes" class="text-input" placeholder="Notes...">
              </td>
            </ng-container>

            @for (q of quarters; track q.label) {
              <ng-container [matColumnDef]="q.label">
                <th mat-header-cell *matHeaderCellDef>{{ q.label }}</th>
                <td mat-cell *matCellDef="let row">
                  <input type="number" [(ngModel)]="row.quarters[q.label]"
                    class="quarter-input" min="0" step="0.5" placeholder="0">
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
            <mat-icon>add</mat-icon> Add Row
          </button>

          <div class="quarter-picker-wrapper">
            <button mat-stroked-button (click)="toggleQuarterPicker()">
              <mat-icon>date_range</mat-icon> Manage Quarters ({{ quarters.length }})
            </button>

            @if (showQuarterPicker) {
              <div class="quarter-picker-panel">
                <p class="picker-title">
                  @if (!rangeStart) { Click a start quarter }
                  @else if (!rangeEnd) { Now click the end quarter }
                  @else { {{ rangeStart.label }} → {{ rangeEnd.label }} &nbsp;·&nbsp; {{ selectedRangeCount }} quarters }
                </p>

                <table class="fy-table">
                  <thead>
                    <tr>
                      <th></th>
                      <th>Q1</th><th>Q2</th><th>Q3</th><th>Q4</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (fy of fiscalYears; track fy) {
                      <tr>
                        <td class="fy-label">FY{{ String(fy).slice(-2) }}</td>
                        @for (q of [1,2,3,4]; track q) {
                          @if (getQuarter(fy, q); as quarter) {
                            <td>
                              <button class="q-btn"
                                [class.q-range-start]="isRangeEdge(quarter, 'start')"
                                [class.q-range-end]="isRangeEdge(quarter, 'end')"
                                [class.q-in-range]="isInRange(quarter)"
                                (click)="onQuarterClick(quarter)"
                                (mouseenter)="hoverQuarter = quarter"
                                (mouseleave)="hoverQuarter = null">
                                Q{{ q }}
                              </button>
                            </td>
                          } @else {
                            <td><button class="q-btn q-past" disabled>Q{{ q }}</button></td>
                          }
                        }
                      </tr>
                    }
                  </tbody>
                </table>

                <div class="picker-actions">
                  <button mat-stroked-button (click)="clearRange()">Clear</button>
                  <button mat-stroked-button (click)="showQuarterPicker = false">Cancel</button>
                  @if (rangeStart && rangeEnd) {
                    <button mat-flat-button color="primary" (click)="applyQuarters()">Apply</button>
                  }
                </div>
              </div>
            }
          </div>
        </div>

        <mat-divider></mat-divider>

        <div class="form-actions">
          <button mat-stroked-button (click)="goBack()">Cancel</button>
          <button mat-stroked-button color="primary" (click)="saveDraft()" [disabled]="saving">
            {{ saving ? 'Saving...' : 'Save Draft' }}
          </button>
          <button mat-flat-button color="primary" (click)="submit()" [disabled]="saving">Submit</button>
        </div>
      </mat-card>
    }
  `,
  styles: [`
    .sizing-header { display: flex; align-items: center; gap: 8px; margin-bottom: 20px; }
    .sizing-header h2 { margin: 0; font-size: 22px; font-weight: 500; }
    .project-label { margin: 2px 0 0 0; color: #666; font-size: 14px; }
    .version-badge { margin-left: auto; background: #e3f2fd; color: #1565c0; padding: 4px 12px; border-radius: 12px; font-size: 12px; }
    .loading-state { display: flex; flex-direction: column; align-items: center; padding: 48px; color: #aaa; gap: 12px; }
    .table-wrapper { overflow-x: auto; }
    .sizing-table { width: 100%; min-width: 1200px; }
    .cell-select { width: 130px; font-size: 13px; }
    .text-input { width: 140px; border: 1px solid #ddd; border-radius: 4px; padding: 4px 8px; font-size: 13px; font-family: inherit; }
    .text-input:focus { outline: none; border-color: #1976d2; }
    .fn-input { width: 170px; }
    .quarter-input { width: 64px; border: 1px solid #ddd; border-radius: 4px; padding: 4px 6px; font-size: 13px; text-align: center; }
    .quarter-input:focus { outline: none; border-color: #1976d2; }
    .table-actions { display: flex; gap: 12px; padding: 12px 16px; align-items: flex-start; }
    .form-actions { display: flex; gap: 12px; justify-content: flex-end; padding: 12px 16px; }

    .quarter-picker-wrapper { position: relative; }
    .quarter-picker-panel {
      position: absolute; top: 44px; left: 0; z-index: 200;
      background: white; border: 1px solid #ddd; border-radius: 8px;
      padding: 16px; box-shadow: 0 4px 20px rgba(0,0,0,0.15); min-width: 300px;
    }
    .picker-title { margin: 0 0 12px 0; font-size: 13px; color: #555; min-height: 20px; }
    .fy-table { border-collapse: collapse; width: 100%; }
    .fy-table th { font-size: 12px; color: #999; padding: 4px 8px; text-align: center; }
    .fy-label { font-size: 12px; font-weight: 600; color: #555; padding-right: 8px; }
    .fy-table td { padding: 3px; }

    .q-btn {
      width: 48px; height: 36px; border: none; border-radius: 4px;
      cursor: pointer; font-size: 13px; background: #f5f5f5; color: #333;
      transition: background 0.1s;
    }
    .q-btn:hover:not(:disabled) { background: #e3f2fd; color: #1565c0; }
    .q-in-range { background: #bbdefb !important; color: #1565c0 !important; border-radius: 0; }
    .q-range-start { background: #1976d2 !important; color: white !important; border-radius: 4px 0 0 4px; }
    .q-range-end { background: #1976d2 !important; color: white !important; border-radius: 0 4px 4px 0; }
    .q-past { background: #fafafa !important; color: #ccc !important; cursor: not-allowed; }

    .picker-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 12px; }
  `]
})
export class SizingComponent implements OnInit {
  projectId!: number;
  versionId: number | null = null;
  project: any = { project_name: 'Loading...' };
  loading = true;
  saving = false;

  quarters: Quarter[] = [];
  availableQuarters: Quarter[] = [];
  showQuarterPicker = false;
  rangeStart: Quarter | null = null;
  rangeEnd: Quarter | null = null;
  hoverQuarter: Quarter | null = null;

  functionSuggestions: string[] = [];
  rows: SizingRow[] = [];
  locations = ['US', 'India', 'China', 'Germany', 'Mexico', 'Korea'];
  hcTypes = ['New - FTE', 'Existing - FTE', 'Contractor', 'Incremental'];

  // Expose String to template
  String = String;

  get displayedColumns(): string[] {
    return ['function_contact', 'location', 'hc_type', 'scope', 'assumptions', 'risks', 'notes',
            ...this.quarters.map(q => q.label), 'actions'];
  }

  get fiscalYears(): number[] {
    return [...new Set(this.availableQuarters.map(q => q.fiscal_year))];
  }

  get selectedRangeCount(): number {
    if (!this.rangeStart || !this.rangeEnd) return 0;
    return Math.abs(this.quarterIndex(this.rangeEnd) - this.quarterIndex(this.rangeStart)) + 1;
  }

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private api: ApiService,
    private snackBar: MatSnackBar,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit() {
    this.projectId = +this.route.snapshot.paramMap.get('projectId')!;
    this.generateAvailableQuarters();
    this.setDefaultQuarters();

    this.api.getFunctions().subscribe({
      next: (res: any) => { this.functionSuggestions = res.data; },
      error: () => {}
    });

    this.api.getProject(this.projectId).subscribe({
      next: (res: any) => { this.project = res.data; this.loadDraft(); },
      error: () => { this.project = { project_name: 'Unknown Project' }; this.finishLoading(); }
    });
  }

  generateAvailableQuarters() {
    const today = new Date();
    const currentYear = today.getFullYear();
    const currentQuarter = Math.ceil((today.getMonth() + 1) / 3);
    this.availableQuarters = [];
    for (let fy = currentYear; fy <= currentYear + 3; fy++) {
      for (let q = 1; q <= 4; q++) {
        if (fy === currentYear && q < currentQuarter) continue;
        this.availableQuarters.push({ fiscal_year: fy, quarter: q, label: `Q${q} FY${String(fy).slice(-2)}` });
      }
    }
  }

  setDefaultQuarters() {
    // Default: all quarters in the current fiscal year from now
    const today = new Date();
    const currentYear = today.getFullYear();
    this.quarters = this.availableQuarters.filter(q => q.fiscal_year === currentYear);
  }

  quarterIndex(q: Quarter): number {
    return (q.fiscal_year - 2026) * 4 + (q.quarter - 1);
  }

  getQuarter(fy: number, q: number): Quarter | null {
    return this.availableQuarters.find(aq => aq.fiscal_year === fy && aq.quarter === q) || null;
  }

  onQuarterClick(q: Quarter) {
    if (!this.rangeStart || (this.rangeStart && this.rangeEnd)) {
      this.rangeStart = q;
      this.rangeEnd = null;
    } else {
      if (this.quarterIndex(q) < this.quarterIndex(this.rangeStart)) {
        this.rangeEnd = this.rangeStart;
        this.rangeStart = q;
      } else {
        this.rangeEnd = q;
      }
    }
  }

  isInRange(q: Quarter): boolean {
    const end = this.rangeEnd || this.hoverQuarter;
    if (!this.rangeStart || !end) return false;
    const lo = Math.min(this.quarterIndex(this.rangeStart), this.quarterIndex(end));
    const hi = Math.max(this.quarterIndex(this.rangeStart), this.quarterIndex(end));
    const idx = this.quarterIndex(q);
    return idx > lo && idx < hi;
  }

  isRangeEdge(q: Quarter, edge: 'start' | 'end'): boolean {
    const end = this.rangeEnd || this.hoverQuarter;
    if (!this.rangeStart) return false;
    if (!end) return edge === 'start' && q.label === this.rangeStart.label;
    const lo = Math.min(this.quarterIndex(this.rangeStart), this.quarterIndex(end));
    const hi = Math.max(this.quarterIndex(this.rangeStart), this.quarterIndex(end));
    return edge === 'start' ? this.quarterIndex(q) === lo : this.quarterIndex(q) === hi;
  }

  clearRange() { this.rangeStart = null; this.rangeEnd = null; }

  toggleQuarterPicker() {
    this.showQuarterPicker = !this.showQuarterPicker;
    if (this.showQuarterPicker) { this.rangeStart = null; this.rangeEnd = null; }
  }

  applyQuarters() {
    if (!this.rangeStart || !this.rangeEnd) return;
    const lo = Math.min(this.quarterIndex(this.rangeStart), this.quarterIndex(this.rangeEnd));
    const hi = Math.max(this.quarterIndex(this.rangeStart), this.quarterIndex(this.rangeEnd));
    const newQuarters = this.availableQuarters.filter(q => {
      const idx = this.quarterIndex(q); return idx >= lo && idx <= hi;
    });

    newQuarters.forEach(q => {
      if (!this.quarters.find(e => e.label === q.label))
        this.rows = this.rows.map(r => ({ ...r, quarters: { ...r.quarters, [q.label]: null } }));
    });
    this.quarters.forEach(q => {
      if (!newQuarters.find(n => n.label === q.label))
        this.rows = this.rows.map(r => { const qs = { ...r.quarters }; delete qs[q.label]; return { ...r, quarters: qs }; });
    });

    this.quarters = newQuarters;
    this.showQuarterPicker = false;
    this.rangeStart = null;
    this.rangeEnd = null;
  }

  loadDraft() {
    this.api.getProjectDraft(this.projectId).subscribe({
      next: (res: any) => {
        if (res.data?.version_id) {
          this.versionId = res.data.version_id;
          this.api.getVersion(this.versionId!).subscribe({
            next: (vRes: any) => {
              const savedRows: SizingRow[] = vRes.data.rows;
              if (savedRows.length > 0) {
                const labels = new Set<string>();
                savedRows.forEach(r => Object.keys(r.quarters).forEach(l => labels.add(l)));
                this.quarters = this.availableQuarters
                  .filter(q => labels.has(q.label))
                  .sort((a, b) => a.fiscal_year !== b.fiscal_year ? a.fiscal_year - b.fiscal_year : a.quarter - b.quarter);
                this.rows = savedRows;
              }
              this.finishLoading();
            },
            error: () => this.finishLoading()
          });
        } else { this.finishLoading(); }
      },
      error: () => this.finishLoading()
    });
  }

  finishLoading() {
    if (this.rows.length === 0) this.addRow();
    this.loading = false;
    this.cdr.detectChanges();
  }

  addRow() {
    const row: SizingRow = { function_contact: '', location: '', hc_type: '', scope: '', assumptions: '', risks: '', notes: '', quarters: {} };
    this.quarters.forEach(q => row.quarters[q.label] = null);
    this.rows = [...this.rows, row];
  }

  removeRow(i: number) { this.rows = this.rows.filter((_, idx) => idx !== i); }
  goBack() { this.router.navigate(['/projects']); }

  onFunctionBlur(row: SizingRow) {
    const fn = row.function_contact?.trim();
    if (fn && !this.functionSuggestions.includes(fn)) {
      this.functionSuggestions = [...this.functionSuggestions, fn].sort();
      this.api.saveFunction(fn).subscribe({ error: () => {} });
    }
  }

  async saveDraft() {
    this.saving = true;
    try {
      if (!this.versionId) {
        const res: any = await this.api.createVersion(this.projectId).toPromise();
        this.versionId = res.data.version_id;
      }
      await this.api.saveVersionRows(this.versionId!, { rows: this.rows, quarters: this.quarters }).toPromise();
      this.snackBar.open('Draft saved', 'Close', { duration: 3000, horizontalPosition: 'end', verticalPosition: 'top' });
    } catch {
      this.snackBar.open('Failed to save draft', 'Close', { duration: 3000, horizontalPosition: 'end', verticalPosition: 'top' });
    } finally { this.saving = false; }
  }

  async submit() {
    if (this.rows.some(r => !r.function_contact || !r.location || !r.hc_type)) {
      this.snackBar.open('Fill in Function, Location, and HC Type for all rows', 'Close', {
        duration: 4000, horizontalPosition: 'end', verticalPosition: 'top'
      });
      return;
    }
    this.saving = true;
    try {
      if (!this.versionId) {
        const res: any = await this.api.createVersion(this.projectId).toPromise();
        this.versionId = res.data.version_id;
      }
      await this.api.saveVersionRows(this.versionId!, { rows: this.rows, quarters: this.quarters }).toPromise();
      await this.api.submitVersion(this.versionId!).toPromise();
      this.snackBar.open('Submitted successfully', 'Close', { duration: 3000, horizontalPosition: 'end', verticalPosition: 'top' });
      setTimeout(() => this.router.navigate(['/projects']), 1500);
    } catch {
      this.snackBar.open('Failed to submit', 'Close', { duration: 3000, horizontalPosition: 'end', verticalPosition: 'top' });
    } finally { this.saving = false; }
  }
}