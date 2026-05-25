/**
 * TAGO 대중교통 품질 요약 수집 스크립트 (Day 2)
 *
 *  ▷ 목적
 *    서울 전체 행정동의 centroid 좌표 기준
 *    반경 1km 버스정류장·배차간격·첫막차 → t_transit_route_summary 적재
 *    통근 점수 보정 (transitScore → commuteScore 가중합)
 *
 *  ▷ 실행
 *    cd C:\git\2026_MOLIT_CONTEST\server
 *    npm run seed:transit
 *
 *    # 특정 행정동만:
 *    npm run seed:transit -- --dongCode=1168010100
 *
 *  ▷ 사전 조건
 *    - server/.env 에 MOLIT_SERVICE_KEY=<발급키>
 *    - 발급: https://www.data.go.kr → "국가대중교통정보센터 TAGO"
 *      신청 API: 버스정류장정보 조회 서비스 / 버스노선정보 조회 서비스
 *    - npx prisma db push (t_transit_route_summary 테이블 생성)
 *
 *  ▷ 결과 확인 (MySQL)
 *    SELECT AVG(transit_score), MIN(transit_score), MAX(transit_score)
 *    FROM t_transit_route_summary;
 */
import 'dotenv/config';
import { Prisma } from '@prisma/client';
import { prisma } from '../src/services/db';
import { fetchTransitSummary } from '../src/services/external/tagoClient';

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

  // 행정동 centroid 조회
  // $queryRaw 중첩 불가 → Prisma.sql / Prisma.empty 로 조건 분기
  const dongFilter = targetDongCode
    ? Prisma.sql`AND ld.code = ${targetDongCode}`
    : Prisma.empty;

  const dongs = await prisma.$queryRaw<
    Array<{ legal_dong_code: string; lat: number; lng: number; dong_name: string }>
  >`
    SELECT
      ld.code           AS legal_dong_code,
      ld.dong           AS dong_name,
      AVG(ac.lat)       AS lat,
      AVG(ac.lng)       AS lng
    FROM t_legal_dong ld
    JOIN t_apt_complex ac
      ON ac.sigungu_code = SUBSTRING(ld.code, 1, 5)
      AND ac.legal_dong  = ld.dong
    WHERE ld.sido = '서울특별시'
      AND ld.dong IS NOT NULL
      AND ac.lat IS NOT NULL
      AND ac.lng IS NOT NULL
      ${dongFilter}
    GROUP BY ld.code, ld.dong
    HAVING COUNT(ac.id) >= 1
    ORDER BY ld.code
  `;

  console.log(`  대상 행정동: ${dongs.length}개`);
  if (dongs.length === 0) {
    console.warn('  행정동 centroid 없음 — t_legal_dong + t_apt_complex 데이터 확인 필요');
    return;
  }

  let processed = 0;
  let upserted = 0;

  for (const dong of dongs) {
    const { legal_dong_code, lat, lng, dong_name } = dong;
    process.stdout.write(`\r  [${++processed}/${dongs.length}] ${dong_name} (${lat.toFixed(4)}, ${lng.toFixed(4)})...`);

    try {
      const summary = await fetchTransitSummary(lat, lng);

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
  console.log(`  처리: ${processed}개 행정동`);
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
