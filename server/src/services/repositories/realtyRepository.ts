import { prisma } from '../db';

/**
 * 부동산 단지/거래/전월세 조회.
 *  - 마커 표시용 요약 목록 + 단지 상세
 *  - 좌표가 없는 단지는 자동 제외
 */

export interface ComplexMarker {
  id: number;
  aptSeq: string | null;
  name: string;
  sigunguCode: string;
  legalDong: string;
  builtYear: number | null;
  lat: number;
  lng: number;
  lastTradeDate: Date | null;
  lastTradePriceManwon: number | null;
  tradeCount12m: number;
  rentCount12m: number;
}

/** 마커 표시용 요약 목록 (시군구 단위 또는 전체) */
export async function findComplexes(opts: {
  sigunguCode?: string;
  limit?: number;
}): Promise<ComplexMarker[]> {
  const limit = Math.min(opts.limit ?? 2000, 5000);

  // raw SQL — 단지별 LEFT JOIN aggregate 가 가장 효율적
  const rows = await prisma.$queryRawUnsafe<
    Array<{
      id: number;
      apt_seq: string | null;
      name: string;
      sigungu_code: string;
      legal_dong: string;
      built_year: number | null;
      lat: number;
      lng: number;
      last_trade_date: Date | null;
      last_trade_price: bigint | number | null;
      trade_count_12m: bigint | number;
      rent_count_12m: bigint | number;
    }>
  >(
    `
    SELECT
      c.id,
      c.apt_seq,
      c.name,
      c.sigungu_code,
      c.legal_dong,
      c.built_year,
      c.lat,
      c.lng,
      lt.last_trade_date,
      lt.last_trade_price,
      COALESCE(tc.cnt, 0) AS trade_count_12m,
      COALESCE(rc.cnt, 0) AS rent_count_12m
    FROM t_apt_complex c
    LEFT JOIN (
      SELECT complex_id,
             MAX(deal_date) AS last_trade_date,
             SUBSTRING_INDEX(GROUP_CONCAT(price_manwon ORDER BY deal_date DESC), ',', 1) AS last_trade_price
      FROM t_apt_trade
      GROUP BY complex_id
    ) lt ON lt.complex_id = c.id
    LEFT JOIN (
      SELECT complex_id, COUNT(*) AS cnt
      FROM t_apt_trade
      WHERE deal_date >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)
      GROUP BY complex_id
    ) tc ON tc.complex_id = c.id
    LEFT JOIN (
      SELECT complex_id, COUNT(*) AS cnt
      FROM t_apt_rent
      WHERE contract_date >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)
      GROUP BY complex_id
    ) rc ON rc.complex_id = c.id
    WHERE c.lat IS NOT NULL
      ${opts.sigunguCode ? 'AND c.sigungu_code = ?' : ''}
    ORDER BY c.id
    LIMIT ?
    `,
    ...(opts.sigunguCode ? [opts.sigunguCode, limit] : [limit]),
  );

  return rows.map((r) => ({
    id: r.id,
    aptSeq: r.apt_seq,
    name: r.name,
    sigunguCode: r.sigungu_code,
    legalDong: r.legal_dong,
    builtYear: r.built_year,
    lat: Number(r.lat),
    lng: Number(r.lng),
    lastTradeDate: r.last_trade_date,
    lastTradePriceManwon:
      r.last_trade_price === null ? null : Number(r.last_trade_price),
    tradeCount12m: Number(r.trade_count_12m),
    rentCount12m: Number(r.rent_count_12m),
  }));
}

export interface ComplexDetail {
  complex: {
    id: number;
    aptSeq: string | null;
    name: string;
    sigunguCode: string;
    legalDong: string;
    jibun: string | null;
    roadAddr: string | null;
    builtYear: number | null;
    lat: number | null;
    lng: number | null;
  };
  recentTrades: Array<{
    dealDate: Date;
    priceManwon: number;
    areaM2: number;
    floor: number | null;
    builtYear: number | null;
  }>;
  recentRents: Array<{
    contractDate: Date;
    depositManwon: number;
    monthlyManwon: number;
    contractType: 'JEONSE' | 'WOLSE';
    areaM2: number;
    floor: number | null;
  }>;
}

export async function findComplexDetail(id: number): Promise<ComplexDetail | null> {
  const complex = await prisma.aptComplex.findUnique({
    where: { id },
    select: {
      id: true,
      aptSeq: true,
      name: true,
      sigunguCode: true,
      legalDong: true,
      jibun: true,
      roadAddr: true,
      builtYear: true,
      lat: true,
      lng: true,
    },
  });
  if (!complex) return null;

  const [recentTrades, recentRents] = await Promise.all([
    prisma.aptTrade.findMany({
      where: { complexId: id },
      orderBy: { dealDate: 'desc' },
      take: 20,
      select: {
        dealDate: true,
        priceManwon: true,
        areaM2: true,
        floor: true,
        builtYear: true,
      },
    }),
    prisma.aptRent.findMany({
      where: { complexId: id },
      orderBy: { contractDate: 'desc' },
      take: 20,
      select: {
        contractDate: true,
        depositManwon: true,
        monthlyManwon: true,
        contractType: true,
        areaM2: true,
        floor: true,
      },
    }),
  ]);

  return { complex, recentTrades, recentRents };
}
