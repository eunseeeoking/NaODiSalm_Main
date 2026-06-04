/**
 * 클라 top-8 ODsay 재정렬 (odsay 분석 §7 후속).
 *
 *  서버 랭킹은 통근축에 직선거리/캐시 추정을 쓴다(쿼터 절약). 클라가 top-8 에 ODsay 실측을
 *  받아오면(commuteOverrides) **표시 통근시간만 교체되고 순위는 서버 그대로**여서, "삼산동이
 *  36분으로 보이는데 여전히 3위" 같은 표시-순위 모순(거짓양성)이 생긴다.
 *  → 실측 통근분으로 commuteScore·totalScore 를 **서버와 동일 공식**으로 재계산해 재정렬한다.
 *
 *  · 순수 함수(부수효과 없음) — 서버 scoring.ts 의 inverseLinear/commuteScore/동적가중치를 미러.
 *  · override 없는 동(top-8 밖)은 서버 점수 그대로 → 혼합 정렬(부분 보정, 설계 의도).
 */
import type { RegionRecommendation, Weights } from '../../types/recommendation';

/** 서버 inverseLinear 미러 — 낮을수록 좋음(통근 0분=100, patience 분=0). */
function inverseLinear(value: number, min: number, max: number): number {
  if (max <= min) return 50;
  if (value <= min) return 100;
  if (value >= max) return 0;
  return Math.round(((max - value) / (max - min)) * 100);
}

/** 서버 commuteScore 미러 — patience 역선형 + transitScore(TAGO) 0.75/0.25 가중. */
function commuteScore(
  commuteMinutes: number,
  patience: number,
  transitScore: number | null | undefined,
): number {
  const safePatience = Math.max(15, patience);
  const base = inverseLinear(commuteMinutes, 0, safePatience);
  if (transitScore == null) return base;
  return Math.round(0.75 * base + 0.25 * transitScore);
}

/** 동적 가중치 총점 미러 — 통근·주거비 항상 활성, 안전·생활은 estimatedAxes 면 분모 제외. */
function recomputeTotal(
  r: RegionRecommendation,
  newCommuteScore: number,
  weights: Weights,
): number {
  const est = r.estimatedAxes ?? [];
  const axes: Array<{ score: number; weight: number; active: boolean }> = [
    { score: newCommuteScore, weight: weights.commute, active: true },
    { score: r.affordabilityScore, weight: weights.affordability, active: true },
    { score: r.safetyScore, weight: weights.safety, active: !est.includes('safety') },
    { score: r.lifeScore, weight: weights.life, active: !est.includes('life') },
  ];
  let accWeighted = 0;
  let accWeight = 0;
  for (const a of axes) {
    if (!a.active) continue;
    accWeighted += a.score * a.weight;
    accWeight += a.weight;
  }
  return Math.round(accWeighted / Math.max(1, accWeight));
}

/**
 * commuteOverrides(legalDongCode → ODsay 실측 분) 로 재정렬한 새 배열.
 *  - override 있는 동: commuteMinutes/commuteScore/totalScore 를 실측 기준으로 교체.
 *  - 없는 동: 서버값 유지.
 *  - 정렬: totalScore desc, 동점 시 commuteMinutes asc(서버 tie-break 정합).
 *  override 가 비었으면 입력 배열을 그대로 반환(참조 동일 — 불필요 렌더 방지).
 */
export function rerankByCommuteOverrides(
  recs: RegionRecommendation[],
  commuteOverrides: Record<string, number>,
  weights: Weights,
  patience: number,
): RegionRecommendation[] {
  if (!recs.length || Object.keys(commuteOverrides).length === 0) return recs;

  const adjusted = recs.map((r) => {
    const ov = commuteOverrides[r.legalDongCode];
    if (ov == null || ov === r.commuteMinutes) return r;
    const cs = commuteScore(ov, patience, r.transitScore);
    return {
      ...r,
      commuteMinutes: ov,
      commuteScore: cs,
      totalScore: recomputeTotal(r, cs, weights),
    };
  });

  // 안정 정렬: 총점 desc → 통근분 asc
  return adjusted
    .map((r, i) => ({ r, i }))
    .sort((a, b) =>
      b.r.totalScore - a.r.totalScore ||
      a.r.commuteMinutes - b.r.commuteMinutes ||
      a.i - b.i,
    )
    .map((x) => x.r);
}
