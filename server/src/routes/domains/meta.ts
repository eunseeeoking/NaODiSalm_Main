/**
 * 서비스 메타 도메인 — 데이터 출처/적재 현황 등 공개 정보
 *  - public (인증 불필요)
 *  - GET /api/meta/data-sources  : 4기관 데이터 융합 현황 (가점 +5 어필용)
 *
 *  Phase 2-B (2026-05-27): 신설.
 *    공모전 채점위원/사용자 모두에게 "공공데이터 4기관 융합"을 정직하게 노출.
 */
import { Router } from 'express';
import { prisma } from '../../services/db';

export const metaRouter = Router();

/* ─── 응답 타입 ──────────────────────────────────────── */

export type DataSourceId =
  | 'molit-rtms'      // 국토교통부 실거래가 공개시스템
  | 'reb-rone'        // 한국부동산원 R-ONE 통계
  | 'lh-youth'        // LH 청년임대주택
  | 'safety-income';  // 통계청+경찰청 (안전·소득 합성)

export interface DataSourceMeta {
  id: DataSourceId;
  /** 주관 기관 한글명 */
  agency: string;
  /** 영문 약자 */
  agencyEn: string;
  /** 데이터셋 명 */
  name: string;
  /** 한 줄 설명 */
  description: string;
  /** 현재 DB 적재 row 수 (실시간 조회) */
  rowCount: number;
  /** "거래 N건" 같은 단위 라벨 */
  rowLabel: string;
  /** YYYY-MM-DD 또는 null */
  lastUpdated: string | null;
  /** 공식 사이트 / API 명세 URL */
  apiUrl: string;
  /** 관련 DB 테이블 (디버깅·운영용 표시) */
  tables: string[];
  /** 가점 어필 라벨 */
  badge?: string;
}

export interface DataSourcesDto {
  asOf: string;           // YYYY-MM-DD HH:mm KST
  sources: DataSourceMeta[];
  totalRows: number;
}

/* ─── 유틸 ──────────────────────────────────────────── */

