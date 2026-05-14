import crypto from 'crypto';
import jwt, { SignOptions } from 'jsonwebtoken';

/**
 * JWT(Access) + 랜덤 문자열(Refresh) 발급/검증 유틸.
 *
 * 정책:
 *  - Access  : JWT, 1h, 서명만으로 검증 (DB 조회 없음 → 빠름)
 *  - Refresh : 64바이트 cryptographically-secure 랜덤 → SHA256 해시만 DB 저장
 */

export const ACCESS_TTL_MS =
  Number(process.env.ACCESS_TTL_MS) || 60 * 60 * 1000; // 1h

export const REFRESH_REMEMBER_TTL_MS =
  Number(process.env.REFRESH_REMEMBER_TTL_MS) || 14 * 24 * 60 * 60 * 1000; // 14d

export const REFRESH_DEFAULT_TTL_MS =
  Number(process.env.REFRESH_DEFAULT_TTL_MS) || 24 * 60 * 60 * 1000; // 1d

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  // 부트 시점에서만 한 번 검사 (개발 모드 hot-reload 시 매번 떠도 OK)
  console.warn('[auth] JWT_SECRET is not set — set it in server/.env');
}

export interface AccessTokenPayload {
  sub: string; // userId
  jti: string; // 토큰 식별자 (감사용)
}

export function signAccessToken(userId: string): {
  token: string;
  jti: string;
  expiresAt: Date;
} {
  const jti = crypto.randomBytes(16).toString('hex');
  const expiresAt = new Date(Date.now() + ACCESS_TTL_MS);
  const payload: AccessTokenPayload = { sub: userId, jti };

  const options: SignOptions = { expiresIn: Math.floor(ACCESS_TTL_MS / 1000) };
  const token = jwt.sign(payload, JWT_SECRET ?? 'dev-secret', options);

  return { token, jti, expiresAt };
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, JWT_SECRET ?? 'dev-secret') as AccessTokenPayload;
}

/** Refresh 토큰: 64바이트 랜덤 → base64url. DB 에는 SHA-256 해시만 저장. */
export function generateRefreshToken(): { token: string; hash: string } {
  const token = crypto.randomBytes(64).toString('base64url');
  const hash = sha256(token);
  return { token, hash };
}

export function sha256(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

export function refreshTtlMs(rememberMe: boolean): number {
  return rememberMe ? REFRESH_REMEMBER_TTL_MS : REFRESH_DEFAULT_TTL_MS;
}
