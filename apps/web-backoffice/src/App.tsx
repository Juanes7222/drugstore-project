import { lazy, Suspense } from "react";
import { Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom";
import { RoleType } from "@pharmacy/shared-types";
import { useAuthStore } from "./hooks/use-auth";
import { BackofficeLayout } from "./components/layouts/backoffice-layout";
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
const SubscriptionsPage = lazy(() =>
  import("./pages/subscriptions-page").then((m) => ({
    default: m.SubscriptionsPage,
  })),
);
const NotFoundPage = lazy(() =>
  import("./pages/not-found-page").then((m) => ({ default: m.NotFoundPage })),
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

function RequireRole({ role }: { role: RoleType }) {
  const user = useAuthStore((state) => state.user);
  if (user?.role !== role) {
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
            <Route element={<RequireRole role={RoleType.SAAS_ADMIN} />}>
              <Route path="/subscriptions" element={<SubscriptionsPage />} />
            </Route>
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Route>
      </Routes>
    </Suspense>
  );
}
