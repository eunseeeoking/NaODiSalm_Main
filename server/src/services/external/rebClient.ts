/**
 * 한국부동산원 R-ONE OpenAPI 클라이언트 (정식 스펙, 2026-05-24 재작성)
 *
 *  ▷ 목적
 *    공동주택 매매 실거래가격지수(시군구·월) → t_reb_price_index 적재
 *    LSTM 학습 시 "실거래가 ÷ 부동산원 지수 = 정규화값" 보정에 사용
 *
 *  ▷ 엔드포인트
 *    GET https://www.reb.or.kr/r-one/openapi/SttsApiTblData.do
 *
 *  ▷ R-ONE 정식 파라미터 (KOSIS 스타일과 완전히 다름!)
 *    KEY                인증키 (필수, R-ONE-KEY 환경변수)
 *    Type               json | xml  (기본 xml, 반드시 json 지정)
 *    pIndex             페이지 위치 (기본 1)
 *    pSize              페이지당 건수 (기본 100, 최대 10000)
 *    STATBL_ID          통계표 ID (필수, 예: A_2024_00045)
 *                       → R-ONE 포털 → Open API → 통계코드 검색
 *    DTACYCLE_CD        주기 코드 (MM: 월, QQ: 분기, YY: 년)
 *    WRTTIME_IDTFR_ID   단일 시점 (예: "202401" — 옵션)
 *    START_WRTTIME      범위 시작 (옵션)
 *    END_WRTTIME        범위 종료 (옵션)
 *    CLS_ID             분류 ID (지역 등, 옵션 — 없으면 전체 지역)
 *    ITM_ID             항목 ID (옵션 — STATBL_ID 별로 단일 항목이면 생략 가능)
 *
 *  ▷ 환경변수 (server/.env)
 *    R-ONE-KEY              R-ONE 포털 발급 인증키
 *    REB_STATBL_ID          공동주택 매매 실거래가격지수 통계표 ID
 *                           예) A_2024_00045 (실제 값은 포털 통계코드 검색에서 확인)
 *    REB_STATBL_ID_RENT     공동주택 전세 실거래가격지수 (선택)
 *    REB_ITM_ID             항목 ID (단일 항목 테이블이면 생략 가능)
 *
 *  ▷ 응답 구조 (R-ONE JSON)
 *    {
 *      "SttsApiTblData": [
 *        { "head": [{"list_total_count":N}, {"RESULT":{"CODE":"INFO-000","MESSAGE":"..."}}] },
 *        { "row": [{ "STATBL_ID":"...", "WRTTIME_IDTFR_ID":"202404",
 *                    "CLS_ID":"500001", "CLS_NM":"강남구",
 *                    "ITM_ID":"...", "ITM_NM":"매매",
 *                    "DTA_VAL":"102.5", "UI_NM":"지수", ... }, ...] }
 *      ]
 *    }
 *    오류 시:
 *    { "RESULT": { "CODE": "ERROR-300", "MESSAGE": "필수값 누락" } }
 *
 *  ▷ 알려진 한계
 *    - CLS_ID 가 LAWD_CD(5자리 법정동 코드)와 동일하지 않을 수 있음
 *      → 매핑은 응답의 CLS_NM(구 이름) 기준으로 SEOUL_LAWD_CODES.name 과 매칭
 *    - 승인 직후 1~2일 대기 후 호출 가능 (R-ONE 정책)
 */

import { SEOUL_LAWD_CODES } from '../../data/seoulLawdCodes';

const API_KEY = process.env['R-ONE-KEY'];
if (!API_KEY) {
  console.warn('[rebClient] R-ONE-KEY 환경변수 미설정 — R-ONE API 호출 불가');
}

const BASE_URL = 'https://www.reb.or.kr/r-one/openapi/SttsApiTblData.do';

/**
 * R-ONE STATBL_ID — 사용자가 포털에서 발견한 값을 .env 로 주입.
 *
 *  포털 경로: https://www.reb.or.kr/r-one → Open API → 통계코드 검색
 *  검색어: "공동주택 실거래가격지수" 또는 "아파트 실거래가격지수"
 *  찾을 항목: 시군구·월 단위 매매 실거래지수
 *
 *  ※ 하드코딩 X — STATBL_ID 는 R-ONE 버전 업데이트마다 바뀔 수 있음
 */
export const REB_STATBL_IDS = {
  /** 매매 실거래가격지수 — env: REB_STATBL_ID */
  TRADE_INDEX: process.env['REB_STATBL_ID'] ?? '',
  /** 전세 실거래가격지수 — env: REB_STATBL_ID_RENT (선택) */
  RENT_INDEX:  process.env['REB_STATBL_ID_RENT'] ?? '',
} as const;

export type RebStatblId = string;

/** R-ONE 응답 row (실제 구조) */
interface RawRebRow {
  STATBL_ID?:        string;
  STATBL_NM?:        string;
  /** "YYYYMM" (월), "YYYY" (년), "YYYYQ" (분기) */
  WRTTIME_IDTFR_ID?: string;
  /** 분류 ID (R-ONE 내부 — 지역코드일 수도, 다른 분류일 수도) */
  CLS_ID?:           string;
  /** 분류명 (예: "강남구") */
  CLS_NM?:           string;
  ITM_ID?:           string;
  ITM_NM?:           string;
  UI_NM?:            string;
  DTA_VAL?:          string;
  [key: string]: string | undefined;
}

