/**
 * 지역 추천 점수 계산 (순수 함수 모음)
 *
 *  ▷ 정책 (2026-05-22 컨셉 전환 / 2026-05-23 Day 3 업데이트):
 *    - 단순 선형 매핑 — 빠른 구현 + 발표 시연 안정성 우선
 *    - 4축: 통근 / 주거비 부담(affordability) / 1인가구 안전(safety) / 생활
 *    - lifeScore 는 KI-4(2026-05-31) 카카오 POI 실데이터화 (seed:life 미적재 동만 더미 50)
 *    - safetyBase: Day 3 t_safety_index 실데이터 적재 (50 고정 해제)
 *    - affordability: Day 3 RIR(주거비/소득 비율) 역선형으로 교체
 *
 *  ▷ 입력은 행정동 단위로 이미 집계된 메트릭 (repository 가 책임)
 *  ▷ 모든 점수는 [0, 100] 범위로 클램프
 */

/** 행정동 1개에 대해 입력으로 들어오는 raw 메트릭 */
export interface RegionMetrics {
  legalDongCode: string;
  displayName: string;
  sigunguCode: string;
  sigungu: string;
  dong: string;
  /** 행정동 centroid (단지 lat/lng 평균) */
  lat: number;
  lng: number;
  /** 편도 분 — t_commute_matrix 또는 Haversine 추정 */
  commuteMinutes: number;
  /** 행정동 내 중형 매물 최근 1년 거래 중위 가격 (만원) */
  representativePrice: number;
  /**
   * LSTM 가격 안정성 지표 (과거 대비 3년 변동률, %)
   *  - Q4=B: Depth 3 부가 정보로만 사용. 메인 추천 점수에 반영 안 됨.
   */
  expectedReturn3y: number;
  /**
   * 1인가구 안전 점수 베이스 (0~100, 합성)
   *  - Day 3 t_safety_index 수집 전까지 50 고정
   *  - 경찰청 범죄주의구간 + 가로등·CCTV 밀도 합성 (Day 3)
   */
  safetyBase: number;
  /**
   * lifeScore 베이스 (0~100)
   *  - KI-4(2026-05-31): t_poi_summary 카카오 POI lifeScore 실데이터.
   *  - seed:life 미적재 동은 50 fallback (lifeIsEstimated=true → 총점 분모 제외).
   */
  lifeScoreBase: number;
  /**
   * TAGO 대중교통 품질 점수 (0~100)
   *  - Day 2 t_transit_route_summary 적재 전까지 null
   *  - null 이면 commuteScore 에 보정 없음
   *  - 산출: 0.5×배차간격역선형 + 0.3×야간접근성 + 0.2×정류장밀도
   */
  transitScore: number | null;
  /**
   * 주변 LH 청년주택 수 (행정동 단위)
   *  - Day 2 t_lh_youth_housing 적재 전까지 0
   *  - RegionCard "주변 LH 청년주택 N개" 표시
   */
  lhComplexNearby: number;
  /**
   * 행정동 내 단지 수 (마커 호버 툴팁용)
   *  - t_apt_complex GROUP BY legal_dong_code 카운트
   *  - 추천 응답 매핑에서 직접 사용 (recommendations.ts)
   */
  complexCount: number;
  /**
   * 실거래 전월세 환산 월 주거비 (만원) — 선택된 거래유형(JEONSE/MONTHLY) 기준.
   *  - 2026-05-30: 국토부 RTMS 전월세 4종 적재로 도입.
   *  - repository 가 t_*_rent 풀링 집계로 산출 (전세=보증금 환산, 월세=월세+보증금 환산).
   *  - null: 해당 동 전월세 표본 부족 또는 dealType=SALE
   *          → scoreRegion 이 매매가 합성(MONTHLY_COST_RATE)으로 폴백.
   */
  rentMonthlyCost: number | null;
  /**
   * 전월세 시세 집계에 쓰인 실거래 표본수 (2026-05-30 P3 #6).
   *  - rent basis 일 때만 채워짐. null = sale-proxy / 표본 없음.
   *  - 카드 "표본 N건" 신뢰 칩에 사용.
   */
  rentSampleCount: number | null;
  /**
   * 보증금 중위값 (만원) — 카드 분리 표기용 (KI-9). null = SALE/표본 부족.
   *  - JEONSE: 전세금(=보증금) 그대로 카드 대표값으로 표시.
   *  - MONTHLY: "보증금 Y" 보조 표기.
   */
  rentDepositManwon: number | null;
  /**
   * 순수 월세 중위값 (만원) — 카드 분리 표기용 (KI-9). null = SALE/JEONSE/표본 부족.
   *  - 월세 한도 필터(monthlyBudget)와 동일 기준 → 카드 "월세 X만"이 필터와 일치(혼동 해소).
   *  - 합산 월주거비(monthlyHousingCost = 월세 + 보증금×환산, RIR 분자)와는 다른 값.
   */
  rentPureMonthlyManwon: number | null;
  /**
   * 안전 점수가 추정(더미 50)인지 (2026-05-30 P3 #5).
   *  - t_safety_index 미적재로 50 fallback 이면 true.
   *  - true 인 축은 scoreRegion 의 총점 분모에서 제외 → 점수 변별력 회복.
   */
  safetyIsEstimated: boolean;
  /**
   * 생활 점수가 추정(더미 50)인지 (2026-05-30 P3 #5).
   *  - KI-4: t_poi_summary 미적재 동만 true (seed:life 적재 시 false).
   */
  lifeIsEstimated: boolean;
}

