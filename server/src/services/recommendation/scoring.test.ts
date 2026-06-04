/**
 * scoring.ts 단위테스트 (vitest)
 *
 *  ▷ 원칙: 기대값은 구현을 베끼지 않고 **주석에 적힌 명세에서 직접 손계산**해 박는다.
 *          (구현을 그대로 옮기면 버그를 못 잡으므로.)
 *
 *  ▷ env 가정: scoring.ts 의 MONTHLY_COST_RATE 는 모듈 로드 시 process.env 로 결정된다.
 *             dotenv 는 index.ts 에서만 호출되므로 vitest 단독 실행 시 .env 는 로드되지 않아
 *             기본값(전환율 4.5%/년, 전세가율 65%)이 적용된다. 아래 calcRir/affordability 절대값은
 *             이 기본값을 전제로 한다. (env 오버라이드 시 절대값 테스트는 의도적으로 실패해야 정상.)
 *
 *  실행: npm test  (watch: npm run test:watch)
 */
import { describe, it, expect } from 'vitest';
import {
  inverseLinear,
  forwardLinear,
  commuteScore,
  calcRir,
  affordabilityScore,
  safetyScore,
  lifeScore,
  scoreRegion,
  pickTopRegions,
  DEFAULT_MONTHLY_INCOME_MANWON,
  type RegionMetrics,
  type Weights,
} from './scoring';

/* ─── env 가정 가드 ─────────────────────────────────────────────
 *  전환율/전세가율 env 가 설정돼 있으면 절대값 테스트가 흔들리므로 먼저 경고.
 */
describe('env 가정 (절대값 테스트 전제)', () => {
  it('전환율/전세가율 env 오버라이드가 없어야 한다 (기본값 4.5%/65%)', () => {
    expect(process.env.JEONSE_CONVERSION_RATE_ANNUAL).toBeUndefined();
    expect(process.env.JEONSE_PRICE_RATIO).toBeUndefined();
  });
});

/* ─── 정규화 헬퍼 ──────────────────────────────────────────────── */
describe('inverseLinear (낮을수록 좋다)', () => {
  it('value <= min → 100', () => {
    expect(inverseLinear(0, 0, 60)).toBe(100);
    expect(inverseLinear(-5, 0, 60)).toBe(100);
  });
  it('value >= max → 0', () => {
    expect(inverseLinear(60, 0, 60)).toBe(0);
    expect(inverseLinear(100, 0, 60)).toBe(0);
  });
  it('중간값 선형 매핑', () => {
    expect(inverseLinear(30, 0, 60)).toBe(50); // 정확히 절반
    expect(inverseLinear(15, 0, 60)).toBe(75);
  });
  it('max <= min 방어 → 50', () => {
    expect(inverseLinear(5, 10, 10)).toBe(50);
    expect(inverseLinear(5, 20, 10)).toBe(50);
  });
});

describe('forwardLinear (높을수록 좋다)', () => {
  it('경계: min→0, max→100', () => {
    expect(forwardLinear(0, 0, 100)).toBe(0);
    expect(forwardLinear(100, 0, 100)).toBe(100);
  });
  it('중간값', () => {
    expect(forwardLinear(50, 0, 100)).toBe(50);
  });
  it('max <= min 방어 → 50', () => {
    expect(forwardLinear(5, 10, 10)).toBe(50);
  });
});

/* ─── 통근 점수 ────────────────────────────────────────────────── */
describe('commuteScore', () => {
  it('통근 0분 → 100, patience 도달 → 0', () => {
    expect(commuteScore(0, 60)).toBe(100);
    expect(commuteScore(60, 60)).toBe(0);
  });
  it('patience 절반 통근 → 50', () => {
    expect(commuteScore(30, 60)).toBe(50);
  });
  it('patience 는 최소 15분으로 바닥 처리 (Math.max(15, patience))', () => {
    // patience=5 라도 15 로 floor → inverseLinear(10,0,15)=round(33.33)=33
    expect(commuteScore(10, 5)).toBe(33);
  });
  it('transitScore 가 있으면 0.75*base + 0.25*transit 가중합', () => {
    // base=inverseLinear(30,0,60)=50, transit=80 → round(0.75*50+0.25*80)=round(57.5)=58
    expect(commuteScore(30, 60, 80)).toBe(58);
  });
  it('transitScore=null 이면 보정 없음 (base 그대로)', () => {
    expect(commuteScore(30, 60, null)).toBe(50);
  });
});

