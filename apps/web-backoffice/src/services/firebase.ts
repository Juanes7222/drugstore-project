import {
  initializeApp,
  getApps,
  getApp,
  type FirebaseApp,
  type FirebaseOptions,
} from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";

/**
 * Public Firebase web config served by GET /auth/firebase/config.
 * Contains no secret material — only the client-side SDK identifiers.
 */
export interface FirebaseWebConfig {
  apiKey: string | null;
  authDomain: string | null;
  projectId: string | null;
  storageBucket: string | null;
  messagingSenderId: string | null;
  appId: string | null;
  measurementId: string | null;
}

export function isFirebaseConfigured(config: FirebaseWebConfig): boolean {
  return Boolean(config.apiKey && config.authDomain && config.projectId);
}

let authInstance: Auth | null = null;

/**
 * Lazy singleton so the Firebase SDK is only initialized when the user
 * actually triggers Google sign-in (keeps the login bundle path light).
 */
export function getFirebaseAuth(config: FirebaseWebConfig): Auth {
  if (!authInstance) {
    // The server guarantees all fields are present when configured; the
    // null→undefined mapping satisfies FirebaseOptions' stricter typing.
    const options: FirebaseOptions = {
      apiKey: config.apiKey ?? undefined,
      authDomain: config.authDomain ?? undefined,
      projectId: config.projectId ?? undefined,
      storageBucket: config.storageBucket ?? undefined,
      messagingSenderId: config.messagingSenderId ?? undefined,
      appId: config.appId ?? undefined,
      measurementId: config.measurementId ?? undefined,
    };
    const app: FirebaseApp =
      getApps().length > 0 ? getApp() : initializeApp(options);
    authInstance = getAuth(app);
  }
  return authInstance;
}
