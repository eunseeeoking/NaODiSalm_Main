/**
 * 테마 스토어 (다크/라이트, persist)
 *  - 기본 다크
 *  - 새로고침 후에도 유지 (localStorage key: "theme")
 *  - <html> 클래스 토글은 App.tsx 의 useEffect 가 담당
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Theme = 'light' | 'dark';

interface ThemeState {
  theme: Theme;
  toggle: () => void;
  setTheme: (t: Theme) => void;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      theme: 'dark', // 기본값
      toggle: () =>
        set((s) => ({ theme: s.theme === 'dark' ? 'light' : 'dark' })),
      setTheme: (t) => set({ theme: t }),
    }),
    { name: 'theme' },
  ),
);
