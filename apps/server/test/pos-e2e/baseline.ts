/**
 * Server-side fixture world for the POS Tauri e2e suite.
 *
 * The Tauri specs drive the real desktop binary against the REAL NestJS
 * backend (no HTTP mock), so this module is the only place that decides what
 * the server knows before a spec runs. Everything the POS pulls during its
 * boot sync must exist here: users, workstation, tax scheme, catalog with
 * price/tax history, lots with a real acquisition cost, payment methods and an
 * active DIAN resolution allocated to the workstation.
 *
 * Two rules keep the suite trustworthy:
 *
 * 1. `resetBaseline` truncates every table instead of deleting rows one model
 *    at a time. A hand-maintained delete list silently rots: a new FK added to
 *    Sale next quarter leaves a leftover row behind and the next spec fails far
 *    from the cause. TRUNCATE ... CASCADE cannot rot that way.
 *
 * 2. Every id is a hardcoded constant, shared with the assertions in
 *    apps/pos-desktop/e2e/server-state.ts. Both sides agree on identity without
 *    either side discovering it at runtime.
 */
import { Prisma, type PrismaClient } from "@prisma/client";
import * as argon2 from "argon2";
import { seedSubscription } from "../helpers/subscription-seed";

// ---------------------------------------------------------------------------
// Identities — must match the POS e2e build
// ---------------------------------------------------------------------------

/**
 * Workstation the POS reports on every request.
 *
 * MUST equal VITE_WORKSTATION_ID in the e2e build (see the `test:e2e` script in
 * apps/pos-desktop/package.json). It is pinned rather than left to the app's
 * generated uuid because the DIAN consecutive is allocated per workstation:
 * a random id would have no allocation and every sale would fail at fiscal
 * document generation instead of exercising the real path.
 */
export const WORKSTATION_ID = "8f3a1c40-5d62-4e11-9a77-2b6d0e4f8c31";
export const WORKSTATION_CODE = "WS-POS-E2E-001";
export const WORKSTATION_NAME = "POS E2E Workstation";

// The POS login form is email-based (see the "usuario@ejemplo.com" input), so
// the fixture users need an email like every seeded user does. Without it the
// login is rejected by LoginSchema before authentication is even attempted.
export const CASHIER = {
  username: "carlos.lopez",
  email: "carlos.lopez@pos-e2e.local",
  password: "123456",
};
/** ADMIN because an unverified client return requires a manager authorisation. */
export const ADMIN = {
  username: "admin",
  email: "admin@pos-e2e.local",
  password: "123456",
};
/**
 * OWNER, needed for the flows ADMIN is not authorised for.
 *
 * Two server-side gates make this unavoidable rather than convenient:
 *
 *   - `POST|PATCH|DELETE /users*` are `@Roles(OWNER, MANAGER)`, so the
 *     user-management screen 403s for an ADMIN session; and
 *   - `resolvePriceOverrideRoleKey` (sales-pricing-validator.ts) has no ADMIN
 *     branch and returns null, which `validateItemPricing` turns into
 *     PriceOverrideNotAllowedForRoleException — even though `CartLineItem`
 *     still renders the editable price control for ADMIN.
 *
 * OWNER is the only role that clears both: it passes every users guard and is
 * the single role `validateItemPricing` exempts from the override check. See
 * the role-duplication note in apps/pos-desktop/e2e/users-flow.e2e.ts.
 */
export const OWNER = {
  username: "owner",
  email: "owner@pos-e2e.local",
  password: "123456",
  displayName: "Dueña E2E",
};

const CASHIER_ID = "1c9d2b8e-7f43-4a6d-b0c1-3e5a9d2f7b64";
const ADMIN_ID = "4e8b0a3f-6d25-4c91-8f7b-0a2d6e1c9d53";
const OWNER_ID = "0f3a7c48-5b91-4d6e-8a72-1b2c3d4e5f60";

export const TAX_SCHEME_ID = "7d1f4c60-2b98-4e35-9a0d-6c8b3e5f1d27";
export const TAX_RATE_PERCENT = "19";

export const PRODUCT_ACETAMINOFEN = "b2e6d814-5c93-4f27-a1d8-3e7c9b0f5a62";
export const PRODUCT_IBUPROFENO = "5a1c8f37-9d24-4e68-b3c1-7f0a2d6e4b98";
export const PRODUCT_NITROFEN = "9e3d5a26-1b47-4f80-8a52-6c7d8e9f0a13";
export const PRODUCT_OTRIVIN = "7c4b6e38-2d59-4a91-b0e3-5f6a7b8c9d24";

