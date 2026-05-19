/**
 * ODsay LAB 대중교통 길찾기 API 클라이언트
 *
 *  · 엔드포인트: https://api.odsay.com/v1/api/searchPubTransPathT
 *  · 파라미터  : SX(출발 lng), SY(출발 lat), EX(도착 lng), EY(도착 lat), apiKey
 *  · 응답      : 여러 경로 중 result.path[0] 가 최단경로
 *               · info.totalTime    (분)
 *               · info.payment       (원, 편도)
 *               · info.busTransitCount + subwayTransitCount (환승 횟수)
 *
 *  ⚠️ 좌표 순서 주의 — ODsay 는 (lng, lat) = (x, y) 순서
 *      카카오/우리 도메인 객체는 (lat, lng) 이므로 변환 필요
 *
 *  ⚠️ 무료 한도 (개인): 일 1,000건, 초당 5건
 *      → 배치 호출 시 fetchOdsayBatch 의 rate-limit 사용
 */

const API_KEY = process.env.ODSAY_API_KEY;
if (!API_KEY) {
  console.warn('[odsay] ODSAY_API_KEY is not set');
}

const ENDPOINT = 'https://api.odsay.com/v1/api/searchPubTransPathT';

export interface OdsayResult {
  /** 대중교통 통근시간 (분) */
  transitMinutes: number;
  /** 환승 횟수 (지하철 + 버스) */
  transitTransfers: number;
  /** 편도 비용 (원) */
  transitCostWon: number;
}

interface OdsayRawResponse {
  result?: {
    path?: Array<{
      info?: {
        totalTime?: number;
        payment?: number;
        busTransitCount?: number;
        subwayTransitCount?: number;
      };
    }>;
  };
  error?: {
    code?: string;
    msg?: string;
  };
}

/**
 * 단일 경로 호출
 *  - 좌표 단위는 WGS84
 *  - 실패 시 null (rate limit 초과 / 좌표 오류 / 경로 없음 등)
 */
export async function fetchOdsayRoute(
  origin: { lat: number; lng: number },
  dest: { lat: number; lng: number },
): Promise<OdsayResult | null> {
  if (!API_KEY) throw new Error('ODSAY_API_KEY is not set');

  const url = new URL(ENDPOINT);
  url.searchParams.set('SX', String(origin.lng));
  url.searchParams.set('SY', String(origin.lat));
  url.searchParams.set('EX', String(dest.lng));
  url.searchParams.set('EY', String(dest.lat));
  url.searchParams.set('apiKey', API_KEY);

  const debug = process.env.ODSAY_DEBUG === '1';
  if (debug) {
    const safe = url.toString().replace(API_KEY, '***');
    console.log(`[odsay] GET ${safe}`);
  }

  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`[odsay] HTTP ${res.status}`);
      return null;
    }
    const json = (await res.json()) as OdsayRawResponse;

    if (json.error) {
      // -98 = 도보 단거리(경로 없음), -99 = 출발지/도착지 동일
      const code = json.error.code;
      if (code !== '-98' && code !== '-99') {
        console.warn(`[odsay] error code=${code} msg=${json.error.msg}`);
      }
      return null;
    }

    const path = json.result?.path?.[0];
    if (!path?.info) return null;

    return {
      transitMinutes: Math.round(path.info.totalTime ?? 0),
      transitTransfers:
        (path.info.busTransitCount ?? 0) + (path.info.subwayTransitCount ?? 0),
      transitCostWon: path.info.payment ?? 0,
    };
  } catch (e) {
    console.error('[odsay] fetch fail:', e);
    return null;
  }
}

/**
 * 배치 호출 (rate-limit 적용)
 *  - 초당 5건 × concurrency 5 = ~5건/sec
 *  - 한 배치 5건 호출 후 1.1초 대기 → 안전 마진
 *  - 응답 순서는 입력 targets 순서와 동일 (실패 시 해당 인덱스 null)
 *
 *  ⏱ 470개 호출 ≈ 약 95~100초 (사용자 대기 시간)
 *     발표 데모 시연용 직장은 사전 캐싱 권장
 */
export async function fetchOdsayBatch(
  origin: { lat: number; lng: number },
  targets: Array<{ lat: number; lng: number }>,
  options: { concurrency?: number; intervalMs?: number } = {},
): Promise<Array<OdsayResult | null>> {
  const concurrency = options.concurrency ?? 5;
  const intervalMs = options.intervalMs ?? 1100;

  const results: Array<OdsayResult | null> = new Array(targets.length).fill(
    null,
  );
  for (let i = 0; i < targets.length; i += concurrency) {
    const batch = targets.slice(i, i + concurrency);
    const settled = await Promise.all(
      batch.map((t) => fetchOdsayRoute(origin, t)),
    );
    for (let j = 0; j < settled.length; j++) {
      results[i + j] = settled[j];
    }
    if (i + concurrency < targets.length) {
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }
  return results;
}

/**
 * WGS84 Haversine 거리 (km)
 *  - 직선 거리, 도로 굴곡 미반영
 *  - 캐시 KNN 후보 중 가장 가까운 좌표 선택용
 */
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
 * 자차 통근시간 추정 (Haversine 거리 기반)
 *  - 도로 굴곡 보정 ×1.4, 시속 35km (도심 평균)
 *  - ODsay 와 별개 — 클라이언트 비교용
 */
export function estimateCarMinutes(
  origin: { lat: number; lng: number },
  dest: { lat: number; lng: number },
): number {
  const km = haversineKm(origin, dest);
  const roadKm = km * 1.4;
  return Math.round((roadKm / 35) * 60);
}

/**
 * 캐시 키 생성 — 직장 좌표 4자리 반올림
 *   같은 빌딩 다른 층 입력해도 같은 키 → 캐시 hit
 *   4자리 ≈ 11m × 9m 정확도
 */
export function makeCacheKey(lat: number, lng: number): string {
  return `${lat.toFixed(4)}_${lng.toFixed(4)}`;
}

/**
 * 캐시 키 후보 9개 (중심 + 8방향)
 *  - KNN 격자 확장 검색용
 *  - 3×3 격자 ≈ 33m × 27m 범위 (서울 위도 37°)
 *
 *  ⚠️ 부동소수 오차 회피
 *      lat * 10000 정수 단계에서 ±1 한 뒤 다시 /10000 → toFixed(4)
 */
export function makeCacheKeyCandidates(lat: number, lng: number): string[] {
  const latInt = Math.round(lat * 10000);
  const lngInt = Math.round(lng * 10000);
  const candidates: string[] = [];
  for (const dLat of [-1, 0, 1]) {
    for (const dLng of [-1, 0, 1]) {
      const a = ((latInt + dLat) / 10000).toFixed(4);
      const b = ((lngInt + dLng) / 10000).toFixed(4);
      candidates.push(`${a}_${b}`);
    }
  }
  return candidates;
}
