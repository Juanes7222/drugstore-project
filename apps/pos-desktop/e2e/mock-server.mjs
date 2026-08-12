/**
 * Deterministic HTTP mock of the NestJS backend for Tauri e2e tests.
 *
 * Serves the endpoints the POS desktop calls at boot and during a sale:
 *   - POST /auth/login
 *   - GET  /configuration/pos-settings   (payment methods fed to PGlite)
 *   - GET  /catalog/categories, /catalog/pharmaceutical-forms, /catalog/tax-schemes
 *   - GET  /catalog/products/sync        (cursor-paginated product pull)
 *   - GET  /inventory-lots/lots/sync     (lots with stock)
 *   - GET  /clients/classifications/all, /clients/sync
 *   - POST /sync/batch
 *
 * The mock is intentionally minimal: it returns the same payloads every run
 * so e2e tests are deterministic. It listens on port 3000, which matches the
 * app's VITE_API_BASE_URL default.
 */
import { createServer } from "node:http";
import { execSync } from "node:child_process";

const PORT = 3000;

/**
 * Free the mock port before listening. Orphaned wdio/mock processes from
 * interrupted runs can keep listening on :3000, which made startMockServer
 * fail with EADDRINUSE and left the app showing "Error de conexión".
 * This only kills the process bound to our mock port on the test machine.
 */
