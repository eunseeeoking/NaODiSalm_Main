import { prisma } from '../db';
import {
  fetchAptTrades,
  fetchAptRents,
  type NormalizedTrade,
  type NormalizedRent,
} from '../external/molit';
import { geocodeFlexible } from '../external/geocoder';
import { SEOUL_LAWD_CODES } from '../../data/seoulLawdCodes';

const SIGUNGU_BY_CODE = new Map<string, { sido: string; sigungu: string }>(
  SEOUL_LAWD_CODES.map((s) => [s.code, { sido: '서울특별시', sigungu: s.name }]),
);

function sigunguPrefix(code: string): string {
  const hit = SIGUNGU_BY_CODE.get(code);
  return hit ? `${hit.sido} ${hit.sigungu}` : '';
}

/**
 * 국토부 실거래가 ingest 오케스트레이터.
 *
 * 단지 매칭 우선순위:
 *   1. aptSeq (MOLIT 단지 고유 ID) — 가장 신뢰할 수 있음
 *   2. (sigunguCode, legalDong, name, builtYear) — aptSeq 없을 때 fallback
 */

export interface IngestSummary {
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
  aptSeq: string | null;
  sigunguCode: string;
  legalDong: string;
  name: string;
  builtYear: number | null;
}): string {
  return c.aptSeq
    ? `seq|${c.aptSeq}`
    : `fp|${c.sigunguCode}|${c.legalDong}|${c.name}|${c.builtYear ?? 0}`;
}

async function upsertComplexes(
  rows: Array<NormalizedTrade | NormalizedRent>,
): Promise<{ map: Map<string, number>; upsertedCount: number }> {
  // dedup
  const dedup = new Map<
    string,
    {
      aptSeq: string | null;
      sigunguCode: string;
      legalDong: string;
      name: string;
      builtYear: number | null;
      jibun: string | null;
      roadAddr: string | null;
    }
  >();

  for (const r of rows) {
    const key = fingerprintKey({
      aptSeq: r.aptSeq,
      sigunguCode: r.sigunguCode,
      legalDong: r.legalDong,
      name: r.name,
      builtYear: r.builtYear,
    });
    if (!dedup.has(key)) {
      dedup.set(key, {
        aptSeq: r.aptSeq,
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
    // 2단계 lookup: aptSeq → 없으면 fingerprint → 없으면 create
    let existing = c.aptSeq
      ? await prisma.aptComplex.findUnique({
          where: { aptSeq: c.aptSeq },
          select: { id: true, aptSeq: true },
        })
      : null;

    if (!existing) {
      existing = await prisma.aptComplex.findUnique({
        where: {
          sigunguCode_legalDong_name_builtYear: {
            sigunguCode: c.sigunguCode,
            legalDong: c.legalDong,
            name: c.name,
            builtYear: c.builtYear ?? 0,
          },
        },
        select: { id: true, aptSeq: true },
      });
    }

    let id: number;
    if (existing) {
      // 갱신 — 기존에 aptSeq 가 NULL 이었으면 이번 기회에 채움
      await prisma.aptComplex.update({
        where: { id: existing.id },
        data: {
          aptSeq: c.aptSeq ?? existing.aptSeq ?? undefined,
          name: c.name,
          legalDong: c.legalDong,
          jibun: c.jibun ?? undefined,
          roadAddr: c.roadAddr ?? undefined,
        },
      });
      id = existing.id;
    } else {
      const created = await prisma.aptComplex.create({
        data: {
          aptSeq: c.aptSeq,
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

export async function ingestSigunguMonth(
  sigunguCode: string,
  yyyymm: string,
): Promise<IngestSummary> {
  const t0 = Date.now();

  const [trades, rents] = await Promise.all([
    fetchAptTrades(sigunguCode, yyyymm),
    fetchAptRents(sigunguCode, yyyymm),
  ]);

  const { map: complexMap, upsertedCount } = await upsertComplexes([
    ...trades,
    ...rents,
  ]);

  const tradeRows = trades
    .map((t) => {
      const cid = complexMap.get(
        fingerprintKey({
          aptSeq: t.aptSeq,
          sigunguCode: t.sigunguCode,
          legalDong: t.legalDong,
          name: t.name,
          builtYear: t.builtYear,
        }),
      );
      if (!cid) return null;
      return {
        complexId: cid,
        dealDate: t.dealDate,
        priceManwon: t.priceManwon,
        areaM2: t.areaM2,
        floor: t.floor,
        builtYear: t.builtYear,
        rawPayload: t.raw as object,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  const insertedTrades = tradeRows.length
    ? (
        await prisma.aptTrade.createMany({
          data: tradeRows,
          skipDuplicates: true,
        })
      ).count
    : 0;

  const rentRows = rents
    .map((r) => {
      const cid = complexMap.get(
        fingerprintKey({
          aptSeq: r.aptSeq,
          sigunguCode: r.sigunguCode,
          legalDong: r.legalDong,
          name: r.name,
          builtYear: r.builtYear,
        }),
      );
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
        rawPayload: r.raw as object,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  const insertedRents = rentRows.length
    ? (
        await prisma.aptRent.createMany({
          data: rentRows,
          skipDuplicates: true,
        })
      ).count
    : 0;

  return {
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

export async function geocodeMissingComplexes(
  maxCount = 50,
): Promise<{ tried: number; updated: number }> {
  const targets = await prisma.aptComplex.findMany({
    where: { lat: null },
    take: maxCount,
    select: {
      id: true,
      name: true,
      legalDong: true,
      jibun: true,
      roadAddr: true,
      sigunguCode: true,
    },
  });

  let updated = 0;

  for (const t of targets) {
    const prefix = sigunguPrefix(t.sigunguCode); // "서울특별시 강남구"
    const roadAddrFull = t.roadAddr
      ? prefix
        ? `${prefix} ${t.roadAddr}`
        : t.roadAddr
      : null;
    const jibunAddr = t.jibun
      ? prefix
        ? `${prefix} ${t.legalDong} ${t.jibun}`
        : `${t.legalDong} ${t.jibun}`
      : null;
    const keyword = prefix
      ? `${prefix} ${t.legalDong} ${t.name}`
      : `${t.legalDong} ${t.name}`;

    const r = await geocodeFlexible({
      roadAddr: roadAddrFull,
      jibunAddr,
      keyword,
    });
    if (r) {
      await prisma.aptComplex.update({
        where: { id: t.id },
        data: { lat: r.lat, lng: r.lng },
      });
      updated += 1;
    }
    await new Promise((res) => setTimeout(res, 200));
  }

  return { tried: targets.length, updated };
}
