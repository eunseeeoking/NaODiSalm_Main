/**
 * 수도권 대중교통 품질 요약 수집 스크립트 (Day 2 → 2026-06-01 provider 추상화)
 *
 *  ▷ 목적
 *    수도권(서울·인천·경기) 행정동 centroid 좌표 기준 버스정류장·배차간격·첫막차
 *    → t_transit_route_summary 적재. 통근 점수 보정(transitScore → commuteScore 가중합).
 *
 *  ▷ Provider 분기 (KI-6 / KI-17, transitProvider.ts)
 *    · 서울(11***)        → TOPIS(seoulTopisClient) — TAGO 서울 시내버스 미등재 보완.
 *    · 그 외(인천·경기)    → TAGO(tagoClient).
 *    분기는 행정동 코드 prefix 로 자동 수행 — 호출부는 fetchTransitSummary(lat,lng,code) 단일 시그니처.
 *
 *  ▷ 실행
 *    cd server
 *    npm run seed:transit
 *
 *    # 특정 행정동만:
 *    npm run seed:transit -- --dongCode=1168010100
 *    # provider 응답 진단(적재 전 권장): TAGO_DEBUG=1 / SEOUL_TOPIS_DEBUG=1
 *
 *  ▷ 사전 조건
 *    - server/.env 에 MOLIT_SERVICE_KEY=<발급키> (TAGO·경기인천)
 *      + (서울) SEOUL_TOPIS_KEY=<발급키> 미설정 시 MOLIT_SERVICE_KEY 재사용.
 *      data.go.kr 신청: TAGO 버스정류장/노선정보 + 서울특별시 정류소/버스노선정보.
 *    - npx prisma db push (t_transit_route_summary 테이블 생성)
 *    ⚠️ 경기·인천 TAGO 커버리지·서울 TOPIS 필드매핑은 프로브 검증 대상(KI-17 §5).
 *
 *  ▷ 결과 확인 (MySQL)
 *    SELECT AVG(transit_score), MIN(transit_score), MAX(transit_score)
 *    FROM t_transit_route_summary;
 */
import 'dotenv/config';
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

  // 행정동 centroid 조회 — t_legal_dong.lat/lng 직접 사용
  //  (2026-06-01 KI-20: apt_complex 이름조인 폐기 → 인천·경기 누락 해소. seed:legal-dong 이 좌표 적재.)
  const dongs = (
    await prisma.legalDong.findMany({
      where: {
        OR: [
          { code: { startsWith: '11' } },
          { code: { startsWith: '28' } },
          { code: { startsWith: '41' } },
        ],
        dong: { not: null },
        lat: { not: null },
        lng: { not: null },
        ...(targetDongCode ? { code: targetDongCode } : {}),
      },
      select: { code: true, dong: true, lat: true, lng: true },
      orderBy: { code: 'asc' },
    })
  ).map((d) => ({
    legal_dong_code: d.code,
    dong_name: d.dong as string,
    lat: d.lat as number,
    lng: d.lng as number,
  }));

  console.log(`  대상 행정동: ${dongs.length}개`);
  if (dongs.length === 0) {
    console.warn('  행정동 centroid 없음 — seed:legal-dong 으로 t_legal_dong 좌표 적재 먼저 실행 필요');
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
