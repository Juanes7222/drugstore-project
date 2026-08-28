/**
 * DianHabilitationChecklist — expediente DIAN rediseñado.
 *
 * 2026-08-27 redesign: de lista cuadrada genérica a pipeline de trámite
 * con progreso visible, iconografía por paso y tarjetas densas. Mantiene
 * la gramática legal (6 pasos en orden, expediente con línea vertical),
 * pero con pulido Emil: stagger sutil, seal con motion y progreso animado.
 *
 * Todo estado sigue siendo DERIVADO — ningún checkbox manual.
 * Lee useCompanySetup() directo, sin props.
 *
 * @category Component
 */
import { type FC, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { motion } from "motion/react";
import {
  CheckIcon,
  MailIcon,
  KeyRoundIcon,
  ClipboardListIcon,
  Settings2Icon,
  FileTextIcon,
  CalendarDaysIcon,
  ReceiptIcon,
} from "@/components/ui/icons";
import type { IconComponent } from "@/components/ui/icons";
import { useCompanySetup } from "@/hooks/use-company-setup";

/** Official DIAN instructive. */
const OFFICIAL_GUIDE_URL =
  "https://micrositios.dian.gov.co/sistema-de-facturacion-electronica/instructivo-de-registro-y-habilitacion-en-factura-electronica-dian/";

type StepKey = "certificado" | "registro" | "modo" | "pruebas" | "fecha";
type Responsibility = "you" | "assisted" | "software";

interface StepDefinition {
  key: StepKey;
  responsibility: Responsibility;
  Icon: IconComponent;
  href?: string;
}

const HABILITATION_STEPS: readonly StepDefinition[] = [
  {
    key: "certificado",
    responsibility: "you",
    Icon: KeyRoundIcon,
    href: "https://micrositios.dian.gov.co/sistema-de-facturacion-electronica/",
  },
  {
    key: "registro",
    responsibility: "you",
    Icon: ClipboardListIcon,
    href: "https://catalogo-vpfe.dian.gov.co/",
  },
  { key: "modo", responsibility: "you", Icon: Settings2Icon },
  { key: "pruebas", responsibility: "assisted", Icon: FileTextIcon },
  {
    key: "fecha",
    responsibility: "you",
    Icon: CalendarDaysIcon,
    href: "https://muisca.dian.gov.co/",
  },
];

const RESPONSIBILITY_META: Record<
  Responsibility,
  { labelKey: string; className: string }
> = {
  you: {
    labelKey: "dian_habilitation.responsibility.you",
    className:
      "border-ink/15 bg-ink/[0.06] text-ink",
  },
  assisted: {
    labelKey: "dian_habilitation.responsibility.assisted",
    className:
      "border-pharma/20 bg-pharma/[0.08] text-pharma",
  },
  software: {
    labelKey: "dian_habilitation.responsibility.software",
    className:
      "border-sync/20 bg-sync/[0.08] text-sync",
  },
};

// Motion — Emil: corta, invisible
const containerVariants = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.06, delayChildren: 0.08 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 6 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.26, ease: [0.16, 1, 0.3, 1] as const },
  },
};

