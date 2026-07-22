/**
 * Hook to initialize and provide fiscal domain services.
 *
 * Manages service creation, data loading, auto-refresh, and the
 * services ref shared across action handlers.
 *
 * @category Hook
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { getLocalDatabase } from "../../infrastructure/local-database";
import type { PrismaClient } from "@pharmacy/database/local";
import { createInvoiceService, type InvoiceService } from "./invoice.service";
import {
  createContingencyService,
  type ContingencyService,
} from "./contingency.service";
import {
  createFiscalNumberingService,
  type FiscalNumberingService,
} from "./numbering.service";
import {
  createFiscalScheduler,
  type FiscalScheduler,
} from "./fiscal-scheduler.service";
import type { InvoiceListItem, ContingencyEventSummary } from "./fiscal-types";
import { useLocalSessionStore } from "../auth/local-session.store";
import type { AuthService } from "../auth/auth.service";
import {
  createLocalAdjustmentService,
  type LocalAdjustmentService,
} from "./local-adjustment.service";
import { RoleType } from "@pharmacy/shared-types";

const AUTO_REFRESH_MS = 30_000;

export interface FiscalServicesResult {
  /** Loading state. */
  loading: boolean;
  /** Error message. */
  error: string | null;
  /** Invoice list items. */
  invoices: InvoiceListItem[];
  /** Total invoice count. */
  totalCount: number;
  /** Contingency event history. */
  history: ContingencyEventSummary[];
  /** Reload all data. */
  loadData: () => Promise<void>;
  /** Services ref for direct access by action handlers. */
  servicesRef: React.MutableRefObject<{
    invoiceService: InvoiceService | null;
    contingencyService: ContingencyService | null;
    numberingService: FiscalNumberingService | null;
    fiscalScheduler: FiscalScheduler | null;
    authService: AuthService | null;
    adjustmentService: LocalAdjustmentService | null;
  }>;
}

/**
 * Initialize all fiscal services, load initial data, and set up auto-refresh.
 */
export function useFiscalServices(): FiscalServicesResult {
  const { t } = useTranslation("fiscal");
  const session = useLocalSessionStore((s) => s.session);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [invoices, setInvoices] = useState<InvoiceListItem[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [history, setHistory] = useState<ContingencyEventSummary[]>([]);

  const servicesRef = useRef<{
    invoiceService: InvoiceService | null;
    contingencyService: ContingencyService | null;
    numberingService: FiscalNumberingService | null;
    fiscalScheduler: FiscalScheduler | null;
    authService: AuthService | null;
    adjustmentService: LocalAdjustmentService | null;
  }>({
    invoiceService: null,
    contingencyService: null,
    numberingService: null,
    fiscalScheduler: null,
    authService: null,
    adjustmentService: null,
  });

  const createServices = useCallback(async () => {
    const { prisma } = await getLocalDatabase();
    const prismaClient = prisma as PrismaClient;
    const wsId = session?.workstationId ?? "unknown";

    const numberingService = createFiscalNumberingService({
      prisma: prismaClient,
      workstationId: wsId,
    });
    const contingencyService = createContingencyService({
      prisma: prismaClient,
      workstationId: wsId,
    });
    const invoiceService = createInvoiceService({
      prisma: prismaClient,
      workstationId: wsId,
      numberingService,
      contingencyService,
    });
    const fiscalScheduler = createFiscalScheduler({
      invoiceService,
      contingencyService,
    });

    const authService = {
      requireRole: (...allowedRoles: RoleType[]) => {
        const s = useLocalSessionStore.getState().session;
        if (!s) throw new Error("No active session");
        const sessionRole = s.role as RoleType;
        if (!allowedRoles.includes(sessionRole)) {
          throw new Error(`Requires role ${allowedRoles.join(" or ")}`);
        }
        return s;
      },
      getCurrentSession: () => useLocalSessionStore.getState().session,
      login: async () => {
        throw new Error("login() not available from fiscal page");
      },
      completeTwoFactor: async () => {
        throw new Error("Not available from fiscal page");
      },
      refreshSession: async () => null,
      requestStepUp: async () => {
        throw new Error("Not available from fiscal page");
      },
      approveStepUp: async () => {
        throw new Error("Not available from fiscal page");
      },
      verifyStepUp: async (): Promise<boolean> => false,
      changePassword: async () => {
        throw new Error("Not available from fiscal page");
      },
      changePin: async () => {
        throw new Error("Not available from fiscal page");
      },
      forgotPassword: async () => ({ message: "Not available" }),
      resetPassword: async () => {
        throw new Error("Not available from fiscal page");
      },
      logout: async () => {
        useLocalSessionStore.getState().clearSession();
      },
      createUser: async () => {
        throw new Error("Not available from fiscal page");
      },
      listUsers: async () => ({ users: [], total: 0 }),
      disableUser: async () => ({ message: "Not available" }),
      enableUser: async () => ({ message: "Not available" }),
      unlockUser: async () => ({ message: "Not available" }),
      resetUserPin: async () => ({
        newPin: "",
        message: "Not available",
      }),
      getPendingStepUpRequests: async (): Promise<any[]> => [],
      getAuditLogs: async () => ({}),
    } satisfies AuthService;

    const adjustmentService = createLocalAdjustmentService(
      prismaClient,
      authService,
    );

    servicesRef.current = {
      invoiceService,
      contingencyService,
      numberingService,
      fiscalScheduler,
      authService,
      adjustmentService,
    };

    return { invoiceService, contingencyService };
  }, [session?.workstationId]);

  const loadData = useCallback(async () => {
    try {
      const { invoiceService, contingencyService } = await createServices();
      const [invResult, histResult] = await Promise.all([
        invoiceService.listInvoices({ limit: 50 }),
        contingencyService.listHistory(20),
      ]);
      setInvoices(invResult.items);
      setTotalCount(invResult.total);
      setHistory(histResult);
      setLoading(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("error_load"));
      setLoading(false);
    }
  }, [createServices, t]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // Auto-refresh invoices
  useEffect(() => {
    const interval = setInterval(async () => {
      const svc = servicesRef.current.invoiceService;
      if (!svc) return;
      try {
        const invResult = await svc.listInvoices({ limit: 50 });
        setInvoices(invResult.items);
        setTotalCount(invResult.total);
      } catch {
        /* advisory */
      }
    }, AUTO_REFRESH_MS);
    return () => clearInterval(interval);
  }, []);

  return {
    loading,
    error,
    invoices,
    totalCount,
    history,
    loadData,
    servicesRef,
  };
}
