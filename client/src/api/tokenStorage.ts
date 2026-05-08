/**
 * 토큰 보관소.
 *  - localStorage 사용 (XSS 에 취약하나 데모/공모전 수준에서는 허용)
 *  - 운영에서는 httpOnly 쿠키 + CSRF 보호로 옮기는 것을 권장
 */

const KEY_ACCESS = 'auth:accessToken';
const KEY_REFRESH = 'auth:refreshToken';
const KEY_ACCESS_EXP = 'auth:accessExpiresAt';
const KEY_REFRESH_EXP = 'auth:refreshExpiresAt';

export interface StoredTokens {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: string;
  refreshExpiresAt: string;
}

export const tokenStorage = {
  getAccess(): string | null {
    return localStorage.getItem(KEY_ACCESS);
  },
  getRefresh(): string | null {
    return localStorage.getItem(KEY_REFRESH);
  },
  set(t: StoredTokens): void {
    localStorage.setItem(KEY_ACCESS, t.accessToken);
    localStorage.setItem(KEY_REFRESH, t.refreshToken);
    localStorage.setItem(KEY_ACCESS_EXP, t.accessExpiresAt);
    localStorage.setItem(KEY_REFRESH_EXP, t.refreshExpiresAt);
  },
  clear(): void {
    localStorage.removeItem(KEY_ACCESS);
    localStorage.removeItem(KEY_REFRESH);
    localStorage.removeItem(KEY_ACCESS_EXP);
    localStorage.removeItem(KEY_REFRESH_EXP);
  },
};
