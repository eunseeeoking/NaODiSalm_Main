/**
 * 동 시세 사전집계 시드 (KI-21, 2026-06-04) — 추천 서브초화.
 *
 *  ▷ 목적
 *    동 × 거래유형(SALE/JEONSE/MONTHLY) × 매물종류조합 별 median·표본을 `t_dong_price_summary` 에
 *    배치 사전집계 → 추천 런타임이 raw 거래 median 재계산(worst ~2.7s) 대신 인덱스 조회(~10ms).
 *
 *  ▷ median 규약 (fetchRepresentativePrices / fetchRentCostByRegion 와 동일 — KI-8/10/16)
 *    - area 9~330 sanity · cutoff(최신 거래일 − 1년) · price/deposit/cost > 0
 *    - MONTHLY 반전세 제외: monthly >= deposit × RATE (KI-10)
 *    - 전월세 HAVING ≥ 5 (저표본 동 제외). SALE 은 표본 1건 이상이면 적재(count 부가).
 *    - 중위값 = 정렬 후 rn IN (FLOOR((n+1)/2), FLOOR((n+2)/2)) 평균 (SQL 윈도우 규약과 1:1).
 *
 *  ▷ typeKey = 정렬된 매물종류 조합 (예: "APT", "APT+OFFI", "APT+OFFI+SH+VILLA"). 런타임도 동일 정렬로 조회.
 *
 *  ▷ 실행
 *    cd server && npm run seed:price-summary
 *    (cutoff 갱신/환산율(RATE) 변경 시 재실행. 동별 raw 거래 1스캔 — 수 분.)
 *
 *  ▷ 사전 조건
 *    npx prisma db push (t_dong_price_summary 생성) + npx prisma generate
 *
 *  ▷ 결과 확인 (MySQL)
 *    SELECT deal_type, COUNT(*) FROM t_dong_price_summary GROUP BY deal_type;
 *    SELECT * FROM t_dong_price_summary WHERE dong='대치동' AND type_key='APT' ;
 */
import 'dotenv/config';
import { Prisma } from '@prisma/client';
import { prisma } from '../src/services/db';
import { JEONSE_TO_MONTHLY_RATE } from '../src/services/recommendation/scoring';

type PType = 'APT' | 'OFFI' | 'VILLA' | 'SH';
const SALE_TYPES: PType[] = ['APT', 'OFFI', 'VILLA']; // SH 매매 없음
const RENT_TYPES: PType[] = ['APT', 'OFFI', 'VILLA', 'SH'];
const COMPLEX: Record<PType, string> = {
  APT: 't_apt_complex', OFFI: 't_offi_complex', VILLA: 't_villa_complex', SH: 't_sh_complex',
};
const TRADE: Record<'APT' | 'OFFI' | 'VILLA', string> = {
  APT: 't_apt_trade', OFFI: 't_offi_trade', VILLA: 't_villa_trade',
};
const RENT: Record<PType, string> = {
  APT: 't_apt_rent', OFFI: 't_offi_rent', VILLA: 't_villa_rent', SH: 't_sh_rent',
};

const RATE = JEONSE_TO_MONTHLY_RATE;
const MIN_SAMPLE = 5;
const CONCURRENCY = 8;

/** SQL 윈도우 median 규약과 동일: 정렬 후 가운데 1(홀수)·2(짝수) 평균. */
function median(sorted: number[]): number {
  const n = sorted.length;
  const lo = Math.floor((n + 1) / 2) - 1;
  const hi = Math.floor((n + 2) / 2) - 1;
  return (sorted[lo] + sorted[hi]) / 2;
}
/** 정렬 조합 키 — 런타임 조회와 동일 규약(알파벳 정렬). */
function keyOf(types: PType[]): string {
  return [...types].sort().join('+');
}
/** 비어있지 않은 모든 부분집합. */
function nonEmptySubsets(arr: PType[]): PType[][] {
  const res: PType[][] = [];
  for (let mask = 1; mask < 1 << arr.length; mask++) {
    const s: PType[] = [];
    for (let i = 0; i < arr.length; i++) if (mask & (1 << i)) s.push(arr[i]);
    res.push(s);
  }
  return res;
}

