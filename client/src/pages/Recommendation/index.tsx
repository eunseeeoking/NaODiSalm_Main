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
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useRecommendationStore } from '../../stores/useRecommendationStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { fetchRecommendations } from '../../api/recommendations';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { useDragScroll } from '../../hooks/useDragScroll';
import { RecommendationHeader } from './components/RecommendationHeader';
import { MapPanel } from './components/MapPanel';
import { LeftPanel } from './components/LeftPanel';
import { CardPanel } from './components/CardPanel';
import { CommutePatienceSlider } from './components/CommutePatienceSlider';
import { WeightSliders } from './components/WeightSliders';
import { isWeightsValid } from './components/WeightSliders';
import { DealTypeToggle } from './components/DealTypeToggle';
import { PropertyTypeFilter } from './components/PropertyTypeFilter';
import {
  decodeParamsToState,
  encodeStateToParams,
  resolveWeights,
} from './utils/urlState';
import { QUINTILE_INCOME_MAP, BUDGET_SLIDER, MONTHLY_RENT_SLIDER } from '../../types/recommendation';

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

/** 모바일 필터 바에 표시할 '입력' 패널 목록 — 의미 단위로 분리.
 *  결과(추천지역)는 입력이 아니므로 칩에서 제외하고 하단 ResultsSheet 로 분리. */
type MobilePanel = 'commute' | 'dealType' | 'property' | 'weights';

const MOBILE_FILTER_ITEMS: ReadonlyArray<{ key: MobilePanel; label: string }> = [
  { key: 'commute',  label: '통근·예산' },
  { key: 'dealType', label: '거래유형' },
  { key: 'property', label: '매물종류' },
  { key: 'weights',  label: '가중치·소득분위' },
];

/**
 * 모바일 탑-다운 드로어 핸들 — 패널 '하단'에 배치.
 *  드로어가 위에서 내려오므로 사용자는 바닥의 핸들을 잡아 위로 당겨 닫으려 함(관찰됨).
 *  → 탭 또는 위로 스와이프(>30px) 시 닫힘.
 */
function DrawerHandle({ onClose }: { onClose: () => void }) {
  const startY = useRef<number | null>(null);
  return (
    <button
      type="button"
      onClick={onClose}
      onPointerDown={(e) => { startY.current = e.clientY; }}
      onPointerUp={(e) => {
        const sy = startY.current;
        startY.current = null;
        if (sy != null && sy - e.clientY > 30) onClose(); // 위로 스와이프 → 닫기
      }}
      aria-label="패널 닫기 (탭하거나 위로 당기기)"
      title="닫기"
      className="shrink-0 w-full flex justify-center pt-1.5 pb-2.5 touch-none cursor-grab active:cursor-grabbing"
    >
      <span className="w-10 h-1 rounded-full bg-line-light dark:bg-line-dark" />
    </button>
  );
}

/**
 * 모바일 탑-다운 드로어 — 콘텐츠(스크롤) + 하단 드래그 핸들.
 *  flex-col + 콘텐츠 min-h-0 로, 짧으면 shrink-wrap(핸들이 콘텐츠 바로 아래),
 *  길면 max-h-72vh 안에서 콘텐츠만 스크롤하고 핸들은 바닥에 고정.
 */
function MobileDrawer({
  open,
  onClose,
  bare = false,
  children,
}: {
  open: boolean;
  onClose: () => void;
  bare?: boolean; // CardPanel 처럼 자체 패딩이 있는 콘텐츠는 패딩 제거
  children: ReactNode;
}) {
  return (
    <div
      className={[
        'absolute -top-px left-0 right-0 z-40',
        'bg-surface dark:bg-surface-dark',
        'max-h-[72vh] flex flex-col',
        'transition-transform duration-300 ease-in-out',
        'shadow-xl',
        open ? 'translate-y-0' : '-translate-y-full',
      ].join(' ')}
      aria-hidden={!open}
    >
      <div className={['min-h-0 overflow-y-auto', bare ? '' : 'px-3 pt-3 pb-2'].join(' ')}>
        {children}
      </div>
      <DrawerHandle onClose={onClose} />
    </div>
  );
}

