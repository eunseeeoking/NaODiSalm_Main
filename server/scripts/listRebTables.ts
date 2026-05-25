/**
 * R-ONE 통계표 목록 검색 헬퍼 (2026-05-24 신규)
 *
 *  ▷ 목적
 *    R-ONE OpenAPI 의 통계표 목록(SttsApiTbl.do)을 조회 → STATBL_ID 발견
 *    사용자가 "공동주택 실거래가격지수" 같은 키워드로 검색해서
 *    .env 에 넣을 STATBL_ID 값을 즉시 찾을 수 있게 함.
 *
 *  ▷ 실행
 *    cd C:\git\2026_MOLIT_CONTEST\server
 *    npm run reb:list                  # 전체 목록 (페이지 1)
 *    npm run reb:list -- "실거래"        # 검색어 필터
 *    npm run reb:list -- "공동주택"
 *
 *  ▷ 사전 조건
 *    server/.env 에 R-ONE-KEY=<발급키> 설정
 *
 *  ▷ 출력 예시
 *    A_2024_00045  공동주택 매매 실거래가격지수 (시군구·월)
 *    A_2024_00046  공동주택 전세 실거래가격지수 (시군구·월)
 *    ...
 *
 *  ▷ 다음 단계
 *    원하는 STATBL_ID 발견 → server/.env 에 REB_STATBL_ID=A_2024_XXXXX 추가
 *    → npm run seed:reb 재실행
 */
import 'dotenv/config';

const API_KEY = process.env['R-ONE-KEY'];
const BASE_URL = 'https://www.reb.or.kr/r-one/openapi/SttsApiTbl.do';

interface RawTblRow {
  STATBL_ID?: string;
  STATBL_NM?: string;
  STAT_LCLAS_NM?: string;
  STAT_MCLAS_NM?: string;
  DTACYCLE_CD?: string;
  [key: string]: string | undefined;
}

interface RebApiResponse {
  SttsApiTbl?: Array<
    | { head: Array<{ list_total_count?: number; RESULT?: { CODE?: string; MESSAGE?: string } }> }
    | { row: RawTblRow[] }
  >;
  RESULT?: { CODE?: string; MESSAGE?: string };
}

async function fetchPage(pIndex: number, pSize = 1000): Promise<{ rows: RawTblRow[]; total: number | null }> {
  if (!API_KEY) {
    throw new Error('R-ONE-KEY 미설정');
  }
  const params = new URLSearchParams({
    KEY:    API_KEY,
    Type:   'json',
    pIndex: String(pIndex),
    pSize:  String(pSize),
  });
  const url = `${BASE_URL}?${params.toString()}`;
  console.log(`[reb:list] fetch p${pIndex}`);

  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  const body = (await res.json()) as RebApiResponse;

  if (body.RESULT && body.RESULT.CODE && !/^INFO-000?$/.test(body.RESULT.CODE)) {
    throw new Error(`R-ONE 오류: ${body.RESULT.CODE} ${body.RESULT.MESSAGE ?? ''}`);
  }

  let rows: RawTblRow[] = [];
  let total: number | null = null;
  if (body.SttsApiTbl) {
    for (const part of body.SttsApiTbl) {
      if ('row' in part && Array.isArray(part.row)) {
        rows = rows.concat(part.row);
      } else if ('head' in part && Array.isArray(part.head)) {
        for (const h of part.head) {
          if (typeof h.list_total_count === 'number') total = h.list_total_count;
          if (h.RESULT && h.RESULT.CODE && !/^INFO-000?$/.test(h.RESULT.CODE)) {
            throw new Error(`R-ONE 오류: ${h.RESULT.CODE} ${h.RESULT.MESSAGE ?? ''}`);
          }
        }
      }
    }
  }
  return { rows, total };
}

async function main() {
  if (!API_KEY) {
    console.error('[ERROR] R-ONE-KEY 환경변수가 설정되지 않았습니다.');
    console.error('  server/.env 에 R-ONE-KEY=<발급키> 추가');
    process.exit(1);
  }

  // 검색어: argv 마지막 위치 인수 (--로 시작하지 않는)
  const keyword = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? '';
  console.log(`=== R-ONE 통계표 목록 조회 ===`);
  console.log(`  검색어: ${keyword || '(전체)'}`);

  const allRows: RawTblRow[] = [];
  let pIndex = 1;
  let total: number | null = null;

  try {
    for (;;) {
      const { rows, total: t } = await fetchPage(pIndex, 1000);
      if (total === null && t !== null) total = t;
      if (rows.length === 0) break;
      allRows.push(...rows);
      if (rows.length < 1000) break;
      if (total !== null && pIndex * 1000 >= total) break;
      pIndex++;
      await new Promise((r) => setTimeout(r, 100));
    }
  } catch (e) {
    console.error('[reb:list] 조회 실패:', e);
    process.exit(1);
  }

  console.log(`\n전체 통계표: ${allRows.length}건 (서버 보고 total=${total ?? '?'})`);

  // 키워드 필터
  const filtered = keyword
    ? allRows.filter((r) => {
        const hay = [r.STATBL_NM, r.STAT_LCLAS_NM, r.STAT_MCLAS_NM].filter(Boolean).join(' ');
        return hay.includes(keyword);
      })
    : allRows;

  console.log(`매칭: ${filtered.length}건\n`);

  // 출력: STATBL_ID | DTACYCLE | 대분류 > 중분류 > 통계표명
  for (const r of filtered) {
    const id    = r.STATBL_ID ?? '?'.padEnd(13);
    const cycle = (r.DTACYCLE_CD ?? '??').padEnd(2);
    const lclas = r.STAT_LCLAS_NM ?? '';
    const mclas = r.STAT_MCLAS_NM ?? '';
    const nm    = r.STATBL_NM    ?? '';
    console.log(`${id}  ${cycle}  ${lclas} > ${mclas} > ${nm}`);
  }

  if (filtered.length === 0 && keyword) {
    console.log(`\n[힌트] "${keyword}" 매칭 없음.`);
    console.log(`        키워드를 더 짧게 시도 (예: "실거래" 또는 "공동주택").`);
    console.log(`        또는 전체 목록 확인:  npm run reb:list`);
  }

  if (filtered.length > 0) {
    console.log(`\n[다음 단계]`);
    console.log(`  1) 위 목록에서 시군구·월 단위 (DTACYCLE=MM) 공동주택 실거래지수 STATBL_ID 선택`);
    console.log(`  2) server/.env 에 추가:`);
    console.log(`       REB_STATBL_ID=<선택한 ID>`);
    console.log(`  3) npm run seed:reb 재실행`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