type SaleRow = { t: PType; price: number };
type RentRow = { t: PType; deposit: number; monthly: number; contract: string };

/** 단일 동의 매매 raw 거래 (APT/OFFI/VILLA pooled, area·cutoff·price>0). */
async function fetchSale(sigungu: string, dong: string, cut: Date | null): Promise<SaleRow[]> {
  const parts = SALE_TYPES.map(
    (t) => Prisma.sql`
      SELECT ${t} AS t, tr.price_manwon AS price
      FROM ${Prisma.raw(COMPLEX[t])} c
      STRAIGHT_JOIN ${Prisma.raw(TRADE[t as 'APT' | 'OFFI' | 'VILLA'])} tr ON tr.complex_id = c.id
      WHERE c.sigungu_code = ${sigungu} AND c.legal_dong = ${dong}
        AND tr.area_m2 BETWEEN 9 AND 330 AND tr.price_manwon > 0
        ${cut ? Prisma.sql`AND tr.deal_date >= ${cut}` : Prisma.empty}`,
  );
  const rows = await prisma.$queryRaw<{ t: PType; price: number }[]>(Prisma.join(parts, ' UNION ALL '));
  return rows.map((r) => ({ t: r.t, price: Number(r.price) }));
}

/** 단일 동의 전월세 raw 거래 (4종 pooled, area·cutoff). 반전세 필터는 JS 에서. */
async function fetchRent(sigungu: string, dong: string, cut: Date | null): Promise<RentRow[]> {
  const parts = RENT_TYPES.map(
    (t) => Prisma.sql`
      SELECT ${t} AS t, r.deposit_manwon AS deposit, r.monthly_manwon AS monthly, r.contract_type AS contract
      FROM ${Prisma.raw(COMPLEX[t])} c
      STRAIGHT_JOIN ${Prisma.raw(RENT[t])} r ON r.complex_id = c.id
      WHERE c.sigungu_code = ${sigungu} AND c.legal_dong = ${dong}
        AND r.area_m2 BETWEEN 9 AND 330
        ${cut ? Prisma.sql`AND r.contract_date >= ${cut}` : Prisma.empty}`,
  );
  const rows = await prisma.$queryRaw<{ t: PType; deposit: number; monthly: number; contract: string }[]>(
    Prisma.join(parts, ' UNION ALL '),
  );
  return rows.map((r) => ({ t: r.t, deposit: Number(r.deposit), monthly: Number(r.monthly), contract: r.contract }));
}

