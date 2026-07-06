import { Component, OnInit, AfterViewInit, ChangeDetectorRef, ViewChild, ElementRef } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
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
import { CommonModule, DatePipe } from '@angular/common';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ApiService } from '../../services/api.service';

interface Quarter { fiscal_year: number; quarter: number; label: string; }
interface SizingRow {
  staging_id?: number;
  function_contact: string; location: string; hc_type: string; manager_name: string;
  scope: string; assumptions: string; risks: string; notes: string;
  quarters: { [label: string]: number | null };
}
interface Milestone { 
  name: string; 
  color: string; 
  quarterLabels: string[]; 
  startDate: string | null; 
  endDate: string | null; 
}

@Component({
  selector: 'app-sizing',
  standalone: true,
  imports: [
    FormsModule, CommonModule,
    MatTableModule, MatButtonModule, MatIconModule,
    MatInputModule, MatSelectModule, MatCardModule, MatDividerModule,
    MatSnackBarModule, MatProgressSpinnerModule, MatTabsModule, MatChipsModule, DatePipe, MatTooltipModule
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
      @if (unsavedChangeCount > 0) {
        <span class="unsaved-badge" matTooltip="These rows have changes not yet submitted">
          {{ unsavedChangeCount }} unsaved change{{ unsavedChangeCount > 1 ? 's' : '' }}
        </span>
      }
    </div>

    <!-- Scope notes — version-level summary -->
    <div class="scope-notes-bar">
      <textarea class="scope-notes-input" [(ngModel)]="scopeNotes"
        placeholder="Add version scope notes (e.g. assumptions, constraints, context for this submission)..."
        (blur)="saveScopeNotes()"
        rows="2"></textarea>
    </div>

    @if (loading) {
      <div class="loading-state"><mat-spinner diameter="40"></mat-spinner><p>Loading...</p></div>
    } @else {

      <mat-tab-group class="sizing-tabs" animationDuration="150ms">

        <!-- ===== TAB 1: HC ENTRY ===== -->
        <mat-tab label="Headcount Entry">
          <div class="tab-content">

            <!-- Milestones row -->
            <div class="milestone-bar">
              <span class="milestone-bar-label">Milestones</span>
              <div class="milestone-chips">
                @for (ms of milestones; track ms.name) {
                  <div class="milestone-chip" [style.background]="ms.color + '22'" [style.border-color]="ms.color" [style.color]="ms.color">
                    <span class="ms-name" (click)="openMilestoneEditor(ms)">{{ ms.name }}</span>
                    @if (ms.startDate) {
                      <span class="ms-quarter" (click)="openMilestoneEditor(ms)">
                        {{ ms.startDate | date:'MMM d' }}@if (ms.endDate) { → {{ ms.endDate | date:'MMM d' }} }
                      </span>
                      <span class="ms-clear" (click)="clearMilestoneDates(ms)">×</span>
                    } @else {
                      <span class="ms-unset" (click)="openMilestoneEditor(ms)">+ Set</span>
                    }
                  </div>
                }
              </div>
            </div>

            <!-- Milestone calendar picker (Airbnb style) -->
            @if (editingMilestone) {
              <div class="ms-picker-panel">
                <div class="ms-picker-header">
                  <span class="ms-dot" [style.background]="editingMilestone.color"></span>
                  <strong>{{ editingMilestone.name }}</strong>
                  <span class="ms-picker-hint">
                    @if (!editingMilestone.startDate) { Click a start date }
                    @else if (!editingMilestone.endDate) { Click an end date (or skip) }
                    @else {
                      <span [style.color]="editingMilestone.color">
                        {{ editingMilestone.startDate | date:'MMM d, yyyy' }} → {{ editingMilestone.endDate | date:'MMM d, yyyy' }}
                        &nbsp;·&nbsp; {{ deriveQuarter(editingMilestone.startDate) }}
                        @if (deriveQuarter(editingMilestone.endDate) !== deriveQuarter(editingMilestone.startDate)) {
                          → {{ deriveQuarter(editingMilestone.endDate) }}
                        }
                      </span>
                    }
                  </span>
                </div>

                <!-- Two-month calendar -->
                <div class="cal-container">
                  @for (offset of [0, 1]; track offset) {
                    <div class="cal-month">
                      <div class="cal-month-header">
                        @if (offset === 0) {
                          <button class="cal-nav" (click)="calPrev()">‹</button>
                        } @else {
                          <span></span>
                        }
                        <span class="cal-month-label">{{ getCalMonthLabel(offset) }}</span>
                        @if (offset === 1) {
                          <button class="cal-nav" (click)="calNext()">›</button>
                        } @else {
                          <span></span>
                        }
                      </div>
                      <div class="cal-grid">
                        @for (d of ['Su','Mo','Tu','We','Th','Fr','Sa']; track d) {
                          <div class="cal-dow">{{ d }}</div>
                        }
                        @for (day of getCalDays(offset); track day.key) {
                          <div class="cal-day"
                            [class.cal-empty]="!day.date"
                            [class.cal-start]="day.date && isCalStart(day.date, editingMilestone)"
                            [class.cal-end]="day.date && isCalEnd(day.date, editingMilestone)"
                            [class.cal-in-range]="day.date && isCalInRange(day.date, editingMilestone)"
                            [class.cal-hover-range]="day.date && isCalHoverRange(day.date, editingMilestone)"
                            [class.cal-today]="day.date && isToday(day.date)"
                            [style.--ms-color]="editingMilestone.color"
                            (click)="day.date && onCalDayClick(day.date, editingMilestone)"
                            (mouseenter)="day.date && (calHoverDate = day.date)"
                            (mouseleave)="calHoverDate = null">
                            {{ day.date ? day.date.getDate() : '' }}
                          </div>
                        }
                      </div>
                    </div>
                  }
                </div>

                <div class="picker-actions">
                  <button mat-stroked-button (click)="clearMilestoneDates(editingMilestone)">Clear</button>
                  <button mat-stroked-button (click)="editingMilestone = null">Cancel</button>
                  <button mat-flat-button color="primary" (click)="applyMilestoneDates(editingMilestone)"
                    [disabled]="!editingMilestone.startDate">Apply</button>
                </div>
              </div>
            }

            <!-- Filter bar -->
            <div class="sizing-filter-bar">
              <mat-form-field appearance="outline" class="sf-field">
                <mat-label>Manager</mat-label>
                <mat-select multiple [(ngModel)]="filterManagers" (ngModelChange)="applyRowFilters()">
                  @for (m of managerOptions; track m) { <mat-option [value]="m">{{ m }}</mat-option> }
                </mat-select>
              </mat-form-field>
              <mat-form-field appearance="outline" class="sf-field">
                <mat-label>Location</mat-label>
                <mat-select multiple [(ngModel)]="filterLocations" (ngModelChange)="applyRowFilters()">
                  @for (l of locations; track l) { <mat-option [value]="l">{{ l }}</mat-option> }
                </mat-select>
              </mat-form-field>
              <mat-form-field appearance="outline" class="sf-field">
                <mat-label>HC Type</mat-label>
                <mat-select multiple [(ngModel)]="filterHcTypes" (ngModelChange)="applyRowFilters()">
                  @for (h of hcTypes; track h) { <mat-option [value]="h">{{ h }}</mat-option> }
                </mat-select>
              </mat-form-field>
              <mat-form-field appearance="outline" class="sf-field">
                <mat-label>Quarter</mat-label>
                <mat-select multiple [(ngModel)]="filterQuarters" (ngModelChange)="applyRowFilters()">
                  @for (q of quarters; track q.label) { <mat-option [value]="q.label">{{ q.label }}</mat-option> }
                </mat-select>
              </mat-form-field>
              @if (filterManagers.length || filterLocations.length || filterHcTypes.length || filterQuarters.length) {
                <button mat-icon-button matTooltip="Clear filters" (click)="clearRowFilters()">
                  <mat-icon>filter_alt_off</mat-icon>
                </button>
                <span class="sf-count">{{ filteredRows.length }} of {{ rows.length }} rows</span>
              }

              <!-- Column visibility — moved here so always visible -->
              <div class="col-toggle-wrapper" style="margin-left: auto;">
                <button mat-stroked-button (click)="showColPanel = !showColPanel">
                  <mat-icon>view_column</mat-icon> Columns
                </button>
                @if (showColPanel) {
                  <div class="col-panel">
                    <div class="col-panel-title">Show / Hide Columns</div>
                    @for (col of toggleableColumns; track col.key) {
                      <label class="col-check-row">
                        <input type="checkbox" [checked]="visibleColumns[col.key]"
                          (change)="toggleColumn(col.key)">
                        {{ col.label }}
                      </label>
                    }
                  </div>
                }
              </div>
            </div>

            <!-- Aggregate summary bar -->
            <div class="agg-summary-bar">
              <div class="agg-tile">
                <span class="agg-label">Total Rows</span>
                <span class="agg-val">{{ filteredRows.length }}</span>
              </div>
              <div class="agg-tile agg-sum">
                <span class="agg-label">Σ HC (all rows)</span>
                <span class="agg-val">{{ getTotalSumHC() | number:'1.1-1' }}</span>
              </div>
              <div class="agg-tile agg-peak">
                <span class="agg-label">Peak HC (any quarter)</span>
                <span class="agg-val">{{ getTotalPeakHC() | number:'1.1-1' }}</span>
              </div>
              <div class="agg-tile agg-cost">
                <span class="agg-label">Total Cost</span>
                <span class="agg-val">{{ getTotalCostFormatted() }}</span>
              </div>
            </div>

            <!-- HC Table -->
            <mat-card class="sizing-card">
              <div class="table-wrapper">
                <table mat-table [dataSource]="filteredRows" class="sizing-table">

                  <ng-container matColumnDef="function_contact" sticky>
                    <th mat-header-cell *matHeaderCellDef [style.width]="getColWidth('function_contact')">
                      <div class="resizable-header">Function
                        <span class="resize-handle" (mousedown)="onResizeStart($event, 'function_contact')"></span>
                      </div>
                    </th>
                    <td mat-cell *matCellDef="let row; let i = index">
                      <textarea [attr.list]="'fn-list-' + i" [(ngModel)]="row.function_contact"
                        (ngModelChange)="onInputChange()"
                        (input)="autoResize($event)"
                        (blur)="onFunctionBlur(row)" class="text-input fn-input" placeholder="Type or select..."
                        rows="1"></textarea>
                      <datalist [id]="'fn-list-' + i">
                        @for (s of functionSuggestions; track s) { <option [value]="s"></option> }
                      </datalist>
                    </td>
                  </ng-container>

                  <ng-container matColumnDef="location">
                    <th mat-header-cell *matHeaderCellDef [style.width]="getColWidth('location')">
                      <div class="resizable-header">Location
                        <span class="resize-handle" (mousedown)="onResizeStart($event, 'location')"></span>
                      </div>
                    </th>
                    <td mat-cell *matCellDef="let row">
                      <mat-select [(ngModel)]="row.location" class="cell-select" placeholder="Select">
                        @for (l of locations; track l) { <mat-option [value]="l">{{ l }}</mat-option> }
                      </mat-select>
                    </td>
                  </ng-container>

                  <ng-container matColumnDef="hc_type">
                    <th mat-header-cell *matHeaderCellDef [style.width]="getColWidth('hc_type')">
                      <div class="resizable-header">HC Type
                        <span class="resize-handle" (mousedown)="onResizeStart($event, 'hc_type')"></span>
                      </div>
                    </th>
                    <td mat-cell *matCellDef="let row">
                      <mat-select [(ngModel)]="row.hc_type" class="cell-select" placeholder="Select">
                        @for (h of hcTypes; track h) { <mat-option [value]="h">{{ h }}</mat-option> }
                      </mat-select>
                    </td>
                  </ng-container>

                  <ng-container matColumnDef="manager_name">
                    <th mat-header-cell *matHeaderCellDef [style.width]="getColWidth('manager_name')">
                      <div class="resizable-header">Manager
                        <span class="resize-handle" (mousedown)="onResizeStart($event, 'manager_name')"></span>
                      </div>
                    </th>
                    <td mat-cell *matCellDef="let row">
                      <mat-select [(ngModel)]="row.manager_name" class="cell-select" placeholder="Select">
                        @for (m of managerOptions; track m) { <mat-option [value]="m">{{ m }}</mat-option> }
                      </mat-select>
                    </td>
                  </ng-container>

                  <ng-container matColumnDef="scope">
                    <th mat-header-cell *matHeaderCellDef [style.width]="getColWidth('scope')">
                      <div class="resizable-header">Scope
                        <span class="resize-handle" (mousedown)="onResizeStart($event, 'scope')"></span>
                      </div>
                    </th>
                    <td mat-cell *matCellDef="let row">
                      <textarea [(ngModel)]="row.scope" class="text-input" placeholder="Scope..."
                        (input)="autoResize($event)" rows="1"></textarea>
                    </td>
                  </ng-container>

                  <ng-container matColumnDef="assumptions">
                    <th mat-header-cell *matHeaderCellDef [style.width]="getColWidth('assumptions')">
                      <div class="resizable-header">Assumptions
                        <span class="resize-handle" (mousedown)="onResizeStart($event, 'assumptions')"></span>
                      </div>
                    </th>
                    <td mat-cell *matCellDef="let row">
                      <textarea [(ngModel)]="row.assumptions" class="text-input" placeholder="Assumptions..."
                        (input)="autoResize($event)" rows="1"></textarea>
                    </td>
                  </ng-container>

                  <ng-container matColumnDef="risks">
                    <th mat-header-cell *matHeaderCellDef [style.width]="getColWidth('risks')">
                      <div class="resizable-header">Risks
                        <span class="resize-handle" (mousedown)="onResizeStart($event, 'risks')"></span>
                      </div>
                    </th>
                    <td mat-cell *matCellDef="let row">
                      <textarea [(ngModel)]="row.risks" class="text-input" placeholder="Risks..."
                        (input)="autoResize($event)" rows="1"></textarea>
                    </td>
                  </ng-container>

                  <ng-container matColumnDef="notes">
                    <th mat-header-cell *matHeaderCellDef [style.width]="getColWidth('notes')">
                      <div class="resizable-header">Notes
                        <span class="resize-handle" (mousedown)="onResizeStart($event, 'notes')"></span>
                      </div>
                    </th>
                    <td mat-cell *matCellDef="let row">
                      <textarea [(ngModel)]="row.notes" class="text-input" placeholder="Notes..."
                        (input)="autoResize($event)" rows="1"></textarea>
                    </td>
                  </ng-container>

                  @for (q of quarters; track q.label) {
                    <ng-container [matColumnDef]="q.label">
                      <th mat-header-cell *matHeaderCellDef>
                        <div class="q-header">
                          <!-- Value shown above bar for clarity -->
                          <span class="q-bar-top-val">
                            @if (getTotalForQuarter(q.label) > 0) { {{ getTotalForQuarter(q.label) | number:'1.1-1' }} }
                          </span>
                          <div class="q-bar-outer">
                            <div class="q-bar-inner"
                              [style.height.%]="getBarPct(q.label)"
                              [style.background]="getBarColor(q.label)">
                            </div>
                          </div>
                          <span class="q-label">{{ q.label }}</span>
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

                  <!-- Summary columns -->
                  <ng-container matColumnDef="sum_hc">
                    <th mat-header-cell *matHeaderCellDef class="summary-header">
                      <div class="summary-header-cell">Σ HC</div>
                    </th>
                    <td mat-cell *matCellDef="let row" class="summary-cell sum-cell">
                      {{ getRowSumHC(row) | number:'1.1-1' }}
                    </td>
                  </ng-container>

                  <ng-container matColumnDef="peak_hc">
                    <th mat-header-cell *matHeaderCellDef class="summary-header">
                      <div class="summary-header-cell">Peak HC</div>
                    </th>
                    <td mat-cell *matCellDef="let row" class="summary-cell peak-cell">
                      {{ getRowPeakHC(row) | number:'1.1-1' }}
                    </td>
                  </ng-container>

                  <ng-container matColumnDef="row_cost">
                    <th mat-header-cell *matHeaderCellDef class="summary-header">
                      <div class="summary-header-cell">Cost</div>
                    </th>
                    <td mat-cell *matCellDef="let row" class="summary-cell cost-cell">
                      {{ getRowCost(row) }}
                    </td>
                  </ng-container>

                  <ng-container matColumnDef="actions">
                    <th mat-header-cell *matHeaderCellDef></th>
                    <td mat-cell *matCellDef="let row; let i = index">
                      <button mat-icon-button color="warn" (click)="removeRow(i)">
                        <mat-icon>delete</mat-icon>
                      </button>
                    </td>
                  </ng-container>

                  <tr mat-header-row *matHeaderRowDef="displayedColumns; sticky: true"></tr>
                  <tr mat-row *matRowDef="let row; columns: displayedColumns;"
                    [class.row-new]="isRowNew(row)"
                    [class.row-modified]="isRowModified(row)"></tr>
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
                                    [class.q-range-start]="isRangeEdge(getQuarter(fy,q)!, 'start') || (!rangeStart && isSelected(getQuarter(fy,q)!) && isSelectedEdge(getQuarter(fy,q)!, 'start'))"
                                    [class.q-range-end]="isRangeEdge(getQuarter(fy,q)!, 'end') || (!rangeStart && isSelected(getQuarter(fy,q)!) && isSelectedEdge(getQuarter(fy,q)!, 'end'))"
                                    [class.q-in-range]="isInRange(getQuarter(fy,q)!) || (!rangeStart && isSelectedMiddle(getQuarter(fy,q)!))"
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

        <!-- ===== TAB 2: DOCUMENTS ===== -->
        <mat-tab label="Documents">
          <div class="tab-content doc-tab-layout">

            <!-- LEFT: document list + add actions -->
            <div class="doc-sidebar">
              <div class="doc-actions">
                <button mat-stroked-button (click)="showLinkInput = !showLinkInput">
                  <mat-icon>link</mat-icon> Add Link
                </button>
                <button mat-stroked-button (click)="docFileInput.click()">
                  <mat-icon>upload_file</mat-icon> Upload
                </button>
              </div>

              <!-- Link input -->
              @if (showLinkInput) {
                <div class="doc-link-input">
                  <mat-form-field appearance="outline" style="width:100%">
                    <mat-label>SharePoint / URL *</mat-label>
                    <input matInput [(ngModel)]="docUrl" placeholder="https://amd.sharepoint.com/...">
                  </mat-form-field>
                  <mat-form-field appearance="outline" style="width:100%">
                    <mat-label>Display Name (optional)</mat-label>
                    <input matInput [(ngModel)]="docUrlLabel" placeholder="e.g. Sam's Sizing Sheet">
                  </mat-form-field>
                  <div class="doc-link-actions">
                    <button mat-stroked-button (click)="showLinkInput = false; docUrl = ''; docUrlLabel = ''">Cancel</button>
                    <button mat-flat-button color="primary" (click)="saveDocLink()" [disabled]="!docUrl">Save</button>
                  </div>
                </div>
              }

              <!-- Document list -->
              @for (doc of savedDocs; track doc.doc_id) {
                <div class="doc-list-item" [class.doc-active]="activeDoc?.doc_id === doc.doc_id"
                  (click)="selectDoc(doc)">
                  <mat-icon class="doc-list-icon">{{ doc.doc_type === 'link' ? 'link' : getFileIcon(doc.file_name) }}</mat-icon>
                  <div class="doc-list-info">
                    <span class="doc-list-name">{{ doc.doc_label || doc.file_name }}</span>
                    <span class="doc-list-date">{{ doc.created_at | date:'MMM d, y' }}</span>
                  </div>
                  <button mat-icon-button color="warn" (click)="$event.stopPropagation(); deleteSavedDoc(doc)" matTooltip="Remove">
                    <mat-icon>delete_outline</mat-icon>
                  </button>
                </div>
              }

              @if (savedDocs.length === 0 && !showLinkInput) {
                <div class="doc-empty">
                  <mat-icon>description</mat-icon>
                  <span>No documents yet</span>
                  <span class="doc-empty-hint">Upload or paste a link above</span>
                </div>
              }

              <input #docFileInput type="file" accept="*" multiple style="display:none"
                (change)="onDocFilesSelected($event)">
            </div>

            <!-- RIGHT: embedded viewer -->
            <div class="doc-viewer">
              @if (activeDoc) {
                <div class="doc-viewer-header">
                  <span class="doc-viewer-title">{{ activeDoc.doc_label || activeDoc.file_name }}</span>
                  <button mat-icon-button (click)="openSavedDoc(activeDoc)" matTooltip="Open in new tab">
                    <mat-icon>open_in_new</mat-icon>
                  </button>
                </div>
                @if (isSharePointUrl(activeDoc.doc_url)) {
                  <!-- SharePoint / OneDrive — Office Online viewer works -->
                  <iframe class="doc-iframe" [src]="getEmbedUrl(activeDoc.doc_url)"
                    frameborder="0" allowfullscreen></iframe>
                } @else if (isPdf(activeDoc.doc_url)) {
                  <!-- PDF — browsers render natively -->
                  <iframe class="doc-iframe" [src]="getEmbedUrl(activeDoc.doc_url)"
                    frameborder="0"></iframe>
                } @else if (isOfficeFile(activeDoc.doc_url || activeDoc.file_name)) {
                  <!-- Local Office file — Office Online needs public URL, show download instead -->
                  <div class="doc-viewer-placeholder">
                    <mat-icon style="font-size:56px;width:56px;height:56px;color:#1565c0">slideshow</mat-icon>
                    <p style="font-weight:600;color:#333">{{ activeDoc.doc_label || activeDoc.file_name }}</p>
                    <p class="doc-empty-hint" style="text-align:center">
                      Office files can only be embedded when hosted on SharePoint or OneDrive.<br>
                      Download the file or move it to SharePoint and paste the link instead.
                    </p>
                    <a [href]="activeDoc.doc_url" download mat-flat-button
                      style="margin-top:8px;padding:8px 20px;background:#1565c0;color:white;border-radius:6px;text-decoration:none;font-size:13px;font-weight:600;display:flex;align-items:center;gap:6px;">
                      <mat-icon style="font-size:16px;width:16px;height:16px">download</mat-icon>
                      Download File
                    </a>
                  </div>
                } @else if (activeDoc.doc_url) {
                  <!-- Generic URL — try direct embed -->
                  <iframe class="doc-iframe" [src]="getEmbedUrl(activeDoc.doc_url)"
                    frameborder="0" allowfullscreen></iframe>
                } @else {
                  <div class="doc-viewer-placeholder">
                    <mat-icon style="font-size:56px;width:56px;height:56px;color:#ccc">description</mat-icon>
                    <p class="doc-empty-hint">No preview available.</p>
                  </div>
                }
              } @else {
                <div class="doc-viewer-placeholder">
                  <mat-icon style="font-size:56px;width:56px;height:56px;color:#ddd">pageview</mat-icon>
                  <p style="color:#aaa;font-size:13px;">Select a document from the list to preview it here</p>
                </div>
              }
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
                    <p class="file-hint">Supported: .xlsx</p>
                  </div>
                </div>

                <mat-divider [vertical]="true" class="section-divider"></mat-divider>

                <div class="import-section">
                  <mat-icon class="section-icon">open_in_new</mat-icon>
                  <h4>Export Current Draft</h4>
                  <p>Export the current draft data for offline review.</p>
                  <div class="template-buttons">
                    <button mat-stroked-button>
                      <mat-icon>table_view</mat-icon> Export to XLSX
                    </button>
                    <button mat-stroked-button class="pdf-btn" matTooltip="PDF export — coming soon">
                      <mat-icon>picture_as_pdf</mat-icon> Export to PDF
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
    .unsaved-badge { background: #fff3e0; color: #e65100; border: 1px solid #ff9800; padding: 4px 12px; border-radius: 12px; font-size: 12px; font-weight: 600; }

    /* Diff row highlighting */
    .row-new td { background: #f0fff4 !important; border-left: 3px solid #4caf50; }
    .row-modified td { background: #fffbf0 !important; border-left: 3px solid #ff9800; }
    .loading-state { display: flex; flex-direction: column; align-items: center; padding: 48px; color: #aaa; gap: 12px; }

    :host { display: block; }

    /* Column resize handle */
    .resizable-header { position: relative; display: flex; align-items: center; user-select: none; padding-right: 10px; }
    .resize-handle {
      position: absolute; right: -2px; top: 4px; bottom: 4px; width: 6px;
      cursor: col-resize; z-index: 10;
      background: #d0d0d0; border-radius: 3px;
      display: flex; align-items: center; justify-content: center;
    }
    .resize-handle::after { content: '⋮'; color: #888; font-size: 12px; }
    .resize-handle:hover { background: #1a1a2e; }
    .resize-handle:hover::after { color: white; }
    .resize-handle:active { background: #ED1C24; }

    /* Column panel — proper checkboxes */
    .col-toggle-wrapper { position: relative; }
    .col-panel {
      position: absolute; top: 44px; right: 0; left: auto; z-index: 300;
      background: white; border: 1px solid #ddd; border-radius: 8px;
      padding: 14px 16px; box-shadow: 0 4px 20px rgba(0,0,0,0.15);
      min-width: 200px;
    }
    .col-panel-title { font-size: 11px; font-weight: 700; color: #999; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 10px; }
    .col-check-row {
      display: flex; align-items: center; gap: 10px;
      padding: 6px 8px; font-size: 13px; color: #333;
      cursor: pointer; border-radius: 4px; transition: background 0.1s;
    }
    .col-check-row:hover { background: #f5f5f5; }
    .col-check-row input[type=checkbox] {
      width: 16px; height: 16px; cursor: pointer;
      accent-color: #1a1a2e; flex-shrink: 0;
    }

    /* Sizing filter bar */
    .sizing-filter-bar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 8px 12px; background: #f8f9fa; border: 1px solid #e8e8e8; border-radius: 8px; }
    .sf-field { width: 150px; }
    .sf-field ::ng-deep .mat-mdc-form-field-subscript-wrapper { display: none; }
    .sf-count { font-size: 12px; color: #888; margin-left: 4px; }
    /* Scope notes */
    .scope-notes-bar { margin-bottom: 12px; }
    .scope-notes-input {
      width: 100%; border: 1px solid #e0e0e0; border-radius: 8px;
      padding: 10px 14px; font-size: 13px; font-family: inherit;
      color: #333; background: white; resize: vertical; min-height: 48px;
      line-height: 1.5; transition: border-color 0.2s;
    }
    .scope-notes-input:focus { outline: none; border-color: #1976d2; }
    .scope-notes-input::placeholder { color: #aaa; font-style: italic; }

    .sizing-tabs { background: transparent; }
    ::ng-deep .mat-mdc-tab-body-wrapper { flex: 1; }
    ::ng-deep .mat-mdc-tab-body-content { overflow-y: auto !important; }
    .tab-content { padding: 16px 0; display: flex; flex-direction: column; gap: 12px; }

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
    /* Inline bar chart in quarter column headers */
    .q-header { display: flex; flex-direction: column; align-items: center; gap: 2px; min-width: 64px; padding: 4px 0; }
    .q-bar-outer { width: 52px; height: 56px; background: #ebebeb; border-radius: 3px 3px 0 0; display: flex; align-items: flex-end; overflow: hidden; }
    .q-bar-inner { width: 100%; transition: height 0.3s ease; border-radius: 3px 3px 0 0; min-height: 0; }
    .q-bar-top-val { font-size: 11px; font-weight: 800; color: #222; min-height: 16px; text-align: center; line-height: 1; letter-spacing: -0.3px; }
    .q-label { font-size: 11px; font-weight: 700; color: #222; white-space: nowrap; letter-spacing: 0.2px; }
    .q-milestone-dot { font-size: 9px; padding: 1px 4px; border-radius: 6px; color: white; font-weight: 700; }

    /* Milestone picker panel */
    .ms-picker-panel { background: white; border: 1px solid #e0e0e0; border-radius: 12px; padding: 20px; box-shadow: 0 4px 24px rgba(0,0,0,0.12); margin: 8px 0; }
    .ms-derived-quarter { display: inline-block; margin-top: 4px; padding: 2px 10px; border-radius: 10px; font-size: 11px; font-weight: 600; }

    /* Airbnb-style calendar */
    .cal-container { display: flex; gap: 24px; margin: 12px 0; }
    .cal-month { width: 252px; flex-shrink: 0; }
    .cal-month-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
    .cal-month-label { font-size: 13px; font-weight: 600; color: #222; }
    .cal-nav { background: none; border: 1px solid #ddd; border-radius: 50%; width: 26px; height: 26px; cursor: pointer; font-size: 14px; display: flex; align-items: center; justify-content: center; color: #555; transition: background 0.15s; }
    .cal-nav:hover { background: #f5f5f5; }
    .cal-grid { display: grid; grid-template-columns: repeat(7, 36px); }
    .cal-dow { width: 36px; height: 28px; text-align: center; font-size: 10px; font-weight: 600; color: #999; display: flex; align-items: center; justify-content: center; }
    .cal-day {
      width: 36px; height: 36px; text-align: center; font-size: 12px; cursor: pointer;
      border-radius: 50%; transition: background 0.1s; color: #333;
      display: flex; align-items: center; justify-content: center;
    }
    .cal-day:hover:not(.cal-empty) { background: #f0f0f0; }
    .cal-empty { cursor: default; pointer-events: none; }
    .cal-today { font-weight: 700; border: 1.5px solid #ccc; }
    .cal-start, .cal-end {
      background: var(--ms-color) !important; color: white !important;
      border-radius: 50% !important; font-weight: 700;
    }
    .cal-in-range { background: color-mix(in srgb, var(--ms-color) 15%, white) !important; border-radius: 0; }
    .cal-hover-range { background: #eeeeee !important; border-radius: 0; }
    .ms-active-quarters { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px; }
    .ms-picker-header { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
    .ms-dot { width: 12px; height: 12px; border-radius: 50%; flex-shrink: 0; }
    .ms-picker-hint { font-size: 11px; color: #999; }

    /* Milestone chip X clear button */
    .ms-clear { font-size: 15px; font-weight: 700; cursor: pointer; margin-left: 3px; opacity: 0.55; line-height: 1; padding: 0 2px; }
    .ms-clear:hover { opacity: 1; }
    .ms-name { cursor: pointer; }
    .ms-unset { cursor: pointer; }

    /* Table */
    .sizing-card { margin-bottom: 0; }
    .table-wrapper {
      overflow-x: auto;
      overflow-y: auto;
      max-height: calc(100vh - 420px);
      min-height: 200px;
    }
    .sizing-table { min-width: max-content; }
    .cell-select { width: 100%; min-width: 80px; font-size: 13px; }
    .text-input { width: 100%; min-width: 60px; border: 1px solid #ddd; border-radius: 4px; padding: 4px 8px; font-size: 13px; font-family: inherit; resize: none; overflow: hidden; min-height: 32px; line-height: 1.5; display: block; word-break: break-word; white-space: pre-wrap; box-sizing: border-box; }
    .text-input:focus { outline: none; border-color: #1976d2; }
    .fn-input { width: 100%; }
    .quarter-input { width: 58px; border: 1px solid #ddd; border-radius: 4px; padding: 4px 6px; font-size: 13px; text-align: center; }
    .quarter-input:focus { outline: none; border-color: #ED1C24; }

    .table-actions { display: flex; gap: 12px; padding: 12px 16px; align-items: flex-start; }
    .form-actions { display: flex; gap: 12px; justify-content: flex-end; padding: 12px 16px; }

    /* Quarter picker */
    .quarter-picker-wrapper { display: flex; flex-direction: column; }
    .quarter-picker-panel { background: white; border: 1px solid #e0e0e0; border-radius: 8px; padding: 16px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); margin-top: 8px; }
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
    .mprs-hint { font-size: 11px; color: #ccc; }

    /* Aggregate summary bar */
    .agg-summary-bar { display: flex; gap: 12px; padding: 10px 0; flex-wrap: wrap; }
    .agg-tile { display: flex; flex-direction: column; gap: 2px; padding: 10px 16px; border-radius: 8px; background: white; border: 1px solid #e0e0e0; min-width: 120px; }
    .agg-tile.agg-sum { background: #e3f2fd; border-color: #1565c0; }
    .agg-tile.agg-peak { background: #fff3e0; border-color: #e65100; }
    .agg-tile.agg-cost { background: #e8f5e9; border-color: #2e7d32; }
    .agg-label { font-size: 10px; font-weight: 600; color: #888; text-transform: uppercase; letter-spacing: 0.5px; }
    .agg-val { font-size: 18px; font-weight: 700; color: #1a1a2e; }
    .agg-sum .agg-label { color: #1565c0; }
    .agg-sum .agg-val { color: #1565c0; }
    .agg-peak .agg-label { color: #e65100; }
    .agg-peak .agg-val { color: #e65100; }
    .agg-cost .agg-label { color: #2e7d32; }
    .agg-cost .agg-val { color: #2e7d32; }

    /* Row summary columns */
    .summary-header { background: #1a1a2e !important; border-left: 2px solid #333 !important; }
    .summary-header-cell { font-size: 11px; font-weight: 700; color: white; text-align: center; padding: 2px 4px; }
    .summary-cell { text-align: center; font-weight: 700; font-size: 12px; border-left: 1px solid #e8e8e8; }
    .sum-cell { background: #f0f7ff; color: #1565c0; }
    .peak-cell { background: #fff3e0; color: #e65100; }
    .cost-cell { background: #f0fff4; color: #2e7d32; }

    /* Documents tab */
    /* Two-panel doc layout */
    .doc-tab-layout { display: flex; gap: 0; height: calc(100vh - 300px); min-height: 500px; padding: 0 !important; }
    .doc-sidebar { width: 280px; flex-shrink: 0; border-right: 1px solid #e8e8e8; display: flex; flex-direction: column; gap: 8px; padding: 16px; overflow-y: auto; background: white; }
    .doc-viewer { flex: 1; display: flex; flex-direction: column; background: #f8f9fa; }
    .doc-viewer-header { display: flex; align-items: center; justify-content: space-between; padding: 10px 16px; background: white; border-bottom: 1px solid #e8e8e8; }
    .doc-viewer-title { font-size: 13px; font-weight: 600; color: #1a1a2e; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .doc-iframe { flex: 1; width: 100%; height: 100%; border: none; }
    .doc-viewer-placeholder { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; color: #aaa; }
    .doc-list-item { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-radius: 8px; cursor: pointer; transition: background 0.12s; border: 1px solid transparent; }
    .doc-list-item:hover { background: #f0f7ff; }
    .doc-list-item.doc-active { background: #e3f0ff; border-color: #90caf9; }
    .doc-list-icon { font-size: 20px; width: 20px; height: 20px; color: #1565c0; flex-shrink: 0; }
    .doc-list-info { flex: 1; overflow: hidden; }
    .doc-list-name { display: block; font-size: 12px; font-weight: 600; color: #1a1a2e; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .doc-list-date { display: block; font-size: 10px; color: #aaa; }
    .doc-panel { background: white; border: 1px solid #e0e0e0; border-radius: 10px; padding: 24px; display: flex; flex-direction: column; gap: 16px; }
    .doc-header { display: flex; align-items: center; gap: 14px; padding-bottom: 12px; border-bottom: 1px solid #f0f0f0; }
    .doc-icon { font-size: 28px; width: 28px; height: 28px; color: #ED1C24; }
    .doc-header h3 { margin: 0; font-size: 16px; font-weight: 600; }
    .doc-subtitle { margin: 2px 0 0; color: #888; font-size: 13px; }
    .doc-actions { display: flex; gap: 10px; flex-wrap: wrap; }
    .doc-link-input { background: #f8f9fa; border-radius: 8px; padding: 16px; display: flex; flex-direction: column; gap: 10px; }
    .doc-link-input ::ng-deep .mat-mdc-form-field-subscript-wrapper { display: none; }
    .doc-link-actions { display: flex; gap: 8px; justify-content: flex-end; }
    .doc-item { display: flex; align-items: center; gap: 12px; padding: 10px 14px; background: #fafafa; border: 1px solid #e8e8e8; border-radius: 8px; }
    .doc-item-icon { font-size: 24px; width: 24px; height: 24px; color: #1565c0; flex-shrink: 0; }
    .doc-item-info { flex: 1; display: flex; flex-direction: column; }
    .doc-item-name { font-size: 13px; font-weight: 600; color: #1a1a2e; }
    .doc-item-url { font-size: 11px; color: #888; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 400px; }
    .doc-item-size { font-size: 11px; color: #aaa; }
    .doc-empty { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 48px; color: #bbb; }
    .doc-empty mat-icon { font-size: 48px; width: 48px; height: 48px; }
    .doc-empty span { font-size: 14px; }
    .doc-empty-hint { font-size: 12px; color: #ccc; }

    .import-sections { display: flex; gap: 32px; align-items: flex-start; }
    .import-section { flex: 1; display: flex; flex-direction: column; gap: 12px; }
    .section-icon { font-size: 32px; width: 32px; height: 32px; color: #ED1C24; }
    .import-section h4 { margin: 0; font-size: 16px; font-weight: 600; }
    .import-section p { margin: 0; color: #666; font-size: 13px; }
    .template-buttons { display: flex; flex-direction: column; gap: 8px; }
    .pdf-btn { color: #c62828 !important; border-color: #c62828 !important; }
    .pdf-btn mat-icon { color: #c62828 !important; }
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
  scopeNotes = '';
  baselineRows: SizingRow[] = [];  // last locked/submitted version rows for diff
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
  msRangeStart: string | null = null;
  msHoverQuarter: string | null = null;

  // Calendar state
  calBaseMonth: Date = new Date();
  calHoverDate: Date | null = null;

  locations = ['Canada', 'US', 'India Bangalore', 'India Hyderabad', 'China Shanghai', 'Germany', 'Mexico', 'Korea'];
  hcTypes = ['Existing - FTE', 'Existing - AOP', 'Incremental - XCHG', 'Incremental - CONT'];
  // Manager options — loaded from RA_people where designation is elevated; defaults until API wired
  managerOptions: string[] = ['Alvin Huan', 'Fai Fan', 'Jeffrey Weyman', 'Luugi Marsan', 'Tim Writer', 'Ray Huang'];

  // Column visibility
  showColPanel = false;
  visibleColumns: Record<string, boolean> = {
    location: true, hc_type: true, manager_name: true,
    scope: true, assumptions: true, risks: true, notes: true
  };
  toggleableColumns = [
    { key: 'location',     label: 'Location' },
    { key: 'hc_type',      label: 'HC Type' },
    { key: 'manager_name', label: 'Manager' },
    { key: 'scope',        label: 'Scope' },
    { key: 'assumptions',  label: 'Assumptions' },
    { key: 'risks',        label: 'Risks' },
    { key: 'notes',        label: 'Notes' },
  ];

  toggleColumn(key: string) {
    this.visibleColumns[key] = !this.visibleColumns[key];
    this.cdr.detectChanges();
    // Re-trigger textarea resize after column visibility change
    setTimeout(() => this.resizeAllTextareas(), 50);
  }

  // Column resize
  colWidths: Record<string, number> = {};
  private resizing = false;
  private resizeCol = '';
  private resizeStartX = 0;
  private resizeStartW = 0;

  getColWidth(col: string): string {
    return this.colWidths[col] ? this.colWidths[col] + 'px' : '';
  }

  onResizeStart(event: MouseEvent, col: string) {
    event.preventDefault();
    this.resizing = true;
    this.resizeCol = col;
    this.resizeStartX = event.clientX;
    const el = (event.target as HTMLElement).closest('th');
    this.resizeStartW = el ? el.offsetWidth : 120;

    const onMove = (e: MouseEvent) => {
      if (!this.resizing) return;
      const delta = e.clientX - this.resizeStartX;
      this.colWidths[this.resizeCol] = Math.max(60, this.resizeStartW + delta);
      this.cdr.detectChanges();
    };
    const onUp = () => {
      this.resizing = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  // Row filters
  filterManagers: string[] = [];
  filterLocations: string[] = [];
  filterHcTypes: string[] = [];
  filterQuarters: string[] = [];
  filteredRows: SizingRow[] = [];

  applyRowFilters() {
    this.filteredRows = this.rows.filter(row => {
      const matchManager = !this.filterManagers.length || this.filterManagers.includes(row.manager_name);
      const matchLocation = !this.filterLocations.length || this.filterLocations.includes(row.location);
      const matchHcType = !this.filterHcTypes.length || this.filterHcTypes.includes(row.hc_type);
      const matchQuarter = !this.filterQuarters.length ||
        this.filterQuarters.some(q => Number(row.quarters[q] || 0) > 0);
      return matchManager && matchLocation && matchHcType && matchQuarter;
    });
    this.cdr.detectChanges();
  }

  clearRowFilters() {
    this.filterManagers = [];
    this.filterLocations = [];
    this.filterHcTypes = [];
    this.filterQuarters = [];
    this.filteredRows = [...this.rows];
    this.cdr.detectChanges();
  }

  milestones: Milestone[] = [
    { name: 'Concept',       color: '#9c27b0', quarterLabels: [], startDate: null, endDate: null },
    { name: 'Feasibility',   color: '#3f51b5', quarterLabels: [], startDate: null, endDate: null },
    { name: 'BTO',           color: '#03a9f4', quarterLabels: [], startDate: null, endDate: null },
    { name: 'Asic Back',     color: '#009688', quarterLabels: [], startDate: null, endDate: null },
    { name: 'Bring Up Exit', color: '#4caf50', quarterLabels: [], startDate: null, endDate: null },
    { name: 'AFEr',          color: '#8bc34a', quarterLabels: [], startDate: null, endDate: null },
    { name: 'AFEd',          color: '#ffeb3b', quarterLabels: [], startDate: null, endDate: null },
    { name: 'AFOr',          color: '#ff9800', quarterLabels: [], startDate: null, endDate: null },
    { name: 'AFOd',          color: '#ff5722', quarterLabels: [], startDate: null, endDate: null },
    { name: 'GA',            color: '#ED1C24', quarterLabels: [], startDate: null, endDate: null },
  ];

  String = String;

  get displayedColumns(): string[] {
    const fixed = ['function_contact'];
    const toggleable = ['location', 'hc_type', 'manager_name', 'scope', 'assumptions', 'risks', 'notes'];
    const visible = toggleable.filter(c => this.visibleColumns[c]);
    return [...fixed, ...visible, ...this.quarters.map(q => q.label), 'sum_hc', 'peak_hc', 'row_cost', 'actions'];
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
    private cdr: ChangeDetectorRef,
    private sanitizer: DomSanitizer
  ) {}

  ngOnInit() {
    this.projectId = +this.route.snapshot.paramMap.get('projectId')!;
    this.generateAvailableQuarters();
    this.setDefaultQuarters();

    this.api.getFunctions().subscribe({ next: (res: any) => { this.functionSuggestions = res.data; }, error: () => {} });
    this.api.getProject(this.projectId).subscribe({
      next: (res: any) => { this.project = res.data; },
      error: () => { this.project = { project_name: 'Unknown Project' }; }
    });
    this.loadDocuments();

    // Load baseline first, then draft on top of it
    this.api.getProjectBaseline(this.projectId).subscribe({
      next: (res: any) => {
        this.baselineRows = res.data?.rows || [];
        this.loadDraft(); // load draft AFTER baseline is ready
      },
      error: () => {
        this.baselineRows = [];
        this.loadDraft(); // still load draft even if baseline fails
      }
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
    // Default: current quarter + next 3 (4 quarters total)
    this.quarters = this.availableQuarters.slice(0, 4);
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

  saveScopeNotes() {
    if (!this.versionId || this.scopeNotes === undefined) return;
    this.api.saveScopeNotes(this.versionId, this.scopeNotes).subscribe({ error: () => {} });
  }

  autoResize(event: Event) {
    const el = event.target as HTMLTextAreaElement;
    if (el) {
      el.style.height = 'auto';
      el.style.height = el.scrollHeight + 'px';
    }
  }

  // Resize all textareas in the table after data loads
  resizeAllTextareas() {
    setTimeout(() => {
      const textareas = document.querySelectorAll<HTMLTextAreaElement>('.sizing-table textarea');
      textareas.forEach(el => {
        el.style.height = 'auto';
        el.style.height = el.scrollHeight + 'px';
      });
    }, 100);
  }

  // Milestones
  openMilestoneEditor(ms: Milestone) {
    this.editingMilestone = this.editingMilestone?.name === ms.name ? null : ms;
    this.msRangeStart = null;
    this.msHoverQuarter = null;
    this.calHoverDate = null;
    // Open calendar at the month of the existing start date, or today
    if (ms.startDate) {
      const d = new Date(ms.startDate);
      this.calBaseMonth = new Date(d.getFullYear(), d.getMonth(), 1);
    } else {
      const today = new Date();
      this.calBaseMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    }
  }

  deriveQuarter(dateStr: string): string {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    const q = Math.ceil((d.getMonth() + 1) / 3);
    const yr = String(d.getFullYear()).slice(-2);
    return `Q${q} FY${yr}`;
  }

  onMilestoneDateChange(ms: Milestone) {
    const labels: string[] = [];
    if (ms.startDate) {
      const sq = this.deriveQuarter(ms.startDate);
      labels.push(sq);
    }
    if (ms.endDate) {
      const eq = this.deriveQuarter(ms.endDate);
      if (!labels.includes(eq)) labels.push(eq);
    }
    ms.quarterLabels = labels;
    this.onInputChange();
  }

  clearMilestoneDates(ms: Milestone) {
    ms.startDate = null;
    ms.endDate = null;
    ms.quarterLabels = [];
    this.onInputChange();
  }

  applyMilestoneDates(ms: Milestone) {
    this.onMilestoneDateChange(ms);
    if (ms.startDate && this.versionId) {
      this.api.saveMilestone(this.versionId, {
        milestone_name: ms.name,
        start_date: ms.startDate,
        end_date: ms.endDate || null
      }).subscribe({ error: () => {} });
    }
    this.editingMilestone = null;
  }

  // ── Calendar helpers ──

  calPrev() {
    const d = new Date(this.calBaseMonth);
    d.setMonth(d.getMonth() - 1);
    this.calBaseMonth = d;
  }

  calNext() {
    const d = new Date(this.calBaseMonth);
    d.setMonth(d.getMonth() + 1);
    this.calBaseMonth = d;
  }

  getCalMonthLabel(offset: number): string {
    const d = new Date(this.calBaseMonth);
    d.setMonth(d.getMonth() + offset);
    return d.toLocaleString('default', { month: 'long', year: 'numeric' });
  }

  getCalDays(offset: number): { date: Date | null; key: string }[] {
    const d = new Date(this.calBaseMonth);
    d.setMonth(d.getMonth() + offset);
    const year = d.getFullYear();
    const month = d.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const days: { date: Date | null; key: string }[] = [];
    for (let i = 0; i < firstDay; i++) days.push({ date: null, key: `e${i}` });
    for (let i = 1; i <= daysInMonth; i++) {
      days.push({ date: new Date(year, month, i), key: `${year}-${month}-${i}` });
    }
    return days;
  }

  onCalDayClick(date: Date, ms: Milestone) {
    const iso = this.toIso(date);
    if (!ms.startDate || (ms.startDate && ms.endDate)) {
      // Start fresh
      ms.startDate = iso;
      ms.endDate = null;
    } else {
      // Have start, no end
      if (date < new Date(ms.startDate)) {
        ms.endDate = ms.startDate;
        ms.startDate = iso;
      } else if (iso === ms.startDate) {
        ms.startDate = null; // deselect
      } else {
        ms.endDate = iso;
      }
    }
    this.onMilestoneDateChange(ms);
  }

  toIso(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  isCalStart(date: Date, ms: Milestone): boolean {
    return !!ms.startDate && this.toIso(date) === ms.startDate;
  }

  isCalEnd(date: Date, ms: Milestone): boolean {
    return !!ms.endDate && this.toIso(date) === ms.endDate;
  }

  isCalInRange(date: Date, ms: Milestone): boolean {
    if (!ms.startDate) return false;
    const iso = this.toIso(date);
    const end = ms.endDate || (this.calHoverDate ? this.toIso(this.calHoverDate) : null);
    if (!end) return false;
    const lo = ms.startDate < end ? ms.startDate : end;
    const hi = ms.startDate < end ? end : ms.startDate;
    return iso > lo && iso < hi;
  }

  isCalHoverRange(date: Date, ms: Milestone): boolean {
    if (!ms.startDate || ms.endDate || !this.calHoverDate) return false;
    const iso = this.toIso(date);
    const hover = this.toIso(this.calHoverDate);
    const lo = ms.startDate < hover ? ms.startDate : hover;
    const hi = ms.startDate < hover ? hover : ms.startDate;
    return iso >= lo && iso <= hi;
  }

  isToday(date: Date): boolean {
    const t = new Date();
    return date.getDate() === t.getDate() && date.getMonth() === t.getMonth() && date.getFullYear() === t.getFullYear();
  }

  getMilestoneForQuarter(quarterLabel: string): Milestone | null {
    return this.milestones.find(m => m.quarterLabels.includes(quarterLabel)) || null;
  }

  // Airbnb-style range selection for milestone quarters
  toggleMilestoneQuarter(ms: Milestone, label: string) {
    if (!this.msRangeStart) {
      // First click — set start
      this.msRangeStart = label;
    } else {
      // Second click — apply the range
      const allLabels = this.availableQuarters.map(q => q.label);
      const startIdx = allLabels.indexOf(this.msRangeStart);
      const endIdx = allLabels.indexOf(label);
      if (startIdx === endIdx) {
        // Same quarter clicked twice — toggle single quarter
        const already = ms.quarterLabels.includes(label);
        ms.quarterLabels = already
          ? ms.quarterLabels.filter(l => l !== label)
          : [...ms.quarterLabels, label];
      } else {
        const lo = Math.min(startIdx, endIdx);
        const hi = Math.max(startIdx, endIdx);
        const rangeLabels = allLabels.slice(lo, hi + 1);
        // Add all quarters in range (deduplicated)
        const merged = new Set([...ms.quarterLabels, ...rangeLabels]);
        ms.quarterLabels = allLabels.filter(l => merged.has(l)); // keep order
      }
      this.msRangeStart = null;
      this.msHoverQuarter = null;
    }
  }

  // Check if a quarter is in the currently selected (applied) range
  isSelected(q: Quarter | null): boolean {
    if (!q) return false;
    return this.quarters.some(sq => sq.label === q.label);
  }

  isSelectedEdge(q: Quarter | null, edge: 'start' | 'end'): boolean {
    if (!q || this.quarters.length === 0) return false;
    if (edge === 'start') return q.label === this.quarters[0].label;
    return q.label === this.quarters[this.quarters.length - 1].label;
  }

  isSelectedMiddle(q: Quarter | null): boolean {
    if (!q || this.quarters.length <= 2) return false;
    const idx = this.quarters.findIndex(sq => sq.label === q.label);
    return idx > 0 && idx < this.quarters.length - 1;
  }

  isMsInRange(label: string): boolean {
    if (!this.msRangeStart || !this.msHoverQuarter) return false;
    const allLabels = this.availableQuarters.map(q => q.label);
    const startIdx = allLabels.indexOf(this.msRangeStart);
    const hoverIdx = allLabels.indexOf(this.msHoverQuarter);
    const idx = allLabels.indexOf(label);
    const lo = Math.min(startIdx, hoverIdx);
    const hi = Math.max(startIdx, hoverIdx);
    return idx >= lo && idx <= hi;
  }

  getBarColor(label: string): string {
    const ms = this.getMilestoneForQuarter(label);
    if (ms) return ms.color + 'aa'; // lighter — matches milestone chip bubble shade
    return this.isPeakQuarter(label) ? '#ED1C2488' : '#1a1a2e88';
  }

  loadDraft() {
    this.api.getProjectDraft(this.projectId).subscribe({
      next: (res: any) => {
        if (res.data?.version_id) {
          // Has an existing draft — load draft rows ONLY (PM's deliberate choices)
          // Do NOT merge baseline — if PM deleted a row, it stays deleted
          this.versionId = res.data.version_id;
          this.api.getVersion(this.versionId!).subscribe({
            next: (vRes: any) => {
              // Load scope notes
              this.scopeNotes = vRes.data.version?.scope_notes || '';
              const draftRows: SizingRow[] = vRes.data.rows;

              if (draftRows.length > 0) {
                const labels = new Set<string>();
                draftRows.forEach(r => Object.keys(r.quarters).forEach(l => {
                  if (r.quarters[l] !== null && r.quarters[l] !== undefined) labels.add(l);
                }));
                if (labels.size > 0) {
                  this.quarters = this.availableQuarters
                    .filter(q => labels.has(q.label))
                    .sort((a, b) => a.fiscal_year !== b.fiscal_year ? a.fiscal_year - b.fiscal_year : a.quarter - b.quarter);
                }
                this.rows = draftRows;
              }
              this.finishLoading();
            },
            error: () => this.finishLoading()
          });
        } else {
          // No draft — show baseline rows as starting point if available
          if (this.baselineRows.length > 0) {
            this.rows = this.baselineRows.map(r => ({ ...r, quarters: { ...r.quarters } }));
            const labels = new Set<string>();
            this.rows.forEach(r => Object.keys(r.quarters).forEach(l => labels.add(l)));
            if (labels.size > 0) {
              this.quarters = this.availableQuarters
                .filter(q => labels.has(q.label))
                .sort((a, b) => a.fiscal_year !== b.fiscal_year ? a.fiscal_year - b.fiscal_year : a.quarter - b.quarter);
            }
          }
          this.finishLoading();
        }
      },
      error: () => this.finishLoading()
    });
  }

  // Merge draft rows with baseline: draft rows take priority, baseline rows
  // that are not in the draft are shown as read-only context
  mergeDraftWithBaseline(draftRows: SizingRow[]): SizingRow[] {
    if (!this.baselineRows.length) return draftRows;

    // Add any baseline rows that are NOT already in the draft
    const baselineOnly = this.baselineRows.filter(b =>
      !draftRows.some(d =>
        d.function_contact === b.function_contact &&
        d.location === b.location &&
        d.hc_type === b.hc_type
      )
    );

    // Return draft rows first (what PM is actively editing), then baseline-only rows
    return [...draftRows, ...baselineOnly.map(r => ({ ...r, quarters: { ...r.quarters } }))];
  }

  finishLoading() {
    if (this.rows.length === 0) this.addRow();
    this.filteredRows = [...this.rows];
    this.loading = false;
    this.cdr.detectChanges();
    this.resizeAllTextareas(); // resize after data loads
  }

  addRow() {
    const row: SizingRow = { function_contact: '', location: '', hc_type: '', manager_name: '', scope: '', assumptions: '', risks: '', notes: '', quarters: {} };
    this.quarters.forEach(q => row.quarters[q.label] = null);
    this.rows = [...this.rows, row];
    this.applyRowFilters(); // keep filteredRows in sync
  }

  removeRow(i: number) {
    // Remove from rows by matching the actual row object
    const rowToRemove = this.filteredRows[i];
    this.rows = this.rows.filter(r => r !== rowToRemove);
    this.applyRowFilters();
  }
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

  // ── Documents tab ──
  // ── Documents tab ──
  docUrl = '';
  docUrlLabel = '';
  docFiles: File[] = [];
  showLinkInput = false;
  savedDocs: { doc_id: number; doc_type: string; doc_label: string; doc_url: string; file_name: string; created_at: string }[] = [];
  activeDoc: any = null;

  selectDoc(doc: any) {
    this.activeDoc = this.activeDoc?.doc_id === doc.doc_id ? null : doc;
  }

  isOfficeFile(url: string): boolean {
    return /\.(pptx?|docx?|xlsx?)$/i.test(url || '');
  }

  isPdf(url: string): boolean {
    return /\.pdf$/i.test(url || '');
  }

  isSharePointUrl(url: string): boolean {
    return url?.includes('sharepoint.com') || url?.includes('onedrive.live.com');
  }

  getEmbedUrl(url: string): SafeResourceUrl {
    let embedUrl = url;
    // Office Online only works for SharePoint/OneDrive URLs (publicly reachable by Microsoft)
    if (this.isSharePointUrl(url)) {
      const encoded = encodeURIComponent(url);
      embedUrl = `https://view.officeapps.live.com/op/embed.aspx?src=${encoded}`;
    }
    return this.sanitizer.bypassSecurityTrustResourceUrl(embedUrl);
  }

  getFileDownloadUrl(doc: any): string {
    return doc.doc_url || '';
  }

  loadDocuments() {
    this.api.getProjectDocuments(this.projectId).subscribe({
      next: (res: any) => { this.savedDocs = res.data || []; },
      error: () => {}
    });
  }

  saveDocLink() {
    if (!this.docUrl) return;
    this.api.saveDocumentLink(this.projectId, {
      doc_label: this.docUrlLabel || this.docUrl,
      doc_url: this.docUrl,
    }).subscribe({
      next: () => {
        this.showLinkInput = false;
        this.docUrl = '';
        this.docUrlLabel = '';
        this.loadDocuments();
        this.snackBar.open('Link saved', 'Close', { duration: 2000, horizontalPosition: 'end', verticalPosition: 'top' });
      },
      error: () => this.snackBar.open('Failed to save link', 'Close', { duration: 3000, panelClass: ['snack-error'], horizontalPosition: 'end', verticalPosition: 'top' })
    });
  }

  openDocInNewTab() {
    if (this.docUrl) window.open(this.docUrl, '_blank');
  }

  openSavedDoc(doc: any) {
    if (doc.doc_url) window.open(doc.doc_url, '_blank');
  }

  deleteSavedDoc(doc: any) {
    this.api.deleteDocument(doc.doc_id).subscribe({
      next: () => { this.loadDocuments(); },
      error: () => {}
    });
  }

  onDocFilesSelected(event: Event) {
    const files = (event.target as HTMLInputElement).files;
    if (!files || files.length === 0) return;
    Array.from(files).forEach(file => {
      this.api.uploadDocumentFile(this.projectId, file).subscribe({
        next: () => {
          this.loadDocuments();
          this.snackBar.open(`"${file.name}" uploaded`, 'Close', { duration: 2000, horizontalPosition: 'end', verticalPosition: 'top' });
        },
        error: () => this.snackBar.open(`Failed to upload "${file.name}"`, 'Close', { duration: 3000, panelClass: ['snack-error'], horizontalPosition: 'end', verticalPosition: 'top' })
      });
    });
  }

  removeDocFile(file: File) {
    this.docFiles = this.docFiles.filter(f => f !== file);
  }

  getFileIcon(name: string): string {
    const ext = name.split('.').pop()?.toLowerCase();
    if (['ppt','pptx'].includes(ext || '')) return 'slideshow';
    if (['pdf'].includes(ext || '')) return 'picture_as_pdf';
    if (['xlsx','xls'].includes(ext || '')) return 'table_chart';
    if (['doc','docx'].includes(ext || '')) return 'description';
    return 'attach_file';
  }

  formatFileSize(bytes: number): string {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  // ── Aggregate summary (all filtered rows) ──
  getTotalSumHC(): number {
    return this.filteredRows.reduce((total, row) => total + this.getRowSumHC(row), 0);
  }

  getTotalPeakHC(): number {
    // Max HC in any single quarter across all rows combined
    const maxPerQuarter = this.quarters.map(q =>
      this.filteredRows.reduce((sum, row) => sum + (Number(row.quarters[q.label]) || 0), 0)
    );
    return Math.max(...maxPerQuarter, 0);
  }

  getTotalCostFormatted(): string {
    const cost = this.getTotalCost();
    return '$' + cost.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  getTotalCost(): number {
    const rateMap: Record<string, number> = {
      'Canada': 30138, 'US': 30138, 'USA': 30138,
      'India Bangalore': 12203, 'India Hyderabad': 12203,
      'China Shanghai': 27275, 'Global': 31000, 'Taiwan': 24975
    };
    return Math.round(this.filteredRows.reduce((total, row) => {
      const rate = rateMap[row.location] || 20000;
      return total + this.getRowSumHC(row) * rate;
    }, 0));
  }

  // ── Row summary helpers ──
  getRowSumHC(row: SizingRow): number {
    return this.quarters.reduce((sum, q) => sum + (Number(row.quarters[q.label]) || 0), 0);
  }

  getRowPeakHC(row: SizingRow): number {
    return Math.max(...this.quarters.map(q => Number(row.quarters[q.label]) || 0), 0);
  }

  getRowCost(row: SizingRow): string {
    // Find rate for this row's project + location
    const sumHC = this.getRowSumHC(row);
    if (sumHC === 0) return '—';
    // Use project rates from memory (loaded separately in future; for now estimate)
    const rateMap: Record<string, number> = {
      'Canada': 30138, 'US': 30138, 'USA': 30138,
      'India Bangalore': 12203, 'India Hyderabad': 12203,
      'China Shanghai': 27275, 'Global': 31000, 'Taiwan': 24975
    };
    const rate = rateMap[row.location] || 20000;
    const cost = sumHC * rate;
    const rounded = Math.round(cost);
    return '$' + rounded.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  // ── Diff helpers — compare current draft row against baseline ──

  isRowNew(row: SizingRow): boolean {
    if (!this.baselineRows.length) return false;
    return !this.baselineRows.some(b =>
      b.function_contact === row.function_contact &&
      b.location === row.location &&
      b.hc_type === row.hc_type
    );
  }

  isRowModified(row: SizingRow): boolean {
    if (!this.baselineRows.length || this.isRowNew(row)) return false;
    const baseline = this.baselineRows.find(b =>
      b.function_contact === row.function_contact &&
      b.location === row.location &&
      b.hc_type === row.hc_type
    );
    if (!baseline) return false;
    // Check if any quarter value changed
    for (const q of this.quarters) {
      const draftVal = Number(row.quarters[q.label] || 0);
      const baseVal = Number(baseline.quarters?.[q.label] || 0);
      if (draftVal !== baseVal) return true;
    }
    return false;
  }

  get unsavedChangeCount(): number {
    return this.rows.filter(r => this.isRowNew(r) || this.isRowModified(r)).length;
  }
}
