import { Component, signal, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { MatIconModule } from '@angular/material/icon';
import { ChangeDetectionStrategy } from '@angular/core';

@Component({
  selector: 'app-login',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, MatIconModule],
  template: `
    <div class="login-page">
      <div class="login-card">

        <!-- AMD Header -->
        <div class="login-header">
          <img src="amd-logo.svg" height="28" alt="AMD" class="login-logo" />
          <span class="login-divider"></span>
          <span class="login-app-name">Sizing Portal</span>
        </div>

        <!-- Title -->
        <div class="login-body">
          <h2 class="login-title">Sign in</h2>
          <p class="login-subtitle">Use your AMD Microsoft account to continue</p>

          @if (error()) {
            <div class="login-error">
              <span class="error-icon">⚠</span>
              <span>{{ error() }}</span>
            </div>
          }

          <div class="login-field">
            <label class="field-label">Email address</label>
            <input
              class="field-input"
              type="email"
              [(ngModel)]="email"
              placeholder="yourname@amd.com"
              (keydown.enter)="signIn()"
              autocomplete="email"
              [disabled]="loading()"
            />
          </div>

          <!-- Primary: Real Azure AD SSO (HTTPS only) -->
          @if (isHttps) {
            <button class="signin-btn ms-btn" (click)="signInWithMicrosoft()" [disabled]="loading()">
              @if (loading() && msalLoading()) {
                <span class="spinner"></span> Redirecting...
              } @else {
                <img src="https://learn.microsoft.com/en-us/entra/identity-platform/media/howto-add-branding-in-apps/ms-symbollockup_signin_light.svg"
                     height="41" alt="Sign in with Microsoft" style="pointer-events:none; display:block;" />
              }
            </button>
            <div class="divider"><span>or use mock account</span></div>
          } @else {
            <div class="http-notice">
              <mat-icon style="font-size:14px;width:14px;height:14px;color:#888">info</mat-icon>
              Microsoft SSO requires HTTPS — use mock login below
            </div>
          }

          <!-- Fallback: mock email login for testing -->
          <button class="signin-btn mock-btn" (click)="signIn()" [disabled]="loading() || !email">
            @if (loading() && !msalLoading()) {
              <span class="spinner"></span> Signing in...
            } @else {
              <mat-icon>login</mat-icon> Sign in with Mock Account
            }
          </button>

          <div class="login-note">
            <mat-icon class="note-icon">lock</mat-icon>
            Secured by Microsoft Azure Active Directory
          </div>
        </div>

        <!-- Footer -->
        <div class="login-footer">
          AMD Internal Use Only &nbsp;·&nbsp; Sizing & Allocation Portal
        </div>
      </div>

      <!-- Background branding -->
      <div class="login-bg-text">AMD Sizing Portal</div>
    </div>
  `,
  styles: [`
    .login-page {
      min-height: 100vh; display: flex; align-items: center; justify-content: center;
      background: linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 50%, #1a1a2e 100%);
      position: relative; overflow: hidden;
    }

    .login-bg-text {
      position: absolute; bottom: 40px; right: 60px;
      font-size: 72px; font-weight: 800; color: rgba(255,255,255,0.04);
      user-select: none; white-space: nowrap; letter-spacing: -2px;
    }

    .login-card {
      background: white; border-radius: 12px; width: 400px;
      box-shadow: 0 24px 60px rgba(0,0,0,0.4);
      overflow: hidden; position: relative; z-index: 1;
    }

    /* Header */
    .login-header {
      background: #1a1a1a; padding: 20px 28px;
      display: flex; align-items: center; gap: 14px;
    }
    .login-logo { display: block; }
    .login-divider { width: 1px; height: 24px; background: rgba(255,255,255,0.2); }
    .login-app-name { color: #ccc; font-size: 14px; font-weight: 400; }

    /* Body */
    .login-body { padding: 32px 28px 24px; }
    .login-title { margin: 0 0 6px; font-size: 24px; font-weight: 600; color: #1a1a2e; }
    .login-subtitle { margin: 0 0 24px; font-size: 13px; color: #888; }

    .login-error {
      display: flex; align-items: flex-start; gap: 10px;
      background: #fff0f0; color: #b71c1c;
      border: 1px solid #ffcdd2; border-left: 4px solid #ED1C24;
      border-radius: 6px; padding: 12px 14px; font-size: 13px;
      margin-bottom: 20px; line-height: 1.5;
    }
    .error-icon { font-size: 16px; flex-shrink: 0; margin-top: 1px; }

    .login-field { margin-bottom: 20px; }
    .field-label { display: block; font-size: 13px; font-weight: 500; color: #444; margin-bottom: 6px; }
    .field-input {
      width: 100%; box-sizing: border-box;
      padding: 10px 14px; border: 1.5px solid #ddd; border-radius: 6px;
      font-size: 14px; color: #1a1a2e; outline: none; transition: border 0.15s;
      font-family: inherit;
    }
    .field-input:focus { border-color: #ED1C24; }
    .field-input:disabled { background: #f9f9f9; color: #aaa; }

    .signin-btn {
      width: 100%; padding: 12px; border: none; border-radius: 6px;
      font-size: 14px; font-weight: 600; cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      gap: 8px; transition: all 0.15s; font-family: inherit; margin-bottom: 10px;
    }
    .signin-btn:disabled { opacity: 0.6; cursor: not-allowed; }
    .signin-btn mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .ms-btn { background: transparent; border: none; padding: 0; }
    .ms-btn:hover:not(:disabled) { opacity: 0.85; }
    .http-notice { display: flex; align-items: center; gap: 6px; font-size: 11px; color: #999; background: #f8f8f8; padding: 8px 12px; border-radius: 6px; margin-bottom: 10px; }
    .mock-btn { background: white; color: #555; border: 1.5px solid #ddd; }
    .mock-btn:hover:not(:disabled) { background: #f5f5f5; border-color: #bbb; }

    .divider { display: flex; align-items: center; gap: 10px; margin: 4px 0 14px; }
    .divider::before, .divider::after { content: ''; flex: 1; height: 1px; background: #eee; }
    .divider span { font-size: 11px; color: #bbb; white-space: nowrap; }

    .spinner {
      width: 16px; height: 16px; border: 2px solid rgba(255,255,255,0.4);
      border-top-color: white; border-radius: 50%;
      animation: spin 0.7s linear infinite; display: inline-block;
    }
    @keyframes spin { to { transform: rotate(360deg); } }

    .login-note {
      display: flex; align-items: center; justify-content: center;
      gap: 6px; margin-top: 16px; font-size: 11px; color: #aaa;
    }
    .note-icon { font-size: 14px; width: 14px; height: 14px; color: #4caf50; }

    /* Footer */
    .login-footer {
      padding: 14px 28px; background: #f8f9fa; border-top: 1px solid #f0f0f0;
      font-size: 11px; color: #bbb; text-align: center;
    }
  `]
})
export class LoginComponent implements OnInit {
  email = '';
  loading = signal(false);
  msalLoading = signal(false);
  error = signal('');
  isHttps = window.location.protocol === 'https:' || window.location.hostname === 'localhost';

  constructor(private auth: AuthService, private router: Router) {}

  async ngOnInit() {
    // If already logged in, go straight to projects
    if (this.auth.isLoggedIn()) { this.router.navigate(['/projects']); return; }
    // Handle Azure AD redirect callback (user returning from Microsoft login)
    await this.auth.handleRedirectCallback();
    if (this.auth.isLoggedIn()) this.router.navigate(['/projects']);
  }

  async signInWithMicrosoft() {
    this.loading.set(true);
    this.msalLoading.set(true);
    this.error.set('');
    try {
      await this.auth.loginWithMsal();
    } catch (err: any) {
      this.error.set('Microsoft sign-in failed. Please try again or use a mock account below.');
      this.loading.set(false);
      this.msalLoading.set(false);
    }
  }

  signIn() {
    if (!this.email || this.loading()) return;
    this.loading.set(true);
    this.msalLoading.set(false);
    this.error.set('');
    setTimeout(() => {
      const result = this.auth.login(this.email);
      if (result.success) {
        this.router.navigate(['/projects']);
      } else {
        this.error.set(result.error || 'Sign in failed.');
        this.loading.set(false);
      }
    }, 800);
  }
}