function killProcessOnPort(port) {
  try {
    const out = execSync(
      `netstat -ano | findstr :${port} | findstr LISTENING`,
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
    for (const line of out.split(/\r?\n/)) {
      const pid = line.trim().split(/\s+/).pop();
      if (pid && /^\d+$/.test(pid)) {
        try {
          execSync(`taskkill /F /PID ${pid}`, { stdio: "ignore" });
          // eslint-disable-next-line no-console
          console.log(`[e2e-mock] killed stale process ${pid} on :${port}`);
        } catch {
          // Already gone
        }
      }
    }
  } catch {
    // No process bound — nothing to do
  }
}

// ---------------------------------------------------------------------------
// Seed data — mirrors the server's seed so the POS behaves like production.
// ---------------------------------------------------------------------------

/** Payment methods as `GET /configuration/pos-settings` returns them. */
const PAYMENT_METHODS = [
  {
    id: "pm-cash",
    internalCode: "EFECTIVO",
    name: "Efectivo",
    dianCode: "01",
    category: "CASH",
    isCash: true,
    sortOrder: 1,
    isActive: true,
  },
  {
    id: "pm-debit",
    internalCode: "TARJETA_DEBITO",
    name: "Tarjeta Débito",
    dianCode: "02",
    category: "DEBIT_CARD",
    isCash: false,
    sortOrder: 2,
    isActive: true,
  },
  {
    id: "pm-transfer",
    internalCode: "TRANSFERENCIA",
    name: "Transferencia",
    dianCode: "03",
    category: "BANK_TRANSFER",
    isCash: false,
    sortOrder: 3,
    isActive: true,
  },
  {
    id: "pm-nequi",
    internalCode: "NEQUI",
    name: "Nequi",
    dianCode: "04",
    category: "DIGITAL_WALLET",
    isCash: false,
    sortOrder: 4,
    isActive: true,
  },
];

const NOW = new Date().toISOString();

const roleLimits = {
  itemMaxPercent: 10,
  globalMaxPercent: 20,
};

const priceOverride = { allowed: false, requireReason: false };

/** `GET /configuration/pos-settings` payload — feeds PaymentMethodSyncService. */
const POS_SETTINGS = {
  paymentMethods: PAYMENT_METHODS,
  discountLimits: {
    owner: roleLimits,
    manager: roleLimits,
    cashier: roleLimits,
    admin: roleLimits,
    inventoryAssistant: roleLimits,
    accountant: roleLimits,
  },
  salesConfig: {
    priceOverridePermissions: {
      manager: { allowed: true, requireReason: true },
      cashier: priceOverride,
      inventoryAssistant: priceOverride,
      accountant: priceOverride,
    },
    priceFloor: { enabled: false, type: "COST", minMarginPercent: 0 },
  },
  alertThresholds: {
    expirationWarningDays: 30,
    lowStockAlertEnabled: true,
  },
  syncDefaults: {
    batchSize: 100,
    maxRetryAttempts: 3,
    retryDelaysSeconds: [5, 10, 30],
  },
};

/** Two catalog products with price/tax history and a stock lot each. */
const PRODUCTS = [
  {
    id: "prod-acetaminofen",
    internalCode: "ACETAMIN-500",
    commercialName: "Acetaminofén 500mg",
    concentration: "500mg",
    concentrationUnit: "tableta",
    laboratory: "Laboratorio Farmacéutico S.A.",
    saleType: "FREE_SALE",
    minimumStock: 10,
    isActive: true,
    invimaRegistry: "INVIMA-2023-0001",
    categoryId: null,
    pharmaceuticalFormId: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: NOW,
    createdById: "user-seed",
    barcodes: [
      {
        id: "bc-acetaminofen",
        barcode: "7701234567890",
        barcodeType: "EAN13",
        isPrimary: true,
      },
    ],
    currentPrice: {
      id: "ph-acetaminofen",
      productId: "prod-acetaminofen",
      price: "500.00",
      effectiveFrom: "2026-01-01T00:00:00.000Z",
      effectiveTo: null,
      changedById: "user-seed",
      changedAt: NOW,
      changeReason: null,
      previousPriceHistoryId: null,
    },
    currentTax: {
      id: "th-acetaminofen",
      productId: "prod-acetaminofen",
      taxSchemeId: "ts-iva-0",
      effectiveFrom: "2026-01-01T00:00:00.000Z",
      effectiveTo: null,
      changedById: "user-seed",
      changedAt: NOW,
      changeReason: null,
      previousTaxHistoryId: null,
    },
  },
  {
    id: "prod-ibuprofeno",
    internalCode: "IBUPROF-400",
    commercialName: "Ibuprofeno 400mg",
    concentration: "400mg",
    concentrationUnit: "tableta",
    laboratory: "Laboratorio Farmacéutico S.A.",
    saleType: "FREE_SALE",
    minimumStock: 5,
    isActive: true,
    invimaRegistry: "INVIMA-2023-0002",
    categoryId: null,
    pharmaceuticalFormId: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: NOW,
    createdById: "user-seed",
    barcodes: [
      {
        id: "bc-ibuprofeno",
        barcode: "7701234567891",
        barcodeType: "EAN13",
        isPrimary: true,
      },
    ],
    currentPrice: {
      id: "ph-ibuprofeno",
      productId: "prod-ibuprofeno",
      price: "350.00",
      effectiveFrom: "2026-01-01T00:00:00.000Z",
      effectiveTo: null,
      changedById: "user-seed",
      changedAt: NOW,
      changeReason: null,
      previousPriceHistoryId: null,
    },
    currentTax: {
      id: "th-ibuprofeno",
      productId: "prod-ibuprofeno",
      taxSchemeId: "ts-iva-0",
      effectiveFrom: "2026-01-01T00:00:00.000Z",
      effectiveTo: null,
      changedById: "user-seed",
      changedAt: NOW,
      changeReason: null,
      previousPriceHistoryId: null,
    },
  },
];

// LotState local enum is ACTIVE | EXHAUSTED | EXPIRED | BLOCKED — the sync
// persists the server state as-is, and the catalog only counts ACTIVE lots
// as sellable stock. "AVAILABLE" (the server seed) must be sent as "ACTIVE"
// so products have currentStock > 0 and hasCompleteData is true.
const LOTS = [
  {
    id: "lot-acetaminofen",
    batchNumber: "LOT-001",
    expirationDate: "2027-06-01T00:00:00.000Z",
    entryDate: "2026-01-15T00:00:00.000Z",
    state: "ACTIVE",
    currentStock: 100,
    version: 1,
    productId: "prod-acetaminofen",
    locationCode: "A-01",
    createdAt: "2026-01-15T00:00:00.000Z",
    updatedAt: NOW,
    blockedAt: null,
    blockedByUserId: null,
    blockReason: null,
  },
  {
    id: "lot-ibuprofeno",
    batchNumber: "LOT-002",
    expirationDate: "2027-07-01T00:00:00.000Z",
    entryDate: "2026-01-15T00:00:00.000Z",
    state: "ACTIVE",
    currentStock: 80,
    version: 1,
    productId: "prod-ibuprofeno",
    locationCode: "A-02",
    createdAt: "2026-01-15T00:00:00.000Z",
    updatedAt: NOW,
    blockedAt: null,
    blockedByUserId: null,
    blockReason: null,
  },
];

const TAX_SCHEMES = [
  {
    id: "ts-iva-0",
    code: "IVA0",
    name: "IVA 0%",
    taxType: "IVA",
    rate: 0,
    effectiveFrom: "2026-01-01T00:00:00.000Z",
    effectiveTo: null,
    isActive: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: NOW,
    createdById: "user-seed",
  },
];

const LOGIN_RESPONSE = {
  accessToken: "e2e-mock-access-token",
  refreshToken: "e2e-mock-refresh-token",
  user: {
    id: "user-carlos",
    fullName: "Carlos López",
    role: "CASHIER",
    username: "carlos.lopez",
    avatarUrl: null,
  },
  workstationId: "ws_principal",
  requiresTwoFactor: false,
};

/**
 * Pick the login response by the requested identifier so e2e can exercise
 * role-gated flows (e.g. unverified returns need ADMIN).
 */
function loginResponseFor(identifier = "") {
  const lower = String(identifier).toLowerCase();
  if (lower.includes("admin")) {
    return {
      accessToken: "e2e-mock-admin-token",
      refreshToken: "e2e-mock-refresh-admin",
      user: {
        id: "user-admin",
        fullName: "Administradora Principal",
        role: "ADMIN",
        username: "admin",
        avatarUrl: null,
      },
      workstationId: "ws_principal",
      requiresTwoFactor: false,
    };
  }
  return LOGIN_RESPONSE;
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(raw || "{}"));
      } catch {
        resolve({});
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

function json(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  });
  res.end(JSON.stringify(body));
}

