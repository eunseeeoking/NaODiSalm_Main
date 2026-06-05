/**
 * 서버 scoring ↔ 클라 rerank **parity** 테스트 (vitest) — 드리프트 알람.
 *
 *  배경: 클라 `rerank.ts` 가 서버 `scoring.ts` 의 inverseLinear·commuteScore·동적가중치
 *        총점을 **손으로 미러**한다(top-8 ODsay 실측 재정렬용). 서버 공식이 바뀌면 클라가
 *        소리 없이 드리프트해 정렬이 어긋난다(두 번째 진실원). 이 테스트가 그 드리프트를
 *        CI 에서 잡는다.
 *
 *  계약(parity property):
 *    "클라가 ODsay 실측 분으로 재정렬한 결과 == 서버가 그 실측 분을 처음부터 갖고 랭크한 결과"
 *    → ground truth = pickTopRegions(실측 분이 박힌 후보)
 *      client       = rerankByCommuteOverrides(서버 추정 점수, 실측 override)
 *    두 경로의 **순서 + 동별 commuteScore/totalScore** 가 완전히 일치해야 한다.
 *
 *  ▷ 이 테스트는 공식의 '정확성'이 아니라 두 구현의 '합치'만 본다(정확성은 scoring.test.ts).
 *    그래서 기대값을 손계산하지 않고 서버 산출과 직접 대조한다 — 한쪽만 바뀌면 실패.
 *  ▷ 슬라이싱 회피: k = 후보 수 → 양쪽 모두 전 후보를 정렬만 하므로 직접 비교 가능.
 *    (클라는 받은 top-N '안에서만' 재정렬 가능하므로, 전 후보에 override 를 주는 전제로 비교.)
 *
 *  실행: cd server && npm test
 */
import { describe, it, expect } from 'vitest';
import { pickTopRegions, type RegionMetrics, type Weights } from './scoring';
// 실제 클라 구현을 그대로 import (모노레포). rerank.ts 는 타입만 import 하므로 런타임 의존 없음.
import { rerankByCommuteOverrides } from '../../../../client/src/pages/Recommendation/rerank';
import type { RegionRecommendation } from '../../../../client/src/types/recommendation';

/** RegionMetrics 빌더 — 동코드만 바꾸고 나머지는 동일 기본값(축 점수 동일하게). */
function mk(code: string, over: Partial<RegionMetrics> = {}): RegionMetrics {
  return {
    legalDongCode: code,
    displayName: code,
    sigunguCode: '11680',
    sigungu: '강남구',
    dong: code,
    lat: 37.5,
    lng: 127.03,
    commuteMinutes: 30,
    representativePrice: 30000,
    expectedReturn3y: 0,
    safetyBase: 70,
    lifeScoreBase: 65,
    transitScore: null,
    lhComplexNearby: 0,
    complexCount: 10,
    rentMonthlyCost: null,
    rentSampleCount: null,
    rentDepositManwon: null,
    rentPureMonthlyManwon: null,
    safetyIsEstimated: false,
    lifeIsEstimated: false,
    ...over,
  };
}

const income = 403;

/** 서버 ScoredRegion 은 RegionRecommendation 의 구조적 슈퍼셋 → 클라 reranker 에 그대로 투입. */
function asClientRecs(scored: ReturnType<typeof pickTopRegions>): RegionRecommendation[] {
  return scored as unknown as RegionRecommendation[];
}

describe('서버 scoring ↔ 클라 rerank parity', () => {
  it('다양한 통근분·transitScore·추정축 혼합 — 순서·점수 완전 일치', () => {
    const patience = 50;
    const weights: Weights = { commute: 35, affordability: 30, safety: 20, life: 15 };

    // 서버 '추정' 후보 (통근분 = 직선거리/캐시 추정값)
    const fixtures: RegionMetrics[] = [
      mk('A', { commuteMinutes: 30, representativePrice: 25000, transitScore: 70 }),
      mk('B', { commuteMinutes: 22, representativePrice: 40000, transitScore: null }),
      mk('C', { commuteMinutes: 41, representativePrice: 18000, transitScore: 95, safetyIsEstimated: true }),
      mk('D', { commuteMinutes: 15, representativePrice: 60000, transitScore: 40, lifeIsEstimated: true }),
      mk('E', { commuteMinutes: 28, representativePrice: 33000, transitScore: 60 }),
      mk('F', { commuteMinutes: 36, representativePrice: 21000, transitScore: null, safetyIsEstimated: true, lifeIsEstimated: true }),
    ];
    // ODsay 실측(전 후보 측정 전제) — 추정과 다른 값
    const overrides: Record<string, number> = { A: 34, B: 19, C: 52, D: 18, E: 25, F: 44 };

    // ground truth: 서버가 실측 분을 처음부터 갖고 랭크
    const truth = pickTopRegions(
      fixtures.map((f) => ({ ...f, commuteMinutes: overrides[f.legalDongCode] })),
      weights,
      patience,
      fixtures.length,
      income,
    );

    // client: 서버 추정 점수 → 실측 override 로 재정렬
    const serverScored = pickTopRegions(fixtures, weights, patience, fixtures.length, income);
    const reranked = rerankByCommuteOverrides(asClientRecs(serverScored), overrides, weights, patience);

    // 순서 일치
    expect(reranked.map((r) => r.legalDongCode)).toEqual(truth.map((r) => r.legalDongCode));
    // 동별 통근분·commuteScore·총점 일치
    truth.forEach((t, i) => {
      const c = reranked[i];
      expect(c.legalDongCode).toBe(t.legalDongCode);
      expect(c.commuteMinutes).toBe(t.commuteMinutes);
      expect(c.commuteScore).toBe(t.commuteScore);
      expect(c.totalScore).toBe(t.totalScore);
    });
  });

  it('tie-break: 총점 동점 시 commuteScore 내림차순 (minutes 오름차순과 갈리는 케이스)', () => {
    // commute 가중 0 → afford/safety/life 동일한 두 동은 총점 동점. transitScore 보정이
    //  commuteScore 순서를 분(minutes) 순서와 반대로 만든다. 과거 클라(분 asc)면 서버와 어긋남.
    const patience = 60;
    const w: Weights = { commute: 0, affordability: 100, safety: 0, life: 0 };
    const A = mk('A', { commuteMinutes: 99, transitScore: null }); // 추정값 무관(override 로 교체)
    const B = mk('B', { commuteMinutes: 99, transitScore: 100 });
    const overrides: Record<string, number> = { A: 10, B: 12 };
    //  cs_A = inverseLinear(10,0,60)=83 (transit 없음)
    //  cs_B = round(0.75*inverseLinear(12,0,60)=80 + 0.25*100)=85  → cs_B(85) > cs_A(83)
    //  분은 A(10) < B(12). 즉 commuteScore 순서와 minutes 순서가 반대.

    const truth = pickTopRegions(
      [A, B].map((f) => ({ ...f, commuteMinutes: overrides[f.legalDongCode] })),
      w,
      patience,
      2,
      income,
    );
    const scored = pickTopRegions([A, B], w, patience, 2, income);
    const reranked = rerankByCommuteOverrides(asClientRecs(scored), overrides, w, patience);

    expect(truth[0].totalScore).toBe(truth[1].totalScore); // 동점 전제 확인
    expect(truth.map((r) => r.legalDongCode)).toEqual(['B', 'A']); // 서버: commuteScore 높은 B 먼저
    // 클라도 동일해야 함(commuteScore desc 수정 후). 과거(분 asc)면 ['A','B'] 로 실패.
    expect(reranked.map((r) => r.legalDongCode)).toEqual(['B', 'A']);
  });
});
