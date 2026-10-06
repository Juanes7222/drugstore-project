import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { CheckIcon, RefreshCwIcon, ScanLineIcon } from "./icons";
import { formatCOP } from "../lib/format";
import { Tear } from "./tear";

/** The four moments of the sale the section exists to perform. */
type DemoState = "charging" | "stored" | "syncing" | "sent";

interface DemoStep {
  state: DemoState;
}

/** One sale, in the currency the POS charges it in. */
const SALE_CENTS = 980_000;

const STEPS: DemoStep[] = [
  { state: "charging" },
  { state: "stored" },
  { state: "syncing" },
  { state: "sent" },
];

interface ScreenCopy {
  chip: string;
  chipTone: "verde" | "quiet";
  note: string;
  action: string;
}

function screenCopy(state: DemoState): ScreenCopy {
  switch (state) {
    case "charging":
      return {
        chip: "offline.screen.state_charging",
        chipTone: "verde",
        note: "offline.screen.cart_note",
        action: "offline.screen.pay_button",
      };
    case "stored":
      return {
        chip: "offline.screen.state_stored",
        chipTone: "quiet",
        note: "offline.screen.saved_note",
        action: "offline.screen.retry_button",
      };
    case "syncing":
      return {
        chip: "offline.screen.state_syncing",
        chipTone: "verde",
        note: "offline.screen.syncing_note",
        action: "offline.screen.sync_button",
      };
    case "sent":
      return {
        chip: "offline.screen.state_sent",
        chipTone: "verde",
        note: "offline.screen.dian_note",
        action: "offline.screen.next_button",
      };
  }
}

/**
 * One state of the terminal. Every screen is the same POS at a different moment
 * — same chrome, same line item, same totals — so the only thing that changes is
 * the machine's own state. That sameness is what makes the sequence legible: the
 * reader is meant to notice that the cart never moved.
 */
function DemoScreen({ state }: { state: DemoState }) {
  const { t } = useTranslation();
  const copy = screenCopy(state);

  return (
    <div className="sheet overflow-hidden">
      <div className="flex items-center justify-between gap-3 bg-tinta px-4 py-3 text-papel-alto">
        <span className="min-w-0 truncate text-sm font-semibold">
          {t("pos_preview.store_name")}
        </span>
        <span className="data chip shrink-0 border border-papel-alto/25">
          {t("pos_preview.shift")}
        </span>
      </div>

      <div className="p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex min-w-0 flex-1 basis-44 items-center gap-2 border border-line bg-papel px-3 py-2 text-sm text-grafito">
            <ScanLineIcon
              className={
                state === "syncing"
                  ? "sync-spin shrink-0 text-base text-verde"
                  : "shrink-0 text-base text-grafito"
              }
            />
            <span className="truncate">
              {t("pos_preview.search_placeholder")}
            </span>
          </div>
          <span
            className={`chip shrink-0 font-medium ${
              copy.chipTone === "verde"
                ? "border border-verde/30 bg-menta text-verde-hondo"
                : "border border-line-strong bg-papel text-grafito"
            }`}
          >
            {copy.chipTone === "verde" && (
              <RefreshCwIcon className="text-xs" aria-hidden="true" />
            )}
            {t(copy.chip)}
          </span>
        </div>

        <p className="folio mt-5 text-grafito">{t("pos_preview.cart_title")}</p>
        <ul className="mt-2 border-y border-line-quiet">
          <li className="flex items-baseline justify-between gap-4 py-3">
            <span className="text-sm font-medium">
              {t("pos_preview.item_losartan")}{" "}
              <span className="text-grafito">×1</span>
            </span>
            <span className="data text-sm">{formatCOP(SALE_CENTS)}</span>
          </li>
        </ul>

        <dl className="mt-4 space-y-1.5">
          <div className="flex items-baseline justify-between text-sm text-grafito">
            <dt>{t("pos_preview.subtotal")}</dt>
            <dd className="data">{formatCOP(SALE_CENTS)}</dd>
          </div>
          <div className="flex items-baseline justify-between text-sm text-grafito">
            <dt>{t("pos_preview.tax_zero")}</dt>
            <dd className="data">{formatCOP(0)}</dd>
          </div>
          <div className="mt-2 flex items-baseline justify-between border-t border-dashed border-line-strong pt-3">
            <dt className="display text-lg font-semibold">
              {t("pos_preview.total")}
            </dt>
            <dd className="data text-xl font-semibold">
              {formatCOP(SALE_CENTS)}
            </dd>
          </div>
        </dl>

        {/* The line the step is actually about: what the machine did. */}
        <p
          className={`offline-note chip mt-4 w-full justify-start border px-3 py-2.5 text-sm font-medium ${
            state === "sent" ? "offline-note--done" : ""
          }`}
        >
          {state === "sent" && (
            <CheckIcon className="text-xs" aria-hidden="true" />
          )}
          {t(copy.note)}
        </p>

        <p className="folio mt-5 flex items-center justify-between text-grafito">
          {t("offline.screen.action_label")}
          <span>{t(copy.action)}</span>
        </p>
      </div>
    </div>
  );
}

