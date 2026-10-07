import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvConfig } from '@/config/env.schema';
import type { MailTemplate, RenderedMail } from './mail.port';
import {
  EmailVerificationMailParams,
  PasswordResetMailParams,
} from './mail.types';

/**
 * Front-end routes the emailed links point at. Both open a page that only
 * consumes the token when the user explicitly confirms, never on page load:
 * mail clients and security scanners pre-fetch every link in a message, and an
 * endpoint that consumed the token on GET would invalidate it before the
 * recipient ever saw it.
 */
const VERIFICATION_PATH = '/verify-email';
const PASSWORD_RESET_PATH = '/reset-password';

const SUBJECTS: Record<MailTemplate, string> = {
  EMAIL_VERIFICATION: 'Verifica tu correo electrónico',
  PASSWORD_RESET: 'Restablece tu contraseña de PharmacyPOS',
};

type TemplateParams = EmailVerificationMailParams | PasswordResetMailParams;

const EMAIL_CSS =
  'font-family:Roboto,Helvetica,Arial,sans-serif;background:#f4f6f8;padding:24px;';
const CARD_CSS =
  'background:#ffffff;border-radius:8px;padding:32px;max-width:520px;margin:0 auto;';
const BUTTON_CSS =
  'display:inline-block;background:#0f766e;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:6px;font-weight:600;';
const MUTED_CSS = 'color:#64748b;font-size:13px;line-height:1.5;';

interface TemplateCopy {
  subject: string;
  heading: string;
  intro: string;
  actionLabel: string;
  path: string;
  closing: string;
}

/**
 * Escapes text interpolated into the HTML body. The recipient's display name
 * is attacker-controllable (it comes from a user-supplied create-user payload or
 * a Google profile), so unescaped interpolation would be HTML injection into
 * every outgoing message.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Renders the localized bodies for each transactional template.
 *
 * This is the one place server-side copy is written in the deployment language
 * rather than English. The rule against Spanish strings in apps/server covers
 * error codes, API responses and log lines — all of which stay English — and
 * exists so client-facing localization has a single source. An email body has
 * no client runtime to pull a translation from, so it is composed here and
 * isolated in this file: adding a locale means adding a copyFor branch, not
 * touching any service.
 */
@Injectable()
export class MailTemplatesService {
  constructor(private readonly configService: ConfigService<EnvConfig>) {}

  /** Builds the provider-ready message for a template. */
  render(template: MailTemplate, params: TemplateParams): RenderedMail {
    const copy = this.copyFor(template);
    const link = `${this.webAppBaseUrl()}${copy.path}?token=${encodeURIComponent(params.token)}`;
    const greeting = params.recipientName
      ? `Hola ${params.recipientName},`
      : 'Hola,';
    const expiry = new Date(params.expiresAt).toLocaleString('es-CO', {
      dateStyle: 'long',
      timeStyle: 'short',
      timeZone: 'America/Bogota',
    });

    const html = `<!doctype html>
<html lang="es"><body style="${EMAIL_CSS}">
  <div style="${CARD_CSS}">
    <h1 style="font-size:20px;margin:0 0 16px;color:#0f172a;">${escapeHtml(copy.heading)}</h1>
    <p style="${MUTED_CSS}">${escapeHtml(greeting)}</p>
    <p style="${MUTED_CSS}">${escapeHtml(copy.intro)}</p>
    <p style="margin:24px 0;">
      <a href="${escapeHtml(link)}" style="${BUTTON_CSS}">${escapeHtml(copy.actionLabel)}</a>
    </p>
    <p style="${MUTED_CSS}">Este enlace vence el ${escapeHtml(expiry)}.</p>
    <p style="${MUTED_CSS}">${escapeHtml(copy.closing)}</p>
    <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;" />
    <p style="${MUTED_CSS}">
      Si el botón no funciona, copia esta direcci&oacute;n en tu navegador:<br />
      <span style="word-break:break-all;">${escapeHtml(link)}</span>
    </p>
    <p style="${MUTED_CSS}">
      PharmacyPOS &middot; Este es un mensaje autom&aacute;tico, por favor no lo respondas.
    </p>
  </div>
</body></html>`;

    const text = [
      greeting,
      '',
      copy.intro,
      '',
      `${copy.actionLabel}: ${link}`,
      '',
      `Este enlace vence el ${expiry}.`,
      copy.closing,
      '',
      'PharmacyPOS · Este es un mensaje automático, por favor no lo respondas.',
    ].join('\n');

    return {
      to: params.to,
      subject: copy.subject,
      html,
      text,
      idempotencyKey: params.idempotencyKey,
      tags: [{ name: 'template', value: template }],
    };
  }

  /** Per-template copy and destination route. */
  private copyFor(template: MailTemplate): TemplateCopy {
    if (template === 'EMAIL_VERIFICATION') {
      return {
        subject: SUBJECTS.EMAIL_VERIFICATION,
        heading: 'Verifica tu correo electrónico',
        intro:
          'Confirma esta dirección para activar tu acceso a PharmacyPOS. ' +
          'Necesitamos verificar el correo para poder enviarte avisos de seguridad ' +
          'y permitir que recuperes tu contraseña.',
        actionLabel: 'Verificar mi correo',
        path: VERIFICATION_PATH,
        closing:
          'Si no creaste esta cuenta o no solicitaste esta verificación, ' +
          'puedes ignorar este mensaje.',
      };
    }

    return {
      subject: SUBJECTS.PASSWORD_RESET,
      heading: 'Restablece tu contraseña',
      intro:
        'Recibimos una solicitud para restablecer la contraseña de tu cuenta. ' +
        'Elige una contraseña nueva antes de que el enlace venza.',
      actionLabel: 'Restablecer mi contraseña',
      path: PASSWORD_RESET_PATH,
      closing:
        'Si no solicitaste restablecer tu contraseña, ignora este mensaje: ' +
        'tu contraseña actual seguirá siendo válida.',
    };
  }

  /** Public origin of the web backoffice, without a trailing slash. */
  private webAppBaseUrl(): string {
    return (
      this.configService.get('WEB_APP_BASE_URL') ?? 'http://localhost:5173'
    ).replace(/\/+$/, '');
  }
}
