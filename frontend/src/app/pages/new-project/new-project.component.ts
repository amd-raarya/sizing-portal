import { Component, OnInit, Input, Output, EventEmitter, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDividerModule } from '@angular/material/divider';
import { TextFieldModule } from '@angular/cdk/text-field';
import { ApiService } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';


@Component({
  selector: 'app-new-project',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    MatFormFieldModule, MatInputModule, MatSelectModule, MatButtonModule,
    MatIconModule, MatSlideToggleModule, MatDatepickerModule, MatNativeDateModule,
    MatSnackBarModule, MatProgressSpinnerModule, MatTooltipModule, MatDividerModule,
    TextFieldModule
  ],
  template: `
    <!-- Full-screen modal -->
    <div class="panel">
      <div class="panel-header">
        <div class="panel-title">
          <mat-icon>{{ isEditMode ? 'edit' : 'add_circle' }}</mat-icon>
          <span>{{ isEditMode ? 'Edit Project' : 'New Project' }}</span>
        </div>
        <button mat-icon-button (click)="close()"><mat-icon>close</mat-icon></button>
      </div>

      <div class="panel-body">

        <!-- ── Section 1: Basic Info ── -->
        <div class="section">
          <div class="section-label">Project Details</div>
          <div class="form-grid">

            <mat-form-field appearance="outline" class="field-full" [class.field-error]="submitted && !form.project_name">
              <mat-label>Project Name <span class="req">*</span></mat-label>
              <textarea matInput [(ngModel)]="form.project_name" placeholder="e.g. Android EAP v1.5"
                cdkTextareaAutosize cdkAutosizeMinRows="1" cdkAutosizeMaxRows="4"
                style="resize:none;line-height:1.5"></textarea>
              @if (submitted && !form.project_name) {
                <mat-error>Required</mat-error>
              }
            </mat-form-field>

            <mat-form-field appearance="outline" class="field-third" [class.field-error]="submitted && !form.BU">
              <mat-label>BU <span class="req">*</span></mat-label>
              <input matInput [(ngModel)]="form.BU" placeholder="e.g. Embedded, Compute, PAVS">
              @if (submitted && !form.BU) { <mat-error>Required</mat-error> }
            </mat-form-field>

            <mat-form-field appearance="outline" class="field-two-thirds">
              <mat-label>Platform / Silicon / SOC</mat-label>
              <textarea matInput [(ngModel)]="form.platform" placeholder="e.g. Glacier Peak GPU, Strix SOC"
                cdkTextareaAutosize cdkAutosizeMinRows="1" cdkAutosizeMaxRows="4"
                style="resize:none;line-height:1.5"></textarea>
            </mat-form-field>

          </div>

          <!-- Advanced Details — collapsible -->
          <div class="advanced-toggle" (click)="showAdvanced = !showAdvanced">
            <mat-icon class="adv-icon">{{ showAdvanced ? 'expand_less' : 'expand_more' }}</mat-icon>
            <span>{{ showAdvanced ? 'Hide' : 'Show' }} Advanced Details</span>
            <span class="adv-hint">Category · Leader · Team</span>
          </div>

          @if (showAdvanced) {
            <div class="form-grid" style="margin-top:12px">
              <mat-form-field appearance="outline" class="field-half">
                <mat-label>Category</mat-label>
                <input matInput [(ngModel)]="form.category" placeholder="e.g. PlatLinux">
              </mat-form-field>

              <mat-form-field appearance="outline" class="field-half">
                <mat-label>Leader</mat-label>
                <input matInput [(ngModel)]="form.leader" placeholder="e.g. Smith, Christopher">
              </mat-form-field>

              <mat-form-field appearance="outline" class="field-full">
                <mat-label>Top Level Team</mat-label>
                <input matInput [(ngModel)]="form.top_level_team" placeholder="e.g. SPG_Platform_Linux">
              </mat-form-field>
            </div>
          }
        </div>

        <mat-divider></mat-divider>

        <!-- ── Section 2: Settings ── -->
        <div class="section">
          <div class="section-label">Settings</div>
          <div class="form-grid">
            <div class="status-locked field-half">
              <span class="status-locked-label">Initial Status</span>
              <span class="status-locked-value">
                <span class="status-chip-pipeline">● Pipeline</span>
                </span>
            </div>

            <mat-form-field appearance="outline" class="field-half">
              <mat-label>Sizing Deadline</mat-label>
              <input matInput [matDatepicker]="deadlinePicker" [(ngModel)]="form.sizing_deadline"
                placeholder="Select date">
              <mat-datepicker-toggle matIconSuffix [for]="deadlinePicker"></mat-datepicker-toggle>
              <mat-datepicker #deadlinePicker></mat-datepicker>
              <mat-hint>Draft auto-submitted after this date</mat-hint>
            </mat-form-field>

            <div class="toggle-row techprotect-disabled" matTooltip="Techprotect — coming soon">
              <mat-slide-toggle [disabled]="true" color="warn">
                <span class="toggle-label" style="opacity:0.4">
                  <mat-icon class="tp-icon">lock</mat-icon>
                  Techprotect
                </span>
              </mat-slide-toggle>
              <span class="coming-soon-badge">Coming Soon</span>
            </div>
          </div>
        </div>

        <mat-divider></mat-divider>

        <!-- ── Section 3: Location Rates ── -->
        <div class="section">
          <div class="section-label">
            Location Rates
            <span class="optional-tag">Optional</span>
          </div>
          <p class="section-desc">AMD standard rates pre-loaded. Select locations relevant to this project. Edit rates if your project uses different values.</p>

          <div class="rates-grid">
            @for (rate of form.rates; track rate.location; let i = $index) {
              <div class="rate-row">
                <mat-form-field appearance="outline" class="rate-loc-field">
                  <mat-label>Location</mat-label>
                  <mat-select [(ngModel)]="rate.location" (ngModelChange)="onRateLocationChange(i)">
                    @for (loc of allLocations; track loc) {
                      <mat-option [value]="loc">{{ loc }}</mat-option>
                    }
                  </mat-select>
                </mat-form-field>
                <mat-form-field appearance="outline" class="rate-val-field">
                  <mat-label>Rate / Qtr</mat-label>
                  <span matPrefix style="color:#555;font-weight:600;padding-right:4px">$</span>
                  <input matInput type="number" [(ngModel)]="rate.rate_per_quarter">
                </mat-form-field>
                <button mat-icon-button color="warn" (click)="removeRate(i)" matTooltip="Remove">
                  <mat-icon>close</mat-icon>
                </button>
              </div>
            }
          </div>

          <div class="rate-actions">
            <button mat-stroked-button (click)="addRate()">
              <mat-icon>add</mat-icon> Add Location
            </button>
            <button mat-stroked-button (click)="preloadAllRates()" matTooltip="Add all AMD standard locations">
              <mat-icon>auto_fix_high</mat-icon> Load All Standard Rates
            </button>
          </div>
        </div>

        <mat-divider></mat-divider>

        <!-- ── Section 3: Change Request Linking ── -->
        <div class="section">
          <div class="section-label">
            Change Request (CR) Linking
            <span class="optional-tag">Optional</span>
          </div>
          <p class="section-desc">If this project is an incremental CR of an existing project, link it here. The parent's approved sizing will load as baseline.</p>
          <mat-form-field appearance="outline" class="field-full parent-project-field">
            <mat-label>Parent Project (CR of)</mat-label>
            <mat-select [(ngModel)]="form.parent_project_id" (ngModelChange)="onParentSelected()" panelWidth="560px">
              <div class="select-search-wrap">
                <input class="select-search-input" [(ngModel)]="parentProjectSearch"
                  placeholder="Search project…"
                  (click)="$event.stopPropagation()"
                  (keydown)="$event.stopPropagation()">
              </div>
              <mat-option [value]="null">— Not a CR —</mat-option>
              @for (p of filteredMetaProjects; track p.project_id) {
                <mat-option [value]="p.project_id">
                  {{ p.project_name }} ({{ p.project_code }})
                </mat-option>
              }
            </mat-select>
          </mat-form-field>
          @if (form.parent_project_id) {
            <div class="cr-info">
              <mat-icon class="cr-icon">link</mat-icon>
              <span>This project will inherit <strong>{{ getParentName() }}</strong>'s approved sizing as baseline. PMs can add or reduce HC incrementally.</span>
            </div>
          }
        </div>

        <mat-divider></mat-divider>

        <!-- ── Section 4: Documents ── -->
        <div class="section">
          <div class="section-label">
            Documents
            <span class="optional-tag">Optional</span>
          </div>
          <p class="section-desc">Attach a document or paste a SharePoint / web link. PMs can view these in the Documents tab.</p>

          <!-- Upload Files -->
          <div class="doc-section-label"><mat-icon>upload_file</mat-icon> Upload Files</div>
          <div class="upload-zone" (click)="mprsInput.click()">
            <mat-icon>upload_file</mat-icon>
            <span>Click to upload documents</span>
            <span class="upload-hint">Any format · Max 50MB · Multiple files supported</span>
          </div>
          <input #mprsInput type="file" accept="*" multiple style="display:none" (change)="onMprsSelected($event)">

          <!-- Selected files list -->
          @for (f of _selectedFiles; track f.name) {
            <div class="doc-item-preview">
              <mat-icon class="doc-prev-icon">description</mat-icon>
              <span class="doc-prev-name">{{ f.name }}</span>
              <button mat-icon-button (click)="removeSelectedFile(f)">
                <mat-icon>close</mat-icon>
              </button>
            </div>
          }

          <!-- Paste Link -->
          <div class="doc-section-label" style="margin-top:16px"><mat-icon>link</mat-icon> Paste SharePoint / Web Link</div>
          <div class="link-input-wrap">
            <mat-icon class="link-icon">insert_link</mat-icon>
            <input class="link-input" type="url" [(ngModel)]="form.doc_link"
              placeholder="https://amd.sharepoint.com/sites/..."
              (input)="onDocLinkInput()"/>
            @if (form.doc_link) {
              <button mat-icon-button class="clear-file" (click)="form.doc_link = ''; form.doc_link_label = ''">
                <mat-icon>close</mat-icon>
              </button>
            }
          </div>
          @if (form.doc_link) {
            <div class="link-label-wrap">
              <input class="link-label-input" type="text" [(ngModel)]="form.doc_link_label"
                placeholder="Display name (e.g. Sam's Sizing Sheet Q3 FY26)"/>
            </div>
            <div class="link-preview">
              <mat-icon class="preview-icon">open_in_new</mat-icon>
              <a [href]="form.doc_link" target="_blank" class="preview-link">{{ form.doc_link_label || form.doc_link }}</a>
            </div>
          }
        </div>

        <mat-divider></mat-divider>

        <!-- ── Section 5: PM Assignment ── -->
        <div class="section">
          <div class="section-label">PM Assignment</div>
          @if (isElevated) {
            <p class="section-desc">Select a PM to assign to this project, or leave unassigned.</p>
            <mat-form-field appearance="outline" class="field-full pm-assign-field">
              <mat-label>Assign PM User</mat-label>
              <mat-select [(ngModel)]="form.assigned_pm_user_id" [placeholder]="'— Assign later —'" panelWidth="560px">
                <div class="select-search-wrap">
                  <input class="select-search-input" [(ngModel)]="pmUserSearch"
                    placeholder="Search PM…"
                    (click)="$event.stopPropagation()"
                    (keydown)="$event.stopPropagation()">
                </div>
                <mat-option [value]="null">— Assign later —</mat-option>
                @for (u of filteredPmUsers; track u.pm_user_id) {
                  <mat-option [value]="u.pm_user_id">
                    {{ u.display_name }}
                  </mat-option>
                }
              </mat-select>
            </mat-form-field>
          } @else {
            <div class="auto-assign-info">
              <mat-icon>person_pin</mat-icon>
              <span>You will be automatically assigned as the PM for this project with full edit and submit access.</span>
            </div>
          }
        </div>

      </div>

      <!-- Panel footer -->
      <div class="panel-footer">
        <button mat-stroked-button (click)="close()">Cancel</button>
        <button mat-flat-button color="primary" (click)="createProject()"
          [disabled]="saving || !isFormValid()">
          @if (saving) { <mat-spinner diameter="18"></mat-spinner> }
          @else { <ng-container><mat-icon>check</mat-icon> {{ isEditMode ? 'Save Changes' : 'Create Project' }}</ng-container> }
        </button>
      </div>
    </div>
  `,
  styles: [`
    /* Full-screen panel */
    .panel {
      position: fixed; inset: 0;
      background: #f5f6fa; z-index: 1000;
      display: flex; flex-direction: column;
      animation: fadeIn 0.18s ease-out;
    }
    @keyframes fadeIn {
      from { opacity: 0; transform: scale(0.98); }
      to   { opacity: 1; transform: scale(1); }
    }

    /* Header */
    .panel-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 14px 32px; border-bottom: 1px solid #e0e0e0;
      background: #1a1a2e; color: white; flex-shrink: 0;
    }
    .panel-title { display: flex; align-items: center; gap: 10px; font-size: 17px; font-weight: 600; }
    .panel-title mat-icon { color: #ED1C24; }
    .panel-header button { color: white; }

    /* Body — centered content with max-width for readability */
    .panel-body { flex: 1; overflow-y: auto; padding: 0; }

    /* Sections — wider, two-column layout */
    .section { padding: 24px 32px; max-width: 1200px; margin: 0 auto; }
    .section-label {
      font-size: 12px; font-weight: 700; color: #999;
      text-transform: uppercase; letter-spacing: 0.8px;
      margin-bottom: 14px; display: flex; align-items: center; gap: 8px;
    }
    .optional-tag { font-size: 10px; background: #f0f0f0; color: #aaa; padding: 1px 6px; border-radius: 8px; font-weight: 400; text-transform: none; letter-spacing: 0; }
    .section-desc { font-size: 12px; color: #888; margin: -8px 0 14px; line-height: 1.5; }

    /* Form grid — 3 columns on full-screen */
    .form-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
    .field-full       { grid-column: 1 / -1; }    /* spans all 3 */
    .field-half       { grid-column: span 1; }    /* 1 of 3 */
    .field-third      { grid-column: span 1; }    /* 1 of 3 */
    .field-two-thirds { grid-column: span 2; }    /* 2 of 3 */
    .field-full ::ng-deep .mat-mdc-form-field-subscript-wrapper,
    .field-half ::ng-deep .mat-mdc-form-field-subscript-wrapper,
    .field-third ::ng-deep .mat-mdc-form-field-subscript-wrapper,
    .field-two-thirds ::ng-deep .mat-mdc-form-field-subscript-wrapper { min-height: 14px; }

    /* Single-line mat-options — no wrapping */
    ::ng-deep .single-line-option .mdc-list-item__primary-text {
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block;
    }

    /* Parent project + PM fields — full width, no truncation */
    .parent-project-field, .pm-assign-field { width: 100%; }
    .parent-project-field ::ng-deep .mat-mdc-select-trigger,
    .pm-assign-field ::ng-deep .mat-mdc-select-trigger { width: 100%; }
    .parent-project-field ::ng-deep .mat-mdc-select-value,
    .pm-assign-field ::ng-deep .mat-mdc-select-value {
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%;
    }

    /* Inline search inside mat-select panel */
    .select-search-wrap {
      padding: 8px 12px 6px; border-bottom: 1px solid #f0f0f0;
      position: sticky; top: 0; background: white; z-index: 1;
    }
    .select-search-input {
      width: 100%; box-sizing: border-box;
      border: 1px solid #e0e0e0; border-radius: 4px;
      padding: 6px 10px; font-size: 13px; font-family: inherit;
      outline: none; color: #333;
    }
    .select-search-input:focus { border-color: #1565c0; }

    /* Locked status */
    .status-locked { display: flex; flex-direction: column; gap: 4px; padding: 10px 0; }
    .status-locked-label { font-size: 11px; color: #888; text-transform: uppercase; letter-spacing: 0.5px; }
    .status-locked-value { display: flex; align-items: center; gap: 10px; }
    .status-chip-pipeline { background: #e3f2fd; color: #1565c0; padding: 4px 12px; border-radius: 12px; font-size: 13px; font-weight: 600; }
    .status-locked-hint { font-size: 11px; color: #aaa; }

    .techprotect-disabled { opacity: 0.5; cursor: not-allowed; }
    .coming-soon-badge { font-size: 10px; background: #f0f0f0; color: #999; padding: 2px 8px; border-radius: 10px; border: 1px solid #e0e0e0; font-weight: 600; letter-spacing: 0.3px; }
    /* Techprotect toggle */
    .toggle-row { width: 100%; display: flex; flex-direction: column; gap: 6px; }
    .toggle-label { display: flex; align-items: center; gap: 6px; font-size: 14px; }
    .tp-icon { font-size: 18px; width: 18px; height: 18px; color: #ED1C24; }
    .toggle-hint { font-size: 11px; color: #ED1C24; opacity: 0; transition: opacity 0.2s; }
    .toggle-hint.visible { opacity: 1; }

    /* CR info */
    .cr-info { display: flex; align-items: flex-start; gap: 8px; background: #e3f2fd; border-radius: 6px; padding: 10px 14px; font-size: 13px; color: #1565c0; margin-top: 8px; }
    .cr-icon { font-size: 18px; width: 18px; height: 18px; flex-shrink: 0; margin-top: 1px; }

    /* MPRS upload */
    .upload-zone {
      border: 2px dashed #ddd; border-radius: 8px; padding: 24px 16px;
      text-align: center; cursor: pointer; transition: all 0.2s;
      display: flex; flex-direction: column; align-items: center; gap: 6px;
      color: #aaa; font-size: 13px;
    }
    .upload-zone:hover { border-color: #1976d2; color: #1976d2; background: #f0f7ff; }
    .upload-zone mat-icon { font-size: 36px; width: 36px; height: 36px; }
    .upload-zone.has-file { border-color: #4caf50; color: #2e7d32; background: #f0fff4; border-style: solid; }
    .upload-hint { font-size: 11px; color: #bbb; }
    .file-name { font-weight: 600; }
    .clear-file { position: absolute; }

    /* Doc tabs */
    /* Advanced toggle */
    .advanced-toggle { display: flex; align-items: center; gap: 8px; margin-top: 10px; padding: 8px 10px; border-radius: 6px; cursor: pointer; font-size: 12px; color: #666; background: #f8f9fa; border: 1px solid #e8e8e8; user-select: none; transition: background 0.12s; }
    .advanced-toggle:hover { background: #f0f0f0; color: #333; }
    .adv-icon { font-size: 16px; width: 16px; height: 16px; color: #999; }
    .adv-hint { font-size: 11px; color: #bbb; margin-left: auto; }
    /* Required field asterisk */
    .req { color: #ED1C24; font-weight: 700; }
    /* Field error highlight */
    .field-error ::ng-deep .mat-mdc-notched-outline .mat-mdc-notched-outline-notch,
    .field-error ::ng-deep .mat-mdc-notched-outline .mat-mdc-notched-outline-leading,
    .field-error ::ng-deep .mat-mdc-notched-outline .mat-mdc-notched-outline-trailing { border-color: #ED1C24 !important; border-width: 2px !important; }
    /* Rates grid — 3 columns, no scroll box */
    .rates-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px 16px; margin-bottom: 12px; }
    .rate-row { display: flex; align-items: center; gap: 8px; }
    .rate-actions { display: flex; gap: 10px; margin-top: 4px; }
    .rate-loc-field { flex: 1.6; min-width: 0; }
    .rate-val-field { flex: 1; min-width: 100px; }
    .rate-loc-field ::ng-deep .mat-mdc-form-field-subscript-wrapper,
    .rate-val-field ::ng-deep .mat-mdc-form-field-subscript-wrapper { display: none; }
    .doc-section-label { display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; color: #555; margin-bottom: 8px; }
    .doc-section-label mat-icon { font-size: 16px; width: 16px; height: 16px; color: #1a1a2e; }
    .doc-item-preview { display: flex; align-items: center; gap: 8px; padding: 6px 10px; background: #f0f7ff; border-radius: 6px; margin-top: 6px; font-size: 13px; }
    .doc-prev-icon { font-size: 18px; width: 18px; height: 18px; color: #1565c0; flex-shrink: 0; }
    .doc-prev-name { flex: 1; color: #333; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .doc-tabs { display: flex; gap: 0; margin-bottom: 12px; border: 1px solid #e0e0e0; border-radius: 8px; overflow: hidden; }
    .doc-tab { flex: 1; padding: 9px 12px; border: none; background: white; cursor: pointer; font-size: 13px; color: #888; display: flex; align-items: center; justify-content: center; gap: 6px; transition: all 0.15s; font-family: inherit; }
    .doc-tab mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .doc-tab:first-child { border-right: 1px solid #e0e0e0; }
    .doc-tab.active { background: #1a1a2e; color: white; font-weight: 600; }
    .doc-tab:hover:not(.active) { background: #f5f5f5; color: #333; }

    /* Link input */
    .link-input-wrap { display: flex; align-items: center; gap: 8px; border: 1.5px solid #ddd; border-radius: 8px; padding: 8px 12px; transition: border 0.15s; }
    .link-input-wrap:focus-within { border-color: #1a1a2e; }
    .link-icon { font-size: 20px; width: 20px; height: 20px; color: #aaa; flex-shrink: 0; }
    .link-input { flex: 1; border: none; outline: none; font-size: 13px; color: #333; font-family: inherit; background: transparent; }
    .link-label-wrap { margin-top: 8px; }
    .link-label-input { width: 100%; box-sizing: border-box; border: 1.5px solid #ddd; border-radius: 8px; padding: 8px 12px; font-size: 13px; color: #333; font-family: inherit; outline: none; transition: border 0.15s; }
    .link-label-input:focus { border-color: #1a1a2e; }
    .link-label-input::placeholder { color: #bbb; }
    .link-preview { display: flex; align-items: center; gap: 6px; margin-top: 10px; padding: 8px 12px; background: #f8f9fa; border-radius: 6px; border: 1px solid #e8e8e8; }
    .preview-icon { font-size: 16px; width: 16px; height: 16px; color: #1565c0; flex-shrink: 0; }
    .preview-link { font-size: 12px; color: #1565c0; text-decoration: none; word-break: break-all; }
    .preview-link:hover { text-decoration: underline; }

    /* Auto-assign info */
    .auto-assign-info { display: flex; align-items: center; gap: 10px; background: #f0f7ff; border-radius: 6px; padding: 12px 14px; font-size: 13px; color: #1565c0; }
    .auto-assign-info mat-icon { color: #1565c0; }

    /* Footer — sticky at bottom of full-screen */
    .panel-footer {
      display: flex; justify-content: flex-end; gap: 12px;
      padding: 16px 32px; border-top: 1px solid #e8e8e8;
      background: white; flex-shrink: 0;
    }
  `]
})
export class NewProjectComponent implements OnInit {
  @Input() editProject: any = null; // pre-filled project for edit mode
  @Output() closed = new EventEmitter<boolean>(); // true = project created/updated

