/**
 * Tests for the per-screen export definitions — pagination loops, filter
 * pass-through, and row mapping for each loader.
 */
import { describe, expect, it, vi } from "vitest";
import type { ClientSearchResult } from "../../clients/clients.service";
import type { SupplierSearchResult } from "../../purchases/suppliers.service";
import type { SaleHistoryListItem } from "../../sales-pos/sales-history.service";
import type { ExportServiceContext } from "../export.types";
import { CLIENTS_EXPORT } from "./clients.export";
import { INVENTORY_LOTS_EXPORT } from "./inventory-lots.export";
import { PRODUCTS_EXPORT } from "./products.export";
import { SALES_HISTORY_EXPORT } from "./sales-history.export";
import { SUPPLIERS_EXPORT } from "./suppliers.export";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function saleItem(
  overrides: Partial<SaleHistoryListItem> = {},
): SaleHistoryListItem {
  return {
    saleId: "sale-1",
    localNumber: "LN-0001",
    confirmedAt: "2026-08-21T10:00:00.000Z",
    totalAmount: "123456.78",
    clientName: "Ana Pérez",
    clientIdentificationNumber: "123456789",
    invoiceId: "inv-1",
    invoiceNumber: "INV-0001",
    invoiceStatus: "ISSUED",
    invoiceType: "POS",
    hasAdjustments: false,
    deliveryFeeCents: 0,
    deliveryAddress: null,
    ...overrides,
  };
}

function saleItems(from: number, count: number): SaleHistoryListItem[] {
  return Array.from({ length: count }, (_, index) =>
    saleItem({
      saleId: `sale-${from + index}`,
      localNumber: `LN-${from + index}`,
    }),
  );
}

function clientItem(
  overrides: Partial<ClientSearchResult> = {},
): ClientSearchResult {
  return {
    id: "client-1",
    fullName: "Ana Pérez",
    identificationType: "CC",
    identificationNumber: "123456789",
    email: null,
    phone: "3001234567",
    address: null,
    municipality: null,
    department: null,
    isActive: true,
    createdAt: new Date("2026-08-01T00:00:00"),
    updatedAt: new Date("2026-08-01T00:00:00"),
    creditLimit: null,
    ...overrides,
  };
}

interface ProductListItemInput {
  id: string;
  internalCode: string;
  commercialName: string;
  concentration: string | null;
  laboratory: string;
  categoryId: string | null;
  isActive: boolean;
  minimumStock: number;
  currentPrice: string | null;
  currentCost: string | null;
  barcodes: Array<{
    id: string;
    barcode: string;
    barcodeType: string;
    isPrimary: boolean;
  }>;
}

/** Structural subset of listProducts used by the products loader. */
type ListProductsMock = (params?: {
  query?: string;
  includeInactive?: boolean;
  categoryId?: string;
  limit?: number;
  offset?: number;
}) => Promise<{ items: ProductListItemInput[]; total: number }>;

function productItem(
  overrides: Partial<ProductListItemInput> = {},
): ProductListItemInput {
  return {
    id: "product-1",
    internalCode: "COD-001",
    commercialName: "Paracetamol 500mg",
    concentration: null,
    laboratory: "Genfar",
    categoryId: "cat-1",
    isActive: true,
    minimumStock: 10,
    currentPrice: "5500.00",
    currentCost: "3200.00",
    barcodes: [
      {
        id: "barcode-1",
        barcode: "7701234567890",
        barcodeType: "EAN13",
        isPrimary: true,
      },
    ],
    ...overrides,
  };
}

interface LotFixture {
  id: string;
  batchNumber: string;
  locationCode: string | null;
  currentStock: number;
  expirationDate: string;
  state: string;
  product: { commercialName: string; internalCode: string } | null;
}

function lotItem(overrides: Partial<LotFixture> = {}): LotFixture {
  return {
    id: "lot-1",
    batchNumber: "LOT-2026-01",
    locationCode: "A-01",
    currentStock: 120,
    expirationDate: "2027-08-01",
    state: "EXPIRING",
    product: { commercialName: "Paracetamol 500mg", internalCode: "COD-001" },
    ...overrides,
  };
}

