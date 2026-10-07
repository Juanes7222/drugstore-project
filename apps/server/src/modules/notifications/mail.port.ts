// Outbound transactional email: account verification and password reset.

/**
 * Templates the system can send. Adding one requires a matching entry in
 * MailTemplatesService and a typed params interface in mail.types.ts — the
 * renderer is the single place that turns a template name into a subject and a
 * body, so no caller ever assembles markup.
 */
export const MAIL_TEMPLATES = ['EMAIL_VERIFICATION', 'PASSWORD_RESET'] as const;

export type MailTemplate = (typeof MAIL_TEMPLATES)[number];

/** BullMQ queue name; registered in the root BullMqModule. */
export const EMAILS_QUEUE = 'emails';

/** Default attempts and backoff for a delivery job. */
export const MAIL_DELIVERY_ATTEMPTS = 3;
export const MAIL_DELIVERY_BACKOFF_MS = 5_000;

/**
 * A fully rendered message handed to the provider. Subject and bodies are
 * already localized; providers deal only with delivery.
 */
export interface RenderedMail {
  to: string;
  subject: string;
  html: string;
  text: string;
  /**
   * Provider-level idempotency key. Resend de-duplicates on it for 24 hours,
   * so a BullMQ retry of the same job cannot deliver the message twice.
   */
  idempotencyKey: string;
  /** Provider tag names, used for per-purpose delivery analytics. */
  tags: { name: string; value: string }[];
}

/**
 * Delivery-channel abstraction. Implementations translate a RenderedMail into a
 * provider API call; nothing above this interface knows which driver is active.
 */
export interface MailProvider {
  readonly driver: string;
  send(mail: RenderedMail): Promise<void>;
}

/** Injection token for the driver selected by EMAIL_DRIVER. */
export const MAIL_PROVIDER = Symbol('MAIL_PROVIDER');
