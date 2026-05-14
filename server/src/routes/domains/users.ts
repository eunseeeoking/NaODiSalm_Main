import { Router } from 'express';
import {
  findAllUsers,
  findUserById,
  createUser,
  updateUser,
  deleteUser,
  incrementLoginFailCount,
  resetLoginFailCount,
} from '../../services/repositories/userRepository';

/**
 * users 도메인 라우터  (테이블: t_user)
 * - 마운트 위치: /api/users
 * - DB 접근은 repository 함수에 위임 (Prisma API 직접 호출 금지)
 */
export const usersRouter = Router();

// GET /api/users   — 소프트 삭제되지 않은 사용자 목록
usersRouter.get('/', async (_req, res, next) => {
  try {
    res.json(await findAllUsers());
  } catch (e) {
    next(e);
  }
});

// GET /api/users/:id
usersRouter.get('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'invalid id' });
    const user = await findUserById(id);
    if (!user) return res.status(404).json({ error: 'not found' });
    res.json(user);
  } catch (e) {
    next(e);
  }
});

// POST /api/users  body: { email, name?, phone? }
usersRouter.post('/', async (req, res, next) => {
  try {
    const { email, name, phone } = req.body ?? {};
    if (typeof email !== 'string') {
      return res.status(400).json({ error: 'email is required' });
    }
    const user = await createUser({ email, name, phone });
    res.status(201).json(user);
  } catch (e) {
    next(e);
  }
});

// PATCH /api/users/:id
usersRouter.patch('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'invalid id' });
    const user = await updateUser(id, req.body ?? {});
    res.json(user);
  } catch (e) {
    next(e);
  }
});

// DELETE /api/users/:id   — 소프트 삭제 (deleted_at 세팅)
usersRouter.delete('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'invalid id' });
    await deleteUser(id);
    res.status(204).send();
  } catch (e) {
    next(e);
  }
});

// POST /api/users/:id/login-fail   — 로그인 실패 카운트 +1
usersRouter.post('/:id/login-fail', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'invalid id' });
    res.json(await incrementLoginFailCount(id));
  } catch (e) {
    next(e);
  }
});

// POST /api/users/:id/login-success   — 로그인 실패 카운트 0 으로 리셋
usersRouter.post('/:id/login-success', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'invalid id' });
    res.json(await resetLoginFailCount(id));
  } catch (e) {
    next(e);
  }
});
