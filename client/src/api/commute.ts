/**
 * 통근 매트릭스 API 클라이언트
 *  - POST /api/commute/matrix
 *  - 서버가 캐시 hit/miss 처리 후 매트릭스 반환
 */
import { apiFetch } from './client';

export interface CommuteTarget {
  /** 행정동 코드 (10자리) */
  code: string;
  lat: number;
  lng: number;
}

export interface CommuteEntry {
  legalDongCode: string;
  /** 대중교통 통근시간 (분, ODsay) */
  transitMinutes: number;
  /** 환승 횟수 */
  transitTransfers: number | null;
  /** 편도 비용 (원) */
  transitCostWon: number | null;
  /** 자차 통근시간 (분, Haversine 추정) */
  carMinutes: number;
}

export interface MatrixResponse {
  cacheKey: string;
  /** 정확 좌표 일치 (4자리 동일) */
  cacheHit: number;
  /** 인접 격자에서 KNN 흡수 (33m 이내 가까운 캐시 재사용) */
  cacheNearby: number;
  /** 신규 ODsay 호출한 항목 수 */
  cacheMiss: number;
  /** DB 에 새로 쓰인 항목 수 */
  written: number;
  /** 서버 처리 시간 (ms) */
  elapsedMs: number;
  /** 행정동 코드 → 통근 정보 */
  matrix: Record<string, CommuteEntry>;
}

/**
 * 통근 매트릭스 요청
 *  - 첫 호출 시 ~100초 대기 가능 (470건 ODsay 호출)
 *  - 같은 직장 재요청 시 즉시 응답 (~50ms)
 */
export function fetchCommuteMatrix(
  origin: { lat: number; lng: number; label?: string },
  targets: CommuteTarget[],
): Promise<MatrixResponse> {
  return apiFetch<MatrixResponse>('/api/commute/matrix', {
    method: 'POST',
    json: { origin, targets },
  });
}
