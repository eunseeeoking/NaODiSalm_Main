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
