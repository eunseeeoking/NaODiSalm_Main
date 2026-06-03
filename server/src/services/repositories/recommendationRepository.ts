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
import {
  JEONSE_TO_MONTHLY_RATE,
  ALL_PROPERTY_TYPES,
  type RegionCandidate,
  type DealType,
  type PropertyType,
} from '../recommendation/scoring';

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
 * 매매 거래 테이블을 가진 매물종류 (SH=단독·다가구는 매매 거래 없음 — 전월세만).
 *  KI-2 대표 매매가 산출 시 SH 는 자동 제외.
 */
const SALE_TRADE_TYPES: readonly PropertyType[] = ['APT', 'OFFI', 'VILLA'];

/** 수도권 등 다중 시군구 prefix → `(sigungu_code LIKE '11%' OR ...)` 필터 (KI-19). */
function sigunguPrefixFilter(prefixes: readonly string[]): Prisma.Sql {
  return Prisma.join(
    prefixes.map((p) => Prisma.sql`sigungu_code LIKE ${p + '%'}`),
    ' OR ',
  );
}

/**
 * 매물종류 → complex 테이블 (sigungu_code, legal_dong, lat, lng) — 후보 universe 산출용 (KI-1).
 *  4종 단지 테이블을 동일 컬럼으로 노출해 UNION ALL 풀링 가능. prefixFilter 로 지역(수도권) 한정.
 */
function complexSource(type: PropertyType, prefixFilter: Prisma.Sql): Prisma.Sql {
  switch (type) {
    case 'APT':
      return Prisma.sql`SELECT sigungu_code, legal_dong, lat, lng FROM t_apt_complex WHERE lat IS NOT NULL AND lng IS NOT NULL AND (${prefixFilter})`;
    case 'OFFI':
      return Prisma.sql`SELECT sigungu_code, legal_dong, lat, lng FROM t_offi_complex WHERE lat IS NOT NULL AND lng IS NOT NULL AND (${prefixFilter})`;
    case 'VILLA':
      return Prisma.sql`SELECT sigungu_code, legal_dong, lat, lng FROM t_villa_complex WHERE lat IS NOT NULL AND lng IS NOT NULL AND (${prefixFilter})`;
    case 'SH':
      return Prisma.sql`SELECT sigungu_code, legal_dong, lat, lng FROM t_sh_complex WHERE lat IS NOT NULL AND lng IS NOT NULL AND (${prefixFilter})`;
  }
}

/**
 * 후보 동(sigungu_code, legal_dong) 튜플 IN 필터 — complex 스캔을 후보 동으로 한정(성능, KI-21 후속).
 *  실거래 집계가 전 수도권을 스캔하던 것을 후보 ~수백 동으로 좁혀 매 요청 비용을 수 배 절감.
 *  ⚠️ 호출부는 aggregates.length>0 을 보장해야 함(빈 배열이면 IN () 문법오류).
 */
function dongTupleFilter(aggregates: RegionAggregate[]): Prisma.Sql {
  const tuples = Prisma.join(
    aggregates.map((a) => Prisma.sql`(${a.sigunguCode}, ${a.dong})`),
    ', ',
  );
  return Prisma.sql`(c.sigungu_code, c.legal_dong) IN (${tuples})`;
}

/**
 * 매물종류 → trade×complex JOIN (대표 매매가 산출용, KI-2). SH 는 매매 거래 없음 → 호출 금지.
 *  dongFilter 로 후보 동만 스캔(성능).
 */
function tradeSource(type: PropertyType, dongFilter: Prisma.Sql): Prisma.Sql {
  // ⚠️ STRAIGHT_JOIN: complex(작음·sigungu_code+legal_dong 인덱스)를 driver 로 강제해 후보 동만 거른 뒤
  //  complex_id 인덱스로 trade 를 조인. 일반 JOIN 은 옵티마이저가 trade(수백만)를 먼저 풀스캔해 느림(KI-21 후속).
  switch (type) {
    case 'APT':
      return Prisma.sql`SELECT c.sigungu_code, c.legal_dong, t.price_manwon, t.deal_date, t.area_m2 FROM t_apt_complex c STRAIGHT_JOIN t_apt_trade t ON t.complex_id = c.id WHERE ${dongFilter}`;
    case 'OFFI':
      return Prisma.sql`SELECT c.sigungu_code, c.legal_dong, t.price_manwon, t.deal_date, t.area_m2 FROM t_offi_complex c STRAIGHT_JOIN t_offi_trade t ON t.complex_id = c.id WHERE ${dongFilter}`;
    case 'VILLA':
      return Prisma.sql`SELECT c.sigungu_code, c.legal_dong, t.price_manwon, t.deal_date, t.area_m2 FROM t_villa_complex c STRAIGHT_JOIN t_villa_trade t ON t.complex_id = c.id WHERE ${dongFilter}`;
    case 'SH':
      return Prisma.empty; // 매매 거래 테이블 없음 (호출부에서 SALE_TRADE_TYPES 로 사전 필터)
  }
}

