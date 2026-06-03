/**
 * 서비스 메타 도메인 — 데이터 출처/적재 현황 등 공개 정보
 *  - public (인증 불필요)
 *  - GET /api/meta/data-sources  : 공공데이터 융합 현황 (공공기관 6곳 + 민간 API ODsay·카카오)
 *
 *  Phase 2-B (2026-05-27): 신설 — "공공데이터 4기관 융합" 노출.
 *  2026-06-04 갱신: 수도권 MVP 반영 — 서울→수도권(서울·인천·경기), 아파트→APT/OFFI/VILLA/SH 4종,
 *    통근(ODsay·카카오)·교통품질(TAGO·국토부 정류소)·생활편의(카카오 POI) 융합 데이터 추가.
 */
import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../../services/db';

export const metaRouter = Router();

/* ─── 응답 타입 ──────────────────────────────────────── */

export type DataSourceId =
  | 'molit-rtms'       // 국토교통부 실거래가 공개시스템 (APT/OFFI/VILLA/SH)
  | 'reb-rone'         // 한국부동산원 R-ONE 통계
  | 'lh-youth'         // LH 청년임대주택
  | 'safety-income'    // 통계청+경찰청+지자체 (안전·소득 합성)
  | 'commute-transit'  // ODsay·카카오·TAGO·국토부 정류소 (통근·교통품질)
  | 'life-poi';        // 카카오 로컬 (생활편의 POI)

