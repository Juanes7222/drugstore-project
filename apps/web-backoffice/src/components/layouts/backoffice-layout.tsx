import { useState, type ReactNode } from "react";
import { useLocation, useNavigate, NavLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { RoleType } from "@pharmacy/shared-types";
import AppBar from "@mui/material/AppBar";
import Avatar from "@mui/material/Avatar";
import Box from "@mui/material/Box";
import Divider from "@mui/material/Divider";
import Drawer from "@mui/material/Drawer";
import IconButton from "@mui/material/IconButton";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Toolbar from "@mui/material/Toolbar";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import useMediaQuery from "@mui/material/useMediaQuery";
import useTheme from "@mui/material/styles/useTheme";
import { alpha } from "@mui/material/styles";
import {
  MenuIcon,
  DashboardIcon,
  PeopleIcon,
  PointOfSaleIcon,
  PaymentsIcon,
  InventoryIcon,
  ReceiptIcon,
  DevicesIcon,
  DesktopWindowsIcon,
  WorkspacePremiumIcon,
  DarkModeIcon,
  LightModeIcon,
  LogoutIcon,
} from "../icons/app-icons";
import type { AppIconComponent } from "../icons/app-icon-component";
import { BrandMark } from "../common/brand-mark";
import { useAuthStore } from "../../hooks/use-auth";
import { useUiStore } from "../../store/ui-store";
import { usePermissions } from "../../hooks/use-permissions";
import { logout } from "../../services/auth";

const DRAWER_WIDTH = 248;

interface NavItem {
  to: string;
  labelKey: string;
  icon: AppIconComponent;
  roles?: RoleType[];
}

const NAV_ITEMS: NavItem[] = [
  { to: "/dashboard", labelKey: "nav.dashboard", icon: DashboardIcon },
  { to: "/users", labelKey: "nav.users", icon: PeopleIcon },
  { to: "/sales", labelKey: "nav.sales", icon: PointOfSaleIcon },
  { to: "/cash-shifts", labelKey: "nav.cashShifts", icon: PaymentsIcon },
  {
    to: "/inventory-alerts",
    labelKey: "nav.inventoryAlerts",
    icon: InventoryIcon,
  },
  { to: "/fiscal", labelKey: "nav.fiscal", icon: ReceiptIcon },
  { to: "/sessions", labelKey: "nav.sessions", icon: DevicesIcon },
  {
    to: "/workstations",
    labelKey: "nav.workstations",
    icon: DesktopWindowsIcon,
  },
  {
    to: "/subscriptions",
    labelKey: "nav.subscriptions",
    icon: WorkspacePremiumIcon,
    roles: [RoleType.SAAS_ADMIN],
  },
];

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export function BackofficeLayout({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));
  const isDark = theme.palette.mode === "dark";
  const { user, clearSession } = useAuthStore();
  const { themeMode, setThemeMode } = useUiStore();
  const { role } = usePermissions();
  const [mobileOpen, setMobileOpen] = useState(false);

  const drawerOpen = isMobile ? mobileOpen : true;

  const handleLogout = async () => {
    try {
      await logout();
    } catch {
      // Server-side session revocation is best-effort; local state must
      // still be cleared so the user can sign in again.
    } finally {
      clearSession();
      navigate("/login", { replace: true });
    }
  };

  const visibleItems = NAV_ITEMS.filter(
    (item) => !item.roles || (role && item.roles.includes(role)),
  );

  const drawerContent = (
    <Box role="navigation" aria-label={t("common.mainNav")}>
      <Toolbar sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
        <BrandMark size={28} />
        <Typography fontWeight={800} color="text.primary" noWrap sx={{ letterSpacing: "-0.02em" }}>
          {t("common.appName")}
        </Typography>
      </Toolbar>
      <Divider />
      <List disablePadding sx={{ px: 2, py: 1 }}>
        {visibleItems.map((item) => {
          const Icon = item.icon;
          const selected =
            location.pathname === item.to ||
            (item.to !== "/dashboard" && location.pathname.startsWith(item.to));
          return (
            <ListItemButton
              key={item.to}
              component={NavLink}
              to={item.to}
              selected={selected}
              onClick={() => setMobileOpen(false)}
              aria-current={selected ? "page" : undefined}
              sx={{ mb: 0.5 }}
            >
              <ListItemIcon sx={{ minWidth: 36, color: selected ? "primary.main" : "inherit" }}>
                <Icon size={18} />
              </ListItemIcon>
              <ListItemText
                primary={t(item.labelKey)}
                primaryTypographyProps={{
                  fontSize: 14,
                  fontWeight: selected ? 600 : 500,
                  color: selected ? "primary.main" : "text.primary",
                }}
              />
            </ListItemButton>
          );
        })}
      </List>
    </Box>
  );

  return (
    <Box sx={{ display: "flex", minHeight: "100vh" }}>
      <AppBar
        position="fixed"
        color="inherit"
        elevation={0}
        sx={{
          zIndex: theme.zIndex.drawer + 1,
          borderBottom: `1px solid ${theme.palette.divider}`,
          backgroundColor: alpha(
            theme.palette.background.paper,
            isDark ? 0.8 : 0.85,
          ),
          backdropFilter: "blur(8px)",
        }}
      >
        <Toolbar>
          <IconButton
            edge="start"
            aria-label={t("common.mainNav")}
            onClick={() => setMobileOpen((v) => !v)}
            sx={{ mr: 2, display: { md: "none" } }}
          >
            <MenuIcon size={20} />
          </IconButton>
          <Typography
            variant="h6"
            component="h1"
            fontWeight={700}
            sx={{ flexGrow: 1, letterSpacing: "-0.02em" }}
            noWrap
          >
            {t("common.appName")}
          </Typography>
          <Tooltip
            title={
              themeMode === "dark"
                ? t("common.lightMode")
                : t("common.darkMode")
            }
          >
            <IconButton
              onClick={() =>
                setThemeMode(themeMode === "dark" ? "light" : "dark")
              }
              aria-label={
                themeMode === "dark"
                  ? t("common.lightMode")
                  : t("common.darkMode")
              }
            >
              {themeMode === "dark" ? <LightModeIcon /> : <DarkModeIcon />}
            </IconButton>
          </Tooltip>
          <Tooltip title={t("common.logout")}>
            <IconButton onClick={handleLogout} aria-label={t("common.logout")}>
              <LogoutIcon />
            </IconButton>
          </Tooltip>
          <Box display="flex" alignItems="center" gap={1} ml={1}>
            <Avatar sx={{ width: 32, height: 32, bgcolor: "primary.main", fontSize: 13, fontWeight: 700 }}>
              {initialsOf(user?.displayName ?? user?.email ?? "?")}
            </Avatar>
            <Box sx={{ display: { xs: "none", sm: "block" } }}>
              <Typography variant="body2" fontWeight={600} noWrap>
                {user?.displayName ?? user?.email}
              </Typography>
              <Typography variant="caption" color="text.secondary" noWrap>
                {role}
              </Typography>
            </Box>
          </Box>
        </Toolbar>
      </AppBar>

      {isMobile ? (
        <Drawer
          variant="temporary"
          open={drawerOpen}
          onClose={() => setMobileOpen(false)}
          ModalProps={{ keepMounted: true }}
          sx={{
            "& .MuiDrawer-paper": {
              width: DRAWER_WIDTH,
            },
          }}
        >
          {drawerContent}
        </Drawer>
      ) : (
        <Drawer
          variant="permanent"
          sx={{
            width: DRAWER_WIDTH,
            flexShrink: 0,
            "& .MuiDrawer-paper": {
              width: DRAWER_WIDTH,
              boxSizing: "border-box",
              borderRight: `1px solid ${theme.palette.divider}`,
            },
          }}
        >
          {drawerContent}
        </Drawer>
      )}

      <Box
        component="main"
        sx={{
          flexGrow: 1,
          p: 3,
          pt: 10,
          bgcolor: "background.default",
          minWidth: 0,
        }}
      >
        {/* Keyed remount gives each route a quiet entrance; reduced-motion
            users get the static state via the global media query. */}
        <Box key={location.pathname} className="animate-fade-up">
          {children}
        </Box>
      </Box>
    </Box>
  );
}
