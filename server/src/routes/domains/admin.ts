import { Router } from 'express';
import { requireAdmin } from '../../middleware/requireAdmin';
import {
  ingestSigunguMonth,
  geocodeMissingComplexes,
} from '../../services/ingest/aptIngest';
import {
  startBulkIngest,
  getBulkProgress,
  listAllProgress,
  abortBulk,
  buildMonthRange,
} from '../../services/ingest/bulkRunner';
import { SEOUL_LAWD_CODES } from '../../data/seoulLawdCodes';

/**
 * 관리자 도메인 — ingest/지오코딩 수동 트리거.
 *  - 모든 엔드포인트 requireAdmin
 *  - X-Admin-Token 헤더로 인증
 */
export const adminRouter = Router();

adminRouter.use(requireAdmin);

// POST /api/admin/ingest/apt   body: { sigunguCode, yyyymm }
adminRouter.post('/ingest/apt', async (req, res, next) => {
  try {
    const { sigunguCode, yyyymm } = req.body ?? {};
    if (typeof sigunguCode !== 'string' || !/^\d{5}$/.test(sigunguCode)) {
      return res.status(400).json({ error: 'sigunguCode must be 5-digit string' });
    }
    if (typeof yyyymm !== 'string' || !/^\d{6}$/.test(yyyymm)) {
      return res.status(400).json({ error: 'yyyymm must be 6-digit string (YYYYMM)' });
    }
    const summary = await ingestSigunguMonth(sigunguCode, yyyymm);
    res.json(summary);
  } catch (e) {
    next(e);
  }
});

// POST /api/admin/ingest/apt/seoul   body: { yyyymm } | { fromYM, toYM }
// (동기 실행 — 짧은 범위만)
adminRouter.post('/ingest/apt/seoul', async (req, res, next) => {
  try {
    const { yyyymm, fromYM, toYM } = req.body ?? {};
    const months: string[] = [];
    if (typeof yyyymm === 'string' && /^\d{6}$/.test(yyyymm)) {
      months.push(yyyymm);
    } else if (
      typeof fromYM === 'string' &&
      typeof toYM === 'string' &&
      /^\d{6}$/.test(fromYM) &&
      /^\d{6}$/.test(toYM)
    ) {
      months.push(...buildMonthRange(fromYM, toYM));
      if (months.length === 0) return res.status(400).json({ error: 'toYM < fromYM' });
    } else {
      return res
        .status(400)
        .json({ error: 'provide yyyymm OR (fromYM AND toYM)' });
    }

    const results: unknown[] = [];
    for (const code of SEOUL_LAWD_CODES) {
      for (const ym of months) {
        const s = await ingestSigunguMonth(code.code, ym);
        results.push({ ...s, name: code.name });
      }
    }
    res.json({ months, count: results.length, results });
  } catch (e) {
    next(e);
  }
});

/**
 * POST /api/admin/ingest/apt/bulk
 *   body: {
 *     fromYM: "YYYYMM",
 *     toYM:   "YYYYMM",
 *     sigunguCodes?: string[],  // 생략 시 서울 25 구 전체
 *     sleepMs?: number,         // 호출 간 슬립 (기본 1000)
 *     abortOnQuota?: boolean    // 한도 초과 시 자동 중단 (기본 true)
 *   }
 *
 * → 202 Accepted + { taskId, totalSteps, checkUrl } 즉시 반환
 * → 실제 ingest 는 백그라운드 진행
 * → 진행 상황: GET /api/admin/ingest/status/:taskId
 */
adminRouter.post('/ingest/apt/bulk', (req, res) => {
  const { fromYM, toYM, sigunguCodes, sleepMs, abortOnQuota } = req.body ?? {};

  if (typeof fromYM !== 'string' || !/^\d{6}$/.test(fromYM)) {
    return res.status(400).json({ error: 'fromYM is required (YYYYMM)' });
  }
  if (typeof toYM !== 'string' || !/^\d{6}$/.test(toYM)) {
    return res.status(400).json({ error: 'toYM is required (YYYYMM)' });
  }

  const months = buildMonthRange(fromYM, toYM);
  if (months.length === 0) {
    return res.status(400).json({ error: 'toYM < fromYM' });
  }

  const codes: string[] =
    Array.isArray(sigunguCodes) && sigunguCodes.length > 0
      ? sigunguCodes.filter(
          (c: unknown): c is string => typeof c === 'string' && /^\d{5}$/.test(c),
        )
      : SEOUL_LAWD_CODES.map((s) => s.code);

  if (codes.length === 0) {
    return res.status(400).json({ error: 'no valid sigunguCodes' });
  }

  const taskId = startBulkIngest({
    sigunguCodes: codes,
    months,
    sleepMs: typeof sleepMs === 'number' ? sleepMs : undefined,
    abortOnQuota: typeof abortOnQuota === 'boolean' ? abortOnQuota : undefined,
  });

  res.status(202).json({
    taskId,
    totalSteps: codes.length * months.length,
    sigunguCount: codes.length,
    monthCount: months.length,
    months,
    sigunguCodes: codes,
    checkUrl: `/api/admin/ingest/status/${taskId}`,
  });
});

// GET /api/admin/ingest/status/:taskId
adminRouter.get('/ingest/status/:taskId', (req, res) => {
  const p = getBulkProgress(req.params.taskId);
  if (!p) return res.status(404).json({ error: 'task not found' });

  const pct =
    p.totalSteps > 0
      ? Math.round((p.completedSteps / p.totalSteps) * 100)
      : 0;

  res.json({
    taskId: p.taskId,
    status: p.status,
    progressPct: pct,
    startedAt: p.startedAt,
    finishedAt: p.finishedAt,
    totalSteps: p.totalSteps,
    completedSteps: p.completedSteps,
    failedSteps: p.failedSteps,
    currentStep: p.currentStep,
    totalTrades: p.totalTrades,
    totalRents: p.totalRents,
    totalComplexes: p.totalComplexes,
    errorCount: p.errors.length,
    lastResults: p.results.slice(-5),
    recentErrors: p.errors.slice(-5),
  });
});

// GET /api/admin/ingest/status — 전체 task 요약
adminRouter.get('/ingest/status', (_req, res) => {
  res.json(
    listAllProgress().map((p) => ({
      taskId: p.taskId,
      status: p.status,
      startedAt: p.startedAt,
      finishedAt: p.finishedAt,
      totalSteps: p.totalSteps,
      completedSteps: p.completedSteps,
      failedSteps: p.failedSteps,
      totalTrades: p.totalTrades,
      totalRents: p.totalRents,
      currentStep: p.currentStep,
    })),
  );
});

// POST /api/admin/ingest/abort/:taskId — 진행 중단
adminRouter.post('/ingest/abort/:taskId', (req, res) => {
  const ok = abortBulk(req.params.taskId);
  if (!ok) return res.status(404).json({ error: 'no running task with this id' });
  res.json({ aborted: true });
});

// POST /api/admin/geocode   body: { maxCount?: number }
adminRouter.post('/geocode', async (req, res, next) => {
  try {
    const maxCount = Number(req.body?.maxCount ?? 50);
    const r = await geocodeMissingComplexes(
      Number.isFinite(maxCount) ? maxCount : 50,
    );
    res.json(r);
  } catch (e) {
    next(e);
  }
});
