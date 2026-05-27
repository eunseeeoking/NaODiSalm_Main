/**
 * Depth 3 (지역 상세) 도메인 타입
 *  - 매물 단지 + LSTM 시계열 + 통근 비교
 *  - 서버 API 도착 전까지 mock 으로 동일 모양 사용
 *
 *  ▷ Phase 0+1 (2026-05-27) — 매물타입×거래유형 2축 도입
 *    · PropertyKind : APT(아파트) / VILLA / OFFICETEL  ※ LH 는 별도 집계 타입 LhSummary 로 분리
 *    · DealType     : SALE(매매) / JEONSE(전세) / MONTHLY(월세)
 *    · 현재 활성 조합: (APT, SALE) — t_apt_complex 출처
 *    · VILLA / OFFICETEL / JEONSE 는 Phase 3 까지 비활성 — 타입만 미리 정의해 API contract 고정
 *
 *  ▷ Phase 1.5 (2026-05-27 revert)
 *    · LH 카드는 단지 디테일(이름·좌표·세대수)이 없어 단지 카드로 표현 불가
 *    · LhSummary 타입으로 시군구 집계만 노출 — AptComplex 에서 LH 전용 필드 모두 제거
 */

/** 매물 종류 — 단지 카드로 노출 가능한 타입만 (LH 는 별도 집계 타입) */
export type PropertyKind = 'APT' | 'VILLA' | 'OFFICETEL';

/** 거래 유형 (Phase 0+1: SALE 만 실데이터) */
export type DealType = 'SALE' | 'JEONSE' | 'MONTHLY';

/** 매물 단지 — 현재는 APT/SALE 만 흐름. Phase 3 에서 VILLA/OFFICETEL 추가 예정. */
export interface AptComplex {
  /** 단지 고유 ID (서버 발급) */
  complexId: string;
  /** 단지명 (예: "래미안 대치팰리스") */
  name: string;
  /** 행정동 코드 (10자리) */
  legalDongCode: string;
  /** 매물 종류 — 현재는 'APT' 만. Phase 3 의 VILLA/OFFICETEL 분기에 재사용 */
  propertyKind: PropertyKind;
  /** 거래 유형 — 현재는 'SALE' 만. Phase 2 의 거래유형 토글 도입 시 분기 */
  dealType: DealType;
  /** 좌표 (지도 핀) — 0/0 이면 지오코딩 미완료, 핀 생략 */
  lat: number;
  lng: number;
  /** 평형 (전용 면적 m²) */
  exclusiveArea: number;
  /** 평형 구간 라벨 */
  sizeBucket: '소형' | '중형' | '중대형' | '대형';
  /** 연식 구간 라벨 */
  ageBucket: '신축' | '준신축' | '중간' | '구축';
  /** 준공년도 */
  builtYear: number;
  /** 세대수 — APT 는 t_apt_complex (현재 0 고정) */
  households: number;
  /** 최근 거래가 (만원) — APT 매매가 */
  recentPrice: number;
  /** m² 당 단가 (만원) — APT 매매 단가 */
  pricePerM2: number;
  /** 3년 후 예상 m² 당 단가 (만원, LSTM) */
  predictedPricePerM2_3y: number;
  /** 예측 신뢰도 (%) */
  confidence: number;
}

/** LSTM 시계열 한 점 — 과거 또는 예측 */
export interface LstmPoint {
  /** YYYY-MM 라벨 */
  ym: string;
  /** m² 당 단가 (만원) */
  pricePerM2: number;
  /** 예측치 신뢰구간 (예측 구간만, 과거는 undefined) */
  lower?: number;
  upper?: number;
  /** 과거(actual) vs 예측(forecast) */
  kind: 'actual' | 'forecast';
}

/**
 * 신뢰도 데이터 출처 (2026-05-27 추가)
 *  - COMPLEX     : 단지 자체 거래 데이터 기반 (가장 정밀)
 *  - LEGAL_DONG  : 단지 거래 부족 → 행정동 집계로 폴백
 *  - SIGUNGU     : 행정동도 부족 → 시군구 집계로 폴백 (ARIMA 전용)
 *  - INSUFFICIENT: 모두 부족 → 횡보 예측 (confidence=50)
 */
export type ConfidenceDataScope = 'COMPLEX' | 'LEGAL_DONG' | 'SIGUNGU' | 'INSUFFICIENT';

