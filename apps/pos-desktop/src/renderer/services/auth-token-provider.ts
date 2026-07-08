/**
 * Auth token provider abstraction.
 *
 * The POS renderer does not yet have a login flow. This interface lets the
 * real HTTP client attach a bearer token whenever one is available, without
 * hardcoding where that token comes from.
 *
 * The default local-storage provider reads the access token written by a
 * future login/refresh flow. Until that flow exists, the provider returns
 * `null`, so requests fail cleanly with 401/403 instead of sending a fake
 * credential.
 */

export interface AuthTokenProvider {
  /** Returns the current access token, or `null` if the user is not authenticated. */
  getAccessToken(): Promise<string | null>;
}

const ACCESS_TOKEN_KEY = "pharmacy_pos_access_token";

export const createLocalStorageAuthTokenProvider = (): AuthTokenProvider => ({
  getAccessToken: async (): Promise<string | null> => {
    if (typeof window === "undefined" || !window.localStorage) {
      return null;
    }

    return window.localStorage.getItem(ACCESS_TOKEN_KEY);
  },
});
