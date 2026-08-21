import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EnvConfig } from '@/config/env.schema';
import {
  initializeApp,
  cert,
  type ServiceAccount,
  type App,
} from 'firebase-admin/app';
import { getAuth, type Auth, type UserRecord } from 'firebase-admin/auth';

/**
 * Thin wrapper around the Firebase Admin SDK used to verify Google-issued ID
 * tokens and to resolve Firebase user records. The server never trusts a token
 * that was not cryptographically verified here; the public web config required
 * to initialize the client SDK is served separately through
 * GET /auth/firebase/config and contains no secret material.
 */
@Injectable()
export class FirebaseAuthService implements OnModuleInit {
  private readonly logger = new Logger(FirebaseAuthService.name);
  private app: App | null = null;
  private auth: Auth | null = null;

  constructor(private readonly configService: ConfigService<EnvConfig>) {}

  onModuleInit(): void {
    const raw = this.configService.get('FIREBASE_SERVICE_ACCOUNT');
    if (!raw) {
      this.logger.warn(
        'FIREBASE_SERVICE_ACCOUNT is not set; Google sign-in is disabled.',
      );
      return;
    }

    try {
      const serviceAccount = JSON.parse(raw) as ServiceAccount;
      this.app = initializeApp({ credential: cert(serviceAccount) });
      this.auth = getAuth(this.app);
    } catch (error) {
      this.logger.error('Failed to initialize Firebase Admin', error);
      throw error;
    }
  }

  get isConfigured(): boolean {
    return this.auth !== null;
  }

  /**
   * Verify a Google-issued Firebase ID token and return the claims the system
   * relies on. Throws if the token is missing, malformed, or the SDK is not
   * configured.
   */
  async verifyIdToken(idToken: string): Promise<{
    uid: string;
    email: string | null;
    displayName: string | null;
    photoURL: string | null;
    emailVerified: boolean;
  }> {
    if (!this.auth) {
      throw new Error('Firebase is not configured on the server');
    }

    const decoded = await this.auth.verifyIdToken(idToken);
    return {
      uid: decoded.uid,
      email: decoded.email ?? null,
      displayName: decoded.name ?? null,
      photoURL: decoded.picture ?? null,
      emailVerified: Boolean(decoded.email_verified),
    };
  }

  /**
   * Fetch a Firebase user record by uid, creating it when it does not yet
   * exist. Creation only populates the uid/email so the system record remains
   * the source of truth for profile and role data.
   */
  async getOrCreateUserRecord(
    uid: string,
    email?: string,
  ): Promise<UserRecord> {
    if (!this.auth) {
      throw new Error('Firebase is not configured on the server');
    }

    try {
      return await this.auth.getUser(uid);
    } catch {
      return this.auth.createUser({ uid, email });
    }
  }
}
