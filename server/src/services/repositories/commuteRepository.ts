/**
 * 통근 매트릭스 캐시 리포지토리 (t_commute_matrix)
 *
 *  ▷ KNN 격자 확장 검색 (v1.2 — 2026-06-03: 3자리 격자로 확대)
 *    - 3자리 반올림 cacheKey(≈110m 버킷) 외에 ±0.001 인접 격자 8개도 같이 조회
 *    - 행정동마다 가장 가까운 워크포인트 캐시 선택
 *    - 한 번의 SQL 로 9개 키 IN 검색 → DB 부담 거의 같음
 *    - exactMatch 플래그로 같은 버킷(≈110m) / 인접 흡수 구분
 *
 *  효과 (3자리 기준)
 *    · 같은 빌딩~인접 블록 (≈100m 이내) → exact hit
 *    · 같은 동네 옆 회사 (≈100~330m) → nearby hit (호출 0)
 *    · ~330m 이상 떨어진 곳 → miss (신규 호출)
 */
import { prisma } from '../db';
import { haversineKm, makeCacheKeyCandidates } from '../external/odsay';

/**
 * 캐시 TTL (§8-3) — 통근 매트릭스 항목 유효기간(일).
 *  GTX·노선 개편이나 §8-2 이전에 새던 오염값이 영구 잔존하지 않도록, computedAt 이
 *  TTL 보다 오래된 행은 **조회에서 제외**(= miss 취급 → 재조회)하고, 재조회 시
 *  upsert 가 만료 행을 지우고 새로 써서 self-heal 한다. env COMMUTE_TTL_DAYS 로 조절.
 *  schema 주석의 "90일 후 만료" 정책을 실제 구현.
 */
const COMMUTE_TTL_DAYS = Number(process.env.COMMUTE_TTL_DAYS ?? '90');

/** TTL 컷오프 시각 — 이보다 오래된 computedAt 은 만료. (TTL≤0 이면 만료 비활성=무기한) */
function commuteTtlCutoff(): Date | null {
  if (!Number.isFinite(COMMUTE_TTL_DAYS) || COMMUTE_TTL_DAYS <= 0) return null;
  return new Date(Date.now() - COMMUTE_TTL_DAYS * 24 * 60 * 60 * 1000);
}

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
  const ttlCutoff = commuteTtlCutoff(); // §8-3: 만료 행은 조회 제외 → miss 취급

  const rows = await prisma.commuteMatrix.findMany({
    where: {
      cacheKey: { in: candidates },
      ...(dongCodes && dongCodes.length > 0
        ? { legalDongCode: { in: dongCodes } }
        : {}),
      ...(ttlCutoff ? { computedAt: { gte: ttlCutoff } } : {}),
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
 * 신규 매트릭스 항목 일괄 저장 (정확 일치 키 기준으로만 저장)
 *  - 격자 확장은 조회용 — 새 데이터는 항상 입력 좌표의 정확 cacheKey 로 저장
 *  - 같은 행정동에 대한 여러 워크포인트 캐시가 누적되어 KNN 정확도 ↑
 *
 *  ▷ 성능 (v1.2)
 *    - 기존: 행마다 await prisma.upsert → 미스 검색 1회당 DB 왕복 최대 ~1000번
 *    - 변경: createMany({ skipDuplicates }) 한 번 → DB 왕복 N→1
 *    - 미스 경로에서만 호출되므로 (cacheKey, legalDongCode) 행은 정의상 아직 없음.
 *      드물게 동시 요청으로 먼저 생긴 행은 skipDuplicates(=INSERT IGNORE)로 건너뜀.
 *
 *  ▷ TTL self-heal (§8-3)
 *    - createMany({ skipDuplicates }) 는 만료된 *기존* exact-key 행을 덮어쓰지 못한다
 *      (unique 충돌로 skip → stale 영구 잔존, TTL 조회제외로 매번 재호출만 반복).
 *    - 그래서 쓰기 전에 같은 cacheKey + 이 코드들의 **만료 행만 deleteMany** → 충돌 해소 후
 *      createMany 가 신선한 값으로 재적재. 미스 경로(이미 ODsay 호출)라 추가 쿼리 비용 무시 가능.
 */
export async function upsertCommuteEntries(
  cacheKey: string,
  entries: UpsertEntry[],
): Promise<number> {
  if (entries.length === 0) return 0;

  // 만료 행 정리(§8-3) — TTL 지난 exact-key 행을 지워 skipDuplicates 가 갱신을 막지 않게.
  const ttlCutoff = commuteTtlCutoff();
  if (ttlCutoff) {
    await prisma.commuteMatrix.deleteMany({
      where: {
        cacheKey,
        legalDongCode: { in: entries.map((e) => e.legalDongCode) },
        computedAt: { lt: ttlCutoff },
      },
    });
  }

  const result = await prisma.commuteMatrix.createMany({
    data: entries.map((e) => ({
      cacheKey,
      workLat: e.workLat,
      workLng: e.workLng,
      workLabel: e.workLabel ?? null,
      legalDongCode: e.legalDongCode,
      transitMinutes: e.transitMinutes,
      transitTransfers: e.transitTransfers,
      transitCostWon: e.transitCostWon,
      carMinutes: e.carMinutes,
    })),
    skipDuplicates: true,
  });
  return result.count;
}
