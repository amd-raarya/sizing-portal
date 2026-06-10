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
import { ApiService } from '../../services/api.service';

@Component({
  selector: 'app-new-project',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    MatFormFieldModule, MatInputModule, MatSelectModule, MatButtonModule,
    MatIconModule, MatSlideToggleModule, MatDatepickerModule, MatNativeDateModule,
    MatSnackBarModule, MatProgressSpinnerModule, MatTooltipModule, MatDividerModule
  ],
  template: `
    <!-- Backdrop -->
    <div class="panel-backdrop" (click)="close()"></div>

    <!-- Slide-over panel -->
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
            <mat-form-field appearance="outline" class="field-full">
              <mat-label>Project Name *</mat-label>
              <input matInput [(ngModel)]="form.project_name" placeholder="e.g. Android EAP v1.5">
            </mat-form-field>

            <mat-form-field appearance="outline" class="field-half">
              <mat-label>Project Code *</mat-label>
              <input matInput [(ngModel)]="form.project_code" placeholder="e.g. spg00.100">
            </mat-form-field>

            <mat-form-field appearance="outline" class="field-half">
              <mat-label>BU *</mat-label>
              <mat-select [(ngModel)]="form.BU">
                <mat-option value="Embedded">Embedded</mat-option>
                <mat-option value="Compute">Compute</mat-option>
                <mat-option value="Graphics">Graphics</mat-option>
                <mat-option value="AI">AI</mat-option>
              </mat-select>
            </mat-form-field>

            <mat-form-field appearance="outline" class="field-half">
              <mat-label>Category *</mat-label>
              <input matInput [(ngModel)]="form.category" placeholder="e.g. Platform">
            </mat-form-field>

            <mat-form-field appearance="outline" class="field-half">
              <mat-label>Leader *</mat-label>
              <input matInput [(ngModel)]="form.leader" placeholder="e.g. Jeff Weyman">
            </mat-form-field>

            <mat-form-field appearance="outline" class="field-full">
              <mat-label>Top Level Team *</mat-label>
              <input matInput [(ngModel)]="form.top_level_team" placeholder="e.g. SPG_Platform_Linux">
            </mat-form-field>
          </div>
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

            <div class="toggle-row">
              <mat-slide-toggle [(ngModel)]="form.is_techprotect" color="warn">
                <span class="toggle-label">
                  <mat-icon class="tp-icon">lock</mat-icon>
                  Techprotect
                </span>
              </mat-slide-toggle>
              <span class="toggle-hint" [class.visible]="form.is_techprotect">
                MPRS docs and funding data restricted to approved users only
              </span>
            </div>
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
          <mat-form-field appearance="outline" class="field-full">
            <mat-label>Parent Project (CR of)</mat-label>
            <mat-select [(ngModel)]="form.parent_project_id" (ngModelChange)="onParentSelected()">
              <mat-option [value]="null">— Not a CR —</mat-option>
              @for (p of metaProjects; track p.project_id) {
                <mat-option [value]="p.project_id">
                  {{ p.project_name }} ({{ p.project_code }}) · {{ p.status }}
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

        <!-- ── Section 4: Documents Upload ── -->
        <div class="section">
          <div class="section-label">
            Documents
            <span class="optional-tag">Optional</span>
          </div>
          <p class="section-desc">Attach project documents (requirements, presentations, specs). PMs can view these in the Documents tab.</p>
          <div class="upload-zone" (click)="mprsInput.click()" [class.has-file]="form.mprs_file_name">
            <mat-icon>{{ form.mprs_file_name ? 'description' : 'upload_file' }}</mat-icon>
            @if (form.mprs_file_name) {
              <span class="file-name">{{ form.mprs_file_name }}</span>
              <button mat-icon-button (click)="clearMprs($event)" class="clear-file">
                <mat-icon>close</mat-icon>
              </button>
            } @else {
              <span>Click to upload a document</span>
              <span class="upload-hint">Any format supported · Max 50MB</span>
            }
          </div>
          <input #mprsInput type="file" accept="*" style="display:none"
            (change)="onMprsSelected($event)">
        </div>

        <mat-divider></mat-divider>

        <!-- ── Section 5: PM Assignment ── -->
        <div class="section">
          <div class="section-label">PM Assignment</div>
          @if (isElevated) {
            <p class="section-desc">As an elevated user you can assign any active PM to this project.</p>
            <mat-form-field appearance="outline" class="field-full">
              <mat-label>Assign PM User</mat-label>
              <mat-select [(ngModel)]="form.assigned_pm_user_id">
                <mat-option [value]="null">— Assign later —</mat-option>
                @for (u of metaPmUsers; track u.pm_user_id) {
                  <mat-option [value]="u.pm_user_id">
                    {{ u.display_name }} · {{ u.designation || 'Program Manager' }}
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
          @else { <mat-icon>check</mat-icon> {{ isEditMode ? 'Save Changes' : 'Create Project' }} }
        </button>
      </div>
    </div>
  `,
  styles: [`
    /* Backdrop */
    .panel-backdrop {
      position: fixed; inset: 0; background: rgba(0,0,0,0.3);
      z-index: 999; backdrop-filter: blur(2px);
    }

    /* Panel */
    .panel {
      position: fixed; top: 0; right: 0; bottom: 0;
      width: 560px; max-width: 95vw;
      background: white; z-index: 1000;
      display: flex; flex-direction: column;
      box-shadow: -4px 0 32px rgba(0,0,0,0.15);
      animation: slideIn 0.25s ease-out;
    }
    @keyframes slideIn {
      from { transform: translateX(100%); }
      to { transform: translateX(0); }
    }

    /* Header */
    .panel-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 16px 20px; border-bottom: 1px solid #e8e8e8;
      background: #1a1a2e; color: white; flex-shrink: 0;
    }
    .panel-title { display: flex; align-items: center; gap: 10px; font-size: 16px; font-weight: 600; }
    .panel-title mat-icon { color: #ED1C24; }
    .panel-header button { color: white; }

    /* Body */
    .panel-body { flex: 1; overflow-y: auto; padding: 0; }

    /* Sections */
    .section { padding: 20px; }
    .section-label {
      font-size: 12px; font-weight: 700; color: #999;
      text-transform: uppercase; letter-spacing: 0.8px;
      margin-bottom: 14px; display: flex; align-items: center; gap: 8px;
    }
    .optional-tag { font-size: 10px; background: #f0f0f0; color: #aaa; padding: 1px 6px; border-radius: 8px; font-weight: 400; text-transform: none; letter-spacing: 0; }
    .section-desc { font-size: 12px; color: #888; margin: -8px 0 14px; line-height: 1.5; }

    /* Form grid */
    .form-grid { display: flex; flex-wrap: wrap; gap: 12px; }
    .field-full { width: 100%; }
    .field-half { flex: 1; min-width: 200px; }
    .field-full ::ng-deep .mat-mdc-form-field-subscript-wrapper,
    .field-half ::ng-deep .mat-mdc-form-field-subscript-wrapper { min-height: 14px; }

    /* Locked status */
    .status-locked { display: flex; flex-direction: column; gap: 4px; padding: 10px 0; }
    .status-locked-label { font-size: 11px; color: #888; text-transform: uppercase; letter-spacing: 0.5px; }
    .status-locked-value { display: flex; align-items: center; gap: 10px; }
    .status-chip-pipeline { background: #e3f2fd; color: #1565c0; padding: 4px 12px; border-radius: 12px; font-size: 13px; font-weight: 600; }
    .status-locked-hint { font-size: 11px; color: #aaa; }

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

    /* Auto-assign info */
    .auto-assign-info { display: flex; align-items: center; gap: 10px; background: #f0f7ff; border-radius: 6px; padding: 12px 14px; font-size: 13px; color: #1565c0; }
    .auto-assign-info mat-icon { color: #1565c0; }

    /* Footer */
    .panel-footer {
      display: flex; justify-content: flex-end; gap: 12px;
      padding: 16px 20px; border-top: 1px solid #e8e8e8;
      background: #fafafa; flex-shrink: 0;
    }
  `]
})
export class NewProjectComponent implements OnInit {
  @Input() editProject: any = null; // pre-filled project for edit mode
  @Output() closed = new EventEmitter<boolean>(); // true = project created/updated

