/**
 * Products page — full product management view.
 *
 * Lists all products in a searchable/filterable table.
 * Supports creating new products and editing existing ones via inline form panel.
 *
 * @category Page
 */

import {
  type FC,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { useAppDispatch } from "@/store/hooks";
import { navigateBackToSales } from "@/store/slices/ui-slice";
import { useLocalSessionStore } from "../../../domain/auth/local-session.store";
import { getTenantConfigState } from "../../../domain/config/tenant-config.store";import {
  getStockValidationBehavior,
  getPrescriptionEnforcementBehavior,
} from "../../../domain/config/field-requirements";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { useProductService } from "../common/service-context";
import type { PrismaClient, SaleType } from '@pharmacy/database/local';
import type {
  DisplayProduct,
  ProductFormMode,
  ProductFormData,
  CategoryOption,
  PharmaceuticalFormOption,
  TaxSchemeOption,
  ProductFormFieldRequirements,
} from "./products.types";

import { ProductHeader } from "./product-header";
import { ProductList } from "./product-list";
import { ProductForm } from "./product-form";

// ── Local type to bridge service output → DisplayProduct ─────────────────

interface RawProduct extends Record<string, unknown> {
  id: string;
  internalCode: string;
  commercialName: string;
  genericName: string;
  activePrinciple: string;
  currentTaxSchemeId?: string | null;
  concentration: string | null;
  concentrationUnit: string | null;
  laboratory: string;
  saleType: SaleType;
  minimumStock: number;
  isActive: boolean;
  invimaRegistry: string | null;
  atcCode: string | null;
  categoryId: string | null;
  pharmaceuticalFormId: string | null;
  therapeuticIndication: string | null;
  storageConditions: string | null;
  internalNotes: string | null;
  createdAt: string;
  updatedAt: string;
  barcodes: Array<{
    id: string;
    barcode: string;
    barcodeType: string;
    isPrimary: boolean;
  }>;
  currentPrice: string | null;
}

// ── Page component ────────────────────────────────────────────────────────

export const ProductsPage: FC = () => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const isOnline = useOnlineStatus();
  const productService = useProductService();

  // List state
  const [products, setProducts] = useState<DisplayProduct[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [showInactive, setShowInactive] = useState(false);

  // Reference data
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [pharmaceuticalForms, setPharmaceuticalForms] = useState<
    PharmaceuticalFormOption[]
  >([]);
  const [taxSchemes, setTaxSchemes] = useState<TaxSchemeOption[]>([]);

  // Form state
  const [formMode, setFormMode] = useState<ProductFormMode | null>(null);
  const [selectedProduct, setSelectedProduct] =
    useState<DisplayProduct | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Default tax scheme (from tenant config defaultTaxRate)
  const [defaultTaxSchemeId, setDefaultTaxSchemeId] = useState("");

  // Field visibility requirements (from tenant config strictness)
  const [fieldRequirements, setFieldRequirements] =
    useState<ProductFormFieldRequirements>({
      minimumStock: "OPTIONAL",
      atcCode: "OPTIONAL",
      therapeuticIndication: "OPTIONAL",
      invimaRegistry: "OPTIONAL",
    });

  // Default sale type (from tenant config prescription enforcement)
  const [defaultSaleType, setDefaultSaleType] = useState("OTC");

  // ── Load products on mount ──────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        setIsLoading(true);
        const result = await productService.listProducts({
          includeInactive: true,
          limit: 500,
        });
        if (!cancelled) {
          setProducts(
            (result.items as RawProduct[]).map(mapToDisplayProduct),
          );
        }
      } catch {
        if (!cancelled)
          setError(t("products.load_error"));
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [productService, t]);

  // ── Load reference data (categories, forms, tax schemes) ────────────

  useEffect(() => {
    let cancelled = false;

    const loadRefData = async () => {
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
          const mappedTaxSchemes = taxRows.map((row) => ({
            id: row.id,
            name: row.name,
            code: row.code,
            rate: Number(row.rate) * 100,
            taxType: row.taxType,
          }));
          setTaxSchemes(mappedTaxSchemes);

          // Auto-select the TaxScheme matching the tenant's defaultTaxRate
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
            const prescriptionBehavior = getPrescriptionEnforcementBehavior(effectiveConfig);

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

            // Auto-select PRESCRIPTION when prescription enforcement is strict
            if (prescriptionBehavior === "BLOCK") {
              setDefaultSaleType("PRESCRIPTION");
            }
          }
        }
      } catch {
        // Non-critical — categories, forms, and tax schemes are
        // optional fields or may not be synced yet.
      }
    };

    void loadRefData();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Client-side search + category + status filter ──────────────────

  const filteredProducts = useMemo(() => {
    return products.filter((p) => {
      // Category filter
      if (categoryFilter && p.categoryId !== categoryFilter) return false;
      // Active/inactive filter
      if (!showInactive && !p.isActive) return false;
      // Search query
      const q = searchQuery.trim().toLowerCase();
      if (!q) return true;
      return (
        p.commercialName.toLowerCase().includes(q) ||
        p.genericName.toLowerCase().includes(q) ||
        p.activePrinciple.toLowerCase().includes(q) ||
        p.internalCode.toLowerCase().includes(q) ||
        p.laboratory.toLowerCase().includes(q) ||
        p.barcodes.some((bc) => bc.barcode.includes(q))
      );
    });
  }, [searchQuery, categoryFilter, showInactive, products]);

  // ── Handlers ────────────────────────────────────────────────────────

  const handleBack = useCallback(() => {
    dispatch(navigateBackToSales());
  }, [dispatch]);

  const handleCreateNew = useCallback(() => {
    setSelectedProduct(null);
    setFormMode("create");
    setError(null);
  }, []);

  const handleSelectProduct = useCallback((product: DisplayProduct) => {
    setSelectedProduct(product);
  }, []);

  const handleEditProduct = useCallback((product: DisplayProduct) => {
    setSelectedProduct(product);
    setFormMode("edit");
    setError(null);
  }, []);

  const handleCancelForm = useCallback(() => {
    setFormMode(null);
    setSelectedProduct(null);
    setError(null);
  }, []);

  const handleSaveProduct = useCallback(
    async (data: ProductFormData) => {
      setError(null);

      const currentSession = useLocalSessionStore.getState().session;
      if (!currentSession) {
        setError(t("errors.no_session"));
        return;
      }

      // Role enforcement delegated to productService methods
      // (createProduct / updateProduct call auth.requireRole internally,
      //  which handles OWNER/SAAS_ADMIN supersession for ADMIN).
      try {
        setIsProcessing(true);

        if (formMode === "create") {
          // Create new product
          await productService.createProduct({
            commercialName: data.commercialName,
            genericName: data.genericName,
            activePrinciple: data.activePrinciple,
            concentration: data.concentration || null,
            concentrationUnit: data.concentrationUnit || null,
            laboratory: data.laboratory,
            saleType: data.saleType as SaleType,
            minimumStock: data.minimumStock,
            invimaRegistry: data.invimaRegistry || null,
            atcCode: data.atcCode || null,
            therapeuticIndication: data.therapeuticIndication || null,
            storageConditions: data.storageConditions || null,
            internalNotes: data.internalNotes || null,
            categoryId: data.categoryId || null,
            pharmaceuticalFormId: data.pharmaceuticalFormId || null,
            barcodes: data.barcodes.map((bc) => ({
              barcode: bc.barcode,
              barcodeType: bc.barcodeType as any,
              isPrimary: bc.isPrimary,
            })),
            price: {
              price: data.price,
            },
            tax: {
              taxSchemeId: data.taxSchemeId,
            },
          });
        } else if (formMode === "edit" && selectedProduct) {
          // Update existing product
          const updateInput: Record<string, unknown> = {};

          if (data.commercialName !== selectedProduct.commercialName)
            updateInput.commercialName = data.commercialName;
          if (data.genericName !== selectedProduct.genericName)
            updateInput.genericName = data.genericName;
          if (data.activePrinciple !== selectedProduct.activePrinciple)
            updateInput.activePrinciple = data.activePrinciple;
          if (data.concentration !== (selectedProduct.concentration ?? ""))
            updateInput.concentration = data.concentration || null;
          if (
            data.concentrationUnit !==
            (selectedProduct.concentrationUnit ?? "")
          )
            updateInput.concentrationUnit = data.concentrationUnit || null;
          if (data.laboratory !== selectedProduct.laboratory)
            updateInput.laboratory = data.laboratory;
          if (data.saleType !== selectedProduct.saleType)
            updateInput.saleType = data.saleType;
          if (data.minimumStock !== selectedProduct.minimumStock)
            updateInput.minimumStock = data.minimumStock;
          if (data.invimaRegistry !== (selectedProduct.invimaRegistry ?? ""))
            updateInput.invimaRegistry = data.invimaRegistry || null;
          if (data.atcCode !== (selectedProduct.atcCode ?? ""))
            updateInput.atcCode = data.atcCode || null;
          if (
            data.therapeuticIndication !==
            (selectedProduct.therapeuticIndication ?? "")
          )
            updateInput.therapeuticIndication =
              data.therapeuticIndication || null;
          if (
            data.storageConditions !==
            (selectedProduct.storageConditions ?? "")
          )
            updateInput.storageConditions = data.storageConditions || null;
          if (data.internalNotes !== (selectedProduct.internalNotes ?? ""))
            updateInput.internalNotes = data.internalNotes || null;
          if (data.categoryId !== (selectedProduct.categoryId ?? ""))
            updateInput.categoryId = data.categoryId || null;
          if (
            data.pharmaceuticalFormId !==
            (selectedProduct.pharmaceuticalFormId ?? "")
          )
            updateInput.pharmaceuticalFormId =
              data.pharmaceuticalFormId || null;

          // Always send barcodes (replace full set on edit)
          if (data.barcodes.length > 0) {
            updateInput.barcodes = data.barcodes.map((b) => ({
              barcode: b.barcode,
              barcodeType: b.barcodeType as any,
              isPrimary: b.isPrimary,
            }));
          }

          // Price: always send if non-empty (creates new price history)
          if (data.price.trim()) {
            updateInput.newPrice = {
              price: data.price,
            };
          }

          // Tax: always send if non-empty (creates new tax history)
          if (data.taxSchemeId.trim()) {
            updateInput.newTax = {
              taxSchemeId: data.taxSchemeId,
            };
          }

          if (Object.keys(updateInput).length > 0) {
            await productService.updateProduct(
              selectedProduct.id,
              updateInput as any,
            );
          }
        }

        // Reload products after save
        const result = await productService.listProducts({
          includeInactive: true,
          limit: 500,
        });
        setProducts(
          (result.items as RawProduct[]).map(mapToDisplayProduct),
        );

        setIsProcessing(false);
        setFormMode(null);
        setSelectedProduct(null);
      } catch (err) {
        setIsProcessing(false);
        setError(
          err instanceof Error
            ? err.message
            : t("products.save_error"),
        );
      }
    },
    [formMode, selectedProduct, productService, t],
  );

  // ── Render ──────────────────────────────────────────────────────────

  const showForm = formMode !== null;

  return (
    <section
      aria-label={t("products.title")}
      className="flex h-full flex-col"
      style={{ backgroundColor: "var(--color-surface)" }}
    >
      <ProductHeader
        isOnline={isOnline}
        onBack={handleBack}
        onCreateNew={handleCreateNew}
      />

      <div className="flex min-h-0 flex-1">
        {/* Left: product list panel */}
        <div
          className={`flex flex-col overflow-hidden ${
            showForm ? "w-3/5" : "w-full"
          } px-pos-xl pb-pos-xl transition-all duration-200`}
        >
          {error && !showForm && (
            <div
              className="mb-pos-sm rounded-pos px-pos-md py-pos-sm text-body-sm font-medium"
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

          <ProductList
            products={filteredProducts}
            categories={categories}
            searchQuery={searchQuery}
            onSearchQueryChange={setSearchQuery}
            categoryFilter={categoryFilter}
            onCategoryFilterChange={setCategoryFilter}
            showInactive={showInactive}
            onShowInactiveChange={setShowInactive}
            isLoading={isLoading}
            selectedProductId={selectedProduct?.id ?? null}
            onSelectProduct={handleSelectProduct}
            onEditProduct={handleEditProduct}
          />
        </div>

        {/* Right: form panel */}
        {showForm && (
          <div className="w-2/5 overflow-hidden border-l" 
            style={{
              borderColor:
                "color-mix(in srgb, var(--color-ink) 8%, transparent)",
            }}
          >
            <ProductForm
              mode={formMode}
              product={selectedProduct}
              categories={categories}
              pharmaceuticalForms={pharmaceuticalForms}
              taxSchemes={taxSchemes}
              defaultTaxSchemeId={defaultTaxSchemeId}
              defaultSaleType={defaultSaleType}
              fieldRequirements={fieldRequirements}
              isProcessing={isProcessing}
              error={error}
              onSave={handleSaveProduct}
              onCancel={handleCancelForm}
            />
          </div>
        )}
      </div>
    </section>
  );
};

// ── Mapping helper ────────────────────────────────────────────────────────

function mapToDisplayProduct(raw: RawProduct): DisplayProduct {
  return {
    id: raw.id,
    internalCode: raw.internalCode,
    commercialName: raw.commercialName,
    genericName: raw.genericName,
    activePrinciple: raw.activePrinciple,
    concentration: raw.concentration,
    concentrationUnit: raw.concentrationUnit,
    laboratory: raw.laboratory,
    saleType: raw.saleType,
    minimumStock: raw.minimumStock,
    isActive: raw.isActive,
    invimaRegistry: raw.invimaRegistry,
    atcCode: raw.atcCode,
    categoryId: raw.categoryId,
    pharmaceuticalFormId: raw.pharmaceuticalFormId,
    therapeuticIndication: raw.therapeuticIndication,
    storageConditions: raw.storageConditions,
    internalNotes: raw.internalNotes,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    barcodes: raw.barcodes,
    currentPrice: raw.currentPrice,
    currentTaxSchemeId: raw.currentTaxSchemeId ?? null,
  };
}
