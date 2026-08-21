import { Injectable } from '@nestjs/common';

/**
 * Resolves `env:NAME` secret references for the webhook signature secret
 * (TechProviderConfig.webhookSecretReference).
 *
 * In production the Infisical bootstrap already injects every secret into
 * process.env before NestJS starts, so a plain env lookup covers both
 * environments without a second network hop per webhook. Other reference
 * schemes (e.g. a direct Infisical path) can be added here when a secret
 * must not live in the environment at all.
 */
@Injectable()
export class EnvSecretResolver {
  resolve(reference: string): string {
    if (!reference.startsWith('env:')) {
      throw new Error(
        `EnvSecretResolver only supports "env:"-prefixed references, got "${reference}"`,
      );
    }
    const name = reference.slice('env:'.length);
    const value = process.env[name];
    if (!value) {
      throw new Error(`Secret environment variable ${name} is not set`);
    }
    return value;
  }
}
