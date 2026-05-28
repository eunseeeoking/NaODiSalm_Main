/**
 * Depth 2 · 지역 추천 페이지 (메인)
 *
 * ── Z-index 레이어 체계 ────────────────────────────────────────
 *  Layer 0 (z-auto) : 지도 (MapPanel) — 항상 전체 배경
 *  Layer 1 (z-10)   : 좌/우 오버레이 패널 (데스크톱 전용)
 *  Layer 2 (z-20)   : 패널 토글 버튼 (데스크톱 전용)
 *  Layer 3 (z-30)   : 모바일 탑-다운 드로어 백드롭
 *  Layer 4 (z-40)   : 모바일 탑-다운 드로어 패널
 *  Layer 5 (z-50)   : InfoTooltip 말풍선
 * ──────────────────────────────────────────────────────────────
 *
 * ── 모바일 UX (< 768px) ────────────────────────────────────────
 *  헤더 하단에 가로 스크롤 가능한 필터 바를 표시.
 *  버튼 클릭 시 해당 패널이 지도 위에서 상단→하방으로 슬라이드 인.
 *  패널 바깥(백드롭) 클릭 또는 같은 버튼 재클릭으로 닫힘.
 *
 * ── 데스크톱 UX (≥ 768px) ─────────────────────────────────────
 *  기존 좌/우 슬라이드 패널 + 토글 버튼 동작 유지.
 * ──────────────────────────────────────────────────────────────
 */
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useRecommendationStore } from '../../stores/useRecommendationStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { fetchRecommendations } from '../../api/recommendations';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { RecommendationHeader } from './components/RecommendationHeader';
import { MapPanel } from './components/MapPanel';
import { LeftPanel } from './components/LeftPanel';
import { CardPanel } from './components/CardPanel';
import { CommutePatienceSlider } from './components/CommutePatienceSlider';
import { WeightSliders } from './components/WeightSliders';
import { isWeightsValid } from './components/WeightSliders';
import {
  decodeParamsToState,
  encodeStateToParams,
  resolveWeights,
} from './utils/urlState';
import { QUINTILE_INCOME_MAP } from '../../types/recommendation';

/** 패널 토글 버튼 공통 스타일 — 보더 제거, 그림자만으로 부유감 표현 (데스크톱 전용) */
const TOGGLE_BTN_CLS = [
  'absolute top-1/2 -translate-y-1/2 z-20',
  'w-6 h-10 flex items-center justify-center',
  'bg-surface-elevated dark:bg-surface-dark-elevated',
  'rounded-full shadow-card',
  'text-ink-tertiary dark:text-ink-tertiary-dark',
  'hover:text-brand dark:hover:text-brand-300 hover:shadow-card-hover',
  'text-sm font-bold select-none',
  'transition-[left,right,box-shadow] duration-300 ease-in-out',
].join(' ');

