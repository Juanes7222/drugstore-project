/**
 * Service-context — React context + provider that instantiates the real
 * domain services from src/domain/ with the local PGlite PrismaClient and
 * AuthService, and makes them available via hooks anywhere in the component
 * tree.
 *
 * ## Usage
 *
 * ```tsx
 * // At the app root (already done in App.tsx):
 * <ServiceProvider>
 *   <App />
 * </ServiceProvider>
 *
 * // In any screen / page component:
 * const returnsService = useReturnsService();
 * const adjustmentsService = useInventoryAdjustmentsService();
 * const prescriptionsService = usePrescriptionsService();
 * ```
 *
 * ## Initialisation
 *
 * The provider mounts a loading spinner until PGlite + Prisma have finished
 * initialising.  In the unlikely event that initialisation fails, the provider
 * renders a fatal-error panel — the POS cannot operate without a local DB.
 */
import {
  createContext,
  type FC,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { getLocalDatabase } from "../../../infrastructure/local-database";
import { API_BASE_URL } from "@infra/config";
import { createReturnsService, ReturnsService } from "../../../domain/returns/returns.service";
import {
  createInventoryAdjustmentsService,
  InventoryAdjustmentsService,
} from "../../../domain/inventory-adjustments/inventory-adjustments.service";
import {
  createPrescriptionsService,
  PrescriptionsService,
} from "../../../domain/prescriptions/prescriptions.service";
import { createAuthService, AuthService } from "../../../domain/auth/auth.service";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Services {
  returnsService: ReturnsService;
  inventoryAdjustmentsService: InventoryAdjustmentsService;
  prescriptionsService: PrescriptionsService;
}

type InitState =
  | { status: "loading" }
  | { status: "ready"; services: Services }
  | { status: "error"; error: Error };

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const ServiceContext = createContext<Services | null>(null);

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

function useServiceContext(): Services {
  const ctx = useContext(ServiceContext);
  if (!ctx) {
    throw new Error(
      "useServiceContext() must be used inside a <ServiceProvider>.",
    );
  }
  return ctx;
}

/** Convenience hook — returns the ReturnsService instance. */
export const useReturnsService = (): ReturnsService =>
  useServiceContext().returnsService;

/** Convenience hook — returns the InventoryAdjustmentsService instance. */
export const useInventoryAdjustmentsService = (): InventoryAdjustmentsService =>
  useServiceContext().inventoryAdjustmentsService;

/** Convenience hook — returns the PrescriptionsService instance. */
export const usePrescriptionsService = (): PrescriptionsService =>
  useServiceContext().prescriptionsService;

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

interface ServiceProviderProps {
  /** Server base URL for the AuthService login call. Falls back to env var. */
  apiBaseUrl?: string;
  children: ReactNode;
}

export const ServiceProvider: FC<ServiceProviderProps> = ({
  apiBaseUrl,
  children,
}) => {
  const { t } = useTranslation();
  const [initState, setInitState] = useState<InitState>({ status: "loading" });

  const baseUrl = apiBaseUrl ?? API_BASE_URL;

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        // 1. Initialise the local database (PGlite + Prisma)
        const { prisma } = await getLocalDatabase();

        if (cancelled) return;

        // 2. Create AuthService (reads session from the Zustand store in memory)
        const auth: AuthService = createAuthService({ baseUrl });

        // 3. Create domain services
        const services: Services = {
          returnsService: createReturnsService(prisma, auth),
          inventoryAdjustmentsService: createInventoryAdjustmentsService(prisma, auth),
          prescriptionsService: createPrescriptionsService(prisma, auth),
        };

        setInitState({ status: "ready", services });
      } catch (err) {
        if (!cancelled) {
          setInitState({
            status: "error",
            error: err instanceof Error ? err : new Error(String(err)),
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [baseUrl]);

  // ---- Render -----------------------------------------------------------

  if (initState.status === "error") {
    return (
      <div
        className="flex h-screen flex-col items-center justify-center p-pos-xl"
        style={{ backgroundColor: "var(--color-surface)" }}
        role="alert"
      >
        <div className="pos-panel max-w-lg p-pos-xl text-center">
          <h1
            className="text-heading font-bold"
            style={{ color: "var(--color-urgency)" }}
          >
            {t("common.app_name")}
          </h1>
          <p
            className="mt-pos-md text-body"
            style={{
              color: "color-mix(in srgb, var(--color-ink) 60%, transparent)",
            }}
          >
            {t("common.loading")}
          </p>
          <p className="mt-pos-sm font-data text-caption">
            {initState.error.message}
          </p>
        </div>
      </div>
    );
  }

  if (initState.status === "loading") {
    return (
      <div
        className="flex h-screen flex-col items-center justify-center"
        style={{ backgroundColor: "var(--color-surface)" }}
      >
        <div className="text-center">
          <div
            className="mx-auto mb-pos-md h-8 w-8 animate-spin rounded-full border-2 border-transparent"
            style={{
              borderTopColor: "var(--color-pharma)",
              borderRightColor: "var(--color-pharma)",
            }}
            aria-hidden="true"
          />
          <p
            className="text-body font-medium"
            style={{ color: "var(--color-ink)" }}
          >
            {t("common.loading")}
          </p>
        </div>
      </div>
    );
  }

  return (
    <ServiceContext.Provider value={initState.services}>
      {children}
    </ServiceContext.Provider>
  );
};
