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
 * 서버 가드 상한 — POST /api/commute/matrix 는 targets 1000개까지만 허용.
 * 수도권 확장(서울+경기+인천) 후 행정동 1000개 초과 가능
 *   → 클라이언트에서 자동 chunk 분할 + 결과 병합
 */
const CHUNK_SIZE = 900; // 가드 1000 보다 여유 100 (안전 마진)

/**
 * 통근 매트릭스 요청
 *  - targets ≤ 900 : 단일 요청
 *  - targets > 900 : 자동 chunk 분할 → 순차 호출 → 결과 병합
 *  - 첫 호출 시 ~100초 대기 가능 (470건 ODsay 호출)
 *  - 같은 직장 재요청 시 즉시 응답 (~50ms)
 */
export async function fetchCommuteMatrix(
  origin: { lat: number; lng: number; label?: string },
  targets: CommuteTarget[],
  signal?: AbortSignal,
): Promise<MatrixResponse> {
  if (targets.length <= CHUNK_SIZE) {
    return apiFetch<MatrixResponse>('/api/commute/matrix', {
      method: 'POST',
      json: { origin, targets },
      signal,
    });
  }

  // chunk 분할 + 순차 호출 + 결과 병합
  const merged: MatrixResponse = {
    cacheKey: '',
    cacheHit: 0,
    cacheNearby: 0,
    cacheMiss: 0,
    written: 0,
    elapsedMs: 0,
    matrix: {},
  };

  for (let i = 0; i < targets.length; i += CHUNK_SIZE) {
    const chunk = targets.slice(i, i + CHUNK_SIZE);
    const resp = await apiFetch<MatrixResponse>('/api/commute/matrix', {
      method: 'POST',
      json: { origin, targets: chunk },
      signal,
    });

    // 결과 병합
    if (!merged.cacheKey) merged.cacheKey = resp.cacheKey;
    merged.cacheHit += resp.cacheHit;
    merged.cacheNearby += resp.cacheNearby;
    merged.cacheMiss += resp.cacheMiss;
    merged.written += resp.written;
    merged.elapsedMs += resp.elapsedMs;
    Object.assign(merged.matrix, resp.matrix);
  }

  return merged;
}