  metaPmUsers: any[] = [];
  metaProjects: any[] = [];
  saving = false;
  isEditMode = false;

  // Determine if current user has elevated access
  isElevated = true;

  form = {
    project_name: '',
    project_code: '',
    BU: '',
    category: '',
    leader: '',
    top_level_team: '',
    status: 'pipeline',
    sizing_deadline: null as Date | null,
    parent_project_id: null as number | null,
    is_techprotect: false,
    assigned_pm_user_id: null as number | null,
    mprs_file_name: null as string | null,
    mprs_file_segment: null as string | null,
  };

  constructor(private api: ApiService, private snackBar: MatSnackBar, private cdr: ChangeDetectorRef) {}

  ngOnInit() {
    // Pre-fill form if editing an existing project
    if (this.editProject) {
      this.isEditMode = true;
      this.form.project_name = this.editProject.project_name || '';
      this.form.project_code = this.editProject.project_code || '';
      this.form.BU = this.editProject.BU || '';
      this.form.category = this.editProject.category || '';
      this.form.leader = this.editProject.leader || '';
      this.form.top_level_team = this.editProject.top_level_team || '';
      this.form.status = this.editProject.status || 'pipeline';
      this.form.parent_project_id = this.editProject.parent_project_id || null;
      this.form.is_techprotect = !!this.editProject.is_techprotect;
      if (this.editProject.sizing_deadline) {
        this.form.sizing_deadline = new Date(this.editProject.sizing_deadline);
      }
    }

    this.api.getProjectFormMeta().subscribe({
      next: (res: any) => {
        this.metaPmUsers = res.data.pmUsers || [];
        // Exclude current project from parent dropdown in edit mode
        this.metaProjects = (res.data.projects || []).filter(
          (p: any) => !this.editProject || p.project_id !== this.editProject.project_id
        );
        this.cdr.detectChanges();
      },
      error: () => {}
    });
  }

