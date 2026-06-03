import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatTabsModule } from '@angular/material/tabs';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDialogModule } from '@angular/material/dialog';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ApiService } from '../../services/api.service';

@Component({
  selector: 'app-admin',
  standalone: true,
  imports: [
    CommonModule, FormsModule, MatTabsModule, MatButtonModule, MatIconModule,
    MatInputModule, MatFormFieldModule, MatSelectModule, MatSlideToggleModule,
    MatSnackBarModule, MatProgressSpinnerModule, MatDialogModule, MatTooltipModule
  ],
  template: `
    <div class="admin-page">
      <div class="page-header">
        <div class="header-left">
          <mat-icon class="page-icon">admin_panel_settings</mat-icon>
          <div>
            <h2>Admin Panel</h2>
            <p class="subtitle">Manage PM users and project access control</p>
          </div>
        </div>
      </div>

      <mat-tab-group animationDuration="150ms">

        <!-- ═══ TAB 1: PM USERS ═══ -->
        <mat-tab label="PM Users">
          <div class="tab-content">

            <!-- Add user form -->
            <div class="add-user-card">
              <h4>Add New PM User</h4>
              <div class="add-user-form">
                <mat-form-field appearance="outline" class="form-field">
                  <mat-label>Full Name</mat-label>
                  <input matInput [(ngModel)]="newUser.display_name" placeholder="e.g. Rahul Arya">
                </mat-form-field>
                <mat-form-field appearance="outline" class="form-field">
                  <mat-label>Email</mat-label>
                  <input matInput [(ngModel)]="newUser.email" placeholder="rahul@amd.com">
                </mat-form-field>
                <mat-form-field appearance="outline" class="form-field-sm">
                  <mat-label>Role</mat-label>
                  <mat-select [(ngModel)]="newUser.role">
                    <mat-option value="Project Manager">Project Manager</mat-option>
                    <mat-option value="Senior Manager">Senior Manager</mat-option>
                    <mat-option value="Director">Director</mat-option>
                    <mat-option value="Engineer">Engineer</mat-option>
                    <mat-option value="Delivery Lead">Delivery Lead</mat-option>
                  </mat-select>
                </mat-form-field>
                <mat-form-field appearance="outline" class="form-field-sm">
                  <mat-label>Location</mat-label>
                  <mat-select [(ngModel)]="newUser.location">
                    <mat-option value="Canada">Canada</mat-option>
                    <mat-option value="US">US</mat-option>
                    <mat-option value="India Bangalore">India Bangalore</mat-option>
                    <mat-option value="India Hyderabad">India Hyderabad</mat-option>
                    <mat-option value="China Shanghai">China Shanghai</mat-option>
                  </mat-select>
                </mat-form-field>
                <button mat-flat-button color="primary" (click)="addUser()" [disabled]="addingUser || !newUser.display_name || !newUser.email">
                  @if (addingUser) { <mat-spinner diameter="18"></mat-spinner> }
                  @else { <mat-icon>person_add</mat-icon> Add User }
                </button>
              </div>
            </div>

            <!-- Users table -->
            <div class="data-card">
              <div class="card-header">
                <span>PM Users ({{ users.length }})</span>
                <button mat-icon-button (click)="loadUsers()" matTooltip="Refresh">
                  <mat-icon>refresh</mat-icon>
                </button>
              </div>

              @if (loadingUsers) {
                <div class="loading-state"><mat-spinner diameter="36"></mat-spinner></div>
              } @else if (users.length === 0) {
                <div class="empty-state">
                  <mat-icon>people_outline</mat-icon>
                  <p>No PM users yet. Add one above.</p>
                </div>
              } @else {
                <table class="admin-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Email</th>
                      <th>Role</th>
                      <th>Location</th>
                      <th>Projects</th>
                      <th>Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (user of users; track user.pm_user_id) {
                      <tr [class.inactive-row]="!user.is_active">
                        <td class="name-cell">
                          <span class="user-avatar" [style.background]="getAvatarColor(user.display_name)">
                            {{ user.display_name.charAt(0).toUpperCase() }}
                          </span>
                          {{ user.display_name }}
                        </td>
                        <td class="email-cell">{{ user.email }}</td>
                        <td><span class="role-chip">{{ user.role || 'Project Manager' }}</span></td>
                        <td class="loc-cell">{{ user.location || '—' }}</td>
                        <td class="center">
                          <span class="proj-count-badge">{{ user.project_count }}</span>
                        </td>
                        <td>
                          <span class="status-chip" [class.active-chip]="user.is_active" [class.inactive-chip]="!user.is_active">
                            {{ user.is_active ? 'Active' : 'Inactive' }}
                          </span>
                        </td>
                        <td class="actions-cell">
                          <button mat-stroked-button [color]="user.is_active ? 'warn' : 'primary'"
                            (click)="toggleUser(user)" [matTooltip]="user.is_active ? 'Deactivate user' : 'Reactivate user'">
                            {{ user.is_active ? 'Deactivate' : 'Reactivate' }}
                          </button>
                          <button mat-icon-button (click)="openUserAccess(user)" matTooltip="Manage project access">
                            <mat-icon>folder_shared</mat-icon>
                          </button>
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              }
            </div>
          </div>
        </mat-tab>

        <!-- ═══ TAB 2: PROJECT ACCESS ═══ -->
        <mat-tab label="Project Access">
          <div class="tab-content">

            <!-- Grant access form -->
            <div class="add-user-card">
              <h4>Grant Project Access</h4>
              <div class="add-user-form">
                <mat-form-field appearance="outline" class="form-field">
                  <mat-label>PM User</mat-label>
                  <mat-select [(ngModel)]="newAccess.pm_user_id">
                    @for (u of activeUsers; track u.pm_user_id) {
                      <mat-option [value]="u.pm_user_id">{{ u.display_name }}</mat-option>
                    }
                  </mat-select>
                </mat-form-field>
                <mat-form-field appearance="outline" class="form-field">
                  <mat-label>Project</mat-label>
                  <mat-select [(ngModel)]="newAccess.project_id">
                    @for (p of projects; track p.project_id) {
                      <mat-option [value]="p.project_id">{{ p.project_name }}</mat-option>
                    }
                  </mat-select>
                </mat-form-field>
                <div class="toggle-group">
                  <mat-slide-toggle [(ngModel)]="newAccess.can_edit" color="primary">Can Edit</mat-slide-toggle>
                  <mat-slide-toggle [(ngModel)]="newAccess.can_submit" color="primary">Can Submit</mat-slide-toggle>
                </div>
                <button mat-flat-button color="primary" (click)="grantAccess()"
                  [disabled]="grantingAccess || !newAccess.pm_user_id || !newAccess.project_id">
                  @if (grantingAccess) { <mat-spinner diameter="18"></mat-spinner> }
                  @else { <mat-icon>lock_open</mat-icon> Grant Access }
                </button>
              </div>
            </div>

            <!-- Access matrix -->
            <div class="data-card">
              <div class="card-header">
                <span>Access Matrix</span>
                <button mat-icon-button (click)="loadAccess()" matTooltip="Refresh">
                  <mat-icon>refresh</mat-icon>
                </button>
              </div>

              @if (loadingAccess) {
                <div class="loading-state"><mat-spinner diameter="36"></mat-spinner></div>
              } @else {
                <table class="admin-table access-table">
                  <thead>
                    <tr>
                      <th>Project</th>
                      <th>BU</th>
                      <th>Status</th>
                      <th>PM User</th>
                      <th class="center">Can Edit</th>
                      <th class="center">Can Submit</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (proj of projects; track proj.project_id) {
                      @let projAccess = getProjectAccess(proj.project_id);
                      @if (projAccess.length > 0) {
                        @for (acc of projAccess; track acc.id; let first = $first) {
                          <tr>
                            @if (first) {
                              <td [attr.rowspan]="projAccess.length" class="proj-cell proj-group-cell">
                                {{ proj.project_name }}
                              </td>
                              <td [attr.rowspan]="projAccess.length" class="bu-cell">{{ proj.BU }}</td>
                              <td [attr.rowspan]="projAccess.length">
                                <span class="status-chip active-chip">{{ proj.status }}</span>
                              </td>
                            }
                            <td class="name-cell">
                              <span class="user-avatar-sm" [style.background]="getAvatarColor(acc.display_name)">
                                {{ acc.display_name.charAt(0) }}
                              </span>
                              {{ acc.display_name }}
                            </td>
                            <td class="center">
                              <mat-slide-toggle [checked]="acc.can_edit" color="primary"
                                (change)="updateAccess(acc, 'can_edit', $event.checked)">
                              </mat-slide-toggle>
                            </td>
                            <td class="center">
                              <mat-slide-toggle [checked]="acc.can_submit" color="primary"
                                (change)="updateAccess(acc, 'can_submit', $event.checked)">
                              </mat-slide-toggle>
                            </td>
                            <td>
                              <button mat-icon-button color="warn" (click)="revokeAccess(acc)"
                                matTooltip="Revoke access">
                                <mat-icon>remove_circle_outline</mat-icon>
                              </button>
                            </td>
                          </tr>
                        }
                      } @else {
                        <tr class="no-access-row">
                          <td class="proj-cell">{{ proj.project_name }}</td>
                          <td class="bu-cell">{{ proj.BU }}</td>
                          <td><span class="status-chip active-chip">{{ proj.status }}</span></td>
                          <td colspan="4" class="no-access-cell">No users assigned</td>
                        </tr>
                      }
                    }
                  </tbody>
                </table>
              }
            </div>
          </div>
        </mat-tab>

      </mat-tab-group>
    </div>
  `,
  styles: [`
    .admin-page { padding: 0; }
    .page-header { display: flex; align-items: center; margin-bottom: 20px; }
    .header-left { display: flex; align-items: center; gap: 14px; }
    .page-icon { font-size: 32px; width: 32px; height: 32px; color: #ED1C24; }
    .page-header h2 { margin: 0; font-size: 22px; font-weight: 500; }
    .subtitle { margin: 2px 0 0; color: #666; font-size: 13px; }

    .tab-content { padding: 20px 0; display: flex; flex-direction: column; gap: 16px; }

    /* Add user / grant access card */
    .add-user-card { background: white; border: 1px solid #e0e0e0; border-radius: 10px; padding: 20px; }
    .add-user-card h4 { margin: 0 0 16px; font-size: 14px; font-weight: 600; color: #1a1a2e; }
    .add-user-form { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
    .form-field { width: 220px; }
    .form-field-sm { width: 160px; }
    .form-field ::ng-deep .mat-mdc-form-field-subscript-wrapper,
    .form-field-sm ::ng-deep .mat-mdc-form-field-subscript-wrapper { display: none; }
    .toggle-group { display: flex; gap: 16px; align-items: center; }

    /* Data card */
    .data-card { background: white; border: 1px solid #e0e0e0; border-radius: 10px; overflow: hidden; }
    .card-header { display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; border-bottom: 1px solid #f0f0f0; font-weight: 600; color: #333; font-size: 14px; }

    /* Table */
    .admin-table { width: 100%; border-collapse: collapse; font-size: 13px; }
    .admin-table th { background: #f8f9fa; padding: 10px 14px; text-align: left; font-weight: 600; color: #555; font-size: 11px; text-transform: uppercase; letter-spacing: 0.3px; border-bottom: 2px solid #e0e0e0; }
    .admin-table td { padding: 10px 14px; border-bottom: 1px solid #f5f5f5; vertical-align: middle; }
    .admin-table tr:last-child td { border-bottom: none; }
    .admin-table tr:hover td { background: #fafbff; }
    .inactive-row td { opacity: 0.55; }
    .center { text-align: center; }

    /* User avatar */
    .user-avatar { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: 50%; color: white; font-size: 12px; font-weight: 700; margin-right: 8px; flex-shrink: 0; }
    .user-avatar-sm { display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: 50%; color: white; font-size: 10px; font-weight: 700; margin-right: 6px; flex-shrink: 0; }
    .name-cell { display: flex; align-items: center; }
    .email-cell { color: #666; font-size: 12px; }
    .loc-cell { color: #888; font-size: 12px; }

    /* Chips */
    .role-chip { background: #e3f2fd; color: #1565c0; padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: 500; }
    .status-chip { padding: 3px 10px; border-radius: 10px; font-size: 11px; font-weight: 600; }
    .active-chip { background: #e8f5e9; color: #2e7d32; }
    .inactive-chip { background: #fafafa; color: #aaa; }
    .proj-count-badge { background: #f0f0f0; color: #444; padding: 2px 8px; border-radius: 10px; font-size: 12px; font-weight: 600; }

    .actions-cell { display: flex; align-items: center; gap: 4px; }

    /* Access table */
    .proj-group-cell { font-weight: 600; color: #1a1a2e; vertical-align: top; padding-top: 14px; }
    .bu-cell { color: #666; font-size: 12px; }
    .no-access-row td { color: #bbb; font-style: italic; }
    .no-access-cell { font-size: 12px; }

    /* Empty / loading */
    .loading-state { display: flex; justify-content: center; padding: 40px; }
    .empty-state { display: flex; flex-direction: column; align-items: center; padding: 48px; color: #bbb; gap: 12px; }
    .empty-state mat-icon { font-size: 48px; width: 48px; height: 48px; }
  `]
})
export class AdminComponent implements OnInit {
  users: any[] = [];
  projects: any[] = [];
  accessList: any[] = [];
  loadingUsers = true;
  loadingAccess = true;
  addingUser = false;
  grantingAccess = false;