/* ─── RIR / 주거비 부담 ────────────────────────────────────────── */
describe('calcRir (기본 env 전제)', () => {
  it('강남 5억 / 3분위 403만 → RIR ≈ 0.302 (주석 예시)', () => {
    expect(calcRir(50000, 403)).toBeCloseTo(0.302, 3);
  });
  it('중랑 2억 / 3분위 403만 → RIR ≈ 0.121 (주석 예시)', () => {
    expect(calcRir(20000, 403)).toBeCloseTo(0.121, 3);
  });
  it('소득 미입력 시 기본 3분위(403만) 사용', () => {
    expect(calcRir(50000)).toBeCloseTo(calcRir(50000, DEFAULT_MONTHLY_INCOME_MANWON), 6);
  });
  it('소득 0 방어 → 1 로 나눔 (NaN/Infinity 금지)', () => {
    const rir = calcRir(50000, 0);
    expect(Number.isFinite(rir)).toBe(true);
    expect(rir).toBeCloseTo(121.875, 2); // 50000*0.0024375 / max(1,0)
  });
});

describe('affordabilityScore = inverseLinear(rir, 0.20, 0.50)', () => {
  it('RIR 0.20 이하 → 100 (매우 여유)', () => {
    expect(affordabilityScore(0.20)).toBe(100);
    expect(affordabilityScore(0.10)).toBe(100);
  });
  it('RIR 0.50 이상 → 0 (주거 빈곤선)', () => {
    expect(affordabilityScore(0.50)).toBe(0);
    expect(affordabilityScore(0.60)).toBe(0);
  });
  it('RIR 0.35 → 50 (구간 중앙)', () => {
    expect(affordabilityScore(0.35)).toBe(50);
  });
  it('RIR 0.302 → 66 (주석 예시 강남)', () => {
    expect(affordabilityScore(0.302)).toBe(66);
  });
});

/* ─── 안전 / 생활 (클램프) ─────────────────────────────────────── */
describe('safetyScore / lifeScore 클램프', () => {
  it('0~100 범위로 클램프 + 반올림', () => {
    expect(safetyScore(50)).toBe(50);
    expect(safetyScore(120)).toBe(100);
    expect(safetyScore(-5)).toBe(0);
    expect(safetyScore(73.6)).toBe(74);
    expect(lifeScore(70)).toBe(70);
    expect(lifeScore(101)).toBe(100);
  });
});

/* ─── scoreRegion 통합 ─────────────────────────────────────────── */
const baseMetrics: RegionMetrics = {
  legalDongCode: '1168010100',
  displayName: '역삼동',
  sigunguCode: '11680',
  sigungu: '강남구',
  dong: '역삼동',
  lat: 37.5,
  lng: 127.03,
  commuteMinutes: 30,
  representativePrice: 50000,
  expectedReturn3y: 0,
  safetyBase: 80,
  lifeScoreBase: 70,
  transitScore: null,
  lhComplexNearby: 0,
  complexCount: 10,
  rentMonthlyCost: null,
  rentSampleCount: null,
  rentDepositManwon: null,
  rentPureMonthlyManwon: null,
  safetyIsEstimated: false,
  lifeIsEstimated: false,
};
const evenWeights: Weights = { commute: 25, affordability: 25, safety: 25, life: 25 };

describe('scoreRegion — 4축 모두 실데이터', () => {
  const r = scoreRegion(baseMetrics, evenWeights, 60, 403);

  it('각 축 점수가 명세대로 산출된다', () => {
    expect(r.commuteScore).toBe(50); // inverseLinear(30,0,60)
    expect(r.affordabilityScore).toBe(66); // sale-proxy RIR 0.302 → 66
    expect(r.safetyScore).toBe(80);
    expect(r.lifeScore).toBe(70);
  });
  it('총점 = 가중평균 (50+66+80+70)/4 = 66.5 → 67', () => {
    expect(r.totalScore).toBe(67);
  });
  it('rentMonthlyCost 없으면 sale-proxy 근거', () => {
    expect(r.affordabilityBasis).toBe('sale-proxy');
  });
  it('추정 축 없음 → estimatedAxes 비고, 분모 100', () => {
    expect(r.estimatedAxes).toEqual([]);
    expect(r.effectiveWeightSum).toBe(100);
  });
});

