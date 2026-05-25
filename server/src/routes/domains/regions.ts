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

interface AptComplexDto {
  complexId: string;
  name: string;
  legalDongCode: string;
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
  /** LH 청년주택 여부 — 단지명 키워드 기반 추정 또는 DB 조인으로 확인 */
  isLhComplex: boolean;
}

/**
 * 단지명 키워드로 LH/공공임대 여부 추정
 *  - DB에 complex_id ↔ lh_id 조인 없는 경우 fallback
 */
const LH_NAME_KEYWORDS = ['행복주택', '임대', 'LH', '보금자리', '국민임대', '청년임대', '매입임대', '전세임대'];
function isLhByName(name: string): boolean {
  return LH_NAME_KEYWORDS.some((kw) => name.includes(kw));
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
        lat: c.lat ?? 0,
        lng: c.lng ?? 0,
        exclusiveArea: avgArea,
        sizeBucket: toSizeBucket(avgArea),
        ageBucket: toAgeBucket(c.builtYear),
        builtYear: c.builtYear ?? 0,
        households: 0, // t_apt_complex
        recentPrice: trade.avgPrice,
        pricePerM2,
        predictedPricePerM2_3y,
        confidence,
        isLhComplex: isLhByName(c.name),
      });
    }

    return res.json(result);
  },
);
