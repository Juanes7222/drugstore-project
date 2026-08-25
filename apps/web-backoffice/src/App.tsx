import { lazy, Suspense } from "react";
import { Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom";
import { RoleType } from "@pharmacy/shared-types";
import { useAuthStore } from "./hooks/use-auth";
import { BackofficeLayout } from "./components/layouts/backoffice-layout";
import { SuperAdminLayout } from "./components/layouts/super-admin-layout";
import { LoadingState } from "./components/common/states";

const LoginPage = lazy(() =>
  import("./pages/login-page").then((m) => ({ default: m.LoginPage })),
);
const DashboardPage = lazy(() =>
  import("./pages/dashboard-page").then((m) => ({ default: m.DashboardPage })),
);
const UsersPage = lazy(() =>
  import("./pages/users-page").then((m) => ({ default: m.UsersPage })),
);
const SalesPage = lazy(() =>
  import("./pages/sales-page").then((m) => ({ default: m.SalesPage })),
);
const CashShiftsPage = lazy(() =>
  import("./pages/cash-shifts-page").then((m) => ({
    default: m.CashShiftsPage,
  })),
);
const InventoryAlertsPage = lazy(() =>
  import("./pages/inventory-alerts-page").then((m) => ({
    default: m.InventoryAlertsPage,
  })),
);
const FiscalPage = lazy(() =>
  import("./pages/fiscal-page").then((m) => ({ default: m.FiscalPage })),
);
const SessionsPage = lazy(() =>
  import("./pages/sessions-page").then((m) => ({ default: m.SessionsPage })),
);
const AuditPage = lazy(() =>
  import("./pages/audit-page").then((m) => ({ default: m.AuditPage })),
);
const WorkstationsPage = lazy(() =>
  import("./pages/workstations-page").then((m) => ({
    default: m.WorkstationsPage,
  })),
);
const NotFoundPage = lazy(() =>
  import("./pages/not-found-page").then((m) => ({ default: m.NotFoundPage })),
);

// Platform-owner surface (/admin) — separate layout, palette and pages.
const PlatformOverviewPage = lazy(() =>
  import("./pages/admin/platform-overview-page").then((m) => ({
    default: m.PlatformOverviewPage,
  })),
);
const CustomersPage = lazy(() =>
  import("./pages/admin/customers-page").then((m) => ({
    default: m.CustomersPage,
  })),
);
const CustomerDetailPage = lazy(() =>
  import("./pages/admin/customer-detail-page").then((m) => ({
    default: m.CustomerDetailPage,
  })),
);
const FraudAlertsPage = lazy(() =>
  import("./pages/admin/fraud-alerts-page").then((m) => ({
    default: m.FraudAlertsPage,
  })),
);
const PlatformAuditPage = lazy(() =>
  import("./pages/admin/platform-audit-page").then((m) => ({
    default: m.PlatformAuditPage,
  })),
);
const RevenuePage = lazy(() =>
  import("./pages/admin/revenue-page").then((m) => ({
    default: m.RevenuePage,
  })),
);
const AtRiskPage = lazy(() =>
  import("./pages/admin/at-risk-page").then((m) => ({
    default: m.AtRiskPage,
  })),
);

function RequireAuth() {
  const location = useLocation();
  const { accessToken, expiresAt } = useAuthStore();

  if (!accessToken) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  // Expired stored session: clear it and force a fresh login.
  if (expiresAt && new Date(expiresAt).getTime() < Date.now()) {
    useAuthStore.getState().clearSession();
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return <Outlet />;
}

/**
 * Gate for the platform-owner surface: requires the SAAS_ADMIN role AND the
 * server-backed isPlatformAdmin flag. The server enforces the same condition
 * on every /saas-admin endpoint; this guard only avoids dead-end navigation.
 */
function RequirePlatformAdmin() {
  const user = useAuthStore((state) => state.user);
  if (
    user?.role !== RoleType.SAAS_ADMIN ||
    user.isPlatformAdmin !== true
  ) {
    return <Navigate to="/dashboard" replace />;
  }
  return <Outlet />;
}

export function App() {
  return (
    <Suspense fallback={<LoadingState />}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<RequireAuth />}>
          {/* Platform owner surface */}
          <Route element={<RequirePlatformAdmin />}>
            <Route
              path="/admin"
              element={
                <SuperAdminLayout>
                  <Outlet />
                </SuperAdminLayout>
              }
            >
              <Route index element={<PlatformOverviewPage />} />
              <Route path="customers" element={<CustomersPage />} />
              <Route path="customers/:customerId" element={<CustomerDetailPage />} />
              <Route path="fraud" element={<FraudAlertsPage />} />
              <Route path="audit" element={<PlatformAuditPage />} />
              <Route path="revenue" element={<RevenuePage />} />
              <Route path="at-risk" element={<AtRiskPage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Route>
          </Route>

          {/* Tenant backoffice surface */}
          <Route
            element={
              <BackofficeLayout>
                <Outlet />
              </BackofficeLayout>
            }
          >
            <Route index element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/users" element={<UsersPage />} />
            <Route path="/sales" element={<SalesPage />} />
            <Route path="/cash-shifts" element={<CashShiftsPage />} />
            <Route path="/inventory-alerts" element={<InventoryAlertsPage />} />
            <Route path="/fiscal" element={<FiscalPage />} />
            <Route path="/sessions" element={<SessionsPage />} />
            <Route path="/audit" element={<AuditPage />} />
            <Route path="/workstations" element={<WorkstationsPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Route>
      </Routes>
    </Suspense>
  );
}