/** 4축 식별자 — estimatedAxes 등에서 사용 */
export type ScoreAxis = 'commute' | 'affordability' | 'safety' | 'life';

/**
 * 4축 가중치 — 합 ≈ 100
 *  commute       통근효율
 *  affordability 주거비 부담 (RIR 기반, Day 3 이전엔 가격 역선형)
 *  safety        1인가구 안전 (범죄·가로등·CCTV)
 *  life          생활편의
 */
export interface Weights {
  commute: number;
  affordability: number;
  safety: number;
  life: number;
}

/** repository → router 에 전달하는 후보 (위 RegionMetrics 와 동일하지만 점수는 미계산) */
export type RegionCandidate = RegionMetrics;

/** 클라이언트가 받는 최종 응답 형태 (RegionRecommendation 과 1:1) */
export interface ScoredRegion extends RegionMetrics {
  totalScore: number;
  commuteScore: number;
  affordabilityScore: number;
  safetyScore: number;
  lifeScore: number;
  /** RIR (소득 대비 주거비 비율, 0~1+). 클라이언트 표시용. Day 3+ */
  rir: number;
  /** 월 주거비 산출 근거 (만원, RIR 분자) — 클라이언트 표시용. 2026-05-30 */
  monthlyHousingCost: number;
  /**
   * affordability 산출 근거.
   *  - 'rent':       실거래 전월세 환산 (rentMonthlyCost 사용 — 신뢰도 높음)
   *  - 'sale-proxy': 매매가 합성 환산 (MONTHLY_COST_RATE — 폴백, 가정 2겹)
   */
  affordabilityBasis: AffordabilityBasis;
  /**
   * 총점 분모에서 제외된 추정 축 (2026-05-30 P3 #5).
   *  - 더미 50 고정 축(데이터 미적재)을 총점에 넣으면 모든 동이 비슷해져 변별력 상실.
   *  - 제외된 축은 카드에 "추정 · 점수 미반영" 으로 표시.
   *  - 예: ['safety','life'] (둘 다 미적재) / [] (둘 다 실데이터).
   */
  estimatedAxes: ScoreAxis[];
  /**
   * 실제 총점 산출에 쓰인 유효 가중치 합 (분모). 디버깅/표시용.
   *  - 추정 축 제외 후의 가중치 합 (예: 안전·생활 제외 시 commute+affordability).
   */
  effectiveWeightSum: number;
}

/** affordability 점수의 월 주거비 산출 근거 */
export type AffordabilityBasis = 'rent' | 'sale-proxy';

/**
 * 거래유형 — affordability 기준이 되는 시세 종류.
 *  - SALE:    매매가 (기존 합성 환산 — 폴백 경로)
 *  - JEONSE:  전세 (실거래 보증금 환산)
 *  - MONTHLY: 월세 (실거래 월세 + 보증금 환산)
 */
export type DealType = 'SALE' | 'JEONSE' | 'MONTHLY';

/**
 * 매물종류 — 전월세 시세 집계 시 어떤 실거래 풀을 쓸지 결정 (2026-05-30 P2).
 *  - APT:   아파트 (t_apt_rent)
 *  - OFFI:  오피스텔 (t_offi_rent)
 *  - VILLA: 연립·다세대(빌라) (t_villa_rent)
 *  - SH:    단독·다가구 (t_sh_rent) — 면적=연면적, 반지하 등 이질성 큼
 *
 *  ▷ 배경: 4종을 UNION ALL 로 한 평균에 섞으면 아파트 전세 3.5억과
 *          빌라·단독 반지하 전세 3천만이 같은 "동 시세"로 합쳐져 통계가 오염됨.
 *          사용자가 실제로 찾는 종류만 골라 집계하도록 분리.
 */
