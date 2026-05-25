/**
 * Depth 3 · 지역 상세 페이지
 *  - 경로: /region/:legalDongCode
 *
 *  레이아웃 (토스 한국형 톤)
 *  ┌──────────────────────────────────────────────────┐
 *  │  RegionDetailHeader  (지역명 + 점수 + 뒤로가기)     │
 *  ├──────────────────┬───────────────────────────────┤
 *  │                  │                                │
 *  │  RegionMiniMap   │  ComplexCardList               │
 *  │  (해당 행정동 +    │  (단지 카드 N개)                 │
 *  │  단지 핀 +         │   → 카드 클릭 시                  │
 *  │  직장 마커)         │      PriceStabilityAnalysis 모달  │
 *  │                  │                                │
 *  └──────────────────┴───────────────────────────────┘
 *
 *  Sprint C-2 (2026-05-23):
 *    - 단지 목록: fetchComplexes() → GET /api/regions/:code/complexes (mock fallback)
 *    - LSTM:      fetchLstm()      → GET /api/lstm/:complexId          (mock fallback)
 *    - region 메타: store.recommendations 우선 → mock fallback
 */
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useRecommendationStore } from '../../stores/useRecommendationStore';
import { MOCK_REGIONS } from '../Recommendation/data/mockRegions';
import { fetchComplexes, fetchLstm, fetchArima, fetchCommuteCompare } from '../../api/regionDetail';
import { RegionDetailHeader } from './components/RegionDetailHeader';
import { RegionMiniMap } from './components/RegionMiniMap';
import { ComplexCardList } from './components/ComplexCardList';
import { PriceStabilityAnalysis } from './components/LstmFullAnalysis';
import { CommuteCompare } from './components/CommuteCompare';
import type { AptComplex, LstmAnalysis, ArimaAnalysis, CommuteCompareData } from '../../types/region-detail';
import type { RegionRecommendation } from '../../types/recommendation';

