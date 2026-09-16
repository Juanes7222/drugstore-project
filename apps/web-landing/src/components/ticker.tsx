import { useTranslation } from "react-i18next";
import { PlusIcon } from "./icons";

// Real artifacts of the POS — the same mono data lines the pillars show,
// reprinted as a live status tape. Key paths into existing translations so
// the numbers stay single-sourced.
const TICKER_KEYS = [
  "pos_preview.lot_near_expiry",
  "pillars.items.0.detail",
  "pillars.items.1.detail",
  "pillars.items.2.detail",
  "pillars.items.3.detail",
] as const;

/**
 * The fiscal tape under the hero: the system's actual data (lot codes,
 * formulas, shifts, sync queue) looping like a status line. Decorative
 * motion — screen readers get the static summary instead.
 */
export function Ticker() {
  const { t } = useTranslation();
  const items = TICKER_KEYS.map((key) => t(key));
  // Duplicate once: the track translates -50%, so two identical halves loop
  // seamlessly. Item spacing lives on the items, not a flex gap, to keep the
  // halves exactly equal.
  const loop = [...items, ...items];

  return (
    <div className="group overflow-hidden border-y border-tinta/10 bg-white">
      <p className="sr-only">{t("ticker.summary")}</p>
      <div
        aria-hidden="true"
        className="ticker-track flex w-max items-center py-3 group-hover:[animation-play-state:paused]"
      >
        {loop.map((item, index) => (
          <span
            key={`${item}-${index}`}
            className="data flex shrink-0 items-center text-xs text-tinta-media"
          >
            <PlusIcon className="mr-10 text-sm text-verde-cruz/50" />
            <span className="mr-10">{item}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
