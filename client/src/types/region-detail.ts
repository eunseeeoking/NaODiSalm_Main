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
  /** 3년 누적 예상 수익률 (%) */
  expectedReturn3y: number;
}

/** 통근 비교 — 대중교통 vs 자차 */
export interface CommuteCompareData {
  /** 편도 분 — 대중교통 */
  transitMinutes: number;
  /** 환승 횟수 */
  transfers: number;
  /** 편도 비용 (원) — 대중교통 */
  transitCost: number;
  /** 편도 분 — 자차 (현재는 mock; 추후 Kakao Mobility 가능) */
  carMinutes: number;
  /** 편도 비용 (원) — 자차 (연료비 추정) */
  carCost: number;
}
