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
  pm_user_id?: number;      // null for elevated users who aren't in RA_pm_users
  is_elevated?: boolean;    // from RA_pm_users.is_elevated flag
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
  // Elevated additions
  'sarah.zhao@amd.com':             'Senior Manager',
  'sarzhao@amd.com':                'Senior Manager',
  'jenny-jing.liu@amd.com':         'Senior Manager',
  'jenliu@amd.com':                 'Senior Manager',
  'hawking.zhang@amd.com':          'Director',
  'hawzhang@amd.com':               'Director',
  // PM-level additions
  'leo.liu@amd.com':                'Program Manager',
  'leoliu@amd.com':                 'Program Manager',
  'pierre-eric.pelloux-prayer@amd.com': 'Program Manager',
  'ppelloux@amd.com':               'Program Manager',
  'udaykiran.pichika@amd.com':      'Program Manager',
  'upichika@amd.com':               'Program Manager',
  'yiru.ma@amd.com':                'Program Manager',
  'yiruma12@amd.com':               'Program Manager',
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
    if (!u) return false;
    // Check is_elevated flag from DB first, then fall back to designation
    if (u.is_elevated === true) return true;
    if (u.is_elevated === false) return false;
    return ELEVATED_DESIGNATIONS.includes(u.designation);
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
    let pm_user_id: number | undefined;
    let is_elevated: boolean | undefined;
    try {
      const res: any = await firstValueFrom(
        this.http.get(`${this.apiBase}/admin/users/by-email?email=${encodeURIComponent(emailLower)}`)
      );
      if (res?.data?.designation) designation = res.data.designation;
      if (res?.data?.pm_user_id) pm_user_id = res.data.pm_user_id;
      if (res?.data?.is_elevated !== undefined) is_elevated = res.data.is_elevated === 1;
    } catch {}
    this.saveToSession({ name, email: emailLower, designation, initials, pm_user_id, is_elevated });
  }

  // Base URL for API calls in auth service
  private get apiBase(): string {
    return window.location.hostname === 'localhost' ? 'http://localhost:3000/api' : `http://${window.location.hostname}:3000/api`;
  }

  // ── Mock login (for HTTP or testing) ──
  login(email: string): { success: boolean; error?: string } {
    const MOCK_USERS: Record<string, UserProfile> = {
      'rahul.arya@amd.com':          { name: 'Rahul Arya',   email: 'rahul.arya@amd.com',          designation: 'Technical Business Analyst', initials: 'RA' },
      'raarya@amd.com':              { name: 'Rahul Arya',   email: 'raarya@amd.com',               designation: 'Technical Business Analyst', initials: 'RA' },
      'phanimadhav.chamarty@amd.com':{ name: 'Phani Chamarty', email: 'phanimadhav.chamarty@amd.com', designation: 'Program Manager 2',        initials: 'PC' },
      'pchamart@amd.com':            { name: 'Phani Chamarty', email: 'pchamart@amd.com',             designation: 'Program Manager 2',        initials: 'PC' },
      'fai.fan@amd.com':             { name: 'Fai Fan',            email: 'fai.fan@amd.com',                    designation: 'Senior Manager', initials: 'FF' },
      'ffan@amd.com':               { name: 'Fai Fan',            email: 'ffan@amd.com',                       designation: 'Senior Manager', initials: 'FF' },
      'alvin.huan@amd.com':         { name: 'Alvin Huan',         email: 'alvin.huan@amd.com',                 designation: 'Director',       initials: 'AH' },
      'ahuan@amd.com':              { name: 'Alvin Huan',         email: 'ahuan@amd.com',                      designation: 'Director',       initials: 'AH' },
      'luugi.marsan@amd.com':       { name: 'Luugi Marsan',       email: 'luugi.marsan@amd.com',               designation: 'Director',       initials: 'LM' },
      'lmarsan@amd.com':            { name: 'Luugi Marsan',       email: 'lmarsan@amd.com',                    designation: 'Director',       initials: 'LM' },
      'tim.writer@amd.com':         { name: 'Tim Writer',         email: 'tim.writer@amd.com',                 designation: 'Director',       initials: 'TW' },
      'tiwriter@amd.com':           { name: 'Tim Writer',         email: 'tiwriter@amd.com',                   designation: 'Director',       initials: 'TW' },
      'ray.huang@amd.com':          { name: 'Ray Huang',          email: 'ray.huang@amd.com',                  designation: 'Senior Manager', initials: 'RH' },
      'ruihuang@amd.com':           { name: 'Ray Huang',          email: 'ruihuang@amd.com',                   designation: 'Senior Manager', initials: 'RH' },
      'shimmer.huang@amd.com':      { name: 'Shimmer Huang',      email: 'shimmer.huang@amd.com',              designation: 'Senior Manager', initials: 'SH' },
      'xhuang@amd.com':             { name: 'Shimmer Huang',      email: 'xhuang@amd.com',                     designation: 'Senior Manager', initials: 'SH' },
      'donald.cheung@amd.com':      { name: 'Donald Cheung',      email: 'donald.cheung@amd.com',              designation: 'Senior Manager', initials: 'DC' },
      'cheungd@amd.com':            { name: 'Donald Cheung',      email: 'cheungd@amd.com',                    designation: 'Senior Manager', initials: 'DC' },
      'alexander.deucher@amd.com':  { name: 'Alex Deucher',       email: 'alexander.deucher@amd.com',          designation: 'Director',       initials: 'AD' },
      'adeucher@amd.com':           { name: 'Alex Deucher',       email: 'adeucher@amd.com',                   designation: 'Director',       initials: 'AD' },
      'jeffrey.weyman@amd.com':     { name: 'Jeff Weyman',        email: 'jeffrey.weyman@amd.com',             designation: 'Director',       initials: 'JW' },
      'jweyman@amd.com':            { name: 'Jeff Weyman',        email: 'jweyman@amd.com',                    designation: 'Director',       initials: 'JW' },
      'pierre.jabbour@amd.com':     { name: 'Pierre Jabbour',     email: 'pierre.jabbour@amd.com',             designation: 'Senior Manager', initials: 'PJ' },
      'pjabbour@amd.com':           { name: 'Pierre Jabbour',     email: 'pjabbour@amd.com',                   designation: 'Senior Manager', initials: 'PJ' },
      'veerabadhran.gopalakrishnan@amd.com': { name: 'Veera Gopalakrishnan', email: 'veerabadhran.gopalakrishnan@amd.com', designation: 'Senior Manager', initials: 'VG' },
      'vegopala@amd.com':           { name: 'Veera Gopalakrishnan', email: 'vegopala@amd.com',                 designation: 'Senior Manager', initials: 'VG' },
      'slava.abramov@amd.com':      { name: 'Slava Abramov',      email: 'slava.abramov@amd.com',              designation: 'Senior Manager', initials: 'SA' },
      'sabramov@amd.com':           { name: 'Slava Abramov',      email: 'sabramov@amd.com',                   designation: 'Senior Manager', initials: 'SA' },
      'hui.yu@amd.com':             { name: 'Hui Yu',             email: 'hui.yu@amd.com',                     designation: 'Senior Manager', initials: 'HY' },
      'hyu@amd.com':                { name: 'Hui Yu',             email: 'hyu@amd.com',                        designation: 'Senior Manager', initials: 'HY' },
      'divyauday.shikre@amd.com':    { name: 'Divya Shikre',          email: 'divyauday.shikre@amd.com',              designation: 'Program Manager', initials: 'DS' },
      'dishikre@amd.com':            { name: 'Divya Shikre',          email: 'dishikre@amd.com',                      designation: 'Program Manager', initials: 'DS' },
      // Elevated additions — primary + alias
      'sarah.zhao@amd.com':          { name: 'Sarah Zhao',            email: 'sarah.zhao@amd.com',                    designation: 'Senior Manager',  initials: 'SZ' },
      'sarzhao@amd.com':             { name: 'Sarah Zhao',            email: 'sarzhao@amd.com',                       designation: 'Senior Manager',  initials: 'SZ' },
      'jenny-jing.liu@amd.com':      { name: 'Jenny Liu',             email: 'jenny-jing.liu@amd.com',                designation: 'Senior Manager',  initials: 'JL' },
      'jenliu@amd.com':              { name: 'Jenny Liu',             email: 'jenliu@amd.com',                        designation: 'Senior Manager',  initials: 'JL' },
      'hawking.zhang@amd.com':       { name: 'Hawking Zhang',         email: 'hawking.zhang@amd.com',                 designation: 'Director',        initials: 'HZ' },
      'hawzhang@amd.com':            { name: 'Hawking Zhang',         email: 'hawzhang@amd.com',                      designation: 'Director',        initials: 'HZ' },
      // PM-level additions — primary + alias
      'leo.liu@amd.com':             { name: 'Leo Liu',               email: 'leo.liu@amd.com',                       designation: 'Program Manager', initials: 'LL' },
      'leoliu@amd.com':              { name: 'Leo Liu',               email: 'leoliu@amd.com',                        designation: 'Program Manager', initials: 'LL' },
      'pierre-eric.pelloux-prayer@amd.com': { name: 'Pierre-Eric Pelloux-Prayer', email: 'pierre-eric.pelloux-prayer@amd.com', designation: 'Program Manager', initials: 'PP' },
      'ppelloux@amd.com':            { name: 'Pierre-Eric Pelloux-Prayer', email: 'ppelloux@amd.com',                 designation: 'Program Manager', initials: 'PP' },
      'udaykiran.pichika@amd.com':   { name: 'UdayKiran Pichika',     email: 'udaykiran.pichika@amd.com',             designation: 'Program Manager', initials: 'UP' },
      'upichika@amd.com':            { name: 'UdayKiran Pichika',     email: 'upichika@amd.com',                      designation: 'Program Manager', initials: 'UP' },
      'yiru.ma@amd.com':             { name: 'Yiru Ma',               email: 'yiru.ma@amd.com',                       designation: 'Program Manager', initials: 'YM' },
      'yiruma12@amd.com':            { name: 'Yiru Ma',               email: 'yiruma12@amd.com',                      designation: 'Program Manager', initials: 'YM' },
    };
    const user = MOCK_USERS[email.toLowerCase().trim()];
    if (!user) return { success: false, error: 'Account not found. Please use your AMD email address (@amd.com).' };
    // Note: pm_user_id is fetched async in loginAsync() — call that for proper enforcement
    this.saveToSession(user);
    return { success: true };
  }

  // Async version of mock login — waits for pm_user_id before resolving
  async loginAsync(email: string): Promise<{ success: boolean; error?: string }> {
    const MOCK_USERS = (this as any).getMockUsers?.() || {};
    // Re-use the sync login to validate email
    const syncResult = this.login(email);
    if (!syncResult.success) return syncResult;

    // Now fetch pm_user_id from backend and update session
    try {
      const res: any = await firstValueFrom(
        this.http.get(`${this.apiBase}/admin/users/by-email?email=${encodeURIComponent(email.toLowerCase().trim())}`)
      );
      const stored = this.loadFromSession();
      if (stored && res?.data) {
        if (res.data.pm_user_id) stored.pm_user_id = res.data.pm_user_id;
        if (res.data.is_elevated !== undefined) stored.is_elevated = res.data.is_elevated === 1;
        this.saveToSession(stored);
      }
    } catch { /* backend unreachable — proceed without pm_user_id, elevated check will still work */ }
    return { success: true };
  }

  logout() {
    this._user.set(null);
    sessionStorage.removeItem(SESSION_KEY);
    this.router.navigate(['/login']);
  }
}
