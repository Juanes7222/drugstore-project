import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Dialog from "@mui/material/Dialog";
import InputAdornment from "@mui/material/InputAdornment";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import List from "@mui/material/List";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useTheme, alpha } from "@mui/material/styles";
import { RoleType } from "@pharmacy/shared-types";
import {
  DarkModeIcon,
  LightModeIcon,
  LogoutIcon,
  SearchIcon,
  ShieldIcon,
  WorkspacePremiumIcon,
} from "../icons/app-icons";
import { BACKOFFICE_NAV_ITEMS, ADMIN_NAV_ITEMS } from "../navigation";
import { useAuthStore } from "../../hooks/use-auth";
import { useUiStore } from "../../store/ui-store";
import { logout } from "../../services/auth";

interface PaletteAction {
  key: string;
  label: string;
  icon: React.ComponentType<{ size?: number | string }>;
  run: () => void;
}

/** Case- and diacritics-insensitive match so "auditoria" finds "Auditoría". */
function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/**
 * Ctrl+K command palette. Opens and closes with zero animation — keyboard
 * users trigger it dozens of times a day and any delay reads as lag.
 * Arrow keys + Enter drive it entirely from the keyboard.
 */
export function CommandPalette() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const theme = useTheme();
  const open = useUiStore((state) => state.commandPaletteOpen);
  const setCommandPaletteOpen = useUiStore(
    (state) => state.setCommandPaletteOpen,
  );
  const themeMode = useUiStore((state) => state.themeMode);
  const setThemeMode = useUiStore((state) => state.setThemeMode);
  const { user, clearSession } = useAuthStore();

  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);

  // Global shortcut lives here so any surface gets it after mount.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandPaletteOpen(!open);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, setCommandPaletteOpen]);

  // Fresh query every time the palette opens; focus lands in the field.
  useEffect(() => {
    if (open) {
      setQuery("");
      setHighlight(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const isAdminSurface = location.pathname.startsWith("/admin");

  const actions = useMemo<PaletteAction[]>(() => {
    const role = user?.role;
    const navConfigs = isAdminSurface ? ADMIN_NAV_ITEMS : BACKOFFICE_NAV_ITEMS;
    const navActions: PaletteAction[] = navConfigs
      .filter((item) => !item.roles || (role && item.roles.includes(role)))
      .map((item) => ({
        key: item.to,
        label: t(item.labelKey),
        icon: item.icon,
        run: () => navigate(item.to),
      }));

    // Cross-surface jumps: platform admins can hop between panels; the
    // isPlatformAdmin check mirrors the router guard to avoid dead ends.
    const canAdminPlatform =
      role === RoleType.SAAS_ADMIN && user?.isPlatformAdmin === true;
    const globalActions: PaletteAction[] = [
      {
        key: "toggle-theme",
        label:
          themeMode === "dark" ? t("common.lightMode") : t("common.darkMode"),
        icon: themeMode === "dark" ? LightModeIcon : DarkModeIcon,
        run: () => setThemeMode(themeMode === "dark" ? "light" : "dark"),
      },
      ...(canAdminPlatform && isAdminSurface
        ? [
            {
              key: "switch-tenant",
              label: t("palette.switchToTenant"),
              icon: WorkspacePremiumIcon,
              run: () => navigate("/dashboard"),
            } satisfies PaletteAction,
          ]
        : []),
      ...(canAdminPlatform && !isAdminSurface
        ? [
            {
              key: "switch-admin",
              label: t("palette.switchToAdmin"),
              icon: ShieldIcon,
              run: () => navigate("/admin"),
            } satisfies PaletteAction,
          ]
        : []),
      {
        key: "logout",
        label: t("common.logout"),
        icon: LogoutIcon,
        run: async () => {
          try {
            await logout();
          } catch {
            // Same best-effort rule as the layouts: local session clears
            // regardless of server response.
          }
          clearSession();
          navigate("/login", { replace: true });
        },
      },
    ];

    return [...navActions, ...globalActions];
  }, [
    clearSession,
    isAdminSurface,
    location.pathname,
    navigate,
    setThemeMode,
    t,
    themeMode,
    user,
  ]);

  const filtered = useMemo(() => {
    const needle = normalize(query.trim());
    if (!needle) return actions;
    return actions.filter((action) =>
      normalize(action.label).includes(needle),
    );
  }, [actions, query]);

  useEffect(() => {
    setHighlight(0);
  }, [query]);

  // Keep the highlighted option visible without manual scrolling.
  // Declared before any early return: hook order must never depend on
  // whether the palette is open.
  useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector('[data-highlight="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [open, highlight, filtered.length]);

  if (!open) return null;

  const execute = (index: number) => {
    const action = filtered[index];
    if (!action) return;
    setCommandPaletteOpen(false);
    void action.run();
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlight((i) => Math.min(i + 1, filtered.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlight((i) => Math.max(i - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      execute(highlight);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={() => setCommandPaletteOpen(false)}
      fullWidth
      maxWidth="sm"
      // Keyboard-initiated and high-frequency: no entrance animation.
      TransitionProps={{ timeout: 0 }}
      PaperProps={{ sx: { mt: "10vh", alignSelf: "flex-start" } }}
      aria-label={t("palette.title")}
      onKeyDown={handleKeyDown}
    >
      <Box px={2} pt={2}>
        <TextField
          inputRef={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          size="small"
          fullWidth
          placeholder={t("palette.placeholder")}
          aria-label={t("palette.title")}
          aria-controls="command-palette-list"
          aria-activedescendant={
            filtered[highlight] ? `command-palette-option-${highlight}` : undefined
          }
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon size={17} />
              </InputAdornment>
            ),
            sx: { fontSize: 15 },
          }}
        />
      </Box>
      {filtered.length > 0 ? (
        <List ref={listRef} id="command-palette-list" role="listbox" dense sx={{ py: 1, maxHeight: 360, overflowY: "auto" }}>
          {filtered.map((action, index) => {
            const Icon = action.icon;
            const isHighlighted = index === highlight;
            return (
              <ListItemButton
                id={`command-palette-option-${index}`}
                key={action.key}
                role="option"
                aria-selected={isHighlighted}
                data-highlight={isHighlighted}
                selected={isHighlighted}
                onClick={() => execute(index)}
                onMouseMove={() => setHighlight(index)}
                sx={{ mx: 1, borderRadius: 2 }}
              >
                <ListItemIcon sx={{ minWidth: 34 }}>
                  <Icon size={17} />
                </ListItemIcon>
                <ListItemText
                  primary={action.label}
                  primaryTypographyProps={{ fontSize: 14, fontWeight: 500 }}
                />
              </ListItemButton>
            );
          })}
        </List>
      ) : (
        <Typography
          variant="body2"
          color="text.secondary"
          textAlign="center"
          px={3}
          py={4}
        >
          {t("palette.noResults", { query })}
        </Typography>
      )}
      <Box
        aria-hidden
        display="flex"
        justifyContent="flex-end"
        alignItems="center"
        gap={1}
        px={2}
        py={1}
        borderTop={`1px solid ${theme.palette.divider}`}
        bgcolor={alpha(theme.palette.text.primary, theme.palette.mode === "light" ? 0.02 : 0.04)}
        sx={{ borderBottomLeftRadius: 13, borderBottomRightRadius: 13 }}
      >
        {["↑↓", "↵"].map((hint) => (
          <Box
            key={hint}
            component="kbd"
            sx={{
              fontFamily: "inherit",
              fontSize: 11,
              fontWeight: 600,
              color: "text.secondary",
              border: `1px solid ${theme.palette.divider}`,
              borderRadius: 1,
              px: 0.75,
              py: 0.125,
              lineHeight: 1.6,
            }}
          >
            {hint}
          </Box>
        ))}
      </Box>
    </Dialog>
  );
}