  isFormValid(): boolean {
    return !!(this.form.project_name && this.form.project_code &&
              this.form.BU && this.form.category &&
              this.form.leader && this.form.top_level_team);
  }

  getParentName(): string {
    const p = this.metaProjects.find(p => p.project_id === this.form.parent_project_id);
    return p ? p.project_name : '';
  }

  onParentSelected() {
    // Auto-suggest project code suffix for CR
    if (this.form.parent_project_id) {
      const parent = this.metaProjects.find(p => p.project_id === this.form.parent_project_id);
      if (parent && !this.form.project_code) {
        // Suggest incrementing the code (e.g. spg00.099 → spg00.100)
        this.form.project_name = parent.project_name.replace(/v(\d+\.\d+)/, (_: string, v: string) => {
          const parts = v.split('.');
          parts[1] = String(parseInt(parts[1]) + 1);
          return 'v' + parts.join('.');
        });
      }
    }
  }

  onMprsSelected(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (file) {
      this.form.mprs_file_name = file.name;
      this.form.mprs_file_segment = file.name.replace(/\.[^.]+$/, ''); // name without extension
    }
  }

  clearMprs(event: Event) {
    event.stopPropagation();
    this.form.mprs_file_name = null;
    this.form.mprs_file_segment = null;
  }

  createProject() {
    if (!this.isFormValid()) return;
    this.saving = true;

    const payload: any = {
      ...this.form,
      sizing_deadline: this.form.sizing_deadline
        ? this.form.sizing_deadline.toISOString().split('T')[0]
        : null,
      is_techprotect: this.form.is_techprotect ? 1 : 0,
    };

    const request = this.isEditMode
      ? this.api.updateProject(this.editProject.project_id, payload)
      : this.api.createProject(payload);

    const successMsg = this.isEditMode
      ? `Project "${this.form.project_name}" updated successfully!`
      : `Project "${this.form.project_name}" created successfully!`;

    request.subscribe({
      next: () => {
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
