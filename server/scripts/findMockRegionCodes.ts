/**
 * mockRegions.ts 용 올바른 legalDongCode 조회 스크립트
 *
 *  실행: cd server && npx tsx scripts/findMockRegionCodes.ts
 *
 *  출력:
 *    - 각 mock region 의 sigunguCode + displayDong 에 해당하는
 *      t_legal_dong.code + t_apt_complex 단지 수
 *    - mockRegions.ts 에 바로 붙여넣을 수 있는 코드 스니펫
 *
 *  사용법:
 *    1. 스크립트 실행 결과 확인
 *    2. 단지 수가 많은 dong 의 code 를 mockRegions.ts 에 반영
 */
import { prisma } from '../src/services/db';

/** 현재 mockRegions.ts 에 있는 후보 목록 */
const MOCK_TARGETS = [
  { label: '영등포구 당산동',  sigunguCode: '11560', displayDong: '당산동' },
  { label: '강남구 대치동',    sigunguCode: '11680', displayDong: '대치동' },
  { label: '서초구 방배동',    sigunguCode: '11650', displayDong: '방배동' },
  { label: '서대문구 충정로',  sigunguCode: '11410', displayDong: '충정로' },
  { label: '양천구 목동',      sigunguCode: '11470', displayDong: '목동' },
  { label: '마포구 망원동',    sigunguCode: '11440', displayDong: '망원동' },
  { label: '용산구 한남동',    sigunguCode: '11170', displayDong: '한남동' },
  { label: '구로구 신도림동',  sigunguCode: '11530', displayDong: '신도림동' },
];

async function main() {
  console.log('\n🔍 mockRegions.ts 올바른 legalDongCode 탐색\n');
  console.log('='.repeat(70));

  const fixes: Array<{
    label: string;
    bestCode: string;
    bestDong: string;
    complexCount: number;
    currentCode?: string;
  }> = [];

  for (const target of MOCK_TARGETS) {
    console.log(`\n[${target.label}] sigunguCode=${target.sigunguCode}, 검색어="${target.displayDong}"`);

    // t_apt_complex 에서 해당 sigungu 의 도메인 이름 확인 (MOLIT 저장 형태)
    const complexGroups = await prisma.$queryRaw<{ legal_dong: string; cnt: bigint }[]>`
      SELECT legal_dong, COUNT(*) AS cnt
      FROM t_apt_complex
      WHERE sigungu_code = ${target.sigunguCode}
        AND legal_dong LIKE ${target.displayDong + '%'}
      GROUP BY legal_dong
      ORDER BY cnt DESC
      LIMIT 5
    `;

    if (complexGroups.length === 0) {
      console.log(`  ❌ t_apt_complex 에서 "${target.displayDong}*" 매칭 없음`);
      continue;
    }

    console.log(`  t_apt_complex 매칭 (MOLIT 저장 이름):`);
    for (const g of complexGroups) {
      console.log(`    "${g.legal_dong}" → ${g.cnt}개 단지`);
    }

    // 각 MOLIT dong name 에 대응하는 t_legal_dong.code 조회
    let bestCode = '';
    let bestDong = '';
    let bestCount = 0;

    for (const g of complexGroups) {
      const dongRow = await prisma.legalDong.findFirst({
        where: {
          sigungu: { contains: target.label.split(' ')[0] }, // 구 이름
          dong: g.legal_dong,
        },
        select: { code: true, dong: true, sigungu: true },
      });

      if (dongRow) {
        console.log(`    ✅ "${g.legal_dong}" → t_legal_dong.code = ${dongRow.code} (${dongRow.sigungu})`);
        if (Number(g.cnt) > bestCount) {
          bestCount = Number(g.cnt);
          bestCode = dongRow.code;
          bestDong = g.legal_dong;
        }
      } else {
        console.log(`    ⚠️  "${g.legal_dong}" → t_legal_dong 없음`);
      }
    }

    if (bestCode) {
      fixes.push({ label: target.label, bestCode, bestDong, complexCount: bestCount });
      console.log(`  → 권장 코드: ${bestCode} ("${bestDong}", ${bestCount}개 단지)`);
    }
  }

  // mockRegions.ts 패치 스니펫 출력
  console.log('\n' + '='.repeat(70));
  console.log('📋 mockRegions.ts 수정 스니펫\n');
  for (const f of fixes) {
    console.log(`  // ${f.label}: legalDongCode → '${f.bestCode}' (dong: '${f.bestDong}', ${f.complexCount}개 단지)`);
    console.log(`  legalDongCode: '${f.bestCode}',`);
    console.log(`  dong: '${f.bestDong}',`);
    console.log('');
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error('실패:', e.message);
  await prisma.$disconnect();
  process.exit(1);
});