export type PropertyType = 'APT' | 'OFFI' | 'VILLA' | 'SH';

/** 전체 매물종류 (옵션 생략 시 기본 — 하위호환: 기존 4종 풀링 동작 유지) */
export const ALL_PROPERTY_TYPES: readonly PropertyType[] = ['APT', 'OFFI', 'VILLA', 'SH'];

/* ─── 정규화 헬퍼 ──────────────────────────────────────────── */

/**
 * value 가 [min, max] 사이일 때 [0, 100] 으로 선형 매핑.
 * value <= min 이면 100, value >= max 이면 0 (역방향: "낮을수록 좋다").
 *
 * 예: 통근시간 — 0분이면 100점, patience 분 이상이면 0점.
 */
export function inverseLinear(value: number, min: number, max: number): number {
  if (max <= min) return 50; // 분모 0 방어
  if (value <= min) return 100;
  if (value >= max) return 0;
  return Math.round(((max - value) / (max - min)) * 100);
}

/**
 * value 가 [min, max] 사이일 때 [0, 100] 으로 선형 매핑 (정방향).
 * value <= min 이면 0, value >= max 이면 100 (정방향: "높을수록 좋다").
 */
export function forwardLinear(value: number, min: number, max: number): number {
  if (max <= min) return 50;
  if (value <= min) return 0;
  if (value >= max) return 100;
  return Math.round(((value - min) / (max - min)) * 100);
}

/* ─── 4축 점수 ──────────────────────────────────────────────── */

/**
 * 통근 점수 — patience 기준 역선형 + TAGO 대중교통 품질 보정.
 *
 *  baseScore = inverseLinear(commuteMinutes, 0, patience)
 *  보정:      transitScore 가 있으면 가중합
 *              finalScore = 0.75×baseScore + 0.25×transitScore
 *
 *  근거: 같은 40분 통근이라도 배차 5분(환승 0) vs 배차 30분(환승 2)은
 *        실질 통근 스트레스가 크게 다름.
 *        Day 2 TAGO 적재 전까지 transitScore=null → 보정 없음.
 */
export function commuteScore(
  commuteMinutes: number,
  patience: number,
  transitScore: number | null = null,
): number {
  const safePatience = Math.max(15, patience);
  const base = inverseLinear(commuteMinutes, 0, safePatience);
  if (transitScore == null) return base;
  return Math.round(0.75 * base + 0.25 * transitScore);
}

/* ─── RIR 계산 헬퍼 ──────────────────────────────────────── */

/**
 * 전월세 환산 월임대료 계산 파라미터.
 *
 *  매매가 → 전세 전환: 전세가율 65% (서울 평균, 2023 KB 기준)
 *  전세 → 월세 전환: 연 전환율 4.5% (한국은행 2023 기준)
 *  월 환산: × (1/12)
 *
 *  결합: price(만원) × 0.65 × 0.045 / 12 = price × MONTHLY_COST_RATE
 *
 *  ▷ KI-14(2026-06-04): 환산율·전세가율은 금리·시장 변동에 따라 바뀌므로 **env 로 주기 갱신** 가능.
 *    기본값은 한국은행 전월세전환율(연 4.5%, 2023 기준)·전세가율 65% — 갱신 시 .env 의
 *    `JEONSE_CONVERSION_RATE_ANNUAL`(예: 0.052)·`JEONSE_PRICE_RATIO` 로 오버라이드(미설정 시 기존값 = 점수 불변).
 *    ※ 값 변경은 전 동 RIR/affordability 에 영향 → 갱신 시 회귀 확인 권장.
 */
/** 연 전월세전환율 — 한국은행 기준(기본 4.5%/년). env `JEONSE_CONVERSION_RATE_ANNUAL` 로 갱신. */
const ANNUAL_CONVERSION_RATE =
  Number(process.env.JEONSE_CONVERSION_RATE_ANNUAL) > 0
    ? Number(process.env.JEONSE_CONVERSION_RATE_ANNUAL)
    : 0.045;
/** 매매가 → 전세 환산 전세가율(기본 65%). env `JEONSE_PRICE_RATIO` 로 갱신. */
const JEONSE_PRICE_RATIO =
  Number(process.env.JEONSE_PRICE_RATIO) > 0 ? Number(process.env.JEONSE_PRICE_RATIO) : 0.65;
const MONTHLY_COST_RATE = (JEONSE_PRICE_RATIO * ANNUAL_CONVERSION_RATE) / 12; // 기본 ≈ 0.002438

