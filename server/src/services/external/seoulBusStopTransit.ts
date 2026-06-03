/**
 * 서울 대중교통 품질 — 정적 정류소 좌표 파일 기반 (KI-6 / KI-17, 2026-06-03 TOPIS 폐기 대체)
 *
 *  ▷ 배경 / 폐기 사유
 *    서울 TOPIS(ws.bus.go.kr)는 data.go.kr 발급키로 `SERVICE KEY IS NOT REGISTERED` 가
 *    계속 발생(승인됐어도 ws.bus.go.kr 백엔드로 키 전파가 안 되는 사례). TAGO 가 동일 키로
 *    apis.data.go.kr 에서 정상 작동하는 것과 대비 → 라이브 API 의존을 **폐기**하고,
 *    국토부 "전국 버스정류장 위치정보"(공공데이터포털 15067528) **정적 좌표 CSV** 로 대체.
 *
 *  ▷ 동작
 *    동 centroid 반경 1km 내 버스정류소 **수(밀도)** 로 transitScore 산출. 라이브 호출 0건.
 *    배차간격·첫막차(야간접근성)는 정적 좌표만으로 불가 → null/false(밀도 위주 점수).
 *    ※ 경기·인천은 기존 TAGO(tagoClient) 유지. 본 모듈은 서울(11***)만 담당(transitProvider 분기).
 *
 *  ▷ 데이터 파일
 *    기본 경로: server/data/seoul-bus-stops.csv  (env `SEOUL_BUS_STOPS_CSV` 로 변경 가능)
 *    공공데이터포털 15067528 CSV 를 그대로 두면 됨 — bbox 로 서울권만 자동 필터.
 *    파일 없으면 안전 폴백(stationCount=0 → 시드가 미적재/null 처리, 기존과 동일).
 *
 *  ▷ 좌표 파싱(인코딩·열순서 무관 휴리스틱)
 *    공공데이터 CSV 는 CP949 인 경우가 많아 헤더명 신뢰 불가 → 각 행에서 위도(37~38)·경도(126~128)
 *    범위의 수치 셀을 찾아 좌표로 인식(위경도 뒤바뀜도 범위로 자동 판별).
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import type { TransitSummary } from './tagoClient';

const DEBUG = process.env.SEOUL_BUS_DEBUG === '1';

/** 정류소 밀도 포화점 — 반경 1km 내 N개 이상이면 transitScore 100.
 *  서울 도심 1km 버스정류소 밀도 기준 임시값. 시드 후 분포(min/avg/max) 보고 조정. */
const STATION_SATURATION = 40;
const RADIUS_KM = 1.0;

/** 서울권 bbox(경계 인접 경기 정류소도 통근상 유효하므로 약간 넓게). */
const SEOUL_BBOX = { latMin: 37.35, latMax: 37.75, lngMin: 126.70, lngMax: 127.25 };

function forwardLinear(value: number, min: number, max: number): number {
  if (max <= min) return 50;
  if (value <= min) return 0;
  if (value >= max) return 100;
  return Math.round(((value - min) / (max - min)) * 100);
}

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** 한 CSV 행에서 (위도, 경도) 추출 — 범위로 판별(인코딩/열순서 무관). */
function parseLatLng(line: string): { lat: number; lng: number } | null {
  // 따옴표 안 콤마는 드물고 좌표는 순수 숫자라 단순 split 으로 충분.
  const cells = line.split(',');
  let lat: number | null = null;
  let lng: number | null = null;
  for (const c of cells) {
    const v = parseFloat(c.trim());
    if (!Number.isFinite(v)) continue;
    if (lat === null && v >= 37 && v <= 38) lat = v;
    else if (lng === null && v >= 126 && v <= 128) lng = v;
  }
  return lat !== null && lng !== null ? { lat, lng } : null;
}

let _stops: Array<{ lat: number; lng: number }> | null = null;

/** 정류소 좌표 1회 로드(서울권 bbox 필터 + 캐시). 파일 없으면 빈 배열. */
function loadStops(): Array<{ lat: number; lng: number }> {
  if (_stops) return _stops;
  const path = process.env.SEOUL_BUS_STOPS_CSV
    ? resolve(process.env.SEOUL_BUS_STOPS_CSV)
    : resolve(process.cwd(), 'data', 'seoul-bus-stops.csv');
  let text: string;
  try {
    text = readFileSync(path, 'utf-8');
  } catch {
    if (DEBUG) console.warn(`[seoul-bus:DEBUG] 정류소 CSV 없음: ${path} → 폴백(stationCount=0)`);
    _stops = [];
    return _stops;
  }
  const out: Array<{ lat: number; lng: number }> = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const p = parseLatLng(line);
    if (
      p &&
      p.lat >= SEOUL_BBOX.latMin && p.lat <= SEOUL_BBOX.latMax &&
      p.lng >= SEOUL_BBOX.lngMin && p.lng <= SEOUL_BBOX.lngMax
    ) {
      out.push(p);
    }
  }
  if (DEBUG) console.log(`[seoul-bus:DEBUG] 로드 ${out.length}개 정류소 (서울권 bbox, from ${path})`);
  _stops = out;
  return _stops;
}

/** 서울 좌표 대중교통 품질 요약(정적 정류소 밀도 기반). transitProvider 가 서울(11***)에 호출. */
export async function fetchSeoulTransitSummary(lat: number, lng: number): Promise<TransitSummary> {
  const fallback: TransitSummary = {
    lat, lng, stationCount: 0, avgHeadwayMin: null,
    nightAccessible: false, firstBusTime: null, transitScore: 0,
  };
  const stops = loadStops();
  if (stops.length === 0) return fallback;

  const origin = { lat, lng };
  let stationCount = 0;
  for (const s of stops) {
    if (haversineKm(origin, s) <= RADIUS_KM) stationCount++;
  }
  if (stationCount === 0) return fallback;

  // 밀도 기반 점수 — 정적 좌표라 배차/막차 미상(null/false). 경기·인천 TAGO 합성점수와
  //  방법론은 다르나 둘 다 0~100·commuteScore 보정용이라 호환(차이는 시드 통계로 점검).
  const transitScore = Math.min(100, Math.max(0, forwardLinear(stationCount, 0, STATION_SATURATION)));
  return {
    lat, lng, stationCount,
    avgHeadwayMin: null,
    nightAccessible: false,
    firstBusTime: null,
    transitScore,
  };
}
