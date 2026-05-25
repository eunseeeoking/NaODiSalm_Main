/**
 * LSTM 시계열 mock 데이터 생성기
 *  - 단지마다 60개월 과거 + 36개월 예측
 *  - 실 학습 결과(t_training_result) 도착 전까지 사용
 *
 *  ▷ 합성 방식 (결정론적)
 *     기준 시점: 현재 m²단가
 *     과거 60개월: 완만한 상승 추세 + 계절성 + 결정론적 노이즈
 *     예측 36개월: 단지별 성장률을 1년/3년 예측치로 보간
 *     신뢰구간: 시간이 멀어질수록 폭 증가
 */
import type { LstmAnalysis, LstmPoint } from '../../../types/region-detail';
import { findMockComplex } from './mockComplexes';

/** 결정론적 의사난수 — 단지ID + 인덱스 기반 */
function det(seed: string, i: number): number {
  let h = 0;
  const key = `${seed}:${i}`;
  for (let k = 0; k < key.length; k++) {
    h = (h * 31 + key.charCodeAt(k)) | 0;
  }
  // [-1, 1)
  return (((h % 2000) + 2000) % 2000) / 1000 - 1;
}

function ymLabel(ref: Date, offsetMonths: number): string {
  const d = new Date(ref.getFullYear(), ref.getMonth() + offsetMonths, 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

export function getMockLstm(complexId: string): LstmAnalysis | null {
  const complex = findMockComplex(complexId);
  if (!complex) return null;

  const current = complex.pricePerM2;
  const future = complex.predictedPricePerM2_3y;
  const confidence = complex.confidence;

  // 1년 후 = current + (future - current) / 3 + 미세 가속
  const predicted1y = Math.round(current + (future - current) * 0.35);
  const predicted3y = future;

  // 3년 가격 변동성 (%, 매매가 기준 — 가격 안정성 지표)
  const expectedReturn3y = ((future - current) / current) * 100;

  // 과거 60개월: 현재값에서 역추적
  // 가정: 5년간 (현재값 / 1.18) 에서 출발 → 단지별 차등
  const pastStart = current / (1 + (expectedReturn3y / 100) * 1.2);

  const ref = new Date(2026, 4, 1); // 2026-05 기준
  const series: LstmPoint[] = [];

  // 과거 60개월 (월별, t = -59 .. 0)
  for (let t = -59; t <= 0; t++) {
    // 선형 보간
    const linear = pastStart + ((current - pastStart) * (t + 59)) / 59;
    // 계절성 (봄/가을 거래 ↑ ≈ ±1.5%)
    const seasonal = Math.sin(((t + 59) * Math.PI) / 6) * 0.015 * linear;
    // 결정론적 노이즈 (±2%)
    const noise = det(complexId, t) * 0.02 * linear;
    const price = Math.round(linear + seasonal + noise);
    series.push({
      ym: ymLabel(ref, t),
      pricePerM2: price,
      kind: 'actual',
    });
  }

  // 예측 36개월 (t = 1 .. 36)
  for (let t = 1; t <= 36; t++) {
    // 1년/3년 예측 사이 평활 보간
    const ratio = t / 36;
    // 0~12: current → predicted1y (선형)
    // 12~36: predicted1y → predicted3y (선형)
    let center: number;
    if (t <= 12) {
      center = current + ((predicted1y - current) * t) / 12;
    } else {
      center = predicted1y + ((predicted3y - predicted1y) * (t - 12)) / 24;
    }
    // 신뢰구간: 시간이 멀어질수록 폭 증가 (±2% ~ ±10%)
    const spread = center * (0.02 + (ratio * (1 - confidence / 100)) * 0.18);
    series.push({
      ym: ymLabel(ref, t),
      pricePerM2: Math.round(center),
      lower: Math.round(center - spread),
      upper: Math.round(center + spread),
      kind: 'forecast',
    });
  }

  return {
    complexId,
    series,
    confidence,
    currentPricePerM2: current,
    predicted1yPricePerM2: predicted1y,
    predicted3yPricePerM2: predicted3y,
    expectedReturn3y: Math.round(expectedReturn3y * 10) / 10,
  };
}
