import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatTabsModule } from '@angular/material/tabs';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ApiService } from '../../services/api.service';
import { StickyScrollbarDirective } from '../../directives/sticky-scrollbar.directive';

// Elevated = explicit flag in RA_pm_users.is_elevated OR designation-based fallback
function isElevated(person: any): boolean {
  if (person.is_elevated === 1 || person.is_elevated === true) return true;
  return false;
}

@Component({
  selector: 'app-admin',
  standalone: true,
  imports: [
    CommonModule, FormsModule, MatTabsModule, MatButtonModule, MatIconModule,
    MatInputModule, MatFormFieldModule, MatSelectModule,
    MatSnackBarModule, MatProgressSpinnerModule, MatTooltipModule,
    StickyScrollbarDirective
  ],
  template: `
    <div class="admin-page">
      <div class="page-header">
        <mat-icon class="page-icon">admin_panel_settings</mat-icon>
        <div>
          <h2>Admin Panel</h2>
          <p class="subtitle">Manage user access and project permissions</p>
        </div>
      </div>

      <mat-tab-group animationDuration="150ms">

        <!-- ═══════════════════════════════════════
             TAB 1: USER ACCESS LEVELS
        ════════════════════════════════════════ -->
        <mat-tab label="User Access">
          <div class="tab-content">

            @if (loadingPeople) {
              <div class="loading-state"><mat-spinner diameter="36"></mat-spinner><span>Loading people...</span></div>
            } @else {

              <!-- Search bar + Grant All -->
              <div class="search-bar">
                <mat-form-field appearance="outline" class="search-field">
                  <mat-label>Search people</mat-label>
                  <input matInput [(ngModel)]="peopleSearch" placeholder="Name, email, designation...">
                  @if (peopleSearch) {
                    <button matSuffix mat-icon-button (click)="peopleSearch = ''" matTooltip="Clear search" style="color:#aaa">
                      <mat-icon>close</mat-icon>
                    </button>
                  } @else {
                    <mat-icon matSuffix>search</mat-icon>
                  }
                </mat-form-field>
                <span class="people-count">{{ filteredPeople.length }} people</span>
                <span style="flex:1"></span>
                <button mat-flat-button color="primary" (click)="grantAllPortalAccess()" [disabled]="grantingAll">
                  <mat-icon>group_add</mat-icon>
                  {{ grantingAll ? 'Granting...' : 'Grant All Portal Access (' + withoutAccess.length + ' remaining)' }}
                </button>
              </div>

              <!-- ELEVATED USERS — collapsible -->
              <div class="section-card">
                <div class="section-header elevated-header" style="cursor:pointer" (click)="elevatedOpen = !elevatedOpen">
                  <mat-icon>verified_user</mat-icon>
                  <span>Elevated Access</span>
                  <span class="count-chip">{{ elevatedPeople.length }}</span>
                  <span class="section-hint">See all projects · Approve/Negotiate · Manage access</span>
                  <mat-icon class="collapse-chevron">{{ elevatedOpen ? 'expand_less' : 'expand_more' }}</mat-icon>
                </div>
                @if (!elevatedOpen) { <div class="collapsed-hint">{{ elevatedPeople.length }} elevated users — click to expand</div> }
              </div>
              @if (elevatedOpen) {
              <div class="section-card" style="border-top:none;border-radius:0 0 10px 10px;margin-top:-12px">
                <table class="people-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Designation</th>
                      <th>Location</th>
                      <th>Reports To</th>
                      <th>Portal Access</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (p of elevatedPeople; track p.person_id) {
                      <tr>
                        <td class="name-cell">
                          <div class="avatar" [style.background]="getColor(p.display_name)">{{ getInitials(p.display_name) }}</div>
                          <div>
                            <div class="person-name">{{ p.display_name }}</div>
                            <div class="person-email">{{ p.email }}</div>
                          </div>
                        </td>
                        <td><span class="desig-chip elevated-chip">{{ p.designation }}</span></td>
                        <td class="meta-cell">{{ p.location }}</td>
                        <td class="meta-cell">{{ p.reporting_manager || '—' }}</td>
                        <td>
                          @if (p.portal_access === 1) {
                            <span class="access-chip active-chip">Active</span>
                          } @else {
                            <span class="access-chip no-chip">No portal login</span>
                          }
                        </td>
                        <td class="actions-cell">
                          @if (p.portal_access !== 1) {
                            <button mat-stroked-button color="primary" class="action-btn"
                              (click)="grantPortalAccess(p)" [disabled]="p._granting">
                              <mat-icon>login</mat-icon> Grant Login
                            </button>
                          }
                          <button mat-stroked-button class="action-btn demote-btn"
                            matTooltip="Remove elevated access — moves person to Read/Write section"
                            (click)="demoteFromElevated(p)" [disabled]="p._demoting">
                            <mat-icon>arrow_downward</mat-icon> Remove Elevated
                          </button>
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
              }

              <!-- OTHER USERS -->
              <div class="section-card">
                <div class="section-header other-header">
                  <mat-icon>person</mat-icon>
                  <span>Read/Write Access (PMs & Engineers)</span>
                  <span class="count-chip">{{ otherPeople.length }}</span>
                  <span class="section-hint">See only assigned projects · Enter sizing · Submit if granted</span>
                </div>
                <table class="people-table">
                  <thead>
                    <tr>
                      <th style="min-width:220px">Name</th>
                      <th>Designation</th>
                      <th>Location</th>
                      <th>Reports To</th>
                      <th style="width:110px;text-align:center">Portal Access</th>
                      <th style="width:260px;text-align:center">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (p of otherPeople; track p.person_id) {
                      <tr>
                        <td class="name-cell">
                          <div class="avatar" [style.background]="getColor(p.display_name)">{{ getInitials(p.display_name) }}</div>
                          <div>
                            <div class="person-name">{{ p.display_name }}</div>
                            <div class="person-email">{{ p.email }}</div>
                          </div>
                        </td>
                        <td><span class="desig-chip">{{ p.designation }}</span></td>
                        <td class="meta-cell">{{ p.location }}</td>
                        <td class="meta-cell">{{ p.reporting_manager || '—' }}</td>
                        <td style="text-align:center">
                          @if (p.portal_access === 1) {
                            <span class="access-chip active-chip">Active</span>
                          } @else {
                            <span class="access-chip no-chip">No access</span>
                          }
                        </td>
                        <td class="actions-cell" style="text-align:center">
                          @if (p.portal_access !== 1) {
                            <button mat-stroked-button color="primary" class="action-btn"
                              (click)="grantPortalAccess(p)" [disabled]="p._granting">
                              <mat-icon>login</mat-icon> Grant
                            </button>
                          } @else {
                            <button mat-stroked-button class="action-btn revoke-btn"
                              matTooltip="Remove portal login"
                              (click)="revokePortalAccess(p)" [disabled]="p._revoking">
                              <mat-icon>logout</mat-icon> Revoke
                            </button>
                          }
                          <button mat-stroked-button class="action-btn promote-btn"
                            matTooltip="Promote to elevated access"
                            (click)="promoteToElevated(p)" [disabled]="p._promoting">
                            <mat-icon>arrow_upward</mat-icon> Promote
                          </button>
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            }
          </div>
        </mat-tab>

        <!-- ═══════════════════════════════════════
             TAB 2: PROJECT ACCESS MATRIX
        ════════════════════════════════════════ -->
        <mat-tab label="Project Access Matrix">
          <div class="tab-content">

            @if (loadingMatrix) {
              <div class="loading-state"><mat-spinner diameter="36"></mat-spinner><span>Loading matrix...</span></div>
            } @else {

              <div class="matrix-info">
                <mat-icon style="color:#1565c0;font-size:16px;width:16px;height:16px">info</mat-icon>
                <span>Set access level per person per project. <strong>No</strong> = no access · <strong>Yes</strong> = read &amp; write · <strong>Can Submit</strong> = read, write, and submit HC</span>
              </div>

              <!-- Matrix search -->
              <div class="search-bar">
                <mat-form-field appearance="outline" class="search-field">
                  <mat-label>Filter people</mat-label>
                  <input matInput [(ngModel)]="matrixSearch" placeholder="Name or email...">
                  @if (matrixSearch) {
                    <button matSuffix mat-icon-button (click)="matrixSearch = ''" matTooltip="Clear" style="color:#aaa">
                      <mat-icon>close</mat-icon>
                    </button>
                  } @else {
                    <mat-icon matSuffix>search</mat-icon>
                  }
                </mat-form-field>
              </div>

              <div class="matrix-wrap" stickyScrollbar>
                <table class="matrix-table">
                  <thead>
                    <tr>
                      <th class="person-col">Resource</th>
                      @for (proj of activeProjects; track proj.project_id) {
                        <th class="proj-col">
                          <div class="proj-th-name" [matTooltip]="proj.project_name">{{ proj.project_name }}</div>
                          <div class="proj-th-bu">{{ proj.BU }}</div>
                        </th>
                      }
                    </tr>
                  </thead>
                  <tbody>
                    @for (p of matrixPeople; track p.person_id) {
                      <tr>
                        <td class="person-td">
                          <div class="person-td-inner">
                            <div class="avatar-sm" [style.background]="getColor(p.display_name)">{{ getInitials(p.display_name) }}</div>
                            <div>
                              <div class="person-name">{{ p.display_name }}</div>
                              <div class="person-meta">{{ p.designation }}</div>
                            </div>
                          </div>
                        </td>
                        @for (proj of activeProjects; track proj.project_id) {
                          <td class="matrix-td">
                            @if (p.pm_user_id) {
                              <select class="access-select"
                                [class.val-yes]="getAccessLevel(p.pm_user_id, proj.project_id) === 'yes'"
                                [class.val-submit]="getAccessLevel(p.pm_user_id, proj.project_id) === 'can_submit'"
                                [value]="getAccessLevel(p.pm_user_id, proj.project_id)"
                                (change)="onAccessChange($event, p, proj.project_id)">
                                <option value="none">— No</option>
                                <option value="yes">✓ Yes</option>
                                <option value="can_submit">⬆ Can Submit</option>
                              </select>
                            } @else {
                              <span class="no-login-cell" matTooltip="No portal login — grant access first">—</span>
                            }
                          </td>
                        }
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            }
          </div>
        </mat-tab>


      </mat-tab-group>
    </div>
  `,
  styles: [`
    .admin-page { padding: 0; }
    .page-header { display: flex; align-items: center; gap: 14px; margin-bottom: 20px; }
    .page-icon { font-size: 32px; width: 32px; height: 32px; color: #ED1C24; }
    .page-header h2 { margin: 0; font-size: 22px; font-weight: 600; }
    .subtitle { margin: 2px 0 0; color: #666; font-size: 13px; }

    .tab-content { padding: 20px 0; display: flex; flex-direction: column; gap: 16px; }
    .loading-state { display: flex; align-items: center; gap: 12px; padding: 40px; color: #888; }

    /* Search */
    .search-bar { display: flex; align-items: center; gap: 12px; }
    .search-field { width: 320px; }
    .search-field ::ng-deep .mat-mdc-form-field-subscript-wrapper { display: none; }
    .people-count { font-size: 12px; color: #888; }

    /* Section cards */
    .section-card { background: white; border: 1px solid #e0e0e0; border-radius: 10px; overflow: hidden; }
    .section-header { display: flex; align-items: center; gap: 8px; padding: 12px 16px; font-size: 14px; font-weight: 600; border-bottom: 1px solid #f0f0f0; }
    .section-header mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .elevated-header { background: #f0f4ff; color: #1a1a2e; }
    .elevated-header mat-icon { color: #1565c0; }
    .other-header { background: #fafafa; color: #1a1a2e; }
    .other-header mat-icon { color: #555; }
    .count-chip { background: #e0e0e0; color: #444; font-size: 11px; padding: 2px 8px; border-radius: 10px; font-weight: 700; }
    .section-hint { font-size: 11px; color: #aaa; font-weight: 400; margin-left: 4px; }
    .collapse-chevron { font-size: 20px; width: 20px; height: 20px; color: #aaa; margin-left: auto; }
    .collapsed-hint { padding: 8px 16px; font-size: 11px; color: #aaa; font-style: italic; background: #fafafa; }

    /* People table */
    .people-table { width: 100%; border-collapse: collapse; font-size: 12px; }
    .people-table th { background: #f8f9fa; padding: 8px 14px; text-align: left; font-size: 11px; font-weight: 600; color: #666; text-transform: uppercase; letter-spacing: 0.3px; border-bottom: 1px solid #e8e8e8; }
    .people-table td { padding: 8px 14px; border-bottom: 1px solid #f5f5f5; vertical-align: middle; }
    .people-table tr:last-child td { border-bottom: none; }
    .people-table tr:hover td { background: #f8f9ff; }

    .name-cell { display: flex; align-items: center; gap: 10px; }
    .person-name { font-size: 12px; font-weight: 600; color: #1a1a2e; }
    .person-email { font-size: 10px; color: #aaa; margin-top: 1px; }
    .meta-cell { color: #666; font-size: 11px; }

    .avatar { width: 30px; height: 30px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; color: white; flex-shrink: 0; }
    .avatar-sm { width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 9px; font-weight: 700; color: white; flex-shrink: 0; }

    .desig-chip { background: #f0f0f0; color: #555; padding: 2px 8px; border-radius: 8px; font-size: 10px; }
    .elevated-chip { background: #e8eeff; color: #1565c0; }

    .access-chip { padding: 2px 8px; border-radius: 8px; font-size: 10px; font-weight: 600; }
    .active-chip { background: #e8f5e9; color: #2e7d32; }
    .inactive-chip { background: #fff8e1; color: #f57f17; }
    .no-chip { background: #f5f5f5; color: #aaa; }

    .action-btn { font-size: 11px; height: 30px; }
    .action-btn mat-icon { font-size: 14px; width: 14px; height: 14px; margin-right: 2px; }
    .promote-btn { border-color: #f9a825; color: #e65100; }
    .promote-btn:hover { background: #fff8e1; }
    .revoke-btn { border-color: #e0e0e0; color: #c62828; }
    .revoke-btn:hover { background: #ffebee; border-color: #c62828; }
    .demote-btn { border-color: #e0e0e0; color: #c62828; }
    .demote-btn:hover { background: #ffebee; border-color: #c62828; }
    .actions-cell { display: flex; gap: 6px; align-items: center; }

    /* Matrix info */
    .matrix-info { display: flex; align-items: center; gap: 8px; background: #e8f0fe; border-left: 4px solid #1565c0; border-radius: 6px; padding: 10px 14px; font-size: 12px; color: #1a237e; }

    /* Matrix table */
    .matrix-wrap { overflow-x: auto; background: white; border: 1px solid #e0e0e0; border-radius: 10px; }
    .matrix-table { border-collapse: collapse; width: 100%; }
    .matrix-table thead tr { background: #1a1a2e; }
    .person-col { color: white; padding: 10px 14px; font-size: 11px; font-weight: 600; text-align: left; min-width: 220px; white-space: nowrap; position: sticky; left: 0; background: #1a1a2e; z-index: 2; }
    .proj-col { color: white; padding: 8px 10px; font-size: 11px; font-weight: 600; text-align: center; min-width: 150px; vertical-align: middle; }
    .proj-th-name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 140px; text-align: center; }
    .proj-th-bu { font-size: 9px; color: #90caf9; font-weight: 400; margin-top: 3px; text-align: center; letter-spacing: 0.3px; }
    .matrix-table tbody tr { border-bottom: 1px solid #f0f0f0; }
    .matrix-table tbody tr:hover td { background: #f5f7ff; }
    .person-td { padding: 8px 14px; background: #fafafa; border-right: 1px solid #e8e8e8; position: sticky; left: 0; z-index: 1; min-width: 220px; }
    .person-td-inner { display: flex; align-items: center; gap: 8px; }
    .person-meta { font-size: 10px; color: #aaa; }
    .matrix-td { text-align: center; padding: 6px 8px; }

    /* ── Resource Allocation tab ── */
    .ra-kpi-row { display: flex; gap: 14px; flex-wrap: wrap; }
    .ra-kpi { flex: 1; min-width: 130px; background: white; border: 1px solid #e0e0e0; border-radius: 8px; padding: 14px 16px; border-left: 4px solid; }
    .ra-kpi-label { font-size: 10px; color: #888; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }
    .ra-kpi-value { font-size: 26px; font-weight: 800; color: #1a1a2e; }
    .ra-kpi-sub { font-size: 11px; color: #aaa; margin-top: 2px; }

    .ra-dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; flex-shrink: 0; }
    .ra-badge { display: inline-block; padding: 2px 10px; border-radius: 10px; font-weight: 700; font-size: 12px; }
    .ra-hc-input { width: 64px; border: 1.5px solid #e0e0e0; border-radius: 6px; padding: 4px 8px; font-size: 13px; font-weight: 700; text-align: center; font-family: inherit; color: #1a1a2e; outline: none; }
    .ra-hc-input:focus { border-color: #1565c0; }

    .ra-matrix { border-collapse: collapse; width: 100%; font-size: 12px; }
    .ra-matrix th { background: #f8f9fa; padding: 8px 10px; text-align: center; font-weight: 600; color: #888; border: 1px solid #e0e0e0; font-size: 11px; white-space: nowrap; }
    .ra-row-hd { text-align: left !important; min-width: 180px; }
    .ra-matrix td { padding: 6px 8px; border: 1px solid #f0f0f0; text-align: center; vertical-align: middle; }
    .ra-matrix td:first-child { text-align: left; display: flex; align-items: center; gap: 6px; white-space: nowrap; }
    .ra-task-row td { font-weight: 600; }
    .ra-attr-row td { background: #fafcff; }
    .ra-attr-row td:first-child { display: table-cell; }
    .ra-bar-cell { padding: 4px 6px !important; min-width: 70px; }
    .ra-mini-bar { height: 20px; border-radius: 4px; display: flex; overflow: hidden; }
    .ra-mini-seg { height: 100%; display: flex; align-items: center; justify-content: center; font-size: 9px; font-weight: 700; min-width: 2px; transition: width 0.2s; }

    .ra-alert { display: flex; align-items: flex-start; gap: 8px; padding: 10px 14px; border-radius: 6px; font-size: 12px; }
    .ra-alert-ok { background: #e8f5e9; border: 1px solid #c8e6c9; color: #1b5e20; }
    .ra-alert-warn { background: #ffebee; border: 1px solid #ffcdd2; color: #b71c1c; }

    .ra-panel-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.25); z-index: 200; }
    .ra-panel { position: fixed; right: 0; top: 0; bottom: 0; width: 400px; background: white; box-shadow: -4px 0 24px rgba(0,0,0,0.15); z-index: 201; display: flex; flex-direction: column; }
    .ra-panel-header { padding: 18px 20px; border-bottom: 1px solid #e0e0e0; display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; }
    .ra-panel-title { font-size: 15px; font-weight: 700; color: #1a1a2e; }
    .ra-panel-body { flex: 1; overflow-y: auto; padding: 20px; display: flex; flex-direction: column; gap: 4px; }
    .ra-panel-footer { padding: 14px 20px; border-top: 1px solid #e0e0e0; display: flex; gap: 10px; justify-content: flex-end; flex-shrink: 0; }
    .ra-form-group { margin-bottom: 14px; }
    .ra-form-label { font-size: 10px; font-weight: 700; color: #888; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 5px; display: block; }
    .ra-select { width: 100%; border: 1.5px solid #e0e0e0; border-radius: 6px; padding: 8px 10px; font-size: 13px; font-family: inherit; color: #1a1a2e; outline: none; resize: vertical; }
    .ra-select:focus { border-color: #1565c0; }
    .ra-val-bar-wrap { height: 8px; background: #e0e0e0; border-radius: 4px; overflow: hidden; display: flex; margin-top: 6px; }
    .ra-val-seg { height: 100%; transition: width 0.3s; }
    .ra-overflow-chip { background: #e3f2fd; color: #1565c0; font-size: 10px; font-weight: 700; padding: 0 7px; border-radius: 10px; cursor: pointer; white-space: nowrap; height: 24px; display: flex; align-items: center; }
    .ra-overflow-chip:hover { background: #bbdefb; }
    .ra-add-person-btn { width: 24px; height: 24px; border-radius: 50%; background: #e3f2fd; color: #1565c0; display: flex; align-items: center; justify-content: center; cursor: pointer; flex-shrink: 0; border: 1.5px dashed #90caf9; transition: background 0.15s; }
    .ra-add-person-btn:hover { background: #bbdefb; }
    .ra-unsaved-chip { background: #fff3e0; color: #e65100; font-size: 11px; font-weight: 600; padding: 2px 10px; border-radius: 10px; border: 1px solid #ffe0b2; }
    .ra-person-row { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 6px; cursor: pointer; transition: background 0.12s; }
    .ra-person-row:hover { background: #f5f5f5; }
    .ra-person-selected { background: #e8f5e9 !important; }
    .ra-expanded-row { background: #fffbf5; }

    .access-select { border: 1px solid #e0e0e0; border-radius: 6px; padding: 4px 8px; font-size: 12px; font-family: inherit; background: white; cursor: pointer; width: 120px; outline: none; transition: all 0.12s; }
    .access-select:focus { border-color: #1565c0; }
    .access-select.val-yes { background: #e8f5e9; border-color: #2e7d32; color: #2e7d32; font-weight: 600; }
    .access-select.val-submit { background: #e8f0fe; border-color: #1565c0; color: #1565c0; font-weight: 600; }
    .no-login-cell { color: #ddd; font-size: 18px; }
  `]
})
export class AdminComponent implements OnInit {
  // People data
  allPeople: any[] = [];
  loadingPeople = true;
  peopleSearch = '';
  elevatedOpen = false; // collapsed by default