export const LOT_ACETAMINOFEN = "c4a1f592-8e37-4d6b-9e25-1a3f7c0d8b45";
export const LOT_IBUPROFENO = "d8b2e071-4f63-4a19-8c37-6e0d5a9f2c14";
export const LOT_NITROFEN = "3f5a7c49-6b08-4d2e-a1c5-8e9f0a1b2c37";
export const LOT_OTRIVIN = "a8b9c0d1-4e2f-4a3b-9c4d-0e1f2a3b4c58";

/**
 * Days until expiry for the two extra catalog entries.
 *
 * These are the only fixture dates expressed as an OFFSET rather than a fixed
 * calendar date, because they are exactly what the specs under test:
 *
 *   - the sales-side `isNearExpiry` warns inside a 30-day window, so 15 days
 *     out must produce the "VENCE PRONTO" badge; and
 *   - an ALREADY expired lot is a separate case, because `isNearExpiry`
 *     returns false for `diffDays < 0` and nothing in the app transitions a
 *     lot's state on expiry. So the expired lot is seeded with `state: ACTIVE`
 *     to reproduce what the database really looks like the day after a lot
 *     expires.
 *
 * A fixed date would silently stop testing this the day it passes.
 */
export const NEAR_EXPIRY_DAYS = 15;
export const ALREADY_EXPIRED_DAYS = -10;

/** Both products share this single cash method; the picker sorts by sortOrder. */
export const PM_CASH_ID = "e5c3a186-2d74-4b90-8f16-3a9d7e0b5c82";
export const PM_DEBIT_ID = "f1d4b297-6a85-4e23-9b40-7c2e8a1d6f53";
export const PM_TRANSFER_ID = "a6e5c308-1f96-4d47-8a25-3b0d9c7e2f64";
export const PM_NEQUI_ID = "b7f6d419-2a07-4e58-9b36-4c1e0d8f3a75";

export const RESOLUTION_ID = "c8a7e520-3b18-4f69-ac47-5d2f1b9e4a86";
export const ALLOCATION_ID = "d9b8f631-4c29-4a7a-bd58-6e3a2c0f5b97";
export const RESOLUTION_NUMBER = "18764000000001";
export const RESOLUTION_PREFIX = "POSE2E";

export const CREDIT_NOTE_RESOLUTION_ID = "b2c3d4e5-6f70-4a81-9b2c-3d4e5f6a7b8c";
export const CREDIT_NOTE_ALLOCATION_ID = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
export const CREDIT_NOTE_RESOLUTION_NUMBER = "18764000000002";
export const CREDIT_NOTE_RESOLUTION_PREFIX = "POSE2EC";

export const LOCATION_ID = "e7c9a742-5d38-4b6e-8c14-2f5b3d9e6a08";
export const ACTIVATION_ID = "f8d0b853-6e49-4c7f-9d25-3a6c4e0f7b19";
/**
 * Fixed singleton ids. FiscalIssuerConfigService.find() looks the row up by
 * `FISCAL_ISSUER_CONFIG_ID` alone, so any other id is invisible to the API and
 * the POS stays on the company-setup gate forever.
 *
 * Keep in sync with apps/server/src/modules/fiscal-dian/constants/
 * fiscal-singleton-ids.ts.
 */
export const ISSUER_CONFIG_ID = "00000000-0000-0000-0000-000000000001";
export const ISSUER_NIT = "900123456-7";
export const TECH_PROVIDER_CONFIG_ID = "00000000-0000-0000-0000-000000000002";

/**
 * Hardware fingerprint the POS reports. Only has to be stable, not secret: the
 * server matches the activation by workstation name (ActivationsService
 * .getStatusByWorkstation), and this value travels in the license token.
 */
export const HARDWARE_FINGERPRINT = "e2e-pos-fingerprint";

/** Lot unit cost. The server refuses to replay a sale whose lot has no cost. */
export const LOT_UNIT_COST = new Prisma.Decimal("8000");
export const INITIAL_STOCK = 100;

/**
 * Prices are chosen so every expected total lands on a whole peso: the payment
 * screen displays whole pesos, so a total ending in cents would be rounded on
 * screen and the tendered amount would no longer reconcile to the server total
 * (500 -> 595, 400 -> 476).
 */
