/**
 * 지역 추천 API
 *
 *  POST /api/recommendations
 *    Body:
 *      {
 *        workplace:      { lat: number, lng: number, label?: string },
 *        budget:         number,   // 만원
 *        weights:        { commute, affordability, safety, life },  // 합 ~100 (청년 컨셉)
 *        patience:       number,   // 편도 분
 *        incomeMonthly?: number    // 월 소득 (만원, 선택). 미입력 시 통계청 3분위 403만원.
 *      }
 *    Response: { regions: RegionRecommendation[], meta: { budgetFilteredCount, budgetFilteredBreakdown, totalCandidates } }
 *              (regions 는 클라이언트 타입과 1:1. 클라이언트는 레거시 배열 응답도 수용)
 *
 *  동작:
 *    1) 입력 검증 (한국 영역 좌표 + 양수 가중치 + patience 5~120)
 *    2) repository.fetchRegionCandidates — workplace 좌표 기반 후보 행정동
 *    3) scoring.pickTopRegions — 4축 단순 선형 정규화 + 가중합 → TOP 8
 *    4) RegionRecommendation 형태로 응답 (클라이언트 fetchRecommendations 와 1:1)
 *
 *  성능 가정:
 *    - 첫 응답 ~100ms (DB 3쿼리 + in-memory 가공)
 *    - commute matrix 가 없는 경우 Haversine 추정으로 즉시 응답
 *    - 별도 백그라운드 fetch (/api/commute/matrix) 는 클라이언트가 따로 호출
 */
import { Router, Request, Response } from 'express';
import { fetchRegionCandidates } from '../../services/repositories/recommendationRepository';
import {
  pickTopRegions,
  ALL_PROPERTY_TYPES,
  type Weights as ScoringWeights,
  type DealType,
  type PropertyType,
} from '../../services/recommendation/scoring';

export const recommendationsRouter = Router();

const DEAL_TYPES: readonly DealType[] = ['SALE', 'JEONSE', 'MONTHLY'];
const PROPERTY_TYPES: readonly PropertyType[] = ALL_PROPERTY_TYPES;

interface RecommendationsRequestBody {
  workplace: { lat: number; lng: number; label?: string };
  /** 예산(보증금/매매가, 만원, 선택). 생략 시 예산 필터 없음(전체 매물). */
  budget?: number;
  /** 월세 한도 (만원/월, 선택) — MONTHLY 에서 순수 월세 상한 필터. */
  monthlyBudget?: number;
  weights: ScoringWeights;
  patience: number;
  /** 월 소득 (만원, 선택). 미입력 시 통계청 3분위 기본값(403만원) 사용. */
  incomeMonthly?: number;
  /**
   * 거래유형 (선택). affordability 산출 기준.
   *  - 생략 시 SALE (하위호환). JEONSE/MONTHLY 면 실거래 전월세 시세 기반.
   */
  dealType?: DealType;
  /**
   * 매물종류 (선택, 다중). 전월세 시세 집계에 쓸 실거래 풀.
   *  - 생략 시 전체 4종(APT/OFFI/VILLA/SH) — 하위호환.
   *  - 선택 종류만 풀링해 동 시세 통계 오염 방지 (2026-05-30 P2 #3).
   */
  propertyTypes?: PropertyType[];
}

/** 한국 영역 대략 검증 — workplace 가 한반도 밖이면 즉시 거부 */
function isKoreaCoord(lat: number, lng: number): boolean {
  return lat >= 33 && lat <= 39 && lng >= 124 && lng <= 132;
}

function validateBody(body: Partial<RecommendationsRequestBody>): string | null {
  if (!body.workplace) return 'workplace required';
  const { lat, lng } = body.workplace;
  if (typeof lat !== 'number' || typeof lng !== 'number') {
    return 'workplace.{lat,lng} (number) required';
  }
  if (!isKoreaCoord(lat, lng)) {
    return 'workplace must be inside Korea (lat 33~39, lng 124~132)';
  }
  // budget 은 선택 — 생략 시 예산 필터 없음(슬라이더 '최대' = 전체 매물). 있으면 양수.
  if (body.budget !== undefined && (typeof body.budget !== 'number' || body.budget <= 0)) {
    return 'budget must be a positive number in 만원';
  }
  if (
    body.monthlyBudget !== undefined &&
    (typeof body.monthlyBudget !== 'number' || body.monthlyBudget <= 0)
  ) {
    return 'monthlyBudget must be a positive number in 만원';
  }
  if (typeof body.patience !== 'number' || body.patience < 5 || body.patience > 120) {
    return 'patience (5~120 minutes) required';
  }
  const w = body.weights;
  if (
    !w ||
    typeof w.commute !== 'number' ||
    typeof w.affordability !== 'number' ||
    typeof w.safety !== 'number' ||
    typeof w.life !== 'number'
  ) {
    return 'weights {commute, affordability, safety, life} (numbers) required';
  }
  if (w.commute < 0 || w.affordability < 0 || w.safety < 0 || w.life < 0) {
    return 'weights must be non-negative';
  }
  const sum = w.commute + w.affordability + w.safety + w.life;
  if (sum < 90 || sum > 110) {
    return 'weights sum must be 90~110';
  }
  if (body.dealType !== undefined && !DEAL_TYPES.includes(body.dealType)) {
    return 'dealType must be one of SALE | JEONSE | MONTHLY';
  }
  if (body.propertyTypes !== undefined) {
    if (
      !Array.isArray(body.propertyTypes) ||
      body.propertyTypes.some((t) => !PROPERTY_TYPES.includes(t))
    ) {
      return 'propertyTypes must be an array of APT | OFFI | VILLA | SH';
    }
  }
  return null;
}