  metaPmUsers: any[] = [];
  metaProjects: any[] = [];
  parentProjectSearch = '';
  pmUserSearch = '';

  get filteredMetaProjects(): any[] {
    const term = this.parentProjectSearch.toLowerCase().trim();
    if (!term) return this.metaProjects;
    return this.metaProjects.filter(p =>
      p.project_name.toLowerCase().includes(term) ||
      (p.project_code || '').toLowerCase().includes(term)
    );
  }

  get filteredPmUsers(): any[] {
    const term = this.pmUserSearch.toLowerCase().trim();
    if (!term) return this.metaPmUsers;
    return this.metaPmUsers.filter(u =>
      (u.display_name || '').toLowerCase().includes(term)
    );
  }
  saving = false;
  isEditMode = false;

  // Determine if current user has elevated access — from AuthService
  get isElevated(): boolean { return this.auth.isElevated(); }

  docInputMode: 'upload' | 'link' = 'upload';
  _selectedFile: File | null = null;
  _selectedFiles: File[] = [];

  removeSelectedFile(f: File) {
    this._selectedFiles = this._selectedFiles.filter(x => x !== f);
    if (this._selectedFile === f) this._selectedFile = null;
  }

  onDocLinkInput() {
    // Auto-generate a label from the URL if none set yet
    if (!this.form.doc_link_label && this.form.doc_link) {
      try {
        const url = new URL(this.form.doc_link);
        const parts = url.pathname.split('/').filter(Boolean);
        this.form.doc_link_label = parts[parts.length - 1]?.replace(/%20/g, ' ') || url.hostname;
      } catch { /* invalid URL — leave label blank */ }
    }
  }

