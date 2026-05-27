/**
 * 지역 추천용 메트릭 집계 리포지토리
 *
 *  ▷ 책임:
 *    - workplace 좌표 + patience 기준 후보 행정동 추출 (직장 위치 기반 범위 설정)
 *    - 각 행정동의 centroid / 대표 매물가 / ML 예측 수익률 조회
 *    - commute matrix 가 있으면 transitMinutes 우선, 없으면 Haversine 추정 fallback
 *
 *  ▷ 데이터 의존:
 *    - t_apt_complex.lat/lng    행정동 centroid 계산 (단지 좌표 평균)
 *    - t_apt_trade              대표 가격 (최근 1년 중형 매물 중위 거래가)
 *    - t_training_result        3년 예상 수익률 (행정동 집계 row 또는 단지 row 평균)
 *    - t_commute_matrix         실 통근시간 (KNN 격자 흡수)
 *    - t_legal_dong             10자리 코드 ↔ (sigungu, dong) 매핑
 *
 *  ▷ 알려진 한계 (work-log 명시):
 *    - t_legal_dong 마스터 시드가 완전하지 않으면 legalDongCode 가 누락된 후보가 생김
 *      → 그 경우 임시 합성 ID `${sigunguCode}-${dongName}` 사용 (클라이언트는 string 만
 *        요구하므로 동작에 지장 없음, 단 t_commute_matrix join 은 불가)
 *    - t_training_result 가 없는 행정동은 expectedReturn3y=0 으로 처리 (점수 0점)
 *
 *  ▷ Day 1 추가 (2026-05-22):
 *    - batchAdjustReturns: t_reb_price_index 적재 후 자동으로 지수 보정 적용
 *    - 미적재(seed:reb 실행 전) 시 rawReturn3y 그대로 사용 (fallback, 기존 동작)
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { haversineKm } from '../external/odsay';
import { findCachedMatrix, type CommuteEntry } from './commuteRepository';
import { batchAdjustReturns } from '../recommendation/rebNormalize';
import type { RegionCandidate } from '../recommendation/scoring';

/** Haversine 거리 (km) → 대중교통 추정 시간 (분).
 *  - 평균 속도 25 km/h ≈ 0.42 km/min + 환승/대기 5분 패딩
 *  - work-log: 더 정확한 추정은 t_commute_matrix 가 채워질 때 자연스럽게 교체
 */
function estimateTransitMinutesByKm(km: number): number {
  return Math.round(km / 0.42 + 5);
}

interface RegionAggregate {
  legalDongCode: string;
  sigunguCode: string;
  sigungu: string;
  dong: string;
  centroidLat: number;
  centroidLng: number;
  complexCount: number;
}

/**
 * 1단계 — 후보 행정동의 메타 (centroid + 단지 수) 일괄 조회.
 *
 *  - 단지가 1개 미만인 행정동은 제외 (centroid 부정확 + 대표값 무의미)
 *  - sigunguCodePrefix 로 지역 한정 (예: '11' = 서울. 전국 확장 시 prefix 제거)
 *  - t_legal_dong 의 풀(10자리) 코드만 사용 (5자리 시군구 row 는 제외)
 */
