/**
 * Depth 2 지역 추천 상태 스토어 (Zustand)
 *  - 사용자 입력 (workplace, budget, weights, patience, incomeQuintile, dealType)
 *  - 결과 (recommendations)
 *  - 인터랙션 (hoveredRegion — 카드↔지도 양방향 호버용)
 */
import { create } from 'zustand';
import type { BudgetFilteredBreakdown } from '../api/recommendations';
import {
  WEIGHT_PRESETS,
  DEFAULT_PROPERTY_TYPES,
  type Workplace,
  type Weights,
  type WeightPreset,
  type RegionRecommendation,
  type IncomeQuintile,
  type RecDealType,
  type RecPropertyType,
} from '../types/recommendation';

export type RecommendationSource = 'api' | 'mock';

interface RecommendationState {
  /** 직장 (좌표 + 라벨) */
  workplace: Workplace | null;
  /** 예산 (만원) — 기본 4억 */
  budget: number;
  /**
   * 월세 한도 (만원/월, 2026-05-30 P3 후속) — 거래유형 MONTHLY 에서만 사용.
   *  동의 순수 월세 중위값이 이 값을 넘으면 후보에서 제외(보증금 한도와 별개의 AND).
   */
  monthlyRentCap: number;
  /** 4축 가중치 — 합계 100 (UI 검증 책임) */
  weights: Weights;
  /** 통근 인내심 (편도 분) — 기본 45 */
  patience: number;
  /**
   * 거래유형 (2026-05-30) — affordability 산출 기준.
   *  - 기본 'JEONSE': 청년 전월세 의사결정 도구 컨셉에 맞춤.
   *  - 'SALE' 선택 시 기존 매매가 합성 점수로 회귀.
   */
  dealType: RecDealType;
  /**
   * 매물종류 (2026-05-30 P2) — 전월세 시세 집계 풀.
   *  - 다중 선택. 최소 1개 유지 (전부 해제 방지).
   *  - SALE 거래유형에서는 **['APT'] 로 자동 픽스**(매매=아파트 — Depth 3 단지 전망/매매 시세 정합).
   *    전월세로 복귀하면 직전 전월세 선택을 복원(`_rentPropertyTypes`).
   */
  propertyTypes: RecPropertyType[];
  /**
   * 매매 진입 시 보존해 둔 직전 전월세 매물종류 선택 (내부 상태).
   *  - SALE 로 전환할 때 현재 propertyTypes 를 여기 백업하고 propertyTypes 를 ['APT'] 로 픽스.
   *  - 전월세(JEONSE/MONTHLY)로 복귀할 때 이 값으로 propertyTypes 복원 → QA 토글 시 선택 유지.
   */
  _rentPropertyTypes: RecPropertyType[];
  /**
   * 소득 분위 (1~5, 통계청 2023 기준)
   *  - null: 미선택 → 서버 기본값(3분위 403만원) 사용
   *  - 선택 시: QUINTILE_INCOME_MAP[quintile] → incomeMonthly(만원) → 서버 전달
   */
  incomeQuintile: IncomeQuintile | null;
  /**
   * 월 소득 실제 입력값 (만원, 2026-05-30 P3 후속).
   *  - 직접 입력 시 분위로 반올림하지 않고 이 값을 그대로 서버 incomeMonthly 로 전송.
   *  - null: 미입력 → incomeQuintile(있으면) 또는 서버 기본(3분위 403) 사용.
   *  - 분위 칩 선택 시에는 null 로 두고 incomeQuintile 로 매핑 (URL 짧게 유지).
   */
  incomeManwon: number | null;
  /** 카드↔지도 양방향 호버용 — 현재 호버된 행정동 코드 */
  hoveredRegion: string | null;
  /** 추천 결과 (서버 응답 또는 mock) */
  recommendations: RegionRecommendation[];
  /**
   * 추천 top-8 ODsay 정밀 통근시간(분) — legalDongCode → transitMinutes.
   *  - Depth 2 에서 추천 8곳만 ODsay 호출(쿼터 절약) → 지도 폴리곤 색 + 카드 통근 표시에 사용.
   *  - 랭킹/총점은 서버 Haversine 그대로(일관성). 이 값은 "표시·색 정밀화"용.
   *  - 새 추천 수신 시 초기화({}) 후 재조회로 채움.
   */
  commuteOverrides: Record<string, number>;
  /**
   * 추천 결과의 출처
   *  - 'api'  실 서버 응답
   *  - 'mock' mock 폴백 (DEMO 뱃지 노출)
   *  - null   아직 요청 전 / workplace 미설정
   */
  dataSource: RecommendationSource | null;
  /** 예산 상한으로 제외된(숨겨진) 후보 수 — CardPanel "N개 숨김" 안내용 (2026-05-30 P3 후속) */
  budgetFilteredCount: number;
  /** 숨김 사유별 분리 (KI-12) — 보증금/월세/매매가 초과. mock/레거시면 null. */
  budgetFilteredBreakdown: BudgetFilteredBreakdown | null;
  /**
   * 추천 조회 진행 중 여부 (2026-05-30 P3 후속).
   *  - true: API 응답 대기 중 → 지도 핀 제거 + 카드 스켈레톤 + 지도 로딩 표시.
   *  - 이전 결과가 그대로 보여 "조회중인가?" 헷갈리는 문제 방지.
   */
  isLoading: boolean;

