import { Router } from 'express';
import { createUser, verifyLogin } from '../../services/repositories/userRepository';

/**
 * 인증 도메인 라우터
 *  - 마운트: /api/auth
 *  - 본 구현은 세션/JWT 없이 "이메일 + 비밀번호 검증" 만 수행
 */
export const authRouter = Router();

// POST /api/auth/signup  body: { email, password, name?, phone? }
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

// POST /api/auth/login  body: { email, password }
authRouter.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body ?? {};
    if (typeof email !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ error: 'email and password are required' });
    }

    const result = await verifyLogin(email, password);
    if (!result.ok) {
      return res
        .status(401)
        .json({ error: 'invalid credentials', reason: result.reason });
    }
    res.json(result.user);
  } catch (e) {
    next(e);
  }
});
