/**
 * LH 한국토지주택공사 청년주택 공급 정보 수집 스크립트 (Day 2)
 *
 *  ▷ 목적
 *    LH 오픈 API → t_lh_youth_housing 테이블 적재
 *    추천 카드에 "주변 LH 청년주택 N개" 표시에 사용
 *
 *  ▷ 수집 대상
 *    - 서울 25개 시군구
 *    - 프로그램: 행복주택 / 청년매입임대 / 전세임대
 *
 *  ▷ 실행
 *    cd C:\git\2026_MOLIT_CONTEST\server
 *    npm run seed:lh
 *
 *  ▷ 사전 조건
 *    - server/.env 에 MOLIT_SERVICE_KEY=<발급키> 설정
 *    - 발급: https://www.data.go.kr → LH 임대주택 API 신청
 *    - npx prisma db push (t_lh_youth_housing 테이블 존재해야 함)
 *
 *  ▷ 결과 확인 (MySQL)
 *    SELECT program_type, COUNT(*), SUM(units_available)
 *    FROM t_lh_youth_housing
 *    GROUP BY program_type;
 */
import 'dotenv/config';
import { prisma } from '../src/services/db';
import { fetchLhYouthHousing, type LhYouthRow } from '../src/services/external/lhClient';
import { SEOUL_LAWD_CODES } from '../src/data/seoulLawdCodes';

/* ─── upsert 헬퍼 ──────────────────────────────────────────── */

async function upsertRows(rows: LhYouthRow[]): Promise<number> {
  if (rows.length === 0) return 0;

  let upserted = 0;
  const BATCH = 50;

  for (let i = 0; i < rows.length; i += BATCH) {
    const slice = rows.slice(i, i + BATCH);
    await Promise.all(
      slice.map((r) =>
        prisma.lhYouthHousing.upsert({
          where: {
            // 복합 unique 없으므로 complexName + programType + legalDongCode 조합으로 처리
            // 실제로는 id 기반 — 이 upsert 는 create-only (중복 시 update 없음)
            // 간단히 findFirst → skip or create 패턴 사용
            id: -1, // 항상 create 로 fallthrough (아래 update 가 no-op)
          },
          update: {}, // 이미 존재하면 skip
          create: {
            legalDongCode: r.legalDongCode,
            programType:   r.programType,
            unitsAvailable: r.unitsAvailable,
            monthlyRentMin: r.monthlyRentMin,
            monthlyRentMax: r.monthlyRentMax,
          },
        }).catch(async () => {
          // id=-1 로 인한 에러 → createIfNotExists 패턴으로 재처리
          const existing = await prisma.lhYouthHousing.findFirst({
            where: {
              legalDongCode: r.legalDongCode,
              programType:   r.programType,
            },
          });
          if (!existing) {
            await prisma.lhYouthHousing.create({
              data: {
                legalDongCode:  r.legalDongCode,
                programType:    r.programType,
                unitsAvailable: r.unitsAvailable,
                monthlyRentMin: r.monthlyRentMin,
                monthlyRentMax: r.monthlyRentMax,
              },
            });
          } else {
            // 이미 존재 → units 업데이트
            await prisma.lhYouthHousing.update({
              where: { id: existing.id },
              data: {
                unitsAvailable: r.unitsAvailable,
                monthlyRentMin: r.monthlyRentMin,
                monthlyRentMax: r.monthlyRentMax,
              },
            });
          }
        }),
      ),
    );
    upserted += slice.length;
    process.stdout.write(`\r  처리 ${upserted}/${rows.length}건...`);
  }
  console.log('');
  return upserted;
}

/* ─── 메인 ──────────────────────────────────────────────────── */

async function main() {
  const apiKey = process.env.MOLIT_SERVICE_KEY;

  console.log('=== LH 청년주택 공급 정보 수집 시작 ===');
  console.log(`  시군구: 서울 ${SEOUL_LAWD_CODES.length}개`);
  console.log(`  대상: 행복주택 / 청년매입임대 / 전세임대`);

  if (!apiKey) {
    console.error('\n[ERROR] MOLIT_SERVICE_KEY 환경변수가 필요합니다.');
    console.error('  server/.env 에 다음을 추가:');
    console.error('    MOLIT_SERVICE_KEY=<공공데이터포털 발급키>  https://www.data.go.kr');
    process.exit(1);
  }

  let totalRows = 0;
  let totalUpserted = 0;
  const failedSigungu: string[] = [];

  for (const { code, name } of SEOUL_LAWD_CODES) {
    process.stdout.write(`  [${name}] 조회 중...`);
    try {
      const rows = await fetchLhYouthHousing(code);
      console.log(` ${rows.length}건`);
      totalRows += rows.length;

      if (rows.length > 0) {
        const n = await upsertRows(rows);
        totalUpserted += n;
      }
    } catch (e) {
      console.warn(` ⚠ 실패 — ${e}`);
      failedSigungu.push(name);
    }

    // 시군구 간 200ms 간격 (API rate-limit)
    await new Promise((r) => setTimeout(r, 200));
  }

  /* 결과 요약 */
  console.log('\n=== 수집 완료 ===');
  console.log(`  총 수집: ${totalRows}건`);
  console.log(`  총 처리: ${totalUpserted}건`);
  if (failedSigungu.length > 0) {
    console.warn(`  실패 시군구: ${failedSigungu.join(', ')}`);
  }

  /* 샘플 확인 */
  const sample = await prisma.lhYouthHousing.groupBy({
    by: ['programType'],
    _count: { id: true },
    _sum: { unitsAvailable: true },
  });

  if (sample.length > 0) {
    console.log('\n  DB 집계:');
    sample.forEach((r) =>
      console.log(`    ${r.programType}: ${r._count.id}건 / 총 ${r._sum.unitsAvailable ?? 0}호`),
    );
  } else {
    console.log('\n  DB 적재 없음 — API 응답 및 인증키를 확인하세요.');
    console.log('  힌트: LH 오픈 API (openapi.lh.or.kr) 또는 공공데이터포털 LH API 인증키 필요');
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