export function RegionDetailPage() {
  const { legalDongCode = '' } = useParams<{ legalDongCode: string }>();
  const navigate = useNavigate();
  const workplace = useRecommendationStore((s) => s.workplace);
  const storeRecommendations = useRecommendationStore((s) => s.recommendations);

  // ─── region 메타: store 우선 → MOCK_REGIONS 폴백 ────────────
  const region: RegionRecommendation | null =
    storeRecommendations.find((r) => r.legalDongCode === legalDongCode) ??
    MOCK_REGIONS.find((r) => r.legalDongCode === legalDongCode) ??
    null;

  // ─── 단지 목록 — 실 API + mock fallback ─────────────────────
  const [complexes, setComplexes] = useState<AptComplex[]>([]);
  const [complexesLoading, setComplexesLoading] = useState(true);
  const [complexesSource, setComplexesSource] = useState<'api' | 'mock'>('mock');

  useEffect(() => {
    if (!legalDongCode) return;
    const ac = new AbortController();
    setComplexesLoading(true);

    fetchComplexes(legalDongCode, ac.signal)
      .then((result) => {
        setComplexes(result.complexes);
        setComplexesSource(result.source);
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        console.error('[RegionDetailPage] complexes fetch fail:', err);
      })
      .finally(() => setComplexesLoading(false));

    return () => ac.abort();
  }, [legalDongCode]);

  // ─── 선택 단지 ───────────────────────────────────────────────
  const [selectedComplex, setSelectedComplex] = useState<AptComplex | null>(null);

  // 첫 단지 자동 선택 (로딩 완료 후)
  useEffect(() => {
    if (!complexesLoading && complexes.length > 0 && !selectedComplex) {
      setSelectedComplex(complexes[0]);
    }
  }, [complexes, complexesLoading, selectedComplex]);

  // ─── LSTM 분석 — 선택 단지 변경 시 재조회 ───────────────────
  const [lstm, setLstm] = useState<LstmAnalysis | null>(null);
  const [lstmLoading, setLstmLoading] = useState(false);
  const [arima, setArima] = useState<ArimaAnalysis | null>(null);
  const [arimaLoading, setArimaLoading] = useState(false);

  useEffect(() => {
    if (!selectedComplex) {
      setLstm(null);
      return;
    }
    const ac = new AbortController();
    setLstmLoading(true);

    fetchLstm(selectedComplex.complexId, ac.signal)
      .then((result) => setLstm(result.analysis))
      .catch((err) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        console.error('[RegionDetailPage] lstm fetch fail:', err);
      })
      .finally(() => setLstmLoading(false));

    return () => ac.abort();
  }, [selectedComplex]);

  // ─── ARIMA 분석 (메인 모델) ─────────────────────────────────
  useEffect(() => {
    if (!selectedComplex) {
      setArima(null);
      return;
    }
    const ac = new AbortController();
    setArimaLoading(true);

    fetchArima(selectedComplex.complexId, ac.signal)
      .then((result) => setArima(result.analysis))
      .catch((err) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        console.error('[RegionDetailPage] arima fetch fail:', err);
      })
      .finally(() => setArimaLoading(false));

    return () => ac.abort();
  }, [selectedComplex]);

  // ─── 통근 비교 — 실 API (cache/ODsay/estimate) + mock fallback ─
  const [commute, setCommute] = useState<CommuteCompareData | null>(null);

  useEffect(() => {
    if (!selectedComplex || !workplace) {
      setCommute(null);
      return;
    }
    const ac = new AbortController();

    fetchCommuteCompare(
      selectedComplex.complexId,
      { lat: selectedComplex.lat, lng: selectedComplex.lng },
      workplace,
      ac.signal,
    )
      .then((result) => setCommute(result?.data ?? null))
      .catch((err) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        console.error('[RegionDetailPage] commute fetch fail:', err);
      });

    return () => ac.abort();
  }, [selectedComplex, workplace]);

  // ─── 잘못된 경로 또는 직접 URL 진입 ─────────────────────────
  if (!region) {
    return (
      <div className="w-screen h-screen flex flex-col items-center justify-center bg-surface dark:bg-surface-dark text-ink-primary dark:text-ink-primary-dark font-sans gap-4">
        <p className="text-sm text-ink-secondary dark:text-ink-secondary-dark">
          존재하지 않는 지역입니다.
        </p>
        <button
          onClick={() => navigate('/')}
          className="px-4 py-2 rounded-card bg-brand text-white text-sm font-semibold hover:bg-brand-600 transition-colors"
        >
          추천 페이지로 돌아가기
        </button>
      </div>
    );
  }

  return (
    //  모바일(<md): 전체 페이지 세로 스크롤 + 1열 stacking
    //  데스크톱(md+): 화면 고정 + 12-grid 2단 레이아웃 (현재 동작)
    <div className="w-screen md:h-screen min-h-screen flex flex-col bg-surface dark:bg-surface-dark md:overflow-hidden text-ink-primary dark:text-ink-primary-dark font-sans">
      <RegionDetailHeader
        region={region}
        onBack={() => navigate('/')}
        isDemoData={complexesSource === 'mock'}
      />

      <main className="flex-1 grid grid-cols-1 md:grid-cols-12 gap-3 p-3 md:overflow-hidden">
        {/* 좌: 미니 지도 — 모바일 풀폭 + 고정 높이, 데스크톱 4컬 */}
        <section className="col-span-1 md:col-span-4 h-[40vh] md:h-auto rounded-cardlg overflow-hidden bg-surface-elevated dark:bg-surface-dark-elevated border border-line-light dark:border-line-dark shadow-card">
          <RegionMiniMap
            region={region}
            complexes={complexes}
            workplace={workplace}
            selectedComplexId={selectedComplex?.complexId ?? null}
            onSelectComplex={(c) => setSelectedComplex(c)}
          />
        </section>

        {/* 우: 매물 + LSTM — 모바일 풀폭, 데스크톱 8컬 */}
        <section className="col-span-1 md:col-span-8 flex flex-col gap-3 md:overflow-hidden">
          {/* 단지 카드 리스트 (가로 스크롤) */}
          {complexesLoading ? (
            <LoadingBar label="단지 목록 불러오는 중…" />
          ) : (
            <ComplexCardList
              complexes={complexes}
              selectedId={selectedComplex?.complexId ?? null}
              onSelect={setSelectedComplex}
            />
          )}

          {/* 가격 안정성 분석 + 통근 비교 — 모바일 1열, 데스크톱 3-grid */}
          <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-3 md:overflow-hidden">
            <div className="col-span-1 md:col-span-2 md:overflow-auto">
              {(arimaLoading || lstmLoading) ? (
                <LoadingBar label="가격 안정성 분석 중…" />
              ) : selectedComplex && (arima ?? lstm) ? (
                <PriceStabilityAnalysis
                  complex={selectedComplex}
                  lstm={lstm}
                  arima={arima}
                />
              ) : (
                <EmptyAnalysis />
              )}
            </div>
            <div className="col-span-1 md:overflow-auto">
              {commute ? (
                <CommuteCompare data={commute} />
              ) : (
                <EmptyCommute />
              )}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

function LoadingBar({ label }: { label: string }) {
  return (
    <div className="rounded-cardlg bg-surface-elevated dark:bg-surface-dark-elevated border border-line-light dark:border-line-dark shadow-card px-4 py-3 flex items-center gap-2 text-sm text-ink-tertiary dark:text-ink-tertiary-dark">
      <svg
        className="animate-spin shrink-0"
        width="14" height="14" viewBox="0 0 24 24"
        fill="none" stroke="currentColor" strokeWidth="2.5"
        aria-hidden="true"
      >
        <path d="M21 12a9 9 0 1 1-6.22-8.56" strokeLinecap="round" />
      </svg>
      {label}
    </div>
  );
}

function EmptyAnalysis() {
  return (
    <div className="h-full rounded-cardlg bg-surface-elevated dark:bg-surface-dark-elevated border border-line-light dark:border-line-dark shadow-card flex items-center justify-center text-sm text-ink-tertiary dark:text-ink-tertiary-dark">
      좌측 매물을 선택해 주세요.
    </div>
  );
}

function EmptyCommute() {
  return (
    <div className="h-full rounded-cardlg bg-surface-elevated dark:bg-surface-dark-elevated border border-line-light dark:border-line-dark shadow-card flex items-center justify-center text-xs text-ink-tertiary dark:text-ink-tertiary-dark text-center px-3">
      직장이 설정되어야
      <br />
      통근 비교가 표시됩니다.
    </div>
  );
}
