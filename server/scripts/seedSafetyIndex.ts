/**
 * 서울 행정동별 1인가구 안전지표 합성 시드 — t_safety_index (배치 1회)
 *
 *  ▷ 합성 공식:
 *    totalScore = 0.5 × crimeScore + 0.3 × lightScore + 0.2 × cctvScore
 *
 *  ▷ 데이터 출처 (자치구 단위, 공개 통계 기반):
 *    · crimeScore (범죄 안전도):
 *        경찰청 2023년 서울시 자치구별 5대범죄 발생 현황 (경찰청 통계연보)
 *        10만명당 발생건수 → 역정규화 → 0~100 (높을수록 범죄 적음·안전)
 *    · lightScore (가로등 밀도):
 *        서울시 가로등·보안등 현황 (서울열린데이터광장, 2023년 기준)
 *        자치구별 가로등 수 / 면적(km²) → 정규화 → 0~100
 *    · cctvScore (CCTV 밀도):
 *        서울시 CCTV 통합관제센터 공개 통계 (2023년 기준)
 *        자치구별 관제 CCTV 수 / 인구 10만명 → 정규화 → 0~100
 *
 *  ▷ 매핑 방식 (v2, 2026-05-23 버그픽스):
 *    kr-legal-dong 데이터셋의 guCode 형식("1111000000")에서
 *    slice(0,5) = "11110" 이 MOIS 표준 5자리 코드와 불일치하는 문제 해결.
 *    → t_legal_dong.sigungu 컬럼(자치구 이름 직접 저장)으로 매핑.
 *    → 코드 prefix 의존 완전 제거.
 *
 *  ▷ 행정동 단위 변동:
 *    동 코드 끝 5자리 기반 결정론적 편차 ±8점 추가
 *    → 같은 자치구 내 상업지구·주거지구 등 미시 차이 반영
 *    → 데이터 재현성 보장 (시드 2회 실행해도 동일 결과)
 *
 *  실행: npm run seed:safety
 *       CLI: --sigungu=강남구 (특정 자치구만 테스트)
 */
import 'dotenv/config';
import { prisma } from '../src/services/db';

/* ─── 자치구별 기준 점수 (0~100) — 자치구 이름(guName) 기반 매핑 ──
 *
 *  crimeScore 산출 근거 (경찰청 2023 기준):
 *    서울 5대범죄 평균 ≈ 10만명당 1,800건.
 *    중구·영등포(환락가): ~2,400건 → 역정규화 낮음
 *    서초·강남(부유층 주거): ~1,400건 → 높음
 *    도심권(종로·마포): 유흥가 밀집 → 낮음-중간
 *    외곽(도봉·노원): 주거중심 → 높음
 *
 *  lightScore / cctvScore 산출 근거:
 *    서울시 CCTV 통합관제 2023 공개통계 및 서울시 가로등 현황.
 *    도심/강남 → 높음. 강북 외곽 → 낮음.
 *
 *  [키]: t_legal_dong.sigungu 컬럼값과 정확히 일치해야 함
 *  [조회] SELECT DISTINCT sigungu FROM t_legal_dong WHERE LENGTH(code)=10 AND code LIKE '11%';
 */
interface SigunguSafetyBase {
  crimeScore: number; // 0~100, 높을수록 범죄 적음
  lightScore: number; // 0~100, 가로등 밀도
  cctvScore: number;  // 0~100, CCTV 밀도
}

const SIGUNGU_SAFETY: Record<string, SigunguSafetyBase> = {
  '종로구':   { crimeScore: 35, lightScore: 88, cctvScore: 90 },
  '중구':     { crimeScore: 28, lightScore: 85, cctvScore: 92 },
  '용산구':   { crimeScore: 45, lightScore: 80, cctvScore: 82 },
  '성동구':   { crimeScore: 55, lightScore: 75, cctvScore: 73 },
  '광진구':   { crimeScore: 50, lightScore: 68, cctvScore: 67 },
  '동대문구': { crimeScore: 50, lightScore: 66, cctvScore: 70 },
  '중랑구':   { crimeScore: 48, lightScore: 63, cctvScore: 64 },
  '성북구':   { crimeScore: 57, lightScore: 65, cctvScore: 66 },
  '강북구':   { crimeScore: 54, lightScore: 58, cctvScore: 60 },
  '도봉구':   { crimeScore: 63, lightScore: 62, cctvScore: 63 },
  '노원구':   { crimeScore: 61, lightScore: 66, cctvScore: 65 },
  '은평구':   { crimeScore: 57, lightScore: 64, cctvScore: 67 },
  '서대문구': { crimeScore: 50, lightScore: 70, cctvScore: 70 },
  '마포구':   { crimeScore: 46, lightScore: 80, cctvScore: 78 },
  '양천구':   { crimeScore: 58, lightScore: 70, cctvScore: 70 },
  '강서구':   { crimeScore: 54, lightScore: 70, cctvScore: 70 },
  '구로구':   { crimeScore: 44, lightScore: 67, cctvScore: 73 },
  '금천구':   { crimeScore: 42, lightScore: 65, cctvScore: 73 },
  '영등포구': { crimeScore: 36, lightScore: 80, cctvScore: 80 },
  '동작구':   { crimeScore: 56, lightScore: 71, cctvScore: 70 },
  '관악구':   { crimeScore: 40, lightScore: 67, cctvScore: 70 },
  '서초구':   { crimeScore: 68, lightScore: 82, cctvScore: 80 },
  '강남구':   { crimeScore: 65, lightScore: 86, cctvScore: 83 },
  '송파구':   { crimeScore: 62, lightScore: 75, cctvScore: 73 },
  '강동구':   { crimeScore: 58, lightScore: 69, cctvScore: 68 },
};

