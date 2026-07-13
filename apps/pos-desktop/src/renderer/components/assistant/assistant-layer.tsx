/**
 * Assistant layer — singleton component that composes all assistant
 * overlays, the suggestion banner, and the global keyboard shortcut
 * handler at the React root level.
 *
 * This component:
 * 1. Renders the command palette (Cmd+K)
 * 2. Renders the suggestion banner (contextual suggestions)
 * 3. Renders the shortcut cheatsheet overlay (?)
 * 4. Renders the help viewer overlay (F1)
 * 5. Registers global keyboard shortcuts via useGlobalShortcuts hook
 * 6. Initializes and manages the search index, suggestion engine, etc.
 *
 * Mounted once in App.tsx, outside the screen router so it persists
 * across all navigation.
 */

import {
  type FC,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from "react";
import { useAppSelector } from "../../store/hooks";
import { selectActiveScreen } from "../../store/slices/ui-slice";
import { useLocalSessionStore } from "../../../domain/auth/local-session.store";
import { useAssistantStore } from "../../../stores/assistant.store";
import { useGlobalShortcuts } from "../../hooks/use-global-shortcuts";
import { useOnlineStatus } from "../../hooks/use-online-status";

import { CommandPalette } from "./command-palette";
import { SuggestionBanner } from "./suggestion-banner";
import { ShortcutCheatsheet } from "./shortcut-cheatsheet";
import { HelpViewer } from "./help-viewer";

// Lazy import for suggestion engine — not needed at mount
let suggestionEngineInitialized = false;

export const AssistantLayer: FC = () => {
  const activeScreen = useAppSelector(selectActiveScreen);
  const session = useLocalSessionStore((s) => s.session);
  const currentUserRole = session?.role ?? null;

  // Assistant store actions
  const openPalette = useAssistantStore((s) => s.openPalette);
  const closeAll = useAssistantStore((s) => s.closeAll);
  const openHelp = useAssistantStore((s) => s.openHelp);
  const openCheatsheet = useAssistantStore((s) => s.openCheatsheet);
  const setIsIndexBuilding = useAssistantStore((s) => s.setIsIndexBuilding);
  const setSuggestions = useAssistantStore((s) => s.setSuggestions);
  const paletteOpen = useAssistantStore((s) => s.paletteOpen);
  const cheatsheetOpen = useAssistantStore((s) => s.cheatsheetOpen);
  const helpOpen = useAssistantStore((s) => s.helpOpen);
  const preferencesOpen = useAssistantStore((s) => s.preferencesOpen);

  const isUserOnline = useOnlineStatus();
  const isModalOpen = paletteOpen || cheatsheetOpen || helpOpen || preferencesOpen;

  // ---- Global keyboard shortcuts ----
  const handleNewSale = useCallback(async () => {
    const [{ store }, { resetSaleFlow, navigateBackToSales }] = await Promise.all([
      import("../../store/store"),
      import("../../store/slices/ui-slice"),
    ]);
    store.dispatch(resetSaleFlow());
    store.dispatch(navigateBackToSales());
  }, []);

  const handleSyncNow = useCallback(async () => {
    console.log("[Assistant] Sync now triggered from global shortcut");
  }, []);

  const handleContextHelp = useCallback(async () => {
    try {
      const { getHelpEntryByRoute } = await import("../../../help-content/index");
      const topic = getHelpEntryByRoute(activeScreen);
      openHelp(topic?.id ?? undefined);
    } catch {
      openHelp(undefined);
    }
  }, [activeScreen, openHelp]);

  const shortcutHandlers = useMemo(
    () => ({
      onOpenPalette: openPalette,
      onOpenHelp: () => openHelp(undefined),
      onShowCheatsheet: openCheatsheet,
      onCloseOverlay: closeAll,
      onNewSale: handleNewSale,
      onSyncNow: handleSyncNow,
      onContextHelp: handleContextHelp,
    }),
    [openPalette, openHelp, openCheatsheet, closeAll, handleNewSale, handleSyncNow, handleContextHelp],
  );

  useGlobalShortcuts(shortcutHandlers, isModalOpen, activeScreen);

  // ---- Initialize search index ----
  const indexInitialized = useRef(false);

  useEffect(() => {
    if (indexInitialized.current) return;
    indexInitialized.current = true;

    // Build the search index lazily (not at mount, but prepare it)
    // The actual build happens on first palette open, but we can
    // start warming it up after a short delay
    const timer = setTimeout(() => {
      import("../../../domain/assistant/search-index.service").then(
        ({ createSearchIndexService }) => {
          const svc = createSearchIndexService();

          // Only pre-build if not too many items (lightweight warmup)
          svc.onBuildStart(() => {
            setIsIndexBuilding(true);
          });
          svc.onBuildComplete(() => {
            setIsIndexBuilding(false);
          });

          // Start building in background
          svc.build(currentUserRole).then((buildTimeMs) => {
            console.log(`[Assistant] Search index built in ${buildTimeMs.toFixed(0)}ms`);
          }).catch((err) => {
            console.error("[Assistant] Failed to build search index:", err);
            setIsIndexBuilding(false);
          });
        },
      );
    }, 2000); // Delay 2s after app mount to avoid competing with other init

    return () => clearTimeout(timer);
  }, [currentUserRole, setIsIndexBuilding]);

  // ---- Initialize suggestion engine ----
  useEffect(() => {
    if (suggestionEngineInitialized) return;
    suggestionEngineInitialized = true;

    import("../../../domain/assistant/suggestion-engine.service").then(
      ({ createSuggestionEngine, PERIODIC_EVALUATION_INTERVAL_MS }) => {
        const engine = createSuggestionEngine();

        engine.onSuggestionsChange((suggestions) => {
          setSuggestions(suggestions);
        });

        // Build initial app state and evaluate
        const buildAppState = () => {
          // Collect sync metrics from store (if available)
          const syncPending = 0; // TODO: read from sync store
          const syncPermFail = 0;
          const invoicesExpiring = 0;
          const shiftDuration = 0;

          return {
            activeScreen,
            currentUserRole,
            cartItemCount: 0,
            cartHasItems: false,
            cartTotalCents: 0,
            currentClientId: null,
            currentClientName: null,
            syncQueuePending: syncPending,
            syncQueuePermanentFailure: syncPermFail,
            oldestPendingAgeMs: 0,
            invoicesExpiringWithin24h: invoicesExpiring,
            currentShiftDurationHours: shiftDuration,
            isSyncing: false,
            isOnline: isUserOnline,
            lastConfirmedSaleId: null,
            lastConfirmedSaleNumber: null,
          };
        };

        engine.evaluate(buildAppState());
        engine.startPeriodicEvaluation(PERIODIC_EVALUATION_INTERVAL_MS);

        return () => {
          engine.dispose();
        };
      },
    );
  }, [activeScreen, currentUserRole, isUserOnline, setSuggestions]);

  return (
    <>
      <CommandPalette />
      <SuggestionBanner />
      <ShortcutCheatsheet />
      <HelpViewer />
    </>
  );
};