  // ─── 액션 ───────────────────────────────────────────────
  setWorkplace: (w: Workplace | null) => void;
  setBudget: (manwon: number) => void;
  /** 월세 한도(만원/월) 설정 — MONTHLY 거래유형에서만 효과 */
  setMonthlyRentCap: (manwon: number) => void;
  setWeight: (key: keyof Weights, value: number) => void;
  applyPreset: (preset: WeightPreset) => void;
  setPatience: (minutes: number) => void;
  /** 거래유형 변경 (매매/전세/월세) */
  setDealType: (dealType: RecDealType) => void;
  /** 매물종류 토글 (마지막 1개는 해제 불가 — 빈 배열 방지) */
  togglePropertyType: (type: RecPropertyType) => void;
  /** 매물종류 일괄 설정 (URL 하이드레이션용) */
  setPropertyTypes: (types: RecPropertyType[]) => void;
  /** 소득 분위 선택. null 전달 시 미선택(서버 3분위 기본값) 으로 초기화. */
  setIncomeQuintile: (q: IncomeQuintile | null) => void;
  /** 월 소득 실제 입력값(만원) 설정. null = 직접입력 해제. */
  setIncomeManwon: (manwon: number | null) => void;
  setHovered: (regionCode: string | null) => void;
  /** 추천 top-8 ODsay 정밀 통근시간 맵 설정 (지도·카드 공유) */
  setCommuteOverrides: (overrides: Record<string, number>) => void;
  /** 지도 핀 클릭 등으로 "고정 포커스"된 행정동(카드 스크롤·강조 트리거). hover 와 별개. */
  focusedRegion: string | null;
  /** focusedRegion 갱신 카운터 — 같은 핀 재클릭에도 카드 flash 재발화하게 */
  focusTick: number;
  /** 핀 클릭 등으로 카드 포커스(스크롤+강조). 같은 코드 재호출도 tick 증가로 재발화. */
  setFocused: (regionCode: string | null) => void;
  /** 추천 조회 진행 상태 설정 */
  setLoading: (loading: boolean) => void;
  setRecommendations: (
    recs: RegionRecommendation[],
    source?: RecommendationSource | null,
    meta?: {
      budgetFilteredCount: number;
      budgetFilteredBreakdown?: BudgetFilteredBreakdown;
    } | null,
  ) => void;
}

