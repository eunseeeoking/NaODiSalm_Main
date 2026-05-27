/**
 * Depth 2 지역 추천 상태 스토어 (Zustand)
 *  - 사용자 입력 (workplace, budget, weights, patience, incomeQuintile)
 *  - 결과 (recommendations)
 *  - 인터랙션 (hoveredRegion — 카드↔지도 양방향 호버용)
 */
import { create } from 'zustand';
import {
  WEIGHT_PRESETS,
  type Workplace,
  type Weights,
  type WeightPreset,
  type RegionRecommendation,
  type IncomeQuintile,
} from '../types/recommendation';

export type RecommendationSource = 'api' | 'mock';

interface RecommendationState {
  /** 직장 (좌표 + 라벨) */
  workplace: Workplace | null;
  /** 예산 (만원) — 기본 4억 */
  budget: number;
  /** 4축 가중치 — 합계 100 (UI 검증 책임) */
  weights: Weights;
  /** 통근 인내심 (편도 분) — 기본 45 */
  patience: number;
  /**
   * 소득 분위 (1~5, 통계청 2023 기준)
   *  - null: 미선택 → 서버 기본값(3분위 403만원) 사용
   *  - 선택 시: QUINTILE_INCOME_MAP[quintile] → incomeMonthly(만원) → 서버 전달
   */
  incomeQuintile: IncomeQuintile | null;
  /** 카드↔지도 양방향 호버용 — 현재 호버된 행정동 코드 */
  hoveredRegion: string | null;
  /** 추천 결과 (서버 응답 또는 mock) */
  recommendations: RegionRecommendation[];
  /**
   * 추천 결과의 출처
   *  - 'api'  실 서버 응답
   *  - 'mock' mock 폴백 (DEMO 뱃지 노출)
   *  - null   아직 요청 전 / workplace 미설정
   */
  dataSource: RecommendationSource | null;

  // ─── 액션 ───────────────────────────────────────────────
  setWorkplace: (w: Workplace | null) => void;
  setBudget: (manwon: number) => void;
  setWeight: (key: keyof Weights, value: number) => void;
  applyPreset: (preset: WeightPreset) => void;
  setPatience: (minutes: number) => void;
  /** 소득 분위 선택. null 전달 시 미선택(서버 3분위 기본값) 으로 초기화. */
  setIncomeQuintile: (q: IncomeQuintile | null) => void;
  setHovered: (regionCode: string | null) => void;
  setRecommendations: (
    recs: RegionRecommendation[],
    source?: RecommendationSource | null,
  ) => void;
}

export const useRecommendationStore = create<RecommendationState>((set) => ({
  workplace: null,
  // 사회초년생 기본값 — 1.5억 (천만원 단위, 1000~150000 슬라이더 중간보다 낮은 위치)
  budget: 15000,
  weights: { ...WEIGHT_PRESETS.worker },
  patience: 45,
  incomeQuintile: null,
  hoveredRegion: null,
  recommendations: [],
  dataSource: null,

  setWorkplace: (w) => set({ workplace: w }),
  setBudget: (manwon) => set({ budget: manwon }),
  setWeight: (key, value) =>
    set((state) => ({ weights: { ...state.weights, [key]: value } })),
  applyPreset: (preset) => set({ weights: { ...WEIGHT_PRESETS[preset] } }),
  setPatience: (minutes) => set({ patience: minutes }),
  setIncomeQuintile: (q) => set({ incomeQuintile: q }),
  setHovered: (regionCode) => set({ hoveredRegion: regionCode }),
  setRecommendations: (recs, source = null) =>
    set({ recommendations: recs, dataSource: source }),
}));