/**
 * 전세 보증금 → 월 환산율 (2026-05-30, 실거래 전월세 도입).
 *
 *  MONTHLY_COST_RATE 와 달리 "전세가율 65%" 가정이 빠진다 —
 *  실거래 보증금(전세) 또는 실거래 보증금(월세분)에 직접 적용하므로
 *  매매→전세 환산 가정이 불필요. 전환율 4.5%/년(한국은행 2023)만 적용.
 *
 *    전세 월환산   = depositManwon × JEONSE_TO_MONTHLY_RATE
 *    월세 월주거비 = monthlyManwon + depositManwon × JEONSE_TO_MONTHLY_RATE
 *
 *  ▷ KI-14: 연 전환율은 위 ANNUAL_CONVERSION_RATE(env 갱신 가능) 공유. 기본 4.5%/년.
 */
export const JEONSE_TO_MONTHLY_RATE = ANNUAL_CONVERSION_RATE / 12; // 기본 ≈ 0.00375

/**
 * 사용자 소득 미입력 시 기본값 — 통계청 3분위 월평균 가처분소득 (2023).
 *  seed:income 실행 후 t_income_quintile.avg_income(quintile=3) 와 일치.
 */
export const DEFAULT_MONTHLY_INCOME_MANWON = 403;

/**
 * RIR (Rent-to-Income Ratio) 계산.
 *
 *  monthlyHousingCost = representativePrice × MONTHLY_COST_RATE
 *  rir = monthlyHousingCost / monthlyIncome
 *
 *  예시:
 *    강남 50,000만원 / 3분위 403만원 → 0.302 → affordabilityScore ≈ 66점
 *    중랑 20,000만원 / 3분위 403만원 → 0.121 → affordabilityScore ≈ 100점 (clamp)
 */
export function calcRir(
  representativePrice: number,
  monthlyIncomeManwon: number = DEFAULT_MONTHLY_INCOME_MANWON,
): number {
  const monthlyCost = representativePrice * MONTHLY_COST_RATE;
  return monthlyCost / Math.max(1, monthlyIncomeManwon);
}

/**
 * 주거비 부담 점수 — RIR(주거비/소득) 역선형.
 *
 *  rir ≤ 0.20  → 100점 (매우 여유 — 소득 대비 주거비 20% 이하)
 *  rir = 0.30  → 약 67점 (적정 선)
 *  rir ≥ 0.50  → 0점   (주거 빈곤선 — 소득의 절반이 집값)
 *
 *  기준 근거:
 *    · UN-HABITAT "주거 부담 가능 기준" = 소득의 30% 이하
 *    · 한국 주거복지재단 청년 주거빈곤 기준 = RIR 40% 이상
 *    → 정책적 의미가 명확한 20~50% 구간 사용
 *
 *  Day 3 이전 근사 (폐기됨):
 *    inverseLinear(representativePrice, 10000, 200000)
 */
export function affordabilityScore(rir: number): number {
  return inverseLinear(rir, 0.20, 0.50);
}

/**
 * 1인가구 안전 점수 — safetyBase 그대로 클램프.
 *  Day 3 이전: repository 가 50 고정으로 제공.
 *  Day 3+: 경찰청 범죄주의구간 + 가로등·CCTV 밀도 합성 (0~100, 행정동 정규화)
 */
export function safetyScore(rawSafety: number): number {
  return Math.min(100, Math.max(0, Math.round(rawSafety)));
}

/**
 * 생활 점수 — lifeScoreBase 그대로 클램프.
 *  KI-4(2026-05-31): t_poi_summary 카카오 POI lifeScore 실데이터.
 *  미적재 동은 repository 가 50 fallback + lifeIsEstimated=true 로 표시.
 */
export function lifeScore(lifeScoreBase: number): number {
  return Math.min(100, Math.max(0, Math.round(lifeScoreBase)));
}

/* ─── 가중합 + 응답 조립 ───────────────────────────────────── */

/**
 * 단일 행정동에 대해 4축 점수 + 종합점수를 계산.
 *
 *  totalScore = (commuteScore*wC + affordabilityScore*wA + safetyScore*wS + lifeScore*wL) / Σw
 *  Σw 는 정확히 100 일 가능성이 높지만, 사용자 입력이 90~110 허용이므로 동적 분모.
 *
 *  @param income  사용자 월 소득 (만원). 생략 시 DEFAULT_MONTHLY_INCOME_MANWON(3분위) 사용.
 */