async function route(req, res) {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const { pathname } = url;
  const method = (req.method ?? "GET").toUpperCase();
  // eslint-disable-next-line no-console
  console.log(`[e2e-mock] ${new Date().toISOString()} ${method} ${pathname}`);
  // CORS preflight
  if (method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    });
    res.end();
    return;
  }

  // POST /auth/login
  if (method === "POST" && pathname === "/auth/login") {
    const body = await readBody(req);
    json(res, 200, loginResponseFor(body.identifier));
    return;
  }

  // GET /configuration/pos-settings
  if (method === "GET" && pathname === "/configuration/pos-settings") {
    json(res, 200, POS_SETTINGS);
    return;
  }

  // Catalog reference data
  if (method === "GET" && pathname === "/catalog/categories") {
    json(res, 200, []);
    return;
  }
  if (method === "GET" && pathname === "/catalog/pharmaceutical-forms") {
    json(res, 200, []);
    return;
  }
  if (method === "GET" && pathname === "/catalog/tax-schemes") {
    json(res, 200, TAX_SCHEMES);
    return;
  }

  // GET /catalog/products/sync — cursor-paginated (single page, no cursor)
  if (method === "GET" && pathname === "/catalog/products/sync") {
    json(res, 200, { items: PRODUCTS, nextCursor: null, hasMore: false });
    return;
  }

  // GET /inventory-lots/lots/sync — single page. NOTE: the app's
  // lot-sync fetchAllLots reads `response.data` (not `items` — the product
  // sync reads `items`), so the payload key must be `data` here.
  if (method === "GET" && pathname === "/inventory-lots/lots/sync") {
    json(res, 200, { data: LOTS, nextCursor: null, hasMore: false });
    return;
  }

  // GET /clients/classifications/all
  if (method === "GET" && pathname === "/clients/classifications/all") {
    json(res, 200, []);
    return;
  }

  // GET /clients/sync — paginated
  if (method === "GET" && pathname === "/clients/sync") {
    json(res, 200, { data: [], total: 0, page: 1, pageSize: 200 });
    return;
  }

  // POST /sync/batch — accept anything the POS pushes
  if (method === "POST" && pathname === "/sync/batch") {
    json(res, 200, { accepted: [], rejected: [], serverTime: NOW });
    return;
  }

  // Unknown endpoint — 404 JSON so fetch never crashes the app
  json(res, 404, { message: `e2e mock: unknown route ${method} ${pathname}` });
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

let server;

export function startMockServer() {
  return new Promise((resolve, reject) => {
    killProcessOnPort(PORT);
    server = createServer(route);
    server.once("error", reject);
    server.listen(PORT, () => {
      // eslint-disable-next-line no-console
      console.log(`[e2e-mock] backend mock listening on http://localhost:${PORT}`);
      resolve();
    });
  });
}

export function stopMockServer() {
  return new Promise((resolve) => {
    if (!server) {
      resolve();
      return;
    }
    server.close(() => resolve());
    server = undefined;
  });
}

// Allow standalone run: `node e2e/mock-server.mjs`
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"))) {
  startMockServer();
}
