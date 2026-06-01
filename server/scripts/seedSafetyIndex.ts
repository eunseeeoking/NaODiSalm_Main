/**
 * 수도권(서울·인천·경기) 행정동별 1인가구 안전지표 합성 시드 — t_safety_index (배치 1회)
 *
 *  ▷ 합성 공식:
 *    totalScore = 0.5 × crimeScore + 0.3 × lightScore + 0.2 × cctvScore
 *
 *  ▷ 데이터 출처 (자치구 단위, 공개 통계 기반):
 *    · 서울: 경찰청/서울열린데이터광장 2023 실통계 기반.
 *    · 인천·경기: 실통계 부재 구간은 도시화도·신도시/공단/농촌 성격으로 동일 스케일 합성(SIGUNGU_SAFETY 주석).
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
 *  ▷ 매핑 방식 (v3, 2026-06-01 수도권 확장 + 동명 충돌 픽스):
 *    SIGUNGU_SAFETY 키를 **5자리 시군구 코드**로 전환(이전 v2 = 자치구 이름).
 *    → dong.code.slice(0,5) 로 매핑. 인천 중구(28110)↔서울 중구(11140) 등
 *      동명 자치구 점수 충돌·오매핑(KI-5/KI-17)을 구조적으로 차단.
 *
 *  ▷ 행정동 단위 변동:
 *    동 코드 끝 5자리 기반 결정론적 편차 ±8점 추가
 *    → 같은 자치구 내 상업지구·주거지구 등 미시 차이 반영
 *    → 데이터 재현성 보장 (시드 2회 실행해도 동일 결과)
 *
 *  실행: npm run seed:safety
 *       CLI: --sigungu=강남구 (이름) 또는 --sigungu=11680 (5자리 코드)
 */
import 'dotenv/config';
import { prisma } from '../src/services/db';

/* ─── 자치구별 기준 점수 (0~100) — 5자리 시군구 코드 기반 매핑 ──
 *
 *  ▷ 키 = LAWD_CD 5자리(시군구 코드). 이전 버전은 자치구 이름(`'중구'`)을 키로 썼으나
 *    수도권 확장 시 **인천 중구(28110) ↔ 서울 중구(11140)** 등 동명 자치구가 충돌해
 *    잘못된 점수가 매핑되던 버그(KI-5/KI-17)를 코드 키로 구조적으로 차단.
 *    매핑도 `dong.sigungu`(이름) → `dong.code.slice(0,5)`(코드)로 전환.
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
 *  ▷ 인천·경기(2026-06-01 신규): 경찰청 자치구별 실통계 부재 구간은 도시화도·신도시 여부·
 *    공단/구도심/농촌 성격으로 서울 기준과 동일 스케일로 **합성**(상대 서열 위주, ±8 동 편차 동반).
 *    추후 경찰청/지자체 실 API 확보 시 교체. (강화·옹진·연천·가평 등 농촌·도서는 범죄는 적으나
 *    가로등·CCTV 인프라가 낮은 특성 반영.)
 *
 *  [키]: CAPITAL_AREA_LAWD_CODES(capitalAreaLawdCodes.generated.ts)의 code 와 일치.
 *  [조회] SELECT DISTINCT SUBSTRING(code,1,5), sigungu FROM t_legal_dong WHERE LENGTH(code)=10;
 */
interface SigunguSafetyBase {
  name: string;       // 표시용 자치구명 (콘솔 요약·진단)
  crimeScore: number; // 0~100, 높을수록 범죄 적음
  lightScore: number; // 0~100, 가로등 밀도
  cctvScore: number;  // 0~100, CCTV 밀도
}

