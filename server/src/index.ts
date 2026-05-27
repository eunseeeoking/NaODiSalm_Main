import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { healthRouter } from './routes/health';
import { apiRouter } from './routes/api';
import { disconnectDb } from './services/db';

const app = express();
const PORT = Number(process.env.PORT) || 4000;

// 쉼표로 여러 origin 지정 가능 — Vercel preview URL 포함시키려면
// CORS_ORIGIN=https://prod.vercel.app,https://*.vercel.app
const ALLOWED_ORIGINS = (
  process.env.CORS_ORIGIN ?? 'http://localhost:5173'
)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

function isAllowedOrigin(origin: string): boolean {
  return ALLOWED_ORIGINS.some((pattern) => {
    if (pattern === origin) return true;
    // *.vercel.app 같은 와일드카드 prefix 지원
    if (pattern.startsWith('https://*.')) {
      const suffix = pattern.slice('https://*'.length);
      return origin.startsWith('https://') && origin.endsWith(suffix);
    }
    return false;
  });
}

// Middlewares
app.set('trust proxy', 1); // Render/Vercel 같은 프록시 뒤에서 req.ip / secure 정확히 인식
app.use(
  cors({
    origin: (origin, cb) => {
      // server-to-server, curl, 같은 출처 → origin 없음
      if (!origin) return cb(null, true);
      if (isAllowedOrigin(origin)) return cb(null, true);
      // 거절은 에러가 아니라 단순히 ACAO 헤더 미발행 (브라우저가 차단)
      // → 우리 서버 로그에는 남기지 않고, 응답도 500 이 되지 않음
      console.warn(`[cors] origin not allowed: ${origin}`);
      cb(null, false);
    },
    credentials: true,
  }),
);
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/health', healthRouter);
app.use('/api', apiRouter);

// ── 인코딩 진단 엔드포인트 (개발 전용) ─────────────────────────
// curl http://localhost:4000/enc-test → 결과 확인 후 제거
if (process.env.NODE_ENV !== 'production') {
  app.get('/enc-test', (_req, res) => {
    const sample = '중대형소형신축구축';
    res.json({
      literal: sample,
      charCodes: [...sample].map((c) => c.charCodeAt(0).toString(16)),
      expected: ['c911', 'b300', 'd615', 'c18c', 'd615', 'c2e0', 'cd95', 'ad6c', 'cd95'],
    });
  });
}

// 404 handler
app.use((req: Request, res: Response) => {
  res.status(404).json({ error: 'Not Found', path: req.path });
});

// Error handler
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[error]', err);
  res.status(500).json({ error: 'Internal Server Error', message: err.message });
});

const server = app.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}`);
});

// Graceful shutdown — DB 커넥션 정리
async function shutdown(signal: string) {
  console.log(`[server] ${signal} received, shutting down...`);
  server.close(async () => {
    await disconnectDb();
    process.exit(0);
  });
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

// ─── Process-level 안전망 (2026-05-27 Hotfix) ─────────────────
//   Express 4 의 async handler 에서 throw 된 promise rejection 은 자동으로
//   error middleware 로 가지 않음. Node 15+ 의 unhandledRejection 기본 동작
//   (--unhandled-rejections=throw) 으로 process 가 종료될 수 있음.
//   다량 동시 호출에서 ARIMA SQL 실패 / DB 풀 고갈 / 외부 API 타임아웃 등이
//   process 자체를 죽이지 않도록 log + 계속 동작.
process.on('unhandledRejection', (reason, promise) => {
  console.error('[unhandledRejection]', reason);
  // promise 자체는 어디서 발생했는지 추적 어려움 — 핫스팟은 라우터별 try-catch 권장
  void promise;
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
  // 동기 throw — Node 가 일반적으로 process 종료. 일단 로그만 남기고 계속.
  // 진짜 위험한 에러면 SIGTERM 으로 보내서 graceful shutdown.
});