export const PRODUCTS = [
  {
    id: PRODUCT_ACETAMINOFEN,
    internalCode: "ACETAMIN-500",
    commercialName: "Acetaminofén 500mg",
    price: "500.00",
    lotId: LOT_ACETAMINOFEN,
    lotNumber: "LOT-001",
    /** Days from "now" to the lot's expiration; omitted means a far-future date. */
    expiresInDays: undefined as number | undefined,
  },
  {
    id: PRODUCT_IBUPROFENO,
    internalCode: "IBUPROF-400",
    commercialName: "Ibuprofeno 400mg",
    price: "400.00",
    lotId: LOT_IBUPROFENO,
    lotNumber: "LOT-002",
    expiresInDays: undefined as number | undefined,
  },
  {
    id: PRODUCT_NITROFEN,
    internalCode: "NITROFEN-500",
    commercialName: "Nitrofen 500mg",
    price: "500.00",
    lotId: LOT_NITROFEN,
    lotNumber: "LOT-003",
    expiresInDays: NEAR_EXPIRY_DAYS,
  },
  {
    id: PRODUCT_OTRIVIN,
    internalCode: "OTRIVIN-100",
    commercialName: "Otrivin 100mcg",
    price: "500.00",
    lotId: LOT_OTRIVIN,
    lotNumber: "LOT-004",
    expiresInDays: ALREADY_EXPIRED_DAYS,
  },
] as const;

/**
 * Fixed far-future expiration for the products that are not about expiry.
 *
 * Kept as a constant so the lot and its purchase-reception item always agree;
 * the seeded reception is what gives every lot its unit cost, and the server
 * refuses to replay a sale whose lot has no cost.
 */
const FAR_FUTURE_EXPIRATION = new Date("2030-06-01");

/** Resolve a product's lot expiration from its offset, if it has one. */
function expirationFor(expiresInDays: number | undefined): Date {
  if (expiresInDays === undefined) return FAR_FUTURE_EXPIRATION;
  const date = new Date();
  date.setDate(date.getDate() + expiresInDays);
  // Noon avoids a UTC-vs-local shift moving the day across the boundary.
  date.setHours(12, 0, 0, 0);
  return date;
}

const SUPPLIER_ID = "eac70d52-7d48-4b03-9e6f-1c4b8a2d6e09";
const RECEPTION_ID = "fbd81e63-8e59-4c14-af70-2d5c9b3e7f1a";

/**
 * One reception item per catalog entry, in PRODUCTS order.
 *
 * Indexed rather than named per product so adding a catalog entry cannot
 * silently skip the reception row — a lot with no reception item has no unit
 * cost, and the server then rejects every sale of it with
 * LotCostUnavailableException, which reads like a sales bug rather than a
 * fixture gap.
 */
const RECEPTION_ITEM_IDS = [
  "ace92f74-9f6a-4d25-b081-3e6d4ac4f8a2b",
  "bdfa3085-307b-4e36-c192-4f7ebd509b3c",
  "cf0b4196-418a-4f47-d2a3-5a8b9c0d1e2f",
  "d0c15207-529b-4068-e3b4-6b9c0d1e2f3a",
] as const;

/**
 * First of the per-position EAN13 barcodes.
 *
 * Derived from the catalog index rather than named per product so two entries
 * can never collide — a duplicate barcode makes the POS search resolve to an
 * arbitrary one of them and every product assertion becomes ambiguous.
 */
const BARCODE_BASE = 7_701_234_567_890;

/**
 * A client the POS can actually find.
 *
 * The previous mock returned an empty client list, so the client-lookup spec
 * only ever exercised the "no results" branch. With a real server the lookup is
 * a genuine indexed query over the pull endpoint, which is worth covering.
 */
export const CLIENT_ID = "c90a1e85-4f3b-4d69-b8a2-5e6c7d8f9a01";
export const CLIENT_IDENTIFICATION = "900123456-7";
export const CLIENT_NAME = "Cliente de Prueba E2E";

/**
 * Fixed UUID of the generic consumer the POS seeds locally.
 *
 * Must match the id in apps/pos-desktop/src/infrastructure/local-database.ts
 * and the seed migration it references (apps/server, 20260730000001).
 */
export const GENERIC_CLIENT_ID = "00000000-0000-0000-0000-000000000001";
export const GENERIC_CLIENT_IDENTIFICATION = "222222222222";

