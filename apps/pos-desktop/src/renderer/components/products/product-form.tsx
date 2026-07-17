/**
 * ProductForm — modal/panel form for creating and editing products.
 *
 * Renders sections for basic info, barcodes, price/tax, and optional fields.
 * Supports both "create" and "edit" modes.
 */
import {
  type FC,
  useCallback,
  useEffect,
  useReducer,
} from "react";
import { useTranslation } from "react-i18next";
import type {
  ProductFormMode,
  ProductFormData,
  DisplayProduct,
  CategoryOption,
  PharmaceuticalFormOption,
  TaxSchemeOption,
  DisplayBarcode,
  ProductFormFieldRequirements,
} from "./products.types";
import { StarIcon, SparklesIcon } from "../ui/icons";

// ── Constants ────────────────────────────────────────────────────────────

const BARCODE_TYPES = [
  "EAN13",
  "EAN14",
  "GTIN",
  "INTERNAL",
  "DATAMATRIX",
] as const;

const SALE_TYPES = [
  "OTC",
  "PRESCRIPTION",
  "CONTROLLED",
  "EXEMPT",
  "BIOLOGIC",
  "HOSPITAL",
] as const;

const CONCENTRATION_UNITS = [
  "mg",
  "g",
  "mcg",
  "mL",
  "UI",
  "%",
  "mg/mL",
  "mg/g",
] as const;

// ── State management ─────────────────────────────────────────────────────

interface FormState {
  commercialName: string;
  genericName: string;
  activePrinciple: string;
  concentration: string;
  concentrationUnit: string;
  laboratory: string;
  saleType: string;
  minimumStock: number;
  invimaRegistry: string;
  atcCode: string;
  therapeuticIndication: string;
  storageConditions: string;
  internalNotes: string;
  categoryId: string;
  pharmaceuticalFormId: string;
  barcodes: DisplayBarcode[];
  price: string;
  taxSchemeId: string;
  errors: Record<string, string>;
}

type FormAction =
  | { type: "SET_FIELD"; field: keyof ProductFormData; value: string }
  | { type: "SET_NUMBER"; field: "minimumStock"; value: number }
  | { type: "SET_BARCODES"; barcodes: DisplayBarcode[] }
  | { type: "ADD_BARCODE" }
  | { type: "REMOVE_BARCODE"; index: number }
  | { type: "UPDATE_BARCODE"; index: number; field: keyof DisplayBarcode; value: string | boolean }
  | { type: "SET_ERRORS"; errors: Record<string, string> }
  | { type: "RESET" };

const emptyFormData = (): FormState => ({
  commercialName: "",
  genericName: "",
  activePrinciple: "",
  concentration: "",
  concentrationUnit: "mg",
  laboratory: "",
  saleType: "OTC",
  minimumStock: 0,
  invimaRegistry: "",
  atcCode: "",
  therapeuticIndication: "",
  storageConditions: "",
  internalNotes: "",
  categoryId: "",
  pharmaceuticalFormId: "",
  barcodes: [{ barcode: "", barcodeType: "EAN13", isPrimary: true }],
  price: "",
  taxSchemeId: "",
  errors: {},
});

const formReducer = (state: FormState, action: FormAction): FormState => {
  switch (action.type) {
    case "SET_FIELD":
      return { ...state, [action.field]: action.value, errors: { ...state.errors, [action.field]: "" } };
    case "SET_NUMBER":
      return { ...state, minimumStock: action.value, errors: { ...state.errors, minimumStock: "" } };
    case "SET_BARCODES":
      return { ...state, barcodes: action.barcodes };
    case "ADD_BARCODE":
      return {
        ...state,
        barcodes: [
          ...state.barcodes,
          { barcode: "", barcodeType: "EAN13", isPrimary: false },
        ],
      };
    case "REMOVE_BARCODE":
      return {
        ...state,
        barcodes: state.barcodes.filter((_, i) => i !== action.index),
      };
    case "UPDATE_BARCODE":
      return {
        ...state,
        barcodes: state.barcodes.map((bc, i) =>
          i === action.index ? { ...bc, [action.field]: action.value } : bc,
        ),
      };
    case "SET_ERRORS":
      return { ...state, errors: action.errors };
    case "RESET":
      return emptyFormData();
    default:
      return state;
  }
};