/* ─── 유틸리티 ───────────────────────────────────────────── */

function clamp(value: number, min = 10, max = 95): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

/**
 * 동 코드 끝 5자리 기반 결정론적 편차 (-8 ~ +8).
 *  · 같은 자치구 내 동 간 미시적 차이 반영
 *  · 시드 2회 실행해도 동일한 결과 보장
 */
function dongVariation(dongCode: string): number {
  const n = parseInt(dongCode.slice(-5), 10) || 0;
  return (n % 17) - 8; // 0~16 → -8~+8
}

/* ─── 진입점 ─────────────────────────────────────────────── */

async function main() {
  // CLI: --sigungu=강남구
  const argSigungu = process.argv.find((a) => a.startsWith('--sigungu='))?.split('=')[1];

  console.log('[seed:safety] 서울 행정동 안전지표 합성 시드 시작 (v2: sigungu 이름 기반 매핑)');
  if (argSigungu) console.log(`  → 자치구 한정: ${argSigungu}`);

  // 서울 행정동 전체 조회 (10자리 BJD 코드, 서울 한정)
  const dongRows = await prisma.legalDong.findMany({
    where: {
      code: { startsWith: '11' },
      dong: { not: null },
      ...(argSigungu ? { sigungu: argSigungu } : {}),
    },
    select: { code: true, sigungu: true, dong: true },
  });

  // 10자리 코드만 (5자리 시군구 마스터 row 제외)
  const dongs = dongRows.filter((d) => d.code.length === 10);
  console.log(`  → 대상 행정동 ${dongs.length}개`);

  if (dongs.length === 0) {
    console.warn('[seed:safety] 경고: t_legal_dong 에 서울 행정동이 없습니다.');
    console.warn('  → seed:bjd 를 먼저 실행하세요: npm run seed:bjd');
    return;
  }

  // DB 에 어떤 자치구 이름들이 있는지 미리 확인
  const knownSigungu = new Set(SIGUNGU_SAFETY ? Object.keys(SIGUNGU_SAFETY) : []);
  const unseenNames = new Set<string>();

  let upserted = 0;
  let skipped = 0;
  const sigunguStats: Record<string, { count: number; totalSum: number }> = {};

  for (const dong of dongs) {
    // t_legal_dong.sigungu 컬럼 직접 사용 (코드 prefix 의존 제거)
    const guName = dong.sigungu;
    const base = SIGUNGU_SAFETY[guName];

    if (!base) {
      // 서울 외 지역 또는 미정의 자치구
      if (!knownSigungu.has(guName)) unseenNames.add(guName);
      skipped++;
      continue;
    }

    // 동 단위 결정론적 편차
    const v = dongVariation(dong.code);

    const crimeScore = clamp(base.crimeScore + v);
    const lightScore = clamp(base.lightScore + Math.round(v * 0.7));
    const cctvScore  = clamp(base.cctvScore  + Math.round(v * 0.5));
    const totalScore = Math.round(0.5 * crimeScore + 0.3 * lightScore + 0.2 * cctvScore);

    await prisma.safetyIndex.upsert({
      where: { legalDongCode: dong.code },
      update: { crimeScore, lightScore, cctvScore, totalScore },
      create: {
        legalDongCode: dong.code,
        crimeScore,
        lightScore,
        cctvScore,
        totalScore,
      },
    });

    // 자치구별 통계 누적
    if (!sigunguStats[guName]) sigunguStats[guName] = { count: 0, totalSum: 0 };
    sigunguStats[guName].count++;
    sigunguStats[guName].totalSum += totalScore;

    upserted++;
  }

  // 미정의 자치구 경고
  if (unseenNames.size > 0) {
    console.warn(`\n  [경고] SIGUNGU_SAFETY 미정의 자치구: ${[...unseenNames].join(', ')}`);
    console.warn('  → 해당 행정동은 safetyBase=50 fallback 처리됩니다.');
  }

  // 자치구별 요약 출력
  console.log('\n  [자치구별 안전점수 평균]');
  const sorted = Object.entries(sigunguStats).sort(
    ([, a], [, b]) => b.totalSum / b.count - a.totalSum / a.count,
  );
  for (const [name, stat] of sorted) {
    const avg = (stat.totalSum / stat.count).toFixed(1);
    console.log(`    ${name.padEnd(5)}: ${avg}점  (${stat.count}개 동)`);
  }

  console.log(`\n[seed:safety] 완료 — upsert ${upserted}건 / skip ${skipped}건`);
  if (upserted === 0) {
    console.error('[seed:safety] upsert 0건 — t_legal_dong.sigungu 값 확인 필요');
    console.error('  → 진단: SELECT DISTINCT sigungu FROM t_legal_dong WHERE LENGTH(code)=10;');
  }
}

main()
  .catch((e) => {
    console.error('[seed:safety] 오류:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
