/**
 * Depth 2 지역 추천 도메인 타입
 *  - 사용자 입력(workplace, weights, patience) + 결과(RegionRecommendation)
 *  - 서버 API 응답도 동일 형태로 받아 사용 가능
 */

export interface Workplace {
  /** WGS84 위도 */
  lat: number;
  /** WGS84 경도 */
  lng: number;
  /** 사용자에게 보여줄 라벨 (예: "삼성전자 서초사옥", "강남역") */
  label: string;
  /** 도로명 또는 지번 주소 (보조 정보, 선택) */
  addressName?: string;
}

export interface Weights {
  /** 통근효율 */
  commute: number;
  /** 가성비 */
  value: number;
  /** 투자성과 (LSTM) */
  investment: number;
  /** 생활편의 */
  life: number;
}

export interface RegionRecommendation {
  /** 행정동 코드 (10자리, LAWD 형식) */
  legalDongCode: string;
  /** 표시명 (예: "영등포구 당산동") */
  displayName: string;
  /** 시군구 코드 (5자리) */
  sigunguCode: string;
  /** 시군구명 */
  sigungu: string;
  /** 동명 */
  dong: string;
  /** 행정동 중심 좌표 */
  lat: number;
  lng: number;
  /** 종합점수 (0~100, 가중치 적용) */
  totalScore: number;
  /** 통근 점수 */
  commuteScore: number;
  /** 가성비 점수 */
  valueScore: number;
  /** 투자 점수 */
  investmentScore: number;
  /** 생활 점수 */
  lifeScore: number;
  /** 통근시간 (분, 편도) */
  commuteMinutes: number;
  /** 대표 매물가 (만원 단위) */
  representativePrice: number;
  /** 3년 예상 수익률 (%, LSTM) */
  expectedReturn3y: number;
}

/** 가중치 프리셋 — 합계 100 */
export const WEIGHT_PRESETS = {
  worker:   { commute: 30, value: 25, investment: 20, life: 25 },
  investor: { commute: 15, value: 25, investment: 50, life: 10 },
  resident: { commute: 30, value: 25, investment: 10, life: 35 },
} as const satisfies Record<string, Weights>;

export type WeightPreset = keyof typeof WEIGHT_PRESETS;