// ── Validation ───────────────────────────────────────────────────────────

const validateForm = (
  state: FormState,
  taxSchemesCount: number,
): Record<string, string> => {
  const errors: Record<string, string> = {};
  if (!state.commercialName.trim()) errors.commercialName = "required";
  if (!state.genericName.trim()) errors.genericName = "required";
  if (!state.activePrinciple.trim()) errors.activePrinciple = "required";
  if (!state.laboratory.trim()) errors.laboratory = "required";
  if (!state.price.trim() || Number(state.price) <= 0)
    errors.price = "required";
  // Tax scheme is required only when options are available.
  if (taxSchemesCount > 0 && !state.taxSchemeId.trim()) {
    errors.taxSchemeId = "required";
  }

  const hasPrimaryBarcode = state.barcodes.some((bc) => bc.isPrimary && bc.barcode.trim());
  if (!hasPrimaryBarcode) errors.barcodes = "primary_required";

  return errors;
};

// ── Props ────────────────────────────────────────────────────────────────

interface ProductFormProps {
  mode: ProductFormMode;
  product: DisplayProduct | null;
  categories: CategoryOption[];
  pharmaceuticalForms: PharmaceuticalFormOption[];
  taxSchemes: TaxSchemeOption[];
  /** If set, auto-selects this tax scheme when creating a new product. */
  defaultTaxSchemeId?: string;
  /** Default sale type when prescription enforcement is strict ("PRESCRIPTION"). */
  defaultSaleType?: string;
  /** Per-field visibility driven by the tenant's StrictnessConfig. */
  fieldRequirements: ProductFormFieldRequirements;
  isProcessing: boolean;
  /** Error message to display inside the form panel (e.g., permission errors). */
  error?: string | null;
  onSave: (data: ProductFormData) => void;
  onCancel: () => void;
}

// ── Component ────────────────────────────────────────────────────────────

