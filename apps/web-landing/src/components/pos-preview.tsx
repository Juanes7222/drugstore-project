import { useTranslation } from 'react-i18next';
import {
  CheckIcon,
  PillIcon,
  RefreshCwIcon,
  ScanLineIcon,
} from './icons';
import { formatCOP } from '../lib/format';

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
    nameKey: 'pos_preview.item_acetaminofen',
    qty: 2,
    unitPriceCents: 320_000,
    nearExpiry: true,
  },
  { nameKey: 'pos_preview.item_loratadina', qty: 1, unitPriceCents: 550_000 },
  {
    nameKey: 'pos_preview.item_losartan',
    qty: 1,
    unitPriceCents: 980_000,
    requiresFormula: true,
  },
];

/**
 * A faithful slice of the actual POS sales screen, built in HTML: cart lines
 * with lot/expiry signals and the formula check. Declared as a single image
 * for screen readers; it is an illustration of the product, not UI.
 */
export function PosPreview() {
  const { t } = useTranslation();

  const subtotal = ITEMS.reduce((sum, item) => sum + item.qty * item.unitPriceCents, 0);

  return (
    <div
      role="img"
      aria-label={t('pos_preview.label')}
      className="overflow-hidden rounded-xl border border-tinta/20 bg-white shadow-[0_1px_0_rgba(21,34,27,0.06)]"
    >
      {/* Terminal chrome */}
      <div className="flex items-center justify-between gap-3 bg-tinta px-4 py-3 text-papel">
        <span className="min-w-0 truncate text-sm font-semibold">{t('pos_preview.store_name')}</span>
        <span className="data shrink-0 rounded-full bg-papel/10 px-2.5 py-1 text-[11px]">
          {t('pos_preview.shift')}
        </span>
      </div>

      <div aria-hidden="true" className="p-4 sm:p-5">
        {/* Search + ambient sync status (calm, never red) */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex min-w-0 flex-1 basis-44 items-center gap-2 rounded-md border border-tinta/20 bg-papel px-3 py-2 text-sm text-tinta-media">
            <ScanLineIcon className="shrink-0 text-base text-verde-cruz" />
            <span className="truncate">{t('pos_preview.search_placeholder')}</span>
          </div>
          <span className="data flex shrink-0 items-center gap-1.5 rounded-full bg-menta px-2.5 py-1.5 text-[11px] font-medium text-verde-cruz-oscuro">
            <RefreshCwIcon className="text-xs" />
            {t('pos_preview.sync_queued')}
          </span>
        </div>

        {/* Cart */}
        <p className="eyebrow mt-5 text-tinta-media">{t('pos_preview.cart_title')}</p>
        <ul className="mt-2 divide-y divide-tinta/10 border-y border-tinta/10">
          {ITEMS.map((item) => (
            <li key={item.nameKey} className="py-3">
              <div className="flex items-baseline justify-between gap-4">
                <span className="text-sm font-medium">
                  {t(item.nameKey)}{' '}
                  <span className="text-tinta-media">×{item.qty}</span>
                </span>
                <span className="data text-sm">{formatCOP(item.qty * item.unitPriceCents)}</span>
              </div>

              {item.nearExpiry && (
                <p className="data mt-1.5 inline-flex items-center gap-1.5 rounded bg-ambar-lote-fondo px-2 py-0.5 text-[11px] font-medium text-ambar-lote">
                  {t('pos_preview.lot_near_expiry')}
                  <span className="font-semibold">· {t('pos_preview.near_expiry_flag')}</span>
                </p>
              )}

              {item.requiresFormula && (
                <p className="mt-1.5 inline-flex items-center gap-1.5 rounded-full border border-verde-cruz/30 px-2 py-0.5 text-[11px] font-medium text-verde-cruz-oscuro">
                  <PillIcon className="text-xs" />
                  {t('pos_preview.requires_formula')}
                  <CheckIcon className="text-xs text-verde-cruz" />
                  {t('pos_preview.formula_verified')}
                </p>
              )}
            </li>
          ))}
        </ul>

        {/* Totals — tabular figures, right aligned */}
        <dl className="mt-4 space-y-1.5">
          <div className="flex items-baseline justify-between text-sm text-tinta-media">
            <dt>{t('pos_preview.subtotal')}</dt>
            <dd className="data">{formatCOP(subtotal)}</dd>
          </div>
          <div className="flex items-baseline justify-between text-sm text-tinta-media">
            <dt>{t('pos_preview.tax_zero')}</dt>
            <dd className="data">{formatCOP(0)}</dd>
          </div>
          <div className="mt-2 flex items-baseline justify-between border-t border-tinta/15 pt-3">
            <dt className="display font-bold">{t('pos_preview.total')}</dt>
            <dd className="data text-xl font-semibold">{formatCOP(subtotal)}</dd>
          </div>
        </dl>

        <button
          type="button"
          tabIndex={-1}
          className="btn btn-primary mt-4 w-full cursor-default"
        >
          {t('pos_preview.pay_button')}
          <span className="data rounded bg-white/20 px-1.5 py-0.5 text-[11px]">F2</span>
        </button>
      </div>
    </div>
  );
}
