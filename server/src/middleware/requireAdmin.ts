import type { Request, Response, NextFunction } from 'express';

/**
 * 관리자 토큰 검사 미들웨어.
 *  - 헤더 X-Admin-Token: <ADMIN_TOKEN> 으로 호출
 *  - ADMIN_TOKEN 환경변수와 정확 일치하면 통과
 *  - 비교는 timing-safe (길이 다르면 false)
 */

import crypto from 'crypto';

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) {
    return res.status(503).json({ error: 'admin endpoint disabled (ADMIN_TOKEN not set)' });
  }
  const got = req.header('x-admin-token') ?? '';
  if (!safeEqual(got, expected)) {
    return res.status(403).json({ error: 'admin token mismatch' });
  }
  next();
}
