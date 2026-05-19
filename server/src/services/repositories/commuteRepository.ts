/**
 * 통근 매트릭스 캐시 리포지토리 (t_commute_matrix)
 *
 *  ▷ KNN 격자 확장 검색 (v1.1)
 *    - 4자리 반올림 cacheKey 외에 ±0.0001 인접 격자 8개도 같이 조회
 *    - 행정동마다 가장 가까운 워크포인트 캐시 선택
 *    - 한 번의 SQL 로 9개 키 IN 검색 → DB 부담 거의 같음
 *    - exactMatch 플래그로 정확 일치 / 근접 사용 구분
 *
 *  효과
 *    · 같은 빌딩 다른 출구 (수 m 차이) → exact hit
 *    · 광화문 옆 30m 빵집 → nearby hit (호출 0)
 *    · 같은 도로 양쪽 빌딩 (20m 폭) → nearby hit (호출 0)
 *    · 200m 이상 떨어진 곳 → miss (신규 호출)
 */
import { prisma } from '../db';
import { haversineKm, makeCacheKeyCandidates } from '../external/odsay';

export interface CommuteEntry {
  legalDongCode: string;
  transitMinutes: number;
  transitTransfers: number | null;
  transitCostWon: number | null;
  carMinutes: number;
  /** 입력 좌표와 정확히 일치한 캐시인지 (false = 인접 격자에서 흡수) */
  exactMatch: boolean;
}

export interface UpsertEntry {
  legalDongCode: string;
  transitMinutes: number;
  transitTransfers: number | null;
  transitCostWon: number | null;
  carMinutes: number;
  workLat: number;
  workLng: number;
  workLabel?: string | null;
}

/**
 * 9격자 KNN 캐시 조회
 *  - origin 좌표 주변 ±0.0001 격자 9개를 한 번에 IN 검색
 *  - 각 행정동마다 origin 에서 가장 가까운 워크포인트 항목 선택
 *  - exactMatch 플래그로 정확 일치 / 근접 캐시 구분
 */
export async function findCachedMatrix(
  origin: { lat: number; lng: number },
  dongCodes?: string[],
): Promise<Map<string, CommuteEntry>> {
  const candidates = makeCacheKeyCandidates(origin.lat, origin.lng);
  const exactKey = candidates[4]; // 가운데 (3×3 중 중심) = 정확 일치 키

  const rows = await prisma.commuteMatrix.findMany({
    where: {
      cacheKey: { in: candidates },
      ...(dongCodes && dongCodes.length > 0
        ? { legalDongCode: { in: dongCodes } }
        : {}),
    },
    select: {
      cacheKey: true,
      workLat: true,
      workLng: true,
      legalDongCode: true,
      transitMinutes: true,
      transitTransfers: true,
      transitCostWon: true,
      carMinutes: true,
    },
  });

  // 행정동마다 가장 가까운 워크포인트 선택
  const best = new Map<string, { entry: CommuteEntry; distance: number }>();
  for (const r of rows) {
    const distance = haversineKm(origin, { lat: r.workLat, lng: r.workLng });
    const existing = best.get(r.legalDongCode);
    if (!existing || distance < existing.distance) {
      best.set(r.legalDongCode, {
        entry: {
          legalDongCode: r.legalDongCode,
          transitMinutes: r.transitMinutes,
          transitTransfers: r.transitTransfers,
          transitCostWon: r.transitCostWon,
          carMinutes: r.carMinutes,
          exactMatch: r.cacheKey === exactKey,
        },
        distance,
      });
    }
  }

  const result = new Map<string, CommuteEntry>();
  for (const [code, v] of best) {
    result.set(code, v.entry);
  }
  return result;
}

/**
 * 신규 매트릭스 항목 일괄 upsert (정확 일치 키 기준으로만 저장)
 *  - 격자 확장은 조회용 — 새 데이터는 항상 입력 좌표의 정확 cacheKey 로 저장
 *  - 같은 행정동에 대한 여러 워크포인트 캐시가 누적되어 KNN 정확도 ↑
 */
export async function upsertCommuteEntries(
  cacheKey: string,
  entries: UpsertEntry[],
): Promise<number> {
  let written = 0;
  for (const e of entries) {
    await prisma.commuteMatrix.upsert({
      where: {
        cacheKey_legalDongCode: {
          cacheKey,
          legalDongCode: e.legalDongCode,
        },
      },
      create: {
        cacheKey,
        workLat: e.workLat,
        workLng: e.workLng,
        workLabel: e.workLabel ?? null,
        legalDongCode: e.legalDongCode,
        transitMinutes: e.transitMinutes,
        transitTransfers: e.transitTransfers,
        transitCostWon: e.transitCostWon,
        carMinutes: e.carMinutes,
      },
      update: {
        transitMinutes: e.transitMinutes,
        transitTransfers: e.transitTransfers,
        transitCostWon: e.transitCostWon,
        carMinutes: e.carMinutes,
        computedAt: new Date(),
      },
    });
    written += 1;
  }
  return written;
}
