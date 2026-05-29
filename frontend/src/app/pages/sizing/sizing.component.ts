import { Component, OnInit, AfterViewInit, ChangeDetectorRef, ViewChild, ElementRef } from '@angular/core';
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
import { MatTabsModule } from '@angular/material/tabs';
import { MatChipsModule } from '@angular/material/chips';
import { CommonModule } from '@angular/common';
import { ApiService } from '../../services/api.service';

interface Quarter { fiscal_year: number; quarter: number; label: string; }
interface SizingRow {
  staging_id?: number;
  function_contact: string; location: string; hc_type: string;
  scope: string; assumptions: string; risks: string; notes: string;
  quarters: { [label: string]: number | null };
}
interface Milestone { name: string; color: string; quarterLabel: string | null; }

@Component({
  selector: 'app-sizing',
  standalone: true,
  imports: [
    FormsModule, CommonModule,
    MatTableModule, MatButtonModule, MatIconModule,
    MatInputModule, MatSelectModule, MatCardModule, MatDividerModule,
    MatSnackBarModule, MatProgressSpinnerModule, MatTabsModule, MatChipsModule
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
      <div class="loading-state"><mat-spinner diameter="40"></mat-spinner><p>Loading...</p></div>
    } @else {

      <mat-tab-group class="sizing-tabs" animationDuration="150ms">

        <!-- ===== TAB 1: HC ENTRY ===== -->
        <mat-tab label="Headcount Entry">
          <div class="tab-content">

            <!-- Live bar chart -->
            <div class="chart-panel">
              <div class="chart-header">
                <span class="chart-title"><mat-icon>bar_chart</mat-icon> HC by Quarter — Live Preview</span>
                <span class="chart-sub">Updates as you enter headcount</span>
              </div>
              <div class="bar-chart-wrapper">
                @for (q of quarters; track q.label) {
                  <div class="bar-col">
                    <div class="bar-outer">
                      <div class="bar-inner"
                        [style.height.%]="getBarPct(q.label)"
                        [class.bar-peak]="isPeakQuarter(q.label)">
                        @if (getTotalForQuarter(q.label) > 0) {
                          <span class="bar-val">{{ getTotalForQuarter(q.label) | number:'1.1-1' }}</span>
                        }
                      </div>
                    </div>
                    <span class="bar-label">{{ q.label }}</span>
                  </div>
                }
              </div>
            </div>

            <!-- Milestones row -->
            <div class="milestone-bar">
              <span class="milestone-bar-label">Milestones</span>
              <div class="milestone-chips">
                @for (ms of milestones; track ms.name) {
                  <div class="milestone-chip" [style.background]="ms.color + '22'" [style.border-color]="ms.color" [style.color]="ms.color"
                    (click)="openMilestoneEditor(ms)">
                    <span class="ms-name">{{ ms.name }}</span>
                    @if (ms.quarterLabel) {
                      <span class="ms-quarter">{{ ms.quarterLabel }}</span>
                    } @else {
                      <span class="ms-unset">+ Set</span>
                    }
                  </div>
                }
              </div>
            </div>

            <!-- Milestone editor popover -->
            @if (editingMilestone) {
              <div class="milestone-editor">
                <strong>Set quarter for {{ editingMilestone.name }}</strong>
                <select [(ngModel)]="editingMilestone.quarterLabel" class="ms-select">
                  <option [value]="null">-- Not set --</option>
                  @for (q of quarters; track q.label) {
                    <option [value]="q.label">{{ q.label }}</option>
                  }
                </select>
                <button mat-flat-button color="primary" (click)="editingMilestone = null" style="margin-left:8px">Done</button>
              </div>
            }

            <!-- HC Table -->
            <mat-card class="sizing-card">
              <div class="table-wrapper">
                <table mat-table [dataSource]="rows" class="sizing-table">

                  <ng-container matColumnDef="function_contact" sticky>
                    <th mat-header-cell *matHeaderCellDef>Function</th>
                    <td mat-cell *matCellDef="let row; let i = index">
                      <input list="fn-list-{{ i }}" [(ngModel)]="row.function_contact"
                        (ngModelChange)="onInputChange()"
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
                      <th mat-header-cell *matHeaderCellDef>
                        <div class="q-header">
                          <span>{{ q.label }}</span>
                          @if (getMilestoneForQuarter(q.label); as ms) {
                            <span class="q-milestone-dot" [style.background]="ms.color" [title]="ms.name">{{ ms.name.slice(0,3) }}</span>
                          }
                        </div>
                      </th>
                      <td mat-cell *matCellDef="let row">
                        <input type="number" [(ngModel)]="row.quarters[q.label]"
                          (ngModelChange)="onInputChange()"
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

              <!-- Table actions -->
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
                        <thead><tr><th></th><th>Q1</th><th>Q2</th><th>Q3</th><th>Q4</th></tr></thead>
                        <tbody>
                          @for (fy of fiscalYears; track fy) {
                            <tr>
                              <td class="fy-label">FY{{ String(fy).slice(-2) }}</td>
                              @for (q of [1,2,3,4]; track q) {
                                <td>
                                  <button class="q-btn"
                                    [class.q-range-start]="isRangeEdge(getQuarter(fy,q)!, 'start')"
                                    [class.q-range-end]="isRangeEdge(getQuarter(fy,q)!, 'end')"
                                    [class.q-in-range]="isInRange(getQuarter(fy,q)!)"
                                    (click)="onQuarterClick(getQuarter(fy,q)!)"
                                    (mouseenter)="hoverQuarter = getQuarter(fy,q)"
                                    (mouseleave)="hoverQuarter = null">
                                    Q{{ q }}
                                  </button>
                                </td>
                              }
                            </tr>
                          }
                        </tbody>
                      </table>

                      <div class="fy-controls">
                        <button mat-stroked-button (click)="addFiscalYear()">
                          <mat-icon>add</mat-icon> Add FY{{ String(maxFY + 1).slice(-2) }}
                        </button>
                      </div>

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
          </div>
        </mat-tab>

        <!-- ===== TAB 2: REQUIREMENTS (MPRS) ===== -->
        <mat-tab label="Requirements (MPRS)">
          <div class="tab-content tab-placeholder">
            <div class="placeholder-card">
              <mat-icon class="placeholder-icon">description</mat-icon>
              <h3>Requirement Slides (MPRS)</h3>
              <p>Embed or link the functional PM requirement slides here so they are accessible during sizing entry.</p>
              <div class="mprs-actions">
                <button mat-stroked-button>
                  <mat-icon>link</mat-icon> Paste SharePoint Link
                </button>
                <button mat-stroked-button>
                  <mat-icon>upload_file</mat-icon> Upload PDF
                </button>
                <button mat-stroked-button>
                  <mat-icon>open_in_new</mat-icon> Open in New Tab
                </button>
              </div>
              <div class="mprs-placeholder-frame">
                <mat-icon>picture_as_pdf</mat-icon>
                <span>MPRS document will appear here</span>
              </div>
            </div>
          </div>
        </mat-tab>

        <!-- ===== TAB 3: IMPORT ===== -->
        <mat-tab label="Import / Export">
          <div class="tab-content tab-placeholder">
            <div class="placeholder-card">
              <div class="import-sections">
                <div class="import-section">
                  <mat-icon class="section-icon">download</mat-icon>
                  <h4>Download Template</h4>
                  <p>Get the standard sizing template pre-formatted for this project.</p>
                  <div class="template-buttons">
                    <button mat-stroked-button>
                      <mat-icon>table_view</mat-icon> Download XLSX Template
                    </button>
                    <button mat-stroked-button>
                      <mat-icon>csv</mat-icon> Download CSV Template
                    </button>
                  </div>
                </div>

                <mat-divider [vertical]="true" class="section-divider"></mat-divider>

                <div class="import-section">
                  <mat-icon class="section-icon">upload</mat-icon>
                  <h4>Upload & Auto-fill</h4>
                  <p>Upload a completed template — data will be parsed and auto-filled into the Headcount Entry tab.</p>
                  <div class="upload-zone">
                    <mat-icon>cloud_upload</mat-icon>
                    <p>Drag & drop your file here or</p>
                    <button mat-flat-button color="primary">Browse Files</button>
                    <p class="file-hint">Supported: .xlsx, .csv</p>
                  </div>
                </div>

                <mat-divider [vertical]="true" class="section-divider"></mat-divider>

                <div class="import-section">
                  <mat-icon class="section-icon">open_in_new</mat-icon>
                  <h4>Export Current Draft</h4>
                  <p>Export the current draft data to Excel or CSV for offline review.</p>
                  <div class="template-buttons">
                    <button mat-stroked-button>
                      <mat-icon>table_view</mat-icon> Export to XLSX
                    </button>
                    <button mat-stroked-button>
                      <mat-icon>csv</mat-icon> Export to CSV
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </mat-tab>

      </mat-tab-group>
    }
  `,
  styles: [`
    .sizing-header { display: flex; align-items: center; gap: 8px; margin-bottom: 20px; }
    .sizing-header h2 { margin: 0; font-size: 22px; font-weight: 500; }
    .project-label { margin: 2px 0 0; color: #666; font-size: 14px; }
    .version-badge { margin-left: auto; background: #e3f2fd; color: #1565c0; padding: 4px 12px; border-radius: 12px; font-size: 12px; }
    .loading-state { display: flex; flex-direction: column; align-items: center; padding: 48px; color: #aaa; gap: 12px; }

    .sizing-tabs { background: transparent; }
    .tab-content { padding: 20px 0; }

    /* Live chart */
    .chart-panel { background: white; border: 1px solid #e0e0e0; border-radius: 10px; padding: 16px 20px; margin-bottom: 16px; }
    .chart-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
    .chart-title { display: flex; align-items: center; gap: 8px; font-weight: 600; font-size: 14px; color: #1a1a2e; }
    .chart-title mat-icon { color: #ED1C24; font-size: 18px; width: 18px; height: 18px; }
    .chart-sub { font-size: 12px; color: #999; }
    .bar-chart-wrapper { display: flex; align-items: flex-end; gap: 6px; height: 100px; padding-top: 8px; }
    .bar-col { display: flex; flex-direction: column; align-items: center; gap: 4px; flex: 1; min-width: 40px; }
    .bar-outer { width: 100%; height: 80px; background: #f5f5f5; border-radius: 4px 4px 0 0; display: flex; align-items: flex-end; overflow: hidden; }
    .bar-inner { width: 100%; background: #1a1a2e; border-radius: 4px 4px 0 0; transition: height 0.3s ease; min-height: 0; display: flex; align-items: flex-start; justify-content: center; }
    .bar-inner.bar-peak { background: #ED1C24; }
    .bar-val { font-size: 10px; color: white; font-weight: 700; padding-top: 3px; }
    .bar-label { font-size: 10px; color: #888; text-align: center; white-space: nowrap; }

    /* Milestones */
    .milestone-bar { background: white; border: 1px solid #e0e0e0; border-radius: 10px; padding: 12px 16px; margin-bottom: 16px; display: flex; align-items: center; gap: 12px; }
    .milestone-bar-label { font-size: 11px; font-weight: 700; color: #999; text-transform: uppercase; letter-spacing: 0.5px; white-space: nowrap; }
    .milestone-chips { display: flex; flex-wrap: wrap; gap: 8px; }
    .milestone-chip { display: flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 16px; border: 1.5px solid; font-size: 12px; cursor: pointer; transition: opacity 0.15s; }
    .milestone-chip:hover { opacity: 0.8; }
    .ms-name { font-weight: 600; }
    .ms-quarter { font-size: 10px; background: rgba(0,0,0,0.1); padding: 1px 5px; border-radius: 8px; }
    .ms-unset { font-size: 10px; opacity: 0.6; }

    .milestone-editor { background: white; border: 1px solid #ddd; border-radius: 8px; padding: 12px 16px; margin-bottom: 12px; display: flex; align-items: center; gap: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
    .ms-select { padding: 6px 10px; border: 1px solid #ddd; border-radius: 4px; font-size: 13px; }

    /* Quarter header milestone dot */
    .q-header { display: flex; flex-direction: column; align-items: center; gap: 2px; }
    .q-milestone-dot { font-size: 9px; padding: 1px 4px; border-radius: 6px; color: white; font-weight: 700; }

    /* Table */
    .sizing-card { margin-bottom: 0; }
    .table-wrapper { overflow-x: auto; }
    .sizing-table { width: 100%; min-width: 1000px; }
    .cell-select { width: 130px; font-size: 13px; }
    .text-input { width: 130px; border: 1px solid #ddd; border-radius: 4px; padding: 4px 8px; font-size: 13px; font-family: inherit; }
    .text-input:focus { outline: none; border-color: #1976d2; }
    .fn-input { width: 160px; }
    .quarter-input { width: 58px; border: 1px solid #ddd; border-radius: 4px; padding: 4px 6px; font-size: 13px; text-align: center; }
    .quarter-input:focus { outline: none; border-color: #ED1C24; }

    .table-actions { display: flex; gap: 12px; padding: 12px 16px; align-items: flex-start; }
    .form-actions { display: flex; gap: 12px; justify-content: flex-end; padding: 12px 16px; }

    /* Quarter picker */
    .quarter-picker-wrapper { position: relative; }
    .quarter-picker-panel { position: absolute; top: 44px; left: 0; z-index: 200; background: white; border: 1px solid #ddd; border-radius: 8px; padding: 16px; box-shadow: 0 4px 20px rgba(0,0,0,0.15); min-width: 300px; }
    .picker-title { margin: 0 0 12px; font-size: 13px; color: #555; min-height: 20px; }
    .fy-table { border-collapse: collapse; width: 100%; }
    .fy-table th { font-size: 12px; color: #999; padding: 4px 8px; text-align: center; }
    .fy-label { font-size: 12px; font-weight: 600; color: #555; padding-right: 8px; }
    .fy-table td { padding: 3px; }
    .fy-controls { margin-top: 8px; }
    .q-btn { width: 48px; height: 36px; border: none; border-radius: 4px; cursor: pointer; font-size: 13px; background: #f5f5f5; color: #333; transition: background 0.1s; }
    .q-btn:hover { background: #e3f2fd; color: #1565c0; }
    .q-in-range { background: #bbdefb !important; color: #1565c0 !important; border-radius: 0; }
    .q-range-start { background: #1976d2 !important; color: white !important; border-radius: 4px 0 0 4px; }
    .q-range-end { background: #1976d2 !important; color: white !important; border-radius: 0 4px 4px 0; }
    .picker-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 12px; }

    /* Tabs 2 & 3 */
    .tab-placeholder { padding: 20px 0; }
    .placeholder-card { background: white; border: 1px solid #e0e0e0; border-radius: 10px; padding: 32px; }
    .placeholder-icon { font-size: 48px; width: 48px; height: 48px; color: #ED1C24; display: block; margin: 0 auto 16px; }
    .placeholder-card h3 { text-align: center; margin: 0 0 8px; font-size: 18px; }
    .placeholder-card > p { text-align: center; color: #666; margin: 0 0 24px; }
    .mprs-actions { display: flex; justify-content: center; gap: 12px; margin-bottom: 24px; }
    .mprs-placeholder-frame { border: 2px dashed #ddd; border-radius: 8px; padding: 48px; text-align: center; color: #bbb; display: flex; flex-direction: column; align-items: center; gap: 12px; }
    .mprs-placeholder-frame mat-icon { font-size: 48px; width: 48px; height: 48px; }

    .import-sections { display: flex; gap: 32px; align-items: flex-start; }
    .import-section { flex: 1; display: flex; flex-direction: column; gap: 12px; }
    .section-icon { font-size: 32px; width: 32px; height: 32px; color: #ED1C24; }
    .import-section h4 { margin: 0; font-size: 16px; font-weight: 600; }
    .import-section p { margin: 0; color: #666; font-size: 13px; }
    .template-buttons { display: flex; flex-direction: column; gap: 8px; }
    .section-divider { height: auto; align-self: stretch; }
    .upload-zone { border: 2px dashed #ddd; border-radius: 8px; padding: 32px 16px; text-align: center; display: flex; flex-direction: column; align-items: center; gap: 8px; }
    .upload-zone mat-icon { font-size: 40px; width: 40px; height: 40px; color: #bbb; }
    .upload-zone p { margin: 0; color: #666; font-size: 13px; }
    .file-hint { color: #bbb !important; font-size: 11px !important; }
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
  maxFY = 2029;

  functionSuggestions: string[] = [];
  rows: SizingRow[] = [];
  editingMilestone: Milestone | null = null;

  locations = ['Canada', 'US', 'India Bangalore', 'India Hyderabad', 'China Shanghai', 'Germany', 'Mexico', 'Korea'];
  hcTypes = ['Existing - FTE', 'Existing - AOP', 'Incremental - XCHG', 'Incremental - CONT'];

  milestones: Milestone[] = [
    { name: 'Concept',       color: '#9c27b0', quarterLabel: null },
    { name: 'Feasibility',   color: '#3f51b5', quarterLabel: null },
    { name: 'BTO',           color: '#03a9f4', quarterLabel: null },
    { name: 'Asic Back',     color: '#009688', quarterLabel: null },
    { name: 'Bring Up Exit', color: '#4caf50', quarterLabel: null },
    { name: 'AFEr',          color: '#8bc34a', quarterLabel: null },
    { name: 'AFEd',          color: '#ffeb3b', quarterLabel: null },
    { name: 'AFOr',          color: '#ff9800', quarterLabel: null },
    { name: 'AFOd',          color: '#ff5722', quarterLabel: null },
    { name: 'GA',            color: '#ED1C24', quarterLabel: null },
  ];

  String = String;

  get displayedColumns(): string[] {
    return ['function_contact', 'location', 'hc_type', 'scope', 'assumptions', 'risks', 'notes',
            ...this.quarters.map(q => q.label), 'actions'];
  }

  get fiscalYears(): number[] {
    const years = new Set(this.availableQuarters.map(q => q.fiscal_year));
    return [...years].sort();
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

    this.api.getFunctions().subscribe({ next: (res: any) => { this.functionSuggestions = res.data; }, error: () => {} });
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
    for (let fy = currentYear; fy <= this.maxFY; fy++) {
      for (let q = 1; q <= 4; q++) {
        if (fy === currentYear && q < currentQuarter) continue;
        this.availableQuarters.push({ fiscal_year: fy, quarter: q, label: `Q${q} FY${String(fy).slice(-2)}` });
      }
    }
  }

  addFiscalYear() {
    this.maxFY++;
    const newFY = this.maxFY;
    for (let q = 1; q <= 4; q++) {
      this.availableQuarters.push({ fiscal_year: newFY, quarter: q, label: `Q${q} FY${String(newFY).slice(-2)}` });
    }
  }

  setDefaultQuarters() {
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
    if (!q) return;
    if (!this.rangeStart || (this.rangeStart && this.rangeEnd)) {
      this.rangeStart = q; this.rangeEnd = null;
    } else {
      if (this.quarterIndex(q) < this.quarterIndex(this.rangeStart)) {
        this.rangeEnd = this.rangeStart; this.rangeStart = q;
      } else { this.rangeEnd = q; }
    }
  }

  isInRange(q: Quarter): boolean {
    if (!q) return false;
    const end = this.rangeEnd || this.hoverQuarter;
    if (!this.rangeStart || !end) return false;
    const lo = Math.min(this.quarterIndex(this.rangeStart), this.quarterIndex(end));
    const hi = Math.max(this.quarterIndex(this.rangeStart), this.quarterIndex(end));
    const idx = this.quarterIndex(q);
    return idx > lo && idx < hi;
  }

  isRangeEdge(q: Quarter, edge: 'start' | 'end'): boolean {
    if (!q || !this.rangeStart) return false;
    const end = this.rangeEnd || this.hoverQuarter;
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
    const newQuarters = this.availableQuarters.filter(q => { const idx = this.quarterIndex(q); return idx >= lo && idx <= hi; });
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
    this.rangeStart = null; this.rangeEnd = null;
  }

  // Live chart helpers
  getTotalForQuarter(label: string): number {
    return this.rows.reduce((sum, row) => sum + (Number(row.quarters[label]) || 0), 0);
  }

  getMaxTotal(): number {
    return Math.max(...this.quarters.map(q => this.getTotalForQuarter(q.label)), 0.01);
  }

  getBarPct(label: string): number {
    const max = this.getMaxTotal();
    return max === 0 ? 0 : (this.getTotalForQuarter(label) / max) * 100;
  }

  isPeakQuarter(label: string): boolean {
    const max = this.getMaxTotal();
    return max > 0 && this.getTotalForQuarter(label) === max;
  }

  onInputChange() { this.cdr.detectChanges(); }

  // Milestones
  openMilestoneEditor(ms: Milestone) {
    this.editingMilestone = this.editingMilestone?.name === ms.name ? null : ms;
  }

  getMilestoneForQuarter(quarterLabel: string): Milestone | null {
    return this.milestones.find(m => m.quarterLabel === quarterLabel) || null;
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

  removeRow(i: number) { this.rows = this.rows.filter((_, idx) => idx !== i); this.cdr.detectChanges(); }
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
      this.snackBar.open('Draft saved successfully', 'Close', { duration: 3000, horizontalPosition: 'end', verticalPosition: 'top' });
    } catch {
      this.snackBar.open('Failed to save draft — check backend connection', 'Close', { duration: 5000, horizontalPosition: 'end', verticalPosition: 'top', panelClass: ['snack-error'] });
    } finally { this.saving = false; }
  }

  async submit() {
    if (this.rows.some(r => !r.function_contact || !r.location || !r.hc_type)) {
      this.snackBar.open('Fill in Function, Location, and HC Type for all rows before submitting', 'Close', {
        duration: 5000, horizontalPosition: 'end', verticalPosition: 'top', panelClass: ['snack-warn']
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
      this.snackBar.open('Sizing submitted successfully!', 'Close', { duration: 3000, horizontalPosition: 'end', verticalPosition: 'top' });
      setTimeout(() => this.router.navigate(['/projects']), 1500);
    } catch {
      this.snackBar.open('Failed to submit — check backend connection', 'Close', { duration: 5000, horizontalPosition: 'end', verticalPosition: 'top', panelClass: ['snack-error'] });
    } finally { this.saving = false; }
  }
}