/**
 * The paper trail, printing itself line by line as the reader crosses the last
 * step. It belongs to the end of the sequence because it is the whole document:
 * subtotal, tax, total and the invoice number, in that order. Same "the paper
 * prints" motif the plan documents use, tied to position instead of a clock.
 */
function PrintingReceipt() {
  const { t } = useTranslation();
  const lines = [
    { key: "offline.receipt.line_sale", amount: formatCOP(SALE_CENTS) },
    { key: "offline.receipt.line_tax", amount: formatCOP(0) },
    { key: "offline.receipt.line_total", amount: formatCOP(SALE_CENTS) },
    { key: "offline.receipt.line_dian", amount: "" },
  ];

  return (
    <div className="mt-4">
      <div className="notch" aria-hidden="true" />
      <div className="sheet border-x-0 border-b-0 px-4 pt-4 pb-5">
        <p className="folio text-grafito">{t("offline.receipt.head")}</p>
        <ul className="data mt-3 text-sm">
          {lines.map((line, index) => (
            <li
              key={line.key}
              className="offline-receipt__line flex items-baseline justify-between gap-4 py-1.5"
              style={{ "--line-index": index } as CSSProperties}
            >
              <span>{t(line.key, { amount: line.amount })}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/**
 * The offline band, performed rather than asserted.
 *
 * The claim worth making is a *transition* — ring it up, lose the network, hold
 * it, send it — and a transition is what a scroll can perform. So each step
 * carries the terminal state it is about, side by side, and the terminal stays
 * pinned while that step crosses the screen.
 *
 * The pairing is structural, not calculated: step N and its screen are the same
 * grid row, so "when you are reading step N, you are looking at screen N"
 * cannot drift out of sync no matter how tall the text or the viewport gets.
 * The earlier version put one tall track beside a short column and derived the
 * four windows from the track's own travel, which meant the states landed
 * nowhere near their steps and left most of the section empty black.
 *
 * Because a step's screen is its own row rather than a layer, each row names its
 * own view timeline and the printing inside that row is driven by it — no global
 * percentage arithmetic, and nothing depends on the total track height.
 */
export function OfflinePanel() {
  const { t } = useTranslation();
  const steps = t("offline.steps", { returnObjects: true }) as {
    title: string;
    body: string;
  }[];

  return (
    <section
      id="offline"
      aria-labelledby="offline-title"
      className="scroll-mt-20 bg-tinta text-papel-alto"
    >
      <Tear bite="var(--color-papel-alto)" />

      <div className="mx-auto max-w-[78rem] px-5 pt-12 pb-20 sm:px-8 lg:pt-16 lg:pb-28">
        <div className="max-w-xl">
          <p className="folio text-verde-texto">{t("offline.eyebrow")}</p>
          <h2
            id="offline-title"
            className="display mt-5 text-[clamp(1.8rem,3.4vw,2.5rem)]"
          >
            {t("offline.title")}
          </h2>
          <p className="mt-6 text-lg leading-relaxed text-papel-alto/75">
            {t("offline.body")}
          </p>
        </div>

        <ol className="offline-track mt-10 lg:mt-16">
          {steps.map((step, index) => {
            const state = STEPS[index]?.state ?? "sent";
            const isLast = index === steps.length - 1;

            return (
              <li
                key={step.title}
                className="offline-row"
                // Each row names its own timeline; everything inside it — the
                // note line, the receipt — is driven by that row's travel.
                style={{ "--tl": `--tl-${index}` } as CSSProperties}
              >
                <div className="offline-row__text spec-row">
                  <span className="data text-sm font-semibold text-verde-texto">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <h3 className="display mt-2 text-lg">{step.title}</h3>
                  <p className="mt-1.5 leading-relaxed text-papel-alto/75">
                    {step.body}
                  </p>
                </div>

                {/* aria-hidden: the step beside it already says all of this. */}
                <div className="offline-row__canvas" aria-hidden="true">
                  <DemoScreen state={state} />
                  {isLast && <PrintingReceipt />}
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