  submitted = false;
  showAdvanced = false; // Advanced details panel (category, leader, team, platform) — collapsed by default

  form = {
    project_name: '',
    project_code: '',
    BU: '',
    category: 'PlatLinux',
    leader: 'Smith, Christopher',
    top_level_team: 'SPG_Platform_Linux',
    platform: '',
    status: 'pipeline',
    sizing_deadline: null as Date | null,
    parent_project_id: null as number | null,
    is_techprotect: false,
    assigned_pm_user_id: null as number | null,
    mprs_file_name: null as string | null,
    mprs_file_segment: null as string | null,
    doc_link: '',
    doc_link_label: '',
    rates: [] as { location: string; rate_per_quarter: number }[],
  };

  // Full AMD labor rate LUT (from spreadsheet)
  readonly standardRates: Record<string, number> = {
    'USA':                        57001,
    'Bulgaria':                   30453,
    'Greece':                     30453,
    'Brazil':                     30453,
    'Mexico':                     30453,
    'Argentina':                  30453,
    'Canada':                     30138,
    'India Hyderabad':            12203,
    'Australia':                  30453,
    'Japan':                      26139,
    'Taiwan':                     24975,
    'Serbia':                     17894,
    'France':                     53696,
    'Germany':                    35285,
    'Italy':                      41547,
    'Sweden':                     50477,
    'UK':                         55809,
    'Spain':                      39047,
    'Poland':                     25848,
    'Netherlands':                27870,
    'India Bangalore':            12203,
    'China Shanghai':             27275,
    'China Beijing and Shenzhen': 27275,
    'Global':                     31000,
  };

