import { XMLParser } from 'fast-xml-parser';

/**
 * 국토교통부 실거래가 공공 API 클라이언트.
 *  - 응답 형식: XML (영문 카멜케이스 태그)
 *  - 파라미터: serviceKey, LAWD_CD(시군구 5자리), DEAL_YMD(YYYYMM), pageNo, numOfRows
 */

const SERVICE_KEY = process.env.MOLIT_SERVICE_KEY;
if (!SERVICE_KEY) {
  console.warn('[molit] MOLIT_SERVICE_KEY is not set');
}

const parser = new XMLParser({
  ignoreAttributes: true,
  parseTagValue: false,
  trimValues: true,
});

const ENDPOINTS = {
  aptTrade:
    'https://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev',
  aptRent:
    'https://apis.data.go.kr/1613000/RTMSDataSvcAptRent/getRTMSDataSvcAptRent',
  offiTrade:
    'https://apis.data.go.kr/1613000/RTMSDataSvcOffiTrade/getRTMSDataSvcOffiTrade',
  offiRent:
    'https://apis.data.go.kr/1613000/RTMSDataSvcOffiRent/getRTMSDataSvcOffiRent',
} as const;

/** 매매 자료 원본 row (필요 필드만) */
interface RawAptTrade {
  aptNm?: string;          // 단지명
  aptSeq?: string;         // 단지 고유 ID (예: "11680-3621")
  aptDong?: string;        // 동
  buildYear?: string;
  dealAmount?: string;     // "187,000" (만원)
  dealYear?: string;
  dealMonth?: string;
  dealDay?: string;
  excluUseAr?: string;     // 전용면적
  floor?: string;
  jibun?: string;
  bonbun?: string;
  bubun?: string;
  roadnm?: string;
  sggCd?: string;          // 시군구코드(5자리)
  umdNm?: string;          // 읍면동명(법정동)
  dealingGbn?: string;     // 거래유형
  cdealType?: string;      // 해제 거래 구분
  [key: string]: string | undefined;
}

/** 전월세 자료 원본 row */
interface RawAptRent {
  aptNm?: string;
  aptSeq?: string;
  buildYear?: string;
  dealYear?: string;
  dealMonth?: string;
  dealDay?: string;
  deposit?: string;        // 보증금 (만원)
  monthlyRent?: string;    // 월세 (만원, 전세=0)
  excluUseAr?: string;
  floor?: string;
  jibun?: string;
  roadnm?: string;
  sggCd?: string;
  umdNm?: string;
  contractTerm?: string;
  contractType?: string;   // "신규" | "갱신"
  preDeposit?: string;
  preMonthlyRent?: string;
  [key: string]: string | undefined;
}

export interface NormalizedTrade {
  sigunguCode: string;
  legalDong: string;
  name: string;
  aptSeq: string | null;   // 단지 고유 ID
  dealDate: Date;
  priceManwon: number;
  areaM2: number;
  floor: number | null;
  builtYear: number | null;
  jibun: string | null;
  roadAddr: string | null;
  raw: RawAptTrade;
}

export interface NormalizedRent {
  sigunguCode: string;
  legalDong: string;
  name: string;
  aptSeq: string | null;
  contractDate: Date;
  depositManwon: number;
  monthlyManwon: number;
  contractType: 'JEONSE' | 'WOLSE';
  areaM2: number;
  floor: number | null;
  builtYear: number | null;
  jibun: string | null;
  raw: RawAptRent;
}

// ─── 유틸 ────────────────────────────────────────────────────

function toIntMoney(s?: string): number {
  if (!s) return 0;
  return parseInt(s.replace(/[,\s]/g, ''), 10) || 0;
}

function toIntOrNull(s?: string): number | null {
  if (!s) return null;
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : null;
}

function toFloat(s?: string): number {
  if (!s) return 0;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

function buildDate(year?: string, month?: string, day?: string): Date | null {
  const y = parseInt(year ?? '', 10);
  const m = parseInt(month ?? '', 10);
  const d = parseInt(day ?? '1', 10);
  if (!Number.isFinite(y) || !Number.isFinite(m)) return null;
  return new Date(Date.UTC(y, m - 1, Number.isFinite(d) ? d : 1));
}

function asArray<T>(x: T | T[] | undefined): T[] {
  if (x === undefined || x === null) return [];
  return Array.isArray(x) ? x : [x];
}

// ─── 호출 ────────────────────────────────────────────────────

async function fetchRaw<T>(
  endpoint: string,
  lawdCd: string,
  yyyymm: string,
  pageNo = 1,
  numOfRows = 1000,
): Promise<{ items: T[]; totalCount: number }> {
  if (!SERVICE_KEY) throw new Error('MOLIT_SERVICE_KEY is not set');

  const url = new URL(endpoint);
  url.searchParams.set('serviceKey', SERVICE_KEY);
  url.searchParams.set('LAWD_CD', lawdCd);
  url.searchParams.set('DEAL_YMD', yyyymm);
  url.searchParams.set('pageNo', String(pageNo));
  url.searchParams.set('numOfRows', String(numOfRows));

  const debug = process.env.MOLIT_DEBUG === '1';
  if (debug) {
    const safe = url.toString().replace(SERVICE_KEY, '***');
    console.log(`[molit] GET ${safe}`);
  }

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`MOLIT HTTP ${res.status} for ${endpoint}`);
  }
  const xml = await res.text();
  if (debug) {
    console.log(`[molit] response (head 600):`, xml.slice(0, 600));
  }

  const parsed = parser.parse(xml) as {
    response?: {
      header?: { resultCode?: string; resultMsg?: string };
      body?: { items?: { item?: T | T[] } | ''; totalCount?: string };
    };
    OpenAPI_ServiceResponse?: {
      cmmMsgHeader?: { errMsg?: string; returnReasonCode?: string };
    };
  };

  if (parsed.OpenAPI_ServiceResponse) {
    const h = parsed.OpenAPI_ServiceResponse.cmmMsgHeader;
    throw new Error(
      `MOLIT API error: ${h?.errMsg ?? 'unknown'} (${h?.returnReasonCode ?? '?'})`,
    );
  }

  const code = parsed.response?.header?.resultCode;
  if (code && code !== '000') {
    throw new Error(
      `MOLIT result error: ${parsed.response?.header?.resultMsg ?? code}`,
    );
  }

  const itemsNode = parsed.response?.body?.items;
  const items =
    !itemsNode || typeof itemsNode === 'string'
      ? []
      : asArray<T>(itemsNode.item);
  const totalCount = parseInt(parsed.response?.body?.totalCount ?? '0', 10);
  return { items, totalCount };
}

// ─── 정규화 ──────────────────────────────────────────────────

function normalizeTrade(row: RawAptTrade, lawdCd: string): NormalizedTrade | null {
  const dealDate = buildDate(row.dealYear, row.dealMonth, row.dealDay);
  const name = row.aptNm?.trim();
  // sggCd 가 비어있으면 호출 시 사용한 LAWD_CD 로 대체
  const sigunguCode = (row.sggCd?.trim() || lawdCd).slice(0, 5);
  const legalDong = row.umdNm?.trim() ?? '';
  if (!dealDate || !name) return null;

  // 해제거래(취소된 거래)는 제외하고 싶다면: row.cdealType 가 'O' 또는 값이 있으면 skip
  // 현재는 모두 포함

  return {
    sigunguCode,
    legalDong,
    name,
    aptSeq: row.aptSeq?.trim() ?? null,
    dealDate,
    priceManwon: toIntMoney(row.dealAmount),
    areaM2: toFloat(row.excluUseAr),
    floor: toIntOrNull(row.floor),
    builtYear: toIntOrNull(row.buildYear),
    jibun: row.jibun?.trim() ?? null,
    roadAddr: row.roadnm?.trim() ?? null,
    raw: row,
  };
}

function normalizeRent(row: RawAptRent, lawdCd: string): NormalizedRent | null {
  const contractDate = buildDate(row.dealYear, row.dealMonth, row.dealDay);
  const name = row.aptNm?.trim();
  const sigunguCode = (row.sggCd?.trim() || lawdCd).slice(0, 5);
  const legalDong = row.umdNm?.trim() ?? '';
  if (!contractDate || !name) return null;

  const monthlyManwon = toIntMoney(row.monthlyRent);
  return {
    sigunguCode,
    legalDong,
    name,
    aptSeq: row.aptSeq?.trim() ?? null,
    contractDate,
    depositManwon: toIntMoney(row.deposit),
    monthlyManwon,
    contractType: monthlyManwon > 0 ? 'WOLSE' : 'JEONSE',
    areaM2: toFloat(row.excluUseAr),
    floor: toIntOrNull(row.floor),
    builtYear: toIntOrNull(row.buildYear),
    jibun: row.jibun?.trim() ?? null,
    raw: row,
  };
}

// ─── Public API ──────────────────────────────────────────────

export async function fetchAptTrades(
  lawdCd: string,
  yyyymm: string,
): Promise<NormalizedTrade[]> {
  const out: NormalizedTrade[] = [];
  let pageNo = 1;
  while (true) {
    const { items, totalCount } = await fetchRaw<RawAptTrade>(
      ENDPOINTS.aptTrade,
      lawdCd,
      yyyymm,
      pageNo,
      1000,
    );
    for (const r of items) {
      const norm = normalizeTrade(r, lawdCd);
      if (norm) out.push(norm);
    }
    if (pageNo * 1000 >= totalCount || items.length === 0) break;
    pageNo += 1;
  }
  return out;
}

export async function fetchAptRents(
  lawdCd: string,
  yyyymm: string,
): Promise<NormalizedRent[]> {
  const out: NormalizedRent[] = [];
  let pageNo = 1;
  while (true) {
    const { items, totalCount } = await fetchRaw<RawAptRent>(
      ENDPOINTS.aptRent,
      lawdCd,
      yyyymm,
      pageNo,
      1000,
    );
    for (const r of items) {
      const norm = normalizeRent(r, lawdCd);
      if (norm) out.push(norm);
    }
    if (pageNo * 1000 >= totalCount || items.length === 0) break;
    pageNo += 1;
  }
  return out;
}
