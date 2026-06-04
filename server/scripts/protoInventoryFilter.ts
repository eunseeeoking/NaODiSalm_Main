/**
 * 프로토타입 — 예산 필터를 [동 중위값 게이트] → [재고(inventory) 게이트] 로 교체.
 *
 *  현행(OLD): 동 보증금 *중위값* > 예산 → 동 통째 제외 (감당 가능한 매물 존재해도 묻힘)
 *  개선(NEW): 동에 *예산 이하 실거래 ≥ N건* 이면 후보 유지 + 그 '감당 가능 구간' 시세로 평가
 *
 *  검증 시나리오: 하남 직장 + 1억 전세 (개발자 본인 실제 이사 스토리)
 *  실행: cd server && npx tsx scripts/protoInventoryFilter.ts
 */
import 'dotenv/config';
import { Prisma } from '@prisma/client';
import { prisma } from '../src/services/db';
import { fetchRegionCandidates } from '../src/services/repositories/recommendationRepository';
import {
  scoreRegion,
  JEONSE_TO_MONTHLY_RATE,
  type Weights,
  type RegionCandidate,
} from '../src/services/recommendation/scoring';

const RATE = JEONSE_TO_MONTHLY_RATE;
const BUDGET = 10000; // 1억 전세 보증금 상한
const MIN_INVENTORY = 5; // NEW 게이트: 예산 이하 실거래 최소 건수
const weights: Weights = { commute: 40, affordability: 35, safety: 15, life: 10 };
const patience = 40;
const income = 320;
const workplace = { lat: 37.5392, lng: 127.2148, label: '하남시청 인근' };

/** 후보 동들의 [예산 이하 실거래 건수 + 감당 가능 구간 평균 보증금] 한 방 조회 (4종 풀링). */
async function fetchAffordableSegment(cands: RegionCandidate[]) {
  const tuples = Prisma.join(
    cands.map((c) => Prisma.sql`(${c.sigunguCode}, ${c.dong})`),
    ', ',
  );
  const src = (ctable: string, rtable: string) => Prisma.sql`
    SELECT c.sigungu_code sc, c.legal_dong ld, r.deposit_manwon dep
    FROM ${Prisma.raw(ctable)} c STRAIGHT_JOIN ${Prisma.raw(rtable)} r ON r.complex_id = c.id
    WHERE (c.sigungu_code, c.legal_dong) IN (${tuples})
      AND r.contract_type='JEONSE' AND r.deposit_manwon > 0
      AND r.area_m2 BETWEEN 9 AND 330
      AND r.contract_date >= DATE_SUB(CURDATE(), INTERVAL 18 MONTH)`;
  const pooled = Prisma.join(
    [
      src('t_apt_complex', 't_apt_rent'),
      src('t_offi_complex', 't_offi_rent'),
      src('t_villa_complex', 't_villa_rent'),
      src('t_sh_complex', 't_sh_rent'),
    ],
    ' UNION ALL ',
  );
  type Row = { sc: string; ld: string; total_cnt: number; aff_cnt: number; aff_avg_dep: number | null };
  const rows = await prisma.$queryRaw<Row[]>(Prisma.sql`
    SELECT sc, ld,
      COUNT(*) AS total_cnt,
      SUM(CASE WHEN dep <= ${BUDGET} THEN 1 ELSE 0 END) AS aff_cnt,
      ROUND(AVG(CASE WHEN dep <= ${BUDGET} THEN dep END)) AS aff_avg_dep
    FROM ( ${pooled} ) p
    GROUP BY sc, ld
  `);
  const map = new Map<string, { affCnt: number; affAvgDep: number }>();
  for (const r of rows) {
    map.set(`${r.sc}|${r.ld}`, { affCnt: Number(r.aff_cnt), affAvgDep: Number(r.aff_avg_dep ?? 0) });
  }
  return map;
}

