/**
 * 서울 TOPIS 버스정보 API 클라이언트 — TransitProvider(서울) 구현 (KI-6 / KI-17)
 *
 *  ▷ 배경
 *    TAGO(국가대중교통정보센터) 전국 API 가 **서울 시내버스를 미등재**(2026-05-31 진단, KI-6)라
 *    서울 행정동은 TAGO 로 정류장/노선이 0건 → transitScore 보정 불가.
 *    서울은 TOPIS(서울시 버스정보) 별도 API 로 보완한다. 경기·인천은 기존 TagoProvider 유지.
 *    분기는 transitProvider.ts(디스패처)가 regionCode(시군구 5자리)로 수행.
 *
 *  ▷ 엔드포인트 (ws.bus.go.kr — 서울 TOPIS, data.go.kr 발급키 사용)
 *    · 좌표기반 근접 정류소  /stationinfo/getStaionsByPosList  (tmX=위도, tmY=경도, radius m) ※철자 "Staions"
 *    · 정류소 경유 노선      /stationinfo/getRouteByStationList (arsId)
 *    · 정류소×노선 첫·막차    /stationinfo/getBustimeByStationList (arsId, busRouteId)
 *    (data.go.kr "서울특별시_정류소정보조회/노선정보조회" 명세 기준, 2026-06-02 확인)
 *
 *  ▷ 인증키: **기본 MOLIT_SERVICE_KEY 재사용**(data.go.kr 인증키는 계정당 1개·승인 서비스 공통).
 *    같은 계정에서 "서울특별시_정류소정보조회/노선정보조회" 활용신청만 승인되면 아파트(RTMS)·TAGO 와 동일 키로 호출됨.
 *    `SEOUL_TOPIS_KEY` 는 서울 서비스가 *다른* data.go.kr 계정일 때만 쓰는 선택 오버라이드(Decoding 키).
 *
 *  ▷ transitScore 산출식은 TagoProvider 와 동일(헤더 0.5·야간 0.3·정류장 0.2)하여 지역 간 비교 가능.
 *
 *  ⚠️ **프로브 검증 필요(미실행)**: 본 클라이언트의 응답 필드명(stId/arsId/term/lastBusTm 등)·
 *    래퍼 구조(ServiceResult→msgBody→itemList)는 공개 명세 기준으로 작성했으나, 실 키로
 *    `SEOUL_TOPIS_DEBUG=1` 프로브(서울 좌표 1곳) 후 필드 매핑을 확정해야 한다(KI-17 §5).
 *    검증 전까지는 키 미설정과 동일하게 안전 폴백(transitScore=0)으로 동작.
 */

import { XMLParser } from 'fast-xml-parser';
import type { TransitSummary } from './tagoClient';

// data.go.kr 인증키는 계정당 1개(모든 승인 서비스 공통) → 기본은 MOLIT_SERVICE_KEY 재사용.
// SEOUL_TOPIS_KEY 는 서울 버스 서비스가 *다른* data.go.kr 계정에 있을 때만 쓰는 선택 오버라이드.
// (`||` 사용: 빈 문자열도 MOLIT 로 폴백 — `??` 면 ""가 그대로 잡혀 호출이 막힘)
const API_KEY = process.env.SEOUL_TOPIS_KEY || process.env.MOLIT_SERVICE_KEY;
const BASE_URL = 'http://ws.bus.go.kr/api/rest';
const DEBUG = process.env.SEOUL_TOPIS_DEBUG === '1';
const PARSER = new XMLParser({ ignoreAttributes: false, parseAttributeValue: true });

if (DEBUG) {
  const src = process.env.SEOUL_TOPIS_KEY
    ? 'SEOUL_TOPIS_KEY'
    : process.env.MOLIT_SERVICE_KEY
      ? 'MOLIT_SERVICE_KEY(fallback)'
      : 'NONE';
  const k = API_KEY ?? '';
  console.log(
    `[topis:DEBUG] key source=${src} len=${k.length} head=${k.slice(0, 4)} tail=${k.slice(-4)} hasPercent=${k.includes('%')}`,
  );
}

