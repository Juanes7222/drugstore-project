import { Injectable, Logger } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';

interface TokenPayload {
  subscriptionId: string;
  subscriptionStatus: string;
  planId: string;
  planFeatures: string[];
  locationId: string;
  locationName: string;
  workstationId: string;
  hardwareFingerprint: string;
  issuedAt?: number;
  expiresAt?: number;
}

interface TokenResult {
  token: string;
  expiresAt: string;
}

@Injectable()
export class LicenseTokenService {
  private readonly logger = new Logger(LicenseTokenService.name);
  private readonly secret: string;
  private readonly defaultTtlSeconds: number;

  constructor() {
    this.secret = process.env.LICENSE_TOKEN_SECRET ?? 'dev-license-secret-change-in-prod-min-32-chars!!';
    this.defaultTtlSeconds = parseInt(process.env.LICENSE_TOKEN_TTL_SECONDS ?? '604800', 10); // Default 7 days

    if (!process.env.LICENSE_TOKEN_SECRET) {
      this.logger.warn(
        'LICENSE_TOKEN_SECRET not set. Using development secret. ' +
        'Set this environment variable to a secure random string (min 32 characters) in production.',
      );
    }
  }

  /**
   * Generate a signed JWT license token for a workstation.
   */
  generateToken(payload: {
    subscriptionId: string;
    subscriptionStatus: string;
    planId: string;
    planFeatures: string[];
    locationId: string;
    locationName: string;
    workstationId: string;
    hardwareFingerprint: string;
    expiresAt?: Date;
  }): TokenResult {
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = payload.expiresAt
      ? Math.floor(payload.expiresAt.getTime() / 1000)
      : now + this.defaultTtlSeconds;

    const tokenPayload: Record<string, unknown> = {
      sub: payload.workstationId,
      subscriptionId: payload.subscriptionId,
      subscriptionStatus: payload.subscriptionStatus,
      planId: payload.planId,
      planFeatures: payload.planFeatures,
      locationId: payload.locationId,
      locationName: payload.locationName,
      workstationId: payload.workstationId,
      hardwareFingerprint: payload.hardwareFingerprint,
      iat: now,
      exp: expiresAt,
      iss: 'pharmacy-licensing',
    };

    const token = jwt.sign(tokenPayload, this.secret, { algorithm: 'HS256' });

    return {
      token,
      expiresAt: new Date(expiresAt * 1000).toISOString(),
    };
  }

  /**
   * Verify a license token and return the decoded claims.
   * Throws if the token is invalid or expired.
   */
  verifyToken(token: string): Record<string, unknown> {
    try {
      const decoded = jwt.verify(token, this.secret, {
        algorithms: ['HS256'],
        issuer: 'pharmacy-licensing',
      });
      return decoded as Record<string, unknown>;
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        throw new Error('License token expired');
      }
      if (error instanceof jwt.JsonWebTokenError) {
        throw new Error('Invalid license token');
      }
      throw error;
    }
  }

  /**
   * Decode a token without verification (for debugging only).
   */
  decodeToken(token: string): Record<string, unknown> | null {
    const decoded = jwt.decode(token);
    return decoded as Record<string, unknown> | null;
  }

  /**
   * Get the remaining validity of a token in seconds.
   * Returns 0 if the token is expired or invalid.
   */
  getTokenRemainingSeconds(token: string): number {
    try {
      const decoded = this.verifyToken(token);
      const exp = decoded.exp as number;
      const now = Math.floor(Date.now() / 1000);
      return Math.max(0, exp - now);
    } catch {
      return 0;
    }
  }
}
