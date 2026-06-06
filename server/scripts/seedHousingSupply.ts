/**
 * 주택 공급/미분양 수집 — 부동산원 R-ONE → t_housing_supply (ML 핸드오프 T1-b, 2026-06-06)
 *
 *  ▷ 수집 (시군구·월, 최소 서울 25구)
 *    · unsold        미분양 호수
 *    · move_in_units 입주(준공) 물량 호수 (선택)
 *    · permit_units  인허가 호수 (선택)
 *    공급은 가격을 *선행*하는 핵심 신호. sigunguCode + ym 으로 단지 패널에 join.
 *
 *  ▷ 구현 메모 (2026-06-06 실측 반영)
 *    R-ONE 미분양/공급 통계표는 **전국 계층형(시도>시군구)** 이고 지역키가 R-ONE 내부
 *    CLS_ID(예: 50018, LAWD 코드 아님!) 라서, REB 지수용 fetchRebPriceIndex(서울25구
 *    CLS_NM 매핑)로는 오매핑된다. 대신 fetchRebRawSeries 로 CLS_FULLNM("서울>강남구")
 *    을 보존해 받아, 여기서 "시도>시군구" 를 파싱해 서울 25구 LAWD 코드로 매핑한다.
 *    ("서울>계" 등 시도 총계 행은 제외.)
 *    ※ 수도권/전국 확장: 경기·인천은 미분양이 시(市) 단위(예: "경기>수원시")라 t_apt_complex
 *      의 구(區) 단위 sigunguCode 와 granularity 가 달라 별도 매핑 설계 필요 → 현재 서울만.
 *
 *  ▷ 사전 조건 (server/.env) — ★ 통계표 ID 는 R-ONE 포털 통계코드 검색에서 확정
 *      R-ONE-KEY                  (이미 REB 수집에 사용 중)
 *      REB_STATBL_ID_UNSOLD       미분양주택현황(시군구·월) 통계표 ID   ← 필수
 *      REB_STATBL_ID_MOVEIN       입주물량(준공) 통계표 ID              ← 선택
 *      REB_STATBL_ID_PERMIT       인허가 통계표 ID                      ← 선택
 *    (대안: KOSIS OpenAPI — 별도 KOSIS_API_KEY + orgId/tblId 필요. 그 경우 본 스크립트의
 *     fetch 부만 교체하고 매핑/upsert 로직은 재사용.)
 *
 *  ▷ 실행
 *    npm run seed:housing-supply
 *    npm run seed:housing-supply -- --start=201501 --end=202605
 *
 *  ▷ 결과 확인
 *    SELECT sigungu_code, COUNT(*), MIN(ym), MAX(ym) FROM t_housing_supply GROUP BY sigungu_code;
 */
import 'dotenv/config';
import { prisma } from '../src/services/db';
import { fetchRebRawSeries } from '../src/services/external/rebClient';
import { SEOUL_LAWD_CODES } from '../src/data/seoulLawdCodes';

function parseArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((a) => a.startsWith(prefix))?.slice(prefix.length);
}

const startYm = parseArg('start'); // "201501"
const endYm = parseArg('end'); // "202605"

/** 서울 구명 → LAWD 5자리 코드 (CLS_FULLNM "서울>강남구" 매핑용) */
const SEOUL_NAME_TO_CODE = new Map(SEOUL_LAWD_CODES.map((s) => [s.name, s.code]));

/**
 * CLS_FULLNM("시도>시군구") → 서울 25구 코드. 서울 외/시도총계("계")는 null.
 *  예: "서울>강남구" → "11680",  "서울>계" → null,  "경기>수원시" → null(현재 미지원)
 */
function resolveSeoulCode(clsFullName?: string): string | null {
  if (!clsFullName) return null;
  const parts = clsFullName.split('>').map((s) => s.trim());
  if (parts.length < 2) return null;
  const [sido, gu] = [parts[0], parts[parts.length - 1]];
  if (sido !== '서울' || gu === '계') return null;
  return SEOUL_NAME_TO_CODE.get(gu) ?? null;
}

/** (sigunguCode, ym) → 부분 공급 레코드 누적 */
type SupplyAcc = Map<string, { sigunguCode: string; ym: string; unsold?: number; moveInUnits?: number; permitUnits?: number }>;
const keyOf = (sigunguCode: string, ym: string) => `${sigunguCode}|${ym}`;

