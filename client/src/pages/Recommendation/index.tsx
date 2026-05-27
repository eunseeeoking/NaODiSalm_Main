/**
 * Depth 2 · 지역 추천 페이지 (메인)
 *
 * ── Z-index 레이어 체계 ────────────────────────────────────────
 *  Layer 0 (z-auto) : 지도 (MapPanel) — 항상 전체 배경
 *  Layer 1 (z-10)   : 좌/우 오버레이 패널 (가중치·추천 카드)
 *  Layer 2 (z-20)   : 패널 토글 버튼 — main 직계 자식으로 독립
 *  Layer 3 (z-50)   : InfoTooltip 말풍선 (패널 내부 상위 stacking context)
 * ──────────────────────────────────────────────────────────────
 */
import { useEffect, useRef, useState } from 'react';
import { useRecommendationStore } from '../../stores/useRecommendationStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { fetchRecommendations } from '../../api/recommendations';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { RecommendationHeader } from './components/RecommendationHeader';
import { MapPanel } from './components/MapPanel';
import { LeftPanel } from './components/LeftPanel';
import { CardPanel } from './components/CardPanel';
import { isWeightsValid } from './components/WeightSliders';
import {
  decodeParamsToState,
  encodeStateToParams,
  resolveWeights,
} from './utils/urlState';
import { QUINTILE_INCOME_MAP } from '../../types/recommendation';

/** 패널 토글 버튼 공통 스타일 — 보더 제거, 그림자만으로 부유감 표현 */
const TOGGLE_BTN_CLS = [
  'absolute top-1/2 -translate-y-1/2 z-20',
  'w-6 h-10 flex items-center justify-center',
  'bg-surface-elevated dark:bg-surface-dark-elevated',
  'rounded-full shadow-card',
  'text-ink-tertiary dark:text-ink-tertiary-dark',
  'hover:text-brand dark:hover:text-brand-300 hover:shadow-card-hover',
  'text-sm font-bold select-none',
  // left/right 위치를 CSS transition으로 애니메이션
  'transition-[left,right,box-shadow] duration-300 ease-in-out',
].join(' ');

/** 뷰포트가 md 미만(<768px)인지 — 패널 자동 접기·동시 열림 방지에 사용 */
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