  readonly allLocations = Object.keys(this.standardRates);

  addRate() {
    this.form.rates.push({ location: '', rate_per_quarter: 0 });
  }

  removeRate(i: number) {
    this.form.rates.splice(i, 1);
  }

  onRateLocationChange(i: number) {
    const loc = this.form.rates[i].location;
    if (loc && this.standardRates[loc]) {
      this.form.rates[i].rate_per_quarter = this.standardRates[loc];
    }
  }

  preloadAllRates() {
    // Add all standard locations not already in the list
    const existing = new Set(this.form.rates.map(r => r.location));
    for (const [loc, rate] of Object.entries(this.standardRates)) {
      if (!existing.has(loc)) {
        this.form.rates.push({ location: loc, rate_per_quarter: rate });
      }
    }
  }

  constructor(private api: ApiService, private snackBar: MatSnackBar, private cdr: ChangeDetectorRef, private auth: AuthService) {}

  ngOnInit() {
    // Pre-fill form if editing an existing project
    if (this.editProject) {
      this.isEditMode = true;
      this.showAdvanced = true; // show advanced fields when editing
      this.form.project_name = this.editProject.project_name || '';
      this.form.project_code = this.editProject.project_code || '';
      this.form.BU = this.editProject.BU || '';
      this.form.category = this.editProject.category || '';
      this.form.leader = this.editProject.leader || '';
      this.form.top_level_team = this.editProject.top_level_team || '';
      this.form.platform = this.editProject.platform || '';
      this.form.status = this.editProject.status || 'pipeline';
      this.form.parent_project_id = this.editProject.parent_project_id || null;
      this.form.is_techprotect = !!this.editProject.is_techprotect;
      if (this.editProject.sizing_deadline) {
        this.form.sizing_deadline = new Date(this.editProject.sizing_deadline);
      }
      // Pre-fill assigned PM if available
      if (this.editProject.assigned_pm_user_id) {
        this.form.assigned_pm_user_id = this.editProject.assigned_pm_user_id;
      }
    }

    this.api.getProjectFormMeta().subscribe({
      next: (res: any) => {
        this.metaPmUsers = res.data.pmUsers || [];
        // Exclude current project from parent dropdown in edit mode
        this.metaProjects = (res.data.projects || []).filter(
          (p: any) => {
            const notSelf = !this.editProject || p.project_id !== this.editProject.project_id;
            const eligibleStatus = ['active', 'closed'].includes(p.status); // only funded/closed can be parents
            return notSelf && eligibleStatus;
          }
        );
        this.cdr.detectChanges();
      },
      error: () => {}
    });
  }

