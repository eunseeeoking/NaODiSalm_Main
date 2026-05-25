/**
 * R-ONE 공동주택 실거래지수 수집 스크립트 (Day 1, 2026-05-24 재작성)
 *
 *  ▷ 목적
 *    한국부동산원 R-ONE API → t_reb_price_index 테이블 적재
 *    LSTM 학습 시 "실거래가 ÷ 부동산원 지수 = 정규화값" 보정에 사용
 *
 *  ▷ 수집 범위
 *    - 응답에서 서울 25구만 CLS_NM 매칭으로 추출 (rebClient 내부 처리)
 *    - 기간: 최근 36개월 (기본) — CLI 인수로 재정의 가능
 *
 *  ▷ 사전 조건 (★ 반드시 확인)
 *    server/.env 에 다음 3개 변수 설정:
 *      R-ONE-KEY=<발급키>
 *      REB_STATBL_ID=<통계표 ID>          ← R-ONE 포털에서 검색
 *      REB_STATBL_ID_RENT=<전세 통계표 ID>  ← (선택, --includeRent 사용 시)
 *
 *    STATBL_ID 찾는 법:
 *      https://www.reb.or.kr/r-one → Open API → 통계코드 검색
 *      → "공동주택 실거래가격지수" 검색
 *      → 시군구·월 단위 항목의 통계표코드 (A_2024_XXXXX 형식) 복사
 *
 *  ▷ 실행
 *    cd C:\git\2026_MOLIT_CONTEST\server
 *    npm run seed:reb
 *    # 기간 지정 시:
 *    npm run seed:reb -- --start=202101 --end=202412
 *    # 전세지수도 함께:
 *    npm run seed:reb -- --includeRent
 *    # 디버그 (페이지 1만 가져와서 응답 구조 확인):
 *    npm run seed:reb -- --debug
 *
 *  ▷ 결과 확인 (MySQL)
 *    SELECT sigungu_code, COUNT(*), MIN(ym), MAX(ym)
 *    FROM t_reb_price_index
 *    GROUP BY sigungu_code
 *    ORDER BY sigungu_code;
 */
import 'dotenv/config';
import { prisma } from '../src/services/db';
import {
  fetchRebPriceIndex,
  REB_STATBL_IDS,
  type RebPriceRow,
} from '../src/services/external/rebClient';
import { SEOUL_LAWD_CODES } from '../src/data/seoulLawdCodes';

/* ─── CLI 파라미터 파싱 ──────────────────────────────────── */

function parseArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((a) => a.startsWith(prefix))?.slice(prefix.length);
}

const startYm      = parseArg('start');   // "202101"
const endYm        = parseArg('end');     // "202412"
const includeRent  = process.argv.includes('--includeRent');
const debugMode    = process.argv.includes('--debug');

/* ─── 서울 시군구코드 목록 (안내용) ──────────────────────── */

const SEOUL_SIGUNGU_CODES = SEOUL_LAWD_CODES.map((s) => s.code);

/* ─── upsert 헬퍼 ────────────────────────────────────────── */

async function upsertRows(rows: RebPriceRow[]): Promise<number> {
  if (rows.length === 0) return 0;

  let upserted = 0;
  // Prisma upsert 를 배치로 처리 (Promise.all 이면 커넥션 포화 → 순차 배치)
  const BATCH = 100;
  for (let i = 0; i < rows.length; i += BATCH) {
    const slice = rows.slice(i, i + BATCH);
    await Promise.all(
      slice.map((r) =>
        prisma.rebPriceIndex.upsert({
          where: {
            // @@unique([sigunguCode, ym], map: "uniq_reb_idx")
            sigunguCode_ym: { sigunguCode: r.sigunguCode, ym: r.ym },
          },
          update: { indexValue: r.indexValue },
          create: {
            sigunguCode: r.sigunguCode,
            ym:          r.ym,
            indexValue:  r.indexValue,
          },
        }),
      ),
    );
    upserted += slice.length;
    process.stdout.write(`\r  upsert ${upserted}/${rows.length}건...`);
  }
  console.log('');
  return upserted;
}

/* ─── 메인 ──────────────────────────────────────────────── */

