/**
 * TAGO 국가대중교통정보센터 API 클라이언트 (Day 2)
 *
 *  ▷ 엔드포인트: https://apis.data.go.kr/1613000
 *    (구 tago.go.kr → 국토교통부 data.go.kr 로 이관 완료)
 *
 *  ▷ 인증키: MOLIT_SERVICE_KEY (.env)
 *    data.go.kr 에서 발급한 단일 키 — 아파트 실거래가 API 와 동일 키 재사용
 *    신청 필요 서비스:
 *      · 버스정류장정보 조회 서비스    /1613000/BusSttnInfoInqireService
 *      · 버스노선정보 조회 서비스      /1613000/BusRouteInfoInqireService
 *
 *  ▷ transitScore 산출 (0~100)
 *    headwayScore  = inverseLinear(avgHeadwayMin, 3, 30)   배차 3분=100, 30분=0
 *    nightScore    = nightAccessible ? 100 : 30             막차 23:30 이후
 *    stationScore  = forwardLinear(stationCount, 0, 10)    정류장 수
 *    transitScore  = 0.5*headway + 0.3*night + 0.2*station
 *
 *  ▷ 미적재 fallback
 *    MOLIT_SERVICE_KEY 미설정 → transitScore=0, 보정 없음
 */

import { XMLParser } from 'fast-xml-parser';

const API_KEY = process.env.MOLIT_SERVICE_KEY;
const BASE_URL = 'https://apis.data.go.kr/1613000';
const SEOUL_CITY_CODE = '11';
const PARSER = new XMLParser({ ignoreAttributes: false, parseAttributeValue: true });

if (!API_KEY) {
  console.warn('[tagoClient] MOLIT_SERVICE_KEY 미설정 — transitScore=0 fallback');
}

/* ─── 타입 ─────────────────────────────────────────────────── */

export interface BusStation {
  nodeId: string;
  nodeName: string;
  cityCode: string;   // TAGO 도시코드 — 정류장별로 다를 수 있음 (ICB=인천광역버스 등)
  lat: number;
  lng: number;
  distanceMeter: number;
}

export interface RouteInfo {
  routeId: string;
  routeName: string;
  headwayMin: number | null;
  firstBusTime: string | null;
  lastBusTime: string | null;
}

export interface TransitSummary {
  lat: number;
  lng: number;
  stationCount: number;
  avgHeadwayMin: number | null;
  nightAccessible: boolean;
  firstBusTime: string | null;
  transitScore: number;
}

/* ─── 헬퍼 ─────────────────────────────────────────────────── */

function inverseLinear(value: number, min: number, max: number): number {
  if (max <= min) return 50;
  if (value <= min) return 100;
  if (value >= max) return 0;
  return Math.round(((max - value) / (max - min)) * 100);
}

function forwardLinear(value: number, min: number, max: number): number {
  if (max <= min) return 50;
  if (value <= min) return 0;
  if (value >= max) return 100;
  return Math.round(((value - min) / (max - min)) * 100);
}

function hhmm2min(hhmm: string | null): number | null {
  if (!hhmm || hhmm.length < 4) return null;
  const h = parseInt(hhmm.slice(0, 2), 10);
  const m = parseInt(hhmm.slice(2, 4), 10);
  return isNaN(h) || isNaN(m) ? null : h * 60 + m;
}

function extractItems(data: Record<string, unknown>): unknown {
  const resp  = data['response']  as Record<string, unknown> | undefined;
  const body  = resp?.['body']    as Record<string, unknown> | undefined;
  const items = body?.['items']   as Record<string, unknown> | undefined;
  return items?.['item'];
}

async function tagoGet(
  path: string,
  params: Record<string, string>,
): Promise<Record<string, unknown> | null> {
  if (!API_KEY) return null;
  const url = new URL(`${BASE_URL}${path}`);
  url.searchParams.set('serviceKey', API_KEY);
  url.searchParams.set('_type', 'xml');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString(), { signal: AbortSignal.timeout(8_000) });
  if (!res.ok) throw new Error(`TAGO HTTP ${res.status}`);
  return PARSER.parse(await res.text()) as Record<string, unknown>;
}

/* ─── 1. 좌표 기반 정류장 목록 ─────────────────────────────── */

export async function fetchNearbyStations(
  lat: number,
  lng: number,
  count = 20,
): Promise<BusStation[]> {
  try {
    const data = await tagoGet(
      '/BusSttnInfoInqireService/getCrdntPrxmtSttnList',
      { gpsLati: String(lat), gpsLong: String(lng), count: String(count) },
    );
    if (!data) return [];
    const raw = extractItems(data);
    if (!raw) return [];
    const arr: unknown[] = Array.isArray(raw) ? raw : [raw];
    return arr.map((item) => {
      const i = item as Record<string, unknown>;
      return {
        nodeId:        String(i['nodeid']   ?? ''),
        nodeName:      String(i['nodenm']   ?? ''),
        cityCode:      String(i['citycode'] ?? SEOUL_CITY_CODE),
        lat:           parseFloat(String(i['gpslati']  ?? '0')),
        lng:           parseFloat(String(i['gpslong']  ?? '0')),
        distanceMeter: parseFloat(String(i['distance'] ?? '0')),
      };
    }).filter((s) => s.nodeId);
  } catch {
    return [];
  }
}

