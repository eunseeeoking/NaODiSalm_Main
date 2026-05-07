import { apiFetch } from './client';

/**
 * 서버의 /api/auth 도메인 호출 함수.
 *  - 응답에서 password 는 항상 제외되어 도착한다 (server/src/services/repositories/userRepository.ts 참고)
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

export function login(email: string, password: string): Promise<AuthUser> {
  return apiFetch<AuthUser>('/api/auth/login', {
    method: 'POST',
    json: { email, password },
  });
}
