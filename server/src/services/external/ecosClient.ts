/**
 * 한국은행 ECOS OpenAPI 클라이언트 (ML 거시 공변량 수집, 2026-06-06)
 *
 *  ▷ 목적
 *    금리·물가·통화량 등 월별 거시 시계열 → t_macro_rate / t_macro_econ 적재.
 *    LSTM 다변량(direct multi-horizon) 입력 공변량. ym(YYYY-MM) 으로 단지 패널에 broadcast join.
 *
 *  ▷ 엔드포인트 (StatisticSearch)
 *    GET https://ecos.bok.or.kr/api/StatisticSearch/{KEY}/{TYPE}/{LANG}/{START}/{END}/{STAT_CODE}/{CYCLE}/{START_TIME}/{END_TIME}/{ITEM1}/{ITEM2}
 *      KEY        인증키 (필수, env ECOS_API_KEY — https://ecos.bok.or.kr → OpenAPI 무료 발급)
 *      TYPE       json | xml          (json 고정)
 *      LANG       kr | en             (kr 고정)
 *      START/END  결과 row 범위 (1 / 100000 — 페이지네이션 대신 넉넉히)
 *      STAT_CODE  통계표코드 (예: "722Y001")
 *      CYCLE      D(일) M(월) Q(분기) A(년)  — 여기선 M 고정
 *      START_TIME 월: "YYYYMM" (예: 201501)
 *      END_TIME   월: "YYYYMM"
 *      ITEM1..    통계항목코드 (통계표마다 다름 — 단일 항목이면 ITEM1만)
 *
 *  ▷ STAT_CODE / ITEM_CODE 찾는 법 (REB STATBL_ID 와 동일 철학 — 하드코딩 X, env 주입)
 *    1) https://ecos.bok.or.kr → 통계검색 → 원하는 지표 → "통계표코드/항목코드" 확인
 *    2) 또는 OpenAPI > 통계표 목록(StatisticTableList) / 항목(StatisticItemList) 으로 조회
 *    3) 발견값을 server/.env 에 주입 (아래 ECOS_* 변수). 깃 커밋 금지.
 *
 *    참고용 후보값 (★ 반드시 포털에서 검증 후 사용 — 버전/개편으로 바뀔 수 있음):
 *      · 한국은행 기준금리           STAT 722Y001 / ITEM 0101000 / CYCLE M
 *      · 예금은행 가중평균금리(신규취급) 주택담보대출  STAT 721Y001 / ITEM 계열 (포털 확인)
 *      · 소비자물가지수(총지수)       STAT 901Y009 / ITEM 0  / 2020=100
 *      · M2(광의통화, 말잔)          STAT 101Y004 계열 (포털 확인)
 *      · 가계신용(가계대출 잔액)      STAT 151Y005 계열 (포털 확인)
 *
 *  ▷ 응답 구조 (성공)
 *    { "StatisticSearch": { "list_total_count": N,
 *        "row": [ { "STAT_CODE":"722Y001", "ITEM_CODE1":"0101000", "UNIT_NAME":"%",
 *                   "TIME":"202504", "DATA_VALUE":"3.5", ... }, ... ] } }
 *    오류:
 *    { "RESULT": { "CODE":"INFO-200"|"ERROR-xxx", "MESSAGE":"..." } }
 *      INFO-200 = 해당 데이터 없음(빈 결과). 그 외 ERROR-* 는 키/코드 오류.
 */

const API_KEY = process.env.ECOS_API_KEY;
if (!API_KEY) {
  console.warn('[ecosClient] ECOS_API_KEY 미설정 — ECOS API 호출 불가 (server/.env 에 추가)');
}

const BASE_URL = 'https://ecos.bok.or.kr/api/StatisticSearch';

/** 한 시계열(통계표 + 항목코드) 지정 */
export interface EcosSeriesSpec {
  /** 통계표코드 (필수, 예: "722Y001") */
  statCode: string;
  /** 통계항목코드 1 (단일 항목 통계표면 이것만) */
  itemCode1?: string;
  /** 통계항목코드 2 (다차원 통계표) */
  itemCode2?: string;
  /** 주기 (기본 M) */
  cycle?: 'D' | 'M' | 'Q' | 'A';
}

/** 정제된 시계열 포인트 */
export interface EcosPoint {
  /** "YYYY-MM" */
  ym: string;
  /** 값 (단위는 통계표 UNIT_NAME — 호출부가 의미 부여) */
  value: number;
}