/**
 * 추천지역(결과) 바텀시트 — 입력 드로어(상단)와 분리해 화면 '하단'에서 올라옴.
 *  - peek: 헤더(핸들 + 건수)만 노출 / 펼침: 화면 75% 높이로 CardPanel 표시.
 *  - 헤더 탭 = 토글, 위/아래 드래그(>30px) = 펼침/접힘.
 *  - 상단 입력 드로어가 열리면(hidden) 시트는 완전히 내려가 충돌 방지.
 */
function ResultsSheet({
  expanded,
  hidden,
  onExpand,
  onCollapse,
}: {
  expanded: boolean;
  hidden: boolean;
  onExpand: () => void;
  onCollapse: () => void;
}) {
  const workplace = useRecommendationStore((s) => s.workplace);
  const recommendations = useRecommendationStore((s) => s.recommendations);
  const isLoading = useRecommendationStore((s) => s.isLoading);
  const startY = useRef<number | null>(null);
  const dragged = useRef(false);

  if (!workplace) return null; // 직장 미입력 → 결과 없음, 시트 자체 숨김

  const count = recommendations.length;
  const label = isLoading
    ? '추천 지역 조회 중…'
    : count === 0
    ? '조건에 맞는 지역 없음'
    : `추천지역 ${count}곳`;

  return (
    <>
      {/* 펼침 시 백드롭 (입력 드로어가 열린 상태에선 미표시) */}
      <div
        className={[
          'absolute inset-0 z-30 bg-black/30 transition-opacity duration-300',
          expanded && !hidden ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none',
        ].join(' ')}
        onClick={onCollapse}
        aria-hidden="true"
      />
      <div
        className={[
          'absolute left-0 right-0 z-40 overflow-hidden',
          // peek: 범례(h-9) 위에 제목 줄만(bottom-9) / 펼침: 범례 숨김 → 바닥까지(bottom-0)
          // 높이 토글 방식: peek=헤더만(3.25rem), 펼침=75%, 입력 드로어 열림=0.
          //   translateY 로 내리면 본문이 범례를 덮으므로 height 로 잘라냄.
          expanded ? 'bottom-0' : 'bottom-9',
          'bg-surface dark:bg-surface-dark rounded-t-2xl shadow-xl',
          'flex flex-col transition-[height,bottom] duration-300 ease-in-out',
        ].join(' ')}
        style={{ height: hidden ? '0px' : expanded ? '75%' : '3.25rem' }}
        aria-hidden={hidden}
      >
        {/* peek 헤더 — 핸들(상단) + 건수. 탭/드래그로 토글 */}
        <button
          type="button"
          aria-expanded={expanded}
          aria-label={expanded ? '추천지역 접기' : '추천지역 펼치기'}
          onPointerDown={(e) => { startY.current = e.clientY; dragged.current = false; }}
          onPointerUp={(e) => {
            const sy = startY.current;
            startY.current = null;
            if (sy == null) return;
            const dy = e.clientY - sy;
            if (dy > 30) { dragged.current = true; onCollapse(); }       // 아래로 드래그 → 접기
            else if (dy < -30) { dragged.current = true; onExpand(); }   // 위로 드래그 → 펼치기
          }}
          onClick={() => {
            if (dragged.current) { dragged.current = false; return; }     // 드래그였으면 클릭 무시
            if (expanded) onCollapse(); else onExpand();
          }}
          className="shrink-0 w-full h-[3.25rem] flex flex-col items-center justify-center gap-1 px-4 touch-none cursor-grab active:cursor-grabbing border-b border-line-light dark:border-line-dark bg-surface-elevated dark:bg-surface-dark-elevated rounded-t-2xl"
        >
          <span className="w-10 h-1 rounded-full bg-line-light dark:bg-line-dark" />
          <span className="flex items-center gap-1 text-sm font-semibold text-ink-primary dark:text-ink-primary-dark">
            {label}
            <svg
              width="10" height="10" viewBox="0 0 10 10" fill="currentColor"
              className={`transition-transform duration-200 ${expanded ? 'rotate-0' : 'rotate-180'}`}
              aria-hidden="true"
            >
              <path d="M5 7 L1 3 L9 3 Z" />
            </svg>
          </span>
        </button>
        <div className="flex-1 min-h-0 overflow-hidden">
          <CardPanel />
        </div>
      </div>
    </>
  );
}

