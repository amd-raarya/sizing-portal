import { Injectable, inject, signal } from '@angular/core';
import { ApiService } from './api.service';
import { AuthService } from './auth.service';

/**
 * Whether the signed-in user may use forecast estimates (placeholders for projects that are not sized yet).
 * The backend decides (allow-list: pilot first, then every elevated user); this only mirrors the answer
 * so the menu entry, the matrix badges and the output flag follow it.
 */
@Injectable({ providedIn: 'root' })
export class ForecastAccessService {
  private api = inject(ApiService);
  private auth = inject(AuthService);

  private _allowed = signal(false);
  private checkedFor = '';
  readonly allowed = this._allowed.asReadonly();

  /** Safe to call often: asks the backend once per signed-in e-mail. */
  refresh(): void {
    const email = this.auth.user()?.email || '';
    if (!email || !this.auth.isElevated()) { this._allowed.set(false); this.checkedFor = ''; return; }
    if (email === this.checkedFor) return;
    this.checkedFor = email;
    this.api.getForecastAccess(email).subscribe({
      next: (r: any) => this._allowed.set(!!r?.data?.allowed),
      error: () => { this._allowed.set(false); this.checkedFor = ''; }
    });
  }
}
