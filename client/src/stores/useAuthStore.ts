/**
 * 인증 상태 스토어 (Zustand)
 *  - 라우터 전체에서 user 정보 공유
 *  - bootstrap() 한 번만 호출 → fetchMe 결과 캐싱
 */
import { create } from 'zustand';
import { fetchMe, logout as apiLogout, type AuthUser } from '../api/auth';

interface AuthState {
  user: AuthUser | null;
  bootChecked: boolean;

  /** 앱 시작 시 1회 호출 — fetchMe 시도 */
  bootstrap: () => Promise<void>;
  setUser: (user: AuthUser | null) => void;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  bootChecked: false,

  bootstrap: async () => {
    try {
      const u = await fetchMe();
      set({ user: u });
    } catch {
      // 미인증 — 정상 흐름
    } finally {
      set({ bootChecked: true });
    }
  },

  setUser: (user) => set({ user }),

  logout: async () => {
    try {
      await apiLogout();
    } finally {
      set({ user: null });
    }
  },
}));
