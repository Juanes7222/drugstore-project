/**
 * ReceptionForm — create reception form with supplier selector, PO reference,
 * notes, and items editor (product, lot/batch number, expiration date,
 * quantity received, unit cost, tax scheme/rate).
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
import { PlusIcon, Trash2Icon } from "@/components/ui/icons";
import type { CreateReceptionInput } from '../../../domain/purchases';
import { formatCOP } from './purchases-helpers';
import { SearchableSelect, type SearchableSelectOption } from './searchable-select';

export interface ReceptionFormProps {
  data: CreateReceptionInput;
  onChange: (partial: Partial<CreateReceptionInput>) => void;
  onSubmit: () => void;
  onCancel: () => void;
  isSaving: boolean;
  error: string | null;
  // Supplier search
  suppliers: SearchableSelectOption[];
  onSupplierSearch: (query: string) => void;
  isSearchingSupplier?: boolean;
  // Purchase order search
  purchaseOrders: SearchableSelectOption[];
  onPurchaseOrderSearch: (query: string) => void;
  isSearchingPurchaseOrder?: boolean;
  // Product search for items — items may include optional currentCost for auto-fill
  productResults: (SearchableSelectOption & { currentCost?: string | null })[];
  onProductSearch: (query: string) => void;
  isSearchingProduct?: boolean;
  // Config-aware field requirements (from local-config.store)
  requireLotOnReception?: boolean;
  requireExpiryOnReception?: boolean;
}

interface ReceptionFormItem {
  productId: string;
  receivedQuantity: number;
  lotNumber: string;
  expirationDate: string;
  realUnitCost: number;
  taxRate: number;
}

export const ReceptionForm: FC<ReceptionFormProps> = ({
  data,
  onChange,
  onSubmit,
  onCancel,
  isSaving,
  error,
  suppliers,
  onSupplierSearch,
  isSearchingSupplier = false,
  purchaseOrders,
  onPurchaseOrderSearch,
  isSearchingPurchaseOrder = false,
  productResults,
  onProductSearch,
  isSearchingProduct = false,
  requireLotOnReception = false,
  requireExpiryOnReception = false,
}) => {
  const { t } = useTranslation();

  // Local items state for richer editing than CreateReceptionInput supports
  const [items, setItems] = useState<ReceptionFormItem[]>(
    (data.items as any[]).map((item: any) => ({
      productId: item.productId ?? '',
      receivedQuantity: item.receivedQuantity ?? 1,
      lotNumber: item.lotNumber ?? '',
      expirationDate: item.expirationDate ?? '',
      realUnitCost: item.realUnitCost ?? 0,
      taxRate: item.taxRate ?? 19,
    })),
  );

  const syncItemsToParent = useCallback(
    (updatedItems: ReceptionFormItem[]) => {
      onChange({ items: updatedItems as any });
    },
    [onChange],
  );

  const handleAddItem = useCallback(() => {
    const newItems = [
      ...items,
      { productId: '', receivedQuantity: 1, lotNumber: '', expirationDate: '', realUnitCost: 0, taxRate: 19 },
    ];
    setItems(newItems);
    syncItemsToParent(newItems);
  }, [items, syncItemsToParent]);

  const handleRemoveItem = useCallback(
    (index: number) => {
      const newItems = items.filter((_, i) => i !== index);
      setItems(newItems);
      syncItemsToParent(newItems);
    },
    [items, syncItemsToParent],
  );

  const handleItemChange = useCallback(
    (index: number, partial: Partial<ReceptionFormItem>) => {
      const newItems = items.map((item, i) =>
        i === index ? { ...item, ...partial } : item,
      );
      setItems(newItems);
      syncItemsToParent(newItems);
    },
    [items, syncItemsToParent],
  );

  const total = useMemo(
    () => items.reduce((sum, item) => sum + item.receivedQuantity * item.realUnitCost, 0),
    [items],
  );

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      onSubmit();
    },
    [onSubmit],
  );

  return (
    <form onSubmit={handleSubmit} className="max-w-4xl mx-auto flex flex-col h-full" noValidate>
      {/* Error banner */}
      {error && (
        <div className="mb-4 p-3 bg-error-container text-error rounded text-sm border border-error/20" role="alert">
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 mb-4">
        {/* Supplier */}
        <div>
          <label className="block text-sm font-medium text-ink mb-1">
            {t('purchases.receptions.supplierId')}
            <span className="text-error ml-0.5">*</span>
          </label>
          <SearchableSelect
            options={suppliers}
            onSearch={onSupplierSearch}
            onSelect={(opt) => onChange({ supplierId: opt.id })}
            selectedId={data.supplierId}
            placeholder={t('purchases.receptions.searchSupplier')}
            disabled={isSaving}
            isLoading={isSearchingSupplier}
          />
        </div>

        {/* PO reference */}
        <div>
          <label className="block text-sm font-medium text-ink mb-1">
            {t('purchases.receptions.purchaseOrder')}
          </label>
          <SearchableSelect
            options={purchaseOrders}
            onSearch={onPurchaseOrderSearch}
            onSelect={(opt) => onChange({ purchaseOrderId: opt.id })}
            selectedId={data.purchaseOrderId ?? null}
            placeholder={t('purchases.receptions.searchPurchaseOrder')}
            disabled={isSaving}
            isLoading={isSearchingPurchaseOrder}
          />
        </div>
      </div>

      {/* Notes */}
      <div className="mb-4">
        <label
          htmlFor="reception-notes"
          className="block text-sm font-medium text-ink mb-1"
        >
          {t('purchases.receptions.notes')}
        </label>
        <textarea
          id="reception-notes"
          value={data.notes}
          onChange={(e) => onChange({ notes: e.target.value })}
          disabled={isSaving}
          className="pos-input resize-none"
          rows={2}
        />
      </div>

      {/* Items */}
      <div className="flex-1 min-h-0">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-ink">
            {t('purchases.receptions.items')}
          </span>
          <button
            type="button"
            onClick={handleAddItem}
            disabled={isSaving || !data.supplierId}
            className="inline-flex items-center gap-1 text-xs px-2 py-1 bg-pharma/10 text-pharma rounded hover:bg-pharma/20 transition-colors font-semibold"
          >
            <PlusIcon size={14} aria-hidden="true" />
            {t('purchases.receptions.addItem')}
          </button>
        </div>

        {items.length === 0 ? (
          <p className="text-sm text-ink-muted italic py-4 text-center">
            {t('purchases.receptions.noItems')}
          </p>
        ) : (
          <div className="space-y-3 max-h-96 overflow-y-auto">
            {items.map((item, i) => (
              <div key={i} className="pos-panel p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-ink-muted uppercase">
                    {t('purchases.receptions.itemLabel')} #{i + 1}
                  </span>
            <button
              type="button"
              onClick={() => handleRemoveItem(i)}
              disabled={isSaving}
              className="text-error/60 hover:text-error transition-colors"
              aria-label={t('common.remove')}
            >
              <Trash2Icon size={14} aria-hidden="true" />
            </button>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs text-ink-muted mb-0.5">
                      {t('purchases.receptions.product')}
                    </label>
                    <SearchableSelect
                      options={productResults}
                      onSearch={onProductSearch}
                      onSelect={(opt) => {
                      const optWithCost = opt as SearchableSelectOption & { currentCost?: string | null };
                      const cost = optWithCost.currentCost ? Number(optWithCost.currentCost) : 0;
                      handleItemChange(i, { productId: opt.id, realUnitCost: cost });
                    }}
                      selectedId={item.productId}
                      placeholder={t('purchases.receptions.searchProduct')}
                      disabled={isSaving}
                      isLoading={isSearchingProduct}
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-ink-muted mb-0.5">
                      {t('purchases.receptions.qtyReceived')}
                    </label>
                    <input
                      type="number"
                      min={1}
                      value={item.receivedQuantity}
                      onChange={(e) => handleItemChange(i, { receivedQuantity: Math.max(1, Number(e.target.value)) })}
                      disabled={isSaving}
                      className="pos-input text-xs font-data tabular-nums"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs text-ink-muted mb-0.5">
                      {t('purchases.receptions.lotNumber')}
                      {requireLotOnReception && <span className="text-error ml-0.5">*</span>}
                      {!requireLotOnReception && <span className="text-ink-muted/60 ml-1 font-normal">({t('common.optional')})</span>}
                    </label>
                    <input
                      type="text"
                      value={item.lotNumber}
                      onChange={(e) => handleItemChange(i, { lotNumber: e.target.value })}
                      disabled={isSaving}
                      className="pos-input text-xs font-data tabular-nums"
                      placeholder="L24056"
                      autoComplete="off"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-ink-muted mb-0.5">
                      {t('purchases.receptions.expirationDate')}
                      {requireExpiryOnReception && <span className="text-error ml-0.5">*</span>}
                      {!requireExpiryOnReception && <span className="text-ink-muted/60 ml-1 font-normal">({t('common.optional')})</span>}
                    </label>
                    <input
                      type="date"
                      value={item.expirationDate}
                      onChange={(e) => handleItemChange(i, { expirationDate: e.target.value })}
                      disabled={isSaving}
                      className="pos-input text-xs"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="block text-xs text-ink-muted mb-0.5">
                      {t('purchases.receptions.unitCost')}
                    </label>
                    <input
                      type="number"
                      min={0}
                      step={100}
                      value={item.realUnitCost}
                      onChange={(e) => handleItemChange(i, { realUnitCost: Math.max(0, Number(e.target.value)) })}
                      disabled={isSaving}
                      className="pos-input text-xs font-data tabular-nums"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-ink-muted mb-0.5">
                      {t('purchases.receptions.taxRate')}
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={item.taxRate}
                      onChange={(e) => handleItemChange(i, { taxRate: Math.max(0, Math.min(100, Number(e.target.value))) })}
                      disabled={isSaving}
                      className="pos-input text-xs font-data tabular-nums"
                    />
                  </div>
                  <div className="flex flex-col justify-end">
                    <span className="text-xs text-ink-muted mb-0.5">
                      {t('purchases.receptions.subtotal')}
                    </span>
                    <span className="font-data tabular-nums text-sm font-semibold">
                      {formatCOP(item.receivedQuantity * item.realUnitCost)}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Total */}
      <div className="flex justify-end py-3 border-t border-border mt-4">
        <div className="text-right">
          <span className="text-xs text-ink-muted">{t('purchases.receptions.totalAmount')}: </span>
          <span className="text-sm font-bold font-data tabular-nums">{formatCOP(total)}</span>
        </div>
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-3 pt-3 border-t border-border">
        <button type="button" onClick={onCancel} disabled={isSaving} className="pos-button pos-button-secondary">
          {t('common.cancel')}
        </button>
        <button type="submit" disabled={isSaving || !data.supplierId} className="pos-button pos-button-primary">
          {isSaving ? t('common.saving') : t('purchases.receptions.createReception')}
        </button>
      </div>
    </form>
  );
};
