import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

interface UiState {
  sidebarOpen: boolean;
  themeMode: "light" | "dark";
  commandPaletteOpen: boolean;
  toggleSidebar: () => void;
  setThemeMode: (mode: "light" | "dark") => void;
  setCommandPaletteOpen: (open: boolean) => void;
}

/** Only durable preferences hit localStorage; transient UI starts closed. */
type PersistedUiState = Pick<UiState, "themeMode">;

export const useUiStore = create<UiState>()(
  persist<UiState, [], [], PersistedUiState>(
    (set) => ({
      sidebarOpen: true,
      themeMode: "light",
      commandPaletteOpen: false,
      toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
      setThemeMode: (themeMode) => set({ themeMode }),
      setCommandPaletteOpen: (commandPaletteOpen) =>
        set({ commandPaletteOpen }),
    }),
    {
      name: "backoffice-ui",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ themeMode: state.themeMode }),
    },
  ),
);
