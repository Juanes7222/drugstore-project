import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual, type Hmac } from 'node:crypto';
import type { Readable } from 'node:stream';

/**
 * Service for verifying HMAC signatures on client telemetry payloads.
 *
 * The server shares a per-license HMAC key with each activated workstation
 * during the license activation handshake.  Telemetry payloads include a
 * signature computed from that key so the server can reject spoofed events
 * before persisting them.
 *
 * It also signs the published update binaries with a server-only secret, so
 * the download route can prove that the bytes it is about to serve are the
 * ones that were published.
 */
@Injectable()
export class SignatureService {
  private readonly hmacSecret: string;
  private readonly binarySigningSecret: string;

  constructor(configService: ConfigService) {
    this.hmacSecret = configService.getOrThrow<string>('UPDATE_TELEMETRY_HMAC_SECRET');
    this.binarySigningSecret = configService.getOrThrow<string>(
      'UPDATE_BINARY_SIGNING_SECRET',
    );
  }

  /**
   * Compute an HMAC-SHA256 signature for a given payload.
   * The client calls the equivalent function with the per-license key.
   */
  computeSignature(payload: string, key?: string): string {
    const secret = key ?? this.hmacSecret;
    return createHmac('sha256', secret).update(payload, 'utf-8').digest('hex');
  }

  /**
   * Verify that the provided signature matches the expected signature.
   * Uses timing-safe comparison to prevent timing attacks.
   */
  verifySignature(
    payload: string,
    signature: string,
    key?: string,
  ): boolean {
    const expected = this.computeSignature(payload, key ?? this.hmacSecret);
    try {
      return timingSafeEqual(
        Buffer.from(expected, 'hex'),
        Buffer.from(signature, 'hex'),
      );
    } catch {
      return false;
    }
  }

  /**
   * Verify a telemetry payload from a specific workstation.
   * The HMAC key is derived from the license ID combined with the global
   * secret so each workstation has an effectively unique key.
   */
  verifyTelemetrySignature(
    payload: string,
    signature: string,
    licenseId: string,
  ): boolean {
    const workstationKey = this.deriveWorkstationKey(licenseId);
    return this.verifySignature(payload, signature, workstationKey);
  }

  /**
   * Derive a per-workstation HMAC key from the license ID.
   */
  deriveWorkstationKey(licenseId: string): string {
    return createHmac('sha256', this.hmacSecret)
      .update(licenseId, 'utf-8')
      .digest('hex');
  }

  // ---------------------------------------------------------------------------
  // Update binaries
  // ---------------------------------------------------------------------------

  /**
   * Sign a published update binary. The signature travels with the release
   * row and is recomputed over the stored bytes on every download, so a
   * binary replaced in storage is refused instead of served.
   */
  computeBinarySignature(content: Buffer): string {
    return this.createBinaryHasher().update(content).digest('hex');
  }

  /**
   * Same signature as {@link computeBinarySignature}, computed while the
   * binary is streamed: installers are far too large to buffer in memory.
   */
  async computeBinarySignatureFromStream(stream: Readable): Promise<string> {
    const hasher = this.createBinaryHasher();
    for await (const chunk of stream) {
      hasher.update(chunk as Buffer);
    }
    return hasher.digest('hex');
  }

  /**
   * Compare two hex signatures in constant time.
   */
  matchesBinarySignature(actual: string, expected: string): boolean {
    try {
      return timingSafeEqual(
        Buffer.from(actual, 'hex'),
        Buffer.from(expected, 'hex'),
      );
    } catch {
      return false;
    }
  }

  private createBinaryHasher(): Hmac {
    return createHmac('sha256', this.binarySigningSecret);
  }
}
