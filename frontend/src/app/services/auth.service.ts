import { Injectable, signal, computed } from '@angular/core';
import { Router } from '@angular/router';

export interface UserProfile {
  name: string;
  email: string;
  designation: string;
  initials: string;
}

// Mock users — swap out for real MSAL lookup once App Registration is approved by AMD IT
const MOCK_USERS: Record<string, UserProfile> = {
  'rahul.arya@amd.com':  { name: 'Rahul Arya',      email: 'rahul.arya@amd.com',  designation: 'Technical Business Analyst', initials: 'RA' },
  'fai.fan@amd.com':     { name: 'Fai Fan',          email: 'fai.fan@amd.com',     designation: 'Senior Manager',             initials: 'FF' },
  'alvin.huan@amd.com':  { name: 'Alvin Huan',       email: 'alvin.huan@amd.com',  designation: 'Director',                   initials: 'AH' },
  'luugi.marsan@amd.com':{ name: 'Luugi Marsan',     email: 'luugi.marsan@amd.com',designation: 'Director',                   initials: 'LM' },
  'tim.writer@amd.com':  { name: 'Tim Writer',       email: 'tim.writer@amd.com',  designation: 'Director',                   initials: 'TW' },
  'ray.huang@amd.com':   { name: 'Ray Huang',        email: 'ray.huang@amd.com',   designation: 'Senior Manager',             initials: 'RH' },
};

const ELEVATED_DESIGNATIONS = ['Senior Manager', 'Technical Business Analyst', 'Director', 'VP'];
const SESSION_KEY = 'sizing_portal_user';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private _user = signal<UserProfile | null>(this.loadFromSession());

  readonly user = this._user.asReadonly();
  readonly isLoggedIn = computed(() => this._user() !== null);
  readonly isElevated = computed(() => {
    const u = this._user();
    return u ? ELEVATED_DESIGNATIONS.includes(u.designation) : false;
  });

  constructor(private router: Router) {}

  private loadFromSession(): UserProfile | null {
    try {
      const stored = sessionStorage.getItem(SESSION_KEY);
      return stored ? JSON.parse(stored) : null;
    } catch { return null; }
  }

  // Mock login — looks up the email against the mock users list
  // When real MSAL is wired: replace this with the MSAL token + RA_pm_users DB lookup
  login(email: string): { success: boolean; error?: string } {
    const normalized = email.toLowerCase().trim();
    const user = MOCK_USERS[normalized];
    if (!user) {
      return { success: false, error: 'Account not found. Please sign in with your AMD email address (@amd.com).' };
    }
    this._user.set(user);
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(user));
    return { success: true };
  }

  logout() {
    this._user.set(null);
    sessionStorage.removeItem(SESSION_KEY);
    this.router.navigate(['/login']);
  }
}
