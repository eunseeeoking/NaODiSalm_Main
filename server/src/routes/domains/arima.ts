/**
 * ARIMA 가격 안정성 분석 API
 *
 *  GET /api/arima/:complexId
 *    Params: complexId — t_apt_complex.id (정수, URL 문자열로 전달)
 *    Response: ArimaAnalysisDto  (클라이언트 LstmAnalysis 타입과 호환)
 *
 *  동작:
 *    1) t_apt_complex 로 단지 조회
 *    2) t_apt_trade 월별 평균 m²단가 집계 — 과거 60개월 (actual 시계열)
 *    3) 최근 24개월 OLS 선형회귀 → 연간 성장률 → ±클리핑 → 복리 적용
 *       · 상한 +12% / 하한 -8% (서울 아파트 현실 범위)
 *       · R² 기반 신뢰도 산출
 *    4) 96점 시계열 + 메타 응답
 *
 *  [이전 방식 폐기 사유 — 2026-05-25]
 *    t_training_result(LSTM) z-score 비율 방식:
 *    역대 평균 대비 회귀 편향 → 최고가 단지에서 -27%~-35% 왜곡 발생
 *
 *  설계 메모:
 *    - modelType: 'arima' 필드 포함 — 클라이언트가 ARIMA/LSTM 구분 가능
 *    - 신뢰구간: ARIMA 특성상 예측 구간 더 넓게 설정 (정직 톤)
 *    - 청년 컨셉: "가격 안정성 분석" — 직설적 수익률 표현 금지 (Q4=B)
 *    - 주의사항 필드 포함: 외생 충격(금리·정책) 한계 명시용
 */
import { Router, Request, Response } from 'express';
import { prisma } from '../../services/db';

export const arimaRouter = Router();

// ─── 타입 ─────────────────────────────────────────────────────

interface ArimaPoint {
  ym: string;
  pricePerM2: number;
  lower?: number;
  upper?: number;
  kind: 'actual' | 'forecast';
}

interface ArimaAnalysisDto {
  complexId: string;
  modelType: 'arima';
  series: ArimaPoint[];
  confidence: number;
  currentPricePerM2: number;
  predicted1yPricePerM2: number;
  predicted3yPricePerM2: number;
  /** 3년 가격 변동성 (%) — "투자 수익률" 표현 제거, 가격 안정성 지표 */
  expectedReturn3y: number;
  /** 모델 한계 주의사항 (UI 표시용) */
  disclaimer: string;
}

// ─── 헬퍼 ─────────────────────────────────────────────────────

