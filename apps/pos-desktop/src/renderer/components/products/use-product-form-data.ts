/**
 * Hook to load reference data for the product form — categories,
 * pharmaceutical forms, tax schemes, field requirements, and default values.
 *
 * @category Hook
 */

import { useEffect, useState } from "react";
import type { PrismaClient } from "@pharmacy/database/local";
import { getTenantConfigState } from "../../../domain/config/tenant-config.store";
import {
  getStockValidationBehavior,
  getPrescriptionEnforcementBehavior,
} from "../../../domain/config/field-requirements";
import type {
  CategoryOption,
  PharmaceuticalFormOption,
  TaxSchemeOption,
  ProductFormFieldRequirements,
} from "./products.types";

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
 * - Default tax scheme from the tenant config defaultTaxRate.
 * - Field visibility from the tenant strictness config.
 * - Default sale type from prescription enforcement config.
 */
export function useProductFormData(): ProductFormDataResult {
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

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const { getLocalDatabase } = await import(
          "../../../infrastructure/local-database"
        );
        const { prisma } = await getLocalDatabase();
        const db = prisma as PrismaClient;

        if (!cancelled) {
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

          // Load tax schemes
          const taxRows = await db.taxScheme.findMany({
            orderBy: { name: "asc" },
            select: {
              id: true,
              name: true,
              code: true,
              rate: true,
              taxType: true,
            },
          });
          const mappedTaxSchemes: TaxSchemeOption[] = taxRows.map((row) => ({
            id: row.id,
            name: row.name,
            code: row.code,
            rate: Number(row.rate) * 100,
            taxType: row.taxType,
          }));
          setTaxSchemes(mappedTaxSchemes);

          // Auto-select tax scheme matching the tenant default tax rate
          const configState = getTenantConfigState();
          const defaultRate = configState.config?.fiscal?.defaultTaxRate;
          if (defaultRate != null && mappedTaxSchemes.length > 0) {
            const targetRatePct = Math.round(defaultRate * 100);
            const match = mappedTaxSchemes.find(
              (s) => Math.round(s.rate) === targetRatePct,
            );
            if (match) setDefaultTaxSchemeId(match.id);
          }

          // Compute field visibility from tenant strictness config
          const effectiveConfig = configState.effectiveConfig;
          if (effectiveConfig) {
            const stockBehavior = getStockValidationBehavior(effectiveConfig);
            const prescriptionBehavior =
              getPrescriptionEnforcementBehavior(effectiveConfig);

            setFieldRequirements({
              minimumStock:
                stockBehavior === "SKIP" ? "HIDDEN" : "OPTIONAL",
              atcCode:
                prescriptionBehavior === "SKIP" ? "HIDDEN" : "OPTIONAL",
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
        }
      } catch {
        // Non-critical — categories, forms, and tax schemes are
        // optional fields or may not be synced yet.
        if (!cancelled) setIsRefDataLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

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