/**
 * 1단계 — 후보 행정동의 메타 (centroid + 단지 수) 일괄 조회.
 *
 *  - 단지가 1개 미만인 행정동은 제외 (centroid 부정확 + 대표값 무의미)
 *  - sigunguCodePrefixes 로 지역 한정 (기본 수도권 11·28·41. KI-19: 서울 → 수도권 확장)
 *  - t_legal_dong 의 풀(10자리) 코드만 사용 (5자리 시군구 row 는 제외)
 *  - ⚠️ 매칭은 **시군구 코드(5자리) + 동명** 기반 (KI-19): 이전 sigungu **이름** 매칭은
 *    수도권 확장 시 인천 중구↔서울 중구 등 동명 시군구가 충돌 → 코드 prefix 로 교체.
 */
async function fetchRegionAggregates(
  propertyTypes: readonly PropertyType[],
  sigunguCodePrefixes: readonly string[] = ['11', '28', '41'],
): Promise<RegionAggregate[]> {
  const types = propertyTypes.length > 0 ? propertyTypes : ALL_PROPERTY_TYPES;

  // 행정동 마스터 (10자리) — 지역(수도권) prefix 로 한정
  const dongMaster = await prisma.legalDong.findMany({
    where: {
      OR: sigunguCodePrefixes.map((p) => ({ code: { startsWith: p } })),
      dong: { not: null },
    },
    select: { code: true, sigungu: true, dong: true },
  });
  const dongRows = dongMaster.filter((d) => d.code.length === 10 && d.dong);
  if (dongRows.length === 0) return [];

  // (시군구 5자리 코드 | 동명) → 마스터 row. 코드 기반이라 동명 시군구 충돌 없음(KI-19).
  const dongByCodeKey = new Map<string, (typeof dongRows)[number]>();
  for (const d of dongRows) {
    dongByCodeKey.set(`${d.code.slice(0, 5)}|${d.dong}`, d);
  }

  // 단지 집계 (sigungu_code + legal_dong) — 선택 매물종류 complex 테이블 UNION (KI-1)
  //  아파트 단지만 보던 것을 빌라·오피스텔·단독 단지까지 합집합 → 비아파트 밀집 동도 후보화.
  type ComplexGroup = {
    sigungu_code: string;
    legal_dong: string;
    centroid_lat: number;
    centroid_lng: number;
    complex_count: bigint;
  };
  const prefixFilter = sigunguPrefixFilter(sigunguCodePrefixes);
  const complexUnion = Prisma.join(
    types.map((t) => complexSource(t, prefixFilter)),
    ' UNION ALL ',
  );
  const groups = await prisma.$queryRaw<ComplexGroup[]>(Prisma.sql`
    SELECT
      sigungu_code,
      legal_dong,
      AVG(lat) AS centroid_lat,
      AVG(lng) AS centroid_lng,
      COUNT(*) AS complex_count
    FROM ( ${complexUnion} ) c
    GROUP BY sigungu_code, legal_dong
    HAVING COUNT(*) >= 1
  `);

  // 시군구 코드 + 동명 으로 마스터 매칭 (동명 시군구 충돌 차단)
  const aggregates: RegionAggregate[] = [];
  for (const g of groups) {
    const masterRow = dongByCodeKey.get(`${g.sigungu_code}|${g.legal_dong}`);
    if (!masterRow) continue; // 마스터에 없는 동은 제외

    aggregates.push({
      legalDongCode: masterRow.code,
      sigunguCode: g.sigungu_code,
      sigungu: masterRow.sigungu,
      dong: g.legal_dong,
      centroidLat: Number(g.centroid_lat),
      centroidLng: Number(g.centroid_lng),
      complexCount: Number(g.complex_count),
    });
  }

  return aggregates;
}

/**
 * 2단계 — 후보 행정동의 대표 매물가 (최근 1년, 전체 면적 매매 중위값)
 *
 *  ▷ KI-16 / KI-8 (2026-05-31): 면적 제한 제거 + median 통일.
 *    - 기존 `area_m2 BETWEEN 60 AND 85`(국민주택규모 밴드)는 ML 시대의 데이터
 *      모델링 기본값이지 제품 결정이 아님. 본 서비스는 "좋은 지역"을 추천하므로
 *      동 시세는 특정 평형이 아니라 시장 전체를 반영해야 함(§0 컨셉). 또한 KI-2 이후
 *      OFFI/VILLA 에도 60~85 가 적용돼 표본이 희박했음. → 전월세 경로와 동일하게
 *      `area_m2 BETWEEN 9 AND 330` sanity 만 적용(면적 0/누락·비현실 레코드 제거).
 *    - 전체 면적이면 원룸~대형이 섞여 분산이 커지므로 AVG → median 동반(KI-8).
 *      전월세 경로(fetchRentCostByRegion)와 동일한 윈도우 함수 중위값 규약.
 *  - 한 번의 쿼리로 모든 후보 행정동 medianPrice 가져오기 위해
 *    sigungu_code + legal_dong 조합을 IN 으로 묶음
 *  - 거래 자체가 없는 행정동은 결과에 미포함 → 호출처에서 0 또는 폴백 처리
 *
 *  ▷ cutoff 동적화 (2026-05-21 §12 패치):
 *    NOW() 기준 1년 이전으로 cutoff 두면 데이터 최신성이 떨어진 환경에서 0건 응답.
 *    → "최신 거래일 - 1년" 으로 정의해 ingest 주기와 자연스럽게 맞춤.
 *    거래가 0건이면 cutoff 가 null → 전체 거래로 fallback (안전망).
 */
