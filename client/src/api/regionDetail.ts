/**
 * Depth 3 지역 상세 API 클라이언트 + mock fallback
 *
 *  ▷ GET /api/regions/:legalDongCode/complexes → AptComplex[]
 *  ▷ GET /api/lstm/:complexId                 → LstmAnalysis
 *  ▷ GET /api/commute/compare                 → CommuteCompareData
 *
 *  ▷ 폴백 정책:
 *    - 서버 응답 실패 / 빈 배열 → mock fallback (console.warn)
 *    - AbortError 는 그대로 re-throw (호출처 무시)
 */
import { apiFetch, ApiError } from './client';
import type { AptComplex, LstmAnalysis, ArimaAnalysis, CommuteCompareData, LhSummary } from '../types/region-detail';
import { getMockComplexesForRegion } from '../pages/RegionDetail/data/mockComplexes';
import { getMockLstm } from '../pages/RegionDetail/data/mockLstmResults';
import { getMockCommuteCompare } from '../pages/RegionDetail/data/mockCommuteCompare';
import { getMockLhSummary } from '../pages/RegionDetail/data/mockLhSummary';
import type { Workplace } from '../types/recommendation';

// ─── 단지 목록 ────────────────────────────────────────────────

export type ComplexesSource = 'api' | 'mock';

export interface ComplexesResult {
  complexes: AptComplex[];
  source: ComplexesSource;
}

export async function fetchComplexes(
  legalDongCode: string,
  signal?: AbortSignal,
): Promise<ComplexesResult> {
  try {
    const data = await apiFetch<AptComplex[]>(
      `/api/regions/${legalDongCode}/complexes`,
      { signal },
    );
    if (Array.isArray(data) && data.length > 0) {
      return { complexes: data, source: 'api' };
    }
    // 빈 배열 = 해당 행정동 단지 데이터 미적재 → mock 폴백
    throw new Error('empty response');
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    const reason = describeError(err);
    console.warn('[regionDetail] complexes API 실패 → mock 폴백:', reason);
    return {
      complexes: getMockComplexesForRegion(legalDongCode),
      source: 'mock',
    };
  }
}

// ─── LH 청년주택 시군구 집계 ──────────────────────────────────

export type LhSummarySource = 'api' | 'mock';

export interface LhSummaryResult {
  summary: LhSummary;
  source: LhSummarySource;
}

/**
 * 시군구 LH 청년주택 집계 조회
 *  - 응답이 totalRows=0 이면 'api' source 로 그대로 반환 (배너 자동 숨김)
 *  - API 자체 실패(네트워크/500) 시 mock 폴백
 */
export async function fetchLhSummary(
  legalDongCode: string,
  signal?: AbortSignal,
): Promise<LhSummaryResult> {
  try {
    const data = await apiFetch<LhSummary>(
      `/api/regions/${legalDongCode}/lh-summary`,
      { signal },
    );
    if (!data || typeof data.totalRows !== 'number') throw new Error('invalid shape');
    return { summary: data, source: 'api' };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    const reason = describeError(err);
    console.warn('[regionDetail] lh-summary API 실패 → mock 폴백:', reason);
    return {
      summary: getMockLhSummary(legalDongCode),
      source: 'mock',
    };
  }
}

// ─── LSTM 분석 ────────────────────────────────────────────────

export type LstmSource = 'api' | 'mock';

export interface LstmResult {
  analysis: LstmAnalysis | null;
  source: LstmSource;
}

export async function fetchLstm(
  complexId: string,
  signal?: AbortSignal,
): Promise<LstmResult> {
  try {
    const data = await apiFetch<LstmAnalysis>(
      `/api/lstm/${complexId}`,
      { signal },
    );
    if (!data || !Array.isArray(data.series)) throw new Error('invalid shape');
    return { analysis: data, source: 'api' };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    const reason = describeError(err);
    console.warn('[regionDetail] lstm API 실패 → mock 폴백:', reason);
    return {
      analysis: getMockLstm(complexId),
      source: 'mock',
    };
  }
}

// ─── ARIMA 분석 (메인 모델) ───────────────────────────────────

export type ArimaSource = 'api' | 'mock';

export interface ArimaResult {
  analysis: ArimaAnalysis | null;
  source: ArimaSource;
}

/**
 * ARIMA(2,1,2) 가격 안정성 분석
 *  - GET /api/arima/:complexId
 *  - 실패 시 LSTM mock 데이터를 ARIMA 포맷으로 폴백 (disclaimer 표시)
 */
