/**
 * 거시 금융지표(금리) 수집 — ECOS → t_macro_rate (ML 핸드오프 T1-a, 2026-06-06)
 *
 *  ▷ 수집
 *    · base_rate     한국은행 기준금리 (%)
 *    · mortgage_rate 예금은행 가중평균금리(신규취급액) 주택담보대출 (%)
 *    월별, 2015-01 ~ 현재, 전국 단일 series → ym 으로 broadcast join.
 *
 *  ▷ 사전 조건 (server/.env) — ★ 통계표/항목코드는 ECOS 포털에서 검증 후 주입
 *      ECOS_API_KEY            ECOS OpenAPI 인증키 (https://ecos.bok.or.kr → OpenAPI)
 *      ECOS_STAT_BASE_RATE     기준금리 통계표코드        (후보 722Y001)
 *      ECOS_ITEM_BASE_RATE     기준금리 항목코드          (후보 0101000)
 *      ECOS_STAT_MORTGAGE      주담대 가중평균금리 통계표코드 (후보 721Y001)
 *      ECOS_ITEM_MORTGAGE      주담대 가중평균금리 항목코드   (포털 확인)
 *    (코드 찾는 법은 src/services/external/ecosClient.ts 헤더 참고)
 *
 *  ▷ 실행
 *    npm run seed:macro-rate
 *    npm run seed:macro-rate -- --start=2015-01 --end=2026-05
 *
 *  ▷ 결과 확인
 *    SELECT ym, base_rate, mortgage_rate FROM t_macro_rate ORDER BY ym;
 */
import 'dotenv/config';
import { prisma } from '../src/services/db';
import { fetchEcosSeries, ecosSpecFromEnv, type EcosPoint } from '../src/services/external/ecosClient';

function parseArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((a) => a.startsWith(prefix))?.slice(prefix.length);
}

/** 기본 범위: 2015-01 ~ 이번 달 (실거래 데이터 범위와 정렬) */
function defaultRange(): { start: string; end: string } {
  const now = new Date();
  const end = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  return { start: '2015-01', end };
}

/** EcosPoint[] → Map<ym, value> */
function toMap(points: EcosPoint[]): Map<string, number> {
  return new Map(points.map((p) => [p.ym, p.value]));
}

async function main() {
  const { start: dStart, end: dEnd } = defaultRange();
  const start = parseArg('start') ?? dStart;
  const end = parseArg('end') ?? dEnd;

  console.log('=== ECOS 금리 수집 (t_macro_rate) ===');
  console.log(`  기간: ${start} ~ ${end}`);

  if (!process.env.ECOS_API_KEY) {
    console.error('\n[ERROR] ECOS_API_KEY 미설정 — server/.env 에 추가하세요.');
    console.error('  발급: https://ecos.bok.or.kr → OpenAPI 서비스 신청 (무료)');
    process.exit(1);
  }

  const baseSpec = ecosSpecFromEnv('ECOS_STAT_BASE_RATE', 'ECOS_ITEM_BASE_RATE');
  const mortSpec = ecosSpecFromEnv('ECOS_STAT_MORTGAGE', 'ECOS_ITEM_MORTGAGE');

  if (!baseSpec.statCode && !mortSpec.statCode) {
    console.error('\n[ERROR] ECOS_STAT_BASE_RATE / ECOS_STAT_MORTGAGE 둘 다 미설정.');
    console.error('  ECOS 포털 통계검색에서 통계표코드·항목코드를 찾아 .env 에 주입하세요.');
    console.error('  후보(검증필수): 기준금리 722Y001/0101000, 주담대 가중평균 721Y001/항목.');
    process.exit(1);
  }

  console.log('\n[1/2] 기준금리...');
  const baseMap = baseSpec.statCode ? toMap(await fetchEcosSeries(baseSpec, start, end)) : new Map();
  if (!baseSpec.statCode) console.warn('  ECOS_STAT_BASE_RATE 미설정 — base_rate 생략');

  console.log('\n[2/2] 주담대 가중평균금리...');
  const mortMap = mortSpec.statCode ? toMap(await fetchEcosSeries(mortSpec, start, end)) : new Map();
  if (!mortSpec.statCode) console.warn('  ECOS_STAT_MORTGAGE 미설정 — mortgage_rate 생략');

  // ym 합집합 → upsert (순차 배치, 커넥션 포화 방지)
  const yms = [...new Set([...baseMap.keys(), ...mortMap.keys()])].sort();
  console.log(`\n  upsert 대상 ${yms.length}개월...`);

  let n = 0;
  const BATCH = 50;
  for (let i = 0; i < yms.length; i += BATCH) {
    const slice = yms.slice(i, i + BATCH);
    await Promise.all(
      slice.map((ym) => {
        const baseRate = baseMap.get(ym) ?? null;
        const mortgageRate = mortMap.get(ym) ?? null;
        return prisma.macroRate.upsert({
          where: { ym },
          update: { baseRate, mortgageRate },
          create: { ym, baseRate, mortgageRate },
        });
      }),
    );
    n += slice.length;
    process.stdout.write(`\r  upsert ${n}/${yms.length}...`);
  }
  console.log('');

  const sample = await prisma.macroRate.findMany({ orderBy: { ym: 'desc' }, take: 3 });
  console.log('\n=== 완료 ===');
  console.log(`  총 ${n}개월 적재. 최신 3개월:`);
  sample.forEach((r) => console.log(`    ${r.ym}: 기준 ${r.baseRate ?? '-'} / 주담대 ${r.mortgageRate ?? '-'}`));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
