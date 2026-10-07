import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvConfig } from '@/config/env.schema';
import type { MailProvider } from './mail.port';
import { ConsoleMailProvider } from './providers/console-mail.provider';
import { ResendMailProvider } from './providers/resend-mail.provider';

const logger = new Logger('MailFactory');

/**
 * Resolves the delivery channel named by EMAIL_DRIVER. Mirrors
 * createObjectStorageForScope so the driver-selection convention is identical
 * across storage and mail.
 *
 * The env schema already refuses to boot when EMAIL_DRIVER=resend is missing
 * RESEND_API_KEY or EMAIL_FROM, so an incomplete credential set surfaces at
 * startup rather than at the first verification email.
 */
export function createMailProvider(
  configService: ConfigService<EnvConfig>,
): MailProvider {
  const driver = configService.get('EMAIL_DRIVER') ?? 'console';

  if (driver === 'resend') {
    logger.log('Transactional email driver: resend');
    return new ResendMailProvider(configService);
  }

  logger.log('Transactional email driver: console (links written to log)');
  return new ConsoleMailProvider();
}