interface RawEcosRow {
  STAT_CODE?: string;
  ITEM_CODE1?: string;
  UNIT_NAME?: string;
  /** "YYYYMM"(월) / "YYYYQn"(분기) / "YYYY"(년) */
  TIME?: string;
  DATA_VALUE?: string;
  [k: string]: string | undefined;
}

interface EcosResponse {
  StatisticSearch?: { list_total_count?: number; row?: RawEcosRow[] };
  RESULT?: { CODE?: string; MESSAGE?: string };
}

/** ECOS TIME(YYYYMM) → "YYYY-MM" (월 주기만 정규화) */
function normalizeYm(time: string): string | null {
  const s = time.replace(/[-_]/g, '');
  if (/^\d{6}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}`;
  return null;
}

/**
 * ECOS 월별 단일 시계열 fetch.
 *
 *  - API 키 미설정 / statCode 미지정 시 빈 배열.
 *  - 결과 없음(INFO-200)도 빈 배열 (오류 아님).
 *  - 한 번에 START=1, END=100000 으로 전 구간 수집 (월 시계열은 충분).
 *
 *  @param spec     통계표 + 항목 지정
 *  @param startYm  "YYYY-MM" 또는 "YYYYMM"
 *  @param endYm    "YYYY-MM" 또는 "YYYYMM"
 */
export async function fetchEcosSeries(
  spec: EcosSeriesSpec,
  startYm: string,
  endYm: string,
): Promise<EcosPoint[]> {
  if (!API_KEY) {
    console.warn('[ecosClient] API 키 없음 — 빈 배열 반환');
    return [];
  }
  if (!spec.statCode) {
    console.error('[ecosClient] statCode 미지정 — .env ECOS_STAT_* 확인');
    return [];
  }

  const cycle = spec.cycle ?? 'M';
  const start = startYm.replace(/-/g, '');
  const end = endYm.replace(/-/g, '');

  // 경로 세그먼트 조립 (ITEM 은 지정된 만큼만)
  const segs = [
    encodeURIComponent(API_KEY),
    'json',
    'kr',
    '1',
    '100000',
    encodeURIComponent(spec.statCode),
    cycle,
    start,
    end,
  ];
  if (spec.itemCode1) segs.push(encodeURIComponent(spec.itemCode1));
  if (spec.itemCode2) segs.push(encodeURIComponent(spec.itemCode2));

  const url = `${BASE_URL}/${segs.join('/')}`;
  console.log(
    `[ecosClient] fetch STAT=${spec.statCode} ITEM=${spec.itemCode1 ?? '-'}` +
      `${spec.itemCode2 ? '/' + spec.itemCode2 : ''} ${start}~${end} (${cycle})`,
  );

  let body: EcosResponse;
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      console.error(`[ecosClient] HTTP ${res.status}`);
      return [];
    }
    body = (await res.json()) as EcosResponse;
  } catch (e) {
    console.error('[ecosClient] fetch 실패:', e);
    return [];
  }

  if (body.RESULT?.CODE) {
    const code = body.RESULT.CODE;
    if (/^INFO-200/.test(code)) {
      console.warn(`[ecosClient] 데이터 없음 (INFO-200) STAT=${spec.statCode}`);
      return [];
    }
    console.error(`[ecosClient] ECOS 오류: ${code} ${body.RESULT.MESSAGE ?? ''}`);
    return [];
  }

  const rows = body.StatisticSearch?.row ?? [];
  const out: EcosPoint[] = [];
  let skipped = 0;
  for (const r of rows) {
    const ym = r.TIME ? normalizeYm(r.TIME) : null;
    const value = parseFloat(r.DATA_VALUE ?? '');
    if (!ym || !Number.isFinite(value)) {
      skipped++;
      continue;
    }
    out.push({ ym, value });
  }
  console.log(`  rows=${rows.length} matched=${out.length} skipped=${skipped}`);
  // 같은 ym 중복 시 마지막 값 유지 (다항목 통계표 오지정 방어 — 보통 단일항목이면 무중복)
  return out;
}

/** env 에서 시계열 spec 조립 (없으면 statCode='' → 호출부가 건너뜀) */
export function ecosSpecFromEnv(statEnv: string, itemEnv: string): EcosSeriesSpec {
  return {
    statCode: process.env[statEnv] ?? '',
    itemCode1: process.env[itemEnv] || undefined,
    cycle: 'M',
  };
}
