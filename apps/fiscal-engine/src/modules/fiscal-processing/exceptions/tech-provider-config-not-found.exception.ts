import { HttpStatus } from '@nestjs/common';
import { DomainException } from '../../../common/exceptions/domain.exception';

/**
 * Thrown when a subscription has no TechProviderConfig row at all — the
 * PROVIDER transmission path cannot authenticate with DIAN without the
 * server-side provider credentials. Mirrors the server's
 * TechProviderConfigNotSetException naming.
 */
export class TechProviderConfigNotFoundException extends DomainException {
  constructor(subscriptionId: string) {
    super(
      'TECH_PROVIDER_CONFIG_NOT_FOUND',
      `No TechProviderConfig found for subscription ${subscriptionId} — ` +
        'configure the provider credentials server-side before ' +
        'transmission can resume.',
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}