import { useState, type ReactNode } from "react";
import { ThemeProvider, useTheme, alpha } from "@mui/material/styles";
import { useLocation, useNavigate, NavLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import AppBar from "@mui/material/AppBar";
import Avatar from "@mui/material/Avatar";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import CssBaseline from "@mui/material/CssBaseline";
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
import {
  MenuIcon,
  SearchIcon,
  DarkModeIcon,
  LightModeIcon,
  LogoutIcon,
} from "../icons/app-icons";
import { ADMIN_NAV_ITEMS } from "../navigation";
import { BrandMark } from "../common/brand-mark";
import { CommandPalette } from "../common/command-palette";
import { buildAdminTheme } from "../../theme";
import { useAuthStore } from "../../hooks/use-auth";
import { useUiStore } from "../../store/ui-store";
import { logout } from "../../services/auth";

const DRAWER_WIDTH = 248;

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

/**
 * Layout for the platform-owner surface (/admin). Wraps its subtree in the
 * violet admin theme so it reads as a distinct product from the tenant panel.
 * Route access is enforced by RequirePlatformAdmin in the router; this layout
 * only renders navigation.
 */
export function SuperAdminLayout({ children }: { children: ReactNode }) {
  return <SuperAdminShell>{children}</SuperAdminShell>;
}

function SuperAdminShell({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const parentTheme = useTheme();
  const isMobile = useMediaQuery(parentTheme.breakpoints.down("md"));
  const themeMode = useUiStore((state) => state.themeMode);
  // Nested provider keeps parent tokens (breakpoints, spacing) and swaps
  // only the palette so every admin screen carries the violet identity.
  const theme = buildAdminTheme(themeMode);
  const { user, clearSession } = useAuthStore();
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

  const isSelected = (to: string) =>
    to === "/admin"
      ? location.pathname === "/admin"
      : location.pathname.startsWith(to);

  const drawerContent = (
    <Box role="navigation" aria-label={t("common.mainNav")}>
      <Toolbar sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
        <BrandMark size={28} />
        <Typography fontWeight={800} color="text.primary" noWrap sx={{ letterSpacing: "-0.02em" }}>
          {t("saas.appName")}
        </Typography>
      </Toolbar>
      <Divider />
      <Box sx={{ px: 2, pt: 2 }}>
        <Chip
          size="small"
          color="primary"
          label={t("saas.badge")}
          sx={{ fontWeight: 700, letterSpacing: "0.08em" }}
        />
      </Box>
      <List disablePadding sx={{ px: 2, py: 1 }}>
        {ADMIN_NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const selected = isSelected(item.to);
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
    <ThemeProvider theme={theme}>
      <CssBaseline />
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
              themeMode === "dark" ? 0.8 : 0.85,
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
              {t("saas.appName")}
            </Typography>
            <Tooltip title={`${t("palette.placeholder")} (Ctrl+K)`}>
              <IconButton
                onClick={() =>
                  useUiStore.getState().setCommandPaletteOpen(true)
                }
                aria-label={`${t("palette.placeholder")} (Ctrl+K)`}
              >
                <SearchIcon />
              </IconButton>
            </Tooltip>
            <Tooltip
              title={
                themeMode === "dark" ? t("common.lightMode") : t("common.darkMode")
              }
            >
              <IconButton
                onClick={() =>
                  useUiStore
                    .getState()
                    .setThemeMode(themeMode === "dark" ? "light" : "dark")
                }
                aria-label={
                  themeMode === "dark" ? t("common.lightMode") : t("common.darkMode")
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
              <Avatar
                sx={{ width: 32, height: 32, bgcolor: "primary.main", fontSize: 13, fontWeight: 700 }}
              >
                {initialsOf(user?.displayName ?? user?.email ?? "?")}
              </Avatar>
              <Box sx={{ display: { xs: "none", sm: "block" } }}>
                <Typography variant="body2" fontWeight={600} noWrap>
                  {user?.displayName ?? user?.email}
                </Typography>
                <Typography variant="caption" color="text.secondary" noWrap>
                  {user?.email}
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
            sx={{ "& .MuiDrawer-paper": { width: DRAWER_WIDTH } }}
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
      {/* Inside the nested provider so the palette reads violet on /admin. */}
      <CommandPalette />
    </ThemeProvider>
  );
}
