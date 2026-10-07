import { Injectable, Logger } from '@nestjs/common';
import type { MailProvider, RenderedMail } from '../mail.port';

/**
 * Development and CI delivery channel: writes the whole message to the log
 * instead of performing a network call. This is what lets an account-verification
 * or password-reset flow be exercised end to end without an email provider, and
 * it is the default in every environment via EMAIL_DRIVER.
 *
 * The body is logged at warn level so it survives default log levels, since the
 * verification link only exists in this message — but note the log is therefore
 * link-equivalent and must not be shipped to a shared aggregator in production.
 * EMAIL_DRIVER=resend is the production setting.
 */
@Injectable()
export class ConsoleMailProvider implements MailProvider {
  readonly driver = 'console';

  private readonly logger = new Logger(ConsoleMailProvider.name);

  async send(mail: RenderedMail): Promise<void> {
    this.logger.warn(
      `[console mail driver] to=${mail.to} subject=${mail.subject} link=${this.extractLink(mail.text)}`,
    );
  }

  /** Pulls the action URL out of the plain-text body for the log line. */
  private extractLink(text: string): string {
    return (
      text.split('\n').find((line) => line.includes('http')) ?? '(no link)'
    );
  }
}