export const DianHabilitationChecklist: FC = () => {
  const { t } = useTranslation();
  const { draft, certificateActive } = useCompanySetup();

  const hasResolution = Boolean(draft?.resolutionNumber);
  const certificateDone = certificateActive === true;
  const isOperating = hasResolution;

  // progreso derivado — certificado + 4 pasos en bloque + rango
  const stepsDoneCount =
    (certificateDone ? 1 : 0) + (hasResolution ? 5 : 0);
  const totalSteps = 6;
  const progress = (stepsDoneCount / totalSteps) * 100;

  const headingId = "dian-habilitation-heading";

  const [stampNonce, setStampNonce] = useState(0);
  const wasOperatingRef = useRef(isOperating);
  useEffect(() => {
    if (!wasOperatingRef.current && isOperating) {
      setStampNonce((n) => n + 1);
    }
    wasOperatingRef.current = isOperating;
  }, [isOperating]);

  return (
    <motion.section
      aria-labelledby={headingId}
      initial="hidden"
      animate="show"
      variants={containerVariants}
      className="overflow-hidden rounded-md border border-border bg-panel"
      style={{ boxShadow: "var(--shadow-pos-panel)" }}
    >
      {/* hairline top — mismo lenguaje que expediente empresa */}
      <div className="h-[2px] w-full bg-ink/10" aria-hidden="true">
        <motion.div
          className="h-full bg-pharma"
          initial={{ width: 0 }}
          animate={{ width: `${progress}%` }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        />
      </div>

      {/* header — compacto */}
      <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-4 sm:px-5">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-ink-muted">
            Expediente DIAN · {stepsDoneCount}/{totalSteps} ·{" "}
            {isOperating
              ? t("dian_habilitation.stamp_operating")
              : t("dian_habilitation.stamp_in_progress")}
          </p>
          <h3
            id={headingId}
            className="mt-1 text-[14px] font-bold tracking-tight text-ink"
          >
            {t("dian_habilitation.title")}
          </h3>
          <p className="mt-1 flex flex-wrap items-center gap-2 font-data text-[11px] tabular-nums text-ink-muted">
            <span>
              {draft?.nit
                ? t("dian_habilitation.subtitle_nit", { nit: draft.nit })
                : t("dian_habilitation.subtitle_no_nit")}
            </span>
            <span
              aria-hidden="true"
              className="hidden h-3 w-px bg-border sm:block"
            />
            <span className="inline-flex items-center gap-1 rounded-full bg-surface-variant px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-ink-muted">
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{
                  backgroundColor: isOperating
                    ? "var(--color-pharma)"
                    : "var(--color-sync)",
                }}
                aria-hidden="true"
              />
              {stepsDoneCount === totalSteps
                ? "Listo para facturar"
                : `${totalSteps - stepsDoneCount} pendientes`}
            </span>
          </p>
        </div>

        {/* seal — rotado, doble marco, como expediente */}
        <motion.div
          role="status"
          aria-label={
            isOperating
              ? t("dian_habilitation.stamp_operating")
              : t("dian_habilitation.stamp_in_progress")
          }
          className="-rotate-[3deg] shrink-0 rounded-sm border p-[3px]"
          style={{
            borderColor: isOperating
              ? "var(--color-pharma)"
              : "color-mix(in srgb, var(--color-urgency) 68%, var(--color-ink))",
            backgroundColor: isOperating
              ? "var(--color-success-container)"
              : "var(--color-urgency-surface)",
          }}
          initial={{ scale: 0.98, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
        >
          <span
            key={stampNonce}
            className={`block whitespace-nowrap rounded-sm border px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-[0.14em] ${
              stampNonce > 0 ? "animate-dian-stamp" : ""
            }`}
            style={{
              borderColor: isOperating
                ? "var(--color-pharma)"
                : "color-mix(in srgb, var(--color-urgency) 68%, var(--color-ink))",
              color: isOperating
                ? "var(--color-pharma)"
                : "color-mix(in srgb, var(--color-urgency) 68%, var(--color-ink))",
            }}
          >
            {isOperating
              ? t("dian_habilitation.stamp_operating")
              : t("dian_habilitation.stamp_in_progress")}
          </span>
        </motion.div>
      </div>

      {/* steps — pipeline */}
      <ol
        aria-label={t("dian_habilitation.steps_aria")}
        className="relative mx-4 border-t border-border sm:mx-5"
      >
        {/* línea vertical — fondo + fill animado */}
        <span
          aria-hidden="true"
          className="absolute bottom-6 left-[15px] top-3 w-px bg-border"
        />
        <motion.span
          aria-hidden="true"
          className="absolute left-[15px] top-3 w-px bg-pharma"
          initial={{ height: 0 }}
          animate={{
            height: `${(stepsDoneCount / totalSteps) * 100}%`,
          }}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
          style={{ maxHeight: "calc(100% - 24px)" }}
        />

        {HABILITATION_STEPS.map((step, index) => {
          const done =
            step.key === "certificado" ? certificateDone : hasResolution;
          const StepIcon = step.Icon;
          const resp = RESPONSIBILITY_META[step.responsibility];
          const title = t(`dian_habilitation.steps.${step.key}.title`);
          const desc = t(`dian_habilitation.steps.${step.key}.description`);

          return (
            <motion.li
              key={step.key}
              variants={itemVariants}
              className="relative flex gap-3 py-3.5"
            >
              {/* nodo — circular, no cuadrado */}
              <div
                aria-hidden="true"
                className="relative z-10 mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 bg-panel shadow-[0_1px_2px_rgba(0,0,0,0.06)]"
                style={{
                  borderColor: done
                    ? "var(--color-pharma)"
                    : "color-mix(in srgb, var(--color-ink) 18%, transparent)",
                  backgroundColor: done
                    ? "var(--color-pharma)"
                    : "var(--color-panel)",
                  color: done ? "white" : "var(--color-ink)",
                }}
              >
                {done ? (
                  <CheckIcon size={14} strokeWidth={2.7} />
                ) : (
                  <span className="font-data text-[11px] font-bold leading-none tabular-nums">
                    {index + 1}
                  </span>
                )}
              </div>

              {/* card */}
              <div
                className={`min-w-0 flex-1 rounded-md border px-3 py-2.5 transition-colors ${
                  done
                    ? "border-pharma/15 bg-success-container/35"
                    : "border-border bg-surface-variant/30 hover:border-border hover:bg-surface-variant/60"
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex min-w-0 items-start gap-2">
                    <span
                      className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-sm border ${
                        done
                          ? "border-pharma/20 bg-pharma text-white"
                          : "border-ink/10 bg-panel text-ink-muted"
                      }`}
                      aria-hidden="true"
                    >
                      <StepIcon size={13} strokeWidth={1.7} />
                    </span>
                    <div className="min-w-0">
                      <h4
                        className={`text-[12px] font-bold uppercase tracking-wide leading-tight ${
                          done ? "text-pharma" : "text-ink"
                        }`}
                      >
                        {index + 1}. {title}
                      </h4>
                      <p className="mt-1 max-w-prose text-[12px] leading-relaxed text-ink-muted">
                        {desc}
                      </p>
                    </div>
                  </div>
                  <span
                    className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${resp.className}`}
                  >
                    {t(resp.labelKey)}
                  </span>
                </div>

                <span className="sr-only">
                  {done
                    ? t("dian_habilitation.status_done")
                    : t("dian_habilitation.status_pending")}
                </span>

                {!done && step.key === "certificado" && (
                  <p className="mt-2 flex max-w-prose items-start gap-1.5 rounded-sm bg-sync/[0.08] px-2 py-1.5 text-[11px] leading-snug text-sync">
                    <span
                      aria-hidden="true"
                      className="mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full bg-sync"
                    />
                    {t("dian_habilitation.steps.certificado.pending_hint")}
                  </p>
                )}

                {step.href && (
                  <a
                    href={step.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-pharma underline decoration-pharma/25 underline-offset-2 transition-colors hover:text-pharma hover:decoration-pharma focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pharma"
                  >
                    {t(`dian_habilitation.steps.${step.key}.link`)}
                    <span aria-hidden="true" className="text-[11px] leading-none">
                      ↗
                    </span>
                  </a>
                )}
              </div>
            </motion.li>
          );
        })}

        {/* Paso 6 — rango */}
        <motion.li variants={itemVariants} className="relative flex gap-3 py-3.5">
          <div
            aria-hidden="true"
            className="relative z-10 mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 bg-panel shadow-[0_1px_2px_rgba(0,0,0,0.06)]"
            style={{
              borderColor: isOperating
                ? "var(--color-pharma)"
                : "color-mix(in srgb, var(--color-ink) 18%, transparent)",
              backgroundColor: isOperating
                ? "var(--color-pharma)"
                : "var(--color-panel)",
              color: isOperating ? "white" : "var(--color-ink)",
            }}
          >
            {isOperating ? (
              <CheckIcon size={14} strokeWidth={2.7} />
            ) : (
              <span className="font-data text-[11px] font-bold leading-none tabular-nums">
                6
              </span>
            )}
          </div>

          <div
            className={`min-w-0 flex-1 rounded-md border px-3 py-2.5 ${
              isOperating
                ? "border-pharma/15 bg-success-container/35"
                : "border-border bg-surface-variant/30"
            }`}
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="flex min-w-0 items-start gap-2">
                <span
                  className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-sm border ${
                    isOperating
                      ? "border-pharma/20 bg-pharma text-white"
                      : "border-ink/10 bg-panel text-ink-muted"
                  }`}
                  aria-hidden="true"
                >
                  <ReceiptIcon size={13} strokeWidth={1.7} />
                </span>
                <h4
                  className={`text-[12px] font-bold uppercase tracking-wide leading-tight ${
                    isOperating ? "text-pharma" : "text-ink"
                  }`}
                >
                  6. {t("dian_habilitation.steps.rango.title")}
                </h4>
              </div>
              <span
                className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${RESPONSIBILITY_META.software.className}`}
              >
                {t(RESPONSIBILITY_META.software.labelKey)}
              </span>
            </div>

            {isOperating ? (
              <div className="mt-2 flex flex-wrap items-center gap-1.5 rounded-sm bg-success-container px-2.5 py-2 font-data text-[11px] tabular-nums text-pharma">
                <span className="inline-flex items-center gap-1.5 font-semibold">
                  <span className="h-1.5 w-1.5 rounded-full bg-pharma" aria-hidden="true" />
                  {t("dian_habilitation.range_obtained")}
                </span>
                <span aria-hidden="true" className="text-ink/30">
                  ·
                </span>
                <span>
                  {t("dian_habilitation.range_prefix", {
                    prefix: draft?.resolutionPrefix ?? "",
                  })}
                </span>
                {draft?.resolutionRangeStart && draft?.resolutionRangeEnd && (
                  <>
                    <span aria-hidden="true" className="text-ink/30">
                      ·
                    </span>
                    <span>
                      {t("dian_habilitation.range_range", {
                        start: draft.resolutionRangeStart,
                        end: draft.resolutionRangeEnd,
                      })}
                    </span>
                  </>
                )}
              </div>
            ) : (
              <p className="mt-2 flex max-w-prose items-start gap-1.5 rounded-sm bg-sync/[0.07] px-2 py-1.5 text-[11px] leading-snug text-ink-muted">
                <span
                  aria-hidden="true"
                  className="mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full bg-sync"
                />
                {t("dian_habilitation.range_pending")}
              </p>
            )}
          </div>
        </motion.li>
      </ol>

      {/* footer — compact */}
      <div className="flex flex-col gap-2.5 border-t border-border bg-surface-variant/40 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <a
          href={`mailto:${t("dian_habilitation.footer.support_email")}`}
          className="inline-flex items-center justify-center gap-1.5 rounded-sm border border-border bg-panel px-3 py-1.5 text-[11px] font-semibold text-ink transition-colors hover:bg-panel hover:shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pharma"
        >
          <MailIcon size={13} strokeWidth={1.7} aria-hidden="true" />
          {t("dian_habilitation.footer.support_cta")}
        </a>
        <a
          href={OFFICIAL_GUIDE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center gap-1 text-[11px] font-medium text-ink-muted underline decoration-border underline-offset-2 transition-colors hover:text-pharma focus-visible:text-pharma"
        >
          {t("dian_habilitation.footer.official_guide")}
          <span aria-hidden="true" className="ml-1 leading-none">
            ↗
          </span>
        </a>
      </div>
    </motion.section>
  );
};