/**
 * A second workstation with one confirmed sale of its own.
 *
 * `ReturnsService.confirm` only requires the manager override when the sale's
 * workstation differs from the session's, so this is what lets the suite cover
 * the cross-workstation branch that the unverified return tab exists for.
 */
export const FOREIGN_WORKSTATION_ID = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
export const FOREIGN_WORKSTATION_CODE = "WS-POS-E2E-002";
export const FOREIGN_SHIFT_ID = "2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e";
export const FOREIGN_SALE_ID = "3c4d5e6f-7a8b-4c9d-0e1f-2a3b4c5d6e7f";
export const FOREIGN_SALE_ITEM_ID = "4d5e6f7a-8b9c-4d0e-1f2a-3b4c5d6e7f8a";
export const FOREIGN_SALE_ITEM_LOT_ID = "5e6f7a8b-9c0d-4e1f-2a3b-4c5d6e7f8a9b";
export const FOREIGN_SALE_PAYMENT_ID = "6f7a8b9c-0d1e-4f2a-3b4c-5d6e7f8a9b0c";
export const FOREIGN_SALE_INVOICE_ID = "7a8b9c0d-1e2f-4a3b-4c5d-6e7f8a9b0c1d";
/** Distinct from the POS's own sequential numbering (1..n). */
export const FOREIGN_SALE_LOCAL_NUMBER = 9001;

export const SUBSCRIPTION_SUFFIX = "pos-e2e";

// ---------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------

type PrismaLike = PrismaClient;

/**
 * Wipe every table and rebuild the baseline world.
 *
 * Idempotent: safe to call before the app boots and again between specs.
 */
