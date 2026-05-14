import { Router } from 'express';
import {
  createUser,
  findUserById,
  verifyLogin,
} from '../../services/repositories/userRepository';
import {
  createSession,
  rotateSession,
  revokeByRefresh,
} from '../../services/repositories/tokenRepository';
import { requireAuth, type AuthedRequest } from '../../middleware/requireAuth';
import {
  REFRESH_COOKIE,
  clearAuthCookies,
  setAuthCookies,
} from '../../services/auth/cookies';

/**
 * 인증 도메인 라우터  (/api/auth)
 *
 * 모든 토큰은 httpOnly 쿠키로만 주고받는다 — 응답 본문에는 토큰 노출 X.
 */
export const authRouter = Router();

function clientMeta(req: import('express').Request) {
  return {
    userAgent: req.header('user-agent') ?? null,
    ipAddress: req.ip ?? null,
  };
}

// POST /api/auth/signup
authRouter.post('/signup', async (req, res, next) => {
  try {
    const { email, password, name, phone } = req.body ?? {};
    if (typeof email !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ error: 'email and password are required' });
    }
    if (password.length < 4) {
      return res.status(400).json({ error: 'password too short' });
    }
    const user = await createUser({ email, password, name, phone });
    res.status(201).json(user);
  } catch (e) {
    next(e);
  }
});

// POST /api/auth/login   body: { email, password, rememberMe? }
authRouter.post('/login', async (req, res, next) => {
  try {
    const { email, password, rememberMe } = req.body ?? {};
    if (typeof email !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ error: 'email and password are required' });
    }

    const result = await verifyLogin(email, password);
    if (!result.ok) {
      const status = result.reason === 'LOCKED' ? 423 : 401;
      return res
        .status(status)
        .json({ error: 'invalid credentials', reason: result.reason });
    }

    const tokens = await createSession(
      result.user.id,
      Boolean(rememberMe),
      clientMeta(req),
    );
    setAuthCookies(res, tokens);

    // 응답 본문에는 사용자 정보만 — 토큰은 쿠키로만 전송
    res.json({ user: result.user });
  } catch (e) {
    next(e);
  }
});

// POST /api/auth/refresh   (body 없음 — refresh 는 쿠키에서 읽음)
authRouter.post('/refresh', async (req, res, next) => {
  try {
    const refreshToken = req.cookies?.[REFRESH_COOKIE];
    if (typeof refreshToken !== 'string' || !refreshToken) {
      return res.status(401).json({ error: 'no refresh token' });
    }

    const tokens = await rotateSession(refreshToken, clientMeta(req));
    if (!tokens) {
      clearAuthCookies(res);
      return res.status(401).json({ error: 'invalid or expired refresh token' });
    }
    setAuthCookies(res, tokens);
    res.status(204).send();
  } catch (e) {
    next(e);
  }
});

// POST /api/auth/logout
authRouter.post('/logout', async (req, res, next) => {
  try {
    const refreshToken = req.cookies?.[REFRESH_COOKIE];
    if (typeof refreshToken === 'string') {
      await revokeByRefresh(refreshToken);
    }
    clearAuthCookies(res);
    res.status(204).send();
  } catch (e) {
    next(e);
  }
});

// GET /api/auth/me   (보호됨, 쿠키 자동 인증)
authRouter.get('/me', requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const id = req.user!.id;
    const user = await findUserById(id);
    if (!user) return res.status(404).json({ error: 'user not found' });
    res.json(user);
  } catch (e) {
    next(e);
  }
});
