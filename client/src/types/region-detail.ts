/**
 * Depth 3 (지역 상세) 도메인 타입
 *  - 매물 단지 + LSTM 시계열 + 통근 비교
 *  - 서버 API 도착 전까지 mock 으로 동일 모양 사용
 */

/** 아파트 단지 (t_apt_complex 1:1 매핑 예정) */
export interface AptComplex {
  /** 단지 고유 ID (서버 발급) */
  complexId: string;
  /** 단지명 (예: "래미안 대치팰리스") */
  name: string;
  /** 행정동 코드 (10자리) */
  legalDongCode: string;
  /** 좌표 (지도 핀) */
  lat: number;
  lng: number;
  /** 평형 (전용 면적 m²) */
  exclusiveArea: number;
  /** 평형 구간 라벨 (예: "중형") */
  sizeBucket: '소형' | '중형' | '중대형' | '대형';
  /** 연식 구간 라벨 */
  ageBucket: '신축' | '준신축' | '중간' | '구축';
  /** 준공년도 */
  builtYear: number;
  /** 세대수 */
  households: number;
  /** 최근 거래가 (만원) */
  recentPrice: number;
  /** m² 당 단가 (만원) */
  pricePerM2: number;
  /** 3년 후 예상 m² 당 단가 (만원, LSTM) */
  predictedPricePerM2_3y: number;
  /** 예측 신뢰도 (%) */
  confidence: number;
  /**
   * LH 청년주택 여부 (행복주택·청년매입임대·전세임대)
   *  - true: 국가매물(LH)
   *  - false | undefined: 민간매물
   */
  isLhComplex?: boolean;
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
