/**
 * Depth 2 지역 추천 상태 스토어 (Zustand)
 *  - 사용자 입력 (workplace, budget, weights, patience)
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
} from '../types/recommendation';

interface RecommendationState {
  /** 직장 (좌표 + 라벨) */
  workplace: Workplace | null;
  /** 예산 (만원) — 기본 4억 */
  budget: number;
  /** 4축 가중치 — 합계 100 (UI 검증 책임) */
  weights: Weights;
  /** 통근 인내심 (편도 분) — 기본 45 */
  patience: number;
  /** 카드↔지도 양방향 호버용 — 현재 호버된 행정동 코드 */
  hoveredRegion: string | null;
  /** 추천 결과 (서버 응답 또는 mock) */
  recommendations: RegionRecommendation[];

  // ─── 액션 ───────────────────────────────────────────────
  setWorkplace: (w: Workplace | null) => void;
  setBudget: (manwon: number) => void;
  setWeight: (key: keyof Weights, value: number) => void;
  applyPreset: (preset: WeightPreset) => void;
  setPatience: (minutes: number) => void;
  setHovered: (regionCode: string | null) => void;
  setRecommendations: (recs: RegionRecommendation[]) => void;
}

export const useRecommendationStore = create<RecommendationState>((set) => ({
  workplace: null,
  budget: 40000,
  weights: { ...WEIGHT_PRESETS.worker },
  patience: 45,
  hoveredRegion: null,
  recommendations: [],

  setWorkplace: (w) => set({ workplace: w }),
  setBudget: (manwon) => set({ budget: manwon }),
  setWeight: (key, value) =>
    set((state) => ({ weights: { ...state.weights, [key]: value } })),
  applyPreset: (preset) => set({ weights: { ...WEIGHT_PRESETS[preset] } }),
  setPatience: (minutes) => set({ patience: minutes }),
  setHovered: (regionCode) => set({ hoveredRegion: regionCode }),
  setRecommendations: (recs) => set({ recommendations: recs }),
}));
