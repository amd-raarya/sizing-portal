import { Component } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatListModule } from '@angular/material/list';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'app-layout',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive,
    MatSidenavModule, MatToolbarModule, MatListModule, MatIconModule],
  template: `
    <mat-toolbar color="primary">
      <span>AMD Sizing Portal</span>
    </mat-toolbar>

    <mat-sidenav-container class="sidenav-container">
      <mat-sidenav mode="side" opened class="sidenav">
        <mat-nav-list>
          <a mat-list-item routerLink="/projects" routerLinkActive="active-link">
            <mat-icon matListItemIcon>folder</mat-icon>
            <span matListItemTitle>Projects</span>
          </a>
        </mat-nav-list>
      </mat-sidenav>
      <mat-sidenav-content class="main-content">
        <router-outlet />
      </mat-sidenav-content>
    </mat-sidenav-container>
  `,
  styles: [`
    mat-toolbar { position: fixed; top: 0; z-index: 1000; }
    .sidenav-container { height: calc(100vh - 64px); margin-top: 64px; }
    .sidenav { width: 220px; background: #f5f5f5; }
    .main-content { padding: 24px; }
    .active-link { background: rgba(0,0,0,0.08); font-weight: 600; }
  `]
})
export class LayoutComponent {}