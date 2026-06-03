/**
 * 지역 추천 API 클라이언트 + mock fallback
 *
 *  ▷ 정책 (2026-05-21 의사결정):
 *    - 서버 미구현 또는 일시 장애 시 mock 으로 자동 폴백
 *    - 단, 에러를 "숨기지" 않는다 — console.warn + dataSource='mock' 로 화면에 명시
 *    - DEMO 뱃지 노출은 컴포넌트 책임 (이 함수는 source 만 알려줌)
 *
 *  ▷ 서버 계약 (청년 컨셉 전환 2026-05-22):
 *    POST /api/recommendations
 *    Body:
 *      { workplace: { lat, lng, label? },
 *        budget,
 *        weights: { commute, affordability, safety, life },
 *        patience }
 *    Response: RegionRecommendation[]
 *
 *  ▷ AbortSignal 지원 — 호출처가 빠르게 직장을 바꿔도 이전 요청 정리 가능
 */
import { apiFetch, ApiError } from './client';
import type {
  RegionRecommendation,
  Weights,
  Workplace,
  RecDealType,
  RecPropertyType,
} from '../types/recommendation';
import { MOCK_REGIONS } from '../pages/Recommendation/data/mockRegions';

export interface RecommendationRequest {
  workplace: Workplace;
  /** 예산(보증금/매매가, 만원). 슬라이더 '최대' 면 생략 → 예산 필터 없음(전체 매물). */
  budget?: number;
  /** 월세 한도 (만원/월, 선택) — MONTHLY 에서만 전송. '최대' 면 생략. 순수 월세 중위값 상한. */
  monthlyBudget?: number;
  weights: Weights;
  patience: number;
  /** 소득 분위 선택 시 변환된 월 소득 (만원). 미선택 시 생략 → 서버 기본값(3분위 403만원) */
  incomeMonthly?: number;
  /**
   * 거래유형 (2026-05-30). affordability 산출 기준.
   *  - 생략/SALE: 매매가 합성 (기존). JEONSE/MONTHLY: 실거래 전월세 시세 기반.
   */
  dealType?: RecDealType;
  /**
   * 매물종류 (2026-05-30 P2). 전월세 시세 집계 풀. 생략 시 서버 기본(전체 4종).
   *  선택 종류만 풀링해 동 시세 통계 오염 방지.
   */
  propertyTypes?: RecPropertyType[];
}

export type RecommendationSource = 'api' | 'mock';

/** 숨김 사유별 분리 카운트 (KI-12). 합 = budgetFilteredCount. */
export interface BudgetFilteredBreakdown {
  /** 보증금(전월세) > 예산 으로 제외 */
  deposit: number;
  /** 순수 월세 > 월세 한도 로 제외 (MONTHLY) */
  monthlyRent: number;
  /** 매매 대표가 > 예산 으로 제외 (SALE) */
  salePrice: number;
}

/** 응답 메타 (2026-05-30 P3 후속) */
export interface RecommendationMeta {
  /** 예산 상한으로 제외된(숨겨진) 후보 수 — "N개 숨김" 안내용 */
  budgetFilteredCount: number;
  /** 숨김 사유별 분리 (KI-12) — 레거시/mock 응답이면 undefined */
  budgetFilteredBreakdown?: BudgetFilteredBreakdown;
  /** 예산 필터 전 후보 수 */
  totalCandidates: number;
}

/** 서버 응답 형태 — 신규 { regions, meta } 또는 레거시/mock 배열 모두 수용 */
type RecommendationsResponse =
  | RegionRecommendation[]
  | { regions: RegionRecommendation[]; meta?: RecommendationMeta };

export interface RecommendationResult {
  regions: RegionRecommendation[];
  source: RecommendationSource;
  /** 예산 숨김 수 등 메타 (mock/레거시 응답이면 undefined) */
  meta?: RecommendationMeta;
  /** mock 폴백된 경우 사유 (UI 의 hover 툴팁 등에서 활용) */
  fallbackReason?: string;
}

/**
 * 추천 결과 fetch — 실패 시 mock 폴백.
 *  - 네트워크 404/500/CORS/abort 등 모든 실패를 catch
 *  - signal abort 는 폴백 없이 그대로 throw (호출처가 무시)
 */
export async function fetchRecommendations(
  req: RecommendationRequest,
  signal?: AbortSignal,
): Promise<RecommendationResult> {
  try {
    const raw = await apiFetch<RecommendationsResponse>(
      '/api/recommendations',
      {
        method: 'POST',
        json: req,
        signal,
      },
    );
    // 신규 { regions, meta } 와 레거시 배열 모두 수용
    const regions = Array.isArray(raw) ? raw : raw?.regions;
    const meta = Array.isArray(raw) ? undefined : raw?.meta;
    // 서버가 빈 배열을 의도적으로 줄 수도 있으므로 길이 0 도 'api' 로 인정
    if (!Array.isArray(regions)) {
      throw new Error('Invalid response shape');
    }
    return { regions, source: 'api', meta };
  } catch (err) {
    // AbortError 는 호출처에 그대로 위임
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw err;
    }
    const reason = describeError(err);
    // 에러를 숨기지 말 것 — 콘솔에 명시
    console.warn('[recommendations] API 실패 → mock 폴백:', reason);
    return {
      regions: MOCK_REGIONS,
      source: 'mock',
      fallbackReason: reason,
    };
  }
}

function describeError(err: unknown): string {
  if (err instanceof ApiError) return `HTTP ${err.status} ${err.message}`;
  if (err instanceof TypeError) return `네트워크 오류 (${err.message})`;
  if (err instanceof Error) return err.message;
  return String(err);
}
