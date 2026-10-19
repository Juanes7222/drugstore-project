/**
 * Hook to load reference data for the product form — categories,
 * pharmaceutical forms, tax schemes, field requirements, and default values.
 *
 * @category Hook
 */

import { useCallback, useEffect, useState } from "react";
import type { PrismaClient } from "@pharmacy/database/local";
import { CATALOG_SYNCED_EVENT } from "../../../domain/catalog/catalog-sync.service";
import { getTenantConfigState } from "../../../domain/config/tenant-config.store";
import {
  getStockValidationBehavior,
  getPrescriptionEnforcementBehavior,
} from "../../../domain/config/field-requirements";
import {
  mapRegimenToTaxLevelCode,
} from "../../../domain/company";
import type { CompanyDraft } from "../../../domain/company";
import { useCompanySetup } from "../../hooks/use-company-setup";
import type {
  CategoryOption,
  PharmaceuticalFormOption,
  TaxSchemeOption,
  ProductFormFieldRequirements,
} from "./products.types";

/** IVA charged by COMÚN regimens (R-99-PN / R-99-PJ / R-99-PN-ENT). */
const RESPONSABLE_VAT_RATE = 0.19;
/** Simplified (R-99-PN-SIM) and O-99 issuers charge no IVA. */
const EXEMPT_VAT_RATE = 0;

/**
 * Default IVA rate for the new-product form, derived from the synced
 * company regimen — same source as the read-only fiscal panel. A missing
 * draft falls back to the responsible (0.19) rate.
 */
function deriveDefaultVatRate(draft: CompanyDraft | null): number {
  if (!draft) return RESPONSABLE_VAT_RATE;
  const code = mapRegimenToTaxLevelCode(draft.regimen, draft.organizationType);
  return code === "R-99-PN" || code === "R-99-PJ" || code === "R-99-PN-ENT"
    ? RESPONSABLE_VAT_RATE
    : EXEMPT_VAT_RATE;
}

/**
 * Deduplicate tax schemes that exist twice due to offline seed vs server
 * sync overlap (e.g. `seed-iva-19` + server UUID both "IVA 19%").
 * Key is normalized `taxType + rate` — seed and server share those even
 * when `code`/`name` differ ("Exento" vs "Exento de IVA").
 * Prefers the server UUID over the `seed-*` id so future writes hit the
 * authoritative row.
 */