function supplierItem(
  overrides: Partial<SupplierSearchResult> = {},
): SupplierSearchResult {
  return {
    id: "supplier-1",
    identificationType: "NIT",
    identificationNumber: "900123456",
    businessName: "Distribuidora Central",
    contactName: null,
    phone: "6012345678",
    email: null,
    address: null,
    city: "Bogotá",
    country: "Colombia",
    isActive: true,
    paymentTermsDays: 30,
    creditLimit: 5000000,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// SALES_HISTORY_EXPORT
// ---------------------------------------------------------------------------

describe("SALES_HISTORY_EXPORT", () => {
  it("paginates with an offset loop until the whole dataset is collected", async () => {
    const listConfirmedSales = vi.fn<
      ExportServiceContext["salesHistoryService"]["listConfirmedSales"]
    >(async (filters) => {
      const offset = filters?.offset ?? 0;
      const limit = filters?.limit ?? 500;
      if (offset >= 1200) {
        return { items: [], total: 1200 };
      }
      return {
        items: saleItems(offset, Math.min(limit, 1200 - offset)),
        total: 1200,
      };
    });
    const services = {
      salesHistoryService: { listConfirmedSales },
    } as unknown as ExportServiceContext;

    const rows = await SALES_HISTORY_EXPORT.load(services, {});

    expect(listConfirmedSales).toHaveBeenCalledTimes(3);
    expect(
      listConfirmedSales.mock.calls.map(([filters]) => filters?.offset),
    ).toEqual([0, 500, 1000]);
    expect(rows).toHaveLength(1200);
  });

  it("passes the screen filters through to listConfirmedSales", async () => {
    const since = new Date("2026-08-01T00:00:00");
    const until = new Date("2026-08-31T00:00:00");
    const listConfirmedSales = vi
      .fn<ExportServiceContext["salesHistoryService"]["listConfirmedSales"]>()
      .mockResolvedValue({ items: [saleItem()], total: 1 });
    const services = {
      salesHistoryService: { listConfirmedSales },
    } as unknown as ExportServiceContext;

    await SALES_HISTORY_EXPORT.load(services, {
      since,
      until,
      clientId: "client-7",
      query: "ana",
    });

    expect(listConfirmedSales).toHaveBeenCalledWith({
      since,
      until,
      clientId: "client-7",
      query: "ana",
      limit: 500,
      offset: 0,
    });
  });

  it("converts the delivery fee from COP cents to pesos", async () => {
    const listConfirmedSales = vi
      .fn<ExportServiceContext["salesHistoryService"]["listConfirmedSales"]>()
      .mockResolvedValue({
        items: [
          saleItem({
            deliveryFeeCents: 2500,
            clientIdentificationNumber: null,
            invoiceNumber: null,
            invoiceStatus: null,
          }),
        ],
        total: 1,
      });
    const services = {
      salesHistoryService: { listConfirmedSales },
    } as unknown as ExportServiceContext;

    const rows = await SALES_HISTORY_EXPORT.load(services, {});

    expect(rows[0]).toEqual({
      confirmedAt: "2026-08-21T10:00:00.000Z",
      localNumber: "LN-0001",
      clientName: "Ana Pérez",
      clientIdentificationNumber: "",
      totalAmount: "123456.78",
      invoiceNumber: "",
      invoiceStatus: "",
      deliveryFee: 25,
    });
  });

  it("builds metadata rows from the applied filters", () => {
    const since = new Date("2026-08-01T00:00:00");
    const until = new Date("2026-08-31T00:00:00");

    expect(
      SALES_HISTORY_EXPORT.metadata?.({ since, until, query: "ana" }),
    ).toEqual([
      ["export.meta.from", "Desde", since.toLocaleDateString("es-CO")],
      ["export.meta.to", "Hasta", until.toLocaleDateString("es-CO")],
      ["export.meta.search", "Búsqueda", "ana"],
    ]);
  });

  it("returns no metadata when no filters are applied", () => {
    expect(SALES_HISTORY_EXPORT.metadata?.({})).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// CLIENTS_EXPORT
// ---------------------------------------------------------------------------

describe("CLIENTS_EXPORT", () => {
  it("trims the query before delegating to listClients", async () => {
    const listClients = vi
      .fn<ExportServiceContext["clientsService"]["listClients"]>()
      .mockResolvedValue({ items: [clientItem()], total: 1 });
    const services = {
      clientsService: { listClients },
    } as unknown as ExportServiceContext;

    await CLIENTS_EXPORT.load(services, { query: "  ana  " });

    expect(listClients).toHaveBeenCalledWith({
      query: "ana",
      limit: 500,
      offset: 0,
    });
  });

  it("passes an undefined query when the search is blank", async () => {
    const listClients = vi
      .fn<ExportServiceContext["clientsService"]["listClients"]>()
      .mockResolvedValue({ items: [], total: 0 });
    const services = {
      clientsService: { listClients },
    } as unknown as ExportServiceContext;

    await CLIENTS_EXPORT.load(services, { query: "   " });

    expect(listClients).toHaveBeenCalledWith({
      query: undefined,
      limit: 500,
      offset: 0,
    });
  });

  it("maps client fields with empty-string fallbacks for null values", async () => {
    const listClients = vi
      .fn<ExportServiceContext["clientsService"]["listClients"]>()
      .mockResolvedValue({ items: [clientItem()], total: 1 });
    const services = {
      clientsService: { listClients },
    } as unknown as ExportServiceContext;

    const rows = await CLIENTS_EXPORT.load(services, {});

    expect(rows[0]).toEqual({
      fullName: "Ana Pérez",
      identificationType: "CC",
      identificationNumber: "123456789",
      email: "",
      phone: "3001234567",
      address: "",
      municipality: "",
      department: "",
      creditLimit: 0,
      isActive: true,
      createdAt: new Date("2026-08-01T00:00:00"),
    });
  });

  it("builds a metadata row only when a query is present", () => {
    expect(CLIENTS_EXPORT.metadata?.({ query: "  ana  " })).toEqual([
      ["export.meta.search", "Búsqueda", "ana"],
    ]);
    expect(CLIENTS_EXPORT.metadata?.({ query: "   " })).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// PRODUCTS_EXPORT
// ---------------------------------------------------------------------------

describe("PRODUCTS_EXPORT", () => {
  it("loads active and inactive products in one pass", async () => {
    const listProducts = vi
      .fn<ListProductsMock>()
      .mockResolvedValue({ items: [], total: 0 });
    const services = {
      productService: { listProducts },
    } as unknown as ExportServiceContext;

    await PRODUCTS_EXPORT.load(services, {});

    expect(listProducts).toHaveBeenCalledWith({
      includeInactive: true,
      limit: 500,
      offset: 0,
    });
  });

  it("filters out products from other categories", async () => {
    const listProducts = vi.fn<ListProductsMock>().mockResolvedValue({
      items: [
        productItem({ id: "p1", categoryId: "cat-1" }),
        productItem({ id: "p2", categoryId: "cat-2" }),
      ],
      total: 2,
    });
    const services = {
      productService: { listProducts },
    } as unknown as ExportServiceContext;

    const rows = await PRODUCTS_EXPORT.load(services, { categoryId: "cat-1" });

    expect(rows.map((row) => row.internalCode)).toEqual(["COD-001"]);
  });

  it("excludes inactive products unless showInactive is set", async () => {
    const listProducts = vi.fn<ListProductsMock>().mockResolvedValue({
      items: [productItem({ id: "p1", isActive: false })],
      total: 1,
    });
    const services = {
      productService: { listProducts },
    } as unknown as ExportServiceContext;

    const hidden = await PRODUCTS_EXPORT.load(services, {});
    const shown = await PRODUCTS_EXPORT.load(services, { showInactive: true });

    expect(hidden).toHaveLength(0);
    expect(shown).toHaveLength(1);
  });

  it.each([
    [{ commercialName: "Acetaminofén" }, "acetaminofén"],
    [{ internalCode: "COD-001" }, "cod-001"],
    [{ laboratory: "Genfar" }, "genfar"],
    [
      {
        barcodes: [
          {
            id: "b1",
            barcode: "7701234567890",
            barcodeType: "EAN13",
            isPrimary: true,
          },
        ],
      },
      "77012",
    ],
  ])("keeps products whose %o matches the query", async (overrides, query) => {
    const listProducts = vi.fn<ListProductsMock>().mockResolvedValue({
      items: [productItem(overrides as Partial<ProductListItemInput>)],
      total: 1,
    });
    const services = {
      productService: { listProducts },
    } as unknown as ExportServiceContext;

    const rows = await PRODUCTS_EXPORT.load(services, { query });

    expect(rows.map((row) => row.internalCode)).toEqual(["COD-001"]);
  });

  it("drops products that match no query field", async () => {
    const listProducts = vi.fn<ListProductsMock>().mockResolvedValue({
      items: [productItem({ commercialName: "Paracetamol 500mg" })],
      total: 1,
    });
    const services = {
      productService: { listProducts },
    } as unknown as ExportServiceContext;

    const rows = await PRODUCTS_EXPORT.load(services, { query: "zzz" });

    expect(rows).toHaveLength(0);
  });

  it("prefers the primary barcode over the first barcode", async () => {
    const listProducts = vi.fn<ListProductsMock>().mockResolvedValue({
      items: [
        productItem({
          barcodes: [
            {
              id: "b1",
              barcode: "111",
              barcodeType: "EAN13",
              isPrimary: false,
            },
            { id: "b2", barcode: "222", barcodeType: "EAN13", isPrimary: true },
          ],
        }),
      ],
      total: 1,
    });
    const services = {
      productService: { listProducts },
    } as unknown as ExportServiceContext;

    const rows = await PRODUCTS_EXPORT.load(services, {});

    expect(rows[0].primaryBarcode).toBe("222");
  });

  it("falls back to an empty barcode when the product has none", async () => {
    const listProducts = vi.fn<ListProductsMock>().mockResolvedValue({
      items: [productItem({ barcodes: [] })],
      total: 1,
    });
    const services = {
      productService: { listProducts },
    } as unknown as ExportServiceContext;

    const rows = await PRODUCTS_EXPORT.load(services, {});

    expect(rows[0].primaryBarcode).toBe("");
  });

  it("maps product fields with defaults for missing values", async () => {
    const listProducts = vi.fn<ListProductsMock>().mockResolvedValue({
      items: [
        productItem({
          concentration: null,
          currentPrice: null,
          currentCost: null,
        }),
      ],
      total: 1,
    });
    const services = {
      productService: { listProducts },
    } as unknown as ExportServiceContext;

    const rows = await PRODUCTS_EXPORT.load(services, {});

    expect(rows[0]).toEqual({
      internalCode: "COD-001",
      commercialName: "Paracetamol 500mg",
      concentration: "",
      laboratory: "Genfar",
      primaryBarcode: "7701234567890",
      currentPrice: 0,
      currentCost: 0,
      minimumStock: 10,
      isActive: true,
    });
  });
});

// ---------------------------------------------------------------------------
// INVENTORY_LOTS_EXPORT
// ---------------------------------------------------------------------------

/** Structural subset of getLots used by the inventory-lots loader. */
type GetLotsMock = (params?: {
  productId?: string;
  search?: string;
  state?: string;
}) => Promise<LotFixture[]>;

describe("INVENTORY_LOTS_EXPORT", () => {
  it("delegates the search and state filters to getLots", async () => {
    const getLots = vi.fn<GetLotsMock>().mockResolvedValue([]);
    const services = {
      inventoryLotsService: { getLots },
    } as unknown as ExportServiceContext;

    await INVENTORY_LOTS_EXPORT.load(services, {
      search: "  exp  ",
      state: "EXPIRING",
    });

    expect(getLots).toHaveBeenCalledWith({
      search: "exp",
      state: "EXPIRING",
    });
  });

  it("omits a blank search from the getLots call", async () => {
    const getLots = vi.fn<GetLotsMock>().mockResolvedValue([]);
    const services = {
      inventoryLotsService: { getLots },
    } as unknown as ExportServiceContext;

    await INVENTORY_LOTS_EXPORT.load(services, { search: "   " });

    expect(getLots).toHaveBeenCalledWith({
      search: undefined,
      state: undefined,
    });
  });

  it("flattens each lot to one row using the product names", async () => {
    const getLots = vi.fn<GetLotsMock>().mockResolvedValue([
      lotItem(),
      lotItem({
        id: "lot-2",
        product: null,
        locationCode: null,
      }),
    ]);
    const services = {
      inventoryLotsService: { getLots },
    } as unknown as ExportServiceContext;

    const rows = await INVENTORY_LOTS_EXPORT.load(services, {});

    expect(rows).toEqual([
      {
        commercialName: "Paracetamol 500mg",
        internalCode: "COD-001",
        batchNumber: "LOT-2026-01",
        locationCode: "A-01",
        currentStock: 120,
        expirationDate: "2027-08-01",
        state: "EXPIRING",
      },
      {
        commercialName: "",
        internalCode: "",
        batchNumber: "LOT-2026-01",
        locationCode: "",
        currentStock: 120,
        expirationDate: "2027-08-01",
        state: "EXPIRING",
      },
    ]);
  });

  it("builds metadata rows from the search and state filters", () => {
    expect(
      INVENTORY_LOTS_EXPORT.metadata?.({
        search: "  paracetamol  ",
        state: "EXPIRING",
      }),
    ).toEqual([
      ["export.meta.search", "Búsqueda", "paracetamol"],
      ["export.meta.state", "Estado", "EXPIRING"],
    ]);
    expect(INVENTORY_LOTS_EXPORT.metadata?.({})).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// SUPPLIERS_EXPORT
// ---------------------------------------------------------------------------

describe("SUPPLIERS_EXPORT", () => {
  it("collects every page until the dataset is fully read", async () => {
    const listSuppliers = vi.fn<
      ExportServiceContext["suppliersService"]["listSuppliers"]
    >(async (filters) => {
      const page = filters?.page ?? 1;
      const pageSize = filters?.pageSize ?? 500;
      const from = (page - 1) * pageSize;
      if (from >= 1200) {
        return { data: [], total: 1200 };
      }
      return {
        data: Array.from({ length: Math.min(pageSize, 1200 - from) }, (_, i) =>
          supplierItem({ id: `supplier-${from + i}` }),
        ),
        total: 1200,
      };
    });
    const services = {
      suppliersService: { listSuppliers },
    } as unknown as ExportServiceContext;

    const rows = await SUPPLIERS_EXPORT.load(services, {});

    expect(listSuppliers).toHaveBeenCalledTimes(3);
    expect(listSuppliers.mock.calls.map(([filters]) => filters?.page)).toEqual([
      1, 2, 3,
    ]);
    expect(rows).toHaveLength(1200);
  });

  it("passes the trimmed search and active state through", async () => {
    const listSuppliers = vi
      .fn<ExportServiceContext["suppliersService"]["listSuppliers"]>()
      .mockResolvedValue({ data: [supplierItem()], total: 1 });
    const services = {
      suppliersService: { listSuppliers },
    } as unknown as ExportServiceContext;

    await SUPPLIERS_EXPORT.load(services, {
      search: "  dist  ",
      isActive: true,
    });

    expect(listSuppliers).toHaveBeenCalledWith({
      search: "dist",
      isActive: true,
      page: 1,
      pageSize: 500,
    });
  });

  it("maps supplier fields with empty-string fallbacks for null values", async () => {
    const listSuppliers = vi
      .fn<ExportServiceContext["suppliersService"]["listSuppliers"]>()
      .mockResolvedValue({ data: [supplierItem()], total: 1 });
    const services = {
      suppliersService: { listSuppliers },
    } as unknown as ExportServiceContext;

    const rows = await SUPPLIERS_EXPORT.load(services, {});

    expect(rows[0]).toEqual({
      businessName: "Distribuidora Central",
      identificationType: "NIT",
      identificationNumber: "900123456",
      contactName: "",
      phone: "6012345678",
      email: "",
      city: "Bogotá",
      country: "Colombia",
      address: "",
      paymentTermsDays: 30,
      creditLimit: 5000000,
      isActive: true,
    });
  });
});