/* ─── 헬퍼 (TagoProvider 와 동일 산식) ───────────────────────── */

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

/** TOPIS 첫·막차는 'yyyyMMddHHmmss' 형식 → HHmm 4자리 추출. */
function topisTimeToHhmm(v: unknown): string | null {
  const s = String(v ?? '').replace(/\D/g, '');
  if (s.length < 12) return s.length >= 4 ? s.slice(0, 4) : null; // 'HHmmss' 등 짧은 변형 방어
  return s.slice(8, 12);
}

function hhmm2min(hhmm: string | null): number | null {
  if (!hhmm || hhmm.length < 4) return null;
  const h = parseInt(hhmm.slice(0, 2), 10);
  const m = parseInt(hhmm.slice(2, 4), 10);
  return isNaN(h) || isNaN(m) ? null : h * 60 + m;
}

/** ws.bus.go.kr 래퍼: ServiceResult → msgBody → itemList(배열|단일). */
function extractItems(data: Record<string, unknown>): unknown {
  const root = (data['ServiceResult'] ?? data['ServiceResultStation'] ?? data) as Record<string, unknown>;
  const body = root?.['msgBody'] as Record<string, unknown> | undefined;
  return body?.['itemList'];
}

async function topisGet(
  path: string,
  params: Record<string, string>,
): Promise<Record<string, unknown> | null> {
  if (!API_KEY) return null;
  const url = new URL(`${BASE_URL}${path}`);
  url.searchParams.set('serviceKey', API_KEY);
  url.searchParams.set('resultType', 'xml');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString(), { signal: AbortSignal.timeout(5_000) });
  if (!res.ok) {
    if (DEBUG) console.warn(`[topis:DEBUG] ${path} HTTP ${res.status}`);
    throw new Error(`TOPIS HTTP ${res.status}`);
  }
  const text = await res.text();
  if (DEBUG) {
    console.log(`[topis:DEBUG] ${path} 200, body[0:300]: ${text.slice(0, 300).replace(/\s+/g, ' ')}`);
  }
  return PARSER.parse(text) as Record<string, unknown>;
}

function asArray(raw: unknown): Record<string, unknown>[] {
  if (raw == null) return [];
  return (Array.isArray(raw) ? raw : [raw]) as Record<string, unknown>[];
}

/* ─── 1. 좌표 기반 근접 정류소 — getStaionsByPosList ──────────
 *  ⚠️ 엔드포인트·파라미터는 data.go.kr 명세(2026-06-02 확인) 확정:
 *     · 함수명 철자 그대로 `getStaionsByPosList` (Stations 아님)
 *     · tmX = 위도(lat), tmY = 경도(lng)  ← 샘플값 기준(이름과 반대), radius(m)
 *  응답 필드명(arsId/stationNm/dist)은 키 활성 후 프로브로 최종 확정. */
interface TopisStation {
  arsId: string;
  stNm: string;
  distanceMeter: number;
}

async function fetchNearbyStations(lat: number, lng: number, radius = 500): Promise<TopisStation[]> {
  try {
    const data = await topisGet('/stationinfo/getStaionsByPosList', {
      tmX: String(lat), // 명세 샘플: tmX=37.5x(위도)
      tmY: String(lng), // 명세 샘플: tmY=127.0x(경도)
      radius: String(radius),
    });
    if (!data) return [];
    const items = asArray(extractItems(data));
    if (DEBUG) console.log(`[topis:DEBUG] getStaionsByPosList(${lat.toFixed(4)},${lng.toFixed(4)}) → 정류소 ${items.length}건`);
    return items
      .map((i) => ({
        arsId: String(i['arsId'] ?? i['stationId'] ?? ''),
        stNm: String(i['stationNm'] ?? i['stNm'] ?? ''),
        distanceMeter: parseFloat(String(i['dist'] ?? '0')),
      }))
      .filter((s) => s.arsId && s.arsId !== '0');
  } catch {
    return [];
  }
}

/* ─── 2. 정류소 → 경유 노선 — getRouteByStationList ───────────
 *  정류소고유번호(arsId) 입력 → 경유 노선목록. 응답 busRouteId 는 프로브 확정. */
