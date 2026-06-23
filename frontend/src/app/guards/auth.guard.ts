import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { MsalService } from '@azure/msal-angular';

export const authGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const msal = inject(MsalService);
  const router = inject(Router);

  // Already logged in via session
  if (auth.isLoggedIn()) return true;

  // Check if MSAL has an active account (returning from Azure AD redirect)
  try {
    await msal.instance.initialize();
    const accounts = msal.instance.getAllAccounts();
    if (accounts.length > 0) {
      // Let app-root handleRedirectCallback deal with it
      return true;
    }
  } catch { /* ignore */ }

  router.navigate(['/login']);
  return false;
};