export interface LstmAnalysis {
  complexId: string;
  /** 과거 60개월 + 예측 36개월 = 최대 96점 */
  series: LstmPoint[];
  /** 모델 신뢰도 (0~100) */
  confidence: number;
  /** 현재 m²단가 (만원) */
  currentPricePerM2: number;
  /** 1년 후 예측 m²단가 (만원) */
  predicted1yPricePerM2: number;
  /** 3년 후 예측 m²단가 (만원) */
  predicted3yPricePerM2: number;
  /**
   * 3년 가격 변동성 (%)
   *  - "투자 수익률" 표현 제거 — 가격 안정성 지표로 재정의 (컨셉 전환 2026-05-24)
   *  - 서버 호환 필드명 유지 (제거 X)
   */
  expectedReturn3y: number;
  /** 신뢰도 산출 데이터 출처 (UI 도넛 옆 칩 표시용) */
  dataScope?: ConfidenceDataScope;
  /** 신뢰도 산출 방식 설명 (UI 툴팁) */
  confidenceDetail?: string;
}

/**
 * ARIMA 가격 안정성 분석 — LstmAnalysis 와 동일 shape + 추가 필드
 *  - ARIMA(2,1,2) 백테스트 MAPE 10.16% (메인 모델)
 *  - LSTM(20.41%) 대비 multi-step 누적 오차 없음
 */
export interface ArimaAnalysis extends LstmAnalysis {
  /** 모델 구분자 */
  modelType: 'arima';
  /** 모델 한계 주의사항 (UI 표시용) */
  disclaimer?: string;
}

/**
 * LH 청년주택 시군구 집계 (GET /api/regions/:legalDongCode/lh-summary)
 *  - Depth 3 상단 배너용 — 단지 디테일이 없으므로 집계로만 신뢰 가능
 *  - 빈 데이터 시 totalRows=0 → 클라이언트가 배너 자체를 숨김
 */
export interface LhProgramSummary {
  /** "행복주택" | "청년매입임대" | "전세임대" */
  programType: string;
  /** 적재 row 수 */
  rows: number;
  /** 공급 가능 호수 합계 */
  units: number;
  /** 월세 최저/최고 (만원) — 한 row 도 가격 있는 게 없으면 null */
  monthlyRentMin: number | null;
  monthlyRentMax: number | null;
}

/**
 * LH 집계 정밀도 (Phase 2-B, 2026-05-27)
 *  - DONG        : 행정동 10자리 정확 일치 (지오코딩 성공한 row)
 *  - SIGUNGU     : 시군구 5자리 폴백 (지오코딩 없음·실패 row)
 *  - INSUFFICIENT: 양쪽 모두 0건 → 배너 숨김
 */
export type LhSummaryScope = 'DONG' | 'SIGUNGU' | 'INSUFFICIENT';

export interface LhSummary {
  /** 시군구 5자리 코드 */
  sigunguCode: string;
  /** 행정동 10자리 코드 (요청한 BJD) — Phase 2-B 추가 */
  legalDongCode?: string;
  /** 표시 우선 정밀도 — Phase 2-B 추가 */
  scope?: LhSummaryScope;
  /** 표시 row/units (DONG 우선, 없으면 SIGUNGU) */
  totalRows: number;
  totalUnits: number;
  /** programType 별 집계 (units 내림차순) */
  programs: LhProgramSummary[];
  /** 참고용 시군구 단위 통계 — Phase 2-B 추가 (DONG 모드에서도 비교 가능) */
  sigunguTotalRows?: number;
  sigunguTotalUnits?: number;
}

/** 통근 비교 — 대중교통 vs 자차 */
export interface CommuteCompareData {
  /** 편도 분 — 대중교통 */
  transitMinutes: number;
  /** 환승 횟수 */
  transfers: number;
  /** 편도 비용 (원) — 대중교통 */
  transitCost: number;
  /** 편도 분 — 자차 (Kakao 실경로 or Haversine 비선형 추정) */
  carMinutes: number;
  /** 편도 비용 (원) — 자차 (연료비 추정) */
  carCost: number;
  /** 자차 데이터 출처 ('kakao' = 실경로, 'estimate' = 비선형 추정, undefined = 구버전 API) */
  carSource?: 'kakao' | 'estimate';
}