  newUser = { display_name: '', email: '', role: 'Project Manager', location: '', top_level_team: '', function_area: '' };
  newAccess = { pm_user_id: null as number | null, project_id: null as number | null, can_edit: true, can_submit: true };

  avatarColors = ['#1565c0', '#2e7d32', '#e65100', '#6a1b9a', '#00838f', '#ad1457', '#f57f17', '#00695c'];

  constructor(private api: ApiService, private snackBar: MatSnackBar, private cdr: ChangeDetectorRef) {}

  ngOnInit() {
    this.loadUsers();
    this.loadAccess();
  }

  get activeUsers() { return this.users.filter(u => u.is_active); }

  getAvatarColor(name: string): string {
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    return this.avatarColors[Math.abs(hash) % this.avatarColors.length];
  }

  getProjectAccess(projectId: number) {
    return this.accessList.filter(a => a.project_id === projectId);
  }

  loadUsers() {
    this.loadingUsers = true;
    this.api.getAdminUsers().subscribe({
      next: (res: any) => { this.users = res.data; this.loadingUsers = false; this.cdr.detectChanges(); },
      error: () => { this.loadingUsers = false; this.showError('Failed to load users'); }
    });
  }

  loadAccess() {
    this.loadingAccess = true;
    this.api.getAdminAccess().subscribe({
      next: (res: any) => {
        this.projects = res.data.projects;
        this.accessList = res.data.access;
        this.loadingAccess = false;
        this.cdr.detectChanges();
      },
      error: () => { this.loadingAccess = false; this.showError('Failed to load access data'); }
    });
  }

