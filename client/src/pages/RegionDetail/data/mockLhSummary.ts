/**
 * LH 청년주택 집계 mock
 *  - 실 API (`/api/regions/:legalDongCode/lh-summary`) 미적재 시 폴백
 *  - Phase 1.5 (2026-05-27): 시군구 5자리 → LhSummary (scope='SIGUNGU')
 *  - Phase 2-B (2026-05-27): 행정동 10자리 정밀도 추가 — DONG 표시용 데모 1~2개
 */
import type { LhSummary } from '../../../types/region-detail';

type MockRow = Omit<LhSummary, 'sigunguCode' | 'legalDongCode' | 'scope'>;

const SUMMARY_BY_SIGUNGU: Record<string, MockRow> = {
  // 영등포구 — LH 공급 활발
  '11560': {
    totalRows: 6,
    totalUnits: 412,
    programs: [
      { programType: '행복주택',     rows: 3, units: 286, monthlyRentMin: 12, monthlyRentMax: 28 },
      { programType: '청년매입임대', rows: 2, units: 96,  monthlyRentMin: 8,  monthlyRentMax: 18 },
      { programType: '전세임대',     rows: 1, units: 30,  monthlyRentMin: null, monthlyRentMax: null },
    ],
  },
  // 강서구 — LH 다수
  '11500': {
    totalRows: 7,
    totalUnits: 540,
    programs: [
      { programType: '행복주택',     rows: 4, units: 380, monthlyRentMin: 14, monthlyRentMax: 32 },
      { programType: '청년매입임대', rows: 2, units: 110, monthlyRentMin: 9,  monthlyRentMax: 20 },
      { programType: '전세임대',     rows: 1, units: 50,  monthlyRentMin: null, monthlyRentMax: null },
    ],
  },
  // 마포구
  '11440': {
    totalRows: 3,
    totalUnits: 178,
    programs: [
      { programType: '행복주택',     rows: 2, units: 142, monthlyRentMin: 16, monthlyRentMax: 35 },
      { programType: '청년매입임대', rows: 1, units: 36,  monthlyRentMin: 10, monthlyRentMax: 22 },
    ],
  },
  // 구로구
  '11530': {
    totalRows: 4,
    totalUnits: 256,
    programs: [
      { programType: '행복주택',     rows: 2, units: 180, monthlyRentMin: 11, monthlyRentMax: 26 },
      { programType: '청년매입임대', rows: 1, units: 46,  monthlyRentMin: 7,  monthlyRentMax: 16 },
      { programType: '전세임대',     rows: 1, units: 30,  monthlyRentMin: null, monthlyRentMax: null },
    ],
  },
  // 강남·서초·송파·용산 — 매매 위주 지역, LH 적음/없음
  '11680': { totalRows: 0, totalUnits: 0, programs: [] },
  '11650': { totalRows: 0, totalUnits: 0, programs: [] },
  '11710': { totalRows: 1, totalUnits: 24, programs: [
    { programType: '청년매입임대', rows: 1, units: 24, monthlyRentMin: 18, monthlyRentMax: 28 },
  ] },
  '11170': { totalRows: 0, totalUnits: 0, programs: [] },
};

/**
 * Phase 2-B 데모용 — 행정동 10자리 정밀도 mock.
 *  - 영등포구 당산동(1156013000)에 행정동 단위 데이터가 있다고 가정
 *  - 실 API 가 채워지면 자연스럽게 교체됨
 */
const SUMMARY_BY_DONG: Record<string, MockRow> = {
  '1156013000': {
    totalRows: 2,
    totalUnits: 168,
    programs: [
      { programType: '행복주택',     rows: 1, units: 120, monthlyRentMin: 12, monthlyRentMax: 28 },
      { programType: '청년매입임대', rows: 1, units: 48,  monthlyRentMin: 8,  monthlyRentMax: 18 },
    ],
  },
};

export function getMockLhSummary(legalDongCode: string): LhSummary {
  const sigunguCode = legalDongCode.slice(0, 5);

  // 1) 행정동 10자리 정확 일치 (DONG scope)
  const dongRow = SUMMARY_BY_DONG[legalDongCode];
  if (dongRow && dongRow.totalRows > 0) {
    const sigRow = SUMMARY_BY_SIGUNGU[sigunguCode];
    return {
      sigunguCode,
      legalDongCode,
      scope: 'DONG',
      ...dongRow,
      sigunguTotalRows: sigRow?.totalRows ?? dongRow.totalRows,
      sigunguTotalUnits: sigRow?.totalUnits ?? dongRow.totalUnits,
    };
  }

  // 2) 시군구 5자리 폴백 (SIGUNGU scope)
  const sigRow = SUMMARY_BY_SIGUNGU[sigunguCode];
  if (sigRow && sigRow.totalRows > 0) {
    return {
      sigunguCode,
      legalDongCode,
      scope: 'SIGUNGU',
      ...sigRow,
      sigunguTotalRows: sigRow.totalRows,
      sigunguTotalUnits: sigRow.totalUnits,
    };
  }

  // 3) 양쪽 모두 0 (INSUFFICIENT → 배너 숨김)
  return {
    sigunguCode,
    legalDongCode,
    scope: 'INSUFFICIENT',
    totalRows: 0,
    totalUnits: 0,
    programs: [],
    sigunguTotalRows: 0,
    sigunguTotalUnits: 0,
  };
}