export async function resetBaseline(prisma: PrismaLike): Promise<void> {
  await truncateAllTables(prisma);

  const subscriptionId = await seedSubscription(prisma, SUBSCRIPTION_SUFFIX);

  await prisma.workstation.create({
    data: {
      id: WORKSTATION_ID,
      name: WORKSTATION_NAME,
      code: WORKSTATION_CODE,
      isActive: true,
      registeredAt: new Date(),
    },
  });

  const [cashierHash, adminHash, ownerHash] = await Promise.all([
    argon2.hash(CASHIER.password),
    argon2.hash(ADMIN.password),
    argon2.hash(OWNER.password),
  ]);

  await prisma.user.create({
    data: {
      id: CASHIER_ID,
      username: CASHIER.username,
      email: CASHIER.email,
      fullName: "Carlos López",
      passwordHash: cashierHash,
      passwordAlgorithm: "argon2",
      role: "CASHIER",
      status: "ACTIVE",
      // Required: AuthService throws EmailNotVerifiedException on a password
      // login for an account whose email is not verified. Left unset, every
      // login is rejected and the app never leaves the login screen — which
      // reads like a driver problem rather than a fixture one.
      emailVerifiedAt: new Date("2026-01-01"),
      subscriptionId,
      isActive: true,
    },
  });

  await prisma.user.create({
    data: {
      id: ADMIN_ID,
      username: ADMIN.username,
      email: ADMIN.email,
      fullName: "Administradora Principal",
      passwordHash: adminHash,
      passwordAlgorithm: "argon2",
      role: "ADMIN",
      status: "ACTIVE",
      emailVerifiedAt: new Date("2026-01-01"),
      subscriptionId,
      isActive: true,
    },
  });

  // No PIN: the spec switches to this account through the QuickSwitch password
  // panel, which the component reaches by default for any role that is neither
  // CASHIER nor MANAGER. A PIN here would put a keypad in front of the switch.
  await prisma.user.create({
    data: {
      id: OWNER_ID,
      username: OWNER.username,
      email: OWNER.email,
      fullName: OWNER.displayName,
      passwordHash: ownerHash,
      passwordAlgorithm: "argon2",
      role: "OWNER",
      status: "ACTIVE",
      emailVerifiedAt: new Date("2026-01-01"),
      subscriptionId,
      isActive: true,
    },
  });

  await prisma.taxScheme.create({
    data: {
      id: TAX_SCHEME_ID,
      subscriptionId,
      code: "IVA19",
      name: "IVA 19%",
      taxType: "IVA",
      rate: new Prisma.Decimal(TAX_RATE_PERCENT),
      effectiveFrom: new Date("2024-01-01"),
      isActive: true,
      createdById: ADMIN_ID,
    },
  });

  // A supplier and a confirmed reception are what give each lot its unit cost.
  // Without them the server rejects the replayed sale with
  // LotCostUnavailableException, so they are part of the baseline, not extras.
  await prisma.supplier.create({
    data: {
      id: SUPPLIER_ID,
      subscriptionId,
      identificationType: "NIT",
      identificationNumber: "900123456-1",
      businessName: "POS E2E Supplier",
      isActive: true,
      createdById: ADMIN_ID,
    },
  });

  await prisma.purchaseReception.create({
    data: {
      id: RECEPTION_ID,
      subscriptionId,
      sequentialNumber: 1,
      state: "CONFIRMED",
      receivedAt: new Date("2026-01-02"),
      createdById: ADMIN_ID,
      supplierId: SUPPLIER_ID,
    },
  });

  for (const [index, product] of PRODUCTS.entries()) {
    await createProduct(prisma, {
      subscriptionId,
      product,
      receptionItemId: RECEPTION_ITEM_IDS[index],
      barcode: BARCODE_BASE + index,
    });
  }

  await createPaymentMethods(prisma, subscriptionId);

  // The POS reads the fiscal issuer config during boot. Without it the server
  // answers FISCAL_ISSUER_CONFIG_NOT_SET and the boot stops there: no catalog
  // pull happens and the sales screen never has products to sell.
  await prisma.fiscalIssuerConfig.create({
    data: {
      id: ISSUER_CONFIG_ID,
      subscriptionId,
      nit: ISSUER_NIT,
      verificationDigit: "7",
      businessName: "Droguería E2E S.A.S.",
      commercialName: "Droguería E2E",
      organizationType: "PJ",
      taxRegime: "R-99-PJ",
      address: "Calle 1 # 2-3",
      municipality: "Bogotá",
      municipioCode: "11001",
      department: "Bogotá D.C.",
    } as never,
  });

  // Licensing: the app asks the server whether this workstation is activated
  // before it will leave the activation screen. Without these rows the suite
  // never reaches the sales screen at all, and the failure looks like a login
  // problem rather than a missing license.
  await prisma.location.create({
    data: {
      id: LOCATION_ID,
      subscriptionId,
      name: "Sucursal Principal E2E",
      address: "Calle 1 # 2-3",
      city: "Bogotá",
      country: "CO",
      isActive: true,
    },
  });

  await prisma.workstationActivation.create({
    data: {
      id: ACTIVATION_ID,
      subscriptionId,
      locationId: LOCATION_ID,
      hardwareFingerprint: HARDWARE_FINGERPRINT,
      // Must equal Workstation.name: the lookup is by name, not by id.
      workstationName: WORKSTATION_NAME,
      isActive: true,
      activatedAt: new Date("2026-01-01"),
    },
  });

  await prisma.client.create({
    data: {
      id: CLIENT_ID,
      subscriptionId,
      identificationType: "NIT",
      identificationNumber: CLIENT_IDENTIFICATION,
      fullName: CLIENT_NAME,
      email: "cliente.e2e@pos-e2e.local",
      phone: "3001234567",
      address: "Calle 1 # 2-3",
      isActive: true,
      createdById: ADMIN_ID,
    },
  });

  // The generic consumer the POS seeds locally for every sale without an
  // explicit client (local-database.ts, "Insert the generic client").
  //
  // It must exist server-side too, with the SAME fixed id: the POS's local
  // client is never pushed (it is seeded, not synced), yet a return replay
  // resolves `clientId` from the sale and ClientReturn.clientId is NOT NULL
  // with a foreign key. Without this row, returning a CONSUMIDOR FINAL sale
  // fails on the server with a Prisma constraint error.
  await prisma.client.create({
    data: {
      id: GENERIC_CLIENT_ID,
      subscriptionId,
      identificationType: "NIT",
      identificationNumber: "222222222222",
      fullName: "CONSUMIDOR FINAL",
      isActive: true,
      createdById: ADMIN_ID,
    },
  });

  // Without an active INVOICE resolution allocated to this workstation the
  // server cannot produce a CUFE, and the sale is rejected at replay time.
  await prisma.fiscalResolution.create({
    data: {
      id: RESOLUTION_ID,
      subscriptionId,
      resolutionNumber: RESOLUTION_NUMBER,
      documentType: "INVOICE",
      prefix: RESOLUTION_PREFIX,
      rangeFrom: 1,
      rangeTo: 1000,
      validFrom: new Date("2026-01-01"),
      validTo: new Date("2030-12-31"),
      state: "ACTIVE",
      workstationId: WORKSTATION_ID,
    },
  });

  await prisma.fiscalResolutionAllocation.create({
    data: {
      id: ALLOCATION_ID,
      subscriptionId,
      resolutionId: RESOLUTION_ID,
      workstationId: WORKSTATION_ID,
      rangeFrom: 1,
      rangeTo: 1000,
      allocatedAt: new Date("2026-01-01"),
      allocatedByUserId: ADMIN_ID,
    },
  });

  // A credit note is a separate DIAN document and needs its own resolution and
  // allocation. Without this the server rejects the return's credit note with
  // "No active resolution allocation found ... with document type CREDIT_NOTE",
  // and the return fails permanently at replay.
  await prisma.fiscalResolution.create({
    data: {
      id: CREDIT_NOTE_RESOLUTION_ID,
      subscriptionId,
      resolutionNumber: CREDIT_NOTE_RESOLUTION_NUMBER,
      documentType: "CREDIT_NOTE",
      prefix: CREDIT_NOTE_RESOLUTION_PREFIX,
      rangeFrom: 1,
      rangeTo: 1000,
      validFrom: new Date("2026-01-01"),
      validTo: new Date("2030-12-31"),
      state: "ACTIVE",
      workstationId: WORKSTATION_ID,
    },
  });

  await prisma.fiscalResolutionAllocation.create({
    data: {
      id: CREDIT_NOTE_ALLOCATION_ID,
      subscriptionId,
      resolutionId: CREDIT_NOTE_RESOLUTION_ID,
      workstationId: WORKSTATION_ID,
      rangeFrom: 1,
      rangeTo: 1000,
      allocatedAt: new Date("2026-01-01"),
      allocatedByUserId: ADMIN_ID,
    },
  });

  await createForeignWorkstationSale(prisma, subscriptionId);
}

