import { apiFetch } from './client';

/**
 * /api/auth 도메인 호출.
 *  - 토큰은 모두 httpOnly 쿠키로 처리되므로 JS 가 직접 다루지 않는다.
 *  - 모든 요청에 credentials: 'include' (apiFetch 기본값)
 */

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

export function signup(payload: SignupPayload): Promise<AuthUser> {
  return apiFetch<AuthUser>('/api/auth/signup', {
    method: 'POST',
    json: payload,
  });
}

/** 로그인 — 성공 시 서버가 access/refresh 쿠키를 Set-Cookie 로 내려준다 */
export async function login(
  email: string,
  password: string,
  rememberMe: boolean,
): Promise<AuthUser> {
  const data = await apiFetch<{ user: AuthUser }>('/api/auth/login', {
    method: 'POST',
    json: { email, password, rememberMe },
  });
  return data.user;
}

/** 본인 정보 — 401 이면 client.ts 가 자동으로 /refresh 후 재시도 */
export function fetchMe(): Promise<AuthUser> {
  return apiFetch<AuthUser>('/api/auth/me');
}

/** 로그아웃 — 서버가 refresh 폐기 + Set-Cookie 로 쿠키 만료시킴 */
export function logout(): Promise<void> {
  return apiFetch<void>('/api/auth/logout', { method: 'POST' });
}