export function RecommendationPage() {
  const isMobile = useIsMobile();
  // 모바일 기본: 둘 다 접힘 (지도 우선 노출). 데스크톱: 좌 열림, 우 닫힘.
  const [leftCollapsed, setLeftCollapsed] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth < 768 : false,
  );
  // 우측 패널: 직장 미선택 상태에선 추천 카드가 비어있으므로 기본 접힘
  // workplace 가 채워지면 자동 펼침, 비워지면 다시 접음 (useEffect 로 동기화)
  const [rightCollapsed, setRightCollapsed] = useState(true);

  const workplace = useRecommendationStore((s) => s.workplace);
  const budget = useRecommendationStore((s) => s.budget);
  const weights = useRecommendationStore((s) => s.weights);
  const patience = useRecommendationStore((s) => s.patience);
  const incomeQuintile = useRecommendationStore((s) => s.incomeQuintile);
  const setIncomeQuintile = useRecommendationStore((s) => s.setIncomeQuintile);
  const setRecommendations = useRecommendationStore((s) => s.setRecommendations);
  const setWorkplace = useRecommendationStore((s) => s.setWorkplace);
  const setBudget = useRecommendationStore((s) => s.setBudget);
  const setPatience = useRecommendationStore((s) => s.setPatience);
  const setWeight = useRecommendationStore((s) => s.setWeight);
  const bootstrap = useAuthStore((s) => s.bootstrap);

  // ─── 마운트 1회: 인증 + URL 하이드레이션 ─────────────────
  const hydratedRef = useRef(false);
  useEffect(() => {
    bootstrap();
  }, [bootstrap]);

  useEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;

    const params = new URLSearchParams(window.location.search);
    if (params.toString() === '') return;

    const shared = decodeParamsToState(params);

    if (shared.workplace) setWorkplace(shared.workplace);
    if (shared.budget !== null) setBudget(shared.budget);
    if (shared.patience !== null) setPatience(shared.patience);

    const finalWeights = resolveWeights(shared);
    if (finalWeights) {
      setWeight('commute', finalWeights.commute);
      setWeight('affordability', finalWeights.affordability);
      setWeight('safety', finalWeights.safety);
      setWeight('life', finalWeights.life);
    }

    if (shared.incomeQuintile !== null) setIncomeQuintile(shared.incomeQuintile);
  }, [setWorkplace, setBudget, setPatience, setWeight, setIncomeQuintile]);

  // ─── 우측 패널 자동 펼침/접힘 ────────────────────────────
  //  workplace 미선택  → 접힘 (추천 카드가 비어 있으므로)
  //  workplace 선택됨  → 펼침 (추천 결과 노출). 모바일은 사용자가 직접 열도록 접힘 유지.
  useEffect(() => {
    if (!workplace) {
      setRightCollapsed(true);
      return;
    }
    if (!isMobile) setRightCollapsed(false);
  }, [workplace, isMobile]);

  // ─── 모바일 상호배타 토글 ────────────────────────────────
  //  모바일에서 한쪽 패널을 열면 다른 쪽 자동 접힘 (지도 가림 방지)
  const openLeft = () => {
    setLeftCollapsed(false);
    if (isMobile) setRightCollapsed(true);
  };
  const openRight = () => {
    setRightCollapsed(false);
    if (isMobile) setLeftCollapsed(true);
  };
  const toggleLeft = () => (leftCollapsed ? openLeft() : setLeftCollapsed(true));
  const toggleRight = () => (rightCollapsed ? openRight() : setRightCollapsed(true));

  // ─── 슬라이더 입력 debounce (2026-05-27 추가) ───────────────
  //   가중치/예산/통근인내심 슬라이더는 매 입력마다 값 변경 →
  //   원래 useEffect 가 매번 트리거되어 fetchRecommendations 폭주 (사용자 보고).
  //   슬라이더 정지 후 350ms 안정되어야 1회 호출되도록 debounce.
  //   - UI 표시 값(weights/budget/patience) 자체는 즉시 반영 — 슬라이더 라벨 등은 그대로 동작
  //   - fetch 호출에만 debounced 값 사용
  //   - workplace/incomeQuintile 은 슬라이더가 아니라 검색/선택 → debounce 불필요
  const debouncedWeights = useDebouncedValue(weights, 350);
  const debouncedBudget = useDebouncedValue(budget, 350);
  const debouncedPatience = useDebouncedValue(patience, 350);

  // ─── 추천 결과 (실 API + mock 폴백) ──────────────────────
  useEffect(() => {
    if (!workplace) {
      setRecommendations([], null);
      return;
    }
    if (!isWeightsValid(debouncedWeights)) return;

    const ac = new AbortController();
    let alive = true;

    const incomeMonthly = incomeQuintile ? QUINTILE_INCOME_MAP[incomeQuintile] : undefined;

    fetchRecommendations(
      {
        workplace,
        budget: debouncedBudget,
        weights: debouncedWeights,
        patience: debouncedPatience,
        incomeMonthly,
      },
      ac.signal,
    )
      .then((result) => {
        if (!alive) return;
        setRecommendations(result.regions, result.source);
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        console.error('[RecommendationPage] fetch fail:', err);
      });

    return () => {
      alive = false;
      ac.abort();
    };
  }, [workplace, debouncedBudget, debouncedWeights, debouncedPatience, incomeQuintile, setRecommendations]);

  // ─── 스토어 → URL (replaceState, 디바운스 200ms) ──────────
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

  // 토글 버튼 위치 — 데스크톱(>=768) 픽셀 / 모바일(<768) calc()로 반응형
  //  패널 폭: 데스크톱 340, 모바일 min(85vw, 340px)
  //  좌측 패널 — 부유 위젯 (left-3) 토글: 패널 우측 가장자리 + 12px
  //  우측 패널 — 화면 우측 가장자리 흡착 토글: 패널 좌측 가장자리(흡착)
  const LEFT_OPEN  = isMobile ? 'calc(min(85vw, 340px) + 12px)' : '352px';
  const LEFT_CLOSED = '12px';
  const RIGHT_OPEN  = isMobile ? 'min(85vw, 340px)' : '340px';
  const RIGHT_CLOSED = '8px';

  return (
    <div className="w-screen h-screen flex flex-col bg-surface dark:bg-surface-dark overflow-hidden text-ink-primary dark:text-ink-primary-dark font-sans">
      <RecommendationHeader />

      {/* 데이터 출처 배지 스트립 — 모바일에선 숨김 (지도 영역 확보) */}
      <div className="bg-surface-elevated dark:bg-surface-dark-elevated border-b border-line-light dark:border-line-dark px-5 py-1.5 hidden md:flex items-center gap-2 overflow-x-auto shrink-0">
        <span className="text-2xs font-semibold text-ink-tertiary dark:text-ink-tertiary-dark shrink-0 mr-1">
          데이터 출처
        </span>
        {[
          { label: 'MOLIT RTMS',        desc: '국토부 실거래가 1.3M건 (2006~2025)' },
          { label: '한국부동산원 R-ONE', desc: '공동주택 매매·전세 지수 (2015~2026)' },
          { label: '한국교통안전공단 TAGO', desc: '대중교통 품질 점수 (배차·야간·정류장)' },
          { label: 'LH 청년주택',        desc: '행복주택·청년매입임대·전세임대' },
          { label: '통계청',             desc: '청년 1인가구 소득 5분위' },
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
        ── 핵심 레이아웃 ──────────────────────────────────────────
        main: position relative — 모든 오버레이 기준점
          Layer 0  지도    absolute inset-0       항상 전체 배경
          Layer 1  패널    absolute left/right-3  z-10 오버레이
          Layer 2  토글    absolute (main 직계)   z-20 — 패널 stacking context 바깥
        ─────────────────────────────────────────────────────────
      */}
      <main className="flex-1 relative overflow-hidden">

        {/* ── Layer 0: 지도 (z-0 stacking context — 내부 z-index가 패널 밖으로 새지 않게) ── */}
        <div className="absolute inset-0 flex flex-col z-0">
          <MapPanel />
        </div>

        {/* ── Layer 1a: 좌측 패널 — 가중치 슬라이더 (z-10)
              모바일: 85vw (최대 340px) · 데스크톱: 340px ── */}
        <div
          className={[
            'absolute left-3 top-3 bottom-3 w-[85vw] max-w-[340px]',
            'z-10',                            // 지도 위, 토글 아래
            'transition-transform duration-300 ease-in-out',
            // 닫힘: 패널 폭 + 좌측 여백(12px) 만큼 음수 이동 → 화면 밖
            leftCollapsed ? '-translate-x-[calc(100%+12px)]' : 'translate-x-0',
          ].join(' ')}
        >
          <LeftPanel />
        </div>

        {/* ── Layer 1b: 우측 패널 — 사이드 메뉴 (화면 우측 가장자리 흡착, z-10)
              모바일: 85vw (최대 340px) · 데스크톱: 340px ── */}
        <div
          className={[
            'absolute right-0 top-0 bottom-0 w-[85vw] max-w-[340px]',
            'z-10',
            'transition-transform duration-300 ease-in-out',
            // 닫힘: 패널 폭만큼 우측으로 이동 → 화면 밖
            rightCollapsed ? 'translate-x-full' : 'translate-x-0',
          ].join(' ')}
        >
          <CardPanel />
        </div>

        {/*
          ── Layer 2: 토글 버튼 (main 직계 — z-10 stacking context 완전히 바깥) ──
          style로 left/right 값을 직접 제어 → CSS transition이 숫자값을 애니메이션
        */}
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

      </main>
    </div>
  );
}
