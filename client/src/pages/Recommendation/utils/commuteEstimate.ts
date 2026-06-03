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
 * 통근시간 → 신호등 tier 색상 (초록→노랑→빨강)
 *  · 추천 지역 폴리곤 전용. 시간대가 짧을수록 초록, 길수록 빨강으로 직관 표현.
 *  · 배경(직장 주변 전체) 히트맵은 제거됨 — 추천 8곳만 강조(ODsay 정밀화는 Depth 3).
 *  · 분위 경계는 범례(20/30/45/60분)와 일치.
 */
export function pickCommuteTierColor(minutes: number): string {
  if (minutes <= 20) return '#16A34A';   // green-600  — 20분 이내
  if (minutes <= 30) return '#65A30D';   // lime-600   — 30분
  if (minutes <= 45) return '#EAB308';   // yellow-500 — 45분
  if (minutes <= 60) return '#F97316';   // orange-500 — 60분
  return '#EF4444';                       // red-500    — 60분+
}