export function RecommendationPage() {
  const isMobile = useIsMobile();

  // 가로 스크롤 슬라이더 — 데이터 출처 배지 스트립 / 모바일 필터 바
  const dataStripRef = useDragScroll<HTMLDivElement>();
  const mobileFilterRef = useDragScroll<HTMLDivElement>();

  // ─── 데스크톱 패널 상태 ──────────────────────────────────────
  const [leftCollapsed, setLeftCollapsed] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth < 768 : false,
  );
  const [rightCollapsed, setRightCollapsed] = useState(true);

  // ─── 모바일 드로어 상태 ──────────────────────────────────────
  // null = 모두 닫힘 / 'commute' | 'dealType' | 'property' | 'weights' = 해당 입력 패널 열림
  const [mobileActivePanel, setMobileActivePanel] = useState<MobilePanel | null>(null);
  // 추천지역(결과) 바텀시트 — peek(false) / 펼침(true)
  const [resultsExpanded, setResultsExpanded] = useState(false);

  const toggleMobilePanel = (panel: MobilePanel) => {
    setMobileActivePanel((prev) => (prev === panel ? null : panel));
    setResultsExpanded(false); // 입력 드로어 열면 결과 시트는 접음(충돌 방지)
  };
  const closePanel = () => setMobileActivePanel(null);
  const expandResults = () => { setResultsExpanded(true); setMobileActivePanel(null); };
  const collapseResults = () => setResultsExpanded(false);

  // 뷰포트 전환 시 모바일 드로어/시트 닫기 (데스크톱으로 넓어졌을 때 잔여 상태 제거)
  useEffect(() => {
    if (!isMobile) { setMobileActivePanel(null); setResultsExpanded(false); }
  }, [isMobile]);

  // ─── 스토어 ──────────────────────────────────────────────────
  const workplace       = useRecommendationStore((s) => s.workplace);
  const budget          = useRecommendationStore((s) => s.budget);
  const monthlyRentCap  = useRecommendationStore((s) => s.monthlyRentCap);
  const setMonthlyRentCap = useRecommendationStore((s) => s.setMonthlyRentCap);
  const weights         = useRecommendationStore((s) => s.weights);
  const patience        = useRecommendationStore((s) => s.patience);
  const incomeQuintile  = useRecommendationStore((s) => s.incomeQuintile);
  const setIncomeQuintile = useRecommendationStore((s) => s.setIncomeQuintile);
  const incomeManwon    = useRecommendationStore((s) => s.incomeManwon);
  const setIncomeManwon = useRecommendationStore((s) => s.setIncomeManwon);
  const setRecommendations = useRecommendationStore((s) => s.setRecommendations);
  const setLoading      = useRecommendationStore((s) => s.setLoading);
  const setWorkplace    = useRecommendationStore((s) => s.setWorkplace);
  const setBudget       = useRecommendationStore((s) => s.setBudget);
  const setPatience     = useRecommendationStore((s) => s.setPatience);
  const dealType        = useRecommendationStore((s) => s.dealType);
  const setDealType     = useRecommendationStore((s) => s.setDealType);
  const propertyTypes   = useRecommendationStore((s) => s.propertyTypes);
  const setPropertyTypes = useRecommendationStore((s) => s.setPropertyTypes);
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
    if (shared.monthlyRentCap !== null) setMonthlyRentCap(shared.monthlyRentCap);
    if (shared.patience !== null) setPatience(shared.patience);

    const finalWeights = resolveWeights(shared);
    if (finalWeights) {
      setWeight('commute',       finalWeights.commute);
      setWeight('affordability', finalWeights.affordability);
      setWeight('safety',        finalWeights.safety);
      setWeight('life',          finalWeights.life);
    }
    if (shared.incomeQuintile !== null) setIncomeQuintile(shared.incomeQuintile);
    if (shared.incomeManwon !== null) setIncomeManwon(shared.incomeManwon);
    if (shared.dealType !== null) setDealType(shared.dealType);
    if (shared.propertyTypes !== null) setPropertyTypes(shared.propertyTypes);
  }, [setWorkplace, setBudget, setMonthlyRentCap, setPatience, setWeight, setIncomeQuintile, setIncomeManwon, setDealType, setPropertyTypes]);

  // ─── 우측 패널 자동 펼침/접힘 (데스크톱) ─────────────────────
  useEffect(() => {
    if (!workplace) { setRightCollapsed(true); return; }
    if (!isMobile) setRightCollapsed(false);
  }, [workplace, isMobile]);

  // ─── 데스크톱 우측 패널 토글 (좌측은 항상 표시 — 패널 닫기 버튼 제거) ──
  const openRight = () => { setRightCollapsed(false); if (isMobile) setLeftCollapsed(true); };
  const toggleRight = () => (rightCollapsed ? openRight() : setRightCollapsed(true));

  // ─── 슬라이더 debounce (350ms) ───────────────────────────────
  const debouncedWeights  = useDebouncedValue(weights, 350);
  const debouncedBudget   = useDebouncedValue(budget,  350);
  const debouncedMonthlyRentCap = useDebouncedValue(monthlyRentCap, 350);
  const debouncedPatience = useDebouncedValue(patience, 350);

  // ─── 추천 결과 fetch ─────────────────────────────────────────
  useEffect(() => {
    if (!workplace) { setRecommendations([], null); setLoading(false); return; }
    if (!isWeightsValid(debouncedWeights)) return;

    const ac = new AbortController();
    let alive = true;
    // 조건 변경 → 응답 대기 동안 핀 제거 + 카드 스켈레톤 (이전 데이터 잔류 혼동 방지)
    setLoading(true);
    // 직접 입력값(incomeManwon) 우선 — 분위 반올림 착시 제거. 없으면 분위 대표값.
    const incomeMonthly =
      incomeManwon ?? (incomeQuintile ? QUINTILE_INCOME_MAP[incomeQuintile] : undefined);

    // 슬라이더 최대 위치 = 무제한 → 예산 필터 해제(undefined 전송, 전체 매물)
    const budgetToSend =
      debouncedBudget >= BUDGET_SLIDER[dealType].max ? undefined : debouncedBudget;
    // 월세 한도는 MONTHLY 이고 최대 미만일 때만 전송 (전세·매매·최대에선 미전송)
    const monthlyBudget =
      dealType === 'MONTHLY' && debouncedMonthlyRentCap < MONTHLY_RENT_SLIDER.max
        ? debouncedMonthlyRentCap
        : undefined;

    fetchRecommendations(
      { workplace, budget: budgetToSend, monthlyBudget, weights: debouncedWeights, patience: debouncedPatience, incomeMonthly, dealType, propertyTypes },
      ac.signal,
    )
      .then((result) => { if (!alive) return; setRecommendations(result.regions, result.source, result.meta); })
      .catch((err) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        // 새 요청이 abort 한 게 아니면 로딩 종료 (실패해도 스피너에 갇히지 않도록)
        if (alive) setLoading(false);
        console.error('[RecommendationPage] fetch fail:', err);
      });

    return () => { alive = false; ac.abort(); };
  }, [workplace, debouncedBudget, debouncedMonthlyRentCap, debouncedWeights, debouncedPatience, incomeQuintile, incomeManwon, dealType, propertyTypes, setRecommendations, setLoading]);

  // ─── 스토어 → URL ─────────────────────────────────────────────
  useEffect(() => {
    if (!hydratedRef.current) return;
    const handle = window.setTimeout(() => {
      const params = encodeStateToParams({ workplace, budget, monthlyRentCap, weights, patience, incomeQuintile, incomeManwon, dealType, propertyTypes });
      const next = `${window.location.pathname}?${params.toString()}`;
      if (next === window.location.pathname + window.location.search) return;
      window.history.replaceState(null, '', next);
    }, 200);
    return () => window.clearTimeout(handle);
  }, [workplace, budget, monthlyRentCap, weights, patience, incomeQuintile, incomeManwon, dealType, propertyTypes]);

  // 우측 토글 버튼 위치 (데스크톱)
  const RIGHT_OPEN  = '340px';
  const RIGHT_CLOSED = '8px';

  return (
    <div className="w-screen h-full flex flex-col bg-surface dark:bg-surface-dark overflow-hidden text-ink-primary dark:text-ink-primary-dark font-sans">
      <RecommendationHeader />

      {/* 데이터 출처 배지 스트립 — 모바일 숨김 */}
      <div ref={dataStripRef} className="bg-surface-elevated dark:bg-surface-dark-elevated border-b border-line-light dark:border-line-dark px-5 py-1.5 hidden md:flex items-center gap-2 overflow-x-auto scroll-x-slider shrink-0">
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
          title="6개 공공기관 + 민간 API 융합 현황 보기"
        >
          데이터 출처
        </Link>
        {[
          { label: 'MOLIT RTMS',        desc: '수도권 실거래 7.3M건 (2006~2026)' },
          { label: '한국부동산원 R-ONE', desc: '공동주택 매매·전세 지수 (2015~2026)' },
          { label: 'LH 청년주택',        desc: '행복주택·청년매입임대·전세임대' },
          { label: '통계청',             desc: '청년 1인가구 소득 5분위' },
          { label: '경찰청·지자체',       desc: '5대범죄·CCTV·가로등 안전지표' },
          { label: '국가대중교통 TAGO',   desc: '경기·인천 대중교통 품질 (서울=국토부 정류소)' },
          { label: 'ODsay · 카카오',     desc: '통근 경로 + 생활편의 POI (민간 API)' },
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
      <div ref={mobileFilterRef} className="md:hidden relative z-10 -mb-px flex overflow-x-auto gap-2 px-3 py-2 bg-surface-elevated dark:bg-surface-dark-elevated shrink-0 scroll-x-slider">
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
          {/* 범례는 결과 시트를 '펼쳤을 때'만 숨김. 입력 드로어가 내려와도 범례는 유지. */}
          <MapPanel showLegend={!isMobile || !resultsExpanded} />
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

            {/* ── 입력 드로어: 통근·예산 / 거래유형 / 매물종류 / 가중치·소득분위 ── */}
            <MobileDrawer open={mobileActivePanel === 'commute'} onClose={closePanel}>
              <CommutePatienceSlider />
            </MobileDrawer>

            <MobileDrawer open={mobileActivePanel === 'dealType'} onClose={closePanel}>
              <DealTypeToggle />
            </MobileDrawer>

            <MobileDrawer open={mobileActivePanel === 'property'} onClose={closePanel}>
              <PropertyTypeFilter />
            </MobileDrawer>

            <MobileDrawer open={mobileActivePanel === 'weights'} onClose={closePanel}>
              <WeightSliders />
            </MobileDrawer>

            {/* ── 추천지역(결과) = 출력 → 하단 바텀시트로 분리(입력 드로어와 성격 구분) ── */}
            <ResultsSheet
              expanded={resultsExpanded}
              hidden={mobileActivePanel !== null}
              onExpand={expandResults}
              onCollapse={collapseResults}
            />
          </>
        )}

      </main>
    </div>
  );
}
