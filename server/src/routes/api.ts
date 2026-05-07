import { Router } from 'express';
import { greetingRouter } from './domains/greeting';
import { postsRouter } from './domains/posts';
import { usersRouter } from './domains/users';
import { authRouter } from './domains/auth';

/**
 * /api 진입점.
 * 도메인 단위로 라우터를 마운트한다.
 *  - /api/greeting/* → 자체 처리 로직
 *  - /api/posts/*    → 외부 API(jsonplaceholder)에 위임 (services/clients)
 *  - /api/users/*    → DB 접근 (services/repositories)
 *  - /api/auth/*     → 가입/로그인 (services/repositories)
 */
export const apiRouter = Router();

apiRouter.use('/greeting', greetingRouter);
apiRouter.use('/posts', postsRouter);
apiRouter.use('/users', usersRouter);
apiRouter.use('/auth', authRouter);
