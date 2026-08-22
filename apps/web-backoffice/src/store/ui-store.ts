import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

interface UiState {
  sidebarOpen: boolean;
  themeMode: 'light' | 'dark';
  toggleSidebar: () => void;
  setThemeMode: (mode: 'light' | 'dark') => void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      sidebarOpen: true,
      themeMode: 'light',
      toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
      setThemeMode: (themeMode) => set({ themeMode }),
    }),
    {
      name: 'backoffice-ui',
      storage: createJSONStorage(() => localStorage),
    },
  ),
);