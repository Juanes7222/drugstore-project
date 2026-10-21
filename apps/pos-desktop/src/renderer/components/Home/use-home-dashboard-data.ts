/**
 * useHomeDashboardData — real dashboard aggregates from the local database.
 *
 * Replaces the previous placeholder stats ("—") with actual counts the user
 * can act on. Everything resolves from the local (SQLite) database via the
 * same Prisma client the rest of the app uses — no network involved, so the
 * dashboard stays fully usable offline.
 *
 * The hook loads a superset once and resolves all values together (matching
 * the previous useHomeCounts contract): `undefined` until loaded, values
 * null-safe afterwards. Individual failures keep the whole dashboard usable
 * by returning 0 for that aggregate instead of crashing the screen.
 */
import { useEffect, useState } from "react";
import {
  PrismaClient,
  SaleOperationalState,
  ShiftState,
  AdjustmentState,
  UserStatus,
} from "@pharmacy/database/local";
import { getLocalDatabase } from "../../../infrastructure/local-database";

/** Local low-stock threshold — mirrors InventoryLotsService (currentStock <= 10). */
const LOW_STOCK_THRESHOLD = 10;

/** Lots expiring within this many days count as "soon to expire". */
const NEAR_EXPIRY_DAYS = 30;

export interface HomeDashboardData {
  /** Confirmed sales since start of day (local clock). */
  salesToday: number | undefined;
  /** Sum of confirmed sale totals since start of day (COP, whole pesos). */
  salesTodayAmount: number | undefined;
  /** Sales carrying a fiscal internal number today (invoices emitted). */
  invoicesToday: number | undefined;
  /** The currently open cash shift owned by the signed-in user, if any. */
  myOpenShift: { openedAt: string } | undefined;
  /** Every open cash shift on this workstation store (manager view). */
  openShiftsCount: number | undefined;
  /** Lots at or below the low-stock threshold. */
  lowStockLots: number | undefined;
  /** Lots expiring within NEAR_EXPIRY_DAYS but not yet expired. */
  nearExpiryLots: number | undefined;
  /** Lots already past expiration. */
  expiredLots: number | undefined;
  /** Adjustment documents still in DRAFT (pending preparation). */
  draftAdjustments: number | undefined;
  /** Active users (UserStatus.ACTIVE). */
  activeUsers: number | undefined;
  /** Audit events recorded today. */
  auditToday: number | undefined;
}

const INITIAL_STATE: HomeDashboardData = {
  salesToday: undefined,
  salesTodayAmount: undefined,
  invoicesToday: undefined,
  myOpenShift: undefined,
  openShiftsCount: undefined,
  lowStockLots: undefined,
  nearExpiryLots: undefined,
  expiredLots: undefined,
  draftAdjustments: undefined,
  activeUsers: undefined,
  auditToday: undefined,
};

function startOfToday(): Date {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

function nearExpiryCutoff(now: Date): Date {
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() + NEAR_EXPIRY_DAYS);
  return cutoff;
}

export function useHomeDashboardData(options?: {
  /** Restrict the "my open shift" lookup to this user id. */
  userId?: string;
}): HomeDashboardData {
  const [data, setData] = useState<HomeDashboardData>(INITIAL_STATE);

  useEffect(() => {
    let cancelled = false;
    const userId = options?.userId;

    void (async () => {
      try {
        const { prisma } = await getLocalDatabase();
        const db = prisma as PrismaClient;
        const today = startOfToday();
        const now = new Date();
        const cutoff = nearExpiryCutoff(now);

        const [
          salesToday,
          salesTodayTotal,
          invoicesToday,
          myOpenShift,
          openShiftsCount,
          lowStockLots,
          nearExpiryLots,
          expiredLots,
          draftAdjustments,
          activeUsers,
          auditToday,
        ] = await Promise.all([
          db.sale.count({
            where: {
              operationalState: SaleOperationalState.CONFIRMED,
              confirmedAt: { gte: today },
            },
          }),
          db.sale.aggregate({
            where: {
              operationalState: SaleOperationalState.CONFIRMED,
              confirmedAt: { gte: today },
            },
            _sum: { totalAmount: true },
          }),
          db.sale.count({
            where: {
              operationalState: SaleOperationalState.CONFIRMED,
              confirmedAt: { gte: today },
              internalNumber: { not: null },
            },
          }),
          db.cashShift.findFirst({
            where: {
              state: ShiftState.OPEN,
              ...(userId ? { userId } : {}),
            },
            orderBy: { openedAt: "desc" },
            select: { openedAt: true },
          }),
          db.cashShift.count({ where: { state: ShiftState.OPEN } }),
          db.lot.count({
            where: { currentStock: { lte: LOW_STOCK_THRESHOLD } },
          }),
          db.lot.count({
            where: {
              expirationDate: { gt: now, lte: cutoff },
            },
          }),
          db.lot.count({
            where: { expirationDate: { lte: now } },
          }),
          db.inventoryAdjustmentDocument.count({
            where: { state: AdjustmentState.DRAFT },
          }),
          db.user.count({ where: { status: UserStatus.ACTIVE } }),
          db.localAuditLog.count({ where: { createdAt: { gte: today } } }),
        ]);

        if (cancelled) return;

        setData({
          salesToday,
          salesTodayAmount: salesTodayTotal._sum.totalAmount
            ? Number(salesTodayTotal._sum.totalAmount)
            : 0,
          invoicesToday,
          myOpenShift: myOpenShift
            ? { openedAt: myOpenShift.openedAt.toISOString() }
            : undefined,
          openShiftsCount,
          lowStockLots,
          nearExpiryLots,
          expiredLots,
          draftAdjustments,
          activeUsers,
          auditToday,
        });
      } catch {
        // Advisory dashboard — never block the launchpad on data failure.
        if (!cancelled) {
          setData({
            ...INITIAL_STATE,
            salesToday: 0,
            salesTodayAmount: 0,
            invoicesToday: 0,
            openShiftsCount: 0,
            lowStockLots: 0,
            nearExpiryLots: 0,
            expiredLots: 0,
            draftAdjustments: 0,
            activeUsers: 0,
            auditToday: 0,
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [options?.userId]);

  return data;
}
