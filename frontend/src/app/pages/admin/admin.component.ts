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
                      <th>Name</th>
                      <th>Designation</th>
                      <th>Location</th>
                      <th>Reports To</th>
                      <th>Portal Access</th>
                      <th>Action</th>
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
                        <td>
                          @if (p.portal_access === 1) {
                            <span class="access-chip active-chip">Active</span>
                          } @else {
                            <span class="access-chip no-chip">No access</span>
                          }
                        </td>
                        <td class="actions-cell">
                          @if (p.portal_access !== 1) {
                            <button mat-stroked-button color="primary" class="action-btn"
                              (click)="grantPortalAccess(p)" [disabled]="p._granting">
                              <mat-icon>login</mat-icon> Grant Login
                            </button>
                          }
                          <button mat-stroked-button class="action-btn promote-btn"
                            matTooltip="Mark this person as elevated in RA_people"
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