/**
 * A confirmed sale made at a *different* workstation.
 *
 * This is what makes the manager-override ("unverified") return path reachable:
 * `ReturnsService.confirm` requires the override exactly when the sale's
 * workstation differs from the session's, and the POS only ever sees other
 * workstations' sales through the sales pull, which is why this row has to
 * exist on the server before the app starts.
 *
 * Its cash shift is CLOSED on purpose — the POS adopts the server's OPEN shift
 * during boot, and pre-opening one here would hand the POS somebody else's
 * shift instead of letting it open its own.
 */
async function createForeignWorkstationSale(
  prisma: PrismaLike,
  subscriptionId: string,
): Promise<void> {
  await prisma.workstation.create({
    data: {
      id: FOREIGN_WORKSTATION_ID,
      name: "POS E2E Foreign Workstation",
      code: FOREIGN_WORKSTATION_CODE,
      isActive: true,
      registeredAt: new Date("2026-01-01"),
    },
  });

  await prisma.cashShift.create({
    data: {
      id: FOREIGN_SHIFT_ID,
      subscriptionId,
      state: "CLOSED",
      openedAt: new Date("2026-02-01T08:00:00Z"),
      closedAt: new Date("2026-02-01T18:00:00Z"),
      openingBalance: new Prisma.Decimal(0),
      workstationId: FOREIGN_WORKSTATION_ID,
      userId: ADMIN_ID,
      closedByUserId: ADMIN_ID,
    },
  });

  const unitPrice = new Prisma.Decimal(PRODUCTS[0].price);
  const taxRate = new Prisma.Decimal(TAX_RATE_PERCENT);
  const subtotal = new Prisma.Decimal(unitPrice);
  const taxAmount = subtotal.times(taxRate).dividedBy(100);
  const total = subtotal.plus(taxAmount);

  await prisma.sale.create({
    data: {
      id: FOREIGN_SALE_ID,
      subscriptionId,
      localNumber: BigInt(FOREIGN_SALE_LOCAL_NUMBER),
      operationalState: "CONFIRMED",
      startedAt: new Date("2026-02-01T09:00:00Z"),
      confirmedAt: new Date("2026-02-01T09:05:00Z"),
      lastModifiedAt: new Date("2026-02-01T09:05:00Z"),
      clientIdentificationTypeSnapshot: "NIT",
      clientIdentificationNumberSnapshot: GENERIC_CLIENT_IDENTIFICATION,
      clientNameSnapshot: "CONSUMIDOR FINAL",
      clientId: GENERIC_CLIENT_ID,
      subtotal,
      totalDiscount: new Prisma.Decimal(0),
      totalTax: taxAmount,
      totalCost: LOT_UNIT_COST,
      totalAmount: total,
      changeAmount: new Prisma.Decimal(0),
      cashShiftId: FOREIGN_SHIFT_ID,
      workstationId: FOREIGN_WORKSTATION_ID,
      userId: ADMIN_ID,
      sourceWorkstationId: FOREIGN_WORKSTATION_ID,
      sourceCreatedAt: new Date("2026-02-01T09:05:00Z"),
    },
  });

  await prisma.saleItem.create({
    data: {
      id: FOREIGN_SALE_ITEM_ID,
      subscriptionId,
      saleId: FOREIGN_SALE_ID,
      productId: PRODUCT_ACETAMINOFEN,
      productInternalCodeSnapshot: PRODUCTS[0].internalCode,
      productCommercialNameSnapshot: PRODUCTS[0].commercialName,
      quantity: 1,
      unitPrice,
      unitCost: LOT_UNIT_COST,
      taxRate,
      taxAmount,
      subtotal,
      total,
    },
  });

  // The lot assignment is what the return reverses stock into, so it must
  // exist for the credit to land back on the same lot the sale consumed.
  await prisma.saleItemLot.create({
    data: {
      id: FOREIGN_SALE_ITEM_LOT_ID,
      subscriptionId,
      saleItemId: FOREIGN_SALE_ITEM_ID,
      lotId: LOT_ACETAMINOFEN,
      quantity: 1,
      unitCostAtSale: LOT_UNIT_COST,
    },
  });

  await prisma.salePayment.create({
    data: {
      id: FOREIGN_SALE_PAYMENT_ID,
      subscriptionId,
      saleId: FOREIGN_SALE_ID,
      paymentMethodId: PM_CASH_ID,
      amount: total,
      createdAt: new Date("2026-02-01T09:05:00Z"),
    },
  });

  // The stock the sale consumed is gone from the lot, so the POS's mirrored
  // stock and the server agree on what a return is worth crediting back.
  await prisma.lot.update({
    where: { id: LOT_ACETAMINOFEN },
    data: { currentStock: { decrement: 1 } },
  });

  // A credit note requires its invoice to be VALIDATED. Left in
  // PENDING_GENERATION so the harness stands in for the DIAN provider exactly as
  // it does for the invoices the POS itself produces.
  await prisma.fiscalDocument.create({
    data: {
      id: FOREIGN_SALE_INVOICE_ID,
      subscriptionId,
      documentType: "INVOICE",
      fiscalState: "PENDING_GENERATION",
      fullNumber: `${RESOLUTION_PREFIX}${FOREIGN_SALE_LOCAL_NUMBER}`,
      // Unique per (consecutiveNumber, resolutionId), and the POS's own
      // invoices take 1..N under the same resolution — this one has to sit
      // above that range, which is why its number matches FOREIGN_SALE_LOCAL_NUMBER.
      consecutiveNumber: FOREIGN_SALE_LOCAL_NUMBER,
      resolutionId: RESOLUTION_ID,
      // Same placeholder convention FiscalDocumentsService uses before the real
      // CUFE is computed (PLACEHOLDER_CUFE_PREFIX + document id).
      cufeCude: `PENDING_${FOREIGN_SALE_INVOICE_ID}`,
      issueDate: new Date("2026-02-01T09:05:00Z"),
      issuerNitSnapshot: ISSUER_NIT,
      subtotal,
      totalTax: taxAmount,
      totalAmount: total,
      saleId: FOREIGN_SALE_ID,
      createdAt: new Date("2026-02-01T09:05:00Z"),
    },
  });
}