async function fetchRegionAggregates(
  sigunguCodePrefix = '11',
): Promise<RegionAggregate[]> {
  // raw query — t_apt_complex (sigungu_code + legal_dong 이름) JOIN t_legal_dong (10자리 code)
  // 다음 조건 모두 충족:
  //  · t_apt_complex.lat/lng IS NOT NULL
  //  · t_legal_dong.code LENGTH = 10  (행정동 풀 코드)
  //  · t_legal_dong.sigungu 가 시군구 코드 prefix 와 매칭 — sigungu_code 도 같이 비교
  //
  // 주의: t_legal_dong 마스터에 sigungu_code 컬럼이 없으므로 (sigungu name 만)
  // sigungu name 매칭을 위해 자기 join 또는 별도 lookup 필요.
  // 단순화: sigungu_code prefix → name set 미리 lookup
  const sigunguNames = await prisma.legalDong.findMany({
    where: {
      code: { startsWith: sigunguCodePrefix },
    },
    select: { code: true, sigungu: true },
    distinct: ['sigungu'],
  });
  if (sigunguNames.length === 0) return [];
  const sigunguSet = new Set(sigunguNames.map((s) => s.sigungu));

  // 행정동 마스터: 10자리 + sigungu set 매칭
  const dongMaster = await prisma.legalDong.findMany({
    where: {
      sigungu: { in: Array.from(sigunguSet) },
      dong: { not: null },
    },
    select: { code: true, sigungu: true, dong: true },
  });
  if (dongMaster.length === 0) return [];

  // 10자리 코드만 살림 (5자리는 시군구 마스터 row)
  const dongRows = dongMaster.filter((d) => d.code.length === 10 && d.dong);
  if (dongRows.length === 0) return [];

  // 단지 집계 — sigungu name 으로 매칭하려면 sigungu_code 가 필요
  // t_apt_complex.sigungu_code 가 sigungu name 과 1:N 일 수 있으므로
  // sigungu_code → sigungu name 매핑 캐시 사용
  const sigunguCodeToName = new Map<string, string>();
  for (const s of sigunguNames) {
    // s.code 는 시군구(5자리) 또는 10자리 모두 포함됨 — 앞 5자리만 키로
    const five = s.code.slice(0, 5);
    if (!sigunguCodeToName.has(five)) sigunguCodeToName.set(five, s.sigungu);
  }

  // 단지 집계 (sigungu_code + legal_dong)
  type ComplexGroup = {
    sigungu_code: string;
    legal_dong: string;
    centroid_lat: number;
    centroid_lng: number;
    complex_count: bigint;
  };
  const groups = await prisma.$queryRaw<ComplexGroup[]>`
    SELECT
      sigungu_code,
      legal_dong,
      AVG(lat) AS centroid_lat,
      AVG(lng) AS centroid_lng,
      COUNT(*) AS complex_count
    FROM t_apt_complex
    WHERE lat IS NOT NULL
      AND lng IS NOT NULL
      AND sigungu_code LIKE ${sigunguCodePrefix + '%'}
    GROUP BY sigungu_code, legal_dong
    HAVING COUNT(*) >= 1
  `;

  // (sigungu_code + legal_dong이름) → t_legal_dong.code 매핑
  // sigungu_code → sigungu name → dong rows
  const aggregates: RegionAggregate[] = [];
  for (const g of groups) {
    const sigunguName = sigunguCodeToName.get(g.sigungu_code);
    if (!sigunguName) continue;
    const masterRow = dongRows.find(
      (d) => d.sigungu === sigunguName && d.dong === g.legal_dong,
    );
    if (!masterRow) continue; // 마스터에 없는 동은 일단 제외 (work-log 명시)

    aggregates.push({
      legalDongCode: masterRow.code,
      sigunguCode: g.sigungu_code,
      sigungu: sigunguName,
      dong: g.legal_dong,
      centroidLat: Number(g.centroid_lat),
      centroidLng: Number(g.centroid_lng),
      complexCount: Number(g.complex_count),
    });
  }

  return aggregates;
}

/**
 * 2단계 — 후보 행정동의 대표 매물가 (최근 1년, 중형 60~85m² 매매 평균)
 *  - 한 번의 쿼리로 모든 후보 행정동 medianPrice 가져오기 위해
 *    sigungu_code + legal_dong 조합을 IN 으로 묶음
 *  - 거래 자체가 없는 행정동은 결과에 미포함 → 호출처에서 0 또는 폴백 처리
 *
 *  ▷ cutoff 동적화 (2026-05-21 §12 패치):
 *    NOW() 기준 1년 이전으로 cutoff 두면 데이터 최신성이 떨어진 환경에서 0건 응답.
 *    → "최신 거래일 - 1년" 으로 정의해 ingest 주기와 자연스럽게 맞춤.
 *    거래가 0건이면 cutoff 가 null → 전체 거래로 fallback (안전망).
 */
