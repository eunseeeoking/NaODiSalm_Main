/**
 * 수도권 대중교통 품질 요약 수집 스크립트 (Day 2 → 2026-06-01 provider 추상화)
 *
 *  ▷ 목적
 *    수도권(서울·인천·경기) 행정동 centroid 좌표 기준 버스정류장·배차간격·첫막차
 *    → t_transit_route_summary 적재. 통근 점수 보정(transitScore → commuteScore 가중합).
 *
 *  ▷ Provider 분기 (KI-6 / KI-17, transitProvider.ts)
 *    · 서울(11***)        → 정적 정류소 좌표 밀도(seoulBusStopTransit) — TOPIS 라이브 폐기 대체.
 *    · 그 외(인천·경기)    → TAGO(tagoClient) 라이브.
 *    분기는 행정동 코드 prefix 로 자동 수행 — 호출부는 fetchTransitSummary(lat,lng,code) 단일 시그니처.
 *
 *  ▷ 실행
 *    cd server
 *    npm run seed:transit
 *
 *    # 특정 행정동만:
 *    npm run seed:transit -- --dongCode=1168010100
 *    # provider 응답 진단(적재 전 권장): TAGO_DEBUG=1(경기인천) / SEOUL_BUS_DEBUG=1(서울 정적)
 *
 *  ▷ 사전 조건
 *    - (경기·인천 TAGO) server/.env 에 MOLIT_SERVICE_KEY=<data.go.kr 발급키>.
 *    - (서울 정적) server/data/seoul-bus-stops.csv — 공공데이터포털 "국토부 전국 버스정류장
 *      위치정보"(15067528) CSV 를 그대로 저장(서울권 bbox 자동 필터). 키 불필요.
 *      env SEOUL_BUS_STOPS_CSV 로 경로 변경 가능. 파일 없으면 서울은 폴백(미적재).
 *    - npx prisma db push (t_transit_route_summary 테이블 생성)
 *    ⚠️ 경기·인천 TAGO 커버리지는 프로브 검증 대상(KI-17 §5). 서울은 정적 밀도(배차/막차 미상).
 *
 *  ▷ 결과 확인 (MySQL)
 *    SELECT AVG(transit_score), MIN(transit_score), MAX(transit_score)
 *    FROM t_transit_route_summary;
 */
import 'dotenv/config';
import { Prisma } from '@prisma/client';
import { prisma } from '../src/services/db';
import { fetchTransitSummary, resolveTransitRegion } from '../src/services/external/transitProvider';

/* ─── CLI 파라미터 ─────────────────────────────────────────── */

function parseArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((a) => a.startsWith(prefix))?.slice(prefix.length);
}

const targetDongCode = parseArg('dongCode');

/* ─── 메인 ──────────────────────────────────────────────────── */

