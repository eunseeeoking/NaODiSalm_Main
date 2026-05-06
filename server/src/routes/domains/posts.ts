import { Router } from 'express';
import { getPost, UpstreamError } from '../../services/clients/jsonplaceholder';

/**
 * posts 도메인 라우터
 * - 마운트 위치: /api/posts
 * - 외부 API(jsonplaceholder) 호출은 services 레이어에 위임한다.
 * - 라우터의 책임: 요청 파싱 → 서비스 호출 → 응답 형식화 + 에러 매핑
 */
export const postsRouter = Router();

// GET /api/posts/:id
postsRouter.get('/:id', async (req, res, next) => {
  try {
    const post = await getPost(req.params.id);
    res.json(post);
  } catch (err) {
    if (err instanceof UpstreamError) {
      return res.status(err.status).json({ error: err.message });
    }
    next(err);
  }
});
