/**
 * 임시 통근시간 추정 + 히트맵 색상 매핑
 *
 *  ⚠️ 더미 알고리즘 (Haversine 거리 × 시속 추정)
 *      → 실제 ODsay 매트릭스 도입 시 이 함수만 교체
 */

/** WGS84 Haversine 거리 (km) */
export function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

/**
 * 거리 → 통근시간(분) 추정
 *  · 직선거리 × 약 1.4 (도로 굴곡 보정)
 *  · 평균 시속 25km (대중교통 + 환승 가정)
 *  · 추후 ODsay 응답으로 대체
 */
export function estimateCommuteMinutes(km: number): number {
  const roadKm = km * 1.4;
  const minutes = (roadKm / 25) * 60;
  return Math.round(minutes);
}

/**
 * 통근시간 → 히트맵 색상 (토스 commute ramp)
 *  · patience 를 초과하면 회색 (out of range)
 *  · 그 외에는 5단계 분위 (20/30/45/60분)
 */
export function pickHeatmapColor(minutes: number, patience: number): string {
  if (minutes > patience) return '#E5E8EB';        // out of patience → 회색
  if (minutes <= 20) return '#3182F6';             // commute-fastest
  if (minutes <= 30) return '#5B9BFF';             // commute-fast
  if (minutes <= 45) return '#85B7FF';             // commute-medium
  if (minutes <= 60) return '#B5D4FF';             // commute-slow
  return '#E1EEFF';                                 // commute-slowest
}