/* ─── 2. 정류장 → 경유 노선 ────────────────────────────────── */

async function fetchStationRoutes(nodeId: string, cityCode: string): Promise<string[]> {
  try {
    const data = await tagoGet(
      '/BusSttnInfoInqireService/getSttnThrghRouteList',
      { cityCode, nodeid: nodeId },   // 정류장 자체 도시코드 사용
    );
    if (!data) return [];
    const raw = extractItems(data);
    if (!raw) return [];
    const arr: unknown[] = Array.isArray(raw) ? raw : [raw];
    return arr.map((i) => String((i as Record<string, unknown>)['routeid'] ?? '')).filter(Boolean);
  } catch {
    return [];
  }
}

/* ─── 3. 노선 상세 (배차간격·첫막차) ───────────────────────── */

async function fetchRouteInfo(routeId: string, cityCode: string): Promise<RouteInfo | null> {
  try {
    const data = await tagoGet(
      '/BusRouteInfoInqireService/getRouteInfoIem',
      { cityCode, routeId },
    );
    if (!data) return null;
    const raw = extractItems(data);
    if (!raw) return null;
    const i = raw as Record<string, unknown>;
    // 실명세 확인된 필드: intervaltime(배차), routeno(노선번호), startvehicletime/endvehicletime(첫막차)
    const hw = parseFloat(String(i['intervaltime'] ?? ''));
    const toHhmm = (v: unknown) =>
      String(v ?? '').replace(':', '').padStart(4, '0').slice(0, 4) || null;
    return {
      routeId,
      routeName:    String(i['routeno'] ?? ''),
      headwayMin:   isNaN(hw) ? null : hw,
      firstBusTime: toHhmm(i['startvehicletime']),
      lastBusTime:  toHhmm(i['endvehicletime']),
    };
  } catch {
    return null;
  }
}

/* ─── 퍼블릭 API ───────────────────────────────────────────── */

/**
 * 좌표 기반 대중교통 품질 요약 조회
 *  1. 반경 내 버스 정류장 최대 15개
 *  2. 정류장별 경유 노선 (중복 제거, 최대 20개)
 *  3. 노선별 배차간격·첫막차 (최대 10개)
 *  4. transitScore 산출
 */
export async function fetchTransitSummary(lat: number, lng: number): Promise<TransitSummary> {
  const fallback: TransitSummary = {
    lat, lng, stationCount: 0, avgHeadwayMin: null,
    nightAccessible: false, firstBusTime: null, transitScore: 0,
  };
  if (!API_KEY) return fallback;

  try {
    const stations = await fetchNearbyStations(lat, lng, 15);
    const stationCount = stations.length;
    if (stationCount === 0) return fallback;

    // routeId → cityCode 매핑 (노선 상세 조회 시 도시코드 필요)
    const routeMap = new Map<string, string>(); // routeId → cityCode
    for (const st of stations.slice(0, 10)) {
      const ids = await fetchStationRoutes(st.nodeId, st.cityCode);
      for (const rid of ids) if (!routeMap.has(rid)) routeMap.set(rid, st.cityCode);
      if (routeMap.size >= 20) break;
    }

    const routeEntries = Array.from(routeMap.entries()).slice(0, 10);
    const routeInfos = (
      await Promise.all(routeEntries.map(([rid, cc]) => fetchRouteInfo(rid, cc)))
    ).filter((r): r is RouteInfo => r !== null);

    const headways      = routeInfos.map((r) => r.headwayMin).filter((h): h is number => h !== null);
    const avgHeadwayMin = headways.length > 0 ? Math.round(headways.reduce((a, b) => a + b) / headways.length) : null;
    const nightAccessible = routeInfos.some((r) => { const m = hhmm2min(r.lastBusTime); return m !== null && m >= 23 * 60 + 30; });
    const firstBusTime    = routeInfos.map((r) => r.firstBusTime).filter((t): t is string => t !== null).sort()[0] ?? null;

    const headwayScore = avgHeadwayMin != null ? inverseLinear(avgHeadwayMin, 3, 30) : 40;
    const nightScore   = nightAccessible ? 100 : 30;
    const stationScore = forwardLinear(stationCount, 0, 10);
    const transitScore = Math.min(100, Math.max(0, Math.round(0.5 * headwayScore + 0.3 * nightScore + 0.2 * stationScore)));

    return { lat, lng, stationCount, avgHeadwayMin, nightAccessible, firstBusTime, transitScore };
  } catch {
    return fallback;
  }
}