export function scoreRegion(
  metrics: RegionMetrics,
  weights: Weights,
  patience: number,
  income: number = DEFAULT_MONTHLY_INCOME_MANWON,
): ScoredRegion {
  const cs = commuteScore(metrics.commuteMinutes, patience, metrics.transitScore);

  // affordability — 실거래 전월세 시세가 있으면 우선, 없으면 매매가 합성 폴백.
  //  rent 경로: 가정 1겹(전환율) — 신뢰도 높음 / sale-proxy: 가정 2겹(전세가율×전환율)
  const basis: AffordabilityBasis = metrics.rentMonthlyCost != null ? 'rent' : 'sale-proxy';
  const monthlyCost =
    metrics.rentMonthlyCost != null
      ? metrics.rentMonthlyCost
      : metrics.representativePrice * MONTHLY_COST_RATE;
  const rir = monthlyCost / Math.max(1, income);
  // KI-11(2026-06-04): 저표본 전월세 시세는 신뢰도 낮음 → affordability 에 완만한 신뢰 보정.
  //  rent 기반(표본 존재)만 적용, sale-proxy(rentSampleCount=null)는 무보정. 표본 5~9건 → 0.94~1.0 선형,
  //  ≥10 무보정. HAVING≥5 라 5 미만은 없음. 게이트가 아니라 점수 가중이라 동 자체를 제외하진 않음
  //  (저표본 동을 살짝 뒤로 — '표본 N건·참고' amber 칩과 정합).
  const sampleConf =
    basis === 'rent' && metrics.rentSampleCount != null && metrics.rentSampleCount < 10
      ? 0.94 + (Math.max(0, metrics.rentSampleCount - 5) / 5) * 0.06
      : 1;
  const as_ = Math.round(affordabilityScore(rir) * sampleConf);
  const ss = safetyScore(metrics.safetyBase);
  const ls = lifeScore(metrics.lifeScoreBase);

  // 동적 가중치 (2026-05-30 P3 #5):
  //  통근·주거비는 항상 활성(데이터 기반 핵심 축). 안전·생활은 추정(더미 50)이면
  //  총점 분모에서 제외 → 더미가 모든 동을 50 으로 끌어당겨 점수가 뭉개지는 문제 해소.
  const axes: Array<{ axis: ScoreAxis; score: number; weight: number; active: boolean }> = [
    { axis: 'commute', score: cs, weight: weights.commute, active: true },
    { axis: 'affordability', score: as_, weight: weights.affordability, active: true },
    { axis: 'safety', score: ss, weight: weights.safety, active: !metrics.safetyIsEstimated },
    { axis: 'life', score: ls, weight: weights.life, active: !metrics.lifeIsEstimated },
  ];

  let accWeighted = 0;
  let accWeight = 0;
  const estimatedAxes: ScoreAxis[] = [];
  for (const a of axes) {
    if (a.active) {
      accWeighted += a.score * a.weight;
      accWeight += a.weight;
    } else {
      estimatedAxes.push(a.axis);
    }
  }
  // 활성 축이 전혀 없는 비정상 상황 방어 (commute/affordability 가 항상 active 라 발생 X)
  const effectiveWeightSum = Math.max(1, accWeight);
  const total = accWeighted / effectiveWeightSum;

  return {
    ...metrics,
    commuteScore: cs,
    affordabilityScore: as_,
    safetyScore: ss,
    lifeScore: ls,
    totalScore: Math.round(total),
    rir: Math.round(rir * 1000) / 1000, // 소수점 3자리 (예: 0.302)
    monthlyHousingCost: Math.round(monthlyCost),
    affordabilityBasis: basis,
    estimatedAxes,
    effectiveWeightSum: accWeight,
  };
}

/**
 * 후보 행정동 N 개 → 점수 계산 후 TOP K 만 정렬해서 반환.
 *  - 동점 시 commuteScore 우선 (청년 컨셉 통근 우선)
 *  - K 가 후보 수보다 크면 후보 전체 반환
 *
 *  @param income  사용자 월 소득 (만원). 생략 시 DEFAULT_MONTHLY_INCOME_MANWON(3분위) 사용.
 */
export function pickTopRegions(
  candidates: RegionCandidate[],
  weights: Weights,
  patience: number,
  k = 8,
  income: number = DEFAULT_MONTHLY_INCOME_MANWON,
): ScoredRegion[] {
  const scored = candidates.map((c) => scoreRegion(c, weights, patience, income));
  scored.sort((a, b) => {
    if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
    return b.commuteScore - a.commuteScore;
  });
  return scored.slice(0, k);
}
// (2026-05-30 전월세 affordability 도입 — 파일 끝)
