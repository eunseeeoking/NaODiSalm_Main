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
 *  GET /api/commute/compare?complexId=&wpLat=&wpLng=
 *    Params: complexId, wpLat, wpLng (직장 좌표)
 *    Response: CommuteCompareDto  (대중교통 + 자차 비교)
 *
 *    동작:
 *      1) t_apt_complex 에서 단지 lat/lng 조회
 *      2) t_commute_matrix KNN 캐시 확인 (단지 legalDongCode 기준)
 *      3) 캐시 miss → ODsay 단일 호출 (단지 centroid 좌표 사용)
 *      4) 자차: Haversine × 1.4 (도로 굴곡) / 35 km/h
 *      5) CommuteCompareDto 반환
 *
 *  동작 (matrix):
 *    1) origin 좌표 주변 9격자 (3×3) 캐시 일괄 조회
 *    2) 각 행정동마다 가장 가까운 워크포인트 캐시 선택
 *    3) 누락 target 만 ODsay 배치 호출 (rate-limited)
 *    4) 결과 + 자차 추정 → DB upsert (정확 cacheKey 로 저장)
 *    5) 전체 매트릭스 반환
 */
import { Router, Request, Response } from 'express';
import {
  fetchOdsayBatch,
  fetchOdsayRoute,
  fetchKakaoCarRoute,
  estimateCarMinutes,
  makeCacheKey,
  haversineKm,
} from '../../services/external/odsay';
import {
  findCachedMatrix,
  upsertCommuteEntries,
  type CommuteEntry,
} from '../../services/repositories/commuteRepository';
import { prisma } from '../../services/db';

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

/**
 * in-flight 락 (cacheKey 단위)
 *  - 같은 origin(=cacheKey) 으로 빠르게 연달아 들어온 /matrix 요청을 직렬화.
 *  - 디바운스/abort 가 빠져나간 동시 요청이 ODsay 호출 + DB INSERT 를 중복으로
 *    터뜨리는 걸 방지 (먼저 끝난 요청이 캐시를 채우면, 뒤 요청은 캐시 hit 로 흡수).
 *  - 결과를 공유하지 않고 "순차 실행"만 보장 → 뒤 요청은 앞 요청이 쓴 캐시를 읽음.
 */
const inFlight = new Map<string, Promise<unknown>>();

async function withCacheKeyLock<T>(
  cacheKey: string,
  fn: () => Promise<T>,
): Promise<T> {
  const prev = inFlight.get(cacheKey) ?? Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  inFlight.set(cacheKey, next);
  // 가장 마지막 요청이면 settle 후 정리 (메모리 누수 방지)
  next.finally(() => {
    if (inFlight.get(cacheKey) === next) inFlight.delete(cacheKey);
  });
  return next;
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

  try {
    // 같은 cacheKey 요청은 직렬화 → 앞 요청이 캐시를 채우면 뒤 요청은 hit 로 흡수
    const payload = await withCacheKeyLock(cacheKey, async () => {
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

      return {
        cacheKey,
        cacheHit: exactHits,
        cacheNearby: nearbyHits,
        cacheMiss: missTargets.length,
        written: writtenCount,
        matrix,
      };
    });

    res.json({ ...payload, elapsedMs: Date.now() - started });
  } catch (e) {
    console.error('[commute/matrix] fail:', e);
    res.status(500).json({ error: 'commute matrix failed' });
  }
});

// ─── GET /api/commute/compare ─────────────────────────────────────────────────
/**
 * 단지 ↔ 직장 대중교통 + 자차 비교
 *  Query: complexId (int), wpLat (float), wpLng (float)
 *  Response: CommuteCompareDto
 */
interface CommuteCompareDto {
  transitMinutes: number;
  transfers: number;
  transitCost: number;   // 원
  carMinutes: number;
  carCost: number;       // 원 (연료비 추정: 연비 12km/L × 1,700원/L + 거리요금)
  /** 대중교통 데이터 출처 */
  source: 'cache' | 'odsay' | 'estimate';
  /** 자차 데이터 출처 ('kakao' = 실경로, 'estimate' = Haversine 비선형 추정) */
  carSource: 'kakao' | 'estimate';
}