type ProductSpec = (typeof PRODUCTS)[number];

async function createProduct(
  prisma: PrismaLike,
  args: {
    subscriptionId: string;
    product: ProductSpec;
    receptionItemId: string;
    /** Unique EAN13 assigned by position, so no two products share a barcode. */
    barcode: number;
  },
): Promise<void> {
  const { subscriptionId, product, receptionItemId } = args;
  const expirationDate = expirationFor(product.expiresInDays);

  await prisma.product.create({
    data: {
      id: product.id,
      subscriptionId,
      internalCode: product.internalCode,
      commercialName: product.commercialName,
      laboratory: "Laboratorio Farmacéutico S.A.",
      saleType: "FREE_SALE",
      minimumStock: 10,
      isActive: true,
      invimaRegistry: "INVIMA-2023-0001",
      createdById: ADMIN_ID,
    },
  });

  await prisma.productBarcode.create({
    data: {
      id: `bc-${product.id}`,
      subscriptionId,
      productId: product.id,
      barcode: String(args.barcode),
      barcodeType: "EAN13",
      isPrimary: true,
    },
  });

  // Price and tax live in history rows; the product points at the current one.
  // Seeding only a `currentPrice` scalar would leave the pull endpoints empty.
  const priceHistory = await prisma.productPriceHistory.create({
    data: {
      id: `ph-${product.id}`,
      subscriptionId,
      productId: product.id,
      price: new Prisma.Decimal(product.price),
      effectiveFrom: new Date("2026-01-01"),
      changedById: ADMIN_ID,
      changedAt: new Date(),
    },
  });

  const taxHistory = await prisma.productTaxHistory.create({
    data: {
      id: `th-${product.id}`,
      subscriptionId,
      productId: product.id,
      taxSchemeId: TAX_SCHEME_ID,
      effectiveFrom: new Date("2026-01-01"),
      changedById: ADMIN_ID,
      changedAt: new Date(),
    },
  });

  await prisma.product.update({
    where: { id: product.id },
    data: {
      currentPriceId: priceHistory.id,
      currentTaxHistoryId: taxHistory.id,
    },
  });

  // `state` stays ACTIVE even for the already-expired lot on purpose: nothing in
  // the product transitions a lot's state when its date passes, so the expired
  // fixture has to reproduce the state the database really holds the day after.
  await prisma.lot.create({
    data: {
      id: product.lotId,
      subscriptionId,
      batchNumber: product.lotNumber,
      expirationDate,
      entryDate: new Date("2026-01-15"),
      state: "ACTIVE",
      currentStock: INITIAL_STOCK,
      version: 1,
      productId: product.id,
      locationCode: "A-01",
    },
  });

  await prisma.purchaseReceptionItem.create({
    data: {
      id: receptionItemId,
      subscriptionId,
      purchaseReceptionId: RECEPTION_ID,
      productId: product.id,
      lotId: product.lotId,
      receivedQuantity: INITIAL_STOCK,
      lotNumber: product.lotNumber,
      expirationDate,
      realUnitCost: LOT_UNIT_COST,
      taxSchemeId: TAX_SCHEME_ID,
    },
  });
}