/** R-ONE 통계표 한 종을 fetch 해 (서울 25구만) 누적 맵에 병합 */
async function mergeSeries(
  acc: SupplyAcc,
  statblId: string | undefined,
  field: 'unsold' | 'moveInUnits' | 'permitUnits',
  label: string,
): Promise<number> {
  if (!statblId) {
    console.warn(`  ${label}: 통계표 ID 미설정 — 생략`);
    return 0;
  }
  console.log(`  ${label} 수집 (STATBL_ID=${statblId})...`);
  const rows = await fetchRebRawSeries({ statblId, dtacycleCd: 'MM', startWrttime: startYm, endWrttime: endYm });
  let mapped = 0;
  for (const r of rows) {
    const code = resolveSeoulCode(r.clsFullName);
    if (!code) continue; // 서울 외/시도총계 제외
    const k = keyOf(code, r.ym);
    const cur = acc.get(k) ?? { sigunguCode: code, ym: r.ym };
    cur[field] = Math.round(r.value); // 호수(Int)
    acc.set(k, cur);
    mapped++;
  }
  console.log(`    원시 ${rows.length}건 → 서울 매핑 ${mapped}건`);
  return mapped;
}

async function main() {
  console.log('=== 주택 공급/미분양 수집 (t_housing_supply) ===');
  console.log(`  기간: ${startYm ?? '36개월 전'} ~ ${endYm ?? '현재'}`);

  if (!process.env['R-ONE-KEY']) {
    console.error('\n[ERROR] R-ONE-KEY 미설정 — server/.env 에 추가하세요.');
    process.exit(1);
  }

  const statUnsold = process.env.REB_STATBL_ID_UNSOLD;
  const statMovein = process.env.REB_STATBL_ID_MOVEIN;
  const statPermit = process.env.REB_STATBL_ID_PERMIT;

  if (!statUnsold && !statMovein && !statPermit) {
    console.error('\n[ERROR] REB_STATBL_ID_UNSOLD / _MOVEIN / _PERMIT 모두 미설정.');
    console.error('  R-ONE 포털 통계코드 검색에서 "미분양주택현황" 등의 통계표 ID 를 찾아 .env 에 주입하세요.');
    console.error('  찾는 법: npm run reb:list -- "미분양"   (listRebTables 헬퍼)');
    process.exit(1);
  }

  const acc: SupplyAcc = new Map();
  await mergeSeries(acc, statUnsold, 'unsold', '미분양');
  await mergeSeries(acc, statMovein, 'moveInUnits', '입주물량');
  await mergeSeries(acc, statPermit, 'permitUnits', '인허가');

  const recs = [...acc.values()];
  console.log(`\n  upsert 대상 ${recs.length}건 (시군구×월)...`);

  let n = 0;
  const BATCH = 100;
  for (let i = 0; i < recs.length; i += BATCH) {
    const slice = recs.slice(i, i + BATCH);
    await Promise.all(
      slice.map((r) =>
        prisma.housingSupply.upsert({
          where: { sigunguCode_ym: { sigunguCode: r.sigunguCode, ym: r.ym } },
          update: { unsold: r.unsold ?? null, moveInUnits: r.moveInUnits ?? null, permitUnits: r.permitUnits ?? null },
          create: {
            sigunguCode: r.sigunguCode,
            ym: r.ym,
            unsold: r.unsold ?? null,
            moveInUnits: r.moveInUnits ?? null,
            permitUnits: r.permitUnits ?? null,
          },
        }),
      ),
    );
    n += slice.length;
    process.stdout.write(`\r  upsert ${n}/${recs.length}...`);
  }
  console.log('');

  const grouped = await prisma.$queryRawUnsafe<any[]>(
    `SELECT COUNT(DISTINCT sigungu_code) sgg, MIN(ym) minym, MAX(ym) maxym, COUNT(*) n FROM t_housing_supply`,
  );
  console.log('\n=== 완료 ===');
  console.log(`  ${JSON.stringify(grouped[0], (_k, v) => (typeof v === 'bigint' ? Number(v) : v))}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