  // Access data
  accessList: any[] = [];
  activeProjects: any[] = [];
  loadingMatrix = true;
  matrixSearch = '';

  constructor(
    private api: ApiService,
    private snackBar: MatSnackBar,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit() {
    this.loadAll();
  }

  loadAll() {
    this.loadingPeople = true;
    this.loadingMatrix = true;

    Promise.all([
      this.api.getAdminPeople().toPromise(),
      this.api.getAdminAccess().toPromise(),
    ]).then(([peopleRes, accessRes]: any[]) => {
      this.allPeople = peopleRes?.data || [];
      this.activeProjects = (accessRes?.data?.projects || []).filter((p: any) =>
        !['cancelled','closed'].includes(p.status) && !p.is_test
      );
      this.accessList = accessRes?.data?.access || [];
      this.loadingPeople = false;
      this.loadingMatrix = false;
      this.cdr.detectChanges();
    }).catch(() => {
      this.loadingPeople = false;
      this.loadingMatrix = false;
    });
  }

  // ── People filtering ──────────────────────────────────────────────────────
  get filteredPeople(): any[] {
    if (!this.peopleSearch.trim()) return this.allPeople;
    const t = this.peopleSearch.toLowerCase();
    return this.allPeople.filter(p =>
      p.display_name.toLowerCase().includes(t) ||
      (p.email || '').toLowerCase().includes(t) ||
      (p.designation || '').toLowerCase().includes(t)
    );
  }

  get elevatedPeople(): any[] {
    return this.filteredPeople.filter(p => isElevated(p));
  }

  get otherPeople(): any[] {
    return this.filteredPeople.filter(p => !isElevated(p));
  }

  // ── Matrix filtering ──────────────────────────────────────────────────────
  get matrixPeople(): any[] {
    const base = this.allPeople.filter(p => !isElevated(p));
    if (!this.matrixSearch.trim()) return base;
    const t = this.matrixSearch.toLowerCase();
    return base.filter(p => p.display_name.toLowerCase().includes(t) || (p.email || '').toLowerCase().includes(t));
  }

  // ── Access level helpers ──────────────────────────────────────────────────
  getAccessLevel(pmUserId: number, projectId: number): string {
    const acc = this.accessList.find(a => a.pm_user_id === pmUserId && a.project_id === projectId);
    if (!acc) return 'none';
    if (acc.can_submit) return 'can_submit';
    if (acc.can_edit) return 'yes';
    return 'none';
  }

  onAccessChange(event: Event, person: any, projectId: number) {
    const level = (event.target as HTMLSelectElement).value;
    if (!person.pm_user_id) return;

    this.api.upsertAccess({ pm_user_id: person.pm_user_id, project_id: projectId, level }).subscribe({
      next: () => {
        // Update local accessList
        const existing = this.accessList.findIndex(a => a.pm_user_id === person.pm_user_id && a.project_id === projectId);
        if (level === 'none') {
          if (existing >= 0) this.accessList.splice(existing, 1);
        } else {
          const record = {
            pm_user_id: person.pm_user_id,
            project_id: projectId,
            can_edit: 1,
            can_submit: level === 'can_submit' ? 1 : 0,
            display_name: person.display_name
          };
          if (existing >= 0) this.accessList[existing] = { ...this.accessList[existing], ...record };
          else this.accessList.push(record);
        }
        this.cdr.detectChanges();
      },
      error: () => this.showError('Failed to update access')
    });
  }

  // ── Bulk grant all ───────────────────────────────────────────────────────
  grantingAll = false;

  get withoutAccess(): any[] {
    return this.allPeople.filter(p => p.portal_access !== 1);
  }

  async grantAllPortalAccess() {
    if (!this.withoutAccess.length) { this.showSuccess('Everyone already has portal access!'); return; }
    if (!confirm(`Grant portal access to all ${this.withoutAccess.length} remaining people?`)) return;
    this.grantingAll = true;
    let count = 0;
    for (const person of this.withoutAccess) {
      try {
        await this.api.createAdminUser({
          display_name: person.display_name, email: person.email,
          designation: person.designation, location: person.location,
          top_level_team: person.top_level_team, function_area: person.function_area,
          person_id: person.person_id
        }).toPromise();
        person.portal_access = 1;
        count++;
      } catch {}
    }
    this.grantingAll = false;
    this.showSuccess(`Portal access granted to ${count} people`);
    this.cdr.detectChanges();
  }

  // ── Demote from elevated ─────────────────────────────────────────────────
  demoteFromElevated(person: any) {
    if (!confirm(`Remove elevated access from ${person.display_name}? They will move to Read/Write access.`)) return;
    if (!person.pm_user_id) { this.showError('User must have portal login first'); return; }
    person._demoting = true;
    this.api.setElevated(person.pm_user_id, false).subscribe({
      next: () => {
        person.is_elevated = 0;
        person._demoting = false;
        this.showSuccess(`${person.display_name} moved to Read/Write access`);
        this.cdr.detectChanges();
      },
      error: () => { person._demoting = false; this.showError('Failed to update access'); }
    });
  }

  // ── Promote to elevated ──────────────────────────────────────────────────
  promoteToElevated(person: any) {
    if (!confirm(`Give ${person.display_name} elevated access? They will see all projects.`)) return;
    if (!person.pm_user_id) { this.showError('Grant portal login first before promoting'); return; }
    person._promoting = true;
    this.api.setElevated(person.pm_user_id, true).subscribe({
      next: () => {
        person.is_elevated = 1;
        person._promoting = false;
        this.showSuccess(`${person.display_name} now has elevated access`);
        this.cdr.detectChanges();
      },
      error: () => { person._promoting = false; this.showError('Failed to promote user'); }
    });
  }

  // ── Revoke portal login ───────────────────────────────────────────────────
  revokePortalAccess(person: any) {
    if (!confirm(`Remove portal access for ${person.display_name}? They will no longer be able to log in.`)) return;
    person._revoking = true;
    this.api.toggleAdminUser(person.pm_user_id).subscribe({
      next: () => {
        person.portal_access = 0;
        person._revoking = false;
        this.showSuccess(`Portal access removed for ${person.display_name}`);
        this.cdr.detectChanges();
      },
      error: () => { person._revoking = false; this.showError('Failed to revoke access'); }
    });
  }

  // ── Grant portal login ────────────────────────────────────────────────────
  grantPortalAccess(person: any) {
    person._granting = true;
    this.api.createAdminUser({
      display_name: person.display_name,
      email: person.email,
      designation: person.designation,
      location: person.location,
      top_level_team: person.top_level_team,
      function_area: person.function_area,
      person_id: person.person_id
    }).subscribe({
      next: (res: any) => {
        person.pm_user_id = res.data?.pm_user_id;
        person.portal_access = 1;
        person._granting = false;
        this.showSuccess(`Portal access granted to ${person.display_name}`);
        this.cdr.detectChanges();
      },
      error: (err: any) => {
        person._granting = false;
        this.showError(err.error?.error || 'Failed to grant access');
      }
    });
  }

  // ── Resource Allocation (mockup data) ─────────────────────────────────────

  raQuarters = ['Q1 FY27','Q2 FY27','Q3 FY27','Q4 FY27','Q1 FY28','Q2 FY28','Q3 FY28','Q4 FY28'];

  raProjects = ['Arcadia v4.0','Camelot-Arthur','Camelot-Lancelot','Capitola C90 v1.0 r1','ECARX SW Tools CCB','Eris v2.0','KRK1 New Features v1.0'];

  raProjectColors = [
    { name: 'Arcadia v4.0', color: '#1565c0' },
    { name: 'Camelot-Arthur', color: '#2e7d32' },
    { name: 'Capitola C90 v1.0 r1', color: '#c62828' },
  ];

  steadyStateTasks: { name: string; color: string; totalHc: number; attributable: boolean;
    assignedPeople: any[];
    attributions: { project: string; hc: number; startQ: string; endQ: string; people: any[] }[] }[] = [
    { name: 'Release Management', color: '#e65100', totalHc: 8, attributable: true, assignedPeople: [],
      attributions: [
        { project: 'Capitola C90 v1.0 r1', hc: 2, startQ: 'Q1 FY27', endQ: 'Q4 FY27', people: [] },
        { project: 'Camelot-Arthur',        hc: 3, startQ: 'Q2 FY27', endQ: 'Q1 FY28', people: [] },
      ]},
    { name: 'Distribution Support', color: '#607d8b', totalHc: 12, attributable: true, assignedPeople: [], attributions: [] },
    { name: 'Management Overhead', color: '#6a1b9a', totalHc: 9, attributable: true, assignedPeople: [],
      attributions: [
        { project: 'Arcadia v4.0',    hc: 1, startQ: 'Q1 FY27', endQ: 'Q4 FY27', people: [] },
        { project: 'Camelot-Arthur',  hc: 1, startQ: 'Q1 FY27', endQ: 'Q1 FY28', people: [] },
      ]},
    { name: 'Infrastructure & CI', color: '#0277bd', totalHc: 5, attributable: true, assignedPeople: [],
      attributions: [
        { project: 'Camelot-Arthur',        hc: 1, startQ: 'Q1 FY27', endQ: 'Q1 FY28', people: [] },
        { project: 'Capitola C90 v1.0 r1',  hc: 1, startQ: 'Q1 FY27', endQ: 'Q4 FY27', people: [] },
      ]},
    { name: 'Security & Compliance', color: '#00695c', totalHc: 4, attributable: false, assignedPeople: [], attributions: [] },
  ];

  // Panel state
  showAttrPanel = false;
  attrPanelTask: any = null;
  newAttr = { taskName: '', project: '', hc: 0, startQ: 'Q1 FY27', endQ: '', notes: '' };
  newAttrPeople: any[] = [];
  attrOverBudget = false;
  attrBudgetMsg = '';
  attrUsedPct = 0;
  attrNewPct = 0;
  expandedTask: any = null;
  attrDirty = false;

  // People picker state
  showPeoplePicker = false;
  peoplePanelTask: any = null;
  peoplePickerSearch = '';

  // People picker
  get filteredPickerPeople(): any[] {
    const s = this.peoplePickerSearch.toLowerCase();
    return this.allPeople.filter(p =>
      !s || p.display_name?.toLowerCase().includes(s) ||
      p.designation?.toLowerCase().includes(s) ||
      p.location?.toLowerCase().includes(s)
    );
  }

  openPeoplePicker(task: any) {
    this.peoplePanelTask = task;
    this.peoplePickerSearch = '';
    this.showPeoplePicker = true;
    this.showAttrPanel = false;
  }

  isPersonAssigned(task: any, person: any): boolean {
    return task?.assignedPeople?.some((p: any) => p.person_id === person.person_id) ?? false;
  }

  togglePersonAssign(task: any, person: any) {
    if (!task) return;
    const idx = task.assignedPeople.findIndex((p: any) => p.person_id === person.person_id);
    if (idx >= 0) task.assignedPeople.splice(idx, 1);
    else task.assignedPeople.push(person);
    this.cdr.detectChanges();
  }

  // Attribution people
  isPersonInAttr(person: any): boolean {
    return this.newAttrPeople.some(p => p.person_id === person.person_id);
  }

  togglePersonInAttr(person: any) {
    const idx = this.newAttrPeople.findIndex(p => p.person_id === person.person_id);
    if (idx >= 0) this.newAttrPeople.splice(idx, 1);
    else this.newAttrPeople.push(person);
    // Auto-set HC to number of selected people
    this.newAttr.hc = this.newAttrPeople.length || this.newAttr.hc;
    this.checkAttrBudget();
    this.cdr.detectChanges();
  }

  getTaskByName(name: string): any {
    return this.steadyStateTasks.find(t => t.name === name);
  }

  openAttrPanel(task: any) {
    this.attrPanelTask = task;
    this.newAttr = { taskName: task?.name || '', project: '', hc: 0, startQ: 'Q1 FY27', endQ: '', notes: '' };
    this.newAttrPeople = [];
    this.attrOverBudget = false;
    this.attrBudgetMsg = '';
    this.showAttrPanel = true;
    this.showPeoplePicker = false;
  }

  onAttrTaskChange() { this.checkAttrBudget(); }

  checkAttrBudget() {
    const task = this.steadyStateTasks.find(t => t.name === this.newAttr.taskName);
    if (!task || !this.newAttr.hc) { this.attrBudgetMsg = ''; return; }
    const used = this.getAttributed(task);
    const afterAdd = used + Number(this.newAttr.hc);
    const remaining = task.totalHc - used - Number(this.newAttr.hc);
    this.attrOverBudget = afterAdd > task.totalHc;
    this.attrUsedPct = Math.min((used / task.totalHc) * 100, 100);
    this.attrNewPct = Math.min((Number(this.newAttr.hc) / task.totalHc) * 100, 100);
    this.attrBudgetMsg = this.attrOverBudget
      ? `Over budget by ${(afterAdd - task.totalHc).toFixed(1)} HC — reduce allocation or increase task budget`
      : `Within budget — ${remaining.toFixed(1)} HC remaining after this attribution`;
  }

  saveAttr() {
    const task = this.steadyStateTasks.find(t => t.name === this.newAttr.taskName);
    if (!task || !this.newAttr.project || !this.newAttr.hc || this.attrOverBudget) return;
    task.attributions.push({
      project: this.newAttr.project,
      hc: Number(this.newAttr.hc),
      startQ: this.newAttr.startQ,
      endQ: this.newAttr.endQ || 'Q4 FY28',
      people: [...this.newAttrPeople]
    });
    this.showAttrPanel = false;
    this.attrDirty = true;
    this.snackBar.open('Attribution added — click Save Changes to persist', 'Close', { duration: 3000, horizontalPosition: 'end', verticalPosition: 'top' });
    this.cdr.detectChanges();
  }

  removeAttr(task: any, attr: any) {
    task.attributions = task.attributions.filter((a: any) => a !== attr);
    this.attrDirty = true;
    this.cdr.detectChanges();
  }

  saveAttrChanges() {
    // Mockup — in real implementation this POSTs to /api/admin/task-allocations
    this.attrDirty = false;
    this.snackBar.open('Attribution changes saved (mockup — not yet wired to DB)', 'Close', { duration: 3000, horizontalPosition: 'end', verticalPosition: 'top' });
    this.cdr.detectChanges();
  }

  discardAttrChanges() {
    // Mockup — in real implementation this reloads from DB
    this.attrDirty = false;
    this.snackBar.open('Changes discarded', 'Close', { duration: 2000, horizontalPosition: 'end', verticalPosition: 'top' });
    this.cdr.detectChanges();
  }

  onTaskHcChange(task: any) { this.cdr.detectChanges(); }

  getAttributed(task: any): number {
    return task.attributions.reduce((s: number, a: any) => s + a.hc, 0);
  }

  getStandalone(task: any): number {
    return Math.max(0, task.totalHc - this.getAttributed(task));
  }

  getAttribsForTask(task: any) { return task.attributions; }

  isAttrActive(attr: { startQ: string; endQ: string }, q: string): boolean {
    const parse = (s: string) => { const m = s.match(/Q(\d) FY(\d{2})/); return m ? parseInt(m[2]) * 4 + parseInt(m[1]) : 0; };
    const qn = parse(q); const start = parse(attr.startQ);
    const end = attr.endQ ? parse(attr.endQ) : 9999;
    return qn >= start && qn <= end;
  }

  getBarSegs(task: any, q: string): { label: string; hc: number; pct: number; color: string; standalone: boolean }[] {
    const segs: { label: string; hc: number; pct: number; color: string; standalone: boolean }[] = [];
    let used = 0;
    const projColorMap: Record<string, string> = { 'Arcadia v4.0':'#1565c0','Camelot-Arthur':'#2e7d32','Capitola C90 v1.0 r1':'#c62828','ECARX SW Tools CCB':'#e65100','Eris v2.0':'#558b2f','KRK1 New Features v1.0':'#6a1b9a' };
    for (const a of task.attributions) {
      if (this.isAttrActive(a, q)) {
        segs.push({ label: a.project, hc: a.hc, pct: (a.hc / task.totalHc) * 100, color: projColorMap[a.project] || '#888', standalone: false });
        used += a.hc;
      }
    }
    const rem = task.totalHc - used;
    if (rem > 0) segs.push({ label: 'Standalone', hc: rem, pct: (rem / task.totalHc) * 100, color: '#e0e0e0', standalone: true });
    return segs;
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  getInitials(name: string): string {
    const parts = name.replace(/[,(].*/, '').trim().split(/[\s,]+/).filter(Boolean);
    return parts.slice(0, 2).map((p: string) => p[0]).join('').toUpperCase();
  }

  getColor(name: string): string {
    const colors = ['#1565c0','#2e7d32','#c62828','#6a1b9a','#00695c','#bf360c','#37474f','#4a148c','#827717','#e65100'];
    let hash = 0;
    for (const c of name) hash = ((hash << 5) - hash) + c.charCodeAt(0);
    return colors[Math.abs(hash) % colors.length];
  }

  private showSuccess(msg: string) {
    this.snackBar.open(msg, 'Close', { duration: 3000, horizontalPosition: 'end', verticalPosition: 'top' });
  }
  private showError(msg: string) {
    this.snackBar.open(msg, 'Close', { duration: 5000, horizontalPosition: 'end', verticalPosition: 'top', panelClass: ['snack-error'] });
  }
}