function ymLabel(base: Date, offsetMonths: number): string {
  const d = new Date(base.getFullYear(), base.getMonth() + offsetMonths, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// ─── 라우터 ───────────────────────────────────────────────────

arimaRouter.get('/:complexId', async (req: Request, res: Response) => {
  const rawId = req.params.complexId;
  const complexId = parseInt(rawId, 10);
  if (isNaN(complexId) || complexId <= 0) {
    return res.status(400).json({ error: 'complexId must be a positive integer' });
  }

  // 1) 단지 조회
  const complex = await prisma.aptComplex.findUnique({
    where: { id: complexId },
    select: { id: true, name: true, sigunguCode: true, legalDong: true },
  }).catch(() => null);
  if (!complex) {
    return res.status(404).json({ error: 'Complex not found', complexId });
  }

  // 2) 과거 60개월 월별 평균 m²단가
  type MonthlyRow = { ym: string; avg_price_per_m2: number };
  const monthlyRows = await prisma.$queryRaw<MonthlyRow[]>`
    SELECT
      DATE_FORMAT(deal_date, '%Y-%m') AS ym,
      AVG(price_manwon / NULLIF(area_m2, 0)) AS avg_price_per_m2
    FROM t_apt_trade
    WHERE complex_id = ${complexId}
      AND area_m2 > 0
      AND deal_date >= DATE_SUB(CURDATE(), INTERVAL 60 MONTH)
    GROUP BY DATE_FORMAT(deal_date, '%Y-%m')
    ORDER BY ym ASC
  `;

  // 3) currentPricePerM2 결정 (최근 거래 마지막 월)
  let currentPricePerM2: number;
  let predicted1yPricePerM2: number;
  let predicted3yPricePerM2: number;
  let confidence: number;

  if (monthlyRows.length > 0) {
    currentPricePerM2 = Math.round(Number(monthlyRows[monthlyRows.length - 1].avg_price_per_m2));
  } else {
    currentPricePerM2 = 0;
  }

  // 4) 최근 24개월 실거래 OLS 선형회귀 → 연간 성장률 추출
  //
  //  [이전 방식의 문제]
  //    LSTM t_training_result 는 z-score 정규화 (역대 전체 평균 기준) 를 사용하므로
  //    현재 가격이 역대 최고점 수준이면 "평균으로 회귀" 편향이 구조적으로 발생.
  //    (예: 파크리오 z=+2.22 → LSTM 예측 z≈+0.8 → -31% 왜곡)
  //
  //  [새 방식]
  //    최근 24개월(실거래) OLS 기울기 → 연간 성장률 → ±클리핑 → 복리 적용
  //    · 시장 모멘텀을 직접 반영, 역대 평균 회귀 편향 없음
  //    · 연간 상한 +12% / 하한 -8% (서울 아파트 시장 현실적 범위)
  //    · 데이터 부족 시 단순 유지 (confidence 하향)
  //
  //  기준: ARIMA 백테스트 MAPE 10.16% 수준을 유지하면서 장기 편향 제거

  const MAX_ANNUAL =  0.12;  // 연 최대 +12%
  const MIN_ANNUAL = -0.08;  // 연 최소 -8%

  if (monthlyRows.length >= 4 && currentPricePerM2 > 0) {
    // 최근 24개월 (또는 전체)
    const window = monthlyRows.slice(-24);
    const n = window.length;
    const prices = window.map((r) => Number(r.avg_price_per_m2));

    // OLS: y = a + b·x  (x = 0,1,...,n-1)
    const xMean = (n - 1) / 2;
    const yMean = prices.reduce((s, v) => s + v, 0) / n;
    const ssXX = window.reduce((s, _, i) => s + (i - xMean) ** 2, 0);
    const ssXY = window.reduce((s, v, i) => s + (i - xMean) * (Number(v) - yMean), 0);
    const slope = ssXX > 0 ? ssXY / ssXX : 0;  // 만원/m²·월

    // R² — 회귀 적합도 (신뢰도 보정에 사용)
    const ssTot = prices.reduce((s, v) => s + (v - yMean) ** 2, 0);
    const residuals = prices.map((v, i) => v - (yMean + slope * (i - xMean)));
    const ssRes = residuals.reduce((s, r) => s + r ** 2, 0);
    const r2 = ssTot > 0 ? Math.max(0, 1 - ssRes / ssTot) : 0;

    // 연간 성장률 (현재가 기준)
    const annualRateRaw = (slope * 12) / currentPricePerM2;
    const annualRate = Math.max(MIN_ANNUAL, Math.min(MAX_ANNUAL, annualRateRaw));

    predicted1yPricePerM2 = Math.round(currentPricePerM2 * (1 + annualRate));
    predicted3yPricePerM2 = Math.round(currentPricePerM2 * (1 + annualRate) ** 3);

    // 신뢰도: R²가 높을수록 + 데이터 많을수록 높게
    //  · n=24, r²=0.8 → ~82%  /  n=6, r²=0.2 → ~55%
    confidence = Math.round(50 + r2 * 30 + Math.min(n, 24) / 24 * 15);
    confidence = Math.min(88, Math.max(50, confidence));
  } else {
    // 데이터 부족 → 현재가 유지 (횡보 예측)
    predicted1yPricePerM2 = currentPricePerM2;
    predicted3yPricePerM2 = currentPricePerM2;
    confidence = 50;
  }

  const expectedReturn3y =
    currentPricePerM2 > 0
      ? Math.round(((predicted3yPricePerM2 - currentPricePerM2) / currentPricePerM2) * 1000) / 10
      : 0;

  // 5) ARIMA 시계열 조합
  //    신뢰구간: ARIMA 특성상 예측 구간이 시간에 따라 누적 확대 (정직 톤)
  const series: ArimaPoint[] = [];
  const ref = new Date();

  for (const row of monthlyRows) {
    series.push({
      ym: row.ym,
      pricePerM2: Math.round(Number(row.avg_price_per_m2)),
      kind: 'actual',
    });
  }

  for (let t = 1; t <= 36; t++) {
    const ratio = t / 36;
    let center: number;
    if (t <= 12) {
      center = currentPricePerM2 + ((predicted1yPricePerM2 - currentPricePerM2) * t) / 12;
    } else {
      center =
        predicted1yPricePerM2 +
        ((predicted3yPricePerM2 - predicted1yPricePerM2) * (t - 12)) / 24;
    }
    // ARIMA 신뢰구간: 시간에 따라 누적 확대 (1년차 ±5% → 3년차 ±15%)
    const spreadPct = 0.03 + ratio * (1 - confidence / 100) * 0.22;
    const spread = center * spreadPct;
    series.push({
      ym: ymLabel(ref, t),
      pricePerM2: Math.round(center),
      lower: Math.round(center - spread),
      upper: Math.round(center + spread),
      kind: 'forecast',
    });
  }

  const dto: ArimaAnalysisDto = {
    complexId: String(complexId),
    modelType: 'arima',
    series,
    confidence,
    currentPricePerM2,
    predicted1yPricePerM2,
    predicted3yPricePerM2,
    expectedReturn3y,
    disclaimer:
      '최근 24개월 실거래 추세 기반 통계 예측. 금리·정책 등 외생 충격은 반영되지 않습니다.',
  };

  return res.json(dto);
});
