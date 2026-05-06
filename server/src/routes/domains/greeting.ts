import { Router } from 'express';

/**
 * greeting 도메인 라우터
 * - 마운트 위치: /api/greeting
 * - 자체 처리(내부) 로직 예시
 */
export const greetingRouter = Router();

// GET /api/greeting/hello?name=foo
greetingRouter.get('/hello', (req, res) => {
  const name = (req.query.name as string) ?? 'world';
  res.json({ message: `Hello, ${name}!` });
});

// POST /api/greeting/echo
greetingRouter.post('/echo', (req, res) => {
  res.json({ youSent: req.body });
});
