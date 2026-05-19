import { Router } from 'express';
import { greetingRouter } from './domains/greeting';
import { postsRouter } from './domains/posts';
import { usersRouter } from './domains/users';
import { authRouter } from './domains/auth';
import { adminRouter } from './domains/admin';
import { realtyRouter } from './domains/realty';
import { commuteRouter } from './domains/commute';
import { requireAuth } from '../middleware/requireAuth';

/**
 * /api 진입점.
 * 도메인 단위로 라우터를 마운트한다.
 *  - /api/greeting/* → public, 자체 처리 로직
 *  - /api/posts/*    → public, 외부 API 위임
 *  - /api/auth/*     → public(login/signup/refresh) + protected(me)
 *  - /api/users/*    → 보호됨 (requireAuth)
 *  - /api/admin/*    → X-Admin-Token 헤더 필수 (ingest/지오코딩)
 *  - /api/realty/*   → public, 단지/거래 조회
 *  - /api/commute/*  → public, 통근 매트릭스 (ODsay 캐싱)
 */
export const apiRouter = Router();

apiRouter.use('/greeting', greetingRouter);
apiRouter.use('/posts', postsRouter);
apiRouter.use('/auth', authRouter);
apiRouter.use('/users', requireAuth, usersRouter);
apiRouter.use('/admin', adminRouter);
apiRouter.use('/realty', realtyRouter);
apiRouter.use('/commute', commuteRouter);
