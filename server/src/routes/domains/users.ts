import { Router } from 'express';
import {
  findAllUsers,
  findUserById,
  updateUser,
  deleteUser,
  incrementLoginFailCount,
  resetLoginFailCount,
} from '../../services/repositories/userRepository';

/**
 * users 도메인 라우터  (테이블: t_user)
 *  - 마운트: /api/users  (requireAuth 적용됨 — routes/api.ts 참고)
 *  - 사용자 "생성" 은 POST /api/auth/signup 에서만 수행한다.
 *    → 비밀번호 정책/잠금/감사 흐름이 한 곳에서 일관되게 처리되도록.
 */
export const usersRouter = Router();

// GET /api/users  — 소프트 삭제되지 않은 사용자 목록
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

// PATCH /api/users/:id  — password 는 별도 엔드포인트(추후) 에서만 변경
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

// DELETE /api/users/:id  — 소프트 삭제 (deleted_at 세팅, email 에 'del_' prefix)
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

// POST /api/users/:id/login-fail   — 로그인 실패 카운트 +1 (관리자/테스트용)
usersRouter.post('/:id/login-fail', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'invalid id' });
    res.json(await incrementLoginFailCount(id));
  } catch (e) {
    next(e);
  }
});

// POST /api/users/:id/login-success  — 로그인 실패 카운트 0 으로 리셋
usersRouter.post('/:id/login-success', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'invalid id' });
    res.json(await resetLoginFailCount(id));
  } catch (e) {
    next(e);
  }
});