const SIGUNGU_SAFETY: Record<string, SigunguSafetyBase> = {
  /* ── 서울특별시 (경찰청 2023 기반) ── */
  '11110': { name: '종로구',   crimeScore: 35, lightScore: 88, cctvScore: 90 },
  '11140': { name: '중구',     crimeScore: 28, lightScore: 85, cctvScore: 92 },
  '11170': { name: '용산구',   crimeScore: 45, lightScore: 80, cctvScore: 82 },
  '11200': { name: '성동구',   crimeScore: 55, lightScore: 75, cctvScore: 73 },
  '11215': { name: '광진구',   crimeScore: 50, lightScore: 68, cctvScore: 67 },
  '11230': { name: '동대문구', crimeScore: 50, lightScore: 66, cctvScore: 70 },
  '11260': { name: '중랑구',   crimeScore: 48, lightScore: 63, cctvScore: 64 },
  '11290': { name: '성북구',   crimeScore: 57, lightScore: 65, cctvScore: 66 },
  '11305': { name: '강북구',   crimeScore: 54, lightScore: 58, cctvScore: 60 },
  '11320': { name: '도봉구',   crimeScore: 63, lightScore: 62, cctvScore: 63 },
  '11350': { name: '노원구',   crimeScore: 61, lightScore: 66, cctvScore: 65 },
  '11380': { name: '은평구',   crimeScore: 57, lightScore: 64, cctvScore: 67 },
  '11410': { name: '서대문구', crimeScore: 50, lightScore: 70, cctvScore: 70 },
  '11440': { name: '마포구',   crimeScore: 46, lightScore: 80, cctvScore: 78 },
  '11470': { name: '양천구',   crimeScore: 58, lightScore: 70, cctvScore: 70 },
  '11500': { name: '강서구',   crimeScore: 54, lightScore: 70, cctvScore: 70 },
  '11530': { name: '구로구',   crimeScore: 44, lightScore: 67, cctvScore: 73 },
  '11545': { name: '금천구',   crimeScore: 42, lightScore: 65, cctvScore: 73 },
  '11560': { name: '영등포구', crimeScore: 36, lightScore: 80, cctvScore: 80 },
  '11590': { name: '동작구',   crimeScore: 56, lightScore: 71, cctvScore: 70 },
  '11620': { name: '관악구',   crimeScore: 40, lightScore: 67, cctvScore: 70 },
  '11650': { name: '서초구',   crimeScore: 68, lightScore: 82, cctvScore: 80 },
  '11680': { name: '강남구',   crimeScore: 65, lightScore: 86, cctvScore: 83 },
  '11710': { name: '송파구',   crimeScore: 62, lightScore: 75, cctvScore: 73 },
  '11740': { name: '강동구',   crimeScore: 58, lightScore: 69, cctvScore: 68 },

  /* ── 인천광역시 (합성) ── */
  '28110': { name: '중구',     crimeScore: 42, lightScore: 68, cctvScore: 72 }, // 구도심·항만·공항
  '28140': { name: '동구',     crimeScore: 48, lightScore: 60, cctvScore: 62 }, // 노후 구도심
  '28177': { name: '미추홀구', crimeScore: 44, lightScore: 64, cctvScore: 66 }, // 구 남구, 주택밀집
  '28185': { name: '연수구',   crimeScore: 64, lightScore: 80, cctvScore: 80 }, // 송도 신도시
  '28200': { name: '남동구',   crimeScore: 52, lightScore: 70, cctvScore: 72 }, // 시청권
  '28237': { name: '부평구',   crimeScore: 45, lightScore: 70, cctvScore: 72 }, // 상업·유흥 밀집
  '28245': { name: '계양구',   crimeScore: 55, lightScore: 65, cctvScore: 66 }, // 주거
  '28260': { name: '서구',     crimeScore: 50, lightScore: 68, cctvScore: 70 }, // 청라·검단 + 공단 혼재
  '28710': { name: '강화군',   crimeScore: 66, lightScore: 45, cctvScore: 40 }, // 농촌·인프라 낮음
  '28720': { name: '옹진군',   crimeScore: 70, lightScore: 35, cctvScore: 30 }, // 도서·인프라 매우 낮음

  /* ── 경기도 (합성) ── */
  '41111': { name: '수원시장안구',   crimeScore: 54, lightScore: 68, cctvScore: 68 },
  '41113': { name: '수원시권선구',   crimeScore: 52, lightScore: 66, cctvScore: 66 },
  '41115': { name: '수원시팔달구',   crimeScore: 46, lightScore: 70, cctvScore: 72 }, // 구도심·유흥
  '41117': { name: '수원시영통구',   crimeScore: 64, lightScore: 78, cctvScore: 78 }, // 광교·영통 신도시
  '41131': { name: '성남시수정구',   crimeScore: 52, lightScore: 66, cctvScore: 66 },
  '41133': { name: '성남시중원구',   crimeScore: 52, lightScore: 66, cctvScore: 66 },
  '41135': { name: '성남시분당구',   crimeScore: 70, lightScore: 85, cctvScore: 82 }, // 분당 신도시
  '41150': { name: '의정부시',       crimeScore: 50, lightScore: 66, cctvScore: 66 },
  '41171': { name: '안양시만안구',   crimeScore: 52, lightScore: 66, cctvScore: 66 },
  '41173': { name: '안양시동안구',   crimeScore: 60, lightScore: 74, cctvScore: 74 }, // 평촌 신도시
  '41192': { name: '부천시원미구',   crimeScore: 48, lightScore: 68, cctvScore: 70 },
  '41194': { name: '부천시소사구',   crimeScore: 50, lightScore: 64, cctvScore: 64 },
  '41196': { name: '부천시오정구',   crimeScore: 50, lightScore: 63, cctvScore: 63 },
  '41210': { name: '광명시',         crimeScore: 56, lightScore: 70, cctvScore: 70 },
  '41220': { name: '평택시',         crimeScore: 50, lightScore: 62, cctvScore: 62 }, // 공단·미군
  '41250': { name: '동두천시',       crimeScore: 50, lightScore: 55, cctvScore: 55 }, // 외곽·미군
  '41271': { name: '안산시상록구',   crimeScore: 50, lightScore: 64, cctvScore: 64 },
  '41273': { name: '안산시단원구',   crimeScore: 46, lightScore: 64, cctvScore: 66 }, // 공단 밀집
  '41281': { name: '고양시덕양구',   crimeScore: 56, lightScore: 68, cctvScore: 68 },
  '41285': { name: '고양시일산동구', crimeScore: 64, lightScore: 78, cctvScore: 78 }, // 일산 신도시
  '41287': { name: '고양시일산서구', crimeScore: 64, lightScore: 78, cctvScore: 78 }, // 일산 신도시
  '41290': { name: '과천시',         crimeScore: 72, lightScore: 82, cctvScore: 80 }, // 부유 소도시
  '41310': { name: '구리시',         crimeScore: 56, lightScore: 70, cctvScore: 70 },
  '41360': { name: '남양주시',       crimeScore: 56, lightScore: 64, cctvScore: 64 }, // 외곽 확장
  '41370': { name: '오산시',         crimeScore: 52, lightScore: 62, cctvScore: 62 },
  '41390': { name: '시흥시',         crimeScore: 50, lightScore: 62, cctvScore: 62 }, // 공단
  '41410': { name: '군포시',         crimeScore: 58, lightScore: 70, cctvScore: 70 }, // 산본 신도시
  '41430': { name: '의왕시',         crimeScore: 60, lightScore: 70, cctvScore: 70 },
  '41450': { name: '하남시',         crimeScore: 60, lightScore: 74, cctvScore: 74 }, // 미사 신도시
  '41461': { name: '용인시처인구',   crimeScore: 56, lightScore: 62, cctvScore: 62 }, // 외곽
  '41463': { name: '용인시기흥구',   crimeScore: 62, lightScore: 76, cctvScore: 76 }, // 신도시
  '41465': { name: '용인시수지구',   crimeScore: 66, lightScore: 80, cctvScore: 80 }, // 수지 신도시
  '41480': { name: '파주시',         crimeScore: 54, lightScore: 60, cctvScore: 60 }, // 운정 + 외곽
  '41500': { name: '이천시',         crimeScore: 56, lightScore: 58, cctvScore: 58 },
  '41550': { name: '안성시',         crimeScore: 56, lightScore: 56, cctvScore: 56 },
  '41570': { name: '김포시',         crimeScore: 56, lightScore: 64, cctvScore: 64 }, // 한강 신도시
  '41591': { name: '화성시만세구',   crimeScore: 56, lightScore: 60, cctvScore: 60 },
  '41593': { name: '화성시효행구',   crimeScore: 56, lightScore: 60, cctvScore: 60 },
  '41595': { name: '화성시병점구',   crimeScore: 56, lightScore: 64, cctvScore: 64 },
  '41597': { name: '화성시동탄구',   crimeScore: 66, lightScore: 80, cctvScore: 80 }, // 동탄 신도시
  '41610': { name: '광주시',         crimeScore: 56, lightScore: 60, cctvScore: 60 },
  '41630': { name: '양주시',         crimeScore: 54, lightScore: 58, cctvScore: 58 },
  '41650': { name: '포천시',         crimeScore: 58, lightScore: 52, cctvScore: 52 }, // 외곽
  '41670': { name: '여주시',         crimeScore: 58, lightScore: 52, cctvScore: 52 },
  '41800': { name: '연천군',         crimeScore: 66, lightScore: 42, cctvScore: 40 }, // 농촌
  '41820': { name: '가평군',         crimeScore: 66, lightScore: 42, cctvScore: 40 }, // 농촌
  '41830': { name: '양평군',         crimeScore: 64, lightScore: 46, cctvScore: 44 }, // 농촌

  /* ── 구 개편 umbrella · 승격 전 레거시 코드 별칭 (t_legal_dong 혼재 — 2026-06-01 발견) ──
   *  capital-centroids.json 이 신설 구 코드와 옛 시/군 코드를 함께 들고 있어, 신 구 코드만으로는
   *  옛 코드 아래 법정동이 누락(fallback 50)된다. 시 단위 대표 점수로 별칭 부여(구 평균 근사).
   *  ⚠️ 근본 원인은 centroids↔generated LAWD 코드 granularity 불일치(추천 universe 매칭에도 영향 — KI 메모). */
  '41190': { name: '부천시(umbrella)', crimeScore: 49, lightScore: 65, cctvScore: 66 }, // 원미·소사·오정 평균
  '41270': { name: '안산시(umbrella)', crimeScore: 48, lightScore: 64, cctvScore: 65 }, // 상록·단원 평균
  '41460': { name: '용인시(umbrella)', crimeScore: 58, lightScore: 66, cctvScore: 66 }, // 처인·기흥·수지 중간(주로 처인 면지역)
  '41590': { name: '화성시(umbrella)', crimeScore: 57, lightScore: 62, cctvScore: 62 }, // 동탄 제외 대부분 비도심
  '41710': { name: '양주군(레거시)',   crimeScore: 54, lightScore: 58, cctvScore: 58 }, // = 양주시(41630)
  '41810': { name: '포천군(레거시)',   crimeScore: 58, lightScore: 52, cctvScore: 52 }, // = 포천시(41650)
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
  // CLI: --sigungu=강남구 (이름) 또는 --sigungu=11680 (5자리 코드)
  const argSigungu = process.argv.find((a) => a.startsWith('--sigungu='))?.split('=')[1];
  const argIsCode = !!argSigungu && /^\d{5}$/.test(argSigungu);

  console.log('[seed:safety] 수도권 행정동 안전지표 합성 시드 시작 (v3: 시군구 코드 기반 매핑)');
  if (argSigungu) console.log(`  → 자치구 한정: ${argSigungu}${argIsCode ? ' (코드)' : ' (이름)'}`);

  // 수도권(서울11·인천28·경기41) 행정동 전체 조회 (10자리 BJD 코드)
  const dongRows = await prisma.legalDong.findMany({
    where: {
      OR: [
        { code: { startsWith: '11' } },
        { code: { startsWith: '28' } },
        { code: { startsWith: '41' } },
      ],
      dong: { not: null },
      ...(argSigungu ? (argIsCode ? { code: { startsWith: argSigungu } } : { sigungu: argSigungu }) : {}),
    },
    select: { code: true, sigungu: true, dong: true },
  });

  // 10자리 코드만 (5자리 시군구 마스터 row 제외)
  const dongs = dongRows.filter((d) => d.code.length === 10);
  console.log(`  → 대상 행정동 ${dongs.length}개`);

  if (dongs.length === 0) {
    console.warn('[seed:safety] 경고: t_legal_dong 에 수도권 행정동이 없습니다.');
    console.warn('  → seed:legal-dong 을 먼저 실행하세요: npm run seed:legal-dong');
    return;
  }

  const unseenNames = new Set<string>();

  let upserted = 0;
  let skipped = 0;
  const sigunguStats: Record<string, { name: string; count: number; totalSum: number }> = {};

  for (const dong of dongs) {
    // 5자리 시군구 코드로 매핑 (동명 자치구 충돌 차단 — KI-5/KI-17)
    const sigunguCode = dong.code.slice(0, 5);
    const base = SIGUNGU_SAFETY[sigunguCode];

    if (!base) {
      // 점수표 미정의 시군구
      unseenNames.add(`${dong.sigungu ?? '?'}(${sigunguCode})`);
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

    // 자치구별 통계 누적 (코드 키, 표시는 이름)
    if (!sigunguStats[sigunguCode]) sigunguStats[sigunguCode] = { name: base.name, count: 0, totalSum: 0 };
    sigunguStats[sigunguCode].count++;
    sigunguStats[sigunguCode].totalSum += totalScore;

    upserted++;
  }

  // 미정의 자치구 경고
  if (unseenNames.size > 0) {
    console.warn(`\n  [경고] SIGUNGU_SAFETY 미정의 시군구: ${[...unseenNames].join(', ')}`);
    console.warn('  → 해당 행정동은 safetyBase=50 fallback 처리됩니다.');
  }

  // 자치구별 요약 출력
  console.log('\n  [자치구별 안전점수 평균]');
  const sorted = Object.entries(sigunguStats).sort(
    ([, a], [, b]) => b.totalSum / b.count - a.totalSum / a.count,
  );
  for (const [code, stat] of sorted) {
    const avg = (stat.totalSum / stat.count).toFixed(1);
    console.log(`    ${stat.name.padEnd(12)} ${code}: ${avg}점  (${stat.count}개 동)`);
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
