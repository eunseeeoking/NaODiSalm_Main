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

/**
 * 인증 도메인 라우터  (/api/auth)
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

    res.json({
      user: result.user,
      ...tokens,
    });
  } catch (e) {
    next(e);
  }
});

// POST /api/auth/refresh   body: { refreshToken }
authRouter.post('/refresh', async (req, res, next) => {
  try {
    const { refreshToken } = req.body ?? {};
    if (typeof refreshToken !== 'string') {
      return res.status(400).json({ error: 'refreshToken is required' });
    }

    const tokens = await rotateSession(refreshToken, clientMeta(req));
    if (!tokens) {
      return res.status(401).json({ error: 'invalid or expired refresh token' });
    }
    res.json(tokens);
  } catch (e) {
    next(e);
  }
});

// POST /api/auth/logout   body: { refreshToken }
authRouter.post('/logout', async (req, res, next) => {
  try {
    const { refreshToken } = req.body ?? {};
    if (typeof refreshToken === 'string') {
      await revokeByRefresh(refreshToken);
    }
    res.status(204).send();
  } catch (e) {
    next(e);
  }
});

// GET /api/auth/me   (보호됨)
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
