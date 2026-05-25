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
 * 서울 출퇴근 시간대 자차 소요시간 추정 (비선형 거리 구간 보정)
 *
 *  단순 km÷속도 대신 구간별 분/km 계수 사용:
 *    · 1km 미만  → 20분 고정 (주차 탐색·엘리베이터 = 도보보다 느림)
 *    · 1~5km     → 8분/km + 10분 기본 (신호·정체 빈번한 도심 단거리)
 *    · 5~15km    → 6분/km + 15분 기본 (강남권 핵심 정체 구간)
 *    · 15km+     → 5분/km + 20분 기본 (외곽 — 상대적으로 빠르나 거리 패널티)
 *
 *  기준: 출퇴근 러시아워(07~09시, 18~20시) 평균, 실 내비 데이터 참고
 *  ODsay API 없는 환경의 fallback — ODsay 캐시 hit 시 이 값은 사용되지 않음
 */
export function estimateCarMinutes(
  origin: { lat: number; lng: number },
  dest: { lat: number; lng: number },
): number {
  const km = haversineKm(origin, dest);
  return seoulRushHourCarMinutes(km);
}

/** 직선거리(km) → 서울 출퇴근 자차 소요시간(분) */
export function seoulRushHourCarMinutes(km: number): number {
  if (km < 1)  return 20;
  if (km < 5)  return Math.round(km * 8) + 10;
  if (km < 15) return Math.round(km * 6) + 15;
  return       Math.round(km * 5) + 20;
}

// ─── 카카오 모빌리티 자차 경로 ───────────────────────────────────

const KAKAO_REST_API_KEY = process.env.KAKAO_REST_API_KEY;
const KAKAO_NAV_ENDPOINT = 'https://apis-navi.kakaomobility.com/v1/directions';

export interface KakaoCarResult {
  /** 자차 소요시간 (분, RECOMMEND 경로 기준) */
  carMinutes: number;
  /** 경로 거리 (km) */
  carDistanceKm: number;
}

interface KakaoNavResponse {
  routes?: Array<{
    result_code?: number;
    summary?: {
      duration?: number;  // 초
      distance?: number;  // 미터
    };
  }>;
}

/**
 * 카카오 모빌리티 길찾기 API — 자차 소요시간
 *  · 엔드포인트: https://apis-navi.kakaomobility.com/v1/directions
 *  · 인증: KakaoAK {KAKAO_REST_API_KEY}  (이미 .env 에 있음 — 추가 발급 불필요)
 *  · 응답: routes[0].summary.duration (초), distance (미터)
 *  · 실패 시 null → 호출부에서 estimateCarMinutes() 폴백
 *
 *  ⚠️ 좌표 순서: Kakao 는 lng,lat (경도,위도) 순서
 *  ⚠️ 무료 일 300,000건 — 충분, 캐시 hit 시 미호출
 */
export async function fetchKakaoCarRoute(
  origin: { lat: number; lng: number },
  dest: { lat: number; lng: number },
): Promise<KakaoCarResult | null> {
  if (!KAKAO_REST_API_KEY) {
    console.warn('[kakao] KAKAO_REST_API_KEY is not set — falling back to estimate');
    return null;
  }

  const url = new URL(KAKAO_NAV_ENDPOINT);
  // Kakao 는 경도(lng),위도(lat) 순서
  url.searchParams.set('origin', `${origin.lng},${origin.lat}`);
  url.searchParams.set('destination', `${dest.lng},${dest.lat}`);
  url.searchParams.set('priority', 'RECOMMEND');

  try {
    const res = await fetch(url.toString(), {
      headers: { Authorization: `KakaoAK ${KAKAO_REST_API_KEY}` },
    });
    if (!res.ok) {
      console.warn(`[kakao] HTTP ${res.status} ${res.statusText}`);
      return null;
    }
    const json = (await res.json()) as KakaoNavResponse;
    const route = json.routes?.[0];
    if (!route || route.result_code !== 0 || !route.summary) {
      console.warn('[kakao] no valid route in response');
      return null;
    }

    const seconds = route.summary.duration ?? 0;
    const meters  = route.summary.distance ?? 0;
    return {
      carMinutes:    Math.max(1, Math.round(seconds / 60)),
      carDistanceKm: Math.round((meters / 1000) * 10) / 10,
    };
  } catch (e) {
    console.error('[kakao] fetch fail:', e);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────

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
