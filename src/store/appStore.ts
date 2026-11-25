import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { AccountProfile } from '../services/accountService';
import type { ThemePaletteId } from '../theme/colors';

interface AppState {
  hasOnboarded: boolean;
  profile: AccountProfile | null;
  rememberMe: boolean;
  themePalette: ThemePaletteId;
  syncError: string | null;
  setOnboarded: (value: boolean) => void;
  setProfile: (profile: AccountProfile, rememberMe: boolean) => void;
  updateProfile: (updates: Partial<AccountProfile>) => void;
  setThemePalette: (themePalette: ThemePaletteId) => void;
  setSyncError: (message: string | null) => void;
  logout: () => void;
}

type PersistedAppState = Pick<
  AppState,
  'hasOnboarded' | 'profile' | 'rememberMe' | 'themePalette'
>;

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      hasOnboarded: false,
      profile: null,
      rememberMe: true,
      themePalette: 'savanna',
      syncError: null,
      setOnboarded: (value) => set({ hasOnboarded: value }),
      setProfile: (profile, rememberMe) => set({ profile, rememberMe, themePalette: profile.themePalette }),
      updateProfile: (updates) =>
        set((state) => ({
          profile: state.profile ? { ...state.profile, ...updates } : null,
          themePalette: updates.themePalette ?? state.themePalette,
        })),
      setThemePalette: (themePalette) =>
        set((state) => ({
          themePalette,
          profile: state.profile ? { ...state.profile, themePalette } : null,
        })),
      setSyncError: (syncError) => set({ syncError }),
      logout: () => set({ profile: null, syncError: null }),
    }),
    {
      name: 'mzansilink-app',
      storage: createJSONStorage(() => AsyncStorage),
      version: 4,
      partialize: (state): PersistedAppState => ({
        hasOnboarded: state.hasOnboarded,
        profile: state.rememberMe ? state.profile : null,
        rememberMe: state.rememberMe,
        themePalette: state.themePalette,
      }),
      migrate: (persistedState, version): PersistedAppState => {
        const state = persistedState as Partial<PersistedAppState>;
        if (version === 0) {
          return {
            hasOnboarded: state.hasOnboarded ?? false,
            profile: null,
            rememberMe: true,
            themePalette: 'savanna',
          };
        }
        return {
          hasOnboarded: state.hasOnboarded ?? false,
          profile: state.profile ?? null,
          rememberMe: state.rememberMe ?? true,
          themePalette:
            state.themePalette ?? state.profile?.themePalette ?? 'savanna',
        };
      },
    },
  ),
);
