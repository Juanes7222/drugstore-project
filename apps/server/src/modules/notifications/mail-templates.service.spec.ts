import { describe, it, expect, beforeEach } from '@jest/globals';
import { ConfigService } from '@nestjs/config';
import { MailTemplatesService } from './mail-templates.service';
import type { EnvConfig } from '@/config/env.schema';
import type { EmailVerificationMailParams } from './mail.types';

const BASE_URL = 'https://app.example.test';
const TOKEN = 'token-with-slash/and+plus';
const IDEMPOTENCY_KEY = 'token-id-1';

function buildConfig(values: Record<string, unknown>): ConfigService<EnvConfig> {
  return { get: (key: string) => values[key] } as unknown as
    ConfigService<EnvConfig>;
}

function buildParams(
  overrides: Partial<EmailVerificationMailParams> = {},
): EmailVerificationMailParams {
  return {
    to: 'user@example.com',
    recipientName: 'Ada Lovelace',
    token: TOKEN,
    idempotencyKey: IDEMPOTENCY_KEY,
    expiresAt: new Date('2026-05-01T12:00:00.000Z'),
    ...overrides,
  };
}

describe('MailTemplatesService', () => {
  let service: MailTemplatesService;

  beforeEach(() => {
    service = new MailTemplatesService(
      buildConfig({ WEB_APP_BASE_URL: BASE_URL }),
    );
  });

  describe('render (EMAIL_VERIFICATION)', () => {
    it('points the link at the SPA verify-email route, not an API GET route', () => {
      const mail = service.render(
        'EMAIL_VERIFICATION',
        buildParams() as never,
      );

      expect(mail.html).toContain(
        `${BASE_URL}/verify-email?token=${encodeURIComponent(TOKEN)}`,
      );
    });

    it('includes the same SPA link in the plain-text body', () => {
      const mail = service.render(
        'EMAIL_VERIFICATION',
        buildParams() as never,
      );

      expect(mail.text).toContain(
        `${BASE_URL}/verify-email?token=${encodeURIComponent(TOKEN)}`,
      );
    });

    it('carries the localized subject', () => {
      const mail = service.render(
        'EMAIL_VERIFICATION',
        buildParams() as never,
      );

      expect(mail.subject).toBe('Verifica tu correo electrónico');
    });

    it('addresses the recipient by display name', () => {
      const mail = service.render(
        'EMAIL_VERIFICATION',
        buildParams() as never,
      );

      expect(mail.text).toContain('Hola Ada Lovelace,');
    });

    it('omits the comma-only greeting when no display name is known', () => {
      const mail = service.render(
        'EMAIL_VERIFICATION',
        buildParams({ recipientName: null }) as never,
      );

      expect(mail.text).toContain('Hola,');
      expect(mail.text).not.toContain('Hola null');
    });

    it('propagates the idempotencyKey from params onto the rendered mail', () => {
      const mail = service.render(
        'EMAIL_VERIFICATION',
        buildParams({ idempotencyKey: 'propagated-key' }) as never,
      );

      expect(mail.idempotencyKey).toBe('propagated-key');
    });

    it('tags the message with its template name for delivery analytics', () => {
      const mail = service.render(
        'EMAIL_VERIFICATION',
        buildParams() as never,
      );

      expect(mail.tags).toEqual([
        { name: 'template', value: 'EMAIL_VERIFICATION' },
      ]);
    });

    it('addresses the rendered message to the supplied recipient', () => {
      const mail = service.render(
        'EMAIL_VERIFICATION',
        buildParams() as never,
      );

      expect(mail.to).toBe('user@example.com');
    });
  });

  describe('render (PASSWORD_RESET)', () => {
    it('points the link at the SPA reset-password route, not an API GET route', () => {
      const mail = service.render('PASSWORD_RESET', buildParams() as never);

      expect(mail.html).toContain(
        `${BASE_URL}/reset-password?token=${encodeURIComponent(TOKEN)}`,
      );
    });

    it('carries the localized subject', () => {
      const mail = service.render('PASSWORD_RESET', buildParams() as never);

      expect(mail.subject).toBe('Restablece tu contraseña de PharmacyPOS');
    });

    it('tags the message with its template name', () => {
      const mail = service.render('PASSWORD_RESET', buildParams() as never);

      expect(mail.tags).toEqual([
        { name: 'template', value: 'PASSWORD_RESET' },
      ]);
    });
  });

  describe('HTML injection guard', () => {
    it('escapes a script tag in the recipient display name', () => {
      const mail = service.render(
        'EMAIL_VERIFICATION',
        buildParams({
          recipientName: '<script>alert(1)</script>',
        }) as never,
      );

      expect(mail.html).not.toContain('<script>');
      expect(mail.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    });

    it('escapes angle brackets and quotes so the name cannot break out of an attribute', () => {
      const mail = service.render(
        'EMAIL_VERIFICATION',
        buildParams({
          recipientName: '" onload="alert(1)',
        }) as never,
      );

      expect(mail.html).not.toContain('onload="alert(1)"');
      expect(mail.html).toContain('&quot;');
    });

    it('escapes an ampersand so an entity in the name is not decoded', () => {
      const mail = service.render(
        'EMAIL_VERIFICATION',
        buildParams({ recipientName: 'A & B' }) as never,
      );

      expect(mail.html).toContain('A &amp; B');
    });

    it('escapes a single quote as well', () => {
      const mail = service.render(
        'EMAIL_VERIFICATION',
        buildParams({ recipientName: "O'Brien" }) as never,
      );

      expect(mail.html).toContain('&#39;');
    });

    it('url-encodes the token so it cannot break out of the href', () => {
      const mail = service.render(
        'EMAIL_VERIFICATION',
        buildParams({ token: 'a"><script>x</script>' }) as never,
      );

      expect(mail.html).not.toContain('"><script>');
      expect(mail.html).toContain(encodeURIComponent('a"><script>x</script>'));
    });
  });

  describe('webAppBaseUrl', () => {
    it('strips a trailing slash so the link has no double separator', () => {
      const trailingSlash = new MailTemplatesService(
        buildConfig({ WEB_APP_BASE_URL: 'https://app.example.test/' }),
      );

      const mail = trailingSlash.render(
        'EMAIL_VERIFICATION',
        buildParams() as never,
      );

      expect(mail.html).toContain(
        `${BASE_URL}/verify-email?token=`,
      );
      expect(mail.html).not.toContain('example.test//verify-email');
    });

    it('strips repeated trailing slashes', () => {
      const manySlashes = new MailTemplatesService(
        buildConfig({ WEB_APP_BASE_URL: 'https://app.example.test///' }),
      );

      const mail = manySlashes.render(
        'EMAIL_VERIFICATION',
        buildParams() as never,
      );

      expect(mail.html).not.toContain('example.test//verify-email');
    });

    it('falls back to the local dev origin when WEB_APP_BASE_URL is unset', () => {
      const unset = new MailTemplatesService(buildConfig({}));

      const mail = unset.render(
        'EMAIL_VERIFICATION',
        buildParams() as never,
      );

      expect(mail.html).toContain(
        `http://localhost:5173/verify-email?token=`,
      );
    });
  });

  describe('expiry', () => {
    it('states the expiry timestamp in the body so the user knows the deadline', () => {
      const mail = service.render(
        'EMAIL_VERIFICATION',
        buildParams() as never,
      );

      expect(mail.text).toContain('Este enlace vence el');
      expect(mail.html).toContain('Este enlace vence el');
    });
  });
});