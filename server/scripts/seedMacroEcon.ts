/**
 * 거시 경제지표 수집 — ECOS → t_macro_econ (ML 핸드오프 T2, 2026-06-06)
 *
 *  ▷ 수집
 *    · cpi            소비자물가지수 (2020=100)
 *    · m2             M2 광의통화 말잔 (조원)
 *    · household_loan 가계신용/가계대출 잔액 (조원)
 *    월별, 2015-01 ~ 현재, 전국 단일 series.
 *
 *  ▷ 사전 조건 (server/.env) — ★ 통계표/항목코드는 ECOS 포털에서 검증 후 주입
 *      ECOS_API_KEY
 *      ECOS_STAT_CPI / ECOS_ITEM_CPI         소비자물가지수 총지수 (후보 901Y009 / 0)
 *      ECOS_STAT_M2  / ECOS_ITEM_M2          M2 말잔 (포털 확인)
 *      ECOS_STAT_HHLOAN / ECOS_ITEM_HHLOAN   가계신용 잔액 (포털 확인)
 *    (코드 찾는 법은 ecosClient.ts 헤더 참고. M2·가계신용은 분기/월 혼재하니 주기 확인)
 *
 *  ▷ 단위 주의
 *    M2·가계신용 원 데이터는 보통 "십억원" 또는 "백만원" → 조원으로 환산해 저장하려면
 *    아래 UNIT_DIVISOR 를 통계표 UNIT_NAME 에 맞게 조정. (기본 1 = 원 단위 그대로 저장)
 *
 *  ▷ 실행
 *    npm run seed:macro-econ
 *    npm run seed:macro-econ -- --start=2015-01 --end=2026-05
 */
import 'dotenv/config';
import { prisma } from '../src/services/db';
import { fetchEcosSeries, ecosSpecFromEnv, type EcosPoint } from '../src/services/external/ecosClient';

function parseArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((a) => a.startsWith(prefix))?.slice(prefix.length);
}
const num = (s: string | undefined, d: number) => (s != null && Number.isFinite(Number(s)) ? Number(s) : d);

function defaultRange(): { start: string; end: string } {
  const now = new Date();
  const end = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  return { start: '2015-01', end };
}

function toMap(points: EcosPoint[], divisor: number): Map<string, number> {
  return new Map(points.map((p) => [p.ym, p.value / divisor]));
}

async function main() {
  const { start: dStart, end: dEnd } = defaultRange();
  const start = parseArg('start') ?? dStart;
  const end = parseArg('end') ?? dEnd;

  // 조원 환산용 (예: 원데이터가 십억원이면 --m2-divisor=1000)
  const m2Div = num(parseArg('m2-divisor'), 1);
  const hhDiv = num(parseArg('hhloan-divisor'), 1);

  console.log('=== ECOS 경제지표 수집 (t_macro_econ) ===');
  console.log(`  기간: ${start} ~ ${end} (m2÷${m2Div}, hhloan÷${hhDiv})`);

  if (!process.env.ECOS_API_KEY) {
    console.error('\n[ERROR] ECOS_API_KEY 미설정 — server/.env 에 추가하세요.');
    process.exit(1);
  }

  const cpiSpec = ecosSpecFromEnv('ECOS_STAT_CPI', 'ECOS_ITEM_CPI');
  const m2Spec = ecosSpecFromEnv('ECOS_STAT_M2', 'ECOS_ITEM_M2');
  const hhSpec = ecosSpecFromEnv('ECOS_STAT_HHLOAN', 'ECOS_ITEM_HHLOAN');

  if (!cpiSpec.statCode && !m2Spec.statCode && !hhSpec.statCode) {
    console.error('\n[ERROR] ECOS_STAT_CPI / _M2 / _HHLOAN 모두 미설정 — 최소 하나는 .env 에 주입하세요.');
    process.exit(1);
  }

  console.log('\n[1/3] 소비자물가지수...');
  const cpiMap = cpiSpec.statCode ? toMap(await fetchEcosSeries(cpiSpec, start, end), 1) : new Map();
  console.log('\n[2/3] M2 통화량...');
  const m2Map = m2Spec.statCode ? toMap(await fetchEcosSeries(m2Spec, start, end), m2Div) : new Map();
  console.log('\n[3/3] 가계대출 잔액...');
  const hhMap = hhSpec.statCode ? toMap(await fetchEcosSeries(hhSpec, start, end), hhDiv) : new Map();

  const yms = [...new Set([...cpiMap.keys(), ...m2Map.keys(), ...hhMap.keys()])].sort();
  console.log(`\n  upsert 대상 ${yms.length}개월...`);

  let n = 0;
  const BATCH = 50;
  for (let i = 0; i < yms.length; i += BATCH) {
    const slice = yms.slice(i, i + BATCH);
    await Promise.all(
      slice.map((ym) =>
        prisma.macroEcon.upsert({
          where: { ym },
          update: { cpi: cpiMap.get(ym) ?? null, m2: m2Map.get(ym) ?? null, householdLoan: hhMap.get(ym) ?? null },
          create: { ym, cpi: cpiMap.get(ym) ?? null, m2: m2Map.get(ym) ?? null, householdLoan: hhMap.get(ym) ?? null },
        }),
      ),
    );
    n += slice.length;
    process.stdout.write(`\r  upsert ${n}/${yms.length}...`);
  }
  console.log('');

  const sample = await prisma.macroEcon.findMany({ orderBy: { ym: 'desc' }, take: 3 });
  console.log('\n=== 완료 ===');
  console.log(`  총 ${n}개월 적재. 최신 3개월:`);
  sample.forEach((r) => console.log(`    ${r.ym}: cpi ${r.cpi ?? '-'} / m2 ${r.m2 ?? '-'} / hhLoan ${r.householdLoan ?? '-'}`));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
