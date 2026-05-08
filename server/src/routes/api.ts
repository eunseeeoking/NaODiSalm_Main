import { Router } from 'express';
import { greetingRouter } from './domains/greeting';
import { postsRouter } from './domains/posts';
import { usersRouter } from './domains/users';
import { authRouter } from './domains/auth';
import { requireAuth } from '../middleware/requireAuth';

/**
 * /api 진입점.
 * 도메인 단위로 라우터를 마운트한다.
 *  - /api/greeting/* → public, 자체 처리 로직
 *  - /api/posts/*    → public, 외부 API 위임
 *  - /api/auth/*     → public(login/signup/refresh) + protected(me)
 *  - /api/users/*    → 보호됨 (requireAuth)
 */
export const apiRouter = Router();

apiRouter.use('/greeting', greetingRouter);
apiRouter.use('/posts', postsRouter);
apiRouter.use('/auth', authRouter);
apiRouter.use('/users', requireAuth, usersRouter);
