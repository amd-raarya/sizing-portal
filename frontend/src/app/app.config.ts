import { ApplicationConfig } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { routes } from './app.routes';

// MSAL only works on HTTPS (requires window.crypto / secure context)
// On HTTP (internal server), skip MSAL entirely — mock login handles auth
const isSecureContext =
  typeof window !== 'undefined' &&
  (window.location.protocol === 'https:' || window.location.hostname === 'localhost');

const msalProviders = isSecureContext ? (() => {
  const {
    MSAL_GUARD_CONFIG, MSAL_INSTANCE, MSAL_INTERCEPTOR_CONFIG,
    MsalBroadcastService, MsalGuard, MsalInterceptor, MsalService
  } = require('@azure/msal-angular');
  const { HTTP_INTERCEPTORS } = require('@angular/common/http');
  const { MSALInstanceFactory, MSALGuardConfigFactory, MSALInterceptorConfigFactory } = require('./auth/msal.config');
  return [
    { provide: HTTP_INTERCEPTORS, useClass: MsalInterceptor, multi: true },
    { provide: MSAL_INSTANCE, useFactory: MSALInstanceFactory },
    { provide: MSAL_GUARD_CONFIG, useFactory: MSALGuardConfigFactory },
    { provide: MSAL_INTERCEPTOR_CONFIG, useFactory: MSALInterceptorConfigFactory },
    MsalService, MsalGuard, MsalBroadcastService,
  ];
})() : [];

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(routes),
    provideAnimationsAsync(),
    provideHttpClient(withInterceptorsFromDi()),
    ...msalProviders,
  ]
};