  isFormValid(): boolean {
    // Category, Leader, Top Level Team have defaults — only project_name and BU are truly required
    return !!(this.form.project_name && this.form.BU);
  }

  getParentName(): string {
    const p = this.metaProjects.find(p => p.project_id === this.form.parent_project_id);
    return p ? p.project_name : '';
  }

  onParentSelected() {
    if (this.form.parent_project_id) {
      const parent = this.metaProjects.find(p => p.project_id === this.form.parent_project_id);
      if (parent) {
        // Try to increment version number (e.g. v1.0 → v2.0)
        const incremented = parent.project_name.replace(/v(\d+\.\d+)/, (_: string, v: string) => {
          const parts = v.split('.');
          parts[0] = String(parseInt(parts[0]) + 1);
          return 'v' + parts.join('.');
        });
        // If name didn't change (no version pattern), append " - CR" to distinguish
        this.form.project_name = incremented !== parent.project_name
          ? incremented
          : parent.project_name + ' - CR';
      }
    }
  }

  onMprsSelected(event: Event) {
    const files = (event.target as HTMLInputElement).files;
    if (files && files.length > 0) {
      this._selectedFiles = [...this._selectedFiles, ...Array.from(files)];
      this._selectedFile = this._selectedFiles[0];
      this.form.mprs_file_name = this._selectedFiles.map(f => f.name).join(', ');
    }
    // Reset input so same file can be re-selected
    (event.target as HTMLInputElement).value = '';
  }

