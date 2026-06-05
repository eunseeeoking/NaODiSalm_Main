/**
 * 사람-직관 검증용 일회용 스크립트 (ODsay 미사용 — 캐시/Haversine 통근).
 *  실제 사회초년생이 직장을 입력하고 가중치를 잡았을 때
 *  추천 지역이 상식과 맞는지(예: 판교 직장 → 분당·수원·용인 등) 콘솔로 확인.
 *
 *  실행: cd server && npx tsx scripts/sanityRecommend.ts
 */
import 'dotenv/config';
import { fetchRegionCandidates } from '../src/services/repositories/recommendationRepository';
import { pickTopRegions, type Weights, type DealType } from '../src/services/recommendation/scoring';
import { prisma } from '../src/services/db';

interface Scenario {
  name: string;
  workplace: { lat: number; lng: number; label: string };
  weights: Weights;
  patience: number;
  dealType: DealType;
  budget?: number; // 만원 (보증금/매매가 상한)
  monthlyBudget?: number; // 만원/월 (MONTHLY 월세 한도) — ④ MONTHLY+월세한도 경로 검증용
  income?: number; // 만원/월
}

const scenarios: Scenario[] = [
  {
    name: '판교 이직 사회초년생 (전세, 통근·주거비 중시)',
    workplace: { lat: 37.3947, lng: 127.1112, label: '판교역' },
    weights: { commute: 35, affordability: 30, safety: 25, life: 10 },
    patience: 50,
    dealType: 'JEONSE',
    budget: 30000, // 전세 보증금 3억 상한
    income: 320, // 사회초년생 월 실수령 가정
  },
  {
    name: '강남 직장 1인가구 (월세, 안전 중시)',
    workplace: { lat: 37.4979, lng: 127.0276, label: '강남역' },
    weights: { commute: 30, affordability: 25, safety: 30, life: 15 },
    patience: 45,
    dealType: 'MONTHLY',
    income: 300,
  },
  {
    // ④ 검증: MONTHLY + 월세한도(monthlyBudget 유한) → fetchRentSummary 가 사전집계 우회 후
    //  live 폴백(보증금·월세 한도 SQL 술어)을 타는지. 한도 무시 버그면 비싼 동까지 다 떠오름.
    name: '강남 직장 1인가구 (월세, 보증금 5천·월세한도 70만)',
    workplace: { lat: 37.4979, lng: 127.0276, label: '강남역' },
    weights: { commute: 30, affordability: 30, safety: 25, life: 15 },
    patience: 45,
    dealType: 'MONTHLY',
    budget: 5000, // 보증금 5천만 상한
    monthlyBudget: 70, // 월세 70만/월 상한
    income: 300,
  },
  {
    name: '여의도 직장 (전세, 통근 최우선)',
    workplace: { lat: 37.5215, lng: 126.9242, label: '여의도역' },
    weights: { commute: 50, affordability: 25, safety: 15, life: 10 },
    patience: 40,
    dealType: 'JEONSE',
    budget: 35000,
    income: 380,
  },
];

async function run(s: Scenario) {
  const { candidates, budgetFilteredCount } = await fetchRegionCandidates(
    s.workplace,
    s.patience,
    { dealType: s.dealType, budget: s.budget, monthlyBudget: s.monthlyBudget },
  );
  const top = pickTopRegions(candidates, s.weights, s.patience, 8, s.income);

  console.log('\n' + '='.repeat(78));
  console.log(`📍 ${s.name}`);
  console.log(
    `   직장=${s.workplace.label} | 가중치 통근${s.weights.commute}/주거비${s.weights.affordability}/안전${s.weights.safety}/생활${s.weights.life}` +
      ` | 인내심 ${s.patience}분 | ${s.dealType}${s.budget ? ` | 예산 ${(s.budget / 10000).toFixed(1)}억` : ''}${s.monthlyBudget ? ` | 월세한도 ${s.monthlyBudget}만` : ''}`,
  );
  console.log(
    `   후보 ${candidates.length}개 · 예산초과 숨김 ${budgetFilteredCount}개`,
  );
  console.log('-'.repeat(78));
  console.log('순위  지역                     총점  통근분  통근  주거비  안전  생활   시세');
  top.forEach((r, i) => {
    const name = `${r.sigungu} ${r.dong}`.padEnd(22).slice(0, 22);
    const price =
      r.rentMonthlyCost != null
        ? `월${Math.round(r.rentMonthlyCost)}만`
        : `${(r.representativePrice / 10000).toFixed(1)}억`;
    console.log(
      `${String(i + 1).padStart(2)}.  ${name}  ` +
        `${String(r.totalScore).padStart(3)}   ` +
        `${String(r.commuteMinutes).padStart(3)}분  ` +
        `${String(r.commuteScore).padStart(3)}  ` +
        `${String(r.affordabilityScore).padStart(4)}  ` +
        `${String(r.safetyScore).padStart(3)}  ` +
        `${String(r.lifeScore).padStart(3)}  ` +
        `${price}` +
        (r.estimatedAxes.length ? `  [추정:${r.estimatedAxes.join(',')}]` : ''),
    );
  });
}

(async () => {
  try {
    for (const s of scenarios) await run(s);
  } catch (e) {
    console.error('FAIL:', e);
  } finally {
    await prisma.$disconnect();
  }
})();