// cutoff(최신 거래일 −1년) 캐시 — MAX(date) 가 인덱스 미사용 풀스캔이라 매 요청 반복하면 비쌈.
//  ingest 주기 대비 충분히 짧은 10분 TTL. 실패 시 null(전체 fallback).
const CUTOFF_TTL_MS = 10 * 60 * 1000;
const _cutoffCache = new Map<string, { value: Date | null; at: number }>();
async function cachedCutoff(key: string, compute: () => Promise<Date | null>): Promise<Date | null> {
  const hit = _cutoffCache.get(key);
  if (hit && Date.now() - hit.at < CUTOFF_TTL_MS) return hit.value;
  const value = await compute().catch(() => null);
  _cutoffCache.set(key, { value, at: Date.now() });
  return value;
}

async function fetchRepresentativePrices(
  aggregates: RegionAggregate[],
  propertyTypes: readonly PropertyType[],
): Promise<Map<string, number>> {
  if (aggregates.length === 0) return new Map();

  // 매매 거래 보유 종류만 (SH 제외) — KI-2
  const tradeTypes = propertyTypes.filter((t) => SALE_TRADE_TYPES.includes(t));
  if (tradeTypes.length === 0) return new Map();

  // 최신 거래일 조회 (apt 기준 — 가장 크고 최신인 데이터셋. cutoff 없으면 전체 fallback).
  //  ⚡ MAX(deal_date)는 인덱스 미사용 풀스캔이라 캐시(10분)로 매 요청 반복 제거(KI-21 후속).
  const cutoff = await cachedCutoff('apt_trade_deal', async () => {
    const latest = await prisma.aptTrade.aggregate({ _max: { dealDate: true } });
    if (!latest._max.dealDate) return null;
    const c = new Date(latest._max.dealDate);
    c.setFullYear(c.getFullYear() - 1);
    return c;
  });

  type PriceRow = { sigungu_code: string; legal_dong: string; median_price: number | null };

  // 선택 종류 trade×complex 풀링. 전체 면적(9~330 sanity) + 동별 median (KI-16/KI-8).
  //  후보 동 필터로 complex 스캔 한정(성능, KI-21 후속).
  const dongFilter = dongTupleFilter(aggregates);
  const tradeUnion = Prisma.join(
    tradeTypes.map((t) => tradeSource(t, dongFilter)),
    ' UNION ALL ',
  );
  // 중위값: 동별 price 정렬 후 가운데 1~2건 평균 (홀수=1건, 짝수=2건 평균). MySQL 8 윈도우 함수.
  //  전월세 경로(fetchRentCostByRegion)와 동일 규약. price_manwon > 0 만 집계.
  const rows = await prisma.$queryRaw<PriceRow[]>(Prisma.sql`
    WITH pooled AS (
      SELECT sigungu_code, legal_dong, price_manwon
      FROM ( ${tradeUnion} ) p
      WHERE p.area_m2 BETWEEN 9 AND 330
      ${cutoff ? Prisma.sql`AND p.deal_date >= ${cutoff}` : Prisma.empty}
    ),
    ranked AS (
      SELECT
        sigungu_code, legal_dong, price_manwon,
        ROW_NUMBER() OVER (PARTITION BY sigungu_code, legal_dong ORDER BY price_manwon) AS rn,
        COUNT(*)     OVER (PARTITION BY sigungu_code, legal_dong) AS cnt
      FROM pooled
      WHERE price_manwon > 0
    )
    SELECT
      sigungu_code,
      legal_dong,
      AVG(CASE WHEN rn IN (FLOOR((cnt + 1) / 2), FLOOR((cnt + 2) / 2)) THEN price_manwon END) AS median_price
    FROM ranked
    GROUP BY sigungu_code, legal_dong
  `).catch((e: unknown) => {
    console.warn('[recommendations] 대표 매매가 집계 실패:', e);
    return [] as PriceRow[];
  });

  const map = new Map<string, number>();
  for (const r of rows) {
    const median = Number(r.median_price ?? 0);
    if (median > 0) map.set(`${r.sigungu_code}|${r.legal_dong}`, Math.round(median));
  }
  return map;
}

