import type { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../services/auth/tokens';
import { ACCESS_COOKIE } from '../services/auth/cookies';

/**
 * Access 토큰 검증 미들웨어.
 *  - 우선순위: httpOnly 쿠키 → Authorization: Bearer (호환/디버깅용)
 *  - 검증 성공 시 req.user = { id } 주입
 */

export interface AuthedRequest extends Request {
  user?: { id: number };
}

function readToken(req: Request): string | null {
  const cookieToken = req.cookies?.[ACCESS_COOKIE];
  if (typeof cookieToken === 'string' && cookieToken) return cookieToken;

  const header = req.header('authorization') ?? '';
  const [scheme, token] = header.split(' ');
  if (scheme?.toLowerCase() === 'bearer' && token) return token;

  return null;
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const token = readToken(req);
  if (!token) {
    return res.status(401).json({ error: 'authentication required' });
  }
  try {
    const payload = verifyAccessToken(token);
    // JWT sub 는 string — 경계에서 number 로 변환 (DB id 가 number)
    const id = Number(payload.sub);
    if (!Number.isFinite(id)) {
      return res.status(401).json({ error: 'invalid token subject' });
    }
    req.user = { id };
    return next();
  } catch {
    return res.status(401).json({ error: 'invalid or expired access token' });
  }
}