/** 뷰포트가 md 미만(<768px)인지 */
function useIsMobile(): boolean {
  const [mobile, setMobile] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth < 768 : false,
  );
  useEffect(() => {
    const onResize = () => setMobile(window.innerWidth < 768);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return mobile;
}

/** 모바일 필터 바에 표시할 패널 목록 */
type MobilePanel = 'commute' | 'weights' | 'regions';

const MOBILE_FILTER_ITEMS: ReadonlyArray<{ key: MobilePanel; label: string }> = [
  { key: 'commute',  label: '통근·예산' },
  { key: 'weights',  label: '가중치' },
  { key: 'regions',  label: '추천지역' },
];

export function RecommendationPage() {
  const isMobile = useIsMobile();

  // ─── 데스크톱 패널 상태 ──────────────────────────────────────
  const [leftCollapsed, setLeftCollapsed] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth < 768 : false,
  );
  const [rightCollapsed, setRightCollapsed] = useState(true);

  // ─── 모바일 드로어 상태 ──────────────────────────────────────
  // null = 모두 닫힘 / 'commute' | 'weights' | 'regions' = 해당 패널 열림
  const [mobileActivePanel, setMobileActivePanel] = useState<MobilePanel | null>(null);

  const toggleMobilePanel = (panel: MobilePanel) => {
    setMobileActivePanel((prev) => (prev === panel ? null : panel));
  };

  // 뷰포트 전환 시 모바일 드로어 닫기 (데스크톱으로 넓어졌을 때 잔여 상태 제거)
  useEffect(() => {
    if (!isMobile) setMobileActivePanel(null);
  }, [isMobile]);

  // ─── 스토어 ──────────────────────────────────────────────────
  const workplace       = useRecommendationStore((s) => s.workplace);
  const budget          = useRecommendationStore((s) => s.budget);
  const weights         = useRecommendationStore((s) => s.weights);
  const patience        = useRecommendationStore((s) => s.patience);
  const incomeQuintile  = useRecommendationStore((s) => s.incomeQuintile);
  const setIncomeQuintile = useRecommendationStore((s) => s.setIncomeQuintile);
  const setRecommendations = useRecommendationStore((s) => s.setRecommendations);
  const setWorkplace    = useRecommendationStore((s) => s.setWorkplace);
  const setBudget       = useRecommendationStore((s) => s.setBudget);
  const setPatience     = useRecommendationStore((s) => s.setPatience);
  const setWeight       = useRecommendationStore((s) => s.setWeight);
  const bootstrap       = useAuthStore((s) => s.bootstrap);

  // ─── 마운트 1회: 인증 + URL 하이드레이션 ─────────────────────
  const hydratedRef = useRef(false);
  useEffect(() => { bootstrap(); }, [bootstrap]);

  useEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;

    const params = new URLSearchParams(window.location.search);
    if (params.toString() === '') return;

    const shared = decodeParamsToState(params);
    if (shared.workplace)     setWorkplace(shared.workplace);
    if (shared.budget !== null)   setBudget(shared.budget);
    if (shared.patience !== null) setPatience(shared.patience);

    const finalWeights = resolveWeights(shared);
    if (finalWeights) {
      setWeight('commute',       finalWeights.commute);
      setWeight('affordability', finalWeights.affordability);
      setWeight('safety',        finalWeights.safety);
      setWeight('life',          finalWeights.life);
    }
    if (shared.incomeQuintile !== null) setIncomeQuintile(shared.incomeQuintile);
  }, [setWorkplace, setBudget, setPatience, setWeight, setIncomeQuintile]);

  // ─── 우측 패널 자동 펼침/접힘 (데스크톱) ─────────────────────
  useEffect(() => {
    if (!workplace) { setRightCollapsed(true); return; }
    if (!isMobile) setRightCollapsed(false);
  }, [workplace, isMobile]);

  // ─── 데스크톱 상호배타 토글 ──────────────────────────────────
  const openLeft  = () => { setLeftCollapsed(false);  if (isMobile) setRightCollapsed(true); };
  const openRight = () => { setRightCollapsed(false); if (isMobile) setLeftCollapsed(true); };
  const toggleLeft  = () => (leftCollapsed  ? openLeft()  : setLeftCollapsed(true));
  const toggleRight = () => (rightCollapsed ? openRight() : setRightCollapsed(true));

  // ─── 슬라이더 debounce (350ms) ───────────────────────────────
  const debouncedWeights  = useDebouncedValue(weights, 350);
  const debouncedBudget   = useDebouncedValue(budget,  350);
  const debouncedPatience = useDebouncedValue(patience, 350);

  // ─── 추천 결과 fetch ─────────────────────────────────────────
  useEffect(() => {
    if (!workplace) { setRecommendations([], null); return; }
    if (!isWeightsValid(debouncedWeights)) return;

    const ac = new AbortController();
    let alive = true;
    const incomeMonthly = incomeQuintile ? QUINTILE_INCOME_MAP[incomeQuintile] : undefined;

    fetchRecommendations(
      { workplace, budget: debouncedBudget, weights: debouncedWeights, patience: debouncedPatience, incomeMonthly },
      ac.signal,
    )
      .then((result) => { if (!alive) return; setRecommendations(result.regions, result.source); })
      .catch((err) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        console.error('[RecommendationPage] fetch fail:', err);
      });

    return () => { alive = false; ac.abort(); };
  }, [workplace, debouncedBudget, debouncedWeights, debouncedPatience, incomeQuintile, setRecommendations]);

  // ─── 스토어 → URL ─────────────────────────────────────────────
  useEffect(() => {
    if (!hydratedRef.current) return;
    const handle = window.setTimeout(() => {
      const params = encodeStateToParams({ workplace, budget, weights, patience, incomeQuintile });
      const next = `${window.location.pathname}?${params.toString()}`;
      if (next === window.location.pathname + window.location.search) return;
      window.history.replaceState(null, '', next);
    }, 200);
    return () => window.clearTimeout(handle);
  }, [workplace, budget, weights, patience, incomeQuintile]);

  // 토글 버튼 위치 (데스크톱)
  const LEFT_OPEN   = '352px';
  const LEFT_CLOSED = '12px';
  const RIGHT_OPEN  = '340px';
  const RIGHT_CLOSED = '8px';

  return (
    <div className="w-screen h-screen flex flex-col bg-surface dark:bg-surface-dark overflow-hidden text-ink-primary dark:text-ink-primary-dark font-sans">
      <RecommendationHeader />

      {/* 데이터 출처 배지 스트립 — 모바일 숨김 */}
      <div className="bg-surface-elevated dark:bg-surface-dark-elevated border-b border-line-light dark:border-line-dark px-5 py-1.5 hidden md:flex items-center gap-2 overflow-x-auto shrink-0">
        <Link
          to="/intro"
          className="text-2xs font-semibold text-ink-tertiary dark:text-ink-tertiary-dark hover:text-brand dark:hover:text-brand-300 underline underline-offset-2 shrink-0 transition-colors"
          title="나어디삶 서비스 소개 페이지 (/intro)"
        >
          소개 페이지
        </Link>
        <Link
          to="/about/data"
          className="text-2xs font-semibold text-ink-tertiary dark:text-ink-tertiary-dark hover:text-brand dark:hover:text-brand-300 underline underline-offset-2 shrink-0 mr-1 transition-colors"
          title="공공데이터 4기관 융합 현황 보기"
        >
          데이터 출처
        </Link>
        {[
          { label: 'MOLIT RTMS',          desc: '국토부 실거래가 1.3M건 (2006~2025)' },
          { label: '한국부동산원 R-ONE',   desc: '공동주택 매매·전세 지수 (2015~2026)' },
          { label: '한국교통안전공단 TAGO', desc: '대중교통 품질 점수 (배차·야간·정류장)' },
          { label: 'LH 청년주택',          desc: '행복주택·청년매입임대·전세임대' },
          { label: '통계청',               desc: '청년 1인가구 소득 5분위' },
        ].map(({ label, desc }) => (
          <span
            key={label}
            title={desc}
            className="text-2xs font-medium px-2 py-0.5 rounded-full bg-brand/10 text-brand shrink-0 cursor-default"
          >
            {label}
          </span>
        ))}
      </div>

      {/*
        ── 모바일 필터 바 (md 미만에서만 노출) ─────────────────────
        검색 바 바로 하단에 고정. 가로 스크롤 가능.
      */}
      <div className="md:hidden flex overflow-x-auto gap-2 px-3 py-2 bg-surface-elevated dark:bg-surface-dark-elevated shrink-0 scroll-x-thin">
        {MOBILE_FILTER_ITEMS.map(({ key, label }) => {
          const active = mobileActivePanel === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => toggleMobilePanel(key)}
              aria-pressed={active}
              className={[
                'shrink-0 text-xs font-semibold px-3.5 py-1.5 rounded-full',
                'transition-all duration-200 select-none',
                'flex items-center gap-1',
                active
                  ? 'bg-brand text-white shadow-sm'
                  : 'bg-brand-50 dark:bg-brand/[.15] text-brand dark:text-brand-300',
              ].join(' ')}
            >
              {/* 열림 표시 화살표 */}
              <svg
                width="10"
                height="10"
                viewBox="0 0 10 10"
                fill="currentColor"
                className={`transition-transform duration-200 ${active ? 'rotate-180' : 'rotate-0'}`}
                aria-hidden="true"
              >
                <path d="M5 7 L1 3 L9 3 Z" />
              </svg>
              {label}
            </button>
          );
        })}
      </div>

      {/*
        ── 핵심 레이아웃 ──────────────────────────────────────────
        main: position relative — 모든 오버레이 기준점
      */}
      <main className="flex-1 relative overflow-hidden">

        {/* ── Layer 0: 지도 ── */}
        <div className="absolute inset-0 flex flex-col z-0">
          <MapPanel />
        </div>

        {/*
          ══════════════════════════════════════════════════════
          데스크톱 전용 패널 (md 이상에서만 렌더링)
          ══════════════════════════════════════════════════════
        */}
        {!isMobile && (
          <>
            {/* 좌측 패널 — 통근인내심 + 가중치 */}
            <div
              className={[
                'absolute left-3 top-3 bottom-3 w-[340px]',
                'z-10',
                'transition-transform duration-300 ease-in-out',
                leftCollapsed ? '-translate-x-[calc(100%+12px)]' : 'translate-x-0',
              ].join(' ')}
            >
              <LeftPanel />
            </div>

            {/* 우측 패널 — 추천 카드 */}
            <div
              className={[
                'absolute right-0 top-0 bottom-0 w-[340px]',
                'z-10',
                'transition-transform duration-300 ease-in-out',
                rightCollapsed ? 'translate-x-full' : 'translate-x-0',
              ].join(' ')}
            >
              <CardPanel />
            </div>

            {/* 좌측 토글 버튼 */}
            <button
              type="button"
              onClick={toggleLeft}
              aria-label={leftCollapsed ? '가중치 패널 열기' : '가중치 패널 닫기'}
              title={leftCollapsed ? '가중치 패널 열기' : '가중치 패널 닫기'}
              style={{ left: leftCollapsed ? LEFT_CLOSED : LEFT_OPEN }}
              className={TOGGLE_BTN_CLS}
            >
              {leftCollapsed ? '›' : '‹'}
            </button>

            {/* 우측 토글 버튼 */}
            <button
              type="button"
              onClick={toggleRight}
              aria-label={rightCollapsed ? '추천 패널 열기' : '추천 패널 닫기'}
              title={rightCollapsed ? '추천 패널 열기' : '추천 패널 닫기'}
              style={{ right: rightCollapsed ? RIGHT_CLOSED : RIGHT_OPEN }}
              className={TOGGLE_BTN_CLS}
            >
              {rightCollapsed ? '‹' : '›'}
            </button>
          </>
        )}

        {/*
          ══════════════════════════════════════════════════════
          모바일 전용 탑-다운 드로어 패널 (md 미만에서만 렌더링)
          ══════════════════════════════════════════════════════
        */}
        {isMobile && (
          <>
            {/* 백드롭 — 패널 열림 시 지도 위를 덮어 탭 아웃으로 닫기 가능 */}
            <div
              className={[
                'absolute inset-0 z-30',
                'bg-black/30',
                'transition-opacity duration-300',
                mobileActivePanel ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none',
              ].join(' ')}
              onClick={() => setMobileActivePanel(null)}
              aria-hidden="true"
            />

            {/* ── 드로어 A: 통근인내심 · 예산 ── */}
            <div
              className={[
                'absolute -top-px left-0 right-0 z-40',
                'bg-surface dark:bg-surface-dark',
                'max-h-[72vh] overflow-y-auto',
                'transition-transform duration-300 ease-in-out',
                'shadow-xl',
                mobileActivePanel === 'commute' ? 'translate-y-0' : '-translate-y-full',
              ].join(' ')}
              aria-hidden={mobileActivePanel !== 'commute'}
            >
              {/* 드래그 핸들 (시각 힌트만, 헤더 제거) */}
              <div className="flex justify-center pt-2 pb-1 shrink-0">
                <div className="w-8 h-1 rounded-full bg-line-light dark:bg-line-dark" />
              </div>
              <div className="px-3 pb-3">
                <CommutePatienceSlider />
              </div>
            </div>

            {/* ── 드로어 B: 가중치 ── */}
            <div
              className={[
                'absolute -top-px left-0 right-0 z-40',
                'bg-surface dark:bg-surface-dark',
                'max-h-[72vh] overflow-y-auto',
                'transition-transform duration-300 ease-in-out',
                'shadow-xl',
                mobileActivePanel === 'weights' ? 'translate-y-0' : '-translate-y-full',
              ].join(' ')}
              aria-hidden={mobileActivePanel !== 'weights'}
            >
              <div className="flex justify-center pt-2 pb-1 shrink-0">
                <div className="w-8 h-1 rounded-full bg-line-light dark:bg-line-dark" />
              </div>
              <div className="px-3 pb-3">
                <WeightSliders />
              </div>
            </div>

            {/* ── 드로어 C: 추천지역 ── */}
            <div
              className={[
                'absolute -top-px left-0 right-0 z-40',
                'bg-surface dark:bg-surface-dark',
                'max-h-[72vh] overflow-y-auto',
                'transition-transform duration-300 ease-in-out',
                'shadow-xl',
                mobileActivePanel === 'regions' ? 'translate-y-0' : '-translate-y-full',
              ].join(' ')}
              aria-hidden={mobileActivePanel !== 'regions'}
            >
              {/* 드래그 핸들 */}
              <div className="flex justify-center pt-2 pb-1 shrink-0">
                <div className="w-8 h-1 rounded-full bg-line-light dark:bg-line-dark" />
              </div>
              {/* CardPanel은 h-full 기반이라 max-h 컨테이너 안에서 min-h 고정 */}
              <div className="min-h-[200px]">
                <CardPanel />
              </div>
            </div>
          </>
        )}

      </main>
    </div>
  );
}
