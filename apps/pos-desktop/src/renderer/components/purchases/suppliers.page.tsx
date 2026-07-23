/**
 * Suppliers page — manage supplier catalog.
 *
 * Thin wiring container: owns state, validation, service orchestration.
 * Presentational sub-components are imported from sibling files.
 *
 * @category Page
 */

import {
  type FC,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useAppDispatch } from '@/store/hooks';
import { navigateToPurchasesMain } from '@/store/slices/ui-slice';
import { useLocalSessionStore } from '../../../domain/auth/local-session.store';
import { useSuppliersService } from '../common/service-context';
import { useAsyncAction } from '../../hooks/use-async-action';
import type {
  SupplierSearchResult,
  CreateSupplierInput,
  UpdateSupplierInput,
} from '../../../domain/purchases';
import { SupplierIdentificationType } from '@pharmacy/database/local';

// ── Presentational components (implemented by frontend-pos) ─────────────
import { SupplierList } from './supplier-list';
import { SupplierForm } from './supplier-form';
import { SupplierSearchBar } from './supplier-search-bar';

// ── Types ───────────────────────────────────────────────────────────────

type FormMode = 'create' | 'edit';

export interface FormData {
  identificationType: SupplierIdentificationType;
  identificationNumber: string;
  businessName: string;
  contactName: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  country: string;
  paymentTermsDays: number;
  creditLimit: number;
}

const EMPTY_FORM: FormData = {
  identificationType: SupplierIdentificationType.NIT,
  identificationNumber: '',
  businessName: '',
  contactName: '',
  phone: '',
  email: '',
  address: '',
  city: '',
  country: 'Colombia',
  paymentTermsDays: 30,
  creditLimit: 0,
};

// ── Page component ──────────────────────────────────────────────────────