/** R-ONE 응답 헤더 (페이지/오류 정보) */
interface RawRebHead {
  list_total_count?: number;
  RESULT?: { CODE?: string; MESSAGE?: string };
}

/** R-ONE 응답 전체 (성공 케이스) */
interface RebApiOk {
  SttsApiTblData: Array<
    | { head: RawRebHead[] }
    | { row: RawRebRow[] }
  >;
}

/** R-ONE 응답 오류 케이스 (top-level RESULT) */
interface RebApiError {
  RESULT?: { CODE?: string; MESSAGE?: string };
}

type RebApiResponse = RebApiOk | RebApiError;

/** 정제된 실거래지수 row */
export interface RebPriceRow {
  /** 시군구코드 (5자리, 예: "11680") — CLS_NM 매칭으로 추정 */
  sigunguCode: string;
  /** "YYYY-MM" 형식 (예: "2023-01") */
  ym: string;
  /** 지수값 (100 기준 상대값, 예: 102.5) */
  indexValue: number;
}

/* ─── 내부 헬퍼 ──────────────────────────────────────────── */

/** WRTTIME_IDTFR_ID(YYYYMM) → "YYYY-MM" */
function normalizeYm(wrttime: string): string | null {
  const s = wrttime.replace(/[-_]/g, '');
  if (s.length === 6 && /^\d{6}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}`;
  if (s.length === 4 && /^\d{4}$/.test(s)) return `${s}-12`; // 연 단위는 12월로 정착
  return null;
}

/** CLS_NM(구 이름) → 시군구코드 5자리 (서울 25구 한정) */
const NAME_TO_CODE = new Map<string, string>(
  SEOUL_LAWD_CODES.map((s) => [s.name, s.code]),
);

function resolveSigunguCode(row: RawRebRow): string | null {
  // 1) CLS_NM 직접 매칭 (예: "강남구" → "11680")
  if (row.CLS_NM && NAME_TO_CODE.has(row.CLS_NM)) {
    return NAME_TO_CODE.get(row.CLS_NM) ?? null;
  }
  // 2) CLS_ID 가 5자리 숫자면 그대로 (드물지만 가능)
  if (row.CLS_ID && /^\d{5}$/.test(row.CLS_ID)) return row.CLS_ID;
  return null;
}

/** 응답에서 row 배열 추출 (R-ONE 응답 구조 변형 흡수) */
function extractRows(body: RebApiResponse): { rows: RawRebRow[]; resultCode?: string; resultMessage?: string } {
  // 오류 응답 (top-level RESULT)
  if ('RESULT' in body && body.RESULT) {
    return { rows: [], resultCode: body.RESULT.CODE, resultMessage: body.RESULT.MESSAGE };
  }
  // 성공 응답
  if ('SttsApiTblData' in body && Array.isArray(body.SttsApiTblData)) {
    let rows: RawRebRow[] = [];
    let resultCode: string | undefined;
    let resultMessage: string | undefined;
    for (const part of body.SttsApiTblData) {
      if ('row' in part && Array.isArray(part.row)) {
        rows = rows.concat(part.row);
      } else if ('head' in part && Array.isArray(part.head)) {
        for (const h of part.head) {
          if (h.RESULT) {
            resultCode = h.RESULT.CODE;
            resultMessage = h.RESULT.MESSAGE;
          }
        }
      }
    }
    return { rows, resultCode, resultMessage };
  }
  return { rows: [] };
}

/* ─── 공개 API ────────────────────────────────────────────── */

export interface FetchRebIndexOptions {
  /** 통계표 ID (필수, 기본=env.REB_STATBL_ID) */
  statblId?:    RebStatblId;
  /** 주기 코드 (기본 MM) */
  dtacycleCd?:  'MM' | 'QQ' | 'YY';
  /** "YYYYMM" 시작월 (옵션) */
  startWrttime?: string;
  /** "YYYYMM" 종료월 (옵션) */
  endWrttime?:   string;
  /** 항목 ID (옵션 — 단일 항목 테이블이면 생략) */
  itmId?:       string;
  /** 한 페이지당 건수 (기본 1000) */
  pSize?:       number;
}

/**
 * R-ONE 공동주택 실거래지수 fetch (자동 페이지네이션).
 *
 *  - statblId 필수 (.env REB_STATBL_ID 권장)
 *  - 응답에서 서울 25구에 해당하는 CLS_NM 만 추출 (NAME_TO_CODE 매칭)
 *  - 페이지네이션 자동 처리 (list_total_count 기준)
 *  - API 키 미설정 시 빈 배열 반환
 */
export async function fetchRebPriceIndex(
  opts: FetchRebIndexOptions = {},
): Promise<RebPriceRow[]> {
  if (!API_KEY) {
    console.warn('[rebClient] API 키 없음 — 빈 배열 반환');
    return [];
  }

  const statblId   = opts.statblId   ?? REB_STATBL_IDS.TRADE_INDEX;
  const dtacycleCd = opts.dtacycleCd ?? 'MM';
  const pSize      = opts.pSize      ?? 1000;

  if (!statblId) {
    console.error('[rebClient] STATBL_ID 미지정.');
    console.error('  .env 에 REB_STATBL_ID=A_2024_XXXXX 추가 또는 opts.statblId 전달.');
    console.error('  발급: https://www.reb.or.kr/r-one → Open API → 통계코드 검색 → "공동주택 실거래가격지수"');
    return [];
  }

  // 기본 기간: 36개월 전 ~ 현재 (이번 달은 미발표 가능)
  const now = new Date();
  const defaultEnd   = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
  const startDate    = new Date(now.getFullYear() - 3, now.getMonth(), 1);
  const defaultStart = `${startDate.getFullYear()}${String(startDate.getMonth() + 1).padStart(2, '0')}`;

  const startWrttime = opts.startWrttime ?? defaultStart;
  const endWrttime   = opts.endWrttime   ?? defaultEnd;

  const results: RebPriceRow[] = [];
  let   pIndex   = 1;
  let   totalCount: number | null = null;

  for (;;) {
    const params = new URLSearchParams({
      KEY:           API_KEY,
      Type:          'json',
      pIndex:        String(pIndex),
      pSize:         String(pSize),
      STATBL_ID:     statblId,
      DTACYCLE_CD:   dtacycleCd,
      START_WRTTIME: startWrttime,
      END_WRTTIME:   endWrttime,
    });
    if (opts.itmId) params.set('ITM_ID', opts.itmId);

    const url = `${BASE_URL}?${params.toString()}`;
    console.log(`[rebClient] fetch p${pIndex} ${startWrttime}~${endWrttime} STATBL_ID=${statblId}`);

    let body: RebApiResponse;
    try {
      const res = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) {
        console.error(`[rebClient] HTTP ${res.status}`);
        break;
      }
      body = (await res.json()) as RebApiResponse;
    } catch (e) {
      console.error('[rebClient] fetch 실패:', e);
      break;
    }

    const { rows, resultCode, resultMessage } = extractRows(body);

    if (resultCode && !/^INFO-000?$/.test(resultCode)) {
      console.error(`[rebClient] R-ONE 오류: ${resultCode} ${resultMessage ?? ''}`);
      break;
    }

    if (rows.length === 0) {
      console.warn(`[rebClient] 빈 페이지 (p${pIndex}) — 종료`);
      break;
    }

    let pageMatched = 0;
    let pageSkipped = 0;
    for (const row of rows) {
      const ym = row.WRTTIME_IDTFR_ID ? normalizeYm(row.WRTTIME_IDTFR_ID) : null;
      const valueStr = row.DTA_VAL ?? '';
      const indexValue = parseFloat(valueStr);
      const sigunguCode = resolveSigunguCode(row);

      if (!ym || !sigunguCode || !Number.isFinite(indexValue)) {
        pageSkipped++;
        continue;
      }
      results.push({ sigunguCode, ym, indexValue });
      pageMatched++;
    }
    console.log(`  p${pIndex}: rows=${rows.length} matched=${pageMatched} skipped=${pageSkipped}`);

    // total_count 추출은 head에서 (있다면)
    if (totalCount === null && 'SttsApiTblData' in body) {
      for (const part of body.SttsApiTblData) {
        if ('head' in part) {
          for (const h of part.head) {
            if (typeof h.list_total_count === 'number') {
              totalCount = h.list_total_count;
            }
          }
        }
      }
    }

    // 페이지네이션 종료 조건
    if (rows.length < pSize) break;
    if (totalCount !== null && pIndex * pSize >= totalCount) break;
    pIndex++;

    // 페이지 사이 100ms 딜레이 (rate-limit 배려)
    await new Promise((r) => setTimeout(r, 100));
  }

  console.log(`[rebClient] 수집 완료: ${results.length}건 (서울 매칭 row 기준)`);
  return results;
}

/**
 * 특정 시군구·월 지수 단건 조회 (DB 캐시 우선 사용 권장).
 *  - LSTM 정규화 계산에서 즉석 lookup 용
 */
export async function fetchSingleIndex(
  sigunguCode: string,
  ym: string,          // "YYYY-MM"
  statblId: RebStatblId = REB_STATBL_IDS.TRADE_INDEX,
): Promise<number | null> {
  if (!statblId) return null;
  const ymCompact = ym.replace(/-/g, '');
  const rows = await fetchRebPriceIndex({
    statblId,
    startWrttime: ymCompact,
    endWrttime:   ymCompact,
  });
  return rows.find((r) => r.sigunguCode === sigunguCode && r.ym === ym)?.indexValue ?? null;
}

/* ─── 하위 호환 ─────────────────────────────────────────── */

/**
 * @deprecated 이전 코드 호환용 — REB_TABLE_IDS 직접 참조는 deprecated.
 *             신규 코드는 REB_STATBL_IDS 사용.
 */
export const REB_TABLE_IDS = REB_STATBL_IDS;
