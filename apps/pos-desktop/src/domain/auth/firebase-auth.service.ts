/**
 * Firebase client for Google sign-in on the POS desktop terminal.
 *
 * The Firebase public config is NEVER hardcoded here. It is fetched at
 * runtime from the backend's GET /auth/firebase/config endpoint, which reads
 * the values from server environment variables. If the server returns null
 * fields, Google sign-in is treated as disabled and the config is absent.
 *
 * On success `signInWithGoogle` resolves with the Firebase ID token, which
 * the caller exchanges for a POS session via `AuthService.loginWithGoogle`.
 *
 * @module
 */
import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  type Auth,
} from 'firebase/auth';
import { createHttpClient, type HttpClient } from '../../infrastructure/http-client';
import {
  FirebaseNotConfiguredException,
  GooglePopupUnavailableException,
} from './exceptions';

/** Public Firebase web config returned by GET /auth/firebase/config. */
export interface FirebasePublicConfig {
  apiKey: string | null;
  authDomain: string | null;
  projectId: string | null;
  storageBucket: string | null;
  messagingSenderId: string | null;
  appId: string | null;
  measurementId: string | null;
}

/**
 * True when the config holds the minimum fields required to initialise the
 * Firebase Auth client. Google sign-in needs apiKey, authDomain, projectId
 * and appId; measurementId and storageBucket are optional.
 */
export function isFirebaseConfigured(config: FirebasePublicConfig | null): boolean {
  return (
    !!config &&
    !!config.apiKey &&
    !!config.authDomain &&
    !!config.projectId &&
    !!config.appId
  );
}

export interface FirebaseAuthServiceConfig {
  /** Server base URL, e.g. "http://localhost:3000". */
  baseUrl: string;
  /** Optional HTTP client override (testing). */
  httpClient?: HttpClient;
}

export interface FirebaseAuthService {
  /** Fetch the public config once; null when Google is disabled server-side. */
  fetchPublicConfig(): Promise<FirebasePublicConfig | null>;
  /** Whether a usable config has been fetched. */
  isAvailable(): boolean;
  /** Open the Google sign-in popup and resolve with the Firebase ID token. */
  signInWithGoogle(): Promise<string>;
  /** Close the native sign-in popup, if one is open. */
  closePopup(): Promise<void>;
}

/**
 * Firebase error codes that mean "the consent window never opened".
 *
 * `popup-blocked` is what `signInWithPopup` throws when `window.open`
 * returns null, which is exactly what a Tauri webview does unless the
 * native `on_new_window` handler is registered. The
 * `operation-not-supported-in-this-environment` code appears when the SDK
 * resolves a non-browser build.
 */
const POPUP_UNAVAILABLE_CODES = [
  'popup-blocked',
  'operation-not-supported-in-this-environment',
] as const;

/** Firebase error codes for a user-initiated cancellation, which is not an error. */
const POPUP_CANCELLED_CODES = [
  'popup-closed-by-user',
  'user-cancelled',
] as const;

/**
 * Read the `code` field the Firebase SDK attaches to its AuthError objects,
 * normalised to the bare code.
 *
 * The SDK namespaces every AuthError as `auth/<code>` (see the
 * `AuthErrorCode` map in @firebase/auth), so the comparison lists above are
 * stored unprefixed and matched against this normalised value.
 */
function readFirebaseErrorCode(error: unknown): string {
  if (typeof error !== 'object' || error === null) return '';
  const code = (error as { code?: unknown }).code;
  if (typeof code !== 'string') return '';
  return code.startsWith('auth/') ? code.slice('auth/'.length) : code;
}

/**
 * True when the error means the user dismissed the consent window.
 *
 * Callers use this to stay silent instead of showing an error for what was
 * a deliberate cancellation.
 */
export function isGoogleSignInCancelled(error: unknown): boolean {
  const code = readFirebaseErrorCode(error);
  return POPUP_CANCELLED_CODES.includes(code as (typeof POPUP_CANCELLED_CODES)[number]);
}

export function createFirebaseAuthService(
  config: FirebaseAuthServiceConfig,
): FirebaseAuthService {
  const http: HttpClient = config.httpClient ?? createHttpClient(config.baseUrl);

  let cachedConfig: FirebasePublicConfig | null = null;
  let app: FirebaseApp | null = null;

  const fetchPublicConfig = async (): Promise<FirebasePublicConfig | null> => {
    if (cachedConfig) return cachedConfig;
    try {
      const cfg = await http.get<FirebasePublicConfig>('/auth/firebase/config');
      cachedConfig = cfg ?? null;
    } catch {
      // Network/transport failure → Google sign-in unavailable.
      cachedConfig = null;
    }
    return cachedConfig;
  };

  const ensureApp = async (): Promise<FirebaseApp> => {
    if (app) return app;
    const cfg = cachedConfig ?? (await fetchPublicConfig());
    if (!isFirebaseConfigured(cfg)) {
      throw new FirebaseNotConfiguredException();
    }
    app = initializeApp({
      apiKey: cfg!.apiKey!,
      authDomain: cfg!.authDomain!,
      projectId: cfg!.projectId!,
      storageBucket: cfg!.storageBucket ?? undefined,
      messagingSenderId: cfg!.messagingSenderId ?? undefined,
      appId: cfg!.appId!,
      measurementId: cfg!.measurementId ?? undefined,
    });
    return app;
  };

  return {
    fetchPublicConfig,

    isAvailable: () => isFirebaseConfigured(cachedConfig),

    signInWithGoogle: async (): Promise<string> => {
      const firebaseApp = await ensureApp();
      const auth: Auth = getAuth(firebaseApp);
      const provider = new GoogleAuthProvider();
      let result;
      try {
        result = await signInWithPopup(auth, provider);
      } catch (error) {
        const code = readFirebaseErrorCode(error);
        if (POPUP_UNAVAILABLE_CODES.includes(code as (typeof POPUP_UNAVAILABLE_CODES)[number])) {
          throw new GooglePopupUnavailableException(code);
        }
        throw error;
      }
      // The ID token is a bearer credential: never log it, and let it
      // expire on its own rather than persisting it anywhere.
      return result.user.getIdToken();
    },

    closePopup: async (): Promise<void> => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('close_oauth_popup');
      } catch {
        // Not running under Tauri, or the command is unavailable — the
        // popup closes itself in that case, so this is a no-op.
      }
    },
  };
}
