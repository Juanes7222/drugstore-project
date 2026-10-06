import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { CheckIcon, PillIcon, RefreshCwIcon, ScanLineIcon } from "./icons";
import { formatCOP } from "../lib/format";

/**
 * Sync pill: the refresh glyph spins a quarter turn when the simulated queue
 * drains (5.5 s cycle), retelling the "it uploads on its own" story inside the
 * mockup.
 */
function SyncStatus() {
  const { t } = useTranslation();

  return (
    <span className="chip border border-verde/25 bg-menta font-medium text-verde-hondo">
      <RefreshCwIcon className="sync-spin text-xs" />
      {t("pos_preview.sync_queued")}
    </span>
  );
}

interface PreviewItem {
  nameKey: string;
  qty: number;
  unitPriceCents: number;
  /** Lote por vencer — the one amber urgency chip in the whole site. */
  nearExpiry?: boolean;
  requiresFormula?: boolean;
}

// Demo contents for the mockup. Prices mirror typical Colombian drugstore
// shelf prices; medicines carry 0% IVA, hence the tax line below.
const ITEMS: PreviewItem[] = [
  {
    nameKey: "pos_preview.item_acetaminofen",
    qty: 2,
    unitPriceCents: 320_000,
    nearExpiry: true,
  },
  { nameKey: "pos_preview.item_loratadina", qty: 1, unitPriceCents: 550_000 },
  {
    nameKey: "pos_preview.item_losartan",
    qty: 1,
    unitPriceCents: 980_000,
    requiresFormula: true,
  },
];

/**
 * A faithful slice of the actual POS sales screen, built in HTML: cart lines
 * print in on load with their lot/expiry signals and the formula check.
 * Declared as a single image for screen readers; it is an illustration of the
 * product, not UI.
 */
export function PosPreview() {
  const { t } = useTranslation();

  const subtotal = ITEMS.reduce(
    (sum, item) => sum + item.qty * item.unitPriceCents,
    0,
  );

  return (
    <div
      role="img"
      aria-label={t("pos_preview.label")}
      className="pos-preview sheet overflow-hidden"
    >
      {/* Terminal chrome */}
      <div className="flex items-center justify-between gap-3 bg-tinta px-4 py-3 text-papel-alto">
        <span className="min-w-0 truncate text-sm font-semibold">
          {t("pos_preview.store_name")}
        </span>
        <span className="data chip shrink-0 border border-papel-alto/25">
          {t("pos_preview.shift")}
        </span>
      </div>

      <div aria-hidden="true" className="relative p-4 sm:p-5">
        {/* Scanner pass — the machine reading itself, once per cycle. */}
        <span className="scanline" />

        {/* Search + ambient sync status (calm, never red) */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex min-w-0 flex-1 basis-44 items-center gap-2 border border-line bg-papel px-3 py-2 text-sm text-grafito">
            <ScanLineIcon className="scan-flash shrink-0 text-base text-verde" />
            <span className="truncate">
              {t("pos_preview.search_placeholder")}
            </span>
          </div>
          <SyncStatus />
        </div>

        {/* Cart */}
        <p className="folio mt-5 text-grafito">{t("pos_preview.cart_title")}</p>
        <ul className="mt-2 border-y border-line-quiet">
          {ITEMS.map((item, index) => (
            <li
              key={item.nameKey}
              className="cart-line border-b border-line-quiet py-3 last:border-b-0"
              style={{ "--line-index": index } as CSSProperties}
            >
              <div className="flex items-baseline justify-between gap-4">
                <span className="text-sm font-medium">
                  {t(item.nameKey)}{" "}
                  <span className="text-grafito">×{item.qty}</span>
                </span>
                <span className="data text-sm">
                  {formatCOP(item.qty * item.unitPriceCents)}
                </span>
              </div>

              {item.nearExpiry && (
                <p className="chip mt-1.5 bg-ambar-fondo font-medium text-ambar-texto">
                  {t("pos_preview.lot_code")}
                  <span className="font-semibold">
                    · {t("pos_preview.near_expiry_flag")}
                  </span>
                </p>
              )}

              {item.requiresFormula && (
                <p className="chip mt-1.5 border border-verde/30 font-medium text-verde-hondo">
                  <PillIcon className="text-xs" />
                  {t("pos_preview.requires_formula")}
                  <CheckIcon className="text-xs text-verde" />
                  {t("pos_preview.formula_verified")}
                </p>
              )}
            </li>
          ))}
        </ul>

        {/* Totals — tabular figures, right aligned */}
        <dl className="mt-4 space-y-1.5">
          <div className="flex items-baseline justify-between text-sm text-grafito">
            <dt>{t("pos_preview.subtotal")}</dt>
            <dd className="data">{formatCOP(subtotal)}</dd>
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
              {formatCOP(subtotal)}
            </dd>
          </div>
        </dl>

        <button
          type="button"
          tabIndex={-1}
          className="btn btn-primary mt-4 w-full cursor-default"
        >
          {t("pos_preview.pay_button")}
          <span className="data chip border-white/30">F2</span>
        </button>
      </div>
    </div>
  );
}