  clearMprs(event: Event) {
    event.stopPropagation();
    this._selectedFile = null;
    this._selectedFiles = [];
    this.form.mprs_file_name = null;
    this.form.mprs_file_segment = null;
  }

  createProject() {
    this.submitted = true;
    if (!this.isFormValid()) {
      this.snackBar.open('Please fill in all required fields', 'Close', {
        duration: 3000, horizontalPosition: 'end', verticalPosition: 'top', panelClass: ['snack-warn']
      });
      return;
    }
    this.saving = true;

    const payload: any = {
      ...this.form,
      sizing_deadline: this.form.sizing_deadline
        ? this.form.sizing_deadline.toISOString().split('T')[0]
        : null,
      is_techprotect: this.form.is_techprotect ? 1 : 0,
      created_by: this.auth.user()?.email || null,
    };

    // For non-elevated users (PMs), auto-assign them to the project they create.
    // Match login email against both email and alias_email in RA_people
    // (e.g. Phani logs in with phanimadhav.chamarty@amd.com but DB may also have pchamart@amd.com)
    if (!this.isElevated && !this.isEditMode) {
      const userEmail = (this.auth.user()?.email || '').toLowerCase();
      const pmUser = this.metaPmUsers.find(u => {
        const primary = (u.email || '').toLowerCase();
        const alias   = (u.alias_email || '').toLowerCase();
        return primary === userEmail || alias === userEmail;
      });
      if (pmUser) {
        payload.auto_assign_pm_user_id = pmUser.pm_user_id;
      }
    }

    const request = this.isEditMode
      ? this.api.updateProject(this.editProject.project_id, payload)
      : this.api.createProject(payload);

    const successMsg = this.isEditMode
      ? `Project "${this.form.project_name}" updated successfully!`
      : `Project "${this.form.project_name}" created successfully!`;

    request.subscribe({
      next: async (res: any) => {
        // Get project_id from response (create) or from existing project (edit)
        const projectId = res?.data?.project_id || res?.project_id || this.editProject?.project_id;

        const saves: Promise<any>[] = [];

        // Save document link if provided
        if (projectId && this.form.doc_link) {
          saves.push(this.api.saveDocumentLink(projectId, {
            doc_label: this.form.doc_link_label || this.form.doc_link,
            doc_url: this.form.doc_link,
          }).toPromise());
        }

        // Save location rates
        const validRates = this.form.rates.filter(r => r.location && r.rate_per_quarter > 0);
        if (projectId && validRates.length > 0) {
          saves.push(this.api.saveProjectRates(projectId, validRates).toPromise());
        }

        // Upload all selected files — wait for all to complete
        if (projectId && this._selectedFiles.length > 0) {
          this._selectedFiles.forEach(f => {
            saves.push(this.api.uploadDocumentFile(projectId, f).toPromise());
          });
        }

        // Wait for all secondary saves before closing panel
        if (saves.length > 0) {
          try { await Promise.allSettled(saves); } catch {}
        }

        this.saving = false;
        this.snackBar.open(successMsg, 'Close', {
          duration: 4000, horizontalPosition: 'end', verticalPosition: 'top'
        });
        this.closed.emit(true);
      },
      error: (err: any) => {
        this.saving = false;
        const msg = err.error?.error || (this.isEditMode ? 'Failed to update project' : 'Failed to create project');
        this.snackBar.open(msg, 'Close', {
          duration: 5000, horizontalPosition: 'end', verticalPosition: 'top',
          panelClass: ['snack-error']
        });
      }
    });
  }

  close() {
    this.closed.emit(false);
  }
}