recommendationsRouter.post('/', async (req: Request, res: Response) => {
  const started = Date.now();
  const body = req.body as Partial<RecommendationsRequestBody>;

  const err = validateBody(body);
  if (err) return res.status(400).json({ error: err });

  // (validateBody 통과 → 모든 필드 존재 보장)
  const { workplace, budget, monthlyBudget, weights, patience, incomeMonthly, dealType, propertyTypes } =
    body as RecommendationsRequestBody;

  // 소득 유효성 검증 — 양수 숫자만 허용, 비합리적 값 방어
  const income =
    typeof incomeMonthly === 'number' && incomeMonthly > 0 && incomeMonthly < 100000
      ? incomeMonthly
      : undefined; // scoring.ts DEFAULT_MONTHLY_INCOME_MANWON(403) 사용

  try {
    const { candidates, budgetFilteredCount, budgetFilteredBreakdown } =
      await fetchRegionCandidates(workplace, patience, {
        dealType,
        budget,
        monthlyBudget,
        propertyTypes,
      });

    // 후보 자체가 0건 — 데이터 부족, 직장 위치가 서울 밖, 또는 예산으로 전부 제외
    if (candidates.length === 0) {
      return res.json({
        regions: [],
        meta: { budgetFilteredCount, budgetFilteredBreakdown, totalCandidates: 0 },
      });
    }

    const top = pickTopRegions(candidates, weights, patience, 8, income);

    // 클라이언트 RegionRecommendation 형태로 응답
    // (safetyBase, lifeScoreBase 같은 내부 필드는 자동 제외하기 위해 명시적 mapping)
    const response = top.map((r) => ({
      legalDongCode: r.legalDongCode,
      displayName: r.displayName,
      sigunguCode: r.sigunguCode,
      sigungu: r.sigungu,
      dong: r.dong,
      lat: r.lat,
      lng: r.lng,
      totalScore: r.totalScore,
      commuteScore: r.commuteScore,
      affordabilityScore: r.affordabilityScore,
      safetyScore: r.safetyScore,
      lifeScore: r.lifeScore,
      commuteMinutes: r.commuteMinutes,
      representativePrice: r.representativePrice,
      expectedReturn3y: r.expectedReturn3y,
      // Day 2 추가
      transitScore: r.transitScore,
      lhComplexNearby: r.lhComplexNearby,
      // Day 3 추가
      rir: r.rir,
      // 행정동 내 단지 수 (마커 호버 툴팁용)
      complexCount: r.complexCount,
      // 2026-05-30: affordability 산출 근거 (실거래 전월세 vs 매매가 합성)
      monthlyHousingCost: r.monthlyHousingCost,
      affordabilityBasis: r.affordabilityBasis,
      rentMonthlyCost: r.rentMonthlyCost,
      // P3 #6: 전월세 집계 표본수 (신뢰 칩용)
      rentSampleCount: r.rentSampleCount,
      // KI-9: 카드 분리 표기용 — 보증금 / 순수 월세 중위값
      rentDepositManwon: r.rentDepositManwon,
      rentPureMonthlyManwon: r.rentPureMonthlyManwon,
      // P3 #5: 총점 분모에서 제외된 추정 축 (점수 변별력 + 투명성)
      estimatedAxes: r.estimatedAxes,
    }));

    res.set('X-Elapsed-Ms', String(Date.now() - started));
    // 2026-05-30 P3 후속: 응답을 { regions, meta } 로 래핑.
    //  meta.budgetFilteredCount = 예산 상한으로 제외된(숨겨진) 후보 수 → "N개 숨김" 안내.
    res.json({
      regions: response,
      meta: { budgetFilteredCount, totalCandidates: candidates.length },
    });
  } catch (e) {
    console.error('[recommendations] error:', e);
    res.status(500).json({
      error: 'internal error',
      message: e instanceof Error ? e.message : String(e),
    });
  }
});
