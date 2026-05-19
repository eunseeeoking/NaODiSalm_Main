/**
 * 통근 매트릭스 API
 *
 *  POST /api/commute/matrix
 *    body: {
 *      origin: { lat, lng, label? },
 *      targets: [{ code, lat, lng }, ...]
 *    }
 *    response: {
 *      cacheKey: string,
 *      cacheHit: number,      // 정확 좌표 일치 (4자리 동일)
 *      cacheNearby: number,   // 인접 격자에서 흡수 (KNN)
 *      cacheMiss: number,     // 신규 ODsay 호출
 *      written: number,
 *      elapsedMs: number,
 *      matrix: { [legalDongCode]: { transitMinutes, transitTransfers, transitCostWon, carMinutes } }
 *    }
 *
 *  동작:
 *    1) origin 좌표 주변 9격자 (3×3) 캐시 일괄 조회
 *    2) 각 행정동마다 가장 가까운 워크포인트 캐시 선택
 *    3) 누락 target 만 ODsay 배치 호출 (rate-limited)
 *    4) 결과 + 자차 추정 → DB upsert (정확 cacheKey 로 저장)
 *    5) 전체 매트릭스 반환
 */
import { Router, Request, Response } from 'express';
import {
  fetchOdsayBatch,
  estimateCarMinutes,
  makeCacheKey,
} from '../../services/external/odsay';
import {
  findCachedMatrix,
  upsertCommuteEntries,
  type CommuteEntry,
} from '../../services/repositories/commuteRepository';

export const commuteRouter = Router();

interface Target {
  code: string;
  lat: number;
  lng: number;
}

interface MatrixRequestBody {
  origin: { lat: number; lng: number; label?: string };
  targets: Target[];
}

commuteRouter.post('/matrix', async (req: Request, res: Response) => {
  const started = Date.now();
  const body = req.body as Partial<MatrixRequestBody>;

  // ── 검증 ───────────────────────────────────────────────────
  if (
    !body.origin ||
    typeof body.origin.lat !== 'number' ||
    typeof body.origin.lng !== 'number'
  ) {
    return res
      .status(400)
      .json({ error: 'origin.{lat,lng} (number) required' });
  }
  if (!Array.isArray(body.targets) || body.targets.length === 0) {
    return res.status(400).json({ error: 'targets[] (non-empty) required' });
  }
  if (body.targets.length > 1000) {
    return res.status(400).json({ error: 'targets max 1000 per request' });
  }
  for (const t of body.targets) {
    if (
      !t.code ||
      typeof t.lat !== 'number' ||
      typeof t.lng !== 'number'
    ) {
      return res
        .status(400)
        .json({ error: 'each target requires { code, lat, lng }' });
    }
  }

  const origin = body.origin;
  const targets = body.targets;
  const cacheKey = makeCacheKey(origin.lat, origin.lng);

  // ── 1) 9격자 KNN 캐시 조회 ─────────────────────────────────
  const cached = await findCachedMatrix(
    origin,
    targets.map((t) => t.code),
  );

  // 정확 일치 / 근접 흡수 카운트 분리
  let exactHits = 0;
  let nearbyHits = 0;
  for (const entry of cached.values()) {
    if (entry.exactMatch) exactHits += 1;
    else nearbyHits += 1;
  }

  const missTargets = targets.filter((t) => !cached.has(t.code));
  let writtenCount = 0;

  // ── 2) cache miss 만 ODsay 호출 ─────────────────────────────
  if (missTargets.length > 0) {
    const odsayResults = await fetchOdsayBatch(
      origin,
      missTargets.map((t) => ({ lat: t.lat, lng: t.lng })),
    );

    const upsertEntries = missTargets.map((t, i) => {
      const transit = odsayResults[i];
      const carMin = estimateCarMinutes(origin, t);
      const transitMinutes =
        transit?.transitMinutes ?? Math.round(carMin * 1.4);
      const entry: CommuteEntry = {
        legalDongCode: t.code,
        transitMinutes,
        transitTransfers: transit?.transitTransfers ?? null,
        transitCostWon: transit?.transitCostWon ?? null,
        carMinutes: carMin,
        exactMatch: true, // 방금 정확 cacheKey 로 저장하니까
      };
      cached.set(t.code, entry);
      return {
        legalDongCode: t.code,
        transitMinutes,
        transitTransfers: transit?.transitTransfers ?? null,
        transitCostWon: transit?.transitCostWon ?? null,
        carMinutes: carMin,
        workLat: origin.lat,
        workLng: origin.lng,
        workLabel: origin.label ?? null,
      };
    });

    writtenCount = await upsertCommuteEntries(cacheKey, upsertEntries);
  }

  // ── 3) 응답 조립 ───────────────────────────────────────────
  const matrix: Record<string, Omit<CommuteEntry, 'exactMatch'>> = {};
  for (const t of targets) {
    const entry = cached.get(t.code);
    if (entry) {
      const { exactMatch: _omit, ...rest } = entry;
      matrix[t.code] = rest;
    }
  }

  res.json({
    cacheKey,
    cacheHit: exactHits,
    cacheNearby: nearbyHits,
    cacheMiss: missTargets.length,
    written: writtenCount,
    elapsedMs: Date.now() - started,
    matrix,
  });
});
