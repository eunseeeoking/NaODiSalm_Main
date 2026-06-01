/**
 * Depth 2 지역 추천 도메인 타입
 *  - 사용자 입력(workplace, weights, patience) + 결과(RegionRecommendation)
 *  - 서버 API 응답도 동일 형태로 받아 사용 가능
 *
 *  컨셉 전환 (2026-05-22, D-7):
 *    "직장인 + 투자 수익률" → "청년·신혼부부 주거 안전망"
 *    4축: 통근 / 부담(주거비) / 안전(1인가구) / 생활편의
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
  /** 주거비 부담률 (RIR 기반 — Day 3 이전엔 가격 역선형 근사) */
  affordability: number;
  /** 1인가구 안전 (범죄·가로등·CCTV — Day 3 이전엔 더미 50점) */
  safety: number;
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
  /** 주거비 부담 점수 (낮은 RIR = 높은 점수) */
  affordabilityScore: number;
  /** 1인가구 안전 점수 (범죄·가로등·CCTV 합성) */
  safetyScore: number;
  /** 생활 점수 */
  lifeScore: number;
  /** 통근시간 (분, 편도) */
  commuteMinutes: number;
  /** 대표 매물가 (만원 단위) */
  representativePrice: number;
  /**
   * 3년 가격 변동성 지표 (과거 대비 3년 누적 변동률, %)
   *  - ARIMA(2,1,2) 메인 모델 기반, LSTM은 변동성 보조 지표
   *  - "투자 수익률" 직설 표현 제거 — 가격 안정성 지표로 재정의 (컨셉 전환 2026-05-24)
   *  - Depth 3 부가 정보로만 노출 (메인 추천 점수에 반영 안 됨)
   *  - 서버 호환 필드명 유지 (제거 X)
   */
  expectedReturn3y: number;
  /** 소득 대비 주거비 부담률 (사용자 소득 입력 시 산출 — Day 3+) */
  rir?: number;
  /** 행정동 내 아파트 단지 수 (마커 호버 툴팁 '매물 N개'용) */
  complexCount?: number;
  /** 주변 LH 청년주택 개수 (Day 2+ seed:lh 실행 후 채워짐) */
  lhComplexNearby?: number;
  /**
   * TAGO 대중교통 품질 점수 (0~100, Day 2+ seed:transit 실행 후 채워짐)
   *  - null: 미적재 (commuteScore 에 보정 없음)
   *  - 0~100: 배차간격·야간접근성·정류장밀도 합성
   */
  transitScore?: number | null;
  /**
   * affordability 월 주거비 (만원) — RIR 분자. (2026-05-30 전월세 도입)
   *  - dealType=JEONSE/MONTHLY: 실거래 전월세 환산 / SALE: 매매가 합성
   */
  monthlyHousingCost?: number;
  /**
   * affordability 산출 근거 (UI 칩/툴팁 표시용).
   *  - 'rent':       실거래 전월세 시세 기반 (신뢰도 높음)
   *  - 'sale-proxy': 매매가 합성 환산 폴백 (전월세 표본 부족 또는 SALE)
   */
  affordabilityBasis?: 'rent' | 'sale-proxy';
  /** 선택 거래유형 실거래 환산 월주거비 (만원). null = 표본 부족 → sale-proxy */
  rentMonthlyCost?: number | null;
  /**
   * 전월세 시세 집계 표본수 (2026-05-30 P3 #6) — "표본 N건" 신뢰 칩용.
   *  null = sale-proxy / 표본 없음. 적으면(예: <10) 참고용 안내.
   */
  rentSampleCount?: number | null;
  /**
   * 총점 분모에서 제외된 추정 축 (2026-05-30 P3 #5).
   *  - 안전·생활이 더미(50)면 총점에 반영 안 함 → 카드에 "추정 · 점수 미반영" 표시.
   *  - [] 또는 미정의 = 모든 축 반영.
   */
  estimatedAxes?: Array<'commute' | 'affordability' | 'safety' | 'life'>;
}

/**
 * 거래유형 — affordability 산출 기준 시세 종류 (2026-05-30).
 *  region-detail 의 DealType 과 동일 값이지만, Depth2 추천 요청용으로 별도 정의해
 *  도메인 경계를 분리(추천 ↔ 단지 상세).
 */
export type RecDealType = 'SALE' | 'JEONSE' | 'MONTHLY';

/** 거래유형 라벨 (토글 UI) */
export const DEAL_TYPE_LABELS: Record<RecDealType, string> = {
  SALE: '매매',
  JEONSE: '전세',
  MONTHLY: '월세',
};

