/**
 * 지역 추천 점수 계산 (순수 함수 모음)
 *
 *  ▷ 정책 (2026-05-22 컨셉 전환 / 2026-05-23 Day 3 업데이트):
 *    - 단순 선형 매핑 — 빠른 구현 + 발표 시연 안정성 우선
 *    - 4축: 통근 / 주거비 부담(affordability) / 1인가구 안전(safety) / 생활
 *    - lifeScore 는 Sprint D 까지 더미 50점 고정 (POI 수집 후 교체)
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
  /** lifeScore 베이스 — Sprint D 까지 50 고정 (POI 카운트로 교체) */
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
}

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
}

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
 */
const MONTHLY_COST_RATE = 0.65 * 0.045 / 12; // ≈ 0.002438

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
 * 생활 점수 — Sprint D 까지 base 그대로 반환 (보통 50 고정).
 *  Sprint D 에서 POI 카운트 정규화로 교체 예정.
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
  const rir = calcRir(metrics.representativePrice, income);
  const as_ = affordabilityScore(rir);
  const ss = safetyScore(metrics.safetyBase);
  const ls = lifeScore(metrics.lifeScoreBase);

  const sumW = Math.max(
    1,
    weights.commute + weights.affordability + weights.safety + weights.life,
  );
  const total =
    (cs * weights.commute +
      as_ * weights.affordability +
      ss * weights.safety +
      ls * weights.life) /
    sumW;

  return {
    ...metrics,
    commuteScore: cs,
    affordabilityScore: as_,
    safetyScore: ss,
    lifeScore: ls,
    totalScore: Math.round(total),
    rir: Math.round(rir * 1000) / 1000, // 소수점 3자리 (예: 0.302)
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