async function fetchRepresentativePrices(
  aggregates: RegionAggregate[],
): Promise<Map<string, number>> {
  if (aggregates.length === 0) return new Map();

  // 최신 거래일 조회 (1쿼리, 비용 매우 낮음)
  const latest = await prisma.aptTrade.aggregate({
    _max: { dealDate: true },
  });
  let cutoff: Date | null = null;
  if (latest._max.dealDate) {
    cutoff = new Date(latest._max.dealDate);
    cutoff.setFullYear(cutoff.getFullYear() - 1);
  }

  // MySQL 중위값 트릭: window 함수가 없는 5.x 호환 위해 단지/거래 join 후 평균 사용
  // 정확한 median 보다는 mean 으로 단순화 (Sprint D 에서 percentile 함수로 교체 가능)
  type PriceRow = {
    sigungu_code: string;
    legal_dong: string;
    avg_price: number;
  };
  const rows = cutoff
    ? await prisma.$queryRaw<PriceRow[]>`
        SELECT
          ac.sigungu_code,
          ac.legal_dong,
          AVG(at.price_manwon) AS avg_price
        FROM t_apt_trade at
        INNER JOIN t_apt_complex ac ON ac.id = at.complex_id
        WHERE at.deal_date >= ${cutoff}
          AND at.area_m2 BETWEEN 60 AND 85
        GROUP BY ac.sigungu_code, ac.legal_dong
      `
    : await prisma.$queryRaw<PriceRow[]>`
        SELECT
          ac.sigungu_code,
          ac.legal_dong,
          AVG(at.price_manwon) AS avg_price
        FROM t_apt_trade at
        INNER JOIN t_apt_complex ac ON ac.id = at.complex_id
        WHERE at.area_m2 BETWEEN 60 AND 85
        GROUP BY ac.sigungu_code, ac.legal_dong
      `;

  const map = new Map<string, number>();
  for (const r of rows) {
    map.set(`${r.sigungu_code}|${r.legal_dong}`, Math.round(Number(r.avg_price)));
  }
  return map;
}

/**
 * 3단계 — 후보 행정동의 3년 누적 수익률 (t_training_result)
 *  - 행정동 집계 row (complex_id=NULL) 우선
 *  - 없으면 단지 row 들 (complex_id NOT NULL) 의 평균
 *  - 둘 다 없으면 0
 */
async function fetchExpectedReturns(
  aggregates: RegionAggregate[],
): Promise<Map<string, number>> {
  if (aggregates.length === 0) return new Map();

  // 모든 후보 sigungu name (raw query 의 WHERE IN 안에 dong name 도 필요)
  const sigunguDongs = aggregates.map((a) => ({
    sigungu_code: a.sigunguCode,
    legal_dong: a.dong,
  }));
  if (sigunguDongs.length === 0) return new Map();

  type ReturnRow = {
    sigungu_code: string;
    legal_dong: string;
    avg_return: number | null;
  };
  // 한 번에 가져온 뒤 in-memory grouping
  const rows = await prisma.$queryRaw<ReturnRow[]>`
    SELECT
      sigungu_code,
      legal_dong,
      AVG(expected_return_3y) AS avg_return
    FROM t_training_result
    WHERE expected_return_3y IS NOT NULL
    GROUP BY sigungu_code, legal_dong
  `;

  const map = new Map<string, number>();
  for (const r of rows) {
    if (r.avg_return == null) continue;
    map.set(`${r.sigungu_code}|${r.legal_dong}`, Number(r.avg_return));
  }
  return map;
}

/**
 * 진입점 — 추천용 후보 행정동 산출.
 *
 *  @param workplace  직장 좌표 (lat/lng)
 *  @param patience   편도 통근 인내심 (분) — 후보 범위 산정에 사용
 *  @param budget     예산 (만원) — 현재 단계에선 사용 안 함 (Sprint D 에서 filter 추가)
 *  @param maxKm      직선 거리 상한 (기본: patience × 0.5 km, 안전 패딩 1.5×)
 */