describe('scoreRegion — 동적 가중치 제외 (핵심 설계)', () => {
  it('안전·생활이 추정(더미)이면 총점 분모에서 빠진다', () => {
    const m: RegionMetrics = {
      ...baseMetrics,
      safetyBase: 50,
      lifeScoreBase: 50,
      safetyIsEstimated: true,
      lifeIsEstimated: true,
    };
    const r = scoreRegion(m, evenWeights, 60, 403);
    // 활성 축 = commute(50), affordability(66). (50*25+66*25)/50 = 58
    expect(r.totalScore).toBe(58);
    expect(r.estimatedAxes).toEqual(['safety', 'life']);
    expect(r.effectiveWeightSum).toBe(50);
  });

  it('estimatedAxes 순서는 commute→affordability→safety→life 순', () => {
    const m: RegionMetrics = { ...baseMetrics, lifeIsEstimated: true };
    const r = scoreRegion(m, evenWeights, 60, 403);
    expect(r.estimatedAxes).toEqual(['life']); // safety 는 실데이터라 제외 X
  });

  it('활성 가중치 합이 0 이면 방어적으로 총점 0 (divide-by-zero 금지)', () => {
    const m: RegionMetrics = {
      ...baseMetrics,
      safetyIsEstimated: true,
      lifeIsEstimated: true,
    };
    const w: Weights = { commute: 0, affordability: 0, safety: 50, life: 50 };
    const r = scoreRegion(m, w, 60, 403);
    expect(Number.isFinite(r.totalScore)).toBe(true);
    expect(r.totalScore).toBe(0);
  });
});

describe('scoreRegion — 실거래 전월세(rent) + 저표본 신뢰 보정', () => {
  const rentBase: RegionMetrics = {
    ...baseMetrics,
    rentMonthlyCost: 100, // 월 100만원 (RIR 분자)
  };

  it('rentMonthlyCost 있으면 rent 근거 + RIR 100/403=0.248 → affordability 84(무보정)', () => {
    const m: RegionMetrics = { ...rentBase, rentSampleCount: 10 }; // 10건 → 무보정
    const r = scoreRegion(m, evenWeights, 60, 403);
    expect(r.affordabilityBasis).toBe('rent');
    expect(r.affordabilityScore).toBe(84); // round((0.5-0.248)/0.3*100)=84
  });

  it('표본 5건 → 신뢰계수 0.94 → 84*0.94 = 79', () => {
    const m: RegionMetrics = { ...rentBase, rentSampleCount: 5 };
    const r = scoreRegion(m, evenWeights, 60, 403);
    expect(r.affordabilityScore).toBe(79);
  });

  it('표본 9건 → 계수 0.988 → 84*0.988 = 83', () => {
    const m: RegionMetrics = { ...rentBase, rentSampleCount: 9 };
    const r = scoreRegion(m, evenWeights, 60, 403);
    expect(r.affordabilityScore).toBe(83);
  });

  it('표본 10건 이상은 보정 없음 (9건 83 < 10건 84, 단조성 확인)', () => {
    const nine = scoreRegion({ ...rentBase, rentSampleCount: 9 }, evenWeights, 60, 403);
    const ten = scoreRegion({ ...rentBase, rentSampleCount: 10 }, evenWeights, 60, 403);
    expect(ten.affordabilityScore).toBeGreaterThanOrEqual(nine.affordabilityScore);
  });
});

/* ─── pickTopRegions 정렬/슬라이스 ─────────────────────────────── */
describe('pickTopRegions', () => {
  it('총점 내림차순 정렬 후 상위 K 만 반환', () => {
    const cheap: RegionMetrics = { ...baseMetrics, representativePrice: 20000 }; // 저가 → affordability↑
    const expensive: RegionMetrics = { ...baseMetrics, representativePrice: 90000 }; // 고가 → affordability↓
    const far: RegionMetrics = { ...baseMetrics, commuteMinutes: 55 }; // 통근↓
    const top = pickTopRegions([expensive, far, cheap], evenWeights, 60, 2, 403);
    expect(top).toHaveLength(2);
    // 가장 저렴(=총점 최상위)이 1등
    expect(top[0].representativePrice).toBe(20000);
    // 내림차순 보장
    expect(top[0].totalScore).toBeGreaterThanOrEqual(top[1].totalScore);
  });

  it('동점 시 commuteScore 높은 쪽 우선 (tie-break)', () => {
    // affordability 만 가중(commute weight 0) → 두 동 총점 동일, commuteScore 로만 갈림
    const w: Weights = { commute: 0, affordability: 100, safety: 0, life: 0 };
    const near: RegionMetrics = { ...baseMetrics, commuteMinutes: 10 }; // cs 83
    const far: RegionMetrics = { ...baseMetrics, commuteMinutes: 50 }; // cs 17
    const top = pickTopRegions([far, near], w, 60, 2, 403);
    expect(top[0].totalScore).toBe(top[1].totalScore); // 동점 확인
    expect(top[0].commuteMinutes).toBe(10); // 통근 가까운 쪽이 앞
  });

  it('K 가 후보 수보다 크면 전체 반환', () => {
    const top = pickTopRegions([baseMetrics], evenWeights, 60, 8, 403);
    expect(top).toHaveLength(1);
  });
});
