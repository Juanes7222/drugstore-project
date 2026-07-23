/**
 * SupplierReturnForm — create return form with supplier selector,
 * reception reference, reason, and items editor (product, lot, quantity).
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
import { Plus, Trash2 } from 'lucide-react';
import type { CreateSupplierReturnInput } from '../../../domain/purchases';
import { SearchableSelect, type SearchableSelectOption } from './searchable-select';

export interface SupplierReturnFormProps {
  data: CreateSupplierReturnInput;
  onChange: (partial: Partial<CreateSupplierReturnInput>) => void;
  onSubmit: () => void;
  onCancel: () => void;
  isSaving: boolean;
  error: string | null;
  // Supplier search
  suppliers: SearchableSelectOption[];
  onSupplierSearch: (query: string) => void;
  isSearchingSupplier?: boolean;
  // Reception reference search
  receptions: SearchableSelectOption[];
  onReceptionSearch: (query: string) => void;
  isSearchingReception?: boolean;
  // Product search for items
  productResults: SearchableSelectOption[];
  onProductSearch: (query: string) => void;
  isSearchingProduct?: boolean;
}

interface ReturnFormItem {
  productId: string;
  lotId: string;
  quantity: number;
}

export const SupplierReturnForm: FC<SupplierReturnFormProps> = ({
  data,
  onChange,
  onSubmit,
  onCancel,
  isSaving,
  error,
  suppliers,
  onSupplierSearch,
  isSearchingSupplier = false,
  receptions,
  onReceptionSearch,
  isSearchingReception = false,
  productResults,
  onProductSearch,
  isSearchingProduct = false,
}) => {
  const { t } = useTranslation();

  // Local items state
  const [items, setItems] = useState<ReturnFormItem[]>(
    (data.items as any[]).map((item: any) => ({
      productId: item.productId ?? '',
      lotId: item.lotId ?? '',
      quantity: item.quantity ?? 1,
    })),
  );

  const syncItemsToParent = useCallback(
    (updatedItems: ReturnFormItem[]) => {
      onChange({ items: updatedItems as any });
    },
    [onChange],
  );

  const handleAddItem = useCallback(() => {
    const newItems = [...items, { productId: '', lotId: '', quantity: 1 }];
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
    (index: number, partial: Partial<ReturnFormItem>) => {
      const newItems = items.map((item, i) =>
        i === index ? { ...item, ...partial } : item,
      );
      setItems(newItems);
      syncItemsToParent(newItems);
    },
    [items, syncItemsToParent],
  );

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      onSubmit();
    },
    [onSubmit],
  );

  const totalQty = useMemo(() => items.reduce((sum, item) => sum + item.quantity, 0), [items]);

  return (
    <form onSubmit={handleSubmit} className="max-w-3xl mx-auto flex flex-col h-full" noValidate>
      {/* Error banner */}
      {error && (
        <div className="mb-4 p-3 bg-red-50 text-red-700 rounded text-sm border border-red-200" role="alert">
          {error}
        </div>
      )}

      {/* Supplier */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {t('purchases.supplierReturns.supplierId')}
          <span className="text-red-500 ml-0.5">*</span>
        </label>
        <SearchableSelect
          options={suppliers}
          onSearch={onSupplierSearch}
          onSelect={(opt) => onChange({ supplierId: opt.id })}
          selectedId={data.supplierId}
          placeholder={t('purchases.supplierReturns.searchSupplier')}
          disabled={isSaving}
          isLoading={isSearchingSupplier}
        />
      </div>

      {/* Reception reference */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {t('purchases.supplierReturns.receptionRef')}
        </label>
        <SearchableSelect
          options={receptions}
          onSearch={onReceptionSearch}
          onSelect={(opt) => onChange({ purchaseReceptionId: opt.id })}
          selectedId={data.purchaseReceptionId ?? null}
          placeholder={t('purchases.supplierReturns.searchReception')}
          disabled={isSaving}
          isLoading={isSearchingReception}
        />
      </div>

      {/* Reason */}
      <div className="mb-4">
        <label
          htmlFor="return-reason"
          className="block text-sm font-medium text-gray-700 mb-1"
        >
          {t('purchases.supplierReturns.reason')}
        </label>
        <textarea
          id="return-reason"
          value={data.reason}
          onChange={(e) => onChange({ reason: e.target.value })}
          disabled={isSaving}
          className="pos-input resize-none"
          rows={2}
          placeholder={t('purchases.supplierReturns.reasonPlaceholder')}
        />
      </div>

      {/* Items */}
      <div className="flex-1 min-h-0">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-gray-700">
            {t('purchases.supplierReturns.items')}
          </span>
          <button
            type="button"
            onClick={handleAddItem}
            disabled={isSaving || !data.supplierId}
            className="inline-flex items-center gap-1 text-xs px-2 py-1 bg-pharma/10 text-pharma rounded hover:bg-pharma/20 transition-colors font-semibold"
          >
            <Plus size={14} aria-hidden="true" />
            {t('purchases.supplierReturns.addItem')}
          </button>
        </div>

        {items.length === 0 ? (
          <p className="text-sm text-gray-400 italic py-4 text-center">
            {t('purchases.supplierReturns.noItems')}
          </p>
        ) : (
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {items.map((item, i) => (
              <div key={i} className="flex gap-2 items-start p-2 bg-gray-50 rounded">
                <div className="flex-1 min-w-0">
                  <SearchableSelect
                    options={productResults}
                    onSearch={onProductSearch}
                    onSelect={(opt) => handleItemChange(i, { productId: opt.id })}
                    selectedId={item.productId}
                    placeholder={t('purchases.supplierReturns.productId')}
                    disabled={isSaving}
                    isLoading={isSearchingProduct}
                  />
                </div>
                <div className="w-32 shrink-0">
                  <input
                    placeholder={t('purchases.supplierReturns.lotId')}
                    value={item.lotId}
                    onChange={(e) => handleItemChange(i, { lotId: e.target.value })}
                    disabled={isSaving}
                    className="pos-input text-xs font-data tabular-nums"
                    autoComplete="off"
                    aria-label={t('purchases.supplierReturns.lotId')}
                  />
                </div>
                <div className="w-20 shrink-0">
                  <input
                    type="number"
                    min={1}
                    value={item.quantity}
                    onChange={(e) => handleItemChange(i, { quantity: Math.max(1, Number(e.target.value)) })}
                    disabled={isSaving}
                    className="pos-input text-xs font-data tabular-nums"
                    aria-label={t('purchases.supplierReturns.qty')}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => handleRemoveItem(i)}
                  disabled={isSaving}
                  className="pt-1 text-red-400 hover:text-red-600 transition-colors shrink-0"
                  aria-label={t('common.remove')}
                >
                  <Trash2 size={14} aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Summary */}
      <div className="flex justify-between items-center py-3 border-t border-gray-100 mt-4">
        <span className="text-xs text-gray-500">
          {items.length} {t('purchases.supplierReturns.itemsCount')} · {totalQty} {t('purchases.supplierReturns.unitsCount')}
        </span>
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-3 pt-3 border-t border-gray-100">
        <button type="button" onClick={onCancel} disabled={isSaving} className="pos-button pos-button-secondary">
          {t('common.cancel')}
        </button>
        <button type="submit" disabled={isSaving || !data.supplierId} className="pos-button pos-button-primary">
          {isSaving ? t('common.saving') : t('purchases.supplierReturns.createReturn')}
        </button>
      </div>
    </form>
  );
};