export const ProductForm: FC<ProductFormProps> = ({
  mode,
  product,
  categories,
  pharmaceuticalForms,
  taxSchemes,
  defaultTaxSchemeId,
  defaultSaleType,
  fieldRequirements,
  isProcessing,
  error,
  onSave,
  onCancel,
}) => {
  const { t } = useTranslation();

  const [state, dispatch] = useReducer(formReducer, null, emptyFormData);

  // Populate form when editing an existing product
  useEffect(() => {
    if (mode === "edit" && product) {
      dispatch({
        type: "SET_FIELD",
        field: "commercialName",
        value: product.commercialName,
      });
      dispatch({ type: "SET_FIELD", field: "genericName", value: product.genericName });
      dispatch({ type: "SET_FIELD", field: "activePrinciple", value: product.activePrinciple });
      dispatch({ type: "SET_FIELD", field: "concentration", value: product.concentration ?? "" });
      dispatch({ type: "SET_FIELD", field: "concentrationUnit", value: product.concentrationUnit ?? "mg" });
      dispatch({ type: "SET_FIELD", field: "laboratory", value: product.laboratory });
      dispatch({ type: "SET_FIELD", field: "saleType", value: product.saleType });
      dispatch({ type: "SET_NUMBER", field: "minimumStock", value: product.minimumStock });
      dispatch({ type: "SET_FIELD", field: "invimaRegistry", value: product.invimaRegistry ?? "" });
      dispatch({ type: "SET_FIELD", field: "atcCode", value: product.atcCode ?? "" });
      dispatch({ type: "SET_FIELD", field: "categoryId", value: product.categoryId ?? "" });
      dispatch({ type: "SET_FIELD", field: "pharmaceuticalFormId", value: product.pharmaceuticalFormId ?? "" });
      dispatch({
        type: "SET_BARCODES",
        barcodes: product.barcodes.map((bc) => ({
          barcode: bc.barcode,
          barcodeType: bc.barcodeType as DisplayBarcode["barcodeType"],
          isPrimary: bc.isPrimary,
        })),
      });
      if (product.currentPrice) {
        dispatch({ type: "SET_FIELD", field: "price", value: product.currentPrice });
      }
    } else {
      dispatch({ type: "RESET" });
    }
  }, [mode, product]);

  // Auto-select the default tax scheme when creating a new product
  useEffect(() => {
    if (mode === "create" && defaultTaxSchemeId) {
      dispatch({
        type: "SET_FIELD",
        field: "taxSchemeId",
        value: defaultTaxSchemeId,
      });
    }
  }, [mode, defaultTaxSchemeId]);

  // Auto-select the default sale type when creating a new product
  useEffect(() => {
    if (mode === "create" && defaultSaleType && defaultSaleType !== "OTC") {
      dispatch({
        type: "SET_FIELD",
        field: "saleType",
        value: defaultSaleType,
      });
    }
  }, [mode, defaultSaleType]);

  const handleSubmit = useCallback(() => {
    const errors = validateForm(state, taxSchemes.length);
    if (Object.keys(errors).length > 0) {
      dispatch({ type: "SET_ERRORS", errors });
      return;
    }

    onSave({
      commercialName: state.commercialName.trim(),
      genericName: state.genericName.trim(),
      activePrinciple: state.activePrinciple.trim(),
      concentration: state.concentration.trim(),
      concentrationUnit: state.concentrationUnit,
      laboratory: state.laboratory.trim(),
      saleType: state.saleType,
      minimumStock: state.minimumStock,
      invimaRegistry: state.invimaRegistry.trim(),
      atcCode: state.atcCode.trim(),
      therapeuticIndication: state.therapeuticIndication.trim(),
      storageConditions: state.storageConditions.trim(),
      internalNotes: state.internalNotes.trim(),
      categoryId: state.categoryId,
      pharmaceuticalFormId: state.pharmaceuticalFormId,
      barcodes: state.barcodes.map((bc) => ({
        ...bc,
        barcode: bc.barcode.trim(),
      })),
      price: state.price,
      taxSchemeId: state.taxSchemeId,
    });
  }, [state, onSave]);

  const fieldError = (field: string): string | undefined => state.errors[field];

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div
      className="flex h-full flex-col overflow-hidden"
      role="dialog"
      aria-label={
        mode === "create"
          ? t("products.create_title")
          : t("products.edit_title")
      }
      aria-modal="true"
    >
      {/* Error banner */}
      {error && (
        <div
          className="mx-pos-xl mt-pos-md rounded-pos px-pos-md py-pos-sm text-body-sm font-medium"
          style={{
            backgroundColor:
              "color-mix(in srgb, #D32F2F 10%, transparent)",
            color: "#D32F2F",
            border:
              "1px solid color-mix(in srgb, #D32F2F 20%, transparent)",
          }}
          role="alert"
        >
          {error}
        </div>
      )}

      {/* Form header */}
      <div
        className="flex items-center justify-between px-pos-xl py-pos-lg"
        style={{
          borderBottom:
            "1px solid color-mix(in srgb, var(--color-ink) 8%, transparent)",
        }}
      >
        <h2
          className="text-ui font-semibold"
          style={{ color: "var(--color-ink)" }}
        >
          {mode === "create"
            ? t("products.create_title")
            : t("products.edit_title")}
        </h2>
        <button
          type="button"
          onClick={onCancel}
          className="pos-button pos-button-secondary px-pos-sm py-pos-xs"
          aria-label={t("common.cancel")}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Scrollable form body */}
      <div className="flex-1 overflow-y-auto px-pos-xl py-pos-lg">
        <div className="mx-auto max-w-2xl space-y-pos-lg">
          {/* ── Basic Information ────────────────────────────────────── */}
          <section>
            <h3
              className="mb-pos-md text-body-sm font-semibold uppercase tracking-wider"
              style={{
                color:
                  "color-mix(in srgb, var(--color-ink) 60%, transparent)",
              }}
            >
              {t("products.section_basic_info")}
            </h3>
            <div className="space-y-pos-md">
              {/* Commercial name */}
              <div>
                <label
                  htmlFor="pf-commercial-name"
                  className="mb-pos-xs block text-body-sm font-medium"
                  style={{ color: "var(--color-ink)" }}
                >
                  {t("products.commercial_name")} *
                </label>
                <input
                  id="pf-commercial-name"
                  type="text"
                  value={state.commercialName}
                  onChange={(e) =>
                    dispatch({
                      type: "SET_FIELD",
                      field: "commercialName",
                      value: e.target.value,
                    })
                  }
                  disabled={isProcessing}
                  className={`pos-input w-full ${fieldError("commercialName") ? "border-red-500" : ""}`}
                />
                {fieldError("commercialName") && (
                  <p className="mt-pos-xs text-caption text-red-500">
                    {t("products.field_required")}
                  </p>
                )}
              </div>

              {/* Generic name */}
              <div>
                <label
                  htmlFor="pf-generic-name"
                  className="mb-pos-xs block text-body-sm font-medium"
                  style={{ color: "var(--color-ink)" }}
                >
                  {t("products.generic_name")} *
                </label>
                <input
                  id="pf-generic-name"
                  type="text"
                  value={state.genericName}
                  onChange={(e) =>
                    dispatch({
                      type: "SET_FIELD",
                      field: "genericName",
                      value: e.target.value,
                    })
                  }
                  disabled={isProcessing}
                  className={`pos-input w-full ${fieldError("genericName") ? "border-red-500" : ""}`}
                />
                {fieldError("genericName") && (
                  <p className="mt-pos-xs text-caption text-red-500">
                    {t("products.field_required")}
                  </p>
                )}
              </div>

              {/* Active principle */}
              <div>
                <label
                  htmlFor="pf-active-principle"
                  className="mb-pos-xs block text-body-sm font-medium"
                  style={{ color: "var(--color-ink)" }}
                >
                  {t("products.active_principle")} *
                </label>
                <input
                  id="pf-active-principle"
                  type="text"
                  value={state.activePrinciple}
                  onChange={(e) =>
                    dispatch({
                      type: "SET_FIELD",
                      field: "activePrinciple",
                      value: e.target.value,
                    })
                  }
                  disabled={isProcessing}
                  className={`pos-input w-full ${fieldError("activePrinciple") ? "border-red-500" : ""}`}
                />
                {fieldError("activePrinciple") && (
                  <p className="mt-pos-xs text-caption text-red-500">
                    {t("products.field_required")}
                  </p>
                )}
              </div>

              {/* Concentration + Unit */}
              <div className="flex gap-pos-md">
                <div className="flex-1">
                  <label
                    htmlFor="pf-concentration"
                    className="mb-pos-xs block text-body-sm font-medium"
                    style={{ color: "var(--color-ink)" }}
                  >
                    {t("products.concentration")}
                  </label>
                  <input
                    id="pf-concentration"
                    type="text"
                    value={state.concentration}
                    onChange={(e) =>
                      dispatch({
                        type: "SET_FIELD",
                        field: "concentration",
                        value: e.target.value,
                      })
                    }
                    disabled={isProcessing}
                    className="pos-input w-full"
                  />
                </div>
                <div className="w-28">
                  <label
                    htmlFor="pf-concentration-unit"
                    className="mb-pos-xs block text-body-sm font-medium"
                    style={{ color: "var(--color-ink)" }}
                  >
                    {t("products.concentration_unit")}
                  </label>
                  <select
                    id="pf-concentration-unit"
                    value={state.concentrationUnit}
                    onChange={(e) =>
                      dispatch({
                        type: "SET_FIELD",
                        field: "concentrationUnit",
                        value: e.target.value,
                      })
                    }
                    disabled={isProcessing}
                    className="pos-input w-full"
                  >
                    {CONCENTRATION_UNITS.map((unit) => (
                      <option key={unit} value={unit}>
                        {unit}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Laboratory */}
              <div>
                <label
                  htmlFor="pf-laboratory"
                  className="mb-pos-xs block text-body-sm font-medium"
                  style={{ color: "var(--color-ink)" }}
                >
                  {t("products.laboratory")} *
                </label>
                <input
                  id="pf-laboratory"
                  type="text"
                  value={state.laboratory}
                  onChange={(e) =>
                    dispatch({
                      type: "SET_FIELD",
                      field: "laboratory",
                      value: e.target.value,
                    })
                  }
                  disabled={isProcessing}
                  className={`pos-input w-full ${fieldError("laboratory") ? "border-red-500" : ""}`}
                />
                {fieldError("laboratory") && (
                  <p className="mt-pos-xs text-caption text-red-500">
                    {t("products.field_required")}
                  </p>
                )}
              </div>

              {/* Sale type */}
              <div>
                <label
                  htmlFor="pf-sale-type"
                  className="mb-pos-xs flex items-center gap-pos-xs text-body-sm font-medium"
                  style={{ color: "var(--color-ink)" }}
                >
                  <span>{t("products.sale_type")}</span>
                  {defaultSaleType && defaultSaleType !== "OTC" && (
                    <SparklesIcon size={14} color="var(--color-pharma)" className="shrink-0" />
                  )}
                </label>
                <select
                  id="pf-sale-type"
                  value={state.saleType}
                  onChange={(e) =>
                    dispatch({
                      type: "SET_FIELD",
                      field: "saleType",
                      value: e.target.value,
                    })
                  }
                  disabled={isProcessing}
                  className="pos-input w-full"
                >
                  {SALE_TYPES.map((st) => {
                    const isDefault = defaultSaleType === st;
                    return (
                      <option key={st} value={st}>
                        {st}{isDefault ? ` — ${t("products.sale_type_default_label")}` : ""}
                      </option>
                    );
                  })}
                </select>
                {/* Hint: show when prescription enforcement auto-selects PRESCRIPTION */}
                {defaultSaleType && defaultSaleType !== "OTC" && (
                  <p
                    className="mt-pos-xs flex items-center gap-pos-xs text-caption"
                    style={{
                      color:
                        "color-mix(in srgb, var(--color-ink) 45%, transparent)",
                    }}
                  >
                    <SparklesIcon size={12} className="shrink-0" />
                    <span>{t("products.sale_type_default_hint")}</span>
                  </p>
                )}
              </div>

              {/* Category */}
              <div>
                <label
                  htmlFor="pf-category"
                  className="mb-pos-xs block text-body-sm font-medium"
                  style={{ color: "var(--color-ink)" }}
                >
                  {t("products.category")}
                </label>
                <select
                  id="pf-category"
                  value={state.categoryId}
                  onChange={(e) =>
                    dispatch({
                      type: "SET_FIELD",
                      field: "categoryId",
                      value: e.target.value,
                    })
                  }
                  disabled={isProcessing}
                  className="pos-input w-full"
                >
                  <option value="">{t("products.no_category")}</option>
                  {categories.map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Pharmaceutical form */}
              <div>
                <label
                  htmlFor="pf-pharma-form"
                  className="mb-pos-xs block text-body-sm font-medium"
                  style={{ color: "var(--color-ink)" }}
                >
                  {t("products.pharmaceutical_form")}
                </label>
                <select
                  id="pf-pharma-form"
                  value={state.pharmaceuticalFormId}
                  onChange={(e) =>
                    dispatch({
                      type: "SET_FIELD",
                      field: "pharmaceuticalFormId",
                      value: e.target.value,
                    })
                  }
                  disabled={isProcessing}
                  className="pos-input w-full"
                >
                  <option value="">{t("products.no_pharmaceutical_form")}</option>
                  {pharmaceuticalForms.map((pf) => (
                    <option key={pf.id} value={pf.id}>
                      {pf.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </section>

          <hr className="pos-divider" />

          {/* ── Barcodes ─────────────────────────────────────────────── */}
          <section>
            <div className="mb-pos-md flex items-center justify-between">
              <h3
                className="text-body-sm font-semibold uppercase tracking-wider"
                style={{
                  color:
                    "color-mix(in srgb, var(--color-ink) 60%, transparent)",
                }}
              >
                {t("products.section_barcodes")}
              </h3>
              <button
                type="button"
                onClick={() => dispatch({ type: "ADD_BARCODE" })}
                disabled={isProcessing}
                className="pos-button pos-button-secondary px-pos-sm py-pos-xs text-caption"
              >
                + {t("products.add_barcode")}
              </button>
            </div>

            {fieldError("barcodes") && (
              <p className="mb-pos-sm text-caption text-red-500">
                {t("products.barcode_primary_required")}
              </p>
            )}

            <div className="space-y-pos-sm">
              {state.barcodes.map((bc, index) => (
                <div
                  key={index}
                  className="flex items-center gap-pos-sm rounded-pos px-pos-md py-pos-sm"
                  style={{
                    backgroundColor:
                      "color-mix(in srgb, var(--color-ink) 3%, transparent)",
                  }}
                >
                  {/* Barcode value */}
                  <input
                    type="text"
                    value={bc.barcode}
                    onChange={(e) =>
                      dispatch({
                        type: "UPDATE_BARCODE",
                        index,
                        field: "barcode",
                        value: e.target.value,
                      })
                    }
                    placeholder={t("products.barcode_placeholder")}
                    disabled={isProcessing}
                    className="pos-input flex-1"
                  />

                  {/* Barcode type */}
                  <select
                    value={bc.barcodeType}
                    onChange={(e) =>
                      dispatch({
                        type: "UPDATE_BARCODE",
                        index,
                        field: "barcodeType",
                        value: e.target.value,
                      })
                    }
                    disabled={isProcessing}
                    className="pos-input w-28"
                  >
                    {BARCODE_TYPES.map((bt) => (
                      <option key={bt} value={bt}>
                        {bt}
                      </option>
                    ))}
                  </select>

                  {/* Primary toggle */}
                  <label className="flex cursor-pointer items-center gap-pos-xs text-caption">
                    <input
                      type="radio"
                      name="primary-barcode"
                      checked={bc.isPrimary}
                      onChange={() => {
                        const updated = state.barcodes.map((b, i) => ({
                          ...b,
                          isPrimary: i === index,
                        }));
                        dispatch({ type: "SET_BARCODES", barcodes: updated });
                      }}
                      disabled={isProcessing}
                      style={{ accentColor: "var(--color-pharma)" }}
                    />
                    {t("products.primary")}
                  </label>

                  {/* Remove */}
                  {state.barcodes.length > 1 && (
                    <button
                      type="button"
                      onClick={() => dispatch({ type: "REMOVE_BARCODE", index })}
                      disabled={isProcessing}
                      className="flex-shrink-0 rounded p-1 transition-colors hover:bg-red-100"
                      aria-label={t("products.remove_barcode")}
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="#D32F2F"
                        strokeWidth={2}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M18 6L6 18M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>
              ))}
            </div>
          </section>

          <hr className="pos-divider" />

          {/* ── Price & Tax ──────────────────────────────────────────── */}
          <section>
            <h3
              className="mb-pos-md text-body-sm font-semibold uppercase tracking-wider"
              style={{
                color:
                  "color-mix(in srgb, var(--color-ink) 60%, transparent)",
              }}
            >
              {t("products.section_pricing")}
            </h3>
            <div className="space-y-pos-md">
              {/* Price */}
              <div>
                <label
                  htmlFor="pf-price"
                  className="mb-pos-xs block text-body-sm font-medium"
                  style={{ color: "var(--color-ink)" }}
                >
                  {t("products.price")} *
                </label>
                <div className="relative">
                  <span
                    className="absolute left-pos-sm top-1/2 -translate-y-1/2 text-body-sm"
                    style={{
                      color:
                        "color-mix(in srgb, var(--color-ink) 50%, transparent)",
                    }}
                  >
                    $
                  </span>
                  <input
                    id="pf-price"
                    type="number"
                    min={0}
                    step="0.01"
                    lang="es-CO"
                    value={state.price}
                    onChange={(e) =>
                      dispatch({
                        type: "SET_FIELD",
                        field: "price",
                        value: e.target.value,
                      })
                    }
                    disabled={isProcessing}
                    className={`pos-input w-full pl-pos-lg font-data tabular-nums ${fieldError("price") ? "border-red-500" : ""}`}
                  />
                </div>
                {fieldError("price") && (
                  <p className="mt-pos-xs text-caption text-red-500">
                    {t("products.field_required")}
                  </p>
                )}
              </div>

              {/* Tax scheme */}
              <div>
                <label
                  htmlFor="pf-tax-scheme"
                  className="mb-pos-xs flex items-center gap-pos-xs text-body-sm font-medium"
                  style={{ color: "var(--color-ink)" }}
                >
                  <span>{t("products.tax_scheme")} *</span>
                  {defaultTaxSchemeId && (
                    <StarIcon size={14} color="var(--color-pharma)" className="shrink-0" />
                  )}
                </label>
                <select
                  id="pf-tax-scheme"
                  value={state.taxSchemeId}
                  onChange={(e) =>
                    dispatch({
                      type: "SET_FIELD",
                      field: "taxSchemeId",
                      value: e.target.value,
                    })
                  }
                  disabled={isProcessing}
                  className={`pos-input w-full ${fieldError("taxSchemeId") ? "border-red-500" : ""}`}
                >
                  {taxSchemes.length === 0 && (
                    <option value="">
                      {t("products.no_tax_schemes_synced")}
                    </option>
                  )}
                  {taxSchemes.length > 0 && (
                    <option value="">{t("products.select_tax_scheme")}</option>
                  )}
                  {taxSchemes.map((ts) => {
                    const isDefault = defaultTaxSchemeId === ts.id;
                    return (
                      <option key={ts.id} value={ts.id}>
                        {ts.name} ({ts.rate}%){isDefault ? ` — ${t("products.tax_default_label")}` : ""}
                      </option>
                    );
                  })}
                </select>
                {fieldError("taxSchemeId") && (
                  <p className="mt-pos-xs text-caption text-red-500">
                    {t("products.field_required")}
                  </p>
                )}
                {/* Hint: show which tax scheme is the system default */}
                {defaultTaxSchemeId && taxSchemes.length > 0 && (
                  <p
                    className="mt-pos-xs flex items-center gap-pos-xs text-caption"
                    style={{
                      color:
                        "color-mix(in srgb, var(--color-ink) 45%, transparent)",
                    }}
                  >
                    <StarIcon size={12} className="shrink-0" />
                    <span>{t("products.tax_default_hint")}</span>
                  </p>
                )}
              </div>
            </div>
          </section>

          <hr className="pos-divider" />

          {/* ── Optional Information ─────────────────────────────────── */}
          <section>
            <h3
              className="mb-pos-md text-body-sm font-semibold uppercase tracking-wider"
              style={{
                color:
                  "color-mix(in srgb, var(--color-ink) 60%, transparent)",
              }}
            >
              {t("products.section_optional")}
            </h3>
            <div className="grid grid-cols-2 gap-pos-md">
              {/* Minimum stock — hidden when stock validation is OFF */}
              {fieldRequirements.minimumStock !== "HIDDEN" && (
                <div>
                  <label
                    htmlFor="pf-min-stock"
                    className="mb-pos-xs block text-body-sm font-medium"
                    style={{ color: "var(--color-ink)" }}
                  >
                    {t("products.minimum_stock")}
                  </label>
                  <input
                    id="pf-min-stock"
                    type="number"
                    min={0}
                    value={state.minimumStock}
                    onChange={(e) =>
                      dispatch({
                        type: "SET_NUMBER",
                        field: "minimumStock",
                        value: Math.max(0, Number(e.target.value)),
                      })
                    }
                    disabled={isProcessing}
                    className="pos-input w-full font-data tabular-nums"
                  />
                </div>
              )}

              {/* INVIMA registry — hidden when prescription enforcement is OFF */}
              {fieldRequirements.invimaRegistry !== "HIDDEN" && (
                <div>
                  <label
                    htmlFor="pf-invima"
                    className="mb-pos-xs block text-body-sm font-medium"
                    style={{ color: "var(--color-ink)" }}
                  >
                    {t("products.invima_registry")}
                  </label>
                  <input
                    id="pf-invima"
                    type="text"
                    value={state.invimaRegistry}
                    onChange={(e) =>
                      dispatch({
                        type: "SET_FIELD",
                        field: "invimaRegistry",
                        value: e.target.value,
                      })
                    }
                    disabled={isProcessing}
                    className="pos-input w-full"
                  />
                </div>
              )}

              {/* ATC code — hidden when prescription enforcement is OFF */}
              {fieldRequirements.atcCode !== "HIDDEN" && (
                <div>
                  <label
                    htmlFor="pf-atc"
                    className="mb-pos-xs block text-body-sm font-medium"
                    style={{ color: "var(--color-ink)" }}
                  >
                    {t("products.atc_code")}
                  </label>
                  <input
                    id="pf-atc"
                    type="text"
                    value={state.atcCode}
                    onChange={(e) =>
                      dispatch({
                        type: "SET_FIELD",
                        field: "atcCode",
                        value: e.target.value,
                      })
                    }
                    disabled={isProcessing}
                    className="pos-input w-full"
                  />
                </div>
              )}

              {/* Therapeutic indication — hidden when prescription enforcement is OFF */}
              {fieldRequirements.therapeuticIndication !== "HIDDEN" && (
                <div>
                  <label
                    htmlFor="pf-indication"
                    className="mb-pos-xs block text-body-sm font-medium"
                    style={{ color: "var(--color-ink)" }}
                  >
                    {t("products.therapeutic_indication")}
                  </label>
                  <input
                    id="pf-indication"
                    type="text"
                    value={state.therapeuticIndication}
                    onChange={(e) =>
                      dispatch({
                        type: "SET_FIELD",
                        field: "therapeuticIndication",
                        value: e.target.value,
                      })
                    }
                    disabled={isProcessing}
                    className="pos-input w-full"
                  />
                </div>
              )}

              {/* Storage conditions — always visible */}
              <div className="col-span-2">
                <label
                  htmlFor="pf-storage"
                  className="mb-pos-xs block text-body-sm font-medium"
                  style={{ color: "var(--color-ink)" }}
                >
                  {t("products.storage_conditions")}
                </label>
                <input
                  id="pf-storage"
                  type="text"
                  value={state.storageConditions}
                  onChange={(e) =>
                    dispatch({
                      type: "SET_FIELD",
                      field: "storageConditions",
                      value: e.target.value,
                    })
                  }
                  disabled={isProcessing}
                  className="pos-input w-full"
                />
              </div>

              {/* Internal notes — always visible */}
              <div className="col-span-2">
                <label
                  htmlFor="pf-notes"
                  className="mb-pos-xs block text-body-sm font-medium"
                  style={{ color: "var(--color-ink)" }}
                >
                  {t("products.internal_notes")}
                </label>
                <textarea
                  id="pf-notes"
                  value={state.internalNotes}
                  onChange={(e) =>
                    dispatch({
                      type: "SET_FIELD",
                      field: "internalNotes",
                      value: e.target.value,
                    })
                  }
                  disabled={isProcessing}
                  rows={3}
                  className="pos-input w-full resize-none"
                />
              </div>
            </div>
          </section>
        </div>
      </div>

      {/* ── Footer bar ──────────────────────────────────────────────── */}
      <div
        className="flex items-center justify-end gap-pos-md px-pos-xl py-pos-lg"
        style={{
          borderTop:
            "1px solid color-mix(in srgb, var(--color-ink) 8%, transparent)",
          backgroundColor: "var(--color-panel)",
        }}
      >
        <button
          type="button"
          onClick={onCancel}
          disabled={isProcessing}
          className="pos-button pos-button-secondary"
        >
          {t("common.cancel")}
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={isProcessing}
          className="pos-button pos-button-primary"
        >
          {isProcessing
            ? t("common.saving")
            : mode === "create"
              ? t("products.create_product")
              : t("products.save_changes")}
        </button>
      </div>
    </div>
  );
};
