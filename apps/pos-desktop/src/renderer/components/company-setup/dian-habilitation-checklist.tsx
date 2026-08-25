/**
 * DianHabilitationChecklist — the administrative file (expediente) of the
 * six mandatory, sequential DIAN electronic-invoicing habilitation steps.
 *
 * Visual grammar: the RUT checkbox form this product parses. Numbering
 * encodes legal order; the rotated seal in the header derives OPERANDO /
 * EN TRÁMITE from the saved resolution. Every step state is DERIVED, never
 * hand-checked: the certificate step reads the active-certificate signal,
 * steps 2–5 are proven en bloc by the existence of the numbering
 * resolution, and the numbering-range step is derived like today.
 * Reads useCompanySetup() itself — no props.
 *
 * @category Component
 */
import { type FC, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckIcon, MailIcon } from '@/components/ui/icons';
import { useCompanySetup } from '@/hooks/use-company-setup';

/** Official DIAN registration & habilitación instructive (footer link). */
const OFFICIAL_GUIDE_URL =
  'https://micrositios.dian.gov.co/sistema-de-facturacion-electronica/instructivo-de-registro-y-habilitacion-en-factura-electronica-dian/';

/** Step keys mapping to i18n copy — order is the DIAN legal order. */
type StepKey = 'certificado' | 'registro' | 'modo' | 'pruebas' | 'fecha';

type Responsibility = 'you' | 'assisted' | 'software';

interface StepLink {
  href: string;
}

interface StepDefinition {
  key: StepKey;
  responsibility: Responsibility;
  link?: StepLink;
}

const HABILITATION_STEPS: readonly StepDefinition[] = [
  {
    key: 'certificado',
    responsibility: 'you',
    link: {
      href: 'https://micrositios.dian.gov.co/sistema-de-facturacion-electronica/',
    },
  },
  {
    key: 'registro',
    responsibility: 'you',
    link: { href: 'https://catalogo-vpfe.dian.gov.co/' },
  },
  { key: 'modo', responsibility: 'you' },
  { key: 'pruebas', responsibility: 'assisted' },
  {
    key: 'fecha',
    responsibility: 'you',
    link: { href: 'https://muisca.dian.gov.co/' },
  },
];

/** Responsibility chip palette — outline chips, no fills. */
const RESPONSIBILITY_CHIP_CLASS: Record<Responsibility, string> = {
  you: 'border-ink/35 text-ink',
  assisted: 'border-pharma/40 text-pharma',
  software: 'border-sync/40 text-sync',
};

