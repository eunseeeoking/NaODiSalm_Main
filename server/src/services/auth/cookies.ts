import type { CookieOptions, Response } from 'express';

/**
 * 인증 쿠키 정책.
 *
 *  - httpOnly  : JS 접근 차단 (XSS 방어의 핵심)
 *  - sameSite  : 'lax' — 동일 출처 + 안전한 top-level 네비게이션만 전송
 *  - secure    : production 에서만 (localhost 개발은 HTTP 라 false)
 *  - path      : '/' — 모든 라우트에서 사용
 */

export const ACCESS_COOKIE = 'auth_access';
export const REFRESH_COOKIE = 'auth_refresh';

const isProd = process.env.NODE_ENV === 'production';

function baseOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    path: '/',
  };
}

export interface IssuedTokenSet {
  accessToken: string;
  accessExpiresAt: Date;
  refreshToken: string;
  refreshExpiresAt: Date;
}

export function setAuthCookies(res: Response, tokens: IssuedTokenSet): void {
  res.cookie(ACCESS_COOKIE, tokens.accessToken, {
    ...baseOptions(),
    expires: tokens.accessExpiresAt,
  });
  res.cookie(REFRESH_COOKIE, tokens.refreshToken, {
    ...baseOptions(),
    expires: tokens.refreshExpiresAt,
  });
}

export function clearAuthCookies(res: Response): void {
  // clearCookie 는 maxAge/expires 를 제외한 동일 옵션을 줘야 정확히 매칭됨
  res.clearCookie(ACCESS_COOKIE, baseOptions());
  res.clearCookie(REFRESH_COOKIE, baseOptions());
}
