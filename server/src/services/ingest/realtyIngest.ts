import { prisma } from '../db';
import {
  fetchTradesByType,
  fetchRentsByType,
  type PropertyType,
  type NormalizedTrade,
  type NormalizedRent,
} from '../external/molit';

/**
 * 비-아파트(오피스텔/연립다세대/단독다가구) 실거래 ingest 오케스트레이터.
 *
 *  - aptIngest.ts 와 동일한 흐름이지만 유형별 분리 테이블을 대상으로 한다.
 *  - 비-아파트는 단지 고유 ID(aptSeq)가 없으므로 단지 매칭은
 *    (sigunguCode, legalDong, name, builtYear) fingerprint 1단계만 사용.
 *  - SH(단독/다가구)는 매매 테이블이 없어 trade 가 비어있다 (config.trade 미지정).
 *
 *  사용:
 *    await ingestRealtySigunguMonth('OFFI', '11680', '202504');
 */

/** Prisma 델리게이트는 모델마다 타입이 달라 느슨하게 받는다 (런타임 안전). */
interface TypeConfig {
  /** prisma.{x}Complex 델리게이트 */
  complex: {
    findUnique: (a: unknown) => Promise<{ id: number } | null>;
    create: (a: unknown) => Promise<{ id: number }>;
    update: (a: unknown) => Promise<unknown>;
  };
  /** prisma.{x}Rent 델리게이트 */
  rent: { createMany: (a: unknown) => Promise<{ count: number }> };
  /** prisma.{x}Trade 델리게이트 (SH 는 없음) */
  trade?: { createMany: (a: unknown) => Promise<{ count: number }> };
  /** 복합 unique 인덱스 이름 (Prisma where 키) */
  complexWhereKey: string; // e.g. "sigunguCode_legalDong_name_builtYear"
}

function configFor(type: PropertyType): TypeConfig {
  const p = prisma as unknown as Record<string, TypeConfig['complex'] & TypeConfig['rent'] & TypeConfig['trade']>;
  const key = 'sigunguCode_legalDong_name_builtYear';
  switch (type) {
    case 'APT':
      // APT 는 aptIngest.ts(aptSeq 매칭 포함)를 쓰는 것이 정석.
      // 여기서는 호환을 위해 fingerprint 기반으로만 처리.
      return { complex: p.aptComplex, rent: p.aptRent, trade: p.aptTrade, complexWhereKey: key };
    case 'OFFI':
      return { complex: p.offiComplex, rent: p.offiRent, trade: p.offiTrade, complexWhereKey: key };
    case 'VILLA':
      return { complex: p.villaComplex, rent: p.villaRent, trade: p.villaTrade, complexWhereKey: key };
    case 'SH':
      return { complex: p.shComplex, rent: p.shRent, trade: undefined, complexWhereKey: key };
  }
}

export interface RealtyIngestSummary {
  propertyType: PropertyType;
  sigunguCode: string;
  yyyymm: string;
  fetchedTrades: number;
  fetchedRents: number;
  insertedTrades: number;
  insertedRents: number;
  upsertedComplexes: number;
  durationMs: number;
}

function fingerprintKey(c: {
  sigunguCode: string;
  legalDong: string;
  name: string;
  builtYear: number | null;
}): string {
  return `${c.sigunguCode}|${c.legalDong}|${c.name}|${c.builtYear ?? 0}`;
}

async function upsertComplexes(
  cfg: TypeConfig,
  rows: Array<NormalizedTrade | NormalizedRent>,
): Promise<{ map: Map<string, number>; upsertedCount: number }> {
  const dedup = new Map<
    string,
    {
      sigunguCode: string;
      legalDong: string;
      name: string;
      builtYear: number | null;
      jibun: string | null;
      roadAddr: string | null;
    }
  >();

  for (const r of rows) {
    const key = fingerprintKey(r);
    if (!dedup.has(key)) {
      dedup.set(key, {
        sigunguCode: r.sigunguCode,
        legalDong: r.legalDong,
        name: r.name,
        builtYear: r.builtYear,
        jibun: r.jibun ?? null,
        roadAddr: 'roadAddr' in r ? (r.roadAddr ?? null) : null,
      });
    }
  }

  const map = new Map<string, number>();
  let count = 0;

  for (const [k, c] of dedup) {
    const whereUnique = {
      [cfg.complexWhereKey]: {
        sigunguCode: c.sigunguCode,
        legalDong: c.legalDong,
        name: c.name,
        builtYear: c.builtYear ?? 0,
      },
    };

    const existing = await cfg.complex.findUnique({
      where: whereUnique,
      select: { id: true },
    });

    let id: number;
    if (existing) {
      await cfg.complex.update({
        where: { id: existing.id },
        data: {
          name: c.name,
          legalDong: c.legalDong,
          jibun: c.jibun ?? undefined,
          roadAddr: c.roadAddr ?? undefined,
        },
      });
      id = existing.id;
    } else {
      const created = await cfg.complex.create({
        data: {
          name: c.name,
          sigunguCode: c.sigunguCode,
          legalDong: c.legalDong,
          jibun: c.jibun,
          roadAddr: c.roadAddr,
          builtYear: c.builtYear ?? 0,
        },
        select: { id: true },
      });
      id = created.id;
    }
    map.set(k, id);
    count += 1;
  }
  return { map, upsertedCount: count };
}

export async function ingestRealtySigunguMonth(
  type: PropertyType,
  sigunguCode: string,
  yyyymm: string,
): Promise<RealtyIngestSummary> {
  const t0 = Date.now();
  const cfg = configFor(type);

  // SH 는 매매 테이블이 없으므로 매매 호출 생략
  const [trades, rents] = await Promise.all([
    cfg.trade ? fetchTradesByType(type, sigunguCode, yyyymm) : Promise.resolve([]),
    fetchRentsByType(type, sigunguCode, yyyymm),
  ]);

  const { map: complexMap, upsertedCount } = await upsertComplexes(cfg, [
    ...trades,
    ...rents,
  ]);

  let insertedTrades = 0;
  if (cfg.trade && trades.length) {
    const tradeRows = trades
      .map((t) => {
        const cid = complexMap.get(fingerprintKey(t));
        if (!cid) return null;
        return {
          complexId: cid,
          dealDate: t.dealDate,
          priceManwon: t.priceManwon,
          areaM2: t.areaM2,
          floor: t.floor,
          builtYear: t.builtYear,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
    if (tradeRows.length) {
      insertedTrades = (
        await cfg.trade.createMany({ data: tradeRows, skipDuplicates: true })
      ).count;
    }
  }

  const rentRows = rents
    .map((r) => {
      const cid = complexMap.get(fingerprintKey(r));
      if (!cid) return null;
      return {
        complexId: cid,
        contractDate: r.contractDate,
        depositManwon: r.depositManwon,
        monthlyManwon: r.monthlyManwon,
        contractType: r.contractType,
        areaM2: r.areaM2,
        floor: r.floor,
        builtYear: r.builtYear,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  const insertedRents = rentRows.length
    ? (await cfg.rent.createMany({ data: rentRows, skipDuplicates: true })).count
    : 0;

  return {
    propertyType: type,
    sigunguCode,
    yyyymm,
    fetchedTrades: trades.length,
    fetchedRents: rents.length,
    insertedTrades,
    insertedRents,
    upsertedComplexes: upsertedCount,
    durationMs: Date.now() - t0,
  };
}
