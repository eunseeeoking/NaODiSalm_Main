/**
 * Kakao Local 카테고리 검색 클라이언트 — 행정동 생활편의(POI) 요약 (KI-4, 2026-05-31)
 *
 *  ▷ 엔드포인트: https://dapi.kakao.com/v2/local/search/category.json
 *    좌표(x=lng, y=lat) 기준 반경(radius, m) 내 카테고리 그룹 검색.
 *    응답 meta.total_count 가 반경 내 해당 카테고리 총 개수 → 페이지네이션 불필요.
 *
 *  ▷ 인증키: KAKAO_REST_API_KEY (.env) — 지오코더(geocoder.ts)와 동일 REST 키 재사용.
 *    일일 quota 300,000 호출. 동당 8 카테고리 호출 → 서울 ~400동 ≈ 3,200 호출(여유).
 *
 *  ▷ lifeScore 산출 (0~100)
 *    카테고리별 forwardLinear(count, 0, cap) → 0~100 서브점수
 *    lifeScore = Σ(weight_i × subscore_i)  (weight 합 = 1)
 *    1인가구 청년 관점: 지하철·편의점·외식(카페·음식점) 비중 높임.
 *
 *  ▷ 미적재 fallback
 *    KAKAO_REST_API_KEY 미설정 → null 반환(시드가 경고). 호출 실패 카테고리는 0 카운트.
 */

const KAKAO_REST_API_KEY = process.env.KAKAO_REST_API_KEY;
const DEBUG = process.env.KAKAO_DEBUG === '1';
const BASE_URL = 'https://dapi.kakao.com/v2/local/search/category.json';

if (!KAKAO_REST_API_KEY) {
  console.warn('[kakaoPoiClient] KAKAO_REST_API_KEY 미설정 — lifeScore 수집 불가(null fallback)');
}

/* ─── 카테고리 정의 (카카오 category_group_code) ───────────────
 *  cap: 반경 내 포화 기준(이 개수 이상이면 서브점수 100). 1인가구 생활권 기준 보수적 설정.
 *  weight: lifeScore 가중치(합 = 1.00).
 */
export interface PoiCategory {
  key: keyof PoiCounts;
  code: string;
  label: string;
  cap: number;
  weight: number;
}

export const POI_CATEGORIES: readonly PoiCategory[] = [
  { key: 'subwayCount',      code: 'SW8', label: '지하철역',  cap: 3,  weight: 0.22 },
  { key: 'convenienceCount', code: 'CS2', label: '편의점',    cap: 15, weight: 0.18 },
  { key: 'restaurantCount',  code: 'FD6', label: '음식점',    cap: 60, weight: 0.15 },
  { key: 'cafeCount',        code: 'CE7', label: '카페',      cap: 25, weight: 0.12 },
  { key: 'martCount',        code: 'MT1', label: '대형마트',  cap: 3,  weight: 0.12 },
  { key: 'hospitalCount',    code: 'HP8', label: '병원',      cap: 15, weight: 0.09 },
  { key: 'pharmacyCount',    code: 'PM9', label: '약국',      cap: 8,  weight: 0.07 },
  { key: 'bankCount',        code: 'BK9', label: '은행',      cap: 8,  weight: 0.05 },
];

/* ─── 타입 ─────────────────────────────────────────────────── */

export interface PoiCounts {
  subwayCount: number;
  convenienceCount: number;
  restaurantCount: number;
  cafeCount: number;
  martCount: number;
  hospitalCount: number;
  pharmacyCount: number;
  bankCount: number;
}

export interface PoiSummary extends PoiCounts {
  lat: number;
  lng: number;
  lifeScore: number;
}

interface KakaoCategoryResp {
  meta?: { total_count?: number };
}

/* ─── 헬퍼 ─────────────────────────────────────────────────── */

/** value 가 [min, max] 일 때 [0,100] 정방향 매핑. value>=max → 100. */
function forwardLinear(value: number, min: number, max: number): number {
  if (max <= min) return 50;
  if (value <= min) return 0;
  if (value >= max) return 100;
  return ((value - min) / (max - min)) * 100;
}

/** 단일 카테고리 반경 내 총 개수 (meta.total_count). 실패 시 0. */
async function fetchCategoryCount(
  code: string,
  lat: number,
  lng: number,
  radius: number,
): Promise<number> {
  if (!KAKAO_REST_API_KEY) return 0;
  const url = new URL(BASE_URL);
  url.searchParams.set('category_group_code', code);
  url.searchParams.set('x', String(lng));
  url.searchParams.set('y', String(lat));
  url.searchParams.set('radius', String(radius)); // m, 최대 20000
  url.searchParams.set('size', '1'); // total_count 만 필요 → 최소 페이지
  try {
    const res = await fetch(url.toString(), {
      headers: { Authorization: `KakaoAK ${KAKAO_REST_API_KEY}` },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) {
      if (DEBUG) console.warn(`[kakaoPoiClient] ${code} HTTP ${res.status}`);
      return 0;
    }
    const data = (await res.json()) as KakaoCategoryResp;
    return data.meta?.total_count ?? 0;
  } catch (e) {
    if (DEBUG) console.warn(`[kakaoPoiClient] ${code} 실패:`, e);
    return 0;
  }
}

/** 카운트 → lifeScore (0~100). 클라이언트·시드 공용 (순수 함수, 테스트 용이). */
export function computeLifeScore(counts: PoiCounts): number {
  let acc = 0;
  for (const cat of POI_CATEGORIES) {
    const sub = forwardLinear(counts[cat.key], 0, cat.cap);
    acc += cat.weight * sub;
  }
  return Math.min(100, Math.max(0, Math.round(acc)));
}

/* ─── 퍼블릭 API ───────────────────────────────────────────── */

/**
 * 좌표 기반 생활편의 POI 요약 조회.
 *  - 8개 카테고리 반경 내 개수 → lifeScore 산출
 *  - KAKAO_REST_API_KEY 미설정 시 null
 *  @param radius 검색 반경(m). 기본 500 (도보 생활권).
 */
export async function fetchPoiSummary(
  lat: number,
  lng: number,
  radius = 500,
): Promise<PoiSummary | null> {
  if (!KAKAO_REST_API_KEY) return null;

  const counts: PoiCounts = {
    subwayCount: 0, convenienceCount: 0, restaurantCount: 0, cafeCount: 0,
    martCount: 0, hospitalCount: 0, pharmacyCount: 0, bankCount: 0,
  };

  // 카테고리 순차 호출 (rate-limit 보수적). 카테고리 8개라 직렬도 충분히 빠름.
  for (const cat of POI_CATEGORIES) {
    counts[cat.key] = await fetchCategoryCount(cat.code, lat, lng, radius);
  }

  return { lat, lng, ...counts, lifeScore: computeLifeScore(counts) };
}