async function fetchStationRoutes(arsId: string): Promise<string[]> {
  try {
    const data = await topisGet('/stationinfo/getRouteByStationList', { arsId });
    if (!data) return [];
    const items = asArray(extractItems(data));
    return items.map((i) => String(i['busRouteId'] ?? '')).filter(Boolean);
  } catch {
    return [];
  }
}

/* ─── 3. 정류소×노선 첫·막차 — getBustimeByStationList ────────
 *  서울 명세엔 노선 레벨 배차간격(term)이 없어 첫·막차만 취득(야간접근성 판정용).
 *  → headwayMin 은 null 로 두고 transitScore 에서 기본값(40) 적용.
 *  (arsId, busRouteId) 입력. 응답 firstBusTm/lastBusTm 필드명은 프로브 확정. */
async function fetchStationRouteTime(
  arsId: string,
  busRouteId: string,
): Promise<{ firstBusTime: string | null; lastBusTime: string | null } | null> {
  try {
    const data = await topisGet('/stationinfo/getBustimeByStationList', { arsId, busRouteId });
    if (!data) return null;
    const i = asArray(extractItems(data))[0];
    if (!i) return null;
    return {
      firstBusTime: topisTimeToHhmm(i['firstBusTm'] ?? i['firstTm']),
      lastBusTime: topisTimeToHhmm(i['lastBusTm'] ?? i['lastTm']),
    };
  } catch {
    return null;
  }
}

/* ─── 퍼블릭: 서울 좌표 대중교통 품질 요약 ──────────────────── */

export async function fetchSeoulTransitSummary(lat: number, lng: number): Promise<TransitSummary> {
  const fallback: TransitSummary = {
    lat, lng, stationCount: 0, avgHeadwayMin: null,
    nightAccessible: false, firstBusTime: null, transitScore: 0,
  };
  if (!API_KEY) return fallback;

  try {
    const stations = await fetchNearbyStations(lat, lng, 500);
    const stationCount = stations.length;
    if (stationCount === 0) return fallback;

    // (arsId, busRouteId) 쌍 수집 — getBustimeByStationList 가 둘 다 요구.
    // 정류장별 노선 조회를 병렬(최대 10개 동시)로 — 동당 시간 단축, 동시성 ≤10 으로 버스트 안전.
    const perStation = await Promise.all(
      stations.slice(0, 10).map(async (st) => ({ arsId: st.arsId, ids: await fetchStationRoutes(st.arsId) })),
    );
    const pairs: Array<{ arsId: string; routeId: string }> = [];
    const seenRoute = new Set<string>();
    for (const { arsId, ids } of perStation) {
      for (const rid of ids) {
        if (!seenRoute.has(rid)) { seenRoute.add(rid); pairs.push({ arsId, routeId: rid }); }
        if (pairs.length >= 20) break;
      }
      if (pairs.length >= 20) break;
    }

    const times = (
      await Promise.all(pairs.slice(0, 10).map((p) => fetchStationRouteTime(p.arsId, p.routeId)))
    ).filter((t): t is { firstBusTime: string | null; lastBusTime: string | null } => t !== null);

    // 서울 명세상 배차간격(term) 미제공 → headway 기본값으로 처리
    const avgHeadwayMin: number | null = null;
    const nightAccessible = times.some((t) => { const m = hhmm2min(t.lastBusTime); return m !== null && m >= 23 * 60 + 30; });
    const firstBusTime = times.map((t) => t.firstBusTime).filter((x): x is string => x !== null).sort()[0] ?? null;

    const headwayScore = avgHeadwayMin != null ? inverseLinear(avgHeadwayMin, 3, 30) : 40;
    const nightScore = nightAccessible ? 100 : 30;
    const stationScore = forwardLinear(stationCount, 0, 10);
    const transitScore = Math.min(100, Math.max(0, Math.round(0.5 * headwayScore + 0.3 * nightScore + 0.2 * stationScore)));

    return { lat, lng, stationCount, avgHeadwayMin, nightAccessible, firstBusTime, transitScore };
  } catch {
    return fallback;
  }
}
