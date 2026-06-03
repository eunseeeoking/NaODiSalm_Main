/**
 * TransitProvider 디스패처 — 지역별 대중교통 데이터 출처 격리 (KI-17 §5)
 *
 *  단일 시그니처 `fetchTransitSummary(lat, lng, regionCode)` 로 호출부(시드/스코어링)는
 *  지역 분기를 모른 채 사용하고, 내부에서 시군구 코드 prefix 로 provider 를 선택한다.
 *
 *    · 서울(11***)        → seoulBusStopTransit (정적 정류소 좌표 밀도 — TOPIS 폐기 대체, KI-6)
 *    · 그 외(인천28·경기41) → tagoClient          (TAGO 전국 — 경기·인천 시내버스)
 *
 *  ⚠️ 2026-06-03: 서울 TOPIS(ws.bus.go.kr) 라이브 API 폐기 — data.go.kr 키가 ws.bus.go.kr 백엔드에
 *    등록 안 되는 문제 지속. 국토부 "전국 버스정류장 위치정보" 정적 CSV(반경 1km 정류소 밀도)로 대체.
 *  ⚠️ 커버리지 가정: 경기·인천 TAGO 등재 여부는 **프로브 검증 대상**(수도권-mvp-plan §5/§9).
 *    `TAGO_DEBUG=1`(경기·인천)·`SEOUL_BUS_DEBUG=1`(서울 정적) 로 적재 전 확인 권장.
 *    어느 provider 든 키/파일 미비·오류 시 안전 폴백(transitScore=0)으로 동작.
 */

import { fetchTagoTransitSummary } from './tagoClient';
import type { TransitSummary } from './tagoClient';
import { fetchSeoulTransitSummary } from './seoulBusStopTransit';

export type { TransitSummary } from './tagoClient';

export type TransitRegion = 'seoul' | 'tago';

/** 시군구 5자리 코드(또는 10자리 행정동 코드)로 provider 지역 판정. */
export function resolveTransitRegion(regionCode: string): TransitRegion {
  return regionCode.startsWith('11') ? 'seoul' : 'tago';
}

/**
 * 좌표·지역코드 기반 대중교통 품질 요약.
 * @param regionCode 시군구 5자리 또는 행정동 10자리 코드(앞 2자리로 시도 판정)
 */
export function fetchTransitSummary(
  lat: number,
  lng: number,
  regionCode: string,
): Promise<TransitSummary> {
  return resolveTransitRegion(regionCode) === 'seoul'
    ? fetchSeoulTransitSummary(lat, lng)
    : fetchTagoTransitSummary(lat, lng);
}
