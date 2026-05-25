/**
 * LSTM 가격 안정성 분석 API
 *
 *  GET /api/lstm/:complexId
 *    Params: complexId — t_apt_complex.id (정수, URL 문자열로 전달)
 *    Response: LstmAnalysisDto  (클라이언트 LstmAnalysis 타입과 1:1)
 *
 *  동작:
 *    1) t_apt_complex 로 단지 조회 (sigungu_code + legal_dong 확보)
 *    2) t_apt_trade 월별 평균 m²단가 집계 — 과거 60개월 (actual 시계열)
 *    3) t_training_result 최신 row — 현재/1년/3년 예측 m²단가
 *    4) 예측 36개월 시계열 보간 (실제 mockLstmResults 와 동일 방식)
 *    5) 96점 시계열 + 메타 응답
 *
 *  설계 메모:
 *    - 과거 데이터가 60개월 미만이면 있는 만큼만 actual 노출
 *    - 학습결과 없으면 과거 추세로 단순 선형 외삽 (모델 없음 표시 용이)
 *    - 청년 컨셉: "가격 안정성 분석" — 직설적 수익률 표현 금지 (Q4=B 의사결정)
 */
import { Router, Request, Response } from 'express';
import { prisma } from '../../services/db';

export const lstmRouter = Router();

// ─── 타입 ─────────────────────────────────────────────────────

interface LstmPoint {
  ym: string;
  pricePerM2: number;
  lower?: number;
  upper?: number;
  kind: 'actual' | 'forecast';
}

interface LstmAnalysisDto {
  complexId: string;
  series: LstmPoint[];
  confidence: number;
  currentPricePerM2: number;
  predicted1yPricePerM2: number;
  predicted3yPricePerM2: number;
  expectedReturn3y: number;
}

// ─── 헬퍼 ─────────────────────────────────────────────────────

function ymLabel(base: Date, offsetMonths: number): string {
  const d = new Date(base.getFullYear(), base.getMonth() + offsetMonths, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// ─── 라우터 ───────────────────────────────────────────────────

lstmRouter.get('/:complexId', async (req: Request, res: Response) => {
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
  //    MySQL: DATE_FORMAT(deal_date, '%Y-%m') 로 월 집계
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

  // 3) 학습 결과 조회 (단지 row 우선, 없으면 행정동 집계 row)
  const trainingResult = await prisma.trainingResult.findFirst({
    where: { sigunguCode: complex.sigunguCode, legalDong: complex.legalDong },
    orderBy: { baseDate: 'desc' },
    select: {
      currentPricePerM2: true,
      predicted1yPricePerM2: true,
      predicted3yPricePerM2: true,
      confidence: true,
    },
  });

  // 4) currentPricePerM2 결정
  //    - 학습결과 있으면 그 값 사용 (baseDate 기준)
  //    - 없으면 최근 거래 m²단가 평균
  let currentPricePerM2: number;
  let predicted1yPricePerM2: number;
  let predicted3yPricePerM2: number;
  let confidence: number;

  if (monthlyRows.length > 0) {
    const lastRow = monthlyRows[monthlyRows.length - 1];
    currentPricePerM2 = Math.round(Number(lastRow.avg_price_per_m2));
  } else {
    currentPricePerM2 = 0;
  }

  if (trainingResult && trainingResult.currentPricePerM2 > 0) {
    // 학습 결과가 있으면 성장률(ratio)만 추출 → 실거래 현재가 기준으로 적용
    //  scale 곱셈 대신 ratio 사용: 절대값 오차 제거, 방향성(상승/하락 신호)만 보존
    const trainCurrent = trainingResult.currentPricePerM2;
    const raw1y = trainingResult.predicted1yPricePerM2 ?? trainCurrent;
    const raw3y = trainingResult.predicted3yPricePerM2 ?? trainCurrent;

    // 학습 시점 기준 변동률
    const ratio1y = raw1y / trainCurrent; // 예: 0.95 = -5%
    const ratio3y = raw3y / trainCurrent; // 예: 0.41 = -59%

    // 신뢰도 보정: confidence < 0.6이거나 |ratio3y-1| > 0.30 이면 과도한 예측
    //  → 30% 캡 적용 (청년 주거 서비스 맥락: 가격 안정성 판단에 ±30% 범위면 충분)
    const MAX_DRIFT = 0.30;
    const cappedRatio3y = Math.max(1 - MAX_DRIFT, Math.min(1 + MAX_DRIFT, ratio3y));
    const cappedRatio1y = Math.max(1 - MAX_DRIFT, Math.min(1 + MAX_DRIFT, ratio1y));

    predicted3yPricePerM2 = Math.round(currentPricePerM2 * cappedRatio3y);
    predicted1yPricePerM2 = Math.round(currentPricePerM2 * cappedRatio1y);

    // predicted1y가 current와 같다면 (1y null이었으면) 3y 방향으로 중간값 사용
    if (Math.abs(predicted1yPricePerM2 - currentPricePerM2) < 10) {
      predicted1yPricePerM2 = Math.round(
        currentPricePerM2 + (predicted3yPricePerM2 - currentPricePerM2) / 3,
      );
    }

    confidence = Math.round((trainingResult.confidence ?? 0.7) * 100);
  } else {
    // 학습 결과 없음 — 최근 추세 선형 외삽 (안전망)
    if (monthlyRows.length >= 2) {
      const first = Number(monthlyRows[0].avg_price_per_m2);
      const last = Number(monthlyRows[monthlyRows.length - 1].avg_price_per_m2);
      const monthlyGrowth =
        monthlyRows.length > 1 ? (last - first) / monthlyRows.length : 0;
      predicted1yPricePerM2 = Math.round(last + monthlyGrowth * 12);
      predicted3yPricePerM2 = Math.round(last + monthlyGrowth * 36);
    } else {
      predicted1yPricePerM2 = currentPricePerM2;
      predicted3yPricePerM2 = currentPricePerM2;
    }
    confidence = 50; // 학습 결과 없음 → 낮은 신뢰도
  }

  const expectedReturn3y =
    currentPricePerM2 > 0
      ? Math.round(((predicted3yPricePerM2 - currentPricePerM2) / currentPricePerM2) * 1000) / 10
      : 0;

  // 5) 시계열 조합
  const series: LstmPoint[] = [];
  const ref = new Date();

  // 과거 actual 시리즈 — DB 데이터
  for (const row of monthlyRows) {
    series.push({
      ym: row.ym,
      pricePerM2: Math.round(Number(row.avg_price_per_m2)),
      kind: 'actual',
    });
  }

  // 예측 36개월 보간 (mockLstmResults 와 동일 로직)
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
    const spread = center * (0.02 + ratio * (1 - confidence / 100) * 0.18);
    series.push({
      ym: ymLabel(ref, t),
      pricePerM2: Math.round(center),
      lower: Math.round(center - spread),
      upper: Math.round(center + spread),
      kind: 'forecast',
    });
  }

  const dto: LstmAnalysisDto = {
    complexId: String(complexId),
    series,
    confidence,
    currentPricePerM2,
    predicted1yPricePerM2,
    predicted3yPricePerM2,
    expectedReturn3y,
  };

  return res.json(dto);
});