async function computeDong(
  sigungu: string,
  dong: string,
  saleCut: Date | null,
  rentCut: Date | null,
  saleSubsets: PType[][],
  rentSubsets: PType[][],
): Promise<Prisma.DongPriceSummaryCreateManyInput[]> {
  const out: Prisma.DongPriceSummaryCreateManyInput[] = [];

  // ── SALE ──
  const saleRows = await fetchSale(sigungu, dong, saleCut);
  if (saleRows.length > 0) {
    for (const sub of saleSubsets) {
      const set = new Set(sub);
      const prices = saleRows.filter((r) => set.has(r.t)).map((r) => r.price).sort((a, b) => a - b);
      if (prices.length === 0) continue;
      out.push({
        sigunguCode: sigungu, dong, dealType: 'SALE', typeKey: keyOf(sub),
        saleMedian: Math.round(median(prices)), sampleCount: prices.length,
      });
    }
  }

  // ── RENT (JEONSE / MONTHLY) ──
  const rentRows = await fetchRent(sigungu, dong, rentCut);
  if (rentRows.length > 0) {
    for (const sub of rentSubsets) {
      const set = new Set(sub);
      // JEONSE — deposit>0, HAVING≥5. cost = deposit×RATE (단조), monthly=0.
      const jeon = rentRows.filter((r) => set.has(r.t) && r.contract === 'JEONSE' && r.deposit > 0);
      if (jeon.length >= MIN_SAMPLE) {
        const depM = Math.round(median(jeon.map((r) => r.deposit).sort((a, b) => a - b)));
        out.push({
          sigunguCode: sigungu, dong, dealType: 'JEONSE', typeKey: keyOf(sub),
          depositMedian: depM, costMedian: Math.round(depM * RATE * 100) / 100, monthlyMedian: 0,
          sampleCount: jeon.length,
        });
      }
      // MONTHLY — 반전세 제외(monthly >= deposit×RATE), cost>0, HAVING≥5.
      const wol = rentRows.filter(
        (r) => set.has(r.t) && r.contract === 'WOLSE' && r.monthly >= r.deposit * RATE && r.monthly + r.deposit * RATE > 0,
      );
      if (wol.length >= MIN_SAMPLE) {
        out.push({
          sigunguCode: sigungu, dong, dealType: 'MONTHLY', typeKey: keyOf(sub),
          costMedian: Math.round(median(wol.map((r) => r.monthly + r.deposit * RATE).sort((a, b) => a - b)) * 100) / 100,
          depositMedian: Math.round(median(wol.map((r) => r.deposit).sort((a, b) => a - b))),
          monthlyMedian: Math.round(median(wol.map((r) => r.monthly).sort((a, b) => a - b))),
          sampleCount: wol.length,
        });
      }
    }
  }
  return out;
}

async function main() {
  console.log(`[seed:price-summary] 시작 (RATE=${RATE})`);

  const saleMax = await prisma.aptTrade.aggregate({ _max: { dealDate: true } });
  const rentMax = await prisma.aptRent.aggregate({ _max: { contractDate: true } });
  const saleCut = saleMax._max.dealDate ? new Date(saleMax._max.dealDate) : null;
  if (saleCut) saleCut.setFullYear(saleCut.getFullYear() - 1);
  const rentCut = rentMax._max.contractDate ? new Date(rentMax._max.contractDate) : null;
  if (rentCut) rentCut.setFullYear(rentCut.getFullYear() - 1);
  console.log(`  cutoff sale=${saleCut?.toISOString().slice(0, 10)} rent=${rentCut?.toISOString().slice(0, 10)}`);

  const dongs = await prisma.$queryRaw<{ sigungu_code: string; legal_dong: string }[]>(Prisma.sql`
    SELECT DISTINCT sigungu_code, legal_dong FROM (
      SELECT sigungu_code, legal_dong FROM t_apt_complex
      UNION SELECT sigungu_code, legal_dong FROM t_offi_complex
      UNION SELECT sigungu_code, legal_dong FROM t_villa_complex
      UNION SELECT sigungu_code, legal_dong FROM t_sh_complex
    ) u WHERE legal_dong IS NOT NULL AND legal_dong <> ''
  `);
  console.log(`  대상 동 ${dongs.length}개`);

  await prisma.dongPriceSummary.deleteMany({});

  const saleSubsets = nonEmptySubsets(SALE_TYPES);
  const rentSubsets = nonEmptySubsets(RENT_TYPES);

  let processed = 0;
  let rowsTotal = 0;
  for (let i = 0; i < dongs.length; i += CONCURRENCY) {
    const batch = dongs.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map((d) => computeDong(d.sigungu_code, d.legal_dong, saleCut, rentCut, saleSubsets, rentSubsets)),
    );
    const flat = results.flat();
    if (flat.length > 0) {
      await prisma.dongPriceSummary.createMany({ data: flat });
      rowsTotal += flat.length;
    }
    processed += batch.length;
    if (processed % 200 === 0 || processed >= dongs.length) {
      console.log(`  ${processed}/${dongs.length} 동 · 누적 ${rowsTotal}행`);
    }
  }

  console.log(`[seed:price-summary] 완료 — ${rowsTotal}행 적재`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error('[seed:price-summary] 실패:', e);
  await prisma.$disconnect();
  process.exit(1);
});
