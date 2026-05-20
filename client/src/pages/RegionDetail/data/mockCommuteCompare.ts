/**
 * 통근 비교 mock 데이터 생성기 (대중교통 vs 자차)
 *  - 직장 좌표 ↔ 단지 좌표 거리 기반 합성
 *  - 추후 ODsay 매트릭스 + Kakao Mobility 로 대체
 */
import type { Workplace } from '../../../types/recommendation';
import type { CommuteCompareData } from '../../../types/region-detail';
import { findMockComplex } from './mockComplexes';

const EARTH_KM = 6371;

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.sqrt(s));
}

export function getMockCommuteCompare(
  complexId: string,
  workplace: Workplace | null,
): CommuteCompareData | null {
  if (!workplace) return null;
  const complex = findMockComplex(complexId);
  if (!complex) return null;

  const km = haversineKm({ lat: complex.lat, lng: complex.lng }, workplace);

  // 대중교통: 대기·환승 포함 평균 25km/h + 환승 패널티
  const transitBase = (km / 25) * 60;
  // 거리별 환승 횟수 (3km 마다 +1, 최대 3회)
  const transfers = Math.min(3, Math.max(0, Math.floor(km / 3) - 1));
  const transitMinutes = Math.round(transitBase + transfers * 5 + 8);
  // 비용: 기본 1,500 + 거리 5km 초과 100원/km
  const transitCost = Math.round(1500 + Math.max(0, km - 5) * 100);

  // 자차: 도심 평균 22km/h + 신호 대기
  const carMinutes = Math.round((km / 22) * 60 + 6);
  // 비용: 연비 12km/L · 휘발유 1,700원/L · 통행료 가벼운 가산
  const carCost = Math.round((km / 12) * 1700 + km * 50);

  return {
    transitMinutes,
    transfers,
    transitCost,
    carMinutes,
    carCost,
  };
}
