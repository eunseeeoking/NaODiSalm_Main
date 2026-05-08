import type { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../services/auth/tokens';

/**
 * Access 토큰 검증 미들웨어.
 *  - Authorization: Bearer <token> 헤더 필수
 *  - 검증 성공 시 req.user = { id } 주입
 *  - 실패 시 401
 *
 * 토큰의 즉시 폐기(긴급 차단)가 필요하면 jti 를 t_user_token 에서 조회하는
 * 추가 검사를 넣을 수 있다 (현재는 서명+exp 만 검사 → 빠름).
 */

export interface AuthedRequest extends Request {
  user?: { id: number };
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.header('authorization') ?? '';
  const [scheme, token] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    return res.status(401).json({ error: 'missing or malformed Authorization header' });
  }

  try {
    const payload = verifyAccessToken(token);
    req.user = { id: payload.sub };
    return next();
  } catch {
    return res.status(401).json({ error: 'invalid or expired access token' });
  }
}
