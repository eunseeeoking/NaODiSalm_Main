/**
 * 카카오 로컬 POI 생활편의 요약 수집 스크립트 (KI-4, 2026-05-31)
 *
 *  ▷ 목적
 *    수도권(서울·인천·경기) 행정동 centroid 기준 반경 500m 카카오 카테고리 검색(지하철·마트·
 *    편의점·카페·음식점·병원·약국·은행) → t_poi_summary 적재.
 *    생활 점수(lifeScore) → scoreRegion 의 life 축 실데이터화 (더미 50 해제).
 *    ※ 2026-05-31: 서울→수도권 확장. 2026-06-01(KI-20): centroid 출처를 `t_apt_complex` 이름조인 →
 *      **`t_legal_dong.lat/lng` 직접 사용**으로 전환(명칭 불일치로 인천·경기 누락하던 문제 해소).
 *      선행: `seed:legal-dong`(좌표 포함 적재). "대상 행정동 N개"가 1187 에 근접해야 정상.
 *
 *  ▷ 실행
 *    cd server
 *    npm run seed:life
 *
 *    # 특정 행정동만:
 *    npm run seed:life -- --dongCode=1168010100
 *    # 반경 변경(기본 500m):
 *    npm run seed:life -- --radius=800
 *
 *  ▷ 사전 조건
 *    - server/.env 에 KAKAO_REST_API_KEY=<공공/카카오 REST 키> (geocoder 와 동일 키)
 *    - npx prisma db push (t_poi_summary 테이블 생성) + npx prisma generate
 *
 *  ▷ 결과 확인 (MySQL)
 *    SELECT ROUND(AVG(life_score),1), MIN(life_score), MAX(life_score) FROM t_poi_summary;
 */
import 'dotenv/config';
import { Prisma } from '@prisma/client';
import { prisma } from '../src/services/db';
import { fetchPoiSummary } from '../src/services/external/kakaoPoiClient';

/* ─── CLI 파라미터 ─────────────────────────────────────────── */

function parseArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((a) => a.startsWith(prefix))?.slice(prefix.length);
}

const targetDongCode = parseArg('dongCode');
const radius = Number(parseArg('radius') ?? '500') || 500;

/* ─── 메인 ──────────────────────────────────────────────────── */

async function main() {
  console.log('=== 카카오 POI 생활편의 요약 수집 시작 ===');
  console.log(`  반경: ${radius}m`);

  if (!process.env.KAKAO_REST_API_KEY) {
    console.error('\n[ERROR] KAKAO_REST_API_KEY 환경변수가 필요합니다.');
    console.error('  server/.env 에 추가: KAKAO_REST_API_KEY=<카카오 REST 키>');
    process.exit(1);
  }

  // 동 centroid 조회 — t_legal_dong(법정동) × complex 이름조인, 단지 좌표 AVG
  //  (2026-06-02: 법정동 기반으로 복귀. seed:bjd 가 전국 법정동을 적재하므로 수도권 complex 도 매칭됨.
  //   serving(fetchRegionAggregates)·시세 집계와 동일한 법정동 키 → POI/serving 정합.)
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
    WHERE ld.sido IN ('서울특별시', '인천광역시', '경기도')
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
    console.warn('  동 centroid 없음 — seed:bjd(전국 법정동) + 실거래 적재 확인 필요');
    return;
  }

  let processed = 0;
  let upserted = 0;
  let scoreSum = 0;

  for (const dong of dongs) {
    const { legal_dong_code, lat, lng, dong_name } = dong;
    process.stdout.write(`\r  [${++processed}/${dongs.length}] ${dong_name} ...`);

    try {
      const summary = await fetchPoiSummary(lat, lng, radius);
      if (!summary) {
        console.warn('\n  ⚠ KAKAO_REST_API_KEY 무효 — 중단');
        break;
      }

      await prisma.poiSummary.upsert({
        where: { legalDongCode: legal_dong_code },
        update: {
          subwayCount:      summary.subwayCount,
          martCount:        summary.martCount,
          convenienceCount: summary.convenienceCount,
          cafeCount:        summary.cafeCount,
          restaurantCount:  summary.restaurantCount,
          hospitalCount:    summary.hospitalCount,
          pharmacyCount:    summary.pharmacyCount,
          bankCount:        summary.bankCount,
          lifeScore:        summary.lifeScore,
          computedAt:       new Date(),
        },
        create: {
          legalDongCode:    legal_dong_code,
          subwayCount:      summary.subwayCount,
          martCount:        summary.martCount,
          convenienceCount: summary.convenienceCount,
          cafeCount:        summary.cafeCount,
          restaurantCount:  summary.restaurantCount,
          hospitalCount:    summary.hospitalCount,
          pharmacyCount:    summary.pharmacyCount,
          bankCount:        summary.bankCount,
          lifeScore:        summary.lifeScore,
        },
      });
      upserted++;
      scoreSum += summary.lifeScore;
    } catch (e) {
      console.warn(`\n  ⚠ ${dong_name} 처리 실패:`, e);
    }

    // 80ms 간격 (카카오 rate-limit 여유 — quota 30만/일이라 보수적)
    await new Promise((r) => setTimeout(r, 80));
  }

  console.log(`\n\n=== 완료 ===`);
  console.log(`  처리: ${processed}개 행정동 / 적재: ${upserted}건`);
  if (upserted > 0) {
    console.log(`  lifeScore 평균: ${(scoreSum / upserted).toFixed(1)}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
