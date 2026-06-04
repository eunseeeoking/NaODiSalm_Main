/**
 * 실제 사용자(개발자 본인) 인생 스토리 재현 검증.
 *  인천→하남 출퇴근 중 동료 입소문("하남 1억 전세면 살 수 있다")으로 하남 이사.
 *  → 직장=하남, 예산 1억 전세일 때 서비스가 '하남 거주'를 추천하는가?
 *
 *  실행: cd server && npx tsx scripts/sanityRealStory.ts
 */
import 'dotenv/config';
import { fetchRegionCandidates } from '../src/services/repositories/recommendationRepository';
import { pickTopRegions } from '../src/services/recommendation/scoring';
import { prisma } from '../src/services/db';

(async () => {
  try {
    const workplace = { lat: 37.5392, lng: 127.2148, label: '하남시청 인근(직장)' };
    const weights = { commute: 40, affordability: 35, safety: 15, life: 10 };
    const patience = 40;
    const income = 320;

    // 두 가지 매물종류 가정으로 비교:
    //  A) 전체 4종 풀링(기본) — 아파트 전세 중위값이 동을 끌어올려 하남이 잘림
    //  B) 오피스텔만 — 실제 본인이 고른 매물종류
    const runs: { label: string; propertyTypes?: ('APT'|'OFFI'|'VILLA'|'SH')[] }[] = [
      { label: 'A) 전체 4종 풀링(기본)' },
      { label: 'B) 오피스텔(OFFI)만 — 실제 선택', propertyTypes: ['OFFI'] },
    ];

    for (const run of runs) {
      const { candidates, budgetFilteredCount } = await fetchRegionCandidates(
        workplace,
        patience,
        { dealType: 'JEONSE', budget: 10000, propertyTypes: run.propertyTypes },
      );
      const top = pickTopRegions(candidates, weights, patience, 8, income);

      console.log('\n' + '='.repeat(78));
      console.log(`📍 실제 스토리 재현 — 인천→하남 출퇴근자, 1억 전세  [${run.label}]`);
      console.log(`   직장=${workplace.label} | 통근40/주거비35/안전15/생활10 | 인내심 ${patience}분 | JEONSE | 예산 1.0억`);
      console.log(`   후보 ${candidates.length}개 · 예산(1억)초과 숨김 ${budgetFilteredCount}개`);
      console.log('-'.repeat(78));
      console.log('순위  지역                     총점  통근분  통근  주거비  안전  생활   전세환산');
      top.forEach((r, i) => {
        const name = `${r.sigungu} ${r.dong}`.padEnd(22).slice(0, 22);
        const price = r.rentMonthlyCost != null ? `월${Math.round(r.rentMonthlyCost)}만` : `${(r.representativePrice / 10000).toFixed(1)}억`;
        const isHanam = r.sigungu.includes('하남');
        console.log(
          `${String(i + 1).padStart(2)}.  ${name}  ${String(r.totalScore).padStart(3)}   ${String(r.commuteMinutes).padStart(3)}분  ${String(r.commuteScore).padStart(3)}  ${String(r.affordabilityScore).padStart(4)}  ${String(r.safetyScore).padStart(3)}  ${String(r.lifeScore).padStart(3)}  ${price}${isHanam ? '   ← 하남!' : ''}`,
        );
      });
      const hanamCount = top.filter((r) => r.sigungu.includes('하남')).length;
      console.log('-'.repeat(78));
      console.log(`🏠 TOP 8 중 하남 동네: ${hanamCount}개`);
    }
  } catch (e) {
    console.error('FAIL:', e);
  } finally {
    await prisma.$disconnect();
  }
})();