function deduplicateTaxSchemes(schemes: TaxSchemeOption[]): TaxSchemeOption[] {
  const byKey = new Map<string, TaxSchemeOption>();
  for (const scheme of schemes) {
    const key = `${scheme.taxType}:${Math.round(scheme.rate)}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, scheme);
      continue;
    }
    const existingIsSeed = existing.id.startsWith("seed-");
    const currentIsSeed = scheme.id.startsWith("seed-");
    if (existingIsSeed && !currentIsSeed) {
      byKey.set(key, scheme);
    }
    // otherwise keep existing (server over seed, or first seen)
  }
  return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export interface ProductFormDataResult {
  categories: CategoryOption[];
  pharmaceuticalForms: PharmaceuticalFormOption[];
  taxSchemes: TaxSchemeOption[];
  defaultTaxSchemeId: string;
  defaultSaleType: string;
  fieldRequirements: ProductFormFieldRequirements;
  isRefDataLoading: boolean;
}

const DEFAULT_FIELD_REQUIREMENTS: ProductFormFieldRequirements = {
  minimumStock: "OPTIONAL",
  atcCode: "OPTIONAL",
  therapeuticIndication: "OPTIONAL",
  invimaRegistry: "OPTIONAL",
};

/**
 * Load reference data once on mount.
 *
 * - Categories, pharmaceutical forms, and tax schemes from the local DB.
 * - Default tax scheme derived from the synced company regimen.
 * - Field visibility from the tenant strictness config.
 * - Default sale type from prescription enforcement config.
 */
export function useProductFormData(): ProductFormDataResult {
  const { draft: companyDraft } = useCompanySetup();
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [pharmaceuticalForms, setPharmaceuticalForms] = useState<
    PharmaceuticalFormOption[]
  >([]);
  const [taxSchemes, setTaxSchemes] = useState<TaxSchemeOption[]>([]);
  const [defaultTaxSchemeId, setDefaultTaxSchemeId] = useState("");
  const [defaultSaleType, setDefaultSaleType] = useState("OTC");
  const [fieldRequirements, setFieldRequirements] = useState<
    ProductFormFieldRequirements
  >(DEFAULT_FIELD_REQUIREMENTS);
  const [isRefDataLoading, setIsRefDataLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const { getLocalDatabase } = await import(
        "../../../infrastructure/local-database"
      );
      const { prisma } = await getLocalDatabase();
      const db = prisma as PrismaClient;

      // Load categories
      const catRows = await db.category.findMany({
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      });
      setCategories(catRows);

      // Load pharmaceutical forms
      const formRows = await db.pharmaceuticalForm.findMany({
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      });
      setPharmaceuticalForms(formRows);

      // Load tax schemes — deduplicated to hide seed vs server overlap
      // (local seed `seed-iva-19` and serverUUID for "IVA 19%" share
      //  same rate+taxType but different ids; without dedup the form
      //  shows "IVA 19%" twice).
      const taxRows = await db.taxScheme.findMany({
        where: { isActive: true },
        orderBy: { name: "asc" },
        select: {
          id: true,
          name: true,
          code: true,
          rate: true,
          taxType: true,
          isActive: true,
        },
      });
      const mappedTaxSchemes: TaxSchemeOption[] = deduplicateTaxSchemes(
        taxRows.map((row) => ({
          id: row.id,
          name: row.name,
          code: row.code,
          // The rate is already a PERCENTAGE (19 means 19%) — both the server
          // and the local seed store it that way, and the domain consumes it as
          // `subtotal * rate / 100`. Multiplying by 100 here made a SYNCED row
          // read as 1900%, so it never matched the default the form picks
          // (`rate === 19`) and the seed was chosen instead — whose id the
          // domain then refuses to push.
          rate: Number(row.rate),
          taxType: row.taxType,
        })),
      );
      setTaxSchemes(mappedTaxSchemes);

      // Compute field visibility from tenant strictness config
      const configState = getTenantConfigState();
      const effectiveConfig = configState.effectiveConfig;
      if (effectiveConfig) {
        const stockBehavior = getStockValidationBehavior(effectiveConfig);
        const prescriptionBehavior =
          getPrescriptionEnforcementBehavior(effectiveConfig);

        setFieldRequirements({
          minimumStock: stockBehavior === "SKIP" ? "HIDDEN" : "OPTIONAL",
          atcCode: prescriptionBehavior === "SKIP" ? "HIDDEN" : "OPTIONAL",
          therapeuticIndication:
            prescriptionBehavior === "SKIP" ? "HIDDEN" : "OPTIONAL",
          invimaRegistry:
            prescriptionBehavior === "SKIP" ? "HIDDEN" : "OPTIONAL",
        });

        if (prescriptionBehavior === "BLOCK") {
          setDefaultSaleType("PRESCRIPTION");
        }
      }

      setIsRefDataLoading(false);
    } catch {
      // Non-critical — categories, forms, and tax schemes are
      // optional fields or may not be synced yet.
      setIsRefDataLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Reload reference data when a catalog pull lands. The initial load can
  // run before the sync scheduler's first cycle finishes, leaving only the
  // local seed rows; without this the form's default tax scheme stays a
  // `seed-*` id and creating a product fails sync validation.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = () => void load();
    window.addEventListener(CATALOG_SYNCED_EVENT, handler);
    return () => window.removeEventListener(CATALOG_SYNCED_EVENT, handler);
  }, []);

  // Auto-select the tax scheme whose rate matches the regimen-derived IVA.
  // Re-runs on draft arrival: the company profile resolves asynchronously,
  // so the scheme may need to change after the reference data has loaded.
  useEffect(() => {
    const targetRatePct = Math.round(deriveDefaultVatRate(companyDraft) * 100);
    const match = taxSchemes.find((s) => Math.round(s.rate) === targetRatePct);
    if (match) setDefaultTaxSchemeId(match.id);
  }, [companyDraft, taxSchemes]);

  return {
    categories,
    pharmaceuticalForms,
    taxSchemes,
    defaultTaxSchemeId,
    defaultSaleType,
    fieldRequirements,
    isRefDataLoading,
  };
}
