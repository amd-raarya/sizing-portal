import { MsalGuardConfiguration, MsalInterceptorConfiguration } from '@azure/msal-angular';
import { BrowserCacheLocation, InteractionType, IPublicClientApplication, LogLevel, PublicClientApplication } from '@azure/msal-browser';

export const msalConfig = {
  clientId: '99987163-482b-4533-b8fa-bb5dbf7c0e63',
  tenantId: '3dd8961f-e488-4e60-8e11-a82d994e183d',
};

export function MSALInstanceFactory(): IPublicClientApplication {
  try {
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
  } catch (e) {
    // On HTTP (no window.crypto), MSAL cannot initialize — return a no-op stub
    // Mock login will handle authentication instead
    return {
      initialize: () => Promise.resolve(),
      handleRedirectPromise: () => Promise.resolve(null),
      getAllAccounts: () => [],
      loginRedirect: () => Promise.resolve(),
      logoutRedirect: () => Promise.resolve(),
      acquireTokenSilent: () => Promise.reject('unavailable'),
      setActiveAccount: () => {},
      getActiveAccount: () => null,
    } as unknown as IPublicClientApplication;
  }
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