async function main() {
  const apiKey = process.env.MOLIT_SERVICE_KEY;

  console.log('=== TAGO 대중교통 품질 요약 수집 시작 ===');

  if (!apiKey) {
    console.error('\n[ERROR] MOLIT_SERVICE_KEY 환경변수가 필요합니다.');
    console.error('  server/.env 에 다음을 추가:');
    console.error('    MOLIT_SERVICE_KEY=<공공데이터포털 발급키>');
    console.error('  발급: https://www.data.go.kr → "국가대중교통정보센터 TAGO"');
    process.exit(1);
  }

  // 동 centroid 조회 — t_legal_dong(법정동) × **4종 단지 UNION** 이름조인, 좌표 AVG.
  //  (2026-06-XX KI-19 후속: serving universe(4종)와 맞춰 빌라·오피만 있는 동도 커버 → transit 미적재로 인한 누락 방지.)
  const dongFilter = targetDongCode
    ? Prisma.sql`AND ld.code = ${targetDongCode}`
    : Prisma.empty;

  const dongs = await prisma.$queryRaw<
    Array<{ legal_dong_code: string; lat: number; lng: number; dong_name: string }>
  >`
    SELECT
      ld.code     AS legal_dong_code,
      ld.dong     AS dong_name,
      AVG(c.lat)  AS lat,
      AVG(c.lng)  AS lng
    FROM t_legal_dong ld
    JOIN (
      SELECT sigungu_code, legal_dong, lat, lng FROM t_apt_complex   WHERE lat IS NOT NULL AND lng IS NOT NULL
      UNION ALL SELECT sigungu_code, legal_dong, lat, lng FROM t_offi_complex  WHERE lat IS NOT NULL AND lng IS NOT NULL
      UNION ALL SELECT sigungu_code, legal_dong, lat, lng FROM t_villa_complex WHERE lat IS NOT NULL AND lng IS NOT NULL
      UNION ALL SELECT sigungu_code, legal_dong, lat, lng FROM t_sh_complex    WHERE lat IS NOT NULL AND lng IS NOT NULL
    ) c
      ON c.sigungu_code = SUBSTRING(ld.code, 1, 5)
      AND c.legal_dong  = ld.dong
    WHERE ld.sido IN ('서울특별시', '인천광역시', '경기도')
      AND ld.dong IS NOT NULL
      ${dongFilter}
    GROUP BY ld.code, ld.dong
    HAVING COUNT(*) >= 1
    ORDER BY ld.code
  `;

  console.log(`  대상 행정동: ${dongs.length}개`);
  if (dongs.length === 0) {
    console.warn('  동 centroid 없음 — seed:bjd(전국 법정동) + 실거래 적재 확인 필요');
    return;
  }

  let processed = 0;
  let upserted = 0;
  const providerCount = { seoul: 0, tago: 0 }; // provider 분기 가시화(프로브용)

  for (const dong of dongs) {
    const { legal_dong_code, lat, lng, dong_name } = dong;
    process.stdout.write(`\r  [${++processed}/${dongs.length}] ${dong_name} (${lat.toFixed(4)}, ${lng.toFixed(4)})...`);
    providerCount[resolveTransitRegion(legal_dong_code)]++;

    try {
      // regionCode(행정동 10자리) prefix 로 provider 자동 선택: 서울→TOPIS, 경기·인천→TAGO
      const summary = await fetchTransitSummary(lat, lng, legal_dong_code);

      // stationCount=0 → 광역버스 미경유 행정동
      // DB에 0을 넣으면 commuteScore 패널티 발생 → 행 미적재로 null fallback 처리
      if (summary.stationCount === 0) {
        // 기존 행이 있으면 삭제 (재시드 시 정리)
        await prisma.transitRouteSummary.deleteMany({ where: { legalDongCode: legal_dong_code } });
        continue;
      }

      await prisma.transitRouteSummary.upsert({
        where: { legalDongCode: legal_dong_code },
        update: {
          stationCount:    summary.stationCount,
          avgHeadwayMin:   summary.avgHeadwayMin,
          nightAccessible: summary.nightAccessible,
          firstBusTime:    summary.firstBusTime,
          transitScore:    summary.transitScore,
          computedAt:      new Date(),
        },
        create: {
          legalDongCode:   legal_dong_code,
          stationCount:    summary.stationCount,
          avgHeadwayMin:   summary.avgHeadwayMin,
          nightAccessible: summary.nightAccessible,
          firstBusTime:    summary.firstBusTime,
          transitScore:    summary.transitScore,
        },
      });
      upserted++;
    } catch (e) {
      console.warn(`\n  ⚠ ${dong_name} 처리 실패:`, e);
    }

    // 200ms 간격 (API rate-limit)
    await new Promise((r) => setTimeout(r, 200));
  }

  console.log(`\n\n=== 완료 ===`);
  console.log(`  처리: ${processed}개 행정동 (서울/TOPIS ${providerCount.seoul} · 경기인천/TAGO ${providerCount.tago})`);
  console.log(`  적재: ${upserted}건`);

  const stats = await prisma.$queryRaw<
    Array<{ avg_score: number; min_score: number; max_score: number }>
  >`
    SELECT
      ROUND(AVG(transit_score), 1) AS avg_score,
      ROUND(MIN(transit_score), 1) AS min_score,
      ROUND(MAX(transit_score), 1) AS max_score
    FROM t_transit_route_summary
  `;

  if (stats[0]) {
    const s = stats[0];
    console.log(`\n  transitScore 통계: 평균 ${s.avg_score} / 최저 ${s.min_score} / 최고 ${s.max_score}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
