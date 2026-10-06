import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { formatCOP } from "../lib/format";
import { useCountUp } from "../hooks/use-count-up";
import { CheckIcon, PillIcon, ScanLineIcon } from "./icons";
import { Tear } from "./tear";

/* ---------------------------------------------------------------------------
 * Real artifacts of the POS, the same way the hero preview is real. Every claim
 * in the copy below is visible in the panel next to it, which is why the copy
 * can be one short line each.
 * ------------------------------------------------------------------------- */

const LOTS = [
  { code: "L-2481", expires: "30 sep 26", stock: 12, nearExpiry: true },
  { code: "L-2477", expires: "12 nov 26", stock: 40 },
  { code: "L-2465", expires: "04 ene 27", stock: 28 },
];

// The shift closes square: 200.000 base + 1.284.500 in sales = 1.484.500 counted.
const SHIFT = {
  id: "TURNO 38",
  baseCents: 200_000_00,
  salesCents: 1_284_500_00,
  countedCents: 1_484_500_00,
};

const CHROME_PADDING =
  "flex items-center justify-between gap-3 border-b border-line bg-papel px-4 py-2.5";

/** Stock with lot and expiry, the amber flag being the only alarm on the site. */
function LotsPanel() {
  const { t } = useTranslation();

  return (
    <div className="sheet flex h-full flex-col">
      <div className={CHROME_PADDING}>
        <span className="data text-chip text-grafito">
          {t("counter.lots_label")}
        </span>
        <ScanLineIcon className="text-base text-verde" />
      </div>
      <table className="data w-full flex-1 text-xs">
        <thead>
          <tr className="text-grafito">
            <th scope="col" className="px-4 py-2 text-left font-medium">
              {t("counter.col_lot")}
            </th>
            <th scope="col" className="px-4 py-2 text-left font-medium">
              {t("counter.col_expiry")}
            </th>
            <th scope="col" className="px-4 py-2 text-right font-medium">
              {t("counter.col_stock")}
            </th>
          </tr>
        </thead>
        <tbody>
          {LOTS.map((lot, index) => (
            <tr
              key={lot.code}
              className="cart-line border-t border-line-quiet"
              style={{ "--line-index": index } as CSSProperties}
            >
              <th scope="row" className="px-4 py-2.5 text-left font-medium">
                {lot.code}
              </th>
              <td className="px-4 py-2.5">
                {lot.nearExpiry ? (
                  <span className="alarm-flash chip font-medium text-ambar-texto">
                    {lot.expires}
                    <span className="font-semibold">
                      · {t("pos_preview.near_expiry_flag")}
                    </span>
                  </span>
                ) : (
                  <span className="text-grafito">{lot.expires}</span>
                )}
              </td>
              <td className="px-4 py-2.5 text-right">{lot.stock}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The formula gate: a separate confirmation, never a memory exercise. */
function FormulaPanel() {
  const { t } = useTranslation();

  return (
    <div className="sheet flex h-full flex-col">
      <div className={CHROME_PADDING}>
        <span className="data text-chip text-grafito">
          {t("counter.formula_label")}
        </span>
        <PillIcon className="text-base text-verde" />
      </div>
      <div className="flex-1 p-4">
        <p className="text-sm font-medium">{t("counter.formula_title")}</p>
        <dl className="mt-3 space-y-2 text-sm">
          <div className="flex items-center justify-between gap-3">
            <dt className="text-grafito">{t("counter.formula_code")}</dt>
            <dd
              className="data cart-line"
              style={{ "--line-index": 0 } as CSSProperties}
            >
              F-00214
            </dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-grafito">{t("counter.formula_signature")}</dt>
            <dd
              className="cart-line"
              style={{ "--line-index": 1 } as CSSProperties}
            >
              <span className="chip border border-verde/30 font-medium text-verde-hondo">
                {t("counter.formula_signed")}
              </span>
            </dd>
          </div>
        </dl>
        <p
          className="cart-line mt-4 flex items-center gap-2 border-t border-line-quiet pt-3 text-sm font-medium text-verde-hondo"
          style={{ "--line-index": 2 } as CSSProperties}
        >
          <CheckIcon className="text-base text-verde" />
          {t("pos_preview.formula_verified")}
        </p>
      </div>
    </div>
  );
}

/**
 * Shift close: what the drawer should hold when the day is done. The three
 * figures count up together and stop at the same instant, which is the moment
 * the counted total reaches the base plus the sales — the one thing this panel
 * exists to prove, so it is the one moment allowed to move.
 */
function ShiftPanel() {
  const { t } = useTranslation();
  const [baseRef] = useCountUp<HTMLElement>(SHIFT.baseCents);
  const [salesRef] = useCountUp<HTMLElement>(SHIFT.salesCents);
  const [countedRef, counted] = useCountUp<HTMLElement>(
    SHIFT.countedCents,
    1000,
  );

  return (
    <div className="sheet flex h-full flex-col">
      <div className={CHROME_PADDING}>
        <span className="data text-chip">{SHIFT.id}</span>
        <span
          className="shift-balance data chip border border-verde/30 font-semibold text-verde"
          data-balanced={counted}
        >
          {t("counter.shift_balanced")}
        </span>
      </div>
      <dl className="data flex-1 space-y-1.5 p-4 text-sm">
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-grafito">{t("counter.shift_base")}</dt>
          <dd ref={baseRef}>{formatCOP(SHIFT.baseCents)}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-grafito">{t("counter.shift_sales")}</dt>
          <dd ref={salesRef}>{formatCOP(SHIFT.salesCents)}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-3 border-t border-dashed border-line-strong pt-2 font-semibold">
          <dt>{t("counter.shift_counted")}</dt>
          <dd ref={countedRef}>{formatCOP(SHIFT.countedCents)}</dd>
        </div>
      </dl>
    </div>
  );
}

const PANELS = [LotsPanel, FormulaPanel, ShiftPanel];

interface CounterItem {
  title: string;
  body: string;
}

/**
 * The counter, shown rather than described: three faithful slices of the real
 * POS, each with a single line of copy. The panels carry the argument, so the
 * text next to them can be one sentence.
 *
 * Three columns of fiscal data need real width before they stop being legible,
 * so the grid holds a single column all the way to `md`. Below that each panel
 * is an argument of its own and earns the full measure.
 */
export function Counter() {
  const { t } = useTranslation();
  const items = t("counter.items", { returnObjects: true }) as CounterItem[];

  return (
    <section
      id="mostrador"
      aria-labelledby="counter-title"
      className="scroll-mt-20 bg-papel-alto"
    >
      <Tear bite="var(--color-papel)" />
      <div className="mx-auto max-w-[78rem] px-5 pt-10 pb-20 sm:px-8 lg:pb-28">
        <p className="folio text-verde">{t("counter.eyebrow")}</p>
        <h2
          id="counter-title"
          className="display mt-5 max-w-2xl text-[clamp(1.8rem,3.4vw,2.5rem)]"
        >
          {t("counter.title")}
        </h2>

        <ul className="mt-12 grid gap-8 md:grid-cols-3 md:gap-6 lg:gap-8">
          {items.map((item, index) => {
            const Panel = PANELS[index];
            return (
              <li key={item.title} className="flex flex-col">
                <Panel />
                <h3 className="display mt-5 text-lg">{item.title}</h3>
                <p className="mt-1.5 leading-relaxed text-grafito">
                  {item.body}
                </p>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
