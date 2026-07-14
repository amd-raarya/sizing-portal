import { ApplicationConfig } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideHttpClient } from '@angular/common/http';
import { routes } from './app.routes';

// MSAL Angular providers are NOT registered here.
// MSAL browser SDK is initialized lazily inside AuthService.loginWithMsal()
// only when running on HTTPS. On HTTP (internal server), mock login is used.

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(routes),
    provideAnimationsAsync(),
    provideHttpClient(),
  ]
};