commuteRouter.get('/compare', async (req: Request, res: Response) => {
  const { complexId: rawId, wpLat: rawLat, wpLng: rawLng } = req.query as Record<string, string>;

  // ── 검증 ────────────────────────────────────────────────────────
  const complexId = parseInt(rawId, 10);
  const wpLat = parseFloat(rawLat);
  const wpLng = parseFloat(rawLng);
  if (isNaN(complexId) || complexId <= 0) {
    return res.status(400).json({ error: 'complexId must be a positive integer' });
  }
  if (isNaN(wpLat) || isNaN(wpLng)) {
    return res.status(400).json({ error: 'wpLat and wpLng (float) required' });
  }

  // ── 1) 단지 좌표 조회 ────────────────────────────────────────────
  const complex = await prisma.aptComplex.findUnique({
    where: { id: complexId },
    select: { id: true, lat: true, lng: true, legalDong: true, sigunguCode: true },
  }).catch(() => null);

  if (!complex || complex.lat == null || complex.lng == null) {
    return res.status(404).json({ error: 'Complex not found or missing coordinates', complexId });
  }

  const complexCoord = { lat: complex.lat, lng: complex.lng };
  const workCoord = { lat: wpLat, lng: wpLng };

  // ── 2) legalDongCode 매핑 ────────────────────────────────────────
  //    t_legal_dong: code 앞 5자리 = sigungu_code, dong = 법정동명
  //    sigunguCode="11680" → code LIKE "11680_____" (10자리 전체)
  const dongRow = await prisma.legalDong.findFirst({
    where: {
      code: { startsWith: complex.sigunguCode },
      dong: complex.legalDong,
    },
    select: { code: true },
  }).catch(() => null);

  const legalDongCode = dongRow?.code ?? null;

  let source: CommuteCompareDto['source'] = 'estimate';

  // ── Haversine 기본값 (캐시/ODsay 실패 시 사용) ─────────────────
  const kmBase = haversineKm(workCoord, complexCoord);
  const transitBase0 = (kmBase / 25) * 60;
  const tfCount0 = Math.min(3, Math.max(0, Math.floor(kmBase / 3) - 1));
  let transitMinutes: number = Math.round(transitBase0 + tfCount0 * 5 + 8);
  let transfers: number = tfCount0;
  let transitCostWon: number = Math.round(1500 + Math.max(0, kmBase - 5) * 100);

  // ── 카카오 자차 경로 조기 시작 (ODsay 와 병렬 실행) ─────────────
  //    캐시 hit 여부와 무관하게 항상 실경로 요청 (일 30만건 무료)
  const kakaoPromise = fetchKakaoCarRoute(workCoord, complexCoord);

  // ── 3) 캐시 확인 (legalDongCode 있을 때만) ──────────────────────
  let cacheHit = false;
  if (legalDongCode) {
    const cached = await findCachedMatrix(workCoord, [legalDongCode]);
    const entry = cached.get(legalDongCode);
    if (entry) {
      transitMinutes = entry.transitMinutes;
      transfers = entry.transitTransfers ?? 0;
      transitCostWon = entry.transitCostWon ?? 1500;
      source = 'cache';
      cacheHit = true;
    }
  }

  // ── 4) 캐시 miss → ODsay 단일 호출 ─────────────────────────────
  if (!cacheHit) {
    try {
      const odsay = await fetchOdsayRoute(workCoord, complexCoord);
      if (odsay) {
        transitMinutes = odsay.transitMinutes;
        transfers = odsay.transitTransfers;
        transitCostWon = odsay.transitCostWon;
        source = 'odsay';
      } else {
        // ODsay 실패 (도보 거리, 경로 없음 등) → Haversine 유지
        source = 'estimate';
      }
    } catch {
      // ODSAY_API_KEY 없음 등 — Haversine 유지
      source = 'estimate';
    }
  }

  // ── 5) 자차 — 카카오 실경로 우선, 실패 시 Haversine 비선형 추정 폴백 ──
  const kakaoResult = await kakaoPromise;
  const carSource: CommuteCompareDto['carSource'] = kakaoResult ? 'kakao' : 'estimate';
  const carMinutes = kakaoResult?.carMinutes ?? estimateCarMinutes(workCoord, complexCoord);
  // 비용: 연료(연비 12km/L × 1,700원/L) + 주차(서울 평균 ~4,000원/일 기본) + 거리 소모비
  // Kakao 실경로 거리 우선, 없으면 Haversine × 1.6 (도로 굴곡 보정)
  const kmRoad = kakaoResult?.carDistanceKm ?? kmBase * 1.6;
  const carCost = Math.round(4000 + (kmRoad / 12) * 1700 + kmRoad * 50);

  // ── 캐시 저장 (비동기 — 응답 지연 없음) ────────────────────────
  //    캐시 miss 시에만 저장, Kakao 실경로 carMinutes 포함
  if (!cacheHit && legalDongCode) {
    const cacheKey = makeCacheKey(wpLat, wpLng);
    upsertCommuteEntries(cacheKey, [{
      legalDongCode,
      transitMinutes,
      transitTransfers: transfers,
      transitCostWon,
      carMinutes,   // Kakao 실경로 or 추정값
      workLat: wpLat,
      workLng: wpLng,
      workLabel: null,
    }]).catch((e) => console.warn('[commute/compare] cache write fail:', e));
  }

  const dto: CommuteCompareDto = {
    transitMinutes,
    transfers,
    transitCost: transitCostWon,
    carMinutes,
    carCost,
    source,
    carSource,
  };

  return res.json(dto);
});