async function main() {
  console.log('=== R-ONE 공동주택 실거래지수 수집 시작 ===');
  console.log(`  서울 25구 매칭 대상: ${SEOUL_SIGUNGU_CODES.length}개`);
  console.log(`  기간: ${startYm ?? '36개월 전'} ~ ${endYm ?? '현재'}`);
  console.log(`  전세지수 포함: ${includeRent}`);
  console.log(`  매매 STATBL_ID: ${REB_STATBL_IDS.TRADE_INDEX || '(미설정)'}`);
  console.log(`  전세 STATBL_ID: ${REB_STATBL_IDS.RENT_INDEX  || '(미설정)'}`);

  const apiKey = process.env['R-ONE-KEY'];
  if (!apiKey) {
    console.error('\n[ERROR] R-ONE-KEY 환경변수가 설정되지 않았습니다.');
    console.error('  server/.env 파일에 R-ONE-KEY=<발급키> 를 추가하세요.');
    console.error('  발급: https://www.reb.or.kr/r-one → OpenAPI 신청');
    process.exit(1);
  }

  if (!REB_STATBL_IDS.TRADE_INDEX) {
    console.error('\n[ERROR] REB_STATBL_ID 환경변수가 설정되지 않았습니다.');
    console.error('  server/.env 파일에 REB_STATBL_ID=A_2024_XXXXX 를 추가하세요.');
    console.error('  찾는 법: https://www.reb.or.kr/r-one → Open API → 통계코드 검색');
    console.error('         → "공동주택 실거래가격지수" 검색 → 시군구·월 단위 항목 코드');
    console.error('  또는 헬퍼 실행:  npm run reb:list -- "실거래"');
    process.exit(1);
  }

  let totalUpserted = 0;

  /* 1. 매매 실거래지수 */
  console.log('\n[1/2] 매매 실거래지수 수집...');
  try {
    const tradeRows = await fetchRebPriceIndex({
      statblId:     REB_STATBL_IDS.TRADE_INDEX,
      dtacycleCd:   'MM',
      startWrttime: startYm,
      endWrttime:   endYm,
      pSize:        debugMode ? 100 : 1000,
    });

    if (tradeRows.length === 0) {
      console.warn('  경고: 매매지수 데이터 0건 (서울 25구 매칭 기준).');
      console.warn('  점검 항목:');
      console.warn('   1) STATBL_ID 가 올바른 통계표 ID 인지 (포털 통계코드 검색)');
      console.warn('   2) 해당 통계표가 시군구 단위인지 (시도 단위면 CLS_NM=서울특별시 → 25구 매칭 실패)');
      console.warn('   3) DTACYCLE_CD=MM 가 맞는지 (분기 통계는 QQ 필요)');
      console.warn('   4) --debug 로 재실행해 응답 구조 확인');
    } else {
      console.log(`  수집: ${tradeRows.length}건`);
      const n = await upsertRows(tradeRows);
      totalUpserted += n;
      console.log(`  upsert 완료: ${n}건`);
    }
  } catch (e) {
    console.error('  매매지수 수집 실패:', e);
  }

  /* 2. 전세 실거래지수 (선택) */
  if (includeRent) {
    console.log('\n[2/2] 전세 실거래지수 수집...');
    if (!REB_STATBL_IDS.RENT_INDEX) {
      console.warn('  경고: REB_STATBL_ID_RENT 미설정 — 전세지수 수집 건너뜀');
    } else {
      try {
        const rentRows = await fetchRebPriceIndex({
          statblId:     REB_STATBL_IDS.RENT_INDEX,
          dtacycleCd:   'MM',
          startWrttime: startYm,
          endWrttime:   endYm,
          pSize:        debugMode ? 100 : 1000,
        });

        if (rentRows.length === 0) {
          console.warn('  경고: 전세지수 데이터 0건.');
        } else {
          console.log(`  수집: ${rentRows.length}건`);
          const n = await upsertRows(rentRows);
          totalUpserted += n;
          console.log(`  upsert 완료: ${n}건`);
        }
      } catch (e) {
        console.error('  전세지수 수집 실패:', e);
      }
    }
  } else {
    console.log('\n[2/2] 전세지수 생략 (--includeRent 옵션으로 포함 가능)');
  }

  /* 3. 결과 요약 */
  console.log('\n=== 수집 완료 ===');
  console.log(`  총 upsert: ${totalUpserted}건`);

  const sample = await prisma.rebPriceIndex.findMany({
    where: { sigunguCode: { in: ['11680', '11110'] } },
    orderBy: [{ sigunguCode: 'asc' }, { ym: 'desc' }],
    take: 6,
  });
  if (sample.length > 0) {
    console.log('\n  샘플 (강남구·종로구 최신 3개월):');
    sample.forEach((r) =>
      console.log(`    ${r.sigunguCode} ${r.ym}: 지수 ${r.indexValue}`),
    );
  } else {
    console.log('\n  DB 조회 결과 없음 — API 응답을 확인하세요.');
    console.log('  디버그: npm run seed:reb 실행 후 로그에서 [rebClient] fetch 라인 확인');
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