/**
 * 매물종류 (2026-05-30 P2 #3) — 전월세 시세 집계 풀 선택.
 *  4종을 한 평균에 섞으면 아파트와 빌라·반지하가 합쳐져 동 시세가 오염되므로,
 *  사용자가 실제로 찾는 종류만 골라 affordability 를 산출.
 */
export type RecPropertyType = 'APT' | 'OFFI' | 'VILLA' | 'SH';

/** 매물종류 라벨 (필터 칩 UI) */
export const PROPERTY_TYPE_LABELS: Record<RecPropertyType, string> = {
  APT: '아파트',
  OFFI: '오피스텔',
  VILLA: '빌라',
  SH: '단독·다가구',
};

/** 매물종류 표시 순서 */
export const PROPERTY_TYPE_ORDER: readonly RecPropertyType[] = [
  'APT',
  'OFFI',
  'VILLA',
  'SH',
];

/**
 * 기본 선택 매물종류 — 아파트·오피스텔·빌라.
 *  단독·다가구(SH)는 면적=연면적·반지하 등 이질성이 커서 기본 제외(사용자가 명시 선택).
 */
export const DEFAULT_PROPERTY_TYPES: RecPropertyType[] = ['APT', 'OFFI', 'VILLA'];

/**
 * 거래유형별 예산(보증금/매매가) 슬라이더 설정 (만원). 2026-05-30 P3 후속.
 *  - max = "무제한(최대)" 센티넬: 값이 max 이상이면 예산 필터를 끄고 전체 매물 표기.
 *  - labels 는 슬라이더 하단 균등 분할 눈금(시작가 ~ 최대).
 *  - SALE  : 1천만 ~ 30억 ~ 최대(40억 지점)
 *  - 보증금: 1천만 ~ 20억 ~ 최대(25억 지점)
 */
export const BUDGET_SLIDER: Record<
  RecDealType,
  { min: number; max: number; step: number; labels: string[] }
> = {
  SALE: { min: 1000, max: 400000, step: 1000, labels: ['1천만', '10억', '20억', '30억', '최대'] },
  JEONSE: { min: 1000, max: 250000, step: 1000, labels: ['1천만', '5억', '10억', '15억', '20억', '최대'] },
  MONTHLY: { min: 1000, max: 250000, step: 1000, labels: ['1천만', '5억', '10억', '15억', '20억', '최대'] },
};

/**
 * 월세 한도 슬라이더 설정 (만원/월). MONTHLY 전용.
 *  - max = "무제한(최대)" 센티넬: 값이 max 이상이면 월세 필터를 끄고 전체 표기.
 *  - 5만 ~ 400만 ~ 최대(500만 지점)
 */
export const MONTHLY_RENT_SLIDER = {
  min: 5,
  max: 500,
  step: 5,
  labels: ['5만', '100만', '200만', '300만', '400만', '최대'],
};

/**
 * 가중치 프리셋 — 합계 100
 *  청년 컨셉 기준 (2026-05-22):
 *    young     사회초년생 — 통근·부담 우선
 *    newlywed  신혼부부  — 생활 비중 높음
 *    resident  실거주    — 균형형
 *    worker    직장인    — 기존 유지 (4번째 우선순위)
 */
export const WEIGHT_PRESETS = {
  young:    { commute: 35, affordability: 30, safety: 20, life: 15 },
  newlywed: { commute: 30, affordability: 25, safety: 15, life: 30 },
  resident: { commute: 25, affordability: 30, safety: 20, life: 25 },
  worker:   { commute: 35, affordability: 20, safety: 15, life: 30 },
} as const satisfies Record<string, Weights>;

export type WeightPreset = keyof typeof WEIGHT_PRESETS;

/**
 * 소득 분위 (통계청 2023 가계금융복지조사 — seed:income 데이터와 동기)
 *  1분위: 130만원 / 2분위: 274만원 / 3분위: 403만원 / 4분위: 577만원 / 5분위: 1,057만원
 *
 *  사용처:
 *    - WeightSliders 소득 분위 칩 → 스토어 incomeQuintile
 *    - index.tsx: quintile → incomeMonthly(만원) 변환 → fetchRecommendations
 *    - scoring.ts calcRir: 선택 없으면 3분위(403) 서버 기본값 적용
 */
export type IncomeQuintile = 1 | 2 | 3 | 4 | 5;

export const QUINTILE_INCOME_MAP: Record<IncomeQuintile, number> = {
  1: 130,
  2: 274,
  3: 403,
  4: 577,
  5: 1057,
};

export const QUINTILE_LABELS: Record<IncomeQuintile, string> = {
  1: '1분위 130만',
  2: '2분위 274만',
  3: '3분위 403만',
  4: '4분위 577만',
  5: '5분위 1,057만',
};