export interface DataSourceMeta {
  id: DataSourceId;
  /** 주관/제공 기관 한글명 */
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
  /** 가점/특성 라벨 */
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

/** 테이블명 화이트리스트 기반 raw COUNT(*) — 모델명 의존 없이 안전. 실패 시 0. */
function tableCount(table: string): Promise<number> {
  return safeCount(
    () =>
      prisma
        .$queryRaw<{ cnt: bigint }[]>(Prisma.sql`SELECT COUNT(*) AS cnt FROM ${Prisma.raw(table)}`)
        .then((rows) => Number(rows[0]?.cnt ?? 0)),
    0,
  );
}

/** raw MAX(컬럼) 날짜 — 실패/없음 시 null. */
function tableMaxDate(table: string, col: string): Promise<Date | null> {
  return safeCount(
    () =>
      prisma
        .$queryRaw<{ m: Date | null }[]>(Prisma.sql`SELECT MAX(${Prisma.raw(col)}) AS m FROM ${Prisma.raw(table)}`)
        .then((rows) => (rows[0]?.m ? new Date(rows[0].m) : null)),
    null as Date | null,
  );
}

/* ─── GET /api/meta/data-sources ────────────────────── */

metaRouter.get('/data-sources', async (_req, res) => {
  // 병렬 카운트 — 테이블 미생성/미적재 시 0 fallback
  const [
    aptTrade, offiTrade, villaTrade,
    aptRent, offiRent, villaRent, shRent,
    rebCount, lhCount, safetyCount, incomeCount,
    transitCount, poiCount, commuteCount,
  ] = await Promise.all([
    tableCount('t_apt_trade'), tableCount('t_offi_trade'), tableCount('t_villa_trade'),
    tableCount('t_apt_rent'), tableCount('t_offi_rent'), tableCount('t_villa_rent'), tableCount('t_sh_rent'),
    safeCount(() => prisma.rebPriceIndex.count(), 0),
    safeCount(() => prisma.lhYouthHousing.count(), 0),
    safeCount(() => prisma.safetyIndex.count(), 0),
    safeCount(() => prisma.incomeQuintile.count(), 0),
    tableCount('t_transit_route_summary'),
    tableCount('t_poi_summary'),
    tableCount('t_commute_matrix'),
  ]);

  const tradeTotal = aptTrade + offiTrade + villaTrade;
  const rentTotal = aptRent + offiRent + villaRent + shRent;
  const rtmsTotal = tradeTotal + rentTotal;

  // 최신 갱신일
  const [latestTrade, latestReb, latestLh, latestSafety, latestTransit, latestPoi] = await Promise.all([
    safeCount(() => prisma.aptTrade.findFirst({ orderBy: { dealDate: 'desc' }, select: { dealDate: true } }), null as { dealDate: Date } | null),
    safeCount(() => prisma.rebPriceIndex.findFirst({ orderBy: { ym: 'desc' }, select: { ym: true, createdAt: true } }), null as { ym: string; createdAt: Date } | null),
    safeCount(() => prisma.lhYouthHousing.findFirst({ orderBy: { updatedAt: 'desc' }, select: { updatedAt: true } }), null as { updatedAt: Date } | null),
    safeCount(() => prisma.safetyIndex.findFirst({ orderBy: { updatedAt: 'desc' }, select: { updatedAt: true } }), null as { updatedAt: Date } | null),
    tableMaxDate('t_transit_route_summary', 'computed_at'),
    tableMaxDate('t_poi_summary', 'computed_at'),
  ]);

  const sources: DataSourceMeta[] = [
    {
      id: 'molit-rtms',
      agency: '국토교통부',
      agencyEn: 'MOLIT',
      name: '실거래가 공개시스템 (RTMS)',
      description:
        '수도권(서울·인천·경기) 아파트·오피스텔·연립다세대·단독다가구 매매·전월세 실거래. 동 단위 시세 분포 + 아파트 단지 ARIMA 시계열 학습의 원천. (단지 좌표는 카카오 지오코딩으로 백필.)',
      rowCount: rtmsTotal,
      rowLabel: `거래 ${rtmsTotal.toLocaleString()}건 (매매 ${tradeTotal.toLocaleString()} / 전월세 ${rentTotal.toLocaleString()})`,
      lastUpdated: latestTrade ? formatYmd(latestTrade.dealDate) : null,
      apiUrl: 'https://rt.molit.go.kr/',
      tables: ['t_apt_trade', 't_apt_rent', 't_offi_trade', 't_offi_rent', 't_villa_trade', 't_villa_rent', 't_sh_rent'],
      badge: '주관기관',
    },
    {
      id: 'reb-rone',
      agency: '한국부동산원',
      agencyEn: 'REB',
      name: 'R-ONE 부동산 통계정보 시스템',
      description:
        '시군구별 월간 공동주택 실거래가지수. 시장 전체 추세를 ARIMA(메인)·LSTM 예측 정규화에 사용.',
      rowCount: rebCount,
      rowLabel: `지수 row ${rebCount.toLocaleString()}건 (시군구 × 월)`,
      lastUpdated: (() => {
        // ym 은 "YYYYMM" 또는 "YYYY-MM" 둘 다 가능 → 숫자만 추출 후 YYYY-MM-01.
        const digits = latestReb?.ym?.replace(/[^0-9]/g, '') ?? '';
        return digits.length >= 6
          ? `${digits.slice(0, 4)}-${digits.slice(4, 6)}-01`
          : formatYmd(latestReb?.createdAt);
      })(),
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
        '수도권 행복주택·청년매입임대·전세임대 공급 현황. 카카오 지오코딩으로 행정동(10자리) 정밀도 확보.',
      rowCount: lhCount,
      rowLabel: `단지 ${lhCount.toLocaleString()}건`,
      lastUpdated: formatYmd(latestLh?.updatedAt),
      apiUrl: 'https://www.data.go.kr/data/15059475/openapi.do',
      tables: ['t_lh_youth_housing'],
      badge: '청년 정책',
    },
    {
      id: 'safety-income',
      agency: '통계청 · 경찰청 · 지자체',
      agencyEn: 'KOSTAT+',
      name: '5분위 소득 · 안전 합성 지표',
      description:
        '가계금융복지조사 5분위 가처분소득 + 수도권 자치구별 5대범죄·가로등·CCTV 밀도 합성. RIR(주거비 부담률) · safety 축 산출.',
      rowCount: incomeCount + safetyCount,
      rowLabel: `안전 ${safetyCount.toLocaleString()}동 / 소득 ${incomeCount}분위`,
      lastUpdated: formatYmd(latestSafety?.updatedAt),
      apiUrl: 'https://kostat.go.kr/',
      tables: ['t_safety_index', 't_income_quintile'],
      badge: '사회 가치',
    },
    {
      id: 'commute-transit',
      agency: 'ODsay · 카카오 · 국가대중교통(TAGO) · 국토교통부',
      agencyEn: 'ODsay·TAGO',
      name: '통근 경로 · 대중교통 품질',
      description:
        '직장까지 통근을 ODsay(대중교통 환승·시간)·카카오(자차 실경로)로 실측. 교통 품질은 경기·인천 TAGO 정류소/노선, 서울은 국토부 「전국 버스정류장 위치정보」 정적 좌표 밀도로 산출(지역별 provider 분기).',
      rowCount: commuteCount + transitCount,
      rowLabel: `통근 캐시 ${commuteCount.toLocaleString()}건 / 정류소 요약 ${transitCount.toLocaleString()}동`,
      lastUpdated: formatYmd(latestTransit),
      apiUrl: 'https://www.data.go.kr/data/15067528/fileData.do',
      tables: ['t_commute_matrix', 't_transit_route_summary'],
      badge: '통근 정밀',
    },
    {
      id: 'life-poi',
      agency: '카카오',
      agencyEn: 'Kakao',
      name: '로컬 생활편의 (POI)',
      description:
        '동 centroid 반경 500m 카카오 로컬 카테고리(지하철·마트·편의점·카페·음식점·병원·약국·은행) 집계로 1인가구 생활 점수 산출.',
      rowCount: poiCount,
      rowLabel: `생활 요약 ${poiCount.toLocaleString()}동`,
      lastUpdated: formatYmd(latestPoi),
      apiUrl: 'https://developers.kakao.com/docs/latest/ko/local/dev-guide',
      tables: ['t_poi_summary'],
      badge: '생활편의',
    },
  ];

  const dto: DataSourcesDto = {
    asOf: formatKstDateTime(new Date()),
    totalRows: sources.reduce((s, src) => s + src.rowCount, 0),
    sources,
  };
  res.json(dto);
});