async function createPaymentMethods(
  prisma: PrismaLike,
  subscriptionId: string,
): Promise<void> {
  const methods = [
    {
      id: PM_CASH_ID,
      internalCode: "EFECTIVO",
      name: "Efectivo",
      dianCode: "01",
      category: "CASH",
      isCash: true,
      sortOrder: 1,
    },
    {
      id: PM_DEBIT_ID,
      internalCode: "TARJETA_DEBITO",
      name: "Tarjeta Débito",
      dianCode: "02",
      category: "DEBIT_CARD",
      isCash: false,
      sortOrder: 2,
    },
    {
      id: PM_TRANSFER_ID,
      internalCode: "TRANSFERENCIA",
      name: "Transferencia",
      dianCode: "03",
      category: "BANK_TRANSFER",
      isCash: false,
      sortOrder: 3,
    },
    {
      id: PM_NEQUI_ID,
      internalCode: "NEQUI",
      name: "Nequi",
      dianCode: "04",
      category: "DIGITAL_WALLET",
      isCash: false,
      sortOrder: 4,
    },
  ] as const;

  for (const method of methods) {
    await prisma.paymentMethod.create({
      data: { ...method, subscriptionId, isActive: true },
    });
  }
}

/**
 * Empty every table except the migration ledger.
 *
 * The table list is read from the catalog rather than hardcoded, so a migration
 * added after this file was written is truncated too.
 */
async function truncateAllTables(prisma: PrismaLike): Promise<void> {
  const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename <> '_prisma_migrations'
  `;

  if (tables.length === 0) {
    throw new Error(
      "resetBaseline found no tables — is the schema migrated on the test database?",
    );
  }

  const list = tables.map((t) => `"${t.tablename}"`).join(", ");
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`,
  );
}
