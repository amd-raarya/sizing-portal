import { Component, signal } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatListModule } from '@angular/material/list';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-layout',
  standalone: true,
  imports: [
    RouterOutlet, RouterLink, RouterLinkActive, CommonModule,
    MatSidenavModule, MatToolbarModule,
    MatIconModule, MatButtonModule, MatTooltipModule
  ],
  template: `
    <!-- AMD-styled toolbar -->
    <div class="amd-toolbar">
      <div class="toolbar-left">
        <div class="amd-logo">
          <span class="amd-wordmark">AMD</span>
        </div>
        <span class="toolbar-divider"></span>
        <span class="app-title">Sizing Portal</span>
        <span class="app-badge">Beta</span>
      </div>
      <div class="toolbar-right">
        <span class="user-chip">
          <mat-icon class="user-icon">account_circle</mat-icon>
          Rahul Arya
        </span>
        <span class="env-badge">AMD Internal</span>
      </div>
    </div>

    <mat-sidenav-container class="sidenav-container">
      <mat-sidenav mode="side" opened class="sidenav">

        <!-- Projects -->
        <a routerLink="/projects" routerLinkActive="nav-active" class="nav-row">
          <mat-icon class="nav-icon">folder</mat-icon>
          <span class="nav-label">Projects</span>
        </a>

        <!-- Views -->
        <div class="nav-row nav-collapsible" (click)="viewsOpen.set(!viewsOpen())">
          <mat-icon class="nav-icon">bar_chart</mat-icon>
          <span class="nav-label">Views</span>
          <mat-icon class="nav-chevron">{{ viewsOpen() ? 'keyboard_arrow_up' : 'keyboard_arrow_down' }}</mat-icon>
        </div>
        @if (viewsOpen()) {
          <a routerLink="/views/sizing" routerLinkActive="sub-active" class="nav-sub-row">Sizing</a>
          <a routerLink="/views/gap" routerLinkActive="sub-active" class="nav-sub-row">Gap</a>
          <a routerLink="/views/allocation" routerLinkActive="sub-active" class="nav-sub-row">Allocation</a>
        }

        <!-- Reports -->
        <div class="nav-row nav-collapsible" (click)="reportsOpen.set(!reportsOpen())">
          <mat-icon class="nav-icon">assessment</mat-icon>
          <span class="nav-label">Reports</span>
          <mat-icon class="nav-chevron">{{ reportsOpen() ? 'keyboard_arrow_up' : 'keyboard_arrow_down' }}</mat-icon>
        </div>
        @if (reportsOpen()) {
          <a routerLink="/reports/funding-project" routerLinkActive="sub-active" class="nav-sub-row">By Project</a>
          <a routerLink="/reports/funding-manager" routerLinkActive="sub-active" class="nav-sub-row">By Manager</a>
          <a routerLink="/reports/funding-director" routerLinkActive="sub-active" class="nav-sub-row">By Director</a>
        }

        <div class="nav-bottom">
          <div class="nav-row nav-disabled">
            <mat-icon class="nav-icon">manage_accounts</mat-icon>
            <span class="nav-label">User Management</span>
            <span class="soon-tag">Soon</span>
          </div>
        </div>

      </mat-sidenav>

      <mat-sidenav-content class="main-content">
        <router-outlet />
      </mat-sidenav-content>
    </mat-sidenav-container>
  `,
  styles: [`
    /* ── Toolbar ── */
    .amd-toolbar {
      position: fixed; top: 0; z-index: 1000; width: 100%;
      background: #1a1a1a; height: 56px; padding: 0 20px;
      display: flex; align-items: center; justify-content: space-between;
      box-sizing: border-box; box-shadow: 0 2px 8px rgba(0,0,0,0.4);
    }
    .toolbar-left { display: flex; align-items: center; gap: 14px; }
    .amd-logo { display: flex; align-items: center; }
    .amd-wordmark { color: white; font-size: 22px; font-weight: 900; letter-spacing: 2px; font-family: 'Arial Black', Arial, sans-serif; }
    .toolbar-divider { width: 1px; height: 26px; background: rgba(255,255,255,0.2); }
    .app-title { font-size: 15px; font-weight: 400; color: #ccc; }
    .app-badge { background: #ED1C24; color: white; font-size: 10px; padding: 2px 8px; border-radius: 10px; font-weight: 700; }
    .toolbar-right { display: flex; align-items: center; gap: 12px; }
    .user-chip { display: flex; align-items: center; gap: 6px; font-size: 13px; color: #bbb; }
    .user-icon { font-size: 20px; width: 20px; height: 20px; color: #999; }
    .env-badge { background: rgba(237,28,36,0.15); color: #ff8080; font-size: 11px; padding: 2px 10px; border-radius: 10px; border: 1px solid rgba(237,28,36,0.25); }

    /* ── Layout ── */
    .sidenav-container { height: calc(100vh - 56px); margin-top: 56px; }
    .sidenav { width: 210px; background: #fff; border-right: 1px solid #e8e8e8; display: flex; flex-direction: column; overflow-y: auto; padding-top: 8px; }

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
    .nav-bottom { margin-top: auto; border-top: 1px solid #f0f0f0; padding-top: 6px; }

    /* ── Main content ── */
    .main-content { padding: 28px; background: #f4f5f7; min-height: 100%; overflow-y: auto; }
  `]
})
export class LayoutComponent {
  viewsOpen = signal(true);
  reportsOpen = signal(true);
}