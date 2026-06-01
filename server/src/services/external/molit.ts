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
  // 아파트 (활용승인 OK)
  aptTrade:
    'https://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev',
  aptRent:
    'https://apis.data.go.kr/1613000/RTMSDataSvcAptRent/getRTMSDataSvcAptRent',
  // 오피스텔 (활용승인 OK)
  offiTrade:
    'https://apis.data.go.kr/1613000/RTMSDataSvcOffiTrade/getRTMSDataSvcOffiTrade',
  offiRent:
    'https://apis.data.go.kr/1613000/RTMSDataSvcOffiRent/getRTMSDataSvcOffiRent',
  // 연립/다세대(빌라) (활용승인 OK)
  villaTrade:
    'https://apis.data.go.kr/1613000/RTMSDataSvcRHTrade/getRTMSDataSvcRHTrade',
  villaRent:
    'https://apis.data.go.kr/1613000/RTMSDataSvcRHRent/getRTMSDataSvcRHRent',
  // 단독/다가구 (활용승인 OK)
  shTrade:
    'https://apis.data.go.kr/1613000/RTMSDataSvcSHTrade/getRTMSDataSvcSHTrade',
  shRent:
    'https://apis.data.go.kr/1613000/RTMSDataSvcSHRent/getRTMSDataSvcSHRent',
} as const;

/**
 * 매물 유형. 분리 테이블 전략과 ingest config 의 키로 사용.
 *  - APT   : 아파트 (단지명 aptNm, 단지 고유 aptSeq 보유)
 *  - OFFI  : 오피스텔 (단지명 offiNm, aptSeq 없음)
 *  - VILLA : 연립/다세대 (건물명 mhouseNm, aptSeq 없음)
 *  - SH    : 단독/다가구 (건물명/aptSeq/층 없음, 면적은 연면적 totalFloorAr)
 */
export type PropertyType = 'APT' | 'OFFI' | 'VILLA' | 'SH';

export const PROPERTY_ENDPOINTS: Record<
  PropertyType,
  { trade: string; rent: string }
> = {
  APT: { trade: ENDPOINTS.aptTrade, rent: ENDPOINTS.aptRent },
  OFFI: { trade: ENDPOINTS.offiTrade, rent: ENDPOINTS.offiRent },
  VILLA: { trade: ENDPOINTS.villaTrade, rent: ENDPOINTS.villaRent },
  SH: { trade: ENDPOINTS.shTrade, rent: ENDPOINTS.shRent },
};

/** 매매 자료 원본 row (필요 필드만) */
interface RawAptTrade {
  aptNm?: string;
  aptSeq?: string;
  aptDong?: string;
  buildYear?: string;
  dealAmount?: string;
  dealYear?: string;
  dealMonth?: string;
  dealDay?: string;
  excluUseAr?: string;
  floor?: string;
  jibun?: string;
  bonbun?: string;
  bubun?: string;
  roadnm?: string;
  sggCd?: string;
  umdNm?: string;
  dealingGbn?: string;
  cdealType?: string;
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
  deposit?: string;
  monthlyRent?: string;
  excluUseAr?: string;
  floor?: string;
  jibun?: string;
  roadnm?: string;
  sggCd?: string;
  umdNm?: string;
  contractTerm?: string;
  contractType?: string;
  preDeposit?: string;
  preMonthlyRent?: string;
  [key: string]: string | undefined;
}

export interface NormalizedTrade {
  sigunguCode: string;
  legalDong: string;
  name: string;
  aptSeq: string | null;
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

// 유틸

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

/**
 * 단지/건물명 추출 - 유형마다 태그가 다르다.
 *   아파트=aptNm, 오피스텔=offiNm, 연립다세대=mhouseNm, 단독다가구=명칭 없음
 * 단독다가구는 이름이 없어 houseType 으로 대체, 그것도 없으면 법정동+지번.
 */
function pickName(row: Record<string, string | undefined>): string | null {
  // 1) 명시적 건물명만 이름으로 인정 (houseType 은 "다가구/다세대" 분류값이라 제외)
  const explicit = row.aptNm ?? row.offiNm ?? row.mhouseNm ?? row.bldgNm;
  if (explicit && explicit.trim()) return explicit.trim();
  // 2) 단독/다가구: 건물명 없음 → 법정동+지번, 지번도 없으면 법정동+유형
  const dong = row.umdNm?.trim();
  const jibun = row.jibun?.trim();
  const htype = row.houseType?.trim();
  if (dong && jibun) return `${dong} ${jibun}`;     // "대치동 9**"
  if (dong && htype) return `${dong} ${htype}`;      // "역삼동 다가구"
  return dong ?? htype ?? null;
}

/**
 * 전용면적 추출. 아파트/오피스텔/연립은 excluUseAr,
 * 단독/다가구는 전용면적이 없고 연면적(totalFloorAr)을 사용.
 */
function pickArea(row: Record<string, string | undefined>): number {
  return toFloat(row.excluUseAr ?? row.totalFloorAr ?? row.plottageAr);
}

// 호출

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

// 정규화

function normalizeTrade(row: RawAptTrade, lawdCd: string): NormalizedTrade | null {
  const dealDate = buildDate(row.dealYear, row.dealMonth, row.dealDay);
  const name = pickName(row);
  const sigunguCode = (row.sggCd?.trim() || lawdCd).slice(0, 5);
  const legalDong = row.umdNm?.trim() ?? '';
  if (!dealDate || !name) return null;

  return {
    sigunguCode,
    legalDong,
    name,
    aptSeq: row.aptSeq?.trim() ?? null,
    dealDate,
    priceManwon: toIntMoney(row.dealAmount),
    areaM2: pickArea(row),
    floor: toIntOrNull(row.floor),
    builtYear: toIntOrNull(row.buildYear),
    jibun: row.jibun?.trim() ?? null,
    roadAddr: row.roadnm?.trim() ?? null,
    raw: row,
  };
}

function normalizeRent(row: RawAptRent, lawdCd: string): NormalizedRent | null {
  const contractDate = buildDate(row.dealYear, row.dealMonth, row.dealDay);
  const name = pickName(row);
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
    areaM2: pickArea(row),
    floor: toIntOrNull(row.floor),
    builtYear: toIntOrNull(row.buildYear),
    jibun: row.jibun?.trim() ?? null,
    raw: row,
  };
}

// Public API

/** 유형별 매매 수집 (전 페이지 순회 + 정규화). */
export async function fetchTradesByType(
  type: PropertyType,
  lawdCd: string,
  yyyymm: string,
): Promise<NormalizedTrade[]> {
  const endpoint = PROPERTY_ENDPOINTS[type].trade;
  const out: NormalizedTrade[] = [];
  let pageNo = 1;
  while (true) {
    const { items, totalCount } = await fetchRaw<RawAptTrade>(
      endpoint,
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

/** 유형별 전월세 수집 (전 페이지 순회 + 정규화). */
export async function fetchRentsByType(
  type: PropertyType,
  lawdCd: string,
  yyyymm: string,
): Promise<NormalizedRent[]> {
  const endpoint = PROPERTY_ENDPOINTS[type].rent;
  const out: NormalizedRent[] = [];
  let pageNo = 1;
  while (true) {
    const { items, totalCount } = await fetchRaw<RawAptRent>(
      endpoint,
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

// 하위호환 래퍼 (기존 aptIngest.ts 가 사용)
export const fetchAptTrades = (lawdCd: string, yyyymm: string) =>
  fetchTradesByType('APT', lawdCd, yyyymm);
export const fetchAptRents = (lawdCd: string, yyyymm: string) =>
  fetchRentsByType('APT', lawdCd, yyyymm);
