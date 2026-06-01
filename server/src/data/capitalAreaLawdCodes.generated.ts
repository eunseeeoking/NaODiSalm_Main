/**
 * ⚠️ 자동 생성 파일 — 직접 수정 금지.
 *
 *  생성기: `npm run gen:lawd` (scripts/genLawdCodes.ts)
 *  원본(단일 진실): client/public/data/capital-centroids.json
 *
 *  수도권(서울·인천·경기) 시군구 LAWD_CD 목록. 행정동 universe 와 동일한 소스에서
 *  파생되므로 추천·동 집계와 코드가 항상 일치한다(부천·화성 구 개편 등 드리프트 방지).
 *  코드/행정구역이 바뀌면 centroids 를 갱신한 뒤 `npm run gen:lawd` 재실행.
 *
 *  생성 시각: 2026-05-31 · 시군구 82개 (서울 25 · 인천 10 · 경기 47)
 */

export interface LawdEntry {
  /** LAWD_CD 5자리(시군구). 구가 있는 시는 구 단위 코드(예: 수원시영통구 41117). */
  code: string;
  /** 시군구명(centroids 표기 그대로, 구 단위는 "수원시장안구" 형식). */
  name: string;
  /** 시도명. */
  sido: string;
}

export const CAPITAL_AREA_LAWD_CODES: ReadonlyArray<LawdEntry> = [
  { code: '11110', name: '종로구', sido: '서울특별시' },
  { code: '11140', name: '중구', sido: '서울특별시' },
  { code: '11170', name: '용산구', sido: '서울특별시' },
  { code: '11200', name: '성동구', sido: '서울특별시' },
  { code: '11215', name: '광진구', sido: '서울특별시' },
  { code: '11230', name: '동대문구', sido: '서울특별시' },
  { code: '11260', name: '중랑구', sido: '서울특별시' },
  { code: '11290', name: '성북구', sido: '서울특별시' },
  { code: '11305', name: '강북구', sido: '서울특별시' },
  { code: '11320', name: '도봉구', sido: '서울특별시' },
  { code: '11350', name: '노원구', sido: '서울특별시' },
  { code: '11380', name: '은평구', sido: '서울특별시' },
  { code: '11410', name: '서대문구', sido: '서울특별시' },
  { code: '11440', name: '마포구', sido: '서울특별시' },
  { code: '11470', name: '양천구', sido: '서울특별시' },
  { code: '11500', name: '강서구', sido: '서울특별시' },
  { code: '11530', name: '구로구', sido: '서울특별시' },
  { code: '11545', name: '금천구', sido: '서울특별시' },
  { code: '11560', name: '영등포구', sido: '서울특별시' },
  { code: '11590', name: '동작구', sido: '서울특별시' },
  { code: '11620', name: '관악구', sido: '서울특별시' },
  { code: '11650', name: '서초구', sido: '서울특별시' },
  { code: '11680', name: '강남구', sido: '서울특별시' },
  { code: '11710', name: '송파구', sido: '서울특별시' },
  { code: '11740', name: '강동구', sido: '서울특별시' },
  { code: '28110', name: '중구', sido: '인천광역시' },
  { code: '28140', name: '동구', sido: '인천광역시' },
  { code: '28177', name: '미추홀구', sido: '인천광역시' },
  { code: '28185', name: '연수구', sido: '인천광역시' },
  { code: '28200', name: '남동구', sido: '인천광역시' },
  { code: '28237', name: '부평구', sido: '인천광역시' },
  { code: '28245', name: '계양구', sido: '인천광역시' },
  { code: '28260', name: '서구', sido: '인천광역시' },
  { code: '28710', name: '강화군', sido: '인천광역시' },
  { code: '28720', name: '옹진군', sido: '인천광역시' },
  { code: '41111', name: '수원시장안구', sido: '경기도' },
  { code: '41113', name: '수원시권선구', sido: '경기도' },
  { code: '41115', name: '수원시팔달구', sido: '경기도' },
  { code: '41117', name: '수원시영통구', sido: '경기도' },
  { code: '41131', name: '성남시수정구', sido: '경기도' },
  { code: '41133', name: '성남시중원구', sido: '경기도' },
  { code: '41135', name: '성남시분당구', sido: '경기도' },
  { code: '41150', name: '의정부시', sido: '경기도' },
  { code: '41171', name: '안양시만안구', sido: '경기도' },
  { code: '41173', name: '안양시동안구', sido: '경기도' },
  { code: '41192', name: '부천시원미구', sido: '경기도' },
  { code: '41194', name: '부천시소사구', sido: '경기도' },
  { code: '41196', name: '부천시오정구', sido: '경기도' },
  { code: '41210', name: '광명시', sido: '경기도' },
  { code: '41220', name: '평택시', sido: '경기도' },
  { code: '41250', name: '동두천시', sido: '경기도' },
  { code: '41271', name: '안산시상록구', sido: '경기도' },
  { code: '41273', name: '안산시단원구', sido: '경기도' },
  { code: '41281', name: '고양시덕양구', sido: '경기도' },
  { code: '41285', name: '고양시일산동구', sido: '경기도' },
  { code: '41287', name: '고양시일산서구', sido: '경기도' },
  { code: '41290', name: '과천시', sido: '경기도' },
  { code: '41310', name: '구리시', sido: '경기도' },
  { code: '41360', name: '남양주시', sido: '경기도' },
  { code: '41370', name: '오산시', sido: '경기도' },
  { code: '41390', name: '시흥시', sido: '경기도' },
  { code: '41410', name: '군포시', sido: '경기도' },
  { code: '41430', name: '의왕시', sido: '경기도' },
  { code: '41450', name: '하남시', sido: '경기도' },
  { code: '41461', name: '용인시처인구', sido: '경기도' },
  { code: '41463', name: '용인시기흥구', sido: '경기도' },
  { code: '41465', name: '용인시수지구', sido: '경기도' },
  { code: '41480', name: '파주시', sido: '경기도' },
  { code: '41500', name: '이천시', sido: '경기도' },
  { code: '41550', name: '안성시', sido: '경기도' },
  { code: '41570', name: '김포시', sido: '경기도' },
  { code: '41591', name: '화성시만세구', sido: '경기도' },
  { code: '41593', name: '화성시효행구', sido: '경기도' },
  { code: '41595', name: '화성시병점구', sido: '경기도' },
  { code: '41597', name: '화성시동탄구', sido: '경기도' },
  { code: '41610', name: '광주시', sido: '경기도' },
  { code: '41630', name: '양주시', sido: '경기도' },
  { code: '41650', name: '포천시', sido: '경기도' },
  { code: '41670', name: '여주시', sido: '경기도' },
  { code: '41800', name: '연천군', sido: '경기도' },
  { code: '41820', name: '가평군', sido: '경기도' },
  { code: '41830', name: '양평군', sido: '경기도' },
];