export async function fetchRegionCandidates(
  workplace: { lat: number; lng: number },
  patience: number,
  options: { sigunguCodePrefix?: string; maxKm?: number } = {},
): Promise<RegionCandidate[]> {
  // 1) 기본 메타
  const aggregates = await fetchRegionAggregates(options.sigunguCodePrefix);
  if (aggregates.length === 0) return [];

  // 2) workplace 와 거리 계산 → 1차 필터 (직선 거리 상한)
  const safePatience = Math.max(15, patience);
  // 직선 → 대중교통 환산 ≈ km × 2.4분/km. patience 분 = patience/2.4 km.
  // 안전 패딩 1.5× → patience × 0.5 × 1.5 ≈ patience × 0.75 km
  const maxKm = options.maxKm ?? safePatience * 0.5 * 1.5;

  const withDistance = aggregates
    .map((a) => ({
      agg: a,
      distanceKm: haversineKm(workplace, { lat: a.centroidLat, lng: a.centroidLng }),
    }))
    .filter((x) => x.distanceKm <= maxKm);
  if (withDistance.length === 0) return [];

  // 3) 가격 + 수익률 일괄 조회
  const targetAggs = withDistance.map((x) => x.agg);
  const [priceMap, returnMap, commuteMap] = await Promise.all([
    fetchRepresentativePrices(targetAggs),
    fetchExpectedReturns(targetAggs),
    findCachedMatrix(
      workplace,
      targetAggs.map((a) => a.legalDongCode),
    ) as Promise<Map<string, CommuteEntry>>,
  ]);

  // 4) 합치기 — RegionCandidate 배열 (1차: 통근 필터)
  /** 3년 수익률 baseYm = 현재 기준 36개월 전 */
  const now = new Date();
  const baseDate = new Date(now.getFullYear() - 3, now.getMonth(), 1);
  const baseYm = `${baseDate.getFullYear()}-${String(baseDate.getMonth() + 1).padStart(2, '0')}`;

  const rawCandidates: Array<{
    agg: (typeof withDistance)[number]['agg'];
    commuteMinutes: number;
    price: number;
    rawReturn: number;
  }> = [];

  for (const { agg, distanceKm } of withDistance) {
    const priceKey = `${agg.sigunguCode}|${agg.dong}`;
    const price = priceMap.get(priceKey);
    if (price == null) continue; // 거래 데이터 없는 동은 추천 후보에서 제외

    const rawReturn = returnMap.get(priceKey) ?? 0;

    // 통근 — matrix 우선, 없으면 Haversine 추정
    const cached = commuteMap.get(agg.legalDongCode);
    const commuteMinutes = cached
      ? cached.transitMinutes
      : estimateTransitMinutesByKm(distanceKm);

    // patience × 2 초과 통근은 후보에서 강제 제외
    if (commuteMinutes > safePatience * 2) continue;

    rawCandidates.push({ agg, commuteMinutes, price, rawReturn });
  }

  // 5) R-ONE 지수 보정 (Day 1: t_reb_price_index 적재 후 자동 활성, 미적재 시 raw 그대로)
  const adjustItems = rawCandidates.map((c) => ({
    sigunguCode: c.agg.sigunguCode,
    rawReturn3y: c.rawReturn,
    baseYm,
  }));
  const adjustedReturnMap = await batchAdjustReturns(adjustItems);

  // 5-B) TAGO 대중교통 품질 (Day 2: t_transit_route_summary 적재 후 활성, 미적재 시 null)
  //  prisma.transitRouteSummary 는 prisma db push + generate 후 활성
  //  그 전까지는 $queryRaw 로 직접 조회 (테이블 없으면 빈 배열 반환)
  const candidateDongCodes = rawCandidates.map((c) => c.agg.legalDongCode);
  type TransitRow = { legal_dong_code: string; transit_score: number };
  const transitRows = await prisma.$queryRaw<TransitRow[]>`
    SELECT legal_dong_code, transit_score
    FROM t_transit_route_summary
    WHERE legal_dong_code IN (${candidateDongCodes.join(',') || "'__none__'"})
  `.catch(() => [] as TransitRow[]); // 테이블 미생성 시 graceful fallback
  const transitScoreMap = new Map<string, number>(
    transitRows.map((r) => [r.legal_dong_code, r.transit_score]),
  );

  // 5-C) LH 청년주택 근접 수 (Phase 2-B 보강, 2026-05-27)
  //   행정동 정확 일치(DONG) 우선, 0이면 시군구 prefix 폴백(SIGUNGU).
  //   - lhYouthHousing.legal_dong_code 는 모두 10자리 (지오코딩 완료)
  //   - 단지 49건은 14개 동에만 몰려 있어서, 폴백 없으면 나머지 동에서 항상 0
  //   - 시군구 prefix 폴백: LEFT(legal_dong_code,5)=sigungu → 같은 시군구 내 모든 단지
  //   - 중복 방지: 행정동 매칭이 있으면 시군구 폴백 사용 안 함
  const candidateSigunguSet = new Set(candidateDongCodes.map((c) => c.slice(0, 5)));
  const candidateSigungus = Array.from(candidateSigunguSet);
  type LhCountRow = { legal_dong_code: string; cnt: bigint };
  type LhSigunguCountRow = { sigungu: string; cnt: bigint };

  // (a) 10자리 행정동 정확 일치
  const lhDongRows = candidateDongCodes.length
    ? await prisma.$queryRaw<LhCountRow[]>`
        SELECT legal_dong_code, COUNT(*) AS cnt
        FROM t_lh_youth_housing
        WHERE legal_dong_code IN (${Prisma.join(candidateDongCodes)})
        GROUP BY legal_dong_code
      `.catch(() => [] as LhCountRow[])
    : [];
  const lhDongCount = new Map<string, number>(
    lhDongRows.map((r) => [r.legal_dong_code, Number(r.cnt)]),
  );

  // (b) 시군구 5자리 prefix 폴백 — LEFT(legal_dong_code, 5) 로 시군구 묶음
  const lhSigunguRows = candidateSigungus.length
    ? await prisma.$queryRaw<LhSigunguCountRow[]>`
        SELECT LEFT(legal_dong_code, 5) AS sigungu, COUNT(*) AS cnt
        FROM t_lh_youth_housing
        WHERE LEFT(legal_dong_code, 5) IN (${Prisma.join(candidateSigungus)})
        GROUP BY LEFT(legal_dong_code, 5)
      `.catch(() => [] as LhSigunguCountRow[])
    : [];
  const lhSigunguCount = new Map<string, number>(
    lhSigunguRows.map((r) => [r.sigungu, Number(r.cnt)]),
  );

  // 행정동 우선, 없으면 시군구 폴백 — 중복 카운트 회피
  const lhCountMap = new Map<string, number>(
    candidateDongCodes.map((dong) => {
      const dongCnt = lhDongCount.get(dong) ?? 0;
      if (dongCnt > 0) return [dong, dongCnt];
      return [dong, lhSigunguCount.get(dong.slice(0, 5)) ?? 0];
    }),
  );

  // 5-D) 안전 지표 (Day 3: t_safety_index — seed:safety 실행 후 활성, 미적재 시 50 fallback)
  type SafetyRow = { legal_dong_code: string; total_score: number };
  const safetyRows = await prisma.$queryRaw<SafetyRow[]>`
    SELECT legal_dong_code, total_score
    FROM t_safety_index
    WHERE legal_dong_code IN (${candidateDongCodes.join(',') || "'__none__'"})
  `.catch(() => [] as SafetyRow[]); // 테이블 미생성 시 graceful fallback
  const safetyScoreMap = new Map<string, number>(
    safetyRows.map((r) => [r.legal_dong_code, Number(r.total_score)]),
  );

  // 6) 최종 RegionCandidate 조립
  const candidates: RegionCandidate[] = rawCandidates.map((c) => {
    const adjusted = adjustedReturnMap.get(c.agg.sigunguCode) ?? c.rawReturn;
    return {
      legalDongCode: c.agg.legalDongCode,
      displayName: `${c.agg.sigungu} ${c.agg.dong}`,
      sigunguCode: c.agg.sigunguCode,
      sigungu: c.agg.sigungu,
      dong: c.agg.dong,
      lat: c.agg.centroidLat,
      lng: c.agg.centroidLng,
      commuteMinutes: c.commuteMinutes,
      representativePrice: c.price,
      expectedReturn3y: Math.round(adjusted * 10) / 10,
      // Day 3: t_safety_index 실데이터 사용. seed:safety 미실행 시 50 fallback
      safetyBase: safetyScoreMap.get(c.agg.legalDongCode) ?? 50,
      // Sprint D 까지 더미 50점 — POI 카운트 도착 시 교체
      lifeScoreBase: 50,
      // Day 2: TAGO t_transit_route_summary 미적재 시 null (commuteScore 보정 없음)
      transitScore: transitScoreMap.get(c.agg.legalDongCode) ?? null,
      // Day 2: LH 청년주택 근접 수 (미적재 시 0)
      lhComplexNearby: lhCountMap.get(c.agg.legalDongCode) ?? 0,
      // 행정동 내 단지 수 — 마커 호버 툴팁용 (RegionAggregate 에서 그대로 전달)
      complexCount: c.agg.complexCount,
    };
  });

  return candidates;
}
