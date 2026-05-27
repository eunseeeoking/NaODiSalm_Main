/**
 * 지역 상세 API
 *
 *  GET /api/regions/:legalDongCode/complexes
 *    Params: legalDongCode — 10자리 법정동 코드 (예: "1168010600")
 *    Response: AptComplexDto[]  (클라이언트 AptComplex 타입과 1:1)
 *
 *  동작:
 *    1) t_legal_dong 으로 legalDongCode → (sigunguCode 5자리, dongName) 매핑
 *    2) t_apt_complex WHERE sigungu_code = sigunguCode AND legal_dong = dongName
 *    3) 각 단지별 최근 1년 거래 평균가 (t_apt_trade) 집계
 *    4) 행정동 단위 LSTM 예측 (t_training_result) 매핑
 *    5) AptComplexDto 형태로 응답
 *
 *  설계 메모:
 *    - t_apt_complex 에 세대수(households) 컬럼 없음 → 응답에서 0 표시
 *    - sizeBucket / ageBucket 은 최근 거래 중위 면적 / 단지 준공년도 기반 파생
 *    - legalDongCode.slice(0,5) = MOLIT sigungu_code (BJD 코드 앞 5자리와 일치)
 */
import { Router, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../../services/db';

export const regionsRouter = Router();

// ─── 파생 헬퍼 ────────────────────────────────────────────────

type SizeBucket = '소형' | '중형' | '중대형' | '대형';
type AgeBucket = '신축' | '준신축' | '중간' | '구축';

function toSizeBucket(areaM2: number): SizeBucket {
  if (areaM2 < 60) return '소형';
  if (areaM2 < 85) return '중형';
  if (areaM2 < 135) return '중대형';
  return '대형';
}

function toAgeBucket(builtYear: number | null): AgeBucket {
  if (!builtYear) return '구축';
  if (builtYear >= 2018) return '신축';
  if (builtYear >= 2008) return '준신축';
  if (builtYear >= 1998) return '중간';
  return '구축';
}

// ─── 응답 타입 ────────────────────────────────────────────────

/**
 * Phase 0+1 + 1.5 (2026-05-27)
 *  · 단지 카드는 APT/SALE 만 흐름. VILLA/OFFICETEL/JEONSE 는 Phase 3 까지 비활성.
 *  · LH 는 단지 디테일 부재로 단지 리스트에서 분리 — /lh-summary 가 시군구 집계로 노출.
 */
type PropertyKind = 'APT' | 'VILLA' | 'OFFICETEL';
type DealType = 'SALE' | 'JEONSE' | 'MONTHLY';

interface AptComplexDto {
  complexId: string;
  name: string;
  legalDongCode: string;
  propertyKind: PropertyKind;
  dealType: DealType;
  lat: number;
  lng: number;
  exclusiveArea: number;
  sizeBucket: SizeBucket;
  ageBucket: AgeBucket;
  builtYear: number;
  households: number;
  recentPrice: number;
  pricePerM2: number;
  predictedPricePerM2_3y: number;
  confidence: number;
}

// ─── 라우터 ───────────────────────────────────────────────────

regionsRouter.get(
  '/:legalDongCode/complexes',
  async (req: Request, res: Response) => {
    const { legalDongCode } = req.params;

    // 기본 입력 검증 (10자리 숫자, 서울 11로 시작)
    if (!/^\d{10}$/.test(legalDongCode)) {
      return res.status(400).json({ error: 'legalDongCode must be a 10-digit numeric string' });
    }

    // 1) t_legal_dong 에서 동 이름 조회
    const dongRow = await prisma.legalDong.findFirst({
      where: { code: legalDongCode, dong: { not: null } },
      select: { sigungu: true, dong: true },
    });
    if (!dongRow || !dongRow.dong) {
      return res.status(404).json({ error: 'Legal dong not found', legalDongCode });
    }

    // legalDongCode 앞 5자리 = MOLIT sigungu_code
    // (BJD 코드 체계와 MOLIT LAWD_CD 는 강남구=11680 처럼 일치)
    const sigunguCode = legalDongCode.slice(0, 5);
    const dongName = dongRow.dong;

    // BJD 이름에서 숫자+가 suffix 제거 — MOLIT 이 "당산동" 으로 저장한 경우 대비
    // 예: "당산동6가" → "당산동", "양평동3가" → "양평동", "대치동" → "대치동" (변경 없음)
    const baseDongName = dongName.replace(/\d+가$/, '').trim();
    const needsFallback = baseDongName !== dongName; // suffix 가 있었던 경우에만 폴백 시도

    // 2) 단지 목록
    //    lat/lng 필터 제거 — 지오코딩 미완료 단지도 카드 목록에 노출
    //    (지오코딩 완료 단지는 지도 핀 표시, 미완료는 핀 생략)
    //
    //    이름 매핑 전략:
    //      1차: BJD 이름 exact match (예: "당산동6가")
    //      2차: suffix 제거 후 startsWith (예: "당산동") — MOLIT 이 단순명 쓰는 경우
    let complexes = await prisma.aptComplex.findMany({
      where: {
        sigunguCode,
        legalDong: dongName,
      },
      select: {
        id: true,
        name: true,
        builtYear: true,
        lat: true,
        lng: true,
      },
      orderBy: [
        // 지오코딩 완료 단지 먼저 (지도 핀 있는 것 우선)
        { lat: { sort: 'asc', nulls: 'last' } },
        { builtYear: 'desc' },
      ],
      take: 20,
    });

    // 2차 폴백: BJD suffix 제거 후 startsWith 재조회
    // (MOLIT 이 "당산동6가" 대신 "당산동" 으로 저장한 경우에도 데이터 반환)
    if (complexes.length === 0 && needsFallback) {
      complexes = await prisma.aptComplex.findMany({
        where: {
          sigunguCode,
          legalDong: { startsWith: baseDongName },
        },
        select: {
          id: true,
          name: true,
          builtYear: true,
          lat: true,
          lng: true,
        },
        orderBy: [
          { lat: { sort: 'asc', nulls: 'last' } },
          { builtYear: 'desc' },
        ],
        take: 20,
      });
    }

    if (complexes.length === 0) {
      return res.json([]); // 데이터 없음 — 클라이언트가 mock fallback
    }

    const complexIds = complexes.map((c) => c.id);

    // 3) 거래 cutoff 기준 (최신 거래일 - 1년)
    const latestTrade = await prisma.aptTrade.aggregate({ _max: { dealDate: true } });
    let cutoff: Date | null = null;
    if (latestTrade._max.dealDate) {
      cutoff = new Date(latestTrade._max.dealDate);
      cutoff.setFullYear(cutoff.getFullYear() - 1);
    }

    // 4) 단지별 최근 거래 집계 (평균 거래가 + 평균 면적)
    //    Prisma.join() 사용 — 배열을 개별 파라미터로 바인딩 (IN절 안전 처리)
    type TradeAgg = { complex_id: number; avg_price: number; avg_area: number; cnt: bigint };
    const idList = Prisma.join(complexIds);
    const tradeAggs = cutoff
      ? await prisma.$queryRaw<TradeAgg[]>`
          SELECT
            complex_id,
            AVG(price_manwon) AS avg_price,
            AVG(area_m2) AS avg_area,
            COUNT(*) AS cnt
          FROM t_apt_trade
          WHERE complex_id IN (${idList})
            AND deal_date >= ${cutoff}
          GROUP BY complex_id
        `
      : await prisma.$queryRaw<TradeAgg[]>`
          SELECT
            complex_id,
            AVG(price_manwon) AS avg_price,
            AVG(area_m2) AS avg_area,
            COUNT(*) AS cnt
          FROM t_apt_trade
          WHERE complex_id IN (${idList})
          GROUP BY complex_id
        `;
    const tradeMap = new Map(
      tradeAggs.map((r) => [
        Number(r.complex_id),
        { avgPrice: Math.round(Number(r.avg_price)), avgArea: Number(r.avg_area) },
      ]),
    );

    // 5) 행정동 단위 LSTM 예측 (base_date 최신 row 우선)
    //    t_training_result 도 MOLIT 기준 dong name 저장 → exact 실패 시 baseDongName 폴백
    let trainingResult = await prisma.trainingResult.findFirst({
      where: { sigunguCode, legalDong: dongName },
      orderBy: { baseDate: 'desc' },
      select: {
        currentPricePerM2: true,
        predicted3yPricePerM2: true,
        confidence: true,
      },
    });

    if (!trainingResult && needsFallback) {
      trainingResult = await prisma.trainingResult.findFirst({
        where: { sigunguCode, legalDong: { startsWith: baseDongName } },
        orderBy: { baseDate: 'desc' },
        select: {
          currentPricePerM2: true,
          predicted3yPricePerM2: true,
          confidence: true,
        },
      });
    }

    // 6) 결과 조합
    const result: AptComplexDto[] = [];
    for (const c of complexes) {
      const trade = tradeMap.get(c.id);
      if (!trade) continue; // 거래 없는 단지 제외

      const avgArea = Math.round(trade.avgArea * 10) / 10;
      const pricePerM2 =
        avgArea > 0 ? Math.round(trade.avgPrice / avgArea) : 0;

      // 예측 m²단가: 학습결과에서 scale 추정
      let predictedPricePerM2_3y = pricePerM2;
      let confidence = 70;
      if (trainingResult) {
        const growthRatio =
          trainingResult.currentPricePerM2 > 0
            ? (trainingResult.predicted3yPricePerM2 ?? trainingResult.currentPricePerM2) /
              trainingResult.currentPricePerM2
            : 1;
        predictedPricePerM2_3y = Math.round(pricePerM2 * growthRatio);
        confidence = Math.round((trainingResult.confidence ?? 0.7) * 100);
      }

      result.push({
        complexId: String(c.id),
        name: c.name,
        legalDongCode,
        propertyKind: 'APT',
        dealType: 'SALE',
        lat: c.lat ?? 0,
        lng: c.lng ?? 0,
        exclusiveArea: avgArea,
        sizeBucket: toSizeBucket(avgArea),
        ageBucket: toAgeBucket(c.builtYear),
        builtYear: c.builtYear ?? 0,
        households: 0, // t_apt_complex 에 households 없음
        recentPrice: trade.avgPrice,
        pricePerM2,
        predictedPricePerM2_3y,
        confidence,
      });
    }

    // ※ LH 청년주택은 단지 단위 디테일(이름·좌표·세대수)이 없으므로
    //   Depth 3 단지 카드 리스트에는 포함하지 않음.
    //   대신 별도 엔드포인트 GET /:legalDongCode/lh-summary 에서 시군구 집계로 노출.

    return res.json(result);
  },
);

/**
 *  GET /api/regions/:legalDongCode/lh-summary
 *
 *  ▷ 목적
 *    Depth 3 (지역 상세) 상단 배너용 — "이 시군구에 LH 청년주택 N호 공급 중" 안내.
 *
 *  ▷ 데이터 소스
 *    t_lh_youth_housing — lhLeaseInfo1 적재본. legal_dong_code 는 시군구 5자리.
 *
 *  ▷ 응답
 *    {
 *      sigunguCode: "11680",
 *      totalRows: 12,
 *      totalUnits: 458,
 *      programs: [
 *        { programType: "행복주택", rows: 5, units: 320, monthlyRentMin: 8, monthlyRentMax: 22 },
 *        { programType: "청년매입임대", rows: 4, units: 88,  monthlyRentMin: null, monthlyRentMax: null },
 *        ...
 *      ]
 *    }
 *
 *  ▷ Phase 1.5: 데이터 미적재 시 totalRows=0 응답 (404 아님 → 클라이언트가 배너 숨김 처리)
 */
interface LhProgramSummary {
  programType: string;
  rows: number;
  units: number;
  monthlyRentMin: number | null;
  monthlyRentMax: number | null;
}

/** 정밀도 — Phase 2-B(2026-05-27):
 *   DONG       : 행정동 10자리 정확 일치 (지오코딩 성공한 row 만 집계)
 *   SIGUNGU    : 시군구 5자리 폴백 (지오코딩 없거나 실패한 row)
 *   INSUFFICIENT: 양쪽 모두 0건 → 배너 숨김
 */
export type LhSummaryScope = 'DONG' | 'SIGUNGU' | 'INSUFFICIENT';

interface LhSummaryDto {
  sigunguCode: string;
  legalDongCode: string;
  /** 표시에 사용할 우선 scope. 행정동 단위에 1건 이상이면 'DONG', 아니면 'SIGUNGU', 둘 다 0이면 'INSUFFICIENT' */
  scope: LhSummaryScope;
  totalRows: number;
  totalUnits: number;
  programs: LhProgramSummary[];
  /** 참고용 — 시군구 단위 통계 (행정동 모드에서도 같이 노출해서 UI 가 비교 가능) */
  sigunguTotalRows: number;
  sigunguTotalUnits: number;
}

type LhRow = {
  programType: string;
  unitsAvailable: number;
  monthlyRentMin: number | null;
  monthlyRentMax: number | null;
};

function aggregate(rows: LhRow[]): { programs: LhProgramSummary[]; totalUnits: number } {
  const byProgram = new Map<string, LhProgramSummary>();
  for (const r of rows) {
    const cur = byProgram.get(r.programType) ?? {
      programType: r.programType,
      rows: 0,
      units: 0,
      monthlyRentMin: null as number | null,
      monthlyRentMax: null as number | null,
    };
    cur.rows += 1;
    cur.units += r.unitsAvailable ?? 0;
    if (r.monthlyRentMin != null) {
      cur.monthlyRentMin =
        cur.monthlyRentMin == null ? r.monthlyRentMin : Math.min(cur.monthlyRentMin, r.monthlyRentMin);
    }
    if (r.monthlyRentMax != null) {
      cur.monthlyRentMax =
        cur.monthlyRentMax == null ? r.monthlyRentMax : Math.max(cur.monthlyRentMax, r.monthlyRentMax);
    }
    byProgram.set(r.programType, cur);
  }
  const programs = Array.from(byProgram.values()).sort((a, b) => b.units - a.units);
  const totalUnits = programs.reduce((s, p) => s + p.units, 0);
  return { programs, totalUnits };
}

regionsRouter.get(
  '/:legalDongCode/lh-summary',
  async (req: Request, res: Response) => {
    const { legalDongCode } = req.params;
    if (!/^\d{10}$/.test(legalDongCode)) {
      return res.status(400).json({ error: 'legalDongCode must be a 10-digit numeric string' });
    }
    const sigunguCode = legalDongCode.slice(0, 5);

    const emptyDto: LhSummaryDto = {
      sigunguCode,
      legalDongCode,
      scope: 'INSUFFICIENT',
      totalRows: 0,
      totalUnits: 0,
      programs: [],
      sigunguTotalRows: 0,
      sigunguTotalUnits: 0,
    };

    try {
      // (a) 행정동 10자리 정확 일치 (지오코딩 성공 row)
      const dongRows = await prisma.lhYouthHousing.findMany({
        where: { legalDongCode },
        select: {
          programType: true,
          unitsAvailable: true,
          monthlyRentMin: true,
          monthlyRentMax: true,
        },
      });

      // (b) 시군구 prefix 폴백 (Phase 2-B 보강: 같은 시군구 내 행정동 row 모두 포함)
      //   기존: legalDongCode == sigunguCode (5자리 정확 일치) — 지오코딩 결과는 10자리라 항상 0
      //   현재: legalDongCode startsWith sigunguCode — 같은 시군구의 행정동 10자리 row 도 매칭
      //   → 14개 행정동만 행정동(DONG) 모드로 노출되던 한계 해소.
      //     같은 시군구의 다른 동에 들어와도 "[시군구]에 N호" 폴백 표시 가능.
      const sigunguRows = await prisma.lhYouthHousing.findMany({
        where: { legalDongCode: { startsWith: sigunguCode } },
        select: {
          programType: true,
          unitsAvailable: true,
          monthlyRentMin: true,
          monthlyRentMax: true,
        },
      });

      const dongAgg = aggregate(dongRows);
      const sigunguAgg = aggregate(sigunguRows);

      // 우선 scope 결정 — 행정동에 1건 이상 있으면 DONG, 아니면 SIGUNGU
      let scope: LhSummaryScope;
      let primaryRows = 0;
      let primaryUnits = 0;
      let primaryPrograms: LhProgramSummary[] = [];

      if (dongRows.length > 0) {
        scope = 'DONG';
        primaryRows = dongRows.length;
        primaryUnits = dongAgg.totalUnits;
        primaryPrograms = dongAgg.programs;
      } else if (sigunguRows.length > 0) {
        scope = 'SIGUNGU';
        primaryRows = sigunguRows.length;
        primaryUnits = sigunguAgg.totalUnits;
        primaryPrograms = sigunguAgg.programs;
      } else {
        return res.json(emptyDto);
      }

      const dto: LhSummaryDto = {
        sigunguCode,
        legalDongCode,
        scope,
        totalRows: primaryRows,
        totalUnits: primaryUnits,
        programs: primaryPrograms,
        sigunguTotalRows: sigunguRows.length,
        sigunguTotalUnits: sigunguAgg.totalUnits,
      };
      return res.json(dto);
    } catch (e) {
      console.warn('[regions/lh-summary] skipped:', e instanceof Error ? e.message : e);
      return res.json(emptyDto);
    }
  },
);
