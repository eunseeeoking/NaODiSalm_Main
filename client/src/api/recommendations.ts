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
} from '../types/recommendation';
import { MOCK_REGIONS } from '../pages/Recommendation/data/mockRegions';

export interface RecommendationRequest {
  workplace: Workplace;
  budget: number;
  weights: Weights;
  patience: number;
  /** 소득 분위 선택 시 변환된 월 소득 (만원). 미선택 시 생략 → 서버 기본값(3분위 403만원) */
  incomeMonthly?: number;
}

export type RecommendationSource = 'api' | 'mock';

export interface RecommendationResult {
  regions: RegionRecommendation[];
  source: RecommendationSource;
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
    const regions = await apiFetch<RegionRecommendation[]>(
      '/api/recommendations',
      {
        method: 'POST',
        json: req,
        signal,
      },
    );
    // 서버가 빈 배열을 의도적으로 줄 수도 있으므로 길이 0 도 'api' 로 인정
    if (!Array.isArray(regions)) {
      throw new Error('Invalid response shape');
    }
    return { regions, source: 'api' };
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