/**
 * 동별 전월세 시세 통계 (2026-05-30 P2 재작성).
 *  - monthlyCost:   환산 월 주거비 중위값 (만원) — affordability RIR 분자
 *  - depositManwon: 보증금 중위값 (만원) — 예산(자본 상한) 필터용
 *  - sampleCount:   집계에 사용된 실거래 건수 — 신뢰도 표시용(향후 UI)
 */
export interface RentStat {
  monthlyCost: number;
  depositManwon: number;
  /** 순수 월세 중위값 (만원) — 월세 한도 필터용. 전세는 0. (2026-05-30 P3 후속) */
  monthlyRentManwon: number;
  sampleCount: number;
}

/** 매물종류별 실거래 전월세 소스 (rent 테이블 + complex 테이블 JOIN). dongFilter 로 후보 동만 스캔(성능). */
function rentSource(type: PropertyType, contractType: string, dongFilter: Prisma.Sql): Prisma.Sql {
  // ⚠️ STRAIGHT_JOIN: complex 를 driver 로 강제(후보 동만) → complex_id 인덱스로 rent 조인.
  //  일반 JOIN 은 rent(수백만, contract_type 인덱스 없음)를 먼저 풀스캔해 6.8s → STRAIGHT_JOIN 으로 수백 ms.
  switch (type) {
    case 'APT':
      return Prisma.sql`SELECT c.sigungu_code, c.legal_dong, r.deposit_manwon, r.monthly_manwon, r.contract_date, r.area_m2
        FROM t_apt_complex c STRAIGHT_JOIN t_apt_rent r ON r.complex_id = c.id WHERE ${dongFilter} AND r.contract_type = ${contractType}`;
    case 'OFFI':
      return Prisma.sql`SELECT c.sigungu_code, c.legal_dong, r.deposit_manwon, r.monthly_manwon, r.contract_date, r.area_m2
        FROM t_offi_complex c STRAIGHT_JOIN t_offi_rent r ON r.complex_id = c.id WHERE ${dongFilter} AND r.contract_type = ${contractType}`;
    case 'VILLA':
      return Prisma.sql`SELECT c.sigungu_code, c.legal_dong, r.deposit_manwon, r.monthly_manwon, r.contract_date, r.area_m2
        FROM t_villa_complex c STRAIGHT_JOIN t_villa_rent r ON r.complex_id = c.id WHERE ${dongFilter} AND r.contract_type = ${contractType}`;
    case 'SH':
      return Prisma.sql`SELECT c.sigungu_code, c.legal_dong, r.deposit_manwon, r.monthly_manwon, r.contract_date, r.area_m2
        FROM t_sh_complex c STRAIGHT_JOIN t_sh_rent r ON r.complex_id = c.id WHERE ${dongFilter} AND r.contract_type = ${contractType}`;
  }
}

/**
 * 2-B단계 (2026-05-30 P2) — 후보 행정동의 실거래 전월세 시세 통계.
 *
 *  ▷ 배경 / 개선:
 *    - (P1) 4종을 무조건 UNION ALL 평균 → 아파트와 빌라·반지하가 한 평균에 섞여 통계 오염.
 *    - (P2-#3) propertyTypes 로 사용자가 고른 종류만 풀링 → "찾는 매물" 기준 시세.
 *    - (P2-#4) AVG → 중위값(median). 옆집 월세 120 vs 반지하 30 같은 이상치 방어.
 *    - 평형 sanity 필터(area_m2 9~330)로 면적 0/누락·비현실 레코드 제거.
 *    - (KI-10) WOLSE 버킷에서 반전세(보증금 환산월 > 순수 월세) 제외 → 순수 월세 통계.
 *
 *  ▷ 산출(건별 → 동별 중위):
 *    - 건별 cost = 전세: deposit×RATE / 월세: monthly + deposit×RATE
 *    - 동별 median(cost) 와 median(deposit) 를 윈도우 함수로 한 쿼리에 계산.
 *    - 동별 표본 5건 미만 제외(HAVING) → 표본 부족 동은 자연스레 매매가 합성 폴백.
 *
 *  ▷ 매칭 키: `${sigungu_code}|${legal_dong}` — fetchRepresentativePrices 와 동일 규약.
 *  ▷ 안전망: 테이블 미생성/쿼리 실패/종류 미선택 시 빈 맵 → 폴백 (graceful).
 */
