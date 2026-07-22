import { Injectable, signal, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
// Note: @azure/msal-angular is NOT imported here — MSAL browser is loaded dynamically only on HTTPS

export interface UserProfile {
  name: string;
  email: string;
  designation: string;
  initials: string;
}

const ELEVATED_DESIGNATIONS = ['Senior Manager', 'Technical Business Analyst', 'Director', 'VP'];
const SESSION_KEY = 'sizing_portal_user';

const DESIGNATION_MAP: Record<string, string> = {
  'rahul.arya@amd.com':             'Technical Business Analyst',
  'raarya@amd.com':                 'Technical Business Analyst',
  'phanimadhav.chamarty@amd.com':   'Program Manager 2',
  'pchamart@amd.com':               'Program Manager 2',
  'jeffrey.weyman@amd.com':         'Director',
  'jweyman@amd.com':                'Director',
  'fai.fan@amd.com':                'Senior Manager',
  'ffan@amd.com':                   'Senior Manager',
  'alvin.huan@amd.com':             'Director',
  'ahuan@amd.com':                  'Director',
  'luugi.marsan@amd.com':           'Director',
  'lmarsan@amd.com':                'Director',
  'tim.writer@amd.com':             'Director',
  'tiwriter@amd.com':               'Director',
  'ray.huang@amd.com':              'Senior Manager',
  'ruihuang@amd.com':               'Senior Manager',
  'shimmer.huang@amd.com':          'Senior Manager',
  'xhuang@amd.com':                 'Senior Manager',
  'donald.cheung@amd.com':          'Senior Manager',
  'cheungd@amd.com':                'Senior Manager',
  'alexander.deucher@amd.com':      'Director',
  'adeucher@amd.com':               'Director',
  'pierre.jabbour@amd.com':         'Senior Manager',
  'pjabbour@amd.com':               'Senior Manager',
  'veerabadhran.gopalakrishnan@amd.com': 'Senior Manager',
  'vegopala@amd.com':               'Senior Manager',
  'slava.abramov@amd.com':          'Senior Manager',
  'sabramov@amd.com':               'Senior Manager',
  'hui.yu@amd.com':                 'Senior Manager',
  'huiyu@amd.com':                  'Senior Manager',
  'divyauday.shikre@amd.com':       'Program Manager',
  'dishikre@amd.com':               'Program Manager',
};

@Injectable({ providedIn: 'root' })
export class AuthService {
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

  private isSecureContext(): boolean {
    return window.location.protocol === 'https:' || window.location.hostname === 'localhost';
  }

  // ── Real MSAL login — lazy loads MSAL browser SDK only on HTTPS ──
  async loginWithMsal(): Promise<void> {
    if (!this.isSecureContext()) {
      throw new Error('MSAL requires HTTPS.');
    }
    // Dynamically import MSAL browser — only runs on HTTPS
    const { PublicClientApplication, BrowserCacheLocation } = await import('@azure/msal-browser');
    const msalInstance = new PublicClientApplication({
      auth: {
        clientId: '99987163-482b-4533-b8fa-bb5dbf7c0e63',
        authority: 'https://login.microsoftonline.com/3dd8961f-e488-4e60-8e11-a82d994e183d',
        redirectUri: window.location.origin,
      },
      cache: { cacheLocation: BrowserCacheLocation.SessionStorage },
    });
    await msalInstance.initialize();
    await msalInstance.loginRedirect({
      scopes: ['User.Read', 'openid', 'profile', 'email'],
      prompt: 'select_account',
    });
  }

  async handleRedirectCallback(): Promise<void> {
    if (!this.isSecureContext()) return;
    try {
      const { PublicClientApplication, BrowserCacheLocation } = await import('@azure/msal-browser');
      const msalInstance = new PublicClientApplication({
        auth: {
          clientId: '99987163-482b-4533-b8fa-bb5dbf7c0e63',
          authority: 'https://login.microsoftonline.com/3dd8961f-e488-4e60-8e11-a82d994e183d',
          redirectUri: window.location.origin,
        },
        cache: { cacheLocation: BrowserCacheLocation.SessionStorage },
      });
      await msalInstance.initialize();
      const result = await msalInstance.handleRedirectPromise();
      if (result?.account) {
        await this.setUserFromAccount(result.account, result.account.username);
        this.router.navigate(['/projects']);
      } else {
        const accounts = msalInstance.getAllAccounts();
        if (accounts.length > 0 && !this._user()) {
          await this.setUserFromAccount(accounts[0], accounts[0].username);
          this.router.navigate(['/projects']);
        }
      }
    } catch (err) {
      console.error('MSAL redirect error:', err);
    }
  }

  private async setUserFromAccount(account: any, email: string): Promise<void> {
    const emailLower = (email || '').toLowerCase();
    const name = account.name || account.username;
    const initials = name.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2);
    let designation = DESIGNATION_MAP[emailLower] || 'Program Manager';
    try {
      const res: any = await firstValueFrom(
        this.http.get(`http://localhost:3000/api/admin/users/by-email?email=${encodeURIComponent(emailLower)}`)
      );
      if (res?.data?.designation) designation = res.data.designation;
    } catch {}
    this.saveToSession({ name, email: emailLower, designation, initials });
  }

  // ── Mock login (for HTTP or testing) ──
  login(email: string): { success: boolean; error?: string } {
    const MOCK_USERS: Record<string, UserProfile> = {
      'rahul.arya@amd.com':          { name: 'Rahul Arya',   email: 'rahul.arya@amd.com',          designation: 'Technical Business Analyst', initials: 'RA' },
      'raarya@amd.com':              { name: 'Rahul Arya',   email: 'raarya@amd.com',               designation: 'Technical Business Analyst', initials: 'RA' },
      'phanimadhav.chamarty@amd.com':{ name: 'Phani Chamarty', email: 'phanimadhav.chamarty@amd.com', designation: 'Program Manager 2',        initials: 'PC' },
      'pchamart@amd.com':            { name: 'Phani Chamarty', email: 'pchamart@amd.com',             designation: 'Program Manager 2',        initials: 'PC' },
      'fai.fan@amd.com':             { name: 'Fai Fan',       email: 'fai.fan@amd.com',               designation: 'Senior Manager',           initials: 'FF' },
      'alvin.huan@amd.com':          { name: 'Alvin Huan',    email: 'alvin.huan@amd.com',            designation: 'Director',                 initials: 'AH' },
      'luugi.marsan@amd.com':        { name: 'Luugi Marsan',  email: 'luugi.marsan@amd.com',          designation: 'Director',                 initials: 'LM' },
      'tim.writer@amd.com':          { name: 'Tim Writer',    email: 'tim.writer@amd.com',            designation: 'Director',                 initials: 'TW' },
      'ray.huang@amd.com':           { name: 'Ray Huang',     email: 'ray.huang@amd.com',             designation: 'Senior Manager',           initials: 'RH' },
    };
    const user = MOCK_USERS[email.toLowerCase().trim()];
    if (!user) return { success: false, error: 'Account not found. Please use your AMD email address (@amd.com).' };
    this.saveToSession(user);
    return { success: true };
  }

  logout() {
    this._user.set(null);
    sessionStorage.removeItem(SESSION_KEY);
    this.router.navigate(['/login']);
  }
}
