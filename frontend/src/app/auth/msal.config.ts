import { MsalGuardConfiguration, MsalInterceptorConfiguration } from '@azure/msal-angular';
import { BrowserCacheLocation, InteractionType, IPublicClientApplication, LogLevel, PublicClientApplication } from '@azure/msal-browser';

export const msalConfig = {
  clientId: '99987163-482b-4533-b8fa-bb5dbf7c0e63',
  tenantId: '3dd8961f-e488-4e60-8e11-a82d994e183d',
};

export function MSALInstanceFactory(): IPublicClientApplication {
  // MSAL requires HTTPS (secure context with window.crypto)
  // On HTTP (e.g. internal server), create a minimal no-op instance
  const isSecure = window.location.protocol === 'https:' || window.location.hostname === 'localhost';
  if (!isSecure) {
    // Return a stub — MSAL won't be used on HTTP, mock login handles auth
    return new PublicClientApplication({
      auth: {
        clientId: msalConfig.clientId,
        authority: `https://login.microsoftonline.com/${msalConfig.tenantId}`,
        redirectUri: window.location.origin,
      },
      system: {
        allowNativeBroker: false,
        loggerOptions: { logLevel: LogLevel.Error, piiLoggingEnabled: false }
      }
    });
  }
  return new PublicClientApplication({
    auth: {
      clientId: msalConfig.clientId,
      authority: `https://login.microsoftonline.com/${msalConfig.tenantId}`,
      redirectUri: window.location.origin,
      postLogoutRedirectUri: window.location.origin + '/login',
    },
    cache: {
      cacheLocation: BrowserCacheLocation.SessionStorage,
    },
    system: {
      loggerOptions: {
        logLevel: LogLevel.Warning,
        piiLoggingEnabled: false,
      }
    }
  });
}

export function MSALGuardConfigFactory(): MsalGuardConfiguration {
  return {
    interactionType: InteractionType.Redirect,
    authRequest: {
      scopes: ['User.Read'],
    },
  };
}

export function MSALInterceptorConfigFactory(): MsalInterceptorConfiguration {
  return {
    interactionType: InteractionType.Redirect,
    protectedResourceMap: new Map([
      ['https://graph.microsoft.com/v1.0/me', ['User.Read']],
    ]),
  };
}