async function fetchRentCostByRegion(
  aggregates: RegionAggregate[],
  dealType: DealType,
  propertyTypes: readonly PropertyType[],
): Promise<Map<string, RentStat>> {
  const map = new Map<string, RentStat>();
  if (dealType === 'SALE' || aggregates.length === 0 || propertyTypes.length === 0) {
    return map;
  }

  const isJeonse = dealType === 'JEONSE';
  const contractType = isJeonse ? 'JEONSE' : 'WOLSE';
  const RATE = JEONSE_TO_MONTHLY_RATE;

  // 최신 계약일 - 1년 cutoff (fetchRepresentativePrices 와 동일 전략 + 캐시).
  //  ⚡ MAX(contract_date)는 인덱스 미사용 풀스캔(t_apt_rent 3.6M)이라 10분 캐시로 매 요청 반복 제거(KI-21 후속).
  const cutoff = await cachedCutoff('apt_rent_contract', async () => {
    const latest = await prisma.aptRent.aggregate({ _max: { contractDate: true } });
    if (!latest._max.contractDate) return null;
    const c = new Date(latest._max.contractDate);
    c.setFullYear(c.getFullYear() - 1);
    return c;
  });

  // 선택된 매물종류만 동적 UNION ALL — 후보 동 필터로 complex 스캔 한정(성능, KI-21 후속)
  const dongFilter = dongTupleFilter(aggregates);
  const unioned = Prisma.join(
    propertyTypes.map((t) => rentSource(t, contractType, dongFilter)),
    ' UNION ALL ',
  );

  // 건별 환산 월주거비 — 전세/월세 분기.
  //  ⚠️ RATE 는 상수(0.00375)이므로 **SQL 리터럴로 인라인**(Prisma.raw). 파라미터로 두면 embed 된
  //  costExpr 의 ? 가 다른 ?(contract_type×3·cutoff)와 바인딩 순서가 꼬여 런타임에 0행이 되던 버그 차단.
  const rateLit = String(RATE); // 숫자 상수 → 안전하게 인라인
  const costExpr =
    dealType === 'JEONSE'
      ? Prisma.raw(`p.deposit_manwon * ${rateLit}`)
      : Prisma.raw(`p.monthly_manwon + p.deposit_manwon * ${rateLit}`);

  // KI-10 (2026-05-31): 반전세(준전세) 분리. WOLSE 버킷에 보증금이 큰 반전세가 섞이면
  //  순수 월세 median(monthly)은 끌어내리고 deposit median 은 끌어올려 통계 왜곡.
  //  반전세 정의 = 보증금 환산월(deposit×RATE) > 순수 월세(monthly) → 사실상 전세에 가까움
  //  (≈보증금이 월세의 ~267배 초과, 한국부동산원 '준전세' 240배 기준에 근접하며 기존 RATE 재사용).
  //  → 순수 월세(keep) = monthly >= deposit×RATE. WOLSE 표본 전체에서 제외해 cost·deposit·monthly
  //    3종 median 모두 "진짜 월세" 시장을 반영. JEONSE 는 monthly=0 이라 미적용.
  const semiJeonseFilter =
    dealType === 'JEONSE'
      ? Prisma.empty
      : Prisma.raw(`AND p.monthly_manwon >= p.deposit_manwon * ${rateLit}`);

  type MedRow = {
    sigungu_code: string;
    legal_dong: string;
    median_cost: number | null;
    median_deposit: number | null;
    median_monthly: number | null;
    sample_count: bigint | number;
  };

  // 중위값: 동별 정렬 후 가운데 1~2건 평균 (홀수=1건, 짝수=2건 평균). MySQL 8 윈도우 함수.
  //  ⚡ 성능(KI-21 후속): JEONSE 는 cost = deposit×RATE(단조증가) → median(cost)=median(deposit)×RATE,
  //   monthly=0. 즉 **정렬 1개(deposit)만으로 충분**(median_cost 는 JS 에서 ×RATE 환산). 정렬 3→1 로 ~3배↓.
  //   MONTHLY 는 cost·deposit·monthly 가 독립이라 3개 유지(반전세 제외 필터 포함).
  const rentQuery = isJeonse
    ? Prisma.sql`
      WITH pooled AS (
        SELECT sigungu_code, legal_dong, deposit_manwon
        FROM ( ${unioned} ) p
        WHERE p.area_m2 BETWEEN 9 AND 330
        ${cutoff ? Prisma.sql`AND p.contract_date >= ${cutoff}` : Prisma.empty}
      ),
      ranked AS (
        SELECT sigungu_code, legal_dong, deposit_manwon,
          ROW_NUMBER() OVER (PARTITION BY sigungu_code, legal_dong ORDER BY deposit_manwon) AS rn_dep,
          COUNT(*)     OVER (PARTITION BY sigungu_code, legal_dong) AS cnt
        FROM pooled
        WHERE deposit_manwon > 0
      )
      SELECT
        sigungu_code,
        legal_dong,
        NULL AS median_cost,
        AVG(CASE WHEN rn_dep IN (FLOOR((cnt + 1) / 2), FLOOR((cnt + 2) / 2)) THEN deposit_manwon END) AS median_deposit,
        0 AS median_monthly,
        MAX(cnt) AS sample_count
      FROM ranked
      GROUP BY sigungu_code, legal_dong
      HAVING MAX(cnt) >= 5
    `
    : Prisma.sql`
      WITH pooled AS (
        SELECT sigungu_code, legal_dong, deposit_manwon, monthly_manwon, (${costExpr}) AS cost
        FROM ( ${unioned} ) p
        WHERE p.area_m2 BETWEEN 9 AND 330
        ${cutoff ? Prisma.sql`AND p.contract_date >= ${cutoff}` : Prisma.empty}
        ${semiJeonseFilter}
      ),
      ranked AS (
        SELECT
          sigungu_code, legal_dong, deposit_manwon, monthly_manwon, cost,
          ROW_NUMBER() OVER (PARTITION BY sigungu_code, legal_dong ORDER BY cost) AS rn_cost,
          ROW_NUMBER() OVER (PARTITION BY sigungu_code, legal_dong ORDER BY deposit_manwon) AS rn_dep,
          ROW_NUMBER() OVER (PARTITION BY sigungu_code, legal_dong ORDER BY monthly_manwon) AS rn_mon,
          COUNT(*)     OVER (PARTITION BY sigungu_code, legal_dong) AS cnt
        FROM pooled
        WHERE cost > 0
      )
      SELECT
        sigungu_code,
        legal_dong,
        AVG(CASE WHEN rn_cost IN (FLOOR((cnt + 1) / 2), FLOOR((cnt + 2) / 2)) THEN cost END)           AS median_cost,
        AVG(CASE WHEN rn_dep  IN (FLOOR((cnt + 1) / 2), FLOOR((cnt + 2) / 2)) THEN deposit_manwon END)  AS median_deposit,
        AVG(CASE WHEN rn_mon  IN (FLOOR((cnt + 1) / 2), FLOOR((cnt + 2) / 2)) THEN monthly_manwon END)  AS median_monthly,
        MAX(cnt) AS sample_count
      FROM ranked
      GROUP BY sigungu_code, legal_dong
      HAVING MAX(cnt) >= 5
    `;
  const rows = await prisma.$queryRaw<MedRow[]>(rentQuery).catch((e: unknown) => {
    console.warn('[recommendations] 전월세 집계 실패 → 매매가 합성 폴백:', e);
    return [] as MedRow[];
  });

  for (const r of rows) {
    const deposit = Math.round(Number(r.median_deposit ?? 0));
    // JEONSE 는 SQL 정렬 1개로 축소(median_cost=NULL) → JS 에서 cost = deposit×RATE 환산, monthly=0.
    const cost = isJeonse ? deposit * RATE : Number(r.median_cost ?? 0);
    const monthly = isJeonse ? 0 : Math.round(Number(r.median_monthly ?? 0));
    if (cost > 0) {
      map.set(`${r.sigungu_code}|${r.legal_dong}`, {
        monthlyCost: Math.round(cost * 100) / 100,
        depositManwon: deposit,
        monthlyRentManwon: monthly,
        sampleCount: Number(r.sample_count),
      });
    }
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
 *  @param options.budget        예산 (만원) — 거래유형별 자본 상한 하드필터 (2026-05-30 P2 #2).
 *                               SALE: 매매가 / JEONSE·MONTHLY: 보증금 중위값 > budget 인 동 제외.
 *                               생략 시 Infinity (필터 없음, 하위호환).
 *  @param options.propertyTypes 전월세 집계에 쓸 매물종류 (생략 시 전체 4종 — 하위호환).
 *  @param maxKm      직선 거리 상한 (기본: patience × 0.5 km, 안전 패딩 1.5×)
 *
 *  @returns candidates + budgetFilteredCount(예산 상한으로 제외된 후보 수 — "N개 숨김" 안내용).
 */
export async function fetchRegionCandidates(
  workplace: { lat: number; lng: number },
  patience: number,
  options: {
    /** 지역 한정 시군구 코드 prefix 목록. 미지정 시 수도권(11·28·41). KI-19. */
    sigunguCodePrefixes?: readonly string[];
    maxKm?: number;
    dealType?: DealType;
    budget?: number;
    /** 월세 한도 (만원/월) — MONTHLY 에서 순수 월세 중위값 상한. 보증금 한도와 별개(AND). */
    monthlyBudget?: number;
    propertyTypes?: readonly PropertyType[];
  } = {},
): Promise<{ candidates: RegionCandidate[]; budgetFilteredCount: number }> {
  const dealType: DealType = options.dealType ?? 'SALE';
  // 예산(자본) 상한 — 미지정 시 Infinity (필터 비활성, 하위호환)
  const budget = typeof options.budget === 'number' && options.budget > 0
    ? options.budget
    : Infinity;
  // 월세 한도 — MONTHLY 전용, 미지정 시 Infinity (필터 비활성)
  const monthlyBudget = typeof options.monthlyBudget === 'number' && options.monthlyBudget > 0
    ? options.monthlyBudget
    : Infinity;
  // 매물종류 — 미지정 시 전체 4종 (하위호환)
  const propertyTypes = options.propertyTypes ?? ALL_PROPERTY_TYPES;
  // 후보 universe·대표가 매물종류 (KI-1/2):
  //  · 전세/월세: 선택 종류 그대로(빌라·단독 포함) — 비아파트 밀집 동도 후보화
  //  · 매매:      매매 거래 보유 전 종류(APT/OFFI/VILLA) 고정 — UI 에서 매물종류 필터 비활성이라
  //              선택값에 끌려가지 않게 함
  const universeTypes = dealType === 'SALE' ? SALE_TRADE_TYPES : propertyTypes;
  const effectiveUniverse = universeTypes.length > 0 ? universeTypes : SALE_TRADE_TYPES;
  // 대표 매매가용 — 매매 거래 보유 종류만 (SH 제외)
  const priceTypes = (dealType === 'SALE' ? SALE_TRADE_TYPES : propertyTypes).filter((t) =>
    SALE_TRADE_TYPES.includes(t),
  );
  // 예산 상한으로 제외된 후보 수 (거리·통근 통과했으나 예산 초과)
  let budgetFilteredCount = 0;
  // 진단: REC_DEBUG=1 일 때 단계별 소요시간 출력 (성능 병목 추적, KI-21 후속)
  const REC_DEBUG = process.env.REC_DEBUG === '1';
  const timed = async <T>(label: string, p: Promise<T>): Promise<T> => {
    const t = Date.now();
    const r = await p;
    if (REC_DEBUG) console.log(`[perf] ${label}: ${Date.now() - t}ms`);
    return r;
  };
  // 1) 기본 메타 — 선택 매물종류 단지 universe
  const aggregates = await timed('aggregates', fetchRegionAggregates(effectiveUniverse, options.sigunguCodePrefixes));
  if (aggregates.length === 0) return { candidates: [], budgetFilteredCount };

  // 2) workplace 와 거리 계산 → 1차 필터 (직선 거리 상한)
  const safePatience = Math.max(15, patience);
  // 통근 게이트 배율 (KI-22): 인내심 × 1.2 초과 통근은 후보 제외.
  //   기존 ×2(=90분)는 너무 헐거워, 인내심 45분에 commuteMinutes 60~89분 지역이
  //   affordability/life 로 top8 에 새어 들어왔음(수도권 확장 KI-19 부작용).
  //   commute 는 demand-driven ODsay 전까지 Haversine 추정이라 ±0.2 버퍼만 허용.
  const PATIENCE_GATE_MULT = 1.2;
  // 직선 → 대중교통 환산 ≈ km × 2.4분/km. patience 분 = patience/2.4 km.
  // coarse 사전필터(시간 정밀 게이트는 아래 §4). 게이트 시간(patience×1.2)을 km 로 환산
  //   (×1.2/2.4 = ×0.5) 후, cached 통근이 Haversine 보다 빠를 수 있어 1.3× 패딩 → ×0.65.
  const maxKm = options.maxKm ?? safePatience * PATIENCE_GATE_MULT * 0.5 * 1.3;

  const withDistance = aggregates
    .map((a) => ({
      agg: a,
      distanceKm: haversineKm(workplace, { lat: a.centroidLat, lng: a.centroidLng }),
    }))
    .filter((x) => x.distanceKm <= maxKm);
  if (withDistance.length === 0) return { candidates: [], budgetFilteredCount };

  // 3) 가격 + 수익률 + (전월세 시) 실거래 월주거비 일괄 조회
  const targetAggs = withDistance.map((x) => x.agg);
  const [priceMap, returnMap, commuteMap, rentCostMap] = await Promise.all([
    timed('price', fetchRepresentativePrices(targetAggs, priceTypes)),
    timed('returns', fetchExpectedReturns(targetAggs)),
    timed(
      'commute',
      findCachedMatrix(workplace, targetAggs.map((a) => a.legalDongCode)) as Promise<
        Map<string, CommuteEntry>
      >,
    ),
    timed('rent', fetchRentCostByRegion(targetAggs, dealType, propertyTypes)),
  ]);
  if (REC_DEBUG) console.log(`[perf] candidates=${targetAggs.length}`);

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
    const rentStat = rentCostMap.get(priceKey);

    // 거래유형별 후보 게이트 + 예산 하드필터 (KI-3 / P2 #2 / P3 QA)
    //  · SALE:           매매 표본 필수. 매매가 대표값 > budget → 제외.
    //  · JEONSE/MONTHLY: 전월세 표본 필수(아파트 매매 유무 무관). 보증금/월세 상한 적용.
    //      (전월세 표본 없는 동은 유효 후보 아님 — 매매가 폴백 표시 방지.)
    if (dealType === 'SALE') {
      if (price == null) continue; // 매매 거래 데이터 없는 동 제외
      if (price > budget) { budgetFilteredCount++; continue; }
    } else {
      if (!rentStat) continue; // 전월세 표본 없는 동 제외 (budgetFilteredCount 비집계)
      if (rentStat.depositManwon > budget) { budgetFilteredCount++; continue; }
      if (dealType === 'MONTHLY' && rentStat.monthlyRentManwon > monthlyBudget) {
        budgetFilteredCount++;
        continue;
      }
    }

    // 전월세 모드에서 매매 표본 없으면 0 (카드 표시엔 rent basis 라 미사용)
    const repPrice = price ?? 0;
    const rawReturn = returnMap.get(priceKey) ?? 0;

    // 통근 — matrix 우선, 없으면 Haversine 추정
    const cached = commuteMap.get(agg.legalDongCode);
    const commuteMinutes = cached
      ? cached.transitMinutes
      : estimateTransitMinutesByKm(distanceKm);

    // patience × 1.2 초과 통근은 후보에서 강제 제외 (KI-22)
    if (commuteMinutes > safePatience * PATIENCE_GATE_MULT) continue;

    rawCandidates.push({ agg, commuteMinutes, price: repPrice, rawReturn });
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
  // 후보 동코드 IN 절 — Prisma.join 으로 리스트 확장 (2026-05-31 버그픽스: 기존 arr.join(',')
  //  는 $queryRaw 에서 CSV 전체가 단일 문자열 파라미터로 바인딩돼 항상 0건 매칭. LH 쿼리와
  //  동일하게 Prisma.join 사용. 빈 배열이면 IN () 문법오류 방지 위해 조회 자체를 건너뜀.)
  type TransitRow = { legal_dong_code: string; transit_score: number };
  const transitRows = candidateDongCodes.length
    ? await prisma.$queryRaw<TransitRow[]>`
        SELECT legal_dong_code, transit_score
        FROM t_transit_route_summary
        WHERE legal_dong_code IN (${Prisma.join(candidateDongCodes)})
      `.catch(() => [] as TransitRow[]) // 테이블 미생성 시 graceful fallback
    : [];
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
  const safetyRows = candidateDongCodes.length
    ? await prisma.$queryRaw<SafetyRow[]>`
        SELECT legal_dong_code, total_score
        FROM t_safety_index
        WHERE legal_dong_code IN (${Prisma.join(candidateDongCodes)})
      `.catch(() => [] as SafetyRow[]) // 테이블 미생성 시 graceful fallback
    : [];
  const safetyScoreMap = new Map<string, number>(
    safetyRows.map((r) => [r.legal_dong_code, Number(r.total_score)]),
  );

  // 5-E) 생활편의 POI 점수 (KI-4: t_poi_summary — seed:life 실행 후 활성, 미적재 시 50 fallback)
  //  prisma.poiSummary 는 prisma db push + generate 후 활성. 그 전까진 $queryRaw 직접 조회.
  type LifeRow = { legal_dong_code: string; life_score: number };
  const lifeRows = candidateDongCodes.length
    ? await prisma.$queryRaw<LifeRow[]>`
        SELECT legal_dong_code, life_score
        FROM t_poi_summary
        WHERE legal_dong_code IN (${Prisma.join(candidateDongCodes)})
      `.catch(() => [] as LifeRow[]) // 테이블 미생성 시 graceful fallback
    : [];
  const lifeScoreMap = new Map<string, number>(
    lifeRows.map((r) => [r.legal_dong_code, Number(r.life_score)]),
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
      // KI-4: t_poi_summary 실데이터(카카오 POI lifeScore). seed:life 미실행 시 50 fallback
      lifeScoreBase: lifeScoreMap.get(c.agg.legalDongCode) ?? 50,
      // P3 #5: 추정(더미) 여부 — 데이터 미적재(맵에 없음) 시 추정 → scoring 이 총점 분모에서
      //  제외해 변별력 회복. KI-4 로 생활도 POI 적재 시 실데이터화(더미 50 해제).
      safetyIsEstimated: !safetyScoreMap.has(c.agg.legalDongCode),
      lifeIsEstimated: !lifeScoreMap.has(c.agg.legalDongCode),
      // Day 2: TAGO t_transit_route_summary 미적재 시 null (commuteScore 보정 없음)
      transitScore: transitScoreMap.get(c.agg.legalDongCode) ?? null,
      // Day 2: LH 청년주택 근접 수 (미적재 시 0)
      lhComplexNearby: lhCountMap.get(c.agg.legalDongCode) ?? 0,
      // 행정동 내 단지 수 — 마커 호버 툴팁용 (RegionAggregate 에서 그대로 전달)
      complexCount: c.agg.complexCount,
      // 2026-05-30: 선택 거래유형(JEONSE/MONTHLY) 실거래 환산 월주거비 중위값.
      //  SALE 또는 표본 부족 시 null → scoring 이 매매가 합성으로 폴백.
      rentMonthlyCost: rentCostMap.get(`${c.agg.sigunguCode}|${c.agg.dong}`)?.monthlyCost ?? null,
      // P3 #6: 전월세 집계 표본수 — 카드 신뢰 칩용. SALE/표본없음 시 null.
      rentSampleCount: rentCostMap.get(`${c.agg.sigunguCode}|${c.agg.dong}`)?.sampleCount ?? null,
    };
  });

  return { candidates, budgetFilteredCount };
}
