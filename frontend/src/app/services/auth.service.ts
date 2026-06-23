import { Injectable, signal, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import { MsalService } from '@azure/msal-angular';
import { AccountInfo, InteractionRequiredAuthError } from '@azure/msal-browser';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

export interface UserProfile {
  name: string;
  email: string;
  designation: string;
  initials: string;
}

const ELEVATED_DESIGNATIONS = ['Senior Manager', 'Technical Business Analyst', 'Director', 'VP'];
const SESSION_KEY = 'sizing_portal_user';

// Fallback designation map — used when DB lookup isn't available yet
// Maps AMD email → designation. Remove once RA_pm_users has all users.
const DESIGNATION_MAP: Record<string, string> = {
  'rahul.arya@amd.com':   'Technical Business Analyst',
  'raarya@amd.com':       'Technical Business Analyst',  // alias
  'fai.fan@amd.com':      'Senior Manager',
  'alvin.huan@amd.com':   'Director',
  'luugi.marsan@amd.com': 'Director',
  'tim.writer@amd.com':   'Director',
  'ray.huang@amd.com':    'Senior Manager',
};

@Injectable({ providedIn: 'root' })
export class AuthService {
  private msalService = inject(MsalService);
  private router = inject(Router);
  private http = inject(HttpClient);

  private _user = signal<UserProfile | null>(this.loadFromSession());

  readonly user = this._user.asReadonly();
  readonly isLoggedIn = computed(() => this._user() !== null);
  readonly isElevated = computed(() => {
    const u = this._user();
    return u ? ELEVATED_DESIGNATIONS.includes(u.designation) : false;
  });

  private loadFromSession(): UserProfile | null {
    try {
      const stored = sessionStorage.getItem(SESSION_KEY);
      return stored ? JSON.parse(stored) : null;
    } catch { return null; }
  }

  private saveToSession(user: UserProfile) {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(user));
    this._user.set(user);
  }

  // ── Real MSAL login (Azure AD) ──
  async loginWithMsal(): Promise<void> {
    try {
      await this.msalService.instance.initialize();
      await this.msalService.instance.loginRedirect({
        scopes: ['User.Read', 'openid', 'profile', 'email'],
        prompt: 'select_account',
      });
      // Execution stops here — browser redirects to Microsoft
    } catch (err) {
      console.error('MSAL login error:', err);
      throw err;
    }
  }

  // Called on app init — processes the token returned from Azure AD redirect
  async handleRedirectCallback(): Promise<void> {
    try {
      await this.msalService.instance.initialize();
      const result = await this.msalService.instance.handleRedirectPromise();
      if (result?.account) {
        // Successfully returned from Azure AD with a token
        await this.setUserFromAccount(result.account);
        this.router.navigate(['/projects']);
      } else {
        // Check if already signed in from a previous session
        const accounts = this.msalService.instance.getAllAccounts();
        if (accounts.length > 0 && !this._user()) {
          await this.setUserFromAccount(accounts[0]);
          this.router.navigate(['/projects']);
        }
      }
    } catch (err: any) {
      console.error('MSAL redirect error:', err);
    }
  }

  private async setUserFromAccount(account: AccountInfo): Promise<void> {
    const email = (account.username || '').toLowerCase();
    const name = account.name || account.username;
    const initials = name.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2);

    // Try to get designation from RA_pm_users via backend, fall back to map
    let designation = DESIGNATION_MAP[email] || 'Program Manager';
    try {
      const res: any = await firstValueFrom(
        this.http.get(`http://localhost:3000/api/admin/users/by-email?email=${encodeURIComponent(email)}`)
      );
      if (res?.data?.designation) designation = res.data.designation;
    } catch { /* backend not reachable — use fallback */ }

    const profile: UserProfile = { name, email, designation, initials };
    this.saveToSession(profile);
  }

  // ── Mock login (for testing without Azure AD) ──
  login(email: string): { success: boolean; error?: string } {
    const MOCK_USERS: Record<string, UserProfile> = {
      'rahul.arya@amd.com':   { name: 'Rahul Arya',   email: 'rahul.arya@amd.com',   designation: 'Technical Business Analyst', initials: 'RA' },
      'raarya@amd.com':       { name: 'Rahul Arya',   email: 'raarya@amd.com',       designation: 'Technical Business Analyst', initials: 'RA' },
      'fai.fan@amd.com':      { name: 'Fai Fan',       email: 'fai.fan@amd.com',       designation: 'Senior Manager',             initials: 'FF' },
      'alvin.huan@amd.com':   { name: 'Alvin Huan',    email: 'alvin.huan@amd.com',    designation: 'Director',                   initials: 'AH' },
      'luugi.marsan@amd.com': { name: 'Luugi Marsan',  email: 'luugi.marsan@amd.com',  designation: 'Director',                   initials: 'LM' },
      'tim.writer@amd.com':   { name: 'Tim Writer',    email: 'tim.writer@amd.com',    designation: 'Director',                   initials: 'TW' },
      'ray.huang@amd.com':    { name: 'Ray Huang',     email: 'ray.huang@amd.com',     designation: 'Senior Manager',             initials: 'RH' },
    };
    const user = MOCK_USERS[email.toLowerCase().trim()];
    if (!user) return { success: false, error: 'Account not found. Please sign in with your AMD email address (@amd.com).' };
    this.saveToSession(user);
    return { success: true };
  }

  logout() {
    this._user.set(null);
    sessionStorage.removeItem(SESSION_KEY);
    // If MSAL has an active account, sign out of Azure AD too
    const accounts = this.msalService.instance.getAllAccounts();
    if (accounts.length > 0) {
      this.msalService.instance.logoutRedirect({ postLogoutRedirectUri: window.location.origin + '/login' });
    } else {
      this.router.navigate(['/login']);
    }
  }
}