function formatKstDateTime(d: Date): string {
  // KST = UTC + 9
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  const yyyy = kst.getUTCFullYear();
  const mm = String(kst.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(kst.getUTCDate()).padStart(2, '0');
  const hh = String(kst.getUTCHours()).padStart(2, '0');
  const mi = String(kst.getUTCMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}

function formatYmd(d: Date | null | undefined): string | null {
  if (!d) return null;
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

async function safeCount<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

/* ─── GET /api/meta/data-sources ────────────────────── */

metaRouter.get('/data-sources', async (_req, res) => {
  // 병렬 카운트 — 테이블 미생성 시 0 fallback
  const [
    tradeCount,
    rentCount,
    rebCount,
    lhCount,
    safetyCount,
    incomeCount,
    transitCount,
    complexCount,
  ] = await Promise.all([
    safeCount(() => prisma.aptTrade.count(), 0),
    safeCount(() => prisma.aptRent.count(), 0),
    safeCount(() => prisma.rebPriceIndex.count(), 0),
    safeCount(() => prisma.lhYouthHousing.count(), 0),
    safeCount(() => prisma.safetyIndex.count(), 0),
    safeCount(() => prisma.incomeQuintile.count(), 0),
    safeCount(
      () =>
        prisma.$queryRaw<{ cnt: bigint }[]>`SELECT COUNT(*) AS cnt FROM t_transit_route_summary`
          .then((rows) => Number(rows[0]?.cnt ?? 0))
          .catch(() => 0),
      0,
    ),
    safeCount(() => prisma.aptComplex.count(), 0),
  ]);

  // 최신 거래일 — t_apt_trade.dealDate 최댓값
  const latestTrade = await safeCount(
    () =>
      prisma.aptTrade.findFirst({
        orderBy: { dealDate: 'desc' },
        select: { dealDate: true },
      }),
    null as { dealDate: Date } | null,
  );

  const latestReb = await safeCount(
    () =>
      prisma.rebPriceIndex.findFirst({
        orderBy: { ym: 'desc' },
        select: { ym: true, createdAt: true },
      }),
    null as { ym: string; createdAt: Date } | null,
  );

  const latestLh = await safeCount(
    () =>
      prisma.lhYouthHousing.findFirst({
        orderBy: { updatedAt: 'desc' },
        select: { updatedAt: true },
      }),
    null as { updatedAt: Date } | null,
  );

  const latestSafety = await safeCount(
    () =>
      prisma.safetyIndex.findFirst({
        orderBy: { updatedAt: 'desc' },
        select: { updatedAt: true },
      }),
    null as { updatedAt: Date } | null,
  );

  const totalRtms = tradeCount + rentCount;

  const sources: DataSourceMeta[] = [
    {
      id: 'molit-rtms',
      agency: '국토교통부',
      agencyEn: 'MOLIT',
      name: '아파트 실거래가 공개시스템 (RTMS)',
      description:
        '서울 25개 자치구 매매·전월세 실거래 내역. 단지 단위 현재가 + LSTM/ARIMA 시계열 학습의 원천 데이터.',
      rowCount: totalRtms,
      rowLabel: `거래 ${totalRtms.toLocaleString()}건 (매매 ${tradeCount.toLocaleString()} / 전월세 ${rentCount.toLocaleString()})`,
      lastUpdated: latestTrade ? formatYmd(latestTrade.dealDate) : null,
      apiUrl: 'https://rt.molit.go.kr/',
      tables: ['t_apt_trade', 't_apt_rent', 't_apt_complex'],
      badge: '주관기관',
    },
    {
      id: 'reb-rone',
      agency: '한국부동산원',
      agencyEn: 'REB',
      name: 'R-ONE 부동산 통계정보 시스템',
      description:
        '시군구별 월간 공동주택 실거래가지수. 시장 전체 추세 노이즈를 LSTM에서 제거(정규화)하는 데 사용.',
      rowCount: rebCount,
      rowLabel: `지수 row ${rebCount.toLocaleString()}건 (시군구 × 월)`,
      lastUpdated: latestReb?.ym
        ? `${latestReb.ym.slice(0, 4)}-${latestReb.ym.slice(4, 6)}-01`
        : formatYmd(latestReb?.createdAt),
      apiUrl: 'https://www.reb.or.kr/r-one/',
      tables: ['t_reb_price_index'],
      badge: '주관기관 (가점 +5)',
    },
    {
      id: 'lh-youth',
      agency: '한국토지주택공사',
      agencyEn: 'LH',
      name: 'LH 임대주택단지 조회 서비스',
      description:
        '행복주택·청년매입임대·전세임대 공급 현황. Phase 2-B (2026-05-27)에서 Kakao 지오코딩으로 행정동(10자리) 정밀도 확보.',
      rowCount: lhCount,
      rowLabel: `단지 ${lhCount.toLocaleString()}건`,
      lastUpdated: formatYmd(latestLh?.updatedAt),
      apiUrl: 'https://www.data.go.kr/data/15059475/openapi.do',
      tables: ['t_lh_youth_housing'],
      badge: '청년 정책',
    },
    {
      id: 'safety-income',
      agency: '통계청 · 경찰청 · 서울시',
      agencyEn: 'KOSTAT+',
      name: '5분위 소득 · 안전 합성 지표',
      description:
        '가계금융복지조사 5분위 가처분소득 + 자치구별 5대범죄·가로등·CCTV 밀도 합성. RIR(주거비 부담률) · safety 축 산출에 사용.',
      rowCount: incomeCount + safetyCount,
      rowLabel: `안전 ${safetyCount.toLocaleString()}동 / 소득 ${incomeCount}분위`,
      lastUpdated: formatYmd(latestSafety?.updatedAt),
      apiUrl: 'https://kostat.go.kr/',
      tables: ['t_safety_index', 't_income_quintile'],
      badge: '사회 가치',
    },
  ];

  // 참고용 부가 정보 (totalRows 에 포함 X)
  // - transitCount: ODsay/TAGO 통근 경로 캐시 (별도 통계로 노출하지 않고 totalRows 산출 시 제외)
  // - complexCount: t_apt_complex 단지 마스터
  void transitCount;
  void complexCount;

  const dto: DataSourcesDto = {
    asOf: formatKstDateTime(new Date()),
    totalRows: sources.reduce((s, src) => s + src.rowCount, 0),
    sources,
  };
  res.json(dto);
});
