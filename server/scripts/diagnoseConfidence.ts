/**
 * Depth 3 신뢰도(confidence) 50 픽스 진단 스크립트
 *
 *  실행: cd server && npm run diagnose:confidence
 *
 *  목적:
 *    Depth 3 LSTM/ARIMA 카드에서 모든 단지의 confidence가 50으로만 표시되는
 *    문제의 근본 원인을 데이터/코드 양쪽에서 정확히 짚는다.
 *
 *  체크 항목:
 *    [A] t_training_result.confidence 분포 — 히스토그램
 *        → 학습 자체가 0.5 부근에 몰려있는지
 *    [B] t_training_result vs t_apt_complex 매칭률
 *        → 단지의 몇 %가 LSTM 학습 결과를 가지고 있는지
 *        → LSTM endpoint 폴백(confidence=50) 진입률 추정
 *    [C] 거래량 상위 10개 단지의 ARIMA 진입 조건
 *        → monthlyRows.length, OLS R², n/24 → confidence 산출 시뮬레이션
 *    [D] 폴백 진입 단지 비율 — 전체 단지 중 ARIMA 폴백에 빠지는 비율
 *    [E] 처방전 — 코드 어디를 어떻게 바꿔야 하는지
 */
import { prisma } from '../src/services/db';

interface ConfidenceBucket {
  label: string;
  range: [number, number];
  count: number;
}

async function main() {
  console.log('\n🔍 Depth 3 신뢰도(confidence) 50 픽스 진단\n');
  console.log('='.repeat(70));

  // ─── [A] t_training_result.confidence 분포 ────────────────────────────
  console.log('\n[A] t_training_result.confidence 분포');
  console.log('─'.repeat(70));

  const totalTrainings = await prisma.trainingResult.count();
  const nullConf = await prisma.trainingResult.count({ where: { confidence: null } });
  const validConf = totalTrainings - nullConf;

  console.log(`    총 학습 결과: ${totalTrainings.toLocaleString()}건`);
  console.log(`    confidence NULL: ${nullConf}건  (LSTM 코드에서 0.7 기본값 적용 → 70 표시)`);
  console.log(`    confidence 값 있음: ${validConf}건\n`);

  const buckets: ConfidenceBucket[] = [
    { label: '0.0~0.3', range: [0.0, 0.3], count: 0 },
    { label: '0.3~0.5', range: [0.3, 0.5], count: 0 },
    { label: '0.5 정확히', range: [0.4999, 0.5001], count: 0 },
    { label: '0.5~0.7', range: [0.5, 0.7], count: 0 },
    { label: '0.7~0.85', range: [0.7, 0.85], count: 0 },
    { label: '0.85~1.0', range: [0.85, 1.01], count: 0 },
  ];

  const confRows = await prisma.$queryRaw<{ confidence: number }[]>`
    SELECT confidence FROM t_training_result WHERE confidence IS NOT NULL
  `;
  for (const r of confRows) {
    const c = Number(r.confidence);
    // 0.5 정확히 우선
    if (c >= 0.4999 && c <= 0.5001) {
      buckets[2].count++;
      continue;
    }
    for (const b of buckets) {
      if (b.label === '0.5 정확히') continue;
      if (c >= b.range[0] && c < b.range[1]) {
        b.count++;
        break;
      }
    }
  }

  console.log('    범위              건수    비율    bar');
  for (const b of buckets) {
    const ratio = validConf > 0 ? (b.count / validConf) * 100 : 0;
    const bar = '█'.repeat(Math.round(ratio / 2));
    console.log(
      `    ${b.label.padEnd(15)}  ${String(b.count).padStart(5)}   ${ratio.toFixed(1).padStart(5)}%  ${bar}`,
    );
  }

  if (buckets[2].count / validConf > 0.5) {
    console.log('\n    ⚠️  학습 결과의 50% 이상이 confidence=0.5 정확히 → 학습 시 폴백값 박힌 듯');
  }

  // ─── [B] t_training_result vs t_apt_complex 매칭률 ───────────────────
  console.log('\n[B] LSTM 학습 결과 커버리지');
  console.log('─'.repeat(70));

  const totalComplex = await prisma.aptComplex.count();
  // sigunguCode + legalDong 키로 그룹핑된 학습 결과 수
  const distinctKeys = await prisma.$queryRaw<{ cnt: bigint }[]>`
    SELECT COUNT(DISTINCT CONCAT(sigungu_code, '|', legal_dong)) AS cnt
    FROM t_training_result
  `;
  const distinctKeyCount = Number(distinctKeys[0]?.cnt ?? 0);

  // 단지가 학습 결과를 가지는 비율 (sigunguCode + legalDong 매칭)
  const matchedComplex = await prisma.$queryRaw<{ cnt: bigint }[]>`
    SELECT COUNT(DISTINCT c.id) AS cnt
    FROM t_apt_complex c
    JOIN t_training_result tr
      ON tr.sigungu_code = c.sigungu_code AND tr.legal_dong = c.legal_dong
  `;
  const matchedCount = Number(matchedComplex[0]?.cnt ?? 0);
  const matchRatio = totalComplex > 0 ? (matchedCount / totalComplex) * 100 : 0;

  console.log(`    전체 단지: ${totalComplex.toLocaleString()}건`);
  console.log(`    학습 결과 distinct (시군구+법정동) 키: ${distinctKeyCount}건`);
  console.log(
    `    매칭된 단지 (LSTM endpoint 폴백 회피): ${matchedCount.toLocaleString()}건 (${matchRatio.toFixed(1)}%)`,
  );
  console.log(
    `    미매칭 단지 (LSTM endpoint → confidence=50 폴백): ${(totalComplex - matchedCount).toLocaleString()}건 (${(100 - matchRatio).toFixed(1)}%)`,
  );

  if (matchRatio < 50) {
    console.log('\n    ⚠️  LSTM 학습 결과 커버리지 50% 미만 → LSTM 카드는 대부분 50으로 폴백');
  }

  // ─── [C] ARIMA 진입 시뮬레이션 — 거래량 상위 10단지 ───────────────────
  console.log('\n[C] 거래량 상위 10단지의 ARIMA 진입 시뮬레이션');
  console.log('─'.repeat(70));
  console.log(`    (lstm.ts/arima.ts와 동일한 60개월 윈도우, complex_id 기준)\n`);

  const top10 = await prisma.$queryRaw<
    { id: number; name: string; sigungu_code: string; legal_dong: string; trade_count: bigint }[]
  >`
    SELECT c.id, c.name, c.sigungu_code, c.legal_dong, COUNT(t.id) AS trade_count
    FROM t_apt_complex c
    JOIN t_apt_trade t ON t.complex_id = c.id
    WHERE t.deal_date >= DATE_SUB(CURDATE(), INTERVAL 60 MONTH)
      AND t.area_m2 > 0
    GROUP BY c.id, c.name, c.sigungu_code, c.legal_dong
    ORDER BY trade_count DESC
    LIMIT 10
  `;

  console.log(
    '    ID      거래수  월수  ARIMA-c  LSTM-c  단지명',
  );
  console.log('    ─────────────────────────────────────────────────────────────');

  let arimaFallbackHigh = 0;
  let lstmFallbackHigh = 0;

  for (const c of top10) {
    // monthlyRows 시뮬레이션
    const monthly = await prisma.$queryRaw<{ ym: string; avg_price_per_m2: number }[]>`
      SELECT
        DATE_FORMAT(deal_date, '%Y-%m') AS ym,
        AVG(price_manwon / NULLIF(area_m2, 0)) AS avg_price_per_m2
      FROM t_apt_trade
      WHERE complex_id = ${c.id}
        AND area_m2 > 0
        AND deal_date >= DATE_SUB(CURDATE(), INTERVAL 60 MONTH)
      GROUP BY DATE_FORMAT(deal_date, '%Y-%m')
      ORDER BY ym ASC
    `;

    // ARIMA confidence 시뮬레이션
    let arimaConf = 50;
    let currentPpm = 0;
    if (monthly.length > 0) {
      currentPpm = Math.round(Number(monthly[monthly.length - 1].avg_price_per_m2));
    }
    if (monthly.length >= 4 && currentPpm > 0) {
      const window = monthly.slice(-24);
      const n = window.length;
      const prices = window.map((r) => Number(r.avg_price_per_m2));
      const xMean = (n - 1) / 2;
      const yMean = prices.reduce((s, v) => s + v, 0) / n;
      const ssXX = window.reduce((s, _, i) => s + (i - xMean) ** 2, 0);
      const ssXY = window.reduce((s, _, i) => s + (i - xMean) * (prices[i] - yMean), 0);
      const slope = ssXX > 0 ? ssXY / ssXX : 0;
      const ssTot = prices.reduce((s, v) => s + (v - yMean) ** 2, 0);
      const residuals = prices.map((v, i) => v - (yMean + slope * (i - xMean)));
      const ssRes = residuals.reduce((s, r) => s + r ** 2, 0);
      const r2 = ssTot > 0 ? Math.max(0, 1 - ssRes / ssTot) : 0;
      arimaConf = Math.round(50 + r2 * 30 + (Math.min(n, 24) / 24) * 15);
      arimaConf = Math.min(88, Math.max(50, arimaConf));
    }

    // LSTM confidence 시뮬레이션
    const tr = await prisma.trainingResult.findFirst({
      where: { sigunguCode: c.sigungu_code, legalDong: c.legal_dong },
      orderBy: { baseDate: 'desc' },
      select: { confidence: true },
    });
    const lstmConf = tr
      ? Math.round((tr.confidence ?? 0.7) * 100)
      : 50;

    if (arimaConf <= 55) arimaFallbackHigh++;
    if (lstmConf <= 55) lstmFallbackHigh++;

    console.log(
      `    ${String(c.id).padStart(5)}  ${String(c.trade_count).padStart(6)}  ${String(monthly.length).padStart(4)}  ${String(arimaConf).padStart(7)}  ${String(lstmConf).padStart(6)}  ${c.name.slice(0, 25)}`,
    );
  }

  console.log('');
  console.log(
    `    → ARIMA ≤55 (폴백 부근): ${arimaFallbackHigh}/${top10.length}건`,
  );
  console.log(
    `    → LSTM ≤55 (폴백 부근): ${lstmFallbackHigh}/${top10.length}건`,
  );

  // ─── [D] 전체 단지 ARIMA 폴백 진입률 ──────────────────────────────────
  console.log('\n[D] 전체 단지 ARIMA `monthlyRows < 4` 폴백 진입률');
  console.log('─'.repeat(70));

  const monthsPerComplex = await prisma.$queryRaw<{ id: number; months: bigint }[]>`
    SELECT
      c.id,
      COUNT(DISTINCT DATE_FORMAT(t.deal_date, '%Y-%m')) AS months
    FROM t_apt_complex c
    LEFT JOIN t_apt_trade t
      ON t.complex_id = c.id
     AND t.deal_date >= DATE_SUB(CURDATE(), INTERVAL 60 MONTH)
     AND t.area_m2 > 0
    GROUP BY c.id
  `;

  let lt4 = 0;
  let lt12 = 0;
  let ge24 = 0;
  for (const row of monthsPerComplex) {
    const m = Number(row.months);
    if (m < 4) lt4++;
    else if (m < 12) lt12++;
    else if (m >= 24) ge24++;
  }
  const total = monthsPerComplex.length;
  console.log(`    전체 단지: ${total.toLocaleString()}건`);
  console.log(
    `    < 4개월 (ARIMA 폴백 → confidence=50): ${lt4.toLocaleString()}건 (${((lt4 / total) * 100).toFixed(1)}%)`,
  );
  console.log(
    `    4~11개월 (ARIMA 계산 가능, 신뢰도 낮음): ${lt12.toLocaleString()}건 (${((lt12 / total) * 100).toFixed(1)}%)`,
  );
  console.log(
    `    ≥24개월 (ARIMA 풀카운트, 신뢰도 높음 가능): ${ge24.toLocaleString()}건 (${((ge24 / total) * 100).toFixed(1)}%)`,
  );

  // ─── [E] 처방전 ─────────────────────────────────────────────────────
  console.log('\n' + '='.repeat(70));
  console.log('📋 처방전');
  console.log('─'.repeat(70));

  const arimaFallbackRate = (lt4 / total) * 100;
  const lstmFallbackRate = 100 - matchRatio;

  if (arimaFallbackRate > 30 || lstmFallbackRate > 50) {
    console.log('\n  🔴 ROOT CAUSE — 단지(complex_id) 단위 데이터 sparsity');
    console.log(`     • ARIMA 폴백 진입률: ${arimaFallbackRate.toFixed(1)}% (단지별 거래 월수 < 4)`);
    console.log(`     • LSTM 폴백 진입률: ${lstmFallbackRate.toFixed(1)}% (학습 결과 매칭 실패)`);
    console.log('');
    console.log('  💡 권장 수정안');
    console.log('     A. ARIMA: complex_id → 행정동(sigungu_code+legal_dong) 집계로 폴백');
    console.log('        파일: server/src/routes/domains/arima.ts');
    console.log('        변경: monthlyRows < 4 일 때 행정동 단위 거래 집계로 재계산');
    console.log('');
    console.log('     B. LSTM: sigunguCode+legalDong 미매칭 시');
    console.log('        파일: server/src/routes/domains/lstm.ts');
    console.log('        변경: areaBucket+ageBucket 같은 그룹 행정동 평균 confidence 사용');
    console.log('              또는 ARIMA처럼 행정동 거래 데이터로 동적 산출');
  } else {
    console.log('  ✅ 데이터 sparsity 문제는 아닌 듯 — 다른 원인 의심');
    console.log('     실제 curl 응답 확인:');
    console.log('       npm run dev');
    console.log('       curl http://localhost:4000/api/lstm/<단지ID>');
    console.log('       curl http://localhost:4000/api/arima/<단지ID>');
  }

  console.log('');
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error('진단 실패:', e.message);
  await prisma.$disconnect();
  process.exit(1);
});
