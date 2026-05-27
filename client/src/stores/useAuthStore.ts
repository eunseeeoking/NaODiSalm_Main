/**
 * 인증 상태 스토어 (Zustand)
 *  - 라우터 전체에서 user 정보 공유
 *  - bootstrap() 한 번만 호출 → fetchMe 결과 캐싱
 */
import { create } from 'zustand';
// fetchMe: 2026-05-28 로그인 기능 비활성 — bootstrap()에서 주석 처리되어 import 제거
import { logout as apiLogout, type AuthUser } from '../api/auth';

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
    // 2026-05-28: 로그인 기능 미사용 — fetchMe 호출 비활성화
    // 콘솔 401 에러 (GET /api/auth/me + POST /api/auth/refresh) 제거
    // 로그인 재활성화 시 아래 주석 해제
    // try {
    //   const u = await fetchMe();
    //   set({ user: u });
    // } catch {
    //   // 미인증 — 정상 흐름
    // }
    set({ bootChecked: true });
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
