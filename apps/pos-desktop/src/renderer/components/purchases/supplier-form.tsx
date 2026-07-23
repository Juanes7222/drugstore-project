/**
 * SupplierForm — create/edit supplier form with validation.
 *
 * Renders all fields: identification type selector, identification number,
 * business name, contact, phone, email, address, city, country,
 * payment terms days, credit limit. Inline validation with error banners.
 *
 * All text via i18n — no hardcoded fallbacks.
 *
 * @category Component
 */

import {
  type FC,
  useCallback,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { X, Check, AlertTriangle } from 'lucide-react';
import type { SupplierIdentificationType } from '@pharmacy/database/local';
import type { FormData } from './suppliers.page';

export interface SupplierFormProps {
  mode: 'create' | 'edit';
  data: FormData;
  onChange: (partial: Partial<FormData>) => void;
  onSubmit: () => void;
  onCancel: () => void;
  isSaving: boolean;
  error: string | null;
}

export type { FormData } from './suppliers.page';

const ID_TYPE_OPTIONS: { value: SupplierIdentificationType; label: string }[] = [
  { value: 'NIT' as SupplierIdentificationType, label: 'NIT' },
  { value: 'CC' as SupplierIdentificationType, label: 'Cédula de Ciudadanía' },
  { value: 'CE' as SupplierIdentificationType, label: 'Cédula de Extranjería' },
];

export const SupplierForm: FC<SupplierFormProps> = ({
  mode,
  data,
  onChange,
  onSubmit,
  onCancel,
  isSaving,
  error,
}) => {
  const { t } = useTranslation();
  const [errors, setErrors] = useState<Record<string, string>>({});

  const validate = useCallback((): boolean => {
    const errs: Record<string, string> = {};
    if (!data.identificationNumber.trim()) {
      errs.identificationNumber = t('purchases.suppliers.validationIdRequired');
    }
    if (!data.businessName.trim()) {
      errs.businessName = t('purchases.suppliers.validationNameRequired');
    }
    if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
      errs.email = t('purchases.suppliers.validationEmailInvalid');
    }
    if (data.paymentTermsDays < 0) {
      errs.paymentTermsDays = t('purchases.suppliers.validationTermsInvalid');
    }
    if (data.creditLimit < 0) {
      errs.creditLimit = t('purchases.suppliers.validationCreditInvalid');
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }, [data, t]);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (validate()) onSubmit();
    },
    [validate, onSubmit],
  );

  const hasErrors = Object.keys(errors).length > 0;
  const FieldError = ({ field }: { field: string }) =>
    errors[field] ? (
      <p className="mt-0.5 text-xs text-error flex items-center gap-1" role="alert">
        <AlertTriangle size={10} aria-hidden="true" />
        {errors[field]}
      </p>
    ) : null;

  return (
    <form
      onSubmit={handleSubmit}
      className="max-w-2xl mx-auto"
      noValidate
    >
      {/* Server error banner */}
      {error && (
        <div className="mb-4 p-3 bg-error-container text-error rounded text-sm border border-error/20 flex items-center gap-2" role="alert">
          <AlertTriangle size={14} aria-hidden="true" />
          {error}
        </div>
      )}

      {/* Validation summary */}
      {hasErrors && (
        <div className="mb-4 p-3 bg-urgency-surface text-urgency rounded text-sm border border-urgency/20 flex items-center gap-2" role="alert">
          <AlertTriangle size={14} aria-hidden="true" />
          {Object.values(errors).join('. ')}
        </div>
      )}

      <div className="space-y-4">
        {/* Identification type + number */}
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label
              htmlFor="supplier-id-type"
              className="block text-sm font-medium text-ink mb-1"
            >
              {t('purchases.suppliers.identificationType')}
            </label>
            <select
              id="supplier-id-type"
              value={data.identificationType}
              onChange={(e) => onChange({ identificationType: e.target.value as SupplierIdentificationType })}
              disabled={isSaving}
              className="pos-input"
            >
              {ID_TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          <div className="col-span-2">
            <label
              htmlFor="supplier-id-number"
              className="block text-sm font-medium text-ink mb-1"
            >
              {t('purchases.suppliers.identificationNumber')}
              <span className="text-error ml-0.5">*</span>
            </label>
            <input
              id="supplier-id-number"
              type="text"
              value={data.identificationNumber}
              onChange={(e) => onChange({ identificationNumber: e.target.value })}
              disabled={isSaving}
              className={`pos-input ${errors.identificationNumber ? 'border-error' : ''}`}
              autoComplete="off"
            />
            <FieldError field="identificationNumber" />
          </div>
        </div>

        {/* Business name */}
        <div>
          <label
            htmlFor="supplier-business-name"
            className="block text-sm font-medium text-ink mb-1"
          >
            {t('purchases.suppliers.businessName')}
            <span className="text-error ml-0.5">*</span>
          </label>
          <input
            id="supplier-business-name"
            type="text"
            value={data.businessName}
            onChange={(e) => onChange({ businessName: e.target.value })}
            disabled={isSaving}
            className={`pos-input ${errors.businessName ? 'border-error' : ''}`}
            autoComplete="off"
          />
          <FieldError field="businessName" />
        </div>

        {/* Contact name + Phone */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label
              htmlFor="supplier-contact"
              className="block text-sm font-medium text-ink mb-1"
            >
              {t('purchases.suppliers.contactName')}
            </label>
            <input
              id="supplier-contact"
              type="text"
              value={data.contactName}
              onChange={(e) => onChange({ contactName: e.target.value })}
              disabled={isSaving}
              className="pos-input"
              autoComplete="off"
            />
          </div>
          <div>
            <label
              htmlFor="supplier-phone"
              className="block text-sm font-medium text-ink mb-1"
            >
              {t('purchases.suppliers.phone')}
            </label>
            <input
              id="supplier-phone"
              type="text"
              value={data.phone}
              onChange={(e) => onChange({ phone: e.target.value })}
              disabled={isSaving}
              className="pos-input"
              autoComplete="off"
            />
          </div>
        </div>

        {/* Email */}
        <div>
          <label
            htmlFor="supplier-email"
            className="block text-sm font-medium text-ink mb-1"
          >
            {t('purchases.suppliers.email')}
          </label>
          <input
            id="supplier-email"
            type="email"
            value={data.email}
            onChange={(e) => onChange({ email: e.target.value })}
            disabled={isSaving}
            className={`pos-input ${errors.email ? 'border-error' : ''}`}
            autoComplete="off"
          />
          <FieldError field="email" />
        </div>

        {/* Address */}
        <div>
          <label
            htmlFor="supplier-address"
            className="block text-sm font-medium text-ink mb-1"
          >
            {t('purchases.suppliers.address')}
          </label>
          <input
            id="supplier-address"
            type="text"
            value={data.address}
            onChange={(e) => onChange({ address: e.target.value })}
            disabled={isSaving}
            className="pos-input"
            autoComplete="off"
          />
        </div>

        {/* City + Country */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label
              htmlFor="supplier-city"
              className="block text-sm font-medium text-ink mb-1"
            >
              {t('purchases.suppliers.city')}
            </label>
            <input
              id="supplier-city"
              type="text"
              value={data.city}
              onChange={(e) => onChange({ city: e.target.value })}
              disabled={isSaving}
              className="pos-input"
              autoComplete="off"
            />
          </div>
          <div>
            <label
              htmlFor="supplier-country"
              className="block text-sm font-medium text-ink mb-1"
            >
              {t('purchases.suppliers.country')}
            </label>
            <input
              id="supplier-country"
              type="text"
              value={data.country}
              onChange={(e) => onChange({ country: e.target.value })}
              disabled={isSaving}
              className="pos-input"
              autoComplete="off"
            />
          </div>
        </div>

        {/* Payment terms + Credit limit */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label
              htmlFor="supplier-payment-terms"
              className="block text-sm font-medium text-ink mb-1"
            >
              {t('purchases.suppliers.paymentTermsDays')}
            </label>
            <input
              id="supplier-payment-terms"
              type="number"
              min={0}
              value={data.paymentTermsDays}
              onChange={(e) => onChange({ paymentTermsDays: Number(e.target.value) })}
              disabled={isSaving}
              className={`pos-input font-data tabular-nums ${errors.paymentTermsDays ? 'border-error' : ''}`}
            />
            <FieldError field="paymentTermsDays" />
          </div>
          <div>
            <label
              htmlFor="supplier-credit-limit"
              className="block text-sm font-medium text-ink mb-1"
            >
              {t('purchases.suppliers.creditLimit')}
            </label>
            <input
              id="supplier-credit-limit"
              type="number"
              min={0}
              step={1000}
              value={data.creditLimit}
              onChange={(e) => onChange({ creditLimit: Number(e.target.value) })}
              disabled={isSaving}
              className={`pos-input font-data tabular-nums ${errors.creditLimit ? 'border-error' : ''}`}
            />
            <FieldError field="creditLimit" />
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-border">
        <button
          type="button"
          onClick={onCancel}
          disabled={isSaving}
          className="pos-button pos-button-secondary"
        >
          <X size={14} aria-hidden="true" />
          {t('common.cancel')}
        </button>
        <button
          type="submit"
          disabled={isSaving}
          className="pos-button pos-button-primary"
        >
          <Check size={14} aria-hidden="true" />
          {isSaving
            ? t('common.saving')
            : mode === 'create'
              ? t('common.create')
              : t('common.save')}
        </button>
      </div>
    </form>
  );
};
