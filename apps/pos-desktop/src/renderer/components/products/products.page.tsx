/**
 * Products page — full product management view.
 *
 * Thin wiring container: owns all state, side-effects, and action handlers.
 * Presentational sub-components and hooks are imported from sibling files.
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
import { useOnlineStatus } from "@/hooks/use-online-status";
import { useProductService } from "../common/service-context";
import { PRODUCTS_EXPORT } from "../../../domain/export";
import { useDataExport } from "../../hooks/use-data-export";
import { notify } from "@/utils/notify";
import type { SaleType } from "@pharmacy/database/local";
import type {
  DisplayProduct,
  ProductFormMode,
  ProductFormData,
} from "./products.types";
import { mapToDisplayProduct, type RawProduct } from "./products.types";

import { ProductHeader } from "./product-header";
import { ProductList } from "./product-list";
import { ProductForm } from "./product-form";
import { useProductFormData } from "./use-product-form-data";
import {
  canImportEntity,
  ImportDialog,
} from "../data-import/import-dialog";

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export const ProductsPage: FC = () => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const isOnline = useOnlineStatus();
  const productService = useProductService();

  // Reference data (categories, forms, tax schemes, field requirements)
  const {
    categories,
    pharmaceuticalForms,
    taxSchemes,
    defaultTaxSchemeId,
    defaultSaleType,
    fieldRequirements,
  } = useProductFormData();

  // List state
  const [products, setProducts] = useState<DisplayProduct[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [showInactive, setShowInactive] = useState(false);

  // Form state
  const [formMode, setFormMode] = useState<ProductFormMode | null>(null);
  const [selectedProduct, setSelectedProduct] =
    useState<DisplayProduct | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Import state (role-gated — the service enforces the same rule)
  const [isImportOpen, setIsImportOpen] = useState(false);
  const sessionRole = useLocalSessionStore((s) => s.session?.role);
  const canImportProducts = canImportEntity("products", sessionRole);

  // Export (reproduces the grid's client-side filters server-side)
  const {
    exportTo: exportProducts,
    isExporting: isExportingProducts,
    error: exportError,
  } = useDataExport(PRODUCTS_EXPORT, {
    query: searchQuery,
    categoryId: categoryFilter || undefined,
    showInactive,
  });

  useEffect(() => {
    if (!exportError) return;
    notify.error({
      title: t("export.error", { defaultValue: "No se pudo generar la exportación" }),
      description: exportError,
    });
  }, [exportError, t]);

  // ── Load products on mount / after import ───────────────────────────

  const loadProducts = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await productService.listProducts({
        includeInactive: true,
        limit: 500,
      });
      setProducts(
        (result.items as unknown as RawProduct[]).map(mapToDisplayProduct),
      );
    } catch (err) {
      console.error("[ProductsPage] listProducts failed:", err);
      setError(t("products.load_error"));
    } finally {
      setIsLoading(false);
    }
  }, [productService, t]);

  useEffect(() => {
    void loadProducts();
  }, [loadProducts]);

  // ── Client-side search + category + status filter ──────────────────

  const filteredProducts = useMemo(() => {
    return products.filter((p) => {
      if (categoryFilter && p.categoryId !== categoryFilter) return false;
      if (!showInactive && !p.isActive) return false;
      const q = searchQuery.trim().toLowerCase();
      if (!q) return true;
      return (
        p.commercialName.toLowerCase().includes(q) ||
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

  const handleImported = useCallback(() => {
    void loadProducts();
  }, [loadProducts]);

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

      try {
        setIsProcessing(true);

        if (formMode === "create") {
          await productService.createProduct({
            commercialName: data.commercialName,
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
            price: { price: data.price },
            tax: { taxSchemeId: data.taxSchemeId },
            commissionType: data.commissionType,
            commissionValue: data.commissionValue,
            commissionStartsAt: data.commissionStartsAt,
            commissionEndsAt: data.commissionEndsAt,
            ...(data.cost.trim()
              ? {
                  initialCost: {
                    cost: data.cost,
                    changeReason: "Initial cost on creation",
                  },
                }
              : {}),
          });
        } else if (formMode === "edit" && selectedProduct) {
          const updateInput: Record<string, unknown> = {};

          if (data.commercialName !== selectedProduct.commercialName)
            updateInput.commercialName = data.commercialName;
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

          if (data.barcodes.length > 0) {
            updateInput.barcodes = data.barcodes.map((b) => ({
              barcode: b.barcode,
              barcodeType: b.barcodeType as any,
              isPrimary: b.isPrimary,
            }));
          }

          if (data.price.trim()) {
            updateInput.newPrice = { price: data.price };
          }

          if (data.taxSchemeId.trim()) {
            updateInput.newTax = { taxSchemeId: data.taxSchemeId };
          }

          if (data.cost.trim()) {
            updateInput.newCost = { cost: data.cost };
          }

          // Commission block — send as a unit when anything changed, so
          // switching to NONE also clears value and window on the server.
          if (
            data.commissionType !== selectedProduct.commissionType ||
            data.commissionValue !== selectedProduct.commissionValue ||
            data.commissionStartsAt !== selectedProduct.commissionStartsAt ||
            data.commissionEndsAt !== selectedProduct.commissionEndsAt
          ) {
            updateInput.commissionType = data.commissionType;
            updateInput.commissionValue = data.commissionValue;
            updateInput.commissionStartsAt = data.commissionStartsAt;
            updateInput.commissionEndsAt = data.commissionEndsAt;
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
          (result.items as unknown as RawProduct[]).map(mapToDisplayProduct),
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
        onImport={canImportProducts ? () => setIsImportOpen(true) : undefined}
        onExport={products.length > 0 ? exportProducts : undefined}
        isExporting={isExportingProducts}
      />

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* Left: product list panel */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-pos-xl pb-pos-xl transition-all duration-200">
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
          <div
            className="h-1/2 min-h-0 w-full shrink-0 overflow-hidden border-t lg:h-auto lg:w-2/5 lg:border-l lg:border-t-0"
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

      {/* CSV/Excel import wizard */}
      <ImportDialog
        entityKey="products"
        open={isImportOpen}
        onOpenChange={setIsImportOpen}
        onImported={handleImported}
      />
    </section>
  );
};