function printTop(title: string, scored: ReturnType<typeof scoreRegion>[]) {
  console.log('\n' + '─'.repeat(80));
  console.log(title);
  console.log('순위  지역                     총점  통근분  통근  주거비  안전  생활   대표보증금');
  scored.slice(0, 8).forEach((r, i) => {
    const name = `${r.sigungu} ${r.dong}`.padEnd(22).slice(0, 22);
    const dep = r.rentDepositManwon != null ? `${(r.rentDepositManwon / 10000).toFixed(2)}억` : '-';
    const hanam = r.sigungu.includes('하남') ? '   ← 하남!' : '';
    console.log(
      `${String(i + 1).padStart(2)}.  ${name}  ${String(r.totalScore).padStart(3)}   ${String(r.commuteMinutes).padStart(3)}분  ${String(r.commuteScore).padStart(3)}  ${String(r.affordabilityScore).padStart(4)}  ${String(r.safetyScore).padStart(3)}  ${String(r.lifeScore).padStart(3)}  ${dep.padStart(7)}${hanam}`,
    );
  });
  console.log(`🏠 TOP 8 중 하남: ${scored.slice(0, 8).filter((r) => r.sigungu.includes('하남')).length}개`);
}

(async () => {
  try {
    // 예산 없이 하남 인근 후보 전체를 가져온다(통근·안전·생활·중위보증금 포함). 게이트만 스크립트에서 적용.
    const { candidates } = await fetchRegionCandidates(workplace, patience, { dealType: 'JEONSE' });
    const seg = await fetchAffordableSegment(candidates);

    // OLD: 중위 보증금 ≤ 예산 인 동만. (rentDepositManwon = 동 중위 보증금)
    const oldScored = candidates
      .filter((c) => c.rentDepositManwon != null && c.rentDepositManwon <= BUDGET)
      .map((c) => scoreRegion(c, weights, patience, income))
      .sort((a, b) => b.totalScore - a.totalScore || b.commuteScore - a.commuteScore);

    // NEW: 예산 이하 실거래 ≥ MIN_INVENTORY 인 동. 감당 가능 구간 평균 보증금으로 affordability 재산출.
    const newScored = candidates
      .map((c) => {
        const s = seg.get(`${c.sigunguCode}|${c.dong}`);
        if (!s || s.affCnt < MIN_INVENTORY || s.affAvgDep <= 0) return null;
        const cost = Math.round(s.affAvgDep * RATE * 100) / 100; // 감당 구간 월환산
        const m: RegionCandidate = {
          ...c,
          rentMonthlyCost: cost,
          rentDepositManwon: s.affAvgDep,
          rentSampleCount: s.affCnt,
        };
        return scoreRegion(m, weights, patience, income);
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .sort((a, b) => b.totalScore - a.totalScore || b.commuteScore - a.commuteScore);

    console.log('='.repeat(80));
    console.log(`📍 하남 직장 · 1억 전세 — 예산 필터 OLD(중위값) vs NEW(재고) 비교`);
    console.log(`   인근 후보 ${candidates.length}개 | 예산 ${BUDGET / 10000}억 | 재고 게이트 ≥${MIN_INVENTORY}건`);
    printTop('❌ OLD — 동 중위값 게이트', oldScored);
    printTop('✅ NEW — 재고 게이트(예산 이하 실거래 ≥5건, 감당구간 시세)', newScored);

    // 하남 동들이 NEW 에서 어떤 재고를 갖는지 근거 출력
    console.log('\n' + '─'.repeat(80));
    console.log('🔎 하남 동별 1억 이하 전세 재고 (근거)');
    for (const c of candidates.filter((c) => c.sigungu.includes('하남'))) {
      const s = seg.get(`${c.sigunguCode}|${c.dong}`);
      if (!s) continue;
      console.log(
        `  ${(c.sigungu + ' ' + c.dong).padEnd(16)} 1억이하 ${String(s.affCnt).padStart(3)}건  감당구간평균 ${(s.affAvgDep / 10000).toFixed(2)}억  (동중위 ${c.rentDepositManwon != null ? (c.rentDepositManwon / 10000).toFixed(2) + '억' : '-'})`,
      );
    }
  } catch (e) {
    console.error('FAIL:', e);
  } finally {
    await prisma.$disconnect();
  }
})();