export const useRecommendationStore = create<RecommendationState>((set) => ({
  workplace: null,
  // 사회초년생 기본값 — 1.5억 (거래유형별 슬라이더 범위는 BUDGET_SLIDER 참조, 최대=무제한)
  budget: 15000,
  // 월세 한도 기본값 — 100만원/월 (1인가구 월세 중위 근방. 20~300 슬라이더)
  monthlyRentCap: 100,
  weights: { ...WEIGHT_PRESETS.worker },
  patience: 45,
  dealType: 'JEONSE',
  propertyTypes: [...DEFAULT_PROPERTY_TYPES],
  _rentPropertyTypes: [...DEFAULT_PROPERTY_TYPES],
  incomeQuintile: null,
  incomeManwon: null,
  hoveredRegion: null,
  focusedRegion: null,
  focusTick: 0,
  recommendations: [],
  commuteOverrides: {},
  dataSource: null,
  budgetFilteredCount: 0,
  budgetFilteredBreakdown: null,
  isLoading: false,

  setWorkplace: (w) => set({ workplace: w }),
  setBudget: (manwon) => set({ budget: manwon }),
  setMonthlyRentCap: (manwon) => set({ monthlyRentCap: manwon }),
  setWeight: (key, value) =>
    set((state) => ({ weights: { ...state.weights, [key]: value } })),
  applyPreset: (preset) => set({ weights: { ...WEIGHT_PRESETS[preset] } }),
  setPatience: (minutes) => set({ patience: minutes }),
  setDealType: (dealType) =>
    set((state) => {
      if (dealType === state.dealType) return { dealType };
      // 전월세 → 매매: 직전 전월세 선택 보존 + 아파트로 픽스 (매매=아파트).
      //  매매 추천 시세(representativePrice)·Depth 3 진입(단지 전망)이 모두 APT 기준이 되도록.
      if (dealType === 'SALE') {
        return { dealType, _rentPropertyTypes: state.propertyTypes, propertyTypes: ['APT'] };
      }
      // 매매 → 전월세: 보존했던 선택 복원.
      if (state.dealType === 'SALE') {
        return { dealType, propertyTypes: state._rentPropertyTypes };
      }
      // 전세 ↔ 월세: 매물종류 유지.
      return { dealType };
    }),
  togglePropertyType: (type) =>
    set((state) => {
      const has = state.propertyTypes.includes(type);
      // 해제 시: 마지막 1개면 무시(최소 1개 유지). 선택 시: 추가.
      if (has) {
        if (state.propertyTypes.length === 1) return state;
        return { propertyTypes: state.propertyTypes.filter((t) => t !== type) };
      }
      return { propertyTypes: [...state.propertyTypes, type] };
    }),
  setPropertyTypes: (types) =>
    set({ propertyTypes: types.length > 0 ? types : [...DEFAULT_PROPERTY_TYPES] }),
  setIncomeQuintile: (q) => set({ incomeQuintile: q }),
  setIncomeManwon: (manwon) => set({ incomeManwon: manwon }),
  setHovered: (regionCode) => set({ hoveredRegion: regionCode }),
  setCommuteOverrides: (overrides) => set({ commuteOverrides: overrides }),
  setFocused: (regionCode) =>
    set((state) => ({ focusedRegion: regionCode, focusTick: state.focusTick + 1 })),
  setLoading: (loading) => set({ isLoading: loading }),
  setRecommendations: (recs, source = null, meta = null) =>
    set({
      recommendations: recs,
      dataSource: source,
      budgetFilteredCount: meta?.budgetFilteredCount ?? 0,
      budgetFilteredBreakdown: meta?.budgetFilteredBreakdown ?? null,
      // 새 추천 → 이전 ODsay 통근 오버라이드 폐기(스테일 방지). MapPanel 이 top-8 재조회.
      commuteOverrides: {},
      // 결과가 들어오면 로딩 종료 (성공 경로)
      isLoading: false,
    }),
}));
