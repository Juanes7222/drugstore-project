// ---------------------------------------------------------------------------
// Zod schemas for tenant-config update payloads.
// Promotion candidate to @pharmacy/shared-validation once frontend form needs
// the same shapes.
// ---------------------------------------------------------------------------

import { z } from 'zod';

// --- Strictness sub-schemas ---

export const StrictnessConfigSchema = z.object({
  lots: z.enum(['STRICT', 'OPTIONAL', 'OFF']),
  expiryDates: z.enum(['STRICT', 'OPTIONAL', 'OFF']),
  stockValidation: z.enum(['STRICT', 'WARN', 'OFF']),
  clientRequired: z.enum(['ALWAYS', 'ABOVE_AMOUNT', 'NEVER']),
  clientRequiredThreshold: z.number().min(0),
  prescriptionEnforcement: z.enum(['STRICT', 'WARN', 'OFF']),
  inventoryAdjustmentReason: z.enum(['REQUIRED', 'OPTIONAL']),
  returnsRequireOriginalSale: z.enum(['STRICT', 'WITH_MANAGER_AUTH', 'OFF']),
  cashShiftRequired: z.boolean(),
  receiptPrintRequired: z.enum(['STRICT', 'OPTIONAL', 'OFF']),
  autoOpenDrawer: z.enum(['ALWAYS', 'CASH_ONLY', 'MANUAL']),
  customerDisplayRequired: z.boolean(),
  prescriptionExpiryDays: z.number().int().min(0),
});

export const SessionIdleTimeoutsSchema = z.object({
  cashier: z.number().int().min(0),
  manager: z.number().int().min(0),
  owner: z.number().int().min(0),
});

export const WorkflowConfigSchema = z.object({
  defaultPaymentMethodId: z.string().nullable(),
  autoPrintOnConfirm: z.boolean(),
  autoOpenDrawerOnConfirm: z.enum(['ALWAYS', 'CASH_ONLY', 'NEVER']),
  printDuplicateReceipt: z.boolean(),
  requireShiftOpenForSale: z.boolean(),
  maxOfflineLoginDays: z.number().int().min(0),
  sessionIdleTimeoutSeconds: z.number().int().min(0),
  sessionIdleTimeouts: SessionIdleTimeoutsSchema,
  suggestionEngineEnabled: z.boolean(),
  autoReprintLastReceiptOnReprint: z.boolean(),
});

export const AdditionalTaxSchema = z.object({
  name: z.string().min(1, 'Tax name is required'),
  rate: z.number().min(0).max(100),
  type: z.enum(['RETE_FUENTE', 'ICA', 'OTHER']),
});

export const FiscalConfigSchema = z.object({
  companyName: z.string(),
  nit: z.string(),
  address: z.string(),
  city: z.string(),
  phone: z.string(),
  email: z.string(),
  logoPath: z.string().nullable(),
  taxRegime: z.enum(['RESPONSABLE_IVA', 'NO_RESPONSABLE', 'SIMPLE', 'EXENTO']),
  defaultTaxRate: z.number().min(0).max(100),
  additionalTaxes: z.array(AdditionalTaxSchema),
  invoiceHeader: z.string(),
  invoiceFooter: z.string(),
  dianResolutionNumber: z.string(),
  dianResolutionDate: z.string(),
  dianResolutionPrefix: z.string(),
  dianTechnicalKey: z.string(),
  invoiceNumberFormat: z.string(),
  showLogoOnReceipt: z.boolean(),
  showQrOnReceipt: z.boolean(),
  qrContent: z.enum(['INVOICE_URL', 'CUFE_AND_TOTAL', 'CUSTOM']),
  qrCustomContent: z.string().nullable(),
});

