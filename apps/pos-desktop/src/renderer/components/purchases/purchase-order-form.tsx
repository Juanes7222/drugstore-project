/**
 * PurchaseOrderForm — create form with combobox-style supplier selector,
 * expected delivery date, notes, and line items editor (product autocomplete
 * with keyboard navigation, quantity, unit cost).
 *
 * @category Component
 */

import {
  type FC,
  useCallback,
  useMemo,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import type { SupplierSearchResult } from '../../../domain/purchases';
import type { OrderFormItem, OrderFormData } from './purchase-orders.page';
import { Plus, Package, X } from 'lucide-react';
import { SearchableSelect } from './searchable-select';
import type { SearchableSelectOption } from './searchable-select';
import { formatCOP } from './purchases-helpers';

export interface PurchaseOrderFormProps {
  data: OrderFormData;
  onChange: (data: OrderFormData) => void;
  suppliers: SupplierSearchResult[];
  onSupplierSearch: (query: string) => void;
  /** Array of products matching the current search query. */
  productResults: Array<{ id: string; commercialName: string; laboratory: string; barcodes: Array<{ barcode: string }>; currentPrice: string | null }>;
  /** Called whenever the user types in any product search input. */
  onProductSearch: (query: string) => void;
  isSearchingProduct: boolean;
  onAddItem: (item: OrderFormItem) => void;
  onRemoveItem: (index: number) => void;
  onItemChange: (index: number, partial: Partial<OrderFormItem>) => void;
  onSubmit: () => void;
  onCancel: () => void;
  isSaving: boolean;
  error: string | null;
  /** Open inline supplier creation modal. */
  onCreateSupplier?: () => void;
  /** Open inline product creation modal. */
  onCreateProduct?: () => void;
}

export type { OrderFormItem, OrderFormData } from './purchase-orders.page';

export const PurchaseOrderForm: FC<PurchaseOrderFormProps> = ({
  data,
  onChange,
  suppliers,
  onSupplierSearch,
  productResults,
  onProductSearch,
  isSearchingProduct,
  onAddItem,
  onRemoveItem,
  onItemChange,
  onSubmit,
  onCancel,
  isSaving,
  error,
  onCreateSupplier,
  onCreateProduct,
}) => {
  const { t } = useTranslation();
  const [itemErrors, setItemErrors] = useState<Record<number, string>>({});

  // ── Map suppliers to SearchableSelect options ─────────────────────────

  const supplierOptions: SearchableSelectOption[] = useMemo(
    () =>
      suppliers.map((s) => ({
        id: s.id,
        label: s.businessName,
        sublabel: `${s.identificationNumber}${s.contactName ? ` · ${s.contactName}` : ''}`,
      })),
    [suppliers],
  );

  const handleSelectSupplier = useCallback(
    (option: SearchableSelectOption) => {
      onChange({ ...data, supplierId: option.id });
    },
    [data, onChange],
  );

  // ── Map product results to SearchableSelect options ───────────────────

  const productOptions: SearchableSelectOption[] = useMemo(
    () =>
      productResults.map((p) => ({
        id: p.id,
        label: p.commercialName,
        sublabel: `${p.laboratory}${p.barcodes[0] ? ` · ${p.barcodes[0].barcode}` : ''}${p.currentPrice ? ` · $${p.currentPrice}` : ''}`,
      })),
    [productResults],
  );

  // ── Calculate total ───────────────────────────────────────────────────

  const total = useMemo(
    () => data.items.reduce((sum, item) => sum + item.requestedQuantity * item.expectedUnitCost, 0),
    [data.items],
  );

  // ── Validation ────────────────────────────────────────────────────────

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const errs: Record<number, string> = {};
      data.items.forEach((item, i) => {
        if (!item.productId.trim()) errs[i] = t('purchases.orders.validationProductRequired');
        else if (item.requestedQuantity <= 0) errs[i] = t('purchases.orders.validationQtyPositive');
        else if (item.expectedUnitCost < 0) errs[i] = t('purchases.orders.validationCostNonNegative');
      });
      setItemErrors(errs);
      if (Object.keys(errs).length === 0) onSubmit();
    },
    [data.items, onSubmit, t],
  );

  const handleAddItem = useCallback(() => {
    onAddItem({ productId: '', productName: '', requestedQuantity: 1, expectedUnitCost: 0 });
  }, [onAddItem]);

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <form
      onSubmit={handleSubmit}
      className="max-w-3xl mx-auto flex flex-col h-full"
      noValidate
    >
      {/* Error banner */}
      {error && (
        <div className="mb-4 p-3 bg-red-50 text-red-700 rounded text-sm border border-red-200" role="alert">
          {error}
        </div>
      )}

      {/* Supplier selection — combobox with keyboard nav */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {t('purchases.orders.supplier')}
          <span className="text-red-500 ml-0.5">*</span>
        </label>
        <div className="flex gap-2">
          <div className="flex-1">
            <SearchableSelect
              options={supplierOptions}
              onSearch={onSupplierSearch}
              onSelect={handleSelectSupplier}
              selectedId={data.supplierId}
              placeholder={t('purchases.orders.searchSupplier')}
              disabled={isSaving}
              onCreateNew={onCreateSupplier}
              createNewLabel={t('purchases.orders.createSupplier')}
            />
          </div>
        </div>
        {data.supplierId && (
          <p className="mt-1 text-xs text-gray-500">
            {supplierOptions.find((o) => o.id === data.supplierId)?.label}
            {' · '}
            {supplierOptions.find((o) => o.id === data.supplierId)?.sublabel}
          </p>
        )}
      </div>

      {/* Expected delivery date */}
      <div className="mb-4">
        <label
          htmlFor="po-expected-date"
          className="block text-sm font-medium text-gray-700 mb-1"
        >
          {t('purchases.orders.expectedDeliveryDate')}
        </label>
        <input
          id="po-expected-date"
          type="date"
          value={data.expectedDeliveryDate}
          onChange={(e) => onChange({ ...data, expectedDeliveryDate: e.target.value })}
          disabled={isSaving}
          className="pos-input w-56"
        />
      </div>

      {/* Notes */}
      <div className="mb-4">
        <label
          htmlFor="po-notes"
          className="block text-sm font-medium text-gray-700 mb-1"
        >
          {t('purchases.orders.notes')}
        </label>
        <textarea
          id="po-notes"
          value={data.notes}
          onChange={(e) => onChange({ ...data, notes: e.target.value })}
          disabled={isSaving}
          className="pos-input resize-none"
          rows={2}
        />
      </div>

      {/* Line items */}
      <div className="flex-1 min-h-0">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-gray-700">
            {t('purchases.orders.items')}
          </span>
          <div className="flex gap-1">
            {onCreateProduct && (
              <button
                type="button"
                onClick={onCreateProduct}
                disabled={isSaving || !data.supplierId}
                className="text-xs px-2 py-1 bg-green-50 text-green-700 rounded hover:bg-green-100 transition-colors font-semibold"
                title={t('purchases.orders.createProduct')}
              >
                <Package size={12} aria-hidden="true" />
                {t('purchases.orders.newProduct')}
              </button>
            )}
            <button
              type="button"
              onClick={handleAddItem}
              disabled={isSaving || !data.supplierId}
              className="inline-flex items-center gap-1 text-xs px-2 py-1 bg-pharma/10 text-pharma rounded hover:bg-pharma/20 transition-colors font-semibold"
            >
              <Plus size={14} aria-hidden="true" />
              {t('purchases.orders.addItem')}
            </button>
          </div>
        </div>

        {data.items.length === 0 ? (
          <p className="text-sm text-gray-400 italic py-4 text-center">
            {t('purchases.orders.noItems')}
          </p>
        ) : (
          <div className="space-y-3 max-h-80 overflow-y-auto">
            {data.items.map((item, i) => (
              <div
                key={i}
                className={`flex gap-2 items-start p-2 rounded ${
                  itemErrors[i] ? 'bg-red-50 border border-red-200' : 'bg-gray-50'
                }`}
              >
                {/* Product selector — combobox with keyboard nav */}
                <div className="flex-1 min-w-0">
                  <SearchableSelect
                    options={productOptions}
                    onSearch={onProductSearch}
                    onSelect={(option) => {
                      onItemChange(i, {
                        productId: option.id,
                        productName: option.label,
                      });
                    }}
                    selectedId={item.productId}
                    placeholder={t('purchases.orders.searchProduct')}
                    disabled={isSaving}
                    isLoading={isSearchingProduct}
                    error={itemErrors[i]}
                  />
                </div>

                {/* Quantity */}
                <div className="w-20 shrink-0">
                  <label className="block text-xs text-gray-500 mb-0.5">
                    {t('purchases.orders.qty')}
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={item.requestedQuantity}
                    onChange={(e) => onItemChange(i, { requestedQuantity: Math.max(1, Number(e.target.value)) })}
                    disabled={isSaving}
                    className="pos-input text-xs font-data tabular-nums"
                  />
                </div>

                {/* Unit cost */}
                <div className="w-24 shrink-0">
                  <label className="block text-xs text-gray-500 mb-0.5">
                    {t('purchases.orders.unitCost')}
                  </label>
                  <input
                    type="number"
                    min={0}
                    step={100}
                    value={item.expectedUnitCost}
                    onChange={(e) => onItemChange(i, { expectedUnitCost: Math.max(0, Number(e.target.value)) })}
                    disabled={isSaving}
                    className="pos-input text-xs font-data tabular-nums"
                  />
                </div>

                {/* Line total */}
                <div className="w-24 shrink-0 pt-4 text-right">
                  <span className="text-xs font-data tabular-nums text-gray-700">
                    {formatCOP(item.requestedQuantity * item.expectedUnitCost)}
                  </span>
                </div>

                {/* Remove */}
                <button
                  type="button"
                  onClick={() => onRemoveItem(i)}
                  disabled={isSaving}
                  className="pt-4 text-red-400 hover:text-red-600 transition-colors shrink-0"
                  aria-label={t('common.remove')}
                >
                  <X size={14} aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Total */}
      <div className="flex justify-end py-3 border-t border-gray-100 mt-4">
        <div className="text-right">
          <span className="text-xs text-gray-500">{t('purchases.orders.estimatedTotal')}: </span>
          <span className="text-sm font-bold font-data tabular-nums">{formatCOP(total)}</span>
        </div>
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-3 pt-3 border-t border-gray-100">
        <button
          type="button"
          onClick={onCancel}
          disabled={isSaving}
          className="pos-button pos-button-secondary"
        >
          {t('common.cancel')}
        </button>
        <button
          type="submit"
          disabled={isSaving || !data.supplierId}
          className="pos-button pos-button-primary"
        >
          {isSaving
            ? t('common.saving')
            : t('purchases.orders.createOrder')}
        </button>
      </div>
    </form>
  );
};
