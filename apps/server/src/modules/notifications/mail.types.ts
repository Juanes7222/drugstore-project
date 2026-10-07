import type { MailTemplate } from './mail.port';

/**
 * Job payload for the emails queue.
 *
 * `token` is a raw single-use capability that ends up inside the emailed link.
 * That makes Redis secret-bearing for the lifetime of the job: it must be
 * private, TLS-protected, and never logged. Nothing else in this payload is
 * sensitive — recipient address and display name are the only PII carried.
 */
export interface EmailJobData {
  template: MailTemplate;
  to: string;
  recipientName: string | null;
  token: string;
  /** VerificationToken row id; doubles as the provider idempotency key. */
  idempotencyKey: string;
  /** ISO timestamp, so the template can state when the link stops working. */
  expiresAt: string;
}

export interface EmailVerificationMailParams {
  to: string;
  recipientName: string | null;
  token: string;
  idempotencyKey: string;
  expiresAt: Date;
}

export interface PasswordResetMailParams {
  to: string;
  recipientName: string | null;
  token: string;
  idempotencyKey: string;
  expiresAt: Date;
}
