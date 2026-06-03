import { CAPITAL_AREA_LAWD_CODES as CAPITAL } from './capitalAreaLawdCodes.generated';

/**
 * 서울 25 구 법정동 코드 (LAWD_CD, 5자리).
 *  - 국토부 실거래가 API 의 LAWD_CD 파라미터로 사용
 *  - 전국으로 확장하려면 행정안전부 법정동코드 CSV 를 받아 t_legal_dong 에 적재
 */
export const SEOUL_LAWD_CODES: ReadonlyArray<{ code: string; name: string }> = [
  { code: '11680', name: '강남구' },
  { code: '11740', name: '강동구' },
  { code: '11305', name: '강북구' },
  { code: '11500', name: '강서구' },
  { code: '11620', name: '관악구' },
  { code: '11215', name: '광진구' },
  { code: '11530', name: '구로구' },
  { code: '11545', name: '금천구' },
  { code: '11350', name: '노원구' },
  { code: '11320', name: '도봉구' },
  { code: '11230', name: '동대문구' },
  { code: '11590', name: '동작구' },
  { code: '11440', name: '마포구' },
  { code: '11410', name: '서대문구' },
  { code: '11650', name: '서초구' },
  { code: '11200', name: '성동구' },
  { code: '11290', name: '성북구' },
  { code: '11710', name: '송파구' },
  { code: '11470', name: '양천구' },
  { code: '11560', name: '영등포구' },
  { code: '11170', name: '용산구' },
  { code: '11380', name: '은평구' },
  { code: '11110', name: '종로구' },
  { code: '11140', name: '중구' },
  { code: '11260', name: '중랑구' },
];

export type SigunguCode = (typeof SEOUL_LAWD_CODES)[number]['code'];

/* ────────────────────────────────────────────────────────────────
 * 수도권(서울·인천·경기) LAWD_CD — 자동 생성 소스에서 파생
 *
 *  단일 진실: client/public/data/capital-centroids.json (행정동 universe).
 *  생성: `npm run gen:lawd` → src/data/capitalAreaLawdCodes.generated.ts
 *
 *  손으로 코드를 유지하지 않으므로 행정구역 개편(부천·화성 구 신설 등)
 *  드리프트가 구조적으로 불가능. 아래 INCHEON/GYEONGGI 는 합본의 sido 필터 뷰.
 *
 *  ※ SEOUL_LAWD_CODES(위, 서울 전용 하드코딩)는 REB name→code 맵·LH 시드 등
 *    서울 전용 경로 호환을 위해 그대로 유지한다(수도권 확장은 합본을 통해서만).
 * ──────────────────────────────────────────────────────────────── */

export { type LawdEntry, CAPITAL_AREA_LAWD_CODES } from './capitalAreaLawdCodes.generated';

/** 인천광역시 시군구 (합본의 sido='인천광역시' 뷰). */
export const INCHEON_LAWD_CODES = CAPITAL.filter((e) => e.sido === '인천광역시');

/** 경기도 시군구 (합본의 sido='경기도' 뷰). 구가 있는 시는 구 단위 코드. */
export const GYEONGGI_LAWD_CODES = CAPITAL.filter((e) => e.sido === '경기도');

/** bulk ingest 등에서 지역 단위로 시군구 코드를 고를 때 쓰는 키. */
export type LawdRegion = 'seoul' | 'capital' | 'incheon' | 'gyeonggi';

export const LAWD_REGIONS: ReadonlyArray<LawdRegion> = [
  'seoul',
  'capital',
  'incheon',
  'gyeonggi',
];

/**
 * 지역 키 → 시군구 LAWD_CD 배열.
 *  - 'seoul'    : 서울 25구 (기본·하위호환)
 *  - 'capital'  : 수도권 전체 82개 (서울+인천+경기)
 *  - 'incheon'  : 인천 10개
 *  - 'gyeonggi' : 경기 47개
 */
export function lawdCodesByRegion(region: LawdRegion = 'seoul'): string[] {
  switch (region) {
    case 'capital':
      return CAPITAL.map((e) => e.code);
    case 'incheon':
      return INCHEON_LAWD_CODES.map((e) => e.code);
    case 'gyeonggi':
      return GYEONGGI_LAWD_CODES.map((e) => e.code);
    case 'seoul':
    default:
      return SEOUL_LAWD_CODES.map((s) => s.code);
  }
}
