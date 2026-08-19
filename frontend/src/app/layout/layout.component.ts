import { Component, signal, inject } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { CommonModule } from '@angular/common';
import { AuthService } from '../services/auth.service';
import { QuarterService } from '../services/quarter.service';

@Component({
  selector: 'app-layout',
  standalone: true,
  imports: [
    RouterOutlet, RouterLink, RouterLinkActive, CommonModule,
    MatIconModule, MatButtonModule, MatTooltipModule
  ],
  template: `
    <!-- AMD-styled toolbar -->
    <div class="amd-toolbar">
      <div class="toolbar-left">
        <a routerLink="/projects" class="amd-logo">
          <img src="amd-logo.svg" height="20" alt="AMD" class="amd-logo-img">
        </a>
        <span class="toolbar-divider"></span>
        <span class="app-title">Sizing Portal</span>
        <span class="app-badge">Beta</span>
      </div>
      <div class="toolbar-right">
        <span class="user-chip">
          <span class="user-avatar">{{ auth.user()?.initials }}</span>
          {{ auth.user()?.name }}
          <span class="user-role-badge">{{ auth.user()?.designation }}</span>
        </span>
        <span class="env-badge">AMD Internal</span>
        <button class="logout-btn" (click)="auth.logout()" matTooltip="Sign out">
          <mat-icon>logout</mat-icon>
        </button>
      </div>
    </div>

    <div class="layout-body">
      <!-- Sidebar -->
      <div class="sidenav">

        <a routerLink="/projects" routerLinkActive="nav-active" class="nav-row">
          <mat-icon class="nav-icon">folder</mat-icon>
          <span class="nav-label">Projects</span>
        </a>

        <div class="nav-row nav-collapsible" (click)="viewsOpen.set(!viewsOpen())">
          <mat-icon class="nav-icon">bar_chart</mat-icon>
          <span class="nav-label">Views</span>
          <mat-icon class="nav-chevron">{{ viewsOpen() ? 'keyboard_arrow_up' : 'keyboard_arrow_down' }}</mat-icon>
        </div>
        @if (viewsOpen()) {
          <a routerLink="/views/sizing" routerLinkActive="sub-active" class="nav-sub-row">Sizing <span class="live-tag">Live</span></a>
          <a routerLink="/views/allocation" routerLinkActive="sub-active" class="nav-sub-row">Allocation <span class="cs-tag">Preview</span></a>
          <a routerLink="/views/gap" routerLinkActive="sub-active" class="nav-sub-row">Gap <span class="cs-tag">Preview</span></a>
          <a routerLink="/views/gantt" routerLinkActive="sub-active" class="nav-sub-row">Project Gantt <span class="live-tag">Live</span></a>
        }

        @if (auth.isElevated()) {
          <div class="nav-row nav-collapsible" (click)="reportsOpen.set(!reportsOpen())">
            <mat-icon class="nav-icon">assessment</mat-icon>
            <span class="nav-label">Reports</span>
            <mat-icon class="nav-chevron">{{ reportsOpen() ? 'keyboard_arrow_up' : 'keyboard_arrow_down' }}</mat-icon>
          </div>
          @if (reportsOpen()) {
            <a routerLink="/reports/funding-project" routerLinkActive="sub-active" class="nav-sub-row">Fund Breakdown By Projects <span class="cs-tag">Preview</span></a>
            <a routerLink="/reports/funding-manager" routerLinkActive="sub-active" class="nav-sub-row">Fund Breakdown between Directors <span class="cs-tag">Preview</span></a>
            <a routerLink="/reports/funding-director" routerLinkActive="sub-active" class="nav-sub-row">HC Distribution between Managers <span class="cs-tag">Preview</span></a>
          }
        }

        <div class="nav-bottom">
          @if (auth.isElevated()) {
            <div class="nav-row nav-collapsible" (click)="adminOpen.set(!adminOpen())">
              <mat-icon class="nav-icon">admin_panel_settings</mat-icon>
              <span class="nav-label">Admin</span>
              <mat-icon class="nav-chevron">{{ adminOpen() ? 'keyboard_arrow_up' : 'keyboard_arrow_down' }}</mat-icon>
            </div>
            @if (adminOpen()) {
              <a routerLink="/admin" routerLinkActive="sub-active" class="nav-sub-row">Panel</a>
              <a routerLink="/allocation" routerLinkActive="sub-active" class="nav-sub-row">Resource Allocation <span class="live-tag">Beta</span></a>
            }
          }
        </div>

      </div>

      <!-- Main content -->
      <div class="main-content">
        <router-outlet />
      </div>
    </div>
  `,
  styles: [`
    /* ── Toolbar ── */
    :host { display: block; }
    .amd-toolbar {
      flex-shrink: 0;
      position: fixed; top: 0; z-index: 1000; width: 100%;
      background: #1a1a1a; height: 56px; padding: 0 20px;
      display: flex; align-items: center; justify-content: space-between;
      box-sizing: border-box; box-shadow: 0 2px 8px rgba(0,0,0,0.4);
    }
    .toolbar-left { display: flex; align-items: center; gap: 14px; }
    .amd-logo { display: flex; align-items: center; text-decoration: none; cursor: pointer; opacity: 1; transition: opacity 0.15s; }
    .amd-logo:hover { opacity: 0.8; }
    .amd-logo-img { display: block; height: 20px; width: auto; }
    .toolbar-divider { width: 1px; height: 26px; background: rgba(255,255,255,0.2); }
    .app-title { font-size: 15px; font-weight: 400; color: #ccc; }
    .app-badge { background: #ED1C24; color: white; font-size: 10px; padding: 2px 8px; border-radius: 10px; font-weight: 700; }
    .toolbar-right { display: flex; align-items: center; gap: 12px; }
    .user-chip { display: flex; align-items: center; gap: 8px; font-size: 13px; color: #bbb; }
    .user-avatar { width: 28px; height: 28px; border-radius: 50%; background: #ED1C24; color: white; font-size: 11px; font-weight: 700; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
    .user-role-badge { font-size: 10px; background: rgba(255,255,255,0.08); color: #999; padding: 1px 8px; border-radius: 8px; }
    .env-badge { background: rgba(237,28,36,0.15); color: #ff8080; font-size: 11px; padding: 2px 10px; border-radius: 10px; border: 1px solid rgba(237,28,36,0.25); }
    .logout-btn { background: none; border: none; cursor: pointer; color: #888; display: flex; align-items: center; padding: 4px; border-radius: 4px; transition: color 0.15s; }
    .logout-btn:hover { color: #ff8080; }
    .logout-btn mat-icon { font-size: 18px; width: 18px; height: 18px; }

    /* ── Quarter strip ── */
    .quarter-strip {
      position: fixed; top: 56px; left: 0; right: 0; z-index: 999;
      background: #ffffff; border-bottom: 1px solid #e8e8e8;
      display: flex; align-items: center; gap: 4px;
      padding: 6px 20px; overflow-x: auto; height: 44px;
      box-shadow: 0 1px 4px rgba(0,0,0,0.06);
    }
    .quarter-strip::-webkit-scrollbar { display: none; }
    .qs-nav { background: none; border: 1px solid #e0e0e0; border-radius: 50%; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; cursor: pointer; flex-shrink: 0; color: #555; transition: all 0.15s; padding: 0; }
    .qs-nav:hover { background: #f5f5f5; border-color: #bbb; }
    .qs-nav mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .qs-pill { background: none; border: 1px solid transparent; border-radius: 20px; padding: 3px 12px; font-size: 12px; font-weight: 500; color: #888; cursor: pointer; white-space: nowrap; transition: all 0.15s; display: flex; align-items: center; gap: 4px; font-family: inherit; flex-shrink: 0; }
    .qs-pill:hover { background: #f5f5f5; color: #333; border-color: #e0e0e0; }
    .qs-past { color: #aaa; }
    .qs-current { color: #1565c0; font-weight: 700; }
    .qs-selected { background: #1a1a2e !important; color: white !important; border-color: #1a1a2e !important; }
    .qs-dot { width: 5px; height: 5px; border-radius: 50%; background: #ED1C24; flex-shrink: 0; }
    .qs-today { margin-left: 8px; background: none; border: 1.5px solid #ED1C24; border-radius: 12px; padding: 3px 12px; font-size: 11px; font-weight: 700; color: #ED1C24; cursor: pointer; font-family: inherit; transition: all 0.15s; flex-shrink: 0; }
    .qs-today:hover { background: #ED1C24; color: white; }

    /* ── Layout ── */
    .layout-body { display: flex; margin-top: 56px; min-height: 100vh; }
    .sidenav { width: 210px; flex-shrink: 0; background: #fff; border-right: 1px solid #e8e8e8; display: flex; flex-direction: column; padding-top: 8px; position: sticky; top: 56px; height: calc(100vh - 56px); overflow-y: auto; }

    /* ── Shared nav row — all top-level items look the same ── */
    .nav-row {
      display: flex; align-items: center; gap: 10px;
      padding: 10px 14px; text-decoration: none;
      font-size: 14px; font-weight: 500; color: #333;
      cursor: pointer; user-select: none;
      transition: background 0.12s;
    }
    .nav-row:hover { background: #f5f5f5; }
    .nav-active { color: #ED1C24 !important; background: rgba(237,28,36,0.06) !important; border-left: 3px solid #ED1C24; }
    .nav-collapsible { color: #333; }
    .nav-disabled { color: #c0c0c0; cursor: default; }
    .nav-disabled:hover { background: transparent; }

    .nav-icon { font-size: 20px; width: 20px; height: 20px; color: inherit; flex-shrink: 0; }
    .nav-label { flex: 1; }
    .nav-chevron { font-size: 18px; width: 18px; height: 18px; color: #aaa; }

    /* ── Sub-items ── */
    .nav-sub-row {
      display: block; padding: 7px 14px 7px 44px;
      text-decoration: none; font-size: 13px; color: #666;
      transition: background 0.12s; cursor: pointer;
    }
    .nav-sub-row:hover { background: #f5f5f5; color: #333; }
    .sub-active { color: #ED1C24 !important; font-weight: 500; }

    .soon-tag { font-size: 9px; background: #f0f0f0; color: #bbb; padding: 1px 6px; border-radius: 8px; }
    .cs-tag { font-size: 9px; background: #fff3e0; color: #e65100; padding: 1px 6px; border-radius: 8px; font-weight: 600; margin-left: 4px; flex-shrink: 0; }
    .live-tag { font-size: 9px; background: #e8f5e9; color: #2e7d32; padding: 1px 6px; border-radius: 8px; font-weight: 600; margin-left: 4px; flex-shrink: 0; }
    .nav-bottom { margin-top: auto; border-top: 1px solid #f0f0f0; padding-top: 6px; }

    /* ── Main content ── */
    .main-content { flex: 1; padding: 28px; background: #f4f5f7; overflow-x: hidden; box-sizing: border-box; min-height: calc(100vh - 56px); }
  `]
})
export class LayoutComponent {
  viewsOpen = signal(true);
  reportsOpen = signal(true);
  adminOpen = signal(true);
  auth = inject(AuthService);
  qs = inject(QuarterService);
}