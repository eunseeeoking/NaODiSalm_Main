/**
 * DB 현황 스냅샷 — server/doc/db-state.md 자동 생성
 *
 *  ▷ 목적: 새 AI 세션 시작 전 DB 상태를 문서화.
 *           AI가 db-state.md 를 읽으면 어떤 데이터가 있는지 즉시 파악.
 *
 *  ▷ 실행: npm run db:snapshot
 *           → server/doc/db-state.md 덮어쓰기
 *
 *  ▷ 권장: 시드 실행 후, 또는 새 세션 시작 전 1회 실행
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { prisma } from '../src/services/db';

type RawCountRow = { cnt: bigint };

async function count(table: string): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<RawCountRow[]>(
    `SELECT COUNT(*) AS cnt FROM \`${table}\``,
  ).catch(() => [{ cnt: BigInt(0) }]);
  return Number(rows[0]?.cnt ?? 0);
}

async function main() {
  console.log('[db:snapshot] DB 현황 수집 중...');
  const now = new Date().toISOString().slice(0, 16).replace('T', ' ');

  /* ─── 테이블별 row count ─── */
  const [
    aptComplex,
    aptTrade,
    aptRent,
    legalDong,
    legalDongSeoul10,
    commuteMatrix,
    trainingResult,
    rebPriceIndex,
    lhYouthHousing,
    transitSummary,
    safetyIndex,
    incomeQuintile,
    userCount,
  ] = await Promise.all([
    count('t_apt_complex'),
    count('t_apt_trade'),
    count('t_apt_rent'),
    count('t_legal_dong'),
    prisma.legalDong.count({ where: { code: { startsWith: '11' }, dong: { not: null } } }),
    count('t_commute_matrix'),
    count('t_training_result'),
    count('t_reb_price_index'),
    count('t_lh_youth_housing'),
    count('t_transit_route_summary'),
    count('t_safety_index'),
    count('t_income_quintile'),
    count('t_user'),
  ]);

  /* ─── 핵심 메트릭 ─── */
  // 아파트 거래: 최신 거래일 / 가격 범위
  const tradeStats = await prisma.aptTrade.aggregate({
    _max: { dealDate: true, priceManwon: true },
    _min: { dealDate: true, priceManwon: true },
    _avg: { priceManwon: true },
  }).catch(() => null);

  // 통근 캐시: 직장 그룹 수
  type CacheKeyRow = { cnt: bigint };
  const cacheKeys = await prisma.$queryRaw<CacheKeyRow[]>`
    SELECT COUNT(DISTINCT cache_key) AS cnt FROM t_commute_matrix
  `.catch(() => [{ cnt: BigInt(0) }]);

  // 소득 분위 내역
  const incomeRows = await prisma.incomeQuintile.findMany({
    orderBy: { quintile: 'asc' },
  }).catch(() => []);

  // 안전지표: 서울 자치구별 평균 (상위 5개)
  type SafetyAvgRow = { sigungu: string; avg_score: number; cnt: bigint };
  const safetyAvg = await prisma.$queryRaw<SafetyAvgRow[]>`
    SELECT ld.sigungu, AVG(si.total_score) AS avg_score, COUNT(*) AS cnt
    FROM t_safety_index si
    JOIN t_legal_dong ld ON ld.code = si.legal_dong_code
    GROUP BY ld.sigungu
    ORDER BY avg_score DESC
    LIMIT 5
  `.catch(() => [] as SafetyAvgRow[]);

  // TAGO 대중교통: transitScore 통계
  type TransitStatRow = { avg_score: number; min_score: number; max_score: number; cnt: bigint };
  const transitStat = await prisma.$queryRaw<TransitStatRow[]>`
    SELECT AVG(transit_score) AS avg_score,
           MIN(transit_score) AS min_score,
           MAX(transit_score) AS max_score,
           COUNT(*) AS cnt
    FROM t_transit_route_summary
  `.catch(() => [{ avg_score: 0, min_score: 0, max_score: 0, cnt: BigInt(0) }]);

  // LH 청년주택: 프로그램 유형별
  type LhTypeRow = { program_type: string; total_units: bigint; cnt: bigint };
  const lhByType = await prisma.$queryRaw<LhTypeRow[]>`
    SELECT program_type, SUM(units_available) AS total_units, COUNT(*) AS cnt
    FROM t_lh_youth_housing
    GROUP BY program_type
  `.catch(() => [] as LhTypeRow[]);

  // R-ONE: 적재된 시군구 수 / 기간
  type RebStatRow = { cnt: bigint; min_ym: string; max_ym: string; sigungu_cnt: bigint };
  const rebStat = await prisma.$queryRaw<RebStatRow[]>`
    SELECT COUNT(*) AS cnt, MIN(ym) AS min_ym, MAX(ym) AS max_ym,
           COUNT(DISTINCT sigungu_code) AS sigungu_cnt
    FROM t_reb_price_index
  `.catch(() => [{ cnt: BigInt(0), min_ym: '-', max_ym: '-', sigungu_cnt: BigInt(0) }]);

  // 추천 가능 행정동 수 (단지 + 거래 + legal_dong 3중 매칭)
  type MatchRow = { cnt: bigint };
  const matchableDongs = await prisma.$queryRaw<MatchRow[]>`
    SELECT COUNT(DISTINCT ac.sigungu_code, ac.legal_dong) AS cnt
    FROM t_apt_complex ac
    INNER JOIN t_apt_trade at2 ON at2.complex_id = ac.id
    WHERE ac.lat IS NOT NULL AND ac.lng IS NOT NULL
      AND ac.sigungu_code LIKE '11%'
  `.catch(() => [{ cnt: BigInt(0) }]);

  /* ─── Markdown 생성 ─── */
  const lines: string[] = [
    `# DB 상태 스냅샷`,
    ``,
    `> 자동 생성: \`npm run db:snapshot\` — ${now}`,
    `> 새 AI 세션 시작 전 이 파일을 읽으면 DB 현황을 즉시 파악할 수 있습니다.`,
    ``,
    `---`,
    ``,
    `## 테이블별 Row Count`,
    ``,
    `| 테이블 | Row 수 | 설명 |`,
    `|--------|--------|------|`,
    `| t_apt_complex | ${aptComplex.toLocaleString()} | 아파트 단지 마스터 |`,
    `| t_apt_trade | ${aptTrade.toLocaleString()} | 매매 실거래 |`,
    `| t_apt_rent | ${aptRent.toLocaleString()} | 전월세 실거래 |`,
    `| t_legal_dong | ${legalDong.toLocaleString()} | BJD 법정동 코드 (서울 10자리: ${legalDongSeoul10.toLocaleString()}) |`,
    `| t_commute_matrix | ${commuteMatrix.toLocaleString()} | ODsay 통근시간 캐시 |`,
    `| t_training_result | ${trainingResult.toLocaleString()} | LSTM 학습 결과 |`,
    `| t_reb_price_index | ${rebPriceIndex.toLocaleString()} | 부동산원 실거래지수 |`,
    `| t_lh_youth_housing | ${lhYouthHousing.toLocaleString()} | LH 청년주택 공급 |`,
    `| t_transit_route_summary | ${transitSummary.toLocaleString()} | TAGO 대중교통 품질 |`,
    `| t_safety_index | ${safetyIndex.toLocaleString()} | 행정동 안전지표 합성 |`,
    `| t_income_quintile | ${incomeQuintile.toLocaleString()} | 통계청 소득 분위 |`,
    `| t_user | ${userCount.toLocaleString()} | 서비스 사용자 |`,
    ``,
    `---`,
    ``,
    `## 핵심 데이터 현황`,
    ``,
    `### 아파트 실거래 (t_apt_trade)`,
  ];

  if (tradeStats) {
    const minDate = tradeStats._min.dealDate?.toISOString().slice(0, 10) ?? '-';
    const maxDate = tradeStats._max.dealDate?.toISOString().slice(0, 10) ?? '-';
    const avgPrice = tradeStats._avg.priceManwon ? Math.round(Number(tradeStats._avg.priceManwon)).toLocaleString() : '-';
    const maxPrice = tradeStats._max.priceManwon ? Number(tradeStats._max.priceManwon).toLocaleString() : '-';
    lines.push(
      `\`\`\``,
      `거래 기간:  ${minDate} ~ ${maxDate}`,
      `평균 가격:  ${avgPrice} 만원`,
      `최고 가격:  ${maxPrice} 만원`,
      `\`\`\``,
    );
  }

  lines.push(
    ``,
    `### 통근 캐시 (t_commute_matrix)`,
    `\`\`\``,
    `직장 그룹 수: ${Number(cacheKeys[0]?.cnt ?? 0)}개 (4자리 반올림 좌표 기준)`,
    `총 캐시 row: ${commuteMatrix.toLocaleString()}건`,
    `\`\`\``,
    ``,
    `### 추천 가능 행정동`,
    `\`\`\``,
    `단지+거래+좌표 3중 매칭 서울 행정동: ${Number(matchableDongs[0]?.cnt ?? 0)}개`,
    `\`\`\``,
    ``,
    `### 소득 분위 (t_income_quintile)`,
    `\`\`\``,
  );

  for (const r of incomeRows) {
    lines.push(`${r.quintile}분위: 월 ${r.avgIncome.toLocaleString()}만원  — ${r.description ?? ''}`);
  }
  if (incomeRows.length === 0) lines.push('(미적재 — npm run seed:income 실행 필요)');
  lines.push('```');

  lines.push(
    ``,
    `### 안전지표 상위 5개 자치구 (t_safety_index)`,
    `\`\`\``,
  );
  for (const r of safetyAvg) {
    lines.push(`${r.sigungu.padEnd(5)}: ${Number(r.avg_score).toFixed(1)}점  (${Number(r.cnt)}개 동)`);
  }
  if (safetyAvg.length === 0) lines.push('(미적재 — npm run seed:safety 실행 필요)');
  lines.push('```');

  const ts = transitStat[0];
  lines.push(
    ``,
    `### TAGO 대중교통 품질 (t_transit_route_summary)`,
    `\`\`\``,
    `적재 행정동: ${Number(ts?.cnt ?? 0)}개`,
    `평균 transitScore: ${Number(ts?.avg_score ?? 0).toFixed(1)} / 최저: ${Number(ts?.min_score ?? 0)} / 최고: ${Number(ts?.max_score ?? 0)}`,
    `\`\`\``,
    ``,
    `### LH 청년주택 (t_lh_youth_housing)`,
    `\`\`\``,
  );
  for (const r of lhByType) {
    lines.push(`${r.program_type}: ${Number(r.cnt)}건, 총 ${Number(r.total_units).toLocaleString()}세대`);
  }
  if (lhByType.length === 0) lines.push('(미적재 — npm run seed:lh 실행 필요)');
  lines.push('```');

  const rb = rebStat[0];
  lines.push(
    ``,
    `### R-ONE 부동산원 지수 (t_reb_price_index)`,
    `\`\`\``,
    `적재 row: ${Number(rb?.cnt ?? 0).toLocaleString()}건`,
    `기간: ${rb?.min_ym ?? '-'} ~ ${rb?.max_ym ?? '-'}`,
    `자치구 수: ${Number(rb?.sigungu_cnt ?? 0)}개`,
    `\`\`\``,
    ``,
    `---`,
    ``,
    `## AI 세션 시작 시 체크리스트`,
    ``,
    `다음 항목이 0이면 해당 시드를 먼저 실행:`,
    ``,
    `\`\`\``,
    `t_income_quintile  ${incomeQuintile}건  ${incomeQuintile === 5 ? '✅' : '❌ → npm run seed:income'}`,
    `t_safety_index     ${safetyIndex}건  ${safetyIndex > 400 ? '✅' : '❌ → npm run seed:safety'}`,
    `t_lh_youth_housing ${lhYouthHousing}건  ${lhYouthHousing > 1000 ? '✅' : '❌ → npm run seed:lh'}`,
    `t_transit_route_summary ${transitSummary}건  ${transitSummary > 0 ? '✅' : '❌ → npm run seed:transit'}`,
    `t_reb_price_index  ${rebPriceIndex}건  ${rebPriceIndex > 0 ? '✅' : '❌ → npm run seed:reb (R-ONE-KEY 필요)'}`,
    `\`\`\``,
    ``,
    `## 서버 기동 확인`,
    ``,
    `\`\`\`powershell`,
    `# 서버 기동`,
    `cd C:\\git\\2026_MOLIT_CONTEST`,
    `npm run dev`,
    ``,
    `# 강남역 추천 API 테스트`,
    "curl -X POST http://localhost:4000/api/recommendations \\",
    "  -H 'Content-Type: application/json' \\",
    `  -d '{"workplace":{"lat":37.4979,"lng":127.0276,"label":"강남역"},"budget":40000,"weights":{"commute":35,"affordability":30,"safety":20,"life":15},"patience":45}'`,
    `\`\`\``,
  );

  /* ─── 파일 저장 ─── */
  const outPath = path.resolve(__dirname, '../doc/db-state.md');
  fs.writeFileSync(outPath, lines.join('\n'), 'utf-8');
  console.log(`[db:snapshot] 완료 → ${outPath}`);
  console.log(`[db:snapshot] 주요 현황:`);
  console.log(`  아파트 거래: ${aptTrade.toLocaleString()}건`);
  console.log(`  안전지표:   ${safetyIndex}건`);
  console.log(`  소득분위:   ${incomeQuintile}건`);
  console.log(`  추천 가능 행정동: ${Number(matchableDongs[0]?.cnt ?? 0)}개`);
}

main()
  .catch((e) => {
    console.error('[db:snapshot] 오류:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
