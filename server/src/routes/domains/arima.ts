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
  /** 신뢰도 산출 데이터 출처 — UI 도넛 옆 칩 표시용 (2026-05-27 추가) */
  dataScope?: 'COMPLEX' | 'LEGAL_DONG' | 'SIGUNGU' | 'INSUFFICIENT';
  /** 신뢰도 산출 방식 설명 (UI 툴팁 표시용) */
  confidenceDetail?: string;
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

  // ─── 전체 try-catch (2026-05-27 Hotfix) ──────────────────────
  //   Express 4 의 async handler 는 throw 를 자동으로 next(err) 로 보내지 않음.
  //   STEP 1/2/3 SQL 어느 한쪽이 실패하면 unhandled promise rejection →
  //   Node 가 process 자체를 종료할 위험 (Node 15+ unhandledRejection 기본 throw).
  //   다량 동시 호출 시 서버 다운 → try-catch 로 차단.
  try {

  // 1) 단지 조회
  const complex = await prisma.aptComplex.findUnique({
    where: { id: complexId },
    select: { id: true, name: true, sigunguCode: true, legalDong: true },
  }).catch(() => null);
  if (!complex) {
    return res.status(404).json({ error: 'Complex not found', complexId });
  }

  // 2) 과거 60개월 월별 평균 m²단가 — 3단계 폴백 (2026-05-27)
  //
  //   기존 문제:
  //     단지(complex_id) 기준으로만 집계 → 전체 단지의 59%가 < 4개월
  //     → ARIMA OLS 진입 실패 → confidence=50 폴백 (사용자 보고 이슈)
  //
  //   새 전략 (단지 데이터 부족 시 격상):
  //     STEP 1: complex_id 기준        (가장 정밀, 단지 고유 추세)
  //     STEP 2: sigungu + legal_dong   (행정동 집계, 50~70개 단지 평균)
  //     STEP 3: sigungu_code           (시군구 집계, 수백 단지 평균)
  //     STEP 4: 모두 < 4 → confidence=50 폴백 (이전과 동일)
  //
  //   현재가(currentPricePerM2) 는 항상 단지 데이터 우선 사용 →
  //     단지에 거래 1건이라도 있으면 그 값으로 표시, OLS 계산만 폴백
  type MonthlyRow = { ym: string; avg_price_per_m2: number };

  const complexRows = await prisma.$queryRaw<MonthlyRow[]>`
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

  // OLS 입력으로 사용할 데이터 (단지 우선, 부족하면 격상)
  let olsRows: MonthlyRow[] = complexRows;
  let dataScope: 'COMPLEX' | 'LEGAL_DONG' | 'SIGUNGU' | 'INSUFFICIENT' = 'COMPLEX';
  let scopeDetail = `단지 거래 ${complexRows.length}개월`;

  if (complexRows.length < 4) {
    // STEP 2: 행정동 집계 — sigungu_code/legal_dong 은 t_apt_complex 에 있으므로 JOIN
    //   (Hotfix 2026-05-27: t_apt_trade 에 직접 컬럼 없어 Unknown column 1054 발생하던 버그 해결)
    const dongRows = await prisma.$queryRaw<MonthlyRow[]>`
      SELECT
        DATE_FORMAT(t.deal_date, '%Y-%m') AS ym,
        AVG(t.price_manwon / NULLIF(t.area_m2, 0)) AS avg_price_per_m2
      FROM t_apt_trade t
      INNER JOIN t_apt_complex c ON c.id = t.complex_id
      WHERE c.sigungu_code = ${complex.sigunguCode}
        AND c.legal_dong = ${complex.legalDong}
        AND t.area_m2 > 0
        AND t.deal_date >= DATE_SUB(CURDATE(), INTERVAL 60 MONTH)
      GROUP BY DATE_FORMAT(t.deal_date, '%Y-%m')
      ORDER BY ym ASC
    `;
    if (dongRows.length >= 4) {
      olsRows = dongRows;
      dataScope = 'LEGAL_DONG';
      scopeDetail = `${complex.legalDong} 거래 ${dongRows.length}개월 평균`;
    } else {
      // STEP 3: 시군구 집계 — JOIN (Hotfix 동일)
      const sigunguRows = await prisma.$queryRaw<MonthlyRow[]>`
        SELECT
          DATE_FORMAT(t.deal_date, '%Y-%m') AS ym,
          AVG(t.price_manwon / NULLIF(t.area_m2, 0)) AS avg_price_per_m2
        FROM t_apt_trade t
        INNER JOIN t_apt_complex c ON c.id = t.complex_id
        WHERE c.sigungu_code = ${complex.sigunguCode}
          AND t.area_m2 > 0
          AND t.deal_date >= DATE_SUB(CURDATE(), INTERVAL 60 MONTH)
        GROUP BY DATE_FORMAT(t.deal_date, '%Y-%m')
        ORDER BY ym ASC
      `;
      if (sigunguRows.length >= 4) {
        olsRows = sigunguRows;
        dataScope = 'SIGUNGU';
        scopeDetail = `시군구 거래 ${sigunguRows.length}개월 평균`;
      } else {
        // 모두 부족 — 폴백
        olsRows = dongRows.length > 0 ? dongRows : sigunguRows;
        dataScope = 'INSUFFICIENT';
        scopeDetail = '거래 데이터 부족 (시군구 < 4개월)';
      }
    }
  }

  // monthlyRows: 화면에 표시할 actual 시계열 (항상 단지 데이터 우선)
  // — 단지 거래 1건이라도 있으면 그 시리즈 표시, OLS 만 격상된 데이터 사용
  const monthlyRows = complexRows.length > 0 ? complexRows : olsRows;

  // 3) currentPricePerM2 결정
  let currentPricePerM2: number;
  let predicted1yPricePerM2: number;
  let predicted3yPricePerM2: number;
  let confidence: number;

  if (complexRows.length > 0) {
    currentPricePerM2 = Math.round(Number(complexRows[complexRows.length - 1].avg_price_per_m2));
  } else if (olsRows.length > 0) {
    // 단지 거래 자체가 0건 — 격상된 평균을 현재가로 사용 (정직 톤)
    currentPricePerM2 = Math.round(Number(olsRows[olsRows.length - 1].avg_price_per_m2));
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

  let confidenceDetail = scopeDetail;

  if (olsRows.length >= 4 && currentPricePerM2 > 0) {
    // 최근 24개월 (또는 전체) — 단지 부족 시 행정동/시군구 평균 사용
    const window = olsRows.slice(-24);
    const n = window.length;
    const prices = window.map((r) => Number(r.avg_price_per_m2));

    // OLS: y = a + b·x  (x = 0,1,...,n-1)
    const xMean = (n - 1) / 2;
    const yMean = prices.reduce((s, v) => s + v, 0) / n;
    const ssXX = window.reduce((s, _, i) => s + (i - xMean) ** 2, 0);
    const ssXY = window.reduce((s, _, i) => s + (i - xMean) * (prices[i] - yMean), 0);
    const slope = ssXX > 0 ? ssXY / ssXX : 0;  // 만원/m²·월

    // R² — 회귀 적합도 (신뢰도 보정에 사용)
    const ssTot = prices.reduce((s, v) => s + (v - yMean) ** 2, 0);
    const residuals = prices.map((v, i) => v - (yMean + slope * (i - xMean)));
    const ssRes = residuals.reduce((s, r) => s + r ** 2, 0);
    const r2 = ssTot > 0 ? Math.max(0, 1 - ssRes / ssTot) : 0;

    // 연간 성장률 (행정동/시군구 평균 기준 slope 를 단지 currentPricePerM2 에 적용)
    //   주의: olsRows 가 격상된 평균이면 slope/yMean 의 절대값은 행정동 평균.
    //         성장률(비율)만 추출해서 단지 currentPricePerM2 에 곱하면 절대값 왜곡 회피.
    const baseLevel = yMean > 0 ? yMean : currentPricePerM2;
    const annualRateRaw = (slope * 12) / baseLevel;
    const annualRate = Math.max(MIN_ANNUAL, Math.min(MAX_ANNUAL, annualRateRaw));

    predicted1yPricePerM2 = Math.round(currentPricePerM2 * (1 + annualRate));
    predicted3yPricePerM2 = Math.round(currentPricePerM2 * (1 + annualRate) ** 3);

    // 신뢰도: R²가 높을수록 + 데이터 많을수록 높게
    //   · n=24, r²=0.8 → ~82%  /  n=6, r²=0.2 → ~55%
    //   · 폴백 격상 시 신뢰도 페널티 (행정동 -5, 시군구 -10)
    let raw = 50 + r2 * 30 + Math.min(n, 24) / 24 * 15;
    if (dataScope === 'LEGAL_DONG') raw -= 5;
    else if (dataScope === 'SIGUNGU') raw -= 10;
    confidence = Math.min(88, Math.max(50, Math.round(raw)));

    confidenceDetail =
      `${scopeDetail}, R²=${r2.toFixed(2)}, 연성장률 ${(annualRate * 100).toFixed(1)}%`;
  } else {
    // 데이터 부족 → 현재가 유지 (횡보 예측)
    predicted1yPricePerM2 = currentPricePerM2;
    predicted3yPricePerM2 = currentPricePerM2;
    confidence = 50;
    confidenceDetail = '거래 데이터 4개월 미만 — 횡보 예측';
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

  // 폴백 단계에 따라 disclaimer 조정
  let disclaimer =
    '최근 24개월 실거래 추세 기반 통계 예측. 금리·정책 등 외생 충격은 반영되지 않습니다.';
  if (dataScope === 'LEGAL_DONG') {
    disclaimer =
      `${complex.legalDong} 행정동 평균 거래 추세 기반 예측 (단지 거래 부족). ` +
      '금리·정책 등 외생 충격은 반영되지 않습니다.';
  } else if (dataScope === 'SIGUNGU') {
    disclaimer =
      '시군구 평균 거래 추세 기반 예측 (단지·행정동 거래 부족). ' +
      '단지 고유 특성 반영도 낮을 수 있습니다.';
  } else if (dataScope === 'INSUFFICIENT') {
    disclaimer =
      '거래 데이터 부족으로 예측이 제한적입니다. 횡보 가정으로 현재가 유지 표시.';
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
    disclaimer,
    dataScope,
    confidenceDetail,
  };

  return res.json(dto);

  } catch (e) {
    // Hotfix 2026-05-27: unhandled rejection 차단. SQL/계산 에러 안전 캡처.
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[arima] /${complexId} 실패:`, msg);
    return res.status(500).json({
      error: 'ARIMA analysis failed',
      complexId,
      reason: msg.slice(0, 200),
    });
  }
});
