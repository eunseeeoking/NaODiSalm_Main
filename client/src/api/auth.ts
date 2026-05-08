import { apiFetch } from './client';
import { tokenStorage } from './tokenStorage';

export interface AuthUser {
  id: number;
  email: string;
  name: string | null;
  phone: string | null;
  loginFailCount: number;
  createdAt: string;
  deletedAt: string | null;
}

export interface SignupPayload {
  email: string;
  password: string;
  name?: string;
  phone?: string;
}

interface LoginResponse {
  user: AuthUser;
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: string;
  refreshExpiresAt: string;
}

export function signup(payload: SignupPayload): Promise<AuthUser> {
  return apiFetch<AuthUser>('/api/auth/signup', {
    method: 'POST',
    json: payload,
    skipAuth: true,
  });
}

/** 로그인 → 토큰을 storage 에 저장하고 사용자 정보 반환 */
export async function login(
  email: string,
  password: string,
  rememberMe: boolean,
): Promise<AuthUser> {
  const data = await apiFetch<LoginResponse>('/api/auth/login', {
    method: 'POST',
    json: { email, password, rememberMe },
    skipAuth: true,
  });
  tokenStorage.set({
    accessToken: data.accessToken,
    refreshToken: data.refreshToken,
    accessExpiresAt: data.accessExpiresAt,
    refreshExpiresAt: data.refreshExpiresAt,
  });
  return data.user;
}

/** 현재 access 토큰으로 본인 정보 조회 (보호됨) — 401 이면 client.ts 가 자동 refresh */
export function fetchMe(): Promise<AuthUser> {
  return apiFetch<AuthUser>('/api/auth/me');
}

/** 로그아웃 — 서버에 refresh 폐기 + 로컬 토큰 삭제 */
export async function logout(): Promise<void> {
  const refreshToken = tokenStorage.getRefresh();
  try {
    if (refreshToken) {
      await apiFetch<void>('/api/auth/logout', {
        method: 'POST',
        json: { refreshToken },
        skipAuth: true,
      });
    }
  } finally {
    tokenStorage.clear();
  }
}
