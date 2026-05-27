/**
 * Kakao Local API — 주소/키워드 → 좌표 변환.
 *  - REST API 키 사용 (JavaScript 키와 다름)
 *  - Daily quota: 300,000 호출
 */

const KAKAO_REST_API_KEY = process.env.KAKAO_REST_API_KEY;
const DEBUG = process.env.KAKAO_DEBUG === '1';
if (!KAKAO_REST_API_KEY) {
  console.warn('[geocoder] KAKAO_REST_API_KEY is not set');
}

export interface LatLng {
  lat: number;
  lng: number;
}

interface KakaoSearchResp {
  documents?: Array<{ x: string; y: string; address_name?: string }>;
}

/** 주소 → 좌표. 미발견 시 null */
export async function geocodeAddress(addr: string): Promise<LatLng | null> {
  if (!KAKAO_REST_API_KEY || !addr) return null;

  const url = new URL('https://dapi.kakao.com/v2/local/search/address.json');
  url.searchParams.set('query', addr);

  const res = await fetch(url, {
    headers: { Authorization: `KakaoAK ${KAKAO_REST_API_KEY}` },
  });
  if (!res.ok) {
    if (DEBUG) {
      const body = await res.text().catch(() => '');
      console.warn(`[geocoder] address ${res.status} for "${addr}": ${body.slice(0, 200)}`);
    }
    return null;
  }

  const data = (await res.json()) as KakaoSearchResp;
  const first = data.documents?.[0];
  if (DEBUG && !first) console.log(`[geocoder] address miss: "${addr}"`);
  if (!first) return null;
  return { lat: parseFloat(first.y), lng: parseFloat(first.x) };
}

/** 키워드(단지명 + 동) → 좌표. 주소 변환 실패 시 fallback. */
export async function geocodeKeyword(keyword: string): Promise<LatLng | null> {
  if (!KAKAO_REST_API_KEY || !keyword) return null;

  const url = new URL('https://dapi.kakao.com/v2/local/search/keyword.json');
  url.searchParams.set('query', keyword);
  url.searchParams.set('size', '1');

  const res = await fetch(url, {
    headers: { Authorization: `KakaoAK ${KAKAO_REST_API_KEY}` },
  });
  if (!res.ok) {
    if (DEBUG) {
      const body = await res.text().catch(() => '');
      console.warn(`[geocoder] keyword ${res.status} for "${keyword}": ${body.slice(0, 200)}`);
    }
    return null;
  }

  const data = (await res.json()) as KakaoSearchResp;
  const first = data.documents?.[0];
  if (DEBUG && !first) console.log(`[geocoder] keyword miss: "${keyword}"`);
  if (!first) return null;
  return { lat: parseFloat(first.y), lng: parseFloat(first.x) };
}

/** 주소 → 키워드 순으로 시도 */
export async function geocodeFlexible(opts: {
  roadAddr?: string | null;
  jibunAddr?: string | null;
  keyword?: string | null;
}): Promise<LatLng | null> {
  if (opts.roadAddr) {
    const r = await geocodeAddress(opts.roadAddr);
    if (r) return r;
  }
  if (opts.jibunAddr) {
    const r = await geocodeAddress(opts.jibunAddr);
    if (r) return r;
  }
  if (opts.keyword) {
    const r = await geocodeKeyword(opts.keyword);
    if (r) return r;
  }
  return null;
}

/* ─── 좌표 → 행정동 코드 (2026-05-27, Phase 2-B) ─────────────── */

interface KakaoRegionCodeResp {
  documents?: Array<{
    region_type: 'B' | 'H';        // B=법정동, H=행정동
    code: string;                  // 10자리 BJD
    address_name?: string;
    region_1depth_name?: string;
    region_2depth_name?: string;
    region_3depth_name?: string;
  }>;
}

export interface RegionCodeResult {
  /** 법정동 10자리 (BJD 코드, region_type='B') */
  legalDongCode: string;
  /** 행정동 10자리 (region_type='H', 다를 수 있음) */
  adminDongCode: string | null;
  /** "서울특별시 강남구 역삼동" 형식 */
  addressName: string | null;
}

/**
 * 좌표(WGS84) → 법정동(B)·행정동(H) 코드 일괄 조회.
 *  - region_type='B' 가 우리 t_legal_dong 시드와 일치하는 BJD 10자리
 *  - 한 좌표에 B/H 두 row 가 함께 응답됨 (보통 다른 코드)
 *  - 매칭 실패 시 null
 */
export async function coord2regioncode(
  lat: number,
  lng: number,
): Promise<RegionCodeResult | null> {
  if (!KAKAO_REST_API_KEY) return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const url = new URL('https://dapi.kakao.com/v2/local/geo/coord2regioncode.json');
  url.searchParams.set('x', String(lng));
  url.searchParams.set('y', String(lat));

  const res = await fetch(url, {
    headers: { Authorization: `KakaoAK ${KAKAO_REST_API_KEY}` },
  });
  if (!res.ok) {
    if (DEBUG) {
      const body = await res.text().catch(() => '');
      console.warn(`[geocoder] coord2region ${res.status} for (${lat},${lng}): ${body.slice(0, 200)}`);
    }
    return null;
  }

  const data = (await res.json()) as KakaoRegionCodeResp;
  const bRow = data.documents?.find((d) => d.region_type === 'B');
  const hRow = data.documents?.find((d) => d.region_type === 'H');
  if (!bRow) {
    if (DEBUG) console.log(`[geocoder] coord2region B-row miss: (${lat},${lng})`);
    return null;
  }
  return {
    legalDongCode: bRow.code,
    adminDongCode: hRow?.code ?? null,
    addressName: bRow.address_name ?? null,
  };
}

/** addressToLegalDongCode 결과 — 좌표 + 행정동 코드 묶음 */
export interface AddressResolveResult extends RegionCodeResult {
  lat: number;
  lng: number;
}

/**
 * 주소 → 좌표 + 법정동 10자리 한 번에 (geocodeAddress + coord2regioncode 결합)
 *  - 캐싱 권장: 호출자에서 Map<address, result> 보관
 *  - rate-limit: Kakao 일 30만 호출 → 일반 seed 작업(<1만 row)에는 충분
 *  - 좌표 변환 후 region 매칭 실패 시 좌표만이라도 활용 가능하도록 별도 처리 가능
 */
export async function addressToLegalDongCode(addr: string): Promise<AddressResolveResult | null> {
  const ll = await geocodeAddress(addr);
  if (!ll) return null;
  const region = await coord2regioncode(ll.lat, ll.lng);
  if (!region) return null;
  return { ...region, lat: ll.lat, lng: ll.lng };
}