export const DianHabilitationChecklist: FC = () => {
  const { t } = useTranslation();
  const { draft, certificateActive } = useCompanySetup();

  // The saved numbering resolution proves every pre-range process step
  // (registration, mode, test set, start date) happened.
  const hasResolution = Boolean(draft?.resolutionNumber);

  // Certificate step is its own signal: an active signing certificate on
  // the server. Null (unknown) counts as pending — never as done.
  const certificateDone = certificateActive === true;

  const isOperating = hasResolution;
  const headingId = 'dian-habilitation-heading';

  // One-shot stamp animation: only on the transition into OPERANDO, never
  // on mount when already operating, never on hover/scroll. The keyed span
  // remounts to replay it; reduced-motion collapses it globally.
  const [stampNonce, setStampNonce] = useState(0);
  const wasOperatingRef = useRef(isOperating);
  useEffect(() => {
    if (!wasOperatingRef.current && isOperating) {
      setStampNonce((nonce) => nonce + 1);
    }
    wasOperatingRef.current = isOperating;
  }, [isOperating]);

  return (
    <section
      aria-labelledby={headingId}
      className="rounded-sm border border-border bg-panel p-pos-xl"
    >
      <header className="flex flex-wrap items-start justify-between gap-pos-lg">
        <div className="min-w-0">
          <h3 id={headingId} className="text-heading font-semibold text-ink">
            {t('dian_habilitation.title')}
          </h3>
          <p className="mt-pos-xs font-data text-body-sm text-ink-muted">
            {draft?.nit
              ? t('dian_habilitation.subtitle_nit', { nit: draft.nit })
              : t('dian_habilitation.subtitle_no_nit')}
          </p>
        </div>

        {/* The seal — double frame (outline + inner ring), rotated like a
            stamped administrative document. */}
        <div
          role="status"
          aria-label={
            isOperating
              ? t('dian_habilitation.stamp_operating')
              : t('dian_habilitation.stamp_in_progress')
          }
          className="-rotate-4 shrink-0 rounded-sm border p-[3px]"
          style={{
            borderColor: isOperating
              ? 'var(--color-pharma)'
              : 'color-mix(in srgb, var(--color-urgency) 70%, var(--color-ink))',
            backgroundColor: isOperating
              ? 'var(--color-success-container)'
              : 'var(--color-urgency-surface)',
          }}
        >
          <span
            key={stampNonce}
            className={`block whitespace-nowrap rounded-sm border px-pos-lg py-pos-sm text-caption font-semibold uppercase tracking-widest ${
              stampNonce > 0 ? 'animate-dian-stamp' : ''
            }`}
            style={{
              borderColor: isOperating
                ? 'var(--color-pharma)'
                : 'color-mix(in srgb, var(--color-urgency) 70%, var(--color-ink))',
              color: isOperating
                ? 'var(--color-pharma)'
                : 'color-mix(in srgb, var(--color-urgency) 70%, var(--color-ink))',
            }}
          >
            {isOperating
              ? t('dian_habilitation.stamp_operating')
              : t('dian_habilitation.stamp_in_progress')}
          </span>
        </div>
      </header>

      {/* Expediente — continuous left line connecting square casillas. */}
      <ol
        aria-label={t('dian_habilitation.steps_aria')}
        className="relative mt-pos-xl"
      >
        <span
          aria-hidden="true"
          className="absolute bottom-[26px] left-[13px] top-[26px] w-[2px]"
          style={{
            backgroundColor:
              'color-mix(in srgb, var(--color-ink) 15%, transparent)',
          }}
        />

        {HABILITATION_STEPS.map((step, index) => {
          const done =
            step.key === 'certificado'
              ? certificateDone
              : hasResolution;
          const chipClass = RESPONSIBILITY_CHIP_CLASS[step.responsibility];
          const stepTitle = t(`dian_habilitation.steps.${step.key}.title`);

          return (
            <li
              key={step.key}
              className="relative flex gap-pos-lg py-pos-md pl-1"
            >
              {/* Square casilla node — opaque so the connector reads as
                  passing behind it. */}
              <div
                aria-hidden="true"
                className="relative z-10 mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center border-2"
                style={{
                  backgroundColor: done
                    ? 'var(--color-pharma)'
                    : 'var(--color-panel)',
                  borderColor: done
                    ? 'var(--color-pharma)'
                    : 'var(--color-ink)',
                }}
              >
                {done ? (
                  <CheckIcon size={14} strokeWidth={3} className="text-white" />
                ) : (
                  <span className="font-data text-body-sm font-bold leading-none text-ink">
                    {index + 1}
                  </span>
                )}
              </div>

              {/* Informative step content — status is text, not a control. */}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-pos-md gap-y-pos-xs">
                  <h4
                    className={`text-ui font-semibold uppercase tracking-wide ${
                      done ? 'text-pharma' : 'text-ink'
                    }`}
                  >
                    {index + 1}. {stepTitle}
                  </h4>
                  <span
                    className={`inline-flex shrink-0 items-center rounded-sm border px-pos-sm py-px text-caption font-semibold uppercase tracking-wider ${chipClass}`}
                  >
                    {t(
                      `dian_habilitation.responsibility.${step.responsibility}`,
                    )}
                  </span>
                </div>

                <p className="mt-pos-xs max-w-prose text-body-sm text-ink-muted">
                  {t(`dian_habilitation.steps.${step.key}.description`)}
                </p>

                {/* Screen-reader status — done/pending must not rely on
                    the casilla color alone. */}
                <span className="sr-only">
                  {done
                    ? t('dian_habilitation.status_done')
                    : t('dian_habilitation.status_pending')}
                </span>

                {!done && step.key === 'certificado' && (
                  <p className="mt-pos-sm flex max-w-prose items-start gap-pos-xs text-body-sm text-sync">
                    <span
                      aria-hidden="true"
                      className="mt-[7px] h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: 'var(--color-sync)' }}
                    />
                    {t('dian_habilitation.steps.certificado.pending_hint')}
                  </p>
                )}

                {step.link && (
                  <a
                    href={step.link.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-pos-sm inline-flex items-center gap-px text-body-sm font-medium underline decoration-border underline-offset-2 transition-colors hover:text-pharma focus-visible:text-pharma"
                  >
                    {t(`dian_habilitation.steps.${step.key}.link`)}
                    <span aria-hidden="true" className="ml-pos-xs">
                      ↗
                    </span>
                  </a>
                )}
              </div>
            </li>
          );
        })}

        {/* Step 6 — rango de numeración: derived state, like every step. */}
        <li className="relative flex gap-pos-lg py-pos-md pl-1">
          <div
            aria-hidden="true"
            className="relative z-10 mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center border-2 bg-panel"
            style={{
              borderColor: isOperating
                ? 'var(--color-pharma)'
                : 'var(--color-ink)',
            }}
          >
            <span
              className={`font-data text-body-sm font-bold leading-none ${
                isOperating ? 'text-pharma' : 'text-ink'
              }`}
            >
              6
            </span>
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-pos-md gap-y-pos-xs">
              <h4
                className={`text-ui font-semibold uppercase tracking-wide ${
                  isOperating ? 'text-pharma' : 'text-ink'
                }`}
              >
                {t('dian_habilitation.steps.rango.title')}
              </h4>
              <span
                className={`inline-flex shrink-0 items-center rounded-sm border px-pos-sm py-px text-caption font-semibold uppercase tracking-wider ${RESPONSIBILITY_CHIP_CLASS.software}`}
              >
                {t('dian_habilitation.responsibility.software')}
              </span>
            </div>

            {isOperating ? (
              <p
                className="mt-pos-sm inline-flex flex-wrap gap-x-pos-sm rounded-sm px-pos-md py-pos-sm font-data text-body-sm text-pharma"
                style={{ backgroundColor: 'var(--color-success-container)' }}
              >
                <span>{t('dian_habilitation.range_obtained')}</span>
                <span aria-hidden="true">·</span>
                <span>
                  {t('dian_habilitation.range_prefix', {
                    prefix: draft?.resolutionPrefix ?? '',
                  })}
                </span>
                {draft?.resolutionRangeStart && draft?.resolutionRangeEnd && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>
                      {t('dian_habilitation.range_range', {
                        start: draft.resolutionRangeStart,
                        end: draft.resolutionRangeEnd,
                      })}
                    </span>
                  </>
                )}
              </p>
            ) : (
              <p className="mt-pos-sm flex max-w-prose items-start gap-pos-xs text-body-sm text-sync">
                {/* Static dot — deliberate: no pulse on the trámite path. */}
                <span
                  aria-hidden="true"
                  className="mt-[7px] h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: 'var(--color-sync)' }}
                />
                {t('dian_habilitation.range_pending')}
              </p>
            )}
          </div>
        </li>
      </ol>

      <footer className="mt-pos-lg flex flex-col gap-pos-md border-t border-border pt-pos-lg sm:flex-row sm:items-center sm:justify-between">
        <a
          href={`mailto:${t('dian_habilitation.footer.support_email')}`}
          className="pos-button pos-button-secondary text-body-sm font-semibold"
        >
          <MailIcon size={14} strokeWidth={1.5} aria-hidden="true" />
          {t('dian_habilitation.footer.support_cta')}
        </a>
        <a
          href={OFFICIAL_GUIDE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center text-caption underline decoration-border underline-offset-2 transition-colors hover:text-pharma focus-visible:text-pharma"
        >
          {t('dian_habilitation.footer.official_guide')}
          <span aria-hidden="true" className="ml-pos-xs">
            ↗
          </span>
        </a>
      </footer>
    </section>
  );
};