export const SuppliersPage: FC = () => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const suppliersService = useSuppliersService();

  // List state
  const [suppliers, setSuppliers] = useState<SupplierSearchResult[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const {
    isLoading,
    error: listError,
    run: runListLoad,
  } = useAsyncAction();

  // Form state
  const [showForm, setShowForm] = useState(false);
  const [formMode, setFormMode] = useState<FormMode>('create');
  const [editingSupplierId, setEditingSupplierId] = useState<string | null>(null);
  const [formData, setFormData] = useState<FormData>(EMPTY_FORM);
  const {
    isLoading: isSaving,
    error: saveError,
    run: runSave,
    reset: resetSave,
  } = useAsyncAction();

  // Confirmation dialog
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const {
    isLoading: isDeleting,
    error: deleteError,
    run: runDelete,
    reset: resetDelete,
  } = useAsyncAction();

  // ── Data loading ─────────────────────────────────────────────────────

  const loadSuppliers = useCallback(async (query?: string) => {
    const result = await runListLoad(async () => {
      return await suppliersService.searchSuppliers(query ?? '');
    });
    if (result.success) {
      setSuppliers(result.data);
    }
  }, [suppliersService, runListLoad]);

  useEffect(() => {
    loadSuppliers();
  }, [loadSuppliers]);

  // ── Search handler ────────────────────────────────────────────────────

  const handleSearch = useCallback(async (query: string) => {
    setSearchQuery(query);
    await loadSuppliers(query);
  }, [loadSuppliers]);

  // ── Create / Edit form handlers ───────────────────────────────────────

  const handleCreateClick = useCallback(() => {
    setFormMode('create');
    setEditingSupplierId(null);
    setFormData(EMPTY_FORM);
    resetSave();
    setShowForm(true);
  }, [resetSave]);

  const handleEditClick = useCallback(async (id: string) => {
    setFormMode('edit');
    setEditingSupplierId(id);
    const result = await runSave(async () => {
      const supplier = await suppliersService.getSupplier(id);
      return supplier;
    });
    if (result.success) {
      const supplier = result.data;
      setFormData({
        identificationType: supplier.identificationType as SupplierIdentificationType,
        identificationNumber: supplier.identificationNumber,
        businessName: supplier.businessName,
        contactName: supplier.contactName ?? '',
        phone: supplier.phone ?? '',
        email: supplier.email ?? '',
        address: supplier.address ?? '',
        city: supplier.city ?? '',
        country: supplier.country,
        paymentTermsDays: supplier.paymentTermsDays,
        creditLimit: Number(supplier.creditLimit),
      });
      setShowForm(true);
    }
  }, [suppliersService, runSave]);

  const handleFormChange = useCallback((partial: Partial<FormData>) => {
    setFormData((prev) => ({ ...prev, ...partial }));
  }, []);

  const handleFormSubmit = useCallback(async () => {
    const result = await runSave(async () => {
      if (formMode === 'create') {
        const input: CreateSupplierInput = {
          identificationType: formData.identificationType,
          identificationNumber: formData.identificationNumber,
          businessName: formData.businessName,
          contactName: formData.contactName || undefined,
          phone: formData.phone || undefined,
          email: formData.email || undefined,
          address: formData.address || undefined,
          city: formData.city || undefined,
          country: formData.country,
          paymentTermsDays: formData.paymentTermsDays,
          creditLimit: formData.creditLimit || undefined,
        };
        await suppliersService.createSupplier(input);
      } else if (editingSupplierId) {
        const input: UpdateSupplierInput = {
          identificationType: formData.identificationType,
          identificationNumber: formData.identificationNumber,
          businessName: formData.businessName,
          contactName: formData.contactName || null,
          phone: formData.phone || null,
          email: formData.email || null,
          address: formData.address || null,
          city: formData.city || null,
          country: formData.country,
          paymentTermsDays: formData.paymentTermsDays,
          creditLimit: formData.creditLimit || undefined,
        };
        await suppliersService.updateSupplier(editingSupplierId, input);
      }
    });
    if (result.success) {
      setShowForm(false);
      await loadSuppliers(searchQuery);
    }
  }, [formMode, formData, editingSupplierId, suppliersService, loadSuppliers, searchQuery, runSave]);

  const handleFormCancel = useCallback(() => {
    setShowForm(false);
    resetSave();
  }, [resetSave]);

  // ── Deactivate handler ────────────────────────────────────────────────

  const handleDeactivateConfirm = useCallback(async () => {
    if (!deletingId) return;
    const result = await runDelete(async () => {
      await suppliersService.deactivateSupplier(deletingId);
    });
    if (result.success) {
      setDeletingId(null);
      resetDelete();
      await loadSuppliers(searchQuery);
    }
  }, [deletingId, suppliersService, loadSuppliers, searchQuery, runDelete, resetDelete]);

  // ── Navigation ────────────────────────────────────────────────────────

  const handleBack = useCallback(() => {
    dispatch(navigateToPurchasesMain());
  }, [dispatch]);

  // ── Derived ───────────────────────────────────────────────────────────

  const session = useLocalSessionStore((s) => s.session);
  const canEdit = useMemo(() => {
    if (!session) return false;
    return ['INVENTORY_ASSISTANT', 'ADMIN', 'ACCOUNTANT', 'MANAGER', 'OWNER', 'SAAS_ADMIN'].includes(session.role);
  }, [session]);

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200">
        <div className="flex items-center gap-3">
          <button
            onClick={handleBack}
            className="text-gray-600 hover:text-gray-900"
            aria-label={t('common.back')}
          >
            ←
          </button>
          <h1 className="text-lg font-semibold">{t('purchases.suppliers.title')}</h1>
        </div>
        {canEdit && !showForm && (
          <button
            onClick={handleCreateClick}
            className="px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm"
          >
            + {t('purchases.suppliers.create')}
          </button>
        )}
      </div>

      {/* Search bar */}
      <SupplierSearchBar
        value={searchQuery}
        onChange={handleSearch}
        disabled={showForm}
      />

      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
        {showForm ? (
          <SupplierForm
            mode={formMode}
            data={formData}
            onChange={handleFormChange}
            onSubmit={handleFormSubmit}
            onCancel={handleFormCancel}
            isSaving={isSaving}
            error={saveError}
          />
        ) : listError ? (
          <div className="p-4 bg-red-50 text-red-700 rounded border border-red-200">
            {listError}
          </div>
        ) : (
          <SupplierList
            suppliers={suppliers}
            isLoading={isLoading}
            onEdit={canEdit ? handleEditClick : undefined}
            onDeactivate={canEdit ? setDeletingId : undefined}
          />
        )}
      </div>

      {/* Deactivate confirmation dialog */}
      {deletingId && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-sm w-full mx-4 shadow-xl">
            <h2 className="text-lg font-semibold mb-2">
              {t('purchases.suppliers.deactivateConfirm')}
            </h2>
            {deleteError && (
              <p className="text-red-600 text-sm mb-3">{deleteError}</p>
            )}
            <div className="flex justify-end gap-3 mt-4">
              <button
                onClick={() => { setDeletingId(null); resetDelete(); }}
                className="px-4 py-2 text-gray-600 hover:text-gray-900"
                disabled={isDeleting}
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={handleDeactivateConfirm}
                disabled={isDeleting}
                className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
              >
                {isDeleting ? t('common.processing') : t('common.confirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
