/**
 * 서비스 지원 범위 (현재 = 수도권: 서울·인천·경기).
 *
 *  ▷ 왜 필요한가
 *    추천은 수도권(법정동 코드 prefix 11·28·41)만 후보로 삼는다(서버 fetchRegionCandidates).
 *    그래서 여수·부산 등 범위 밖 직장은 서버가 **빈 배열 200**(에러 아님)을 주고, 화면은
 *    EmptyState 로 떨어진다. 이때 "통근·예산을 넓히세요" 안내는 틀린다(아무리 넓혀도 데이터가
 *    없음) → out-of-coverage 를 구분해 "전국 확장 로드맵" 메시지로 분기하기 위한 판정.
 *
 *  ▷ 판정 방식 (근사)
 *    수도권 대략 bounding box. 정밀 행정구역 경계가 아니라 데모 단계용 근사치다.
 *    경계 인접 도시(천안·춘천·원주 등)는 오분류 가능 — 확장 시 서버가 실제 지원 prefix 로
 *    coverage 플래그를 내려주는 방식으로 교체 권장(이 상수는 그때 제거).
 *    명백히 먼 부산·여수·대구·광주·제주 등은 정확히 범위 밖으로 잡힌다.
 */

/** 현재 지원 지역 라벨 (UI 표기 공용) */
export const SERVICE_AREA_LABEL = '수도권(서울·인천·경기)';

/** 수도권 근사 bounding box — 경기 남단~북단 / 인천 본토~경기 동단 */
const METRO_BBOX = { latMin: 36.85, latMax: 38.35, lngMin: 126.25, lngMax: 127.95 } as const;

/** 직장 좌표가 현재 지원 범위(수도권) 안인지 — 근사 판정 */
export function isInServiceArea(lat: number, lng: number): boolean {
  return (
    lat >= METRO_BBOX.latMin &&
    lat <= METRO_BBOX.latMax &&
    lng >= METRO_BBOX.lngMin &&
    lng <= METRO_BBOX.lngMax
  );
}
