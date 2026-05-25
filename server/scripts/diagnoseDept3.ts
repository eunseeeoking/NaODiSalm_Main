/**
 * Depth 3 실데이터 진단 스크립트
 *
 *  실행: cd server && npm run diagnose:depth3
 *
 *  체크 항목:
 *    1) t_legal_dong — BJD 코드 적재 여부 (seed:bjd 실행 확인)
 *    2) t_apt_complex — 총 건수 + lat/lng null 비율
 *    3) 샘플 지역 3곳 (대치동·당산동·방배동) 매칭 결과
 *    4) 처방전 출력 — 무엇을 실행해야 하는지
 */
import { prisma } from '../src/services/db';

const SAMPLE_CODES = [
  { code: '1168010600', label: '강남구 대치동',   sigungu: '11680', dong: '대치동' },
  { code: '1156013000', label: '영등포구 당산동', sigungu: '11560', dong: '당산동' },
  { code: '1165010300', label: '서초구 방배동',   sigungu: '11650', dong: '방배동' },
];

async function main() {
  console.log('\n🔍 Depth 3 실데이터 진단 시작\n');
  console.log('='.repeat(60));

  // 1) t_legal_dong
  const legalDongTotal = await prisma.legalDong.count();
  const seoulDongs = await prisma.legalDong.count({
    where: { code: { startsWith: '11' }, dong: { not: null } },
  });
  console.log('\n[1] t_legal_dong');
  console.log(`    전체: ${legalDongTotal}건`);
  console.log(`    서울 법정동(11…): ${seoulDongs}건`);
  if (seoulDongs < 100) {
    console.log('    ⚠️  서울 법정동이 너무 적습니다 → npm run seed:bjd 실행 필요');
  } else {
    console.log('    ✅ seed:bjd 완료 상태');
  }

  // 2) t_apt_complex
  const totalComplex = await prisma.aptComplex.count();
  const geocodedComplex = await prisma.aptComplex.count({
    where: { lat: { not: null } },
  });
  const nullLatComplex = totalComplex - geocodedComplex;
  const geocodeRatio = totalComplex > 0
    ? Math.round((geocodedComplex / totalComplex) * 100)
    : 0;

  console.log('\n[2] t_apt_complex');
  console.log(`    전체: ${totalComplex.toLocaleString()}건`);
  console.log(`    지오코딩 완료(lat ≠ null): ${geocodedComplex.toLocaleString()}건 (${geocodeRatio}%)`);
  console.log(`    지오코딩 미완료(lat = null): ${nullLatComplex.toLocaleString()}건`);
  if (geocodedComplex === 0) {
    console.log('    ⚠️  지오코딩이 전혀 안 됐습니다 → POST /api/admin/geocode 실행 필요');
    console.log('         curl -X POST http://localhost:4000/api/admin/geocode \\');
    console.log('              -H "X-Admin-Token: $ADMIN_TOKEN" \\');
    console.log('              -H "Content-Type: application/json" \\');
    console.log('              -d \'{"maxCount": 200}\'');
    console.log('         (반복 실행 — maxCount씩 처리, Kakao API 필요)');
  } else if (geocodeRatio < 30) {
    console.log('    ⚠️  지오코딩 비율이 낮습니다 → POST /api/admin/geocode 추가 실행 권장');
  } else {
    console.log('    ✅ 지오코딩 어느 정도 완료');
    console.log('    ℹ️  단지 카드는 lat=0 단지도 표시됨 (지도 핀만 생략)');
  }

  // 3) 샘플 지역 매칭 테스트
  console.log('\n[3] 샘플 지역 매칭 테스트');
  for (const s of SAMPLE_CODES) {
    const dongRow = await prisma.legalDong.findFirst({
      where: { code: s.code, dong: { not: null } },
      select: { dong: true },
    });

    if (!dongRow) {
      console.log(`    ❌ ${s.label} (${s.code}) → t_legal_dong 없음 → seed:bjd 필요`);
      continue;
    }

    const dongName = dongRow.dong!;
    const complexCount = await prisma.aptComplex.count({
      where: { sigunguCode: s.sigungu, legalDong: dongName },
    });
    const withTrade = await prisma.$queryRaw<[{ cnt: bigint }]>`
      SELECT COUNT(DISTINCT c.id) AS cnt
      FROM t_apt_complex c
      JOIN t_apt_trade t ON t.complex_id = c.id
      WHERE c.sigungu_code = ${s.sigungu}
        AND c.legal_dong = ${dongName}
    `;
    const tradeCount = Number(withTrade[0]?.cnt ?? 0);

    const status = complexCount > 0 && tradeCount > 0 ? '✅' : complexCount > 0 ? '⚠️ ' : '❌';
    console.log(
      `    ${status} ${s.label} → t_legal_dong.dong="${dongName}", ` +
      `complexes=${complexCount}, 거래있는단지=${tradeCount}`,
    );

    if (complexCount > 0 && tradeCount === 0) {
      console.log(`       ⚠️  단지는 있지만 t_apt_trade 거래 없음 → ingest:apt:bulk 실행 필요`);
    }
    if (complexCount === 0) {
      console.log(`       ℹ️  t_apt_complex.legal_dong 샘플:`);
      const samples = await prisma.aptComplex.findMany({
        where: { sigunguCode: s.sigungu },
        select: { legalDong: true },
        take: 3,
        distinct: ['legalDong'],
      });
      samples.forEach((r) =>
        console.log(`            "${r.legalDong}" (실제 저장값)`),
      );
      console.log(`            vs t_legal_dong.dong = "${dongName}" (BJD 기준)`);
    }
  }

  // 4) 처방전
  console.log('\n' + '='.repeat(60));
  console.log('📋 처방전 (순서대로 실행)\n');

  if (seoulDongs < 100) {
    console.log('  1. npm run seed:bjd           ← t_legal_dong 법정동 코드 시드');
  }
  if (totalComplex === 0) {
    console.log('  2. npm run ingest:apt:bulk    ← t_apt_complex + t_apt_trade 수집');
    console.log('     (BULK_START_YM=202001 BULK_END_YM=202504 BULK_SIGUNGU_FILTER=11)');
  }
  if (geocodedComplex === 0 && totalComplex > 0) {
    console.log('  3. POST /api/admin/geocode    ← 지도 핀용 좌표 채우기 (Kakao API 필요)');
    console.log('     (없어도 단지 카드 목록은 표시됨 — 지도 핀만 생략)');
  }
  if (seoulDongs >= 100 && totalComplex > 0) {
    console.log('  ✅ 기본 세팅 완료 — 서버 재시작 후 Depth 3 실 데이터 확인!');
  }

  console.log('');
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error('진단 실패:', e.message);
  await prisma.$disconnect();
  process.exit(1);
});