  addUser() {
    if (!this.newUser.display_name || !this.newUser.email) return;
    this.addingUser = true;
    this.api.createAdminUser(this.newUser).subscribe({
      next: () => {
        this.showSuccess(`User "${this.newUser.display_name}" added`);
        this.newUser = { display_name: '', email: '', role: 'Project Manager', location: '', top_level_team: '', function_area: '' };
        this.addingUser = false;
        this.loadUsers();
      },
      error: (err: any) => {
        this.addingUser = false;
        this.showError(err.error?.error || 'Failed to add user');
      }
    });
  }

  toggleUser(user: any) {
    this.api.toggleAdminUser(user.pm_user_id).subscribe({
      next: (res: any) => {
        user.is_active = res.data.is_active;
        this.showSuccess(`User ${res.data.is_active ? 'activated' : 'deactivated'}`);
        this.cdr.detectChanges();
      },
      error: () => this.showError('Failed to update user status')
    });
  }

  openUserAccess(user: any) {
    // Switch to the access tab — future: highlight that user's rows
    this.newAccess.pm_user_id = user.pm_user_id;
  }

  grantAccess() {
    if (!this.newAccess.pm_user_id || !this.newAccess.project_id) return;
    this.grantingAccess = true;
    this.api.grantAccess({
      pm_user_id: this.newAccess.pm_user_id,
      project_id: this.newAccess.project_id,
      can_edit: this.newAccess.can_edit ? 1 : 0,
      can_submit: this.newAccess.can_submit ? 1 : 0
    }).subscribe({
      next: () => {
        this.showSuccess('Access granted');
        this.newAccess = { pm_user_id: null, project_id: null, can_edit: true, can_submit: true };
        this.grantingAccess = false;
        this.loadAccess();
      },
      error: () => { this.grantingAccess = false; this.showError('Failed to grant access'); }
    });
  }

  updateAccess(acc: any, field: 'can_edit' | 'can_submit', value: boolean) {
    acc[field] = value;
    this.api.updateAccess(acc.id, { can_edit: acc.can_edit ? 1 : 0, can_submit: acc.can_submit ? 1 : 0 }).subscribe({
      next: () => this.showSuccess('Access updated'),
      error: () => this.showError('Failed to update access')
    });
  }

  revokeAccess(acc: any) {
    this.api.revokeAccess(acc.id).subscribe({
      next: () => {
        this.showSuccess(`Access revoked for ${acc.display_name}`);
        this.accessList = this.accessList.filter(a => a.id !== acc.id);
        this.cdr.detectChanges();
      },
      error: () => this.showError('Failed to revoke access')
    });
  }

  private showSuccess(msg: string) {
    this.snackBar.open(msg, 'Close', { duration: 3000, horizontalPosition: 'end', verticalPosition: 'top' });
  }
  private showError(msg: string) {
    this.snackBar.open(msg, 'Close', { duration: 5000, horizontalPosition: 'end', verticalPosition: 'top', panelClass: ['snack-error'] });
  }
}