export async function fetchArima(
  complexId: string,
  signal?: AbortSignal,
): Promise<ArimaResult> {
  try {
    const data = await apiFetch<ArimaAnalysis>(
      `/api/arima/${complexId}`,
      { signal },
    );
    if (!data || !Array.isArray(data.series)) throw new Error('invalid shape');
    return { analysis: data, source: 'api' };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    const reason = describeError(err);
    console.warn('[regionDetail] arima API 실패 → lstm mock 폴백:', reason);
    const lstmMock = getMockLstm(complexId);
    if (!lstmMock) return { analysis: null, source: 'mock' };
    // LSTM mock을 ARIMA 포맷으로 변환 (폴백)
    const arimaMock: ArimaAnalysis = {
      ...lstmMock,
      modelType: 'arima',
      disclaimer: 'ARIMA(2,1,2) 통계 모델 기반. 외생 충격(금리·정책) 한계 존재. (mock 데이터)',
    };
    return { analysis: arimaMock, source: 'mock' };
  }
}

// ─── 통근 비교 ───────────────────────────────────────────────

export type CommuteSource = 'api' | 'estimate' | 'mock';

export interface CommuteCompareResult {
  data: CommuteCompareData;
  source: CommuteSource;
}

/**
 * 단지 ↔ 직장 통근 비교 조회
 *  - 서버: t_commute_matrix 캐시 → ODsay → Haversine 추정
 *  - 클라이언트 폴백: getMockCommuteCompare (Haversine 추정 동일)
 */
export async function fetchCommuteCompare(
  complexId: string,
  complex: { lat: number; lng: number },
  workplace: Workplace,
  signal?: AbortSignal,
): Promise<CommuteCompareResult | null> {
  if (!workplace) return null;

  try {
    const params = new URLSearchParams({
      complexId,
      wpLat: String(workplace.lat),
      wpLng: String(workplace.lng),
    });
    const data = await apiFetch<CommuteCompareData & { source?: string }>(
      `/api/commute/compare?${params}`,
      { signal },
    );
    if (
      !data ||
      typeof data.transitMinutes !== 'number' ||
      typeof data.carMinutes !== 'number'
    ) {
      throw new Error('invalid shape');
    }
    const apiSource = data.source;
    const source: CommuteSource =
      apiSource === 'cache' || apiSource === 'odsay' ? 'api' : 'estimate';
    return { data, source };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    const reason = describeError(err);
    console.warn('[regionDetail] commute/compare API 실패 → mock 폴백:', reason);
    const mockData = getMockCommuteCompare(complexId, workplace);
    // getMockCommuteCompare 는 complexId 가 mock 목록에 없으면 null 반환
    // → 없는 경우 좌표 직접 계산으로 폴백
    if (!mockData) {
      const fallback = haversineCommuteFallback(complex, workplace);
      return { data: fallback, source: 'mock' };
    }
    return { data: mockData, source: 'mock' };
  }
}

/** 서울 출퇴근 자차 소요시간 — 구간별 비선형 추정 (서버 odsay.ts 와 동기화) */
function seoulRushHourCarMinutes(km: number): number {
  if (km < 1)  return 20;
  if (km < 5)  return Math.round(km * 8) + 10;
  if (km < 15) return Math.round(km * 6) + 15;
  return       Math.round(km * 5) + 20;
}

/** mock complexId 매핑 실패 시 직접 Haversine 추정 */
function haversineCommuteFallback(
  complex: { lat: number; lng: number },
  workplace: Workplace,
): CommuteCompareData {
  const EARTH_KM = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(workplace.lat - complex.lat);
  const dLng = toRad(workplace.lng - complex.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(complex.lat)) * Math.cos(toRad(workplace.lat)) * Math.sin(dLng / 2) ** 2;
  const km = 2 * EARTH_KM * Math.asin(Math.sqrt(s));

  const transitBase = (km / 25) * 60;
  const transfers = Math.min(3, Math.max(0, Math.floor(km / 3) - 1));
  const transitMinutes = Math.round(transitBase + transfers * 5 + 8);
  const transitCost = Math.round(1500 + Math.max(0, km - 5) * 100);

  // 자차: 서울 출퇴근 러시아워 비선형 추정 (구간별 분/km 계수)
  const carMinutes = seoulRushHourCarMinutes(km);
  // 비용: 연료(연비 12km/L × 1,700원/L) + 주차 기본 4,000원 + 거리 소모비
  const kmRoad = km * 1.6;
  const carCost = Math.round(4000 + (kmRoad / 12) * 1700 + kmRoad * 50);

  return { transitMinutes, transfers, transitCost, carMinutes, carCost };
}

// ─── 헬퍼 ─────────────────────────────────────────────────────

function describeError(err: unknown): string {
  if (err instanceof ApiError) return `HTTP ${err.status} ${err.message}`;
  if (err instanceof TypeError) return `네트워크 오류 (${err.message})`;
  if (err instanceof Error) return err.message;
  return String(err);
}