// --- Main update schema ---
//
// All sections are optional and within each section ALL fields are
// optional — the POS sends partial updates (only the fields that
// changed, not the entire section). The service deep-merges the payload
// with the current config from the database before persisting.
//
// Example payload:
//   { fiscal: { companyName: "Mi Farmacia" }, expectedConfigVersion: 3 }
//   → only companyName was changed, server merges it with DB values.

export const UpdateTenantConfigSchema = z.object({
  strictness: StrictnessConfigSchema.partial().optional(),
  fiscal: FiscalConfigSchema.partial().optional(),
  workflow: WorkflowConfigSchema.partial().optional(),
  expectedConfigVersion: z.number().int().min(0),
});

export type UpdateTenantConfigInput = z.infer<typeof UpdateTenantConfigSchema>;

// --- Preset application ---

export const ApplyPresetSchema = z.object({
  presetCode: z.enum(['SIMPLE', 'BALANCED', 'STRICT']),
});

export type ApplyPresetInput = z.infer<typeof ApplyPresetSchema>;

// --- Named preset ---

export const CreateNamedPresetSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  isShared: z.boolean().default(false),
});

export type CreateNamedPresetInput = z.infer<typeof CreateNamedPresetSchema>;

export const UpdateNamedPresetSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  isShared: z.boolean().optional(),
});

export type UpdateNamedPresetInput = z.infer<typeof UpdateNamedPresetSchema>;

// --- Custom company field ---

export const CustomCompanyFieldTypeEnum = z.enum(['TEXT', 'NUMBER', 'DATE', 'URL', 'EMAIL']);

export const AddCustomFieldSchema = z.object({
  id: z.string().optional(), // server-generated if omitted
  name: z.string().min(1, 'Field name is required'),
  key: z.string().min(1).max(100),
  type: CustomCompanyFieldTypeEnum,
  value: z.union([z.string(), z.number(), z.date()]),
  required: z.boolean().default(false),
  showOnInvoice: z.boolean().default(false),
  showOnReport: z.boolean().default(false),
  order: z.number().int().min(0).default(0),
});

export type AddCustomFieldInput = z.infer<typeof AddCustomFieldSchema>;

export const UpdateCustomFieldSchema = z.object({
  name: z.string().min(1).optional(),
  type: CustomCompanyFieldTypeEnum.optional(),
  value: z.union([z.string(), z.number(), z.date()]).optional(),
  required: z.boolean().optional(),
  showOnInvoice: z.boolean().optional(),
  showOnReport: z.boolean().optional(),
  order: z.number().int().min(0).optional(),
});

export type UpdateCustomFieldInput = z.infer<typeof UpdateCustomFieldSchema>;

// --- Custom strictness toggle ---

export const CustomToggleTypeEnum = z.enum(['BOOLEAN', 'SELECT', 'AMOUNT']);
export const CustomToggleAppliesToEnum = z.enum(['SALE', 'RETURN', 'INVENTORY', 'CLIENT', 'ALL']);

export const CustomToggleOptionSchema = z.object({
  label: z.string().min(1),
  value: z.string().min(1),
});

export const AddCustomToggleSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1, 'Toggle name is required'),
  key: z.string().min(1).max(100),
  description: z.string().default(''),
  type: CustomToggleTypeEnum,
  defaultValue: z.union([z.boolean(), z.string(), z.number()]),
  options: z.array(CustomToggleOptionSchema).optional(),
  appliesTo: CustomToggleAppliesToEnum,
  isAdvisory: z.boolean().default(false),
});

export type AddCustomToggleInput = z.infer<typeof AddCustomToggleSchema>;

export const UpdateCustomToggleSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  type: CustomToggleTypeEnum.optional(),
  defaultValue: z.union([z.boolean(), z.string(), z.number()]).optional(),
  options: z.array(CustomToggleOptionSchema).optional(),
  appliesTo: CustomToggleAppliesToEnum.optional(),
  isAdvisory: z.boolean().optional(),
});

export type UpdateCustomToggleInput = z.infer<typeof UpdateCustomToggleSchema>;
