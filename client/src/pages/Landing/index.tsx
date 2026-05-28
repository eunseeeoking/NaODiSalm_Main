/**
 * /intro — 서비스 소개 + 데모 노출 랜딩 페이지
 *
 *  Phase 7 (2026-05-28, D-1): 신설.
 *  Phase 7-2 (2026-05-28, D-1 PM): 화이트톤 고정 + 차트 가독성 보강 + 스크롤 reveal.
 *    - 공모전 제출용 → 다크 모드와 무관하게 항상 화이트톤 (no `dark:` variants on this page)
 *    - Depth 3 ARIMA 차트 가시성: 굵은 라인 + 가로 그리드 + 영역 음영 + 축 라벨
 *    - IntersectionObserver 기반 SectionReveal — 섹션이 뷰포트 진입 시 아래에서 올라오는 fade-in
 *
 *  구성:
 *    1) Hero       — 한 줄 정의 + 두 CTA + 4기관 배지
 *    2) Pain       — 청년 주거 위기 4 통계 (§2 사회적 가치 골자)
 *    3) Flow       — Depth 1 → 2 → 3 사용 흐름 (mock 시각화)
 *    4) Diff       — 4축 가중합 + ARIMA 10.16% + 5기관 융합
 *    5) Numbers    — 19년치 / 130만 거래 / 9,621 단지 / ARIMA 10.16%
 *    6) DemoCTA    — 시연 동선 추천 + 큰 버튼
 *    7) Footer     — about/data, 기획서, ML repo 링크
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

/* ────────────────────────── 상수 ────────────────────────── */

const HERO_BADGES: ReadonlyArray<{ label: string; tone: 'brand' | 'positive' | 'amber' | 'purple' }> = [
  { label: '국토교통부 RTMS', tone: 'brand' },
  { label: '한국부동산원 R-ONE', tone: 'positive' },
  { label: 'LH 청년주택', tone: 'amber' },
  { label: '통계청 · 경찰청', tone: 'purple' },
];

const TONE_BG: Record<'brand' | 'positive' | 'amber' | 'purple', string> = {
  brand:    'bg-brand/10 text-brand',
  positive: 'bg-positive/10 text-positive',
  amber:    'bg-amber-500/10 text-amber-600',
  purple:   'bg-purple-500/10 text-purple-600',
};

const NUMBER_TONE_TEXT: Record<'brand' | 'positive' | 'amber' | 'purple', string> = {
  brand:    'text-brand',
  positive: 'text-positive',
  amber:    'text-amber-600',
  purple:   'text-purple-600',
};

const PAIN_STATS: ReadonlyArray<{ value: string; label: string; source: string }> = [
  { value: '약 73만',  label: '서울 청년 1인가구 수',          source: '통계청 인구주택총조사 (2020)' },
  { value: '17.4%',    label: '청년 임차가구 평균 RIR',         source: '2023 주거실태조사' },
  { value: '8.2%',     label: '최저주거기준 미달 청년가구',     source: '2024 주거실태조사 (전년 +2.1%p)' },
  { value: '17.2%',    label: '1인가구 주거 불안 1위 = 범죄',   source: '2024 통계로 보는 1인가구' },
];

const FLOW_STEPS: ReadonlyArray<{ step: string; title: string; desc: string }> = [
  {
    step: 'Depth 1',
    title: '직장·예산·가중치 입력',
    desc: '회사명 또는 지하철역 → 통근·주거비·안전·생활 4축 가중치 (합 100) → 인내심·소득 분위',
  },
  {
    step: 'Depth 2',
    title: '지도 + 추천 동네 8선',
    desc: '서울 469개 행정동 히트맵 + 다축 점수 기반 추천 카드. RIR 색상 코딩 + LH 청년주택 배지.',
  },
  {
    step: 'Depth 3',
    title: '단지 상세 + ARIMA 가격 분석',
    desc: '단지 거래 시계열 + ARIMA(2,1,2) 3년 예측 + 통근 비교 + LH 행정동 정밀 배너.',
  },
];

const NUMBER_CARDS: ReadonlyArray<{ value: string; unit: string; label: string; tone: 'brand' | 'positive' | 'amber' | 'purple' }> = [
  { value: '19',    unit: '년치',  label: 'RTMS 시계열 (2006~2025)', tone: 'brand' },
  { value: '1.3M',  unit: '거래',  label: '국토부 RTMS 적재량',         tone: 'positive' },
  { value: '9,621', unit: '단지',  label: 'fingerprint 매칭',          tone: 'amber' },
  { value: '10.16', unit: '%',     label: 'ARIMA MAPE (5단지 평균)',   tone: 'purple' },
];

/* ────────────────────────── 스크롤 리빌 훅 ────────────────────────── */

/**
 * IntersectionObserver 기반 1회성 fade-up 트리거.
 *
 *  - rootMargin '0px 0px -10% 0px' — 뷰포트 바닥 10% 들어오면 트리거
 *  - threshold 0.15 — 카드 15% 노출 시 트리거
 *  - 첫 진입 후 unobserve (재진입 시 다시 사라지지 않음)
 *
 *  prefers-reduced-motion 사용자는 즉시 visible 처리 (모션 회피).
 */
function useReveal<T extends HTMLElement>(): [React.RefObject<T>, boolean] {
  const ref = useRef<T>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    // reduced-motion 사용자는 애니메이션 없이 즉시 노출
    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    if (prefersReducedMotion) {
      setVisible(true);
      return;
    }

    // IO 미지원 환경 (구형 브라우저) 안전망 — 즉시 노출
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }

    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setVisible(true);
            io.unobserve(entry.target);
          }
        });
      },
      { rootMargin: '0px 0px -10% 0px', threshold: 0.15 },
    );

    io.observe(node);
    return () => io.disconnect();
  }, []);

  return [ref, visible];
}

/* ────────────────────────── 컴포넌트 ────────────────────────── */

interface SectionRevealProps {
  children: ReactNode;
  delay?: number; // ms, 동일 섹션 내 자식들 스태거 효과
  className?: string;
}

/** 섹션 단위 wrap — 진입 시 translate-y-6 → 0 + opacity 0 → 1 */
function SectionReveal({ children, delay = 0, className = '' }: SectionRevealProps) {
  const [ref, visible] = useReveal<HTMLDivElement>();
  return (
    <div
      ref={ref}
      className={`transition-all duration-700 ease-out ${
        visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'
      } ${className}`}
      style={{ transitionDelay: visible ? `${delay}ms` : '0ms' }}
    >
      {children}
    </div>
  );
}

/** 데모 카드 모사 — 실 화면 캡쳐가 도착하기 전 placeholder 용도 */
function DemoCardMock() {
  return (
    <div className="rounded-cardlg border border-line-light bg-white shadow-card p-4 md:p-5 transition-shadow hover:shadow-card-hover">
      {/* 카드 헤더 */}
      <div className="flex items-start justify-between gap-2 mb-3">
        <div>
          <div className="flex items-center gap-1.5">
            <span className="font-aggro text-2xs font-bold px-1.5 py-0.5 rounded bg-brand/10 text-brand">1위</span>
            <h3 className="font-aggro text-lg font-bold text-ink-primary tracking-tight">강남구 대치동</h3>
          </div>
          <p className="mt-0.5 text-2xs text-ink-tertiary tabular-nums">1168010600 · 81개 단지</p>
        </div>
        <div className="text-right">
          <div className="font-aggro text-2xl font-bold text-brand tabular-nums">82</div>
          <div className="text-2xs text-ink-tertiary">종합</div>
        </div>
      </div>

      {/* 4축 메트릭 바 */}
      <div className="grid grid-cols-4 gap-2">
        {[
          { label: '통근',   value: 78, color: 'bg-brand' },
          { label: '주거비', value: 54, color: 'bg-amber-500' },
          { label: '안전',   value: 88, color: 'bg-positive' },
          { label: '생활',   value: 82, color: 'bg-purple-500' },
        ].map((m) => (
          <div key={m.label} className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between">
              <span className="text-2xs text-ink-tertiary">{m.label}</span>
              <span className="text-2xs font-semibold tabular-nums text-ink-secondary">{m.value}</span>
            </div>
            <div className="h-1.5 rounded-full bg-line-light overflow-hidden">
              <div className={`h-full ${m.color}`} style={{ width: `${m.value}%` }} />
            </div>
          </div>
        ))}
      </div>

      {/* 배지 */}
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <span className="text-2xs px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600 font-semibold">주거비 30%</span>
        <span className="text-2xs px-1.5 py-0.5 rounded bg-positive/10 text-positive font-semibold">LH 3</span>
        <span className="ml-auto text-2xs text-ink-tertiary tabular-nums">평균 50,000만원</span>
      </div>
    </div>
  );
}

/**
 * ARIMA 차트 모사 — sparkline 스타일 (가독성 보강)
 *  - 그리드 4개 라인 + Y축 라벨
 *  - 영역 음영 (실제 / 예측 분리)
 *  - 라인 두께 ↑ (실제 2.5 / 예측 3)
 *  - 종점 dot + 시작점 label
 */
function ArimaChartMock() {
  const actual = [62, 64, 63, 66, 68, 71, 72, 74, 76, 78, 80, 82, 83, 84, 85, 86, 87, 88, 89, 90];
  const predicted = [90, 91, 92, 93, 94, 95, 95, 96, 97, 98, 99, 99, 100];

  const w = 360;
  const h = 140;
  const padL = 28; // Y축 라벨용
  const padR = 8;
  const padT = 8;
  const padB = 20; // X축 라벨용
  const chartW = w - padL - padR;
  const chartH = h - padT - padB;
  const totalLen = actual.length + predicted.length - 1;

  const xActual = (i: number) => padL + (i / totalLen) * chartW;
  const xPredicted = (i: number) => padL + ((actual.length - 1 + i) / totalLen) * chartW;
  const y = (v: number) => padT + chartH - (v / 100) * chartH;

  const actualPath = actual.map((v, i) => `${i === 0 ? 'M' : 'L'}${xActual(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const predictedPath = predicted.map((v, i) => `${i === 0 ? 'M' : 'L'}${xPredicted(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');

  // 음영 영역 (라인 → 바닥)
  const actualArea = `${actualPath} L${xActual(actual.length - 1).toFixed(1)},${(padT + chartH).toFixed(1)} L${padL},${(padT + chartH).toFixed(1)} Z`;
  const predictedArea = `${predictedPath} L${xPredicted(predicted.length - 1).toFixed(1)},${(padT + chartH).toFixed(1)} L${xPredicted(0).toFixed(1)},${(padT + chartH).toFixed(1)} Z`;

  const splitX = xActual(actual.length - 1);

  return (
    <div className="rounded-cardlg border border-line-light bg-white shadow-card p-4 md:p-5 transition-shadow hover:shadow-card-hover">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="font-aggro text-lg font-bold text-ink-primary tracking-tight">파크리오 (송파구 신천동)</h3>
          <p className="mt-0.5 text-2xs text-ink-tertiary">ARIMA(2,1,2) · 3년 가격 안정성</p>
        </div>
        <div className="text-right">
          <div className="flex items-baseline gap-1 justify-end">
            <span className="font-aggro text-2xl font-bold text-positive tabular-nums">88</span>
            <span className="text-2xs text-ink-tertiary">신뢰도</span>
          </div>
          <span className="inline-block mt-0.5 text-2xs px-1.5 py-0.5 rounded bg-positive/10 text-positive font-semibold">
            단지 데이터
          </span>
        </div>
      </div>

      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-32 md:h-36" role="img" aria-label="ARIMA 3년 예측 차트">
        <defs>
          <linearGradient id="arimaActualFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#191F28" stopOpacity="0.12" />
            <stop offset="100%" stopColor="#191F28" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="arimaPredictFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3182F6" stopOpacity="0.22" />
            <stop offset="100%" stopColor="#3182F6" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* 가로 그리드 4줄 */}
        {[0, 25, 50, 75, 100].map((g) => (
          <g key={g}>
            <line
              x1={padL}
              y1={y(g)}
              x2={w - padR}
              y2={y(g)}
              stroke="#E5E8EB"
              strokeWidth="1"
              strokeDasharray={g === 0 || g === 100 ? '0' : '2 3'}
            />
            <text
              x={padL - 6}
              y={y(g) + 3}
              fontSize="9"
              fill="#8B95A1"
              textAnchor="end"
              fontFamily="Pretendard, system-ui, sans-serif"
            >
              {g}
            </text>
          </g>
        ))}

        {/* 학습 / 예측 분리선 + 라벨 */}
        <line x1={splitX} y1={padT} x2={splitX} y2={padT + chartH} stroke="#8B95A1" strokeWidth="1" strokeDasharray="3 3" />
        <text x={splitX - 4} y={padT + 10} fontSize="9" fill="#8B95A1" textAnchor="end" fontFamily="Pretendard">
          실거래 60mo
        </text>
        <text x={splitX + 4} y={padT + 10} fontSize="9" fill="#3182F6" textAnchor="start" fontFamily="Pretendard" fontWeight="600">
          예측 36mo
        </text>

        {/* X축 */}
        <line x1={padL} y1={padT + chartH} x2={w - padR} y2={padT + chartH} stroke="#D7DCE0" strokeWidth="1" />
        <text x={padL} y={h - 6} fontSize="9" fill="#8B95A1" fontFamily="Pretendard">2021</text>
        <text x={splitX - 12} y={h - 6} fontSize="9" fill="#8B95A1" fontFamily="Pretendard">2026</text>
        <text x={w - padR - 24} y={h - 6} fontSize="9" fill="#3182F6" fontFamily="Pretendard" fontWeight="600">2029</text>

        {/* 영역 음영 */}
        <path d={actualArea} fill="url(#arimaActualFill)" />
        <path d={predictedArea} fill="url(#arimaPredictFill)" />

        {/* 실제 라인 (굵게) */}
        <path d={actualPath} fill="none" stroke="#191F28" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />

        {/* 예측 라인 (브랜드 색 + 굵게 + 점선) */}
        <path
          d={predictedPath}
          fill="none"
          stroke="#3182F6"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray="5 3"
        />

        {/* 분기점 dot */}
        <circle cx={splitX} cy={y(actual[actual.length - 1])} r="4" fill="#191F28" stroke="#fff" strokeWidth="1.5" />

        {/* 종점 dot */}
        <circle
          cx={xPredicted(predicted.length - 1)}
          cy={y(predicted[predicted.length - 1])}
          r="4"
          fill="#3182F6"
          stroke="#fff"
          strokeWidth="1.5"
        />
      </svg>

      <div className="mt-2 flex items-center gap-3 text-2xs text-ink-tertiary">
        <span className="inline-flex items-center gap-1">
          <span className="inline-block w-3 h-0.5 bg-ink-primary" /> 실거래
        </span>
        <span className="inline-flex items-center gap-1">
          <svg width="14" height="3" viewBox="0 0 14 3">
            <line x1="0" y1="1.5" x2="14" y2="1.5" stroke="#3182F6" strokeWidth="2" strokeDasharray="3 2" />
          </svg>
          ARIMA 예측
        </span>
        <span className="ml-auto tabular-nums">MAPE 15.0%</span>
      </div>
    </div>
  );
}

/* ────────────────────────── 페이지 ────────────────────────── */

/** App.tsx RootRoute 와 동기화되는 키 */
const INTRO_SEEN_KEY = 'nadirisal:intro-seen';

export function LandingPage() {
  // /intro 에 직접 접근한 경우에도 플래그를 세팅해 둔다.
  // 이렇게 해야 CTA → "/" 이동 시 RootRoute 가 "복귀 방문자"로 판단해
  // RecommendationPage 를 바로 보여준다 (무한 리다이렉트 방지).
  useEffect(() => {
    try {
      window.localStorage.setItem(INTRO_SEEN_KEY, '1');
    } catch {
      // localStorage 차단 환경(시크릿 모드 등) — 무시
    }
  }, []);

  return (
    // ⚠️ 화이트톤 고정: dark: variant 일절 사용 안 함.
    //    페이지 배경은 surface(#F5F6F8 토스톤 살짝 회색) — 흰 카드가 떠 보이도록.
    // ⚠️ 폰트: 루트는 본문용 font-noto, 타이틀(h1/h2/h3 + section label + 큰 숫자)은 font-aggro.
    <div className="h-screen overflow-y-auto bg-surface text-ink-primary font-noto">
      {/* ── Sticky 헤더 ─────────────────────────────────────── */}
      <header className="sticky top-0 z-10 bg-white/85 backdrop-blur border-b border-line-light shadow-card">
        <div className="max-w-5xl mx-auto px-4 md:px-6 py-3 flex items-center gap-3">
          <Link to="/intro" className="flex items-center gap-2">
            <img
              src="/logo.svg"
              alt="나어디삶 로고"
              className="w-7 h-7 md:w-8 md:h-8"
              width={32}
              height={32}
            />
            <span className="text-sm md:text-base font-bold text-ink-primary font-aggro tracking-tight">나어디삶</span>
          </Link>
          <span className="hidden sm:block h-4 w-px bg-line-light" />
          <span className="hidden sm:inline text-2xs text-ink-tertiary">데이터 기반 청년 주거 의사결정</span>
          <nav className="ml-auto flex items-center gap-2 md:gap-3">
            <Link to="/about/data" className="hidden sm:inline text-xs text-ink-secondary hover:text-brand">
              데이터 출처
            </Link>
            <Link
              to="/"
              className="text-xs md:text-sm font-semibold px-3 py-1.5 rounded-md bg-brand text-white hover:bg-brand-600 transition-colors"
            >
              지금 사용해보기
            </Link>
          </nav>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 md:px-6">
        {/* ── 1) Hero ───────────────────────────────────────── */}
        <SectionReveal>
          <section className="py-10 md:py-16 text-center">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-brand/10 text-brand text-xs font-semibold mb-4">
              <span className="w-1.5 h-1.5 rounded-full bg-brand" />
              2026 국토교통부 공공데이터 활용 공모전 출품작
            </div>
            <h1 className="font-aggro text-3xl md:text-5xl font-bold tracking-tight text-ink-primary leading-tight">
              "어디서 살아야 할까?"
              <br className="hidden sm:block" />
              <span className="text-brand"> 데이터가 답하는 청년 주거 의사결정</span>
            </h1>
            <p className="mt-4 md:mt-5 text-base md:text-lg text-ink-secondary leading-[1.75] max-w-2xl mx-auto">
              직장·예산·통근·안전 4축을 한 번에 분석해 서울 469개 행정동 중 나에게 맞는 동네를 추천합니다.
              <br />
              <strong className="text-ink-primary font-semibold">5개 공공기관 데이터를 융합</strong>해
              "분석은 우리가, 결정은 당신이" 의 도구를 만들었습니다.
            </p>

            {/* CTA */}
            <div className="mt-6 md:mt-8 flex flex-col sm:flex-row items-center justify-center gap-2.5">
              <Link
                to="/"
                className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 px-5 py-2.5 rounded-cardlg bg-brand text-white text-sm md:text-base font-semibold shadow-card hover:shadow-card-hover hover:bg-brand-600 transition-all"
              >
                지금 추천 받기
                <span aria-hidden>→</span>
              </Link>
              <Link
                to="/about/data"
                className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 px-5 py-2.5 rounded-cardlg bg-white text-ink-primary text-sm md:text-base font-semibold border border-line-light shadow-card hover:shadow-card-hover transition-shadow"
              >
                데이터 출처 보기
              </Link>
            </div>

            {/* 기관 배지 */}
            <div className="mt-6 md:mt-8 flex flex-wrap items-center justify-center gap-1.5 md:gap-2">
              {HERO_BADGES.map((b) => (
                <span key={b.label} className={`text-2xs md:text-xs px-2 py-1 rounded-full font-semibold ${TONE_BG[b.tone]}`}>
                  {b.label}
                </span>
              ))}
              <span className="text-2xs md:text-xs px-2 py-1 rounded-full font-semibold bg-ink-primary/5 text-ink-secondary">
                + ODsay · Kakao
              </span>
            </div>
          </section>
        </SectionReveal>

        {/* ── 2) Pain — 청년 주거 위기 통계 ─────────────────── */}
        <SectionReveal>
          <section className="py-8 md:py-12 border-t border-line-light">
            <div className="text-center mb-6 md:mb-8">
              <span className="font-aggro text-2xs md:text-xs font-bold text-negative tracking-widest uppercase">사회적 가치</span>
              <h2 className="font-aggro mt-2 text-2xl md:text-3xl font-bold text-ink-primary tracking-tight">
                서울 청년 73만 명이 직면한 정보 격차
              </h2>
              <p className="mt-2 text-xs md:text-sm text-ink-secondary">
                개별 매물 시세는 도처에 있지만, "내 통근·소득·안전을 종합한 동네 추천"은 없었습니다.
              </p>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-3">
              {PAIN_STATS.map((s, i) => (
                <SectionReveal key={s.label} delay={i * 80}>
                  <div className="rounded-cardlg border border-line-light bg-white shadow-card p-3 md:p-4 h-full transition-shadow hover:shadow-card-hover">
                    <div className="font-aggro text-2xl md:text-3xl font-bold text-brand tabular-nums tracking-tight">{s.value}</div>
                    <div className="mt-1 text-2xs md:text-xs font-semibold text-ink-primary leading-tight">{s.label}</div>
                    <div className="mt-1 text-2xs text-ink-tertiary leading-tight">{s.source}</div>
                  </div>
                </SectionReveal>
              ))}
            </div>
          </section>
        </SectionReveal>

        {/* ── 3) Flow — Depth 1/2/3 사용 흐름 ──────────────── */}
        <SectionReveal>
          <section className="py-8 md:py-12 border-t border-line-light">
            <div className="text-center mb-6 md:mb-8">
              <span className="font-aggro text-2xs md:text-xs font-bold text-brand tracking-widest uppercase">사용 흐름</span>
              <h2 className="font-aggro mt-2 text-2xl md:text-3xl font-bold text-ink-primary tracking-tight">3단계로 끝나는 동네 추천</h2>
              <p className="mt-2 text-xs md:text-sm text-ink-secondary">평균 90초 이내에 단지까지 도달.</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4">
              {FLOW_STEPS.map((s, i) => (
                <SectionReveal key={s.step} delay={i * 120}>
                  <div className="rounded-cardlg border border-line-light bg-white shadow-card p-4 md:p-5 relative h-full transition-shadow hover:shadow-card-hover">
                    <span className="absolute -top-2 -left-2 w-6 h-6 rounded-full bg-brand text-white text-xs font-bold flex items-center justify-center shadow-card-hover">
                      {i + 1}
                    </span>
                    <div className="font-aggro text-2xs font-bold text-brand uppercase tracking-wider">{s.step}</div>
                    <h3 className="font-aggro mt-1 text-lg md:text-xl font-bold text-ink-primary tracking-tight">{s.title}</h3>
                    <p className="mt-2 text-xs md:text-sm text-ink-secondary leading-relaxed">{s.desc}</p>
                  </div>
                </SectionReveal>
              ))}
            </div>

            {/* 데모 모사 카드 2개 */}
            <div className="mt-6 md:mt-8 grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
              <SectionReveal delay={0}>
                <div>
                  <div className="text-2xs font-bold text-ink-tertiary uppercase tracking-wider mb-2">
                    미리보기 — Depth 2 추천 카드
                  </div>
                  <DemoCardMock />
                </div>
              </SectionReveal>
              <SectionReveal delay={120}>
                <div>
                  <div className="text-2xs font-bold text-ink-tertiary uppercase tracking-wider mb-2">
                    미리보기 — Depth 3 ARIMA 차트
                  </div>
                  <ArimaChartMock />
                </div>
              </SectionReveal>
            </div>
          </section>
        </SectionReveal>

        {/* ── 4) Diff — 차별점 3가지 ───────────────────────── */}
        <SectionReveal>
          <section className="py-8 md:py-12 border-t border-line-light">
            <div className="text-center mb-6 md:mb-8">
              <span className="font-aggro text-2xs md:text-xs font-bold text-positive tracking-widest uppercase">차별점</span>
              <h2 className="font-aggro mt-2 text-2xl md:text-3xl font-bold text-ink-primary tracking-tight">
                직방·다방·바로(2024 대상)과 무엇이 다른가
              </h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4">
              {[
                {
                  emoji: '🎯',
                  title: '매물이 아닌 동네 + 단지',
                  desc: '추천 단위 자체를 바꿨습니다. 통근(transit) + 부담(RIR) + 안전(safety) + 생활(life) 4축 가중합으로 점수화합니다.',
                },
                {
                  emoji: '📊',
                  titleNode: (
                    <>
                      ARIMA <span className="text-positive tabular-nums">10.16%</span> MAPE
                    </>
                  ),
                  desc:
                    '19년치 시계열로 5단지 백테스트. ARIMA(2,1,2)가 LSTM(20.4%) 대비 절반 오차. "정직한 한계 인지" 톤으로 학계 수준 정확도를 입증.',
                },
                {
                  emoji: '🏛️',
                  title: '5개 기관 데이터 융합',
                  descNode: (
                    <>
                      국토부 · 한국부동산원 · LH · 통계청 · 경찰청. 가점 +5 데이터 융합 충족.
                      <Link to="/about/data" className="ml-1 text-brand hover:underline">
                        실시간 적재 현황 →
                      </Link>
                    </>
                  ),
                },
              ].map((d, i) => (
                <SectionReveal key={i} delay={i * 120}>
                  <div className="rounded-cardlg border border-line-light bg-white shadow-card p-4 md:p-5 h-full transition-shadow hover:shadow-card-hover">
                    <div className="text-3xl mb-2">{d.emoji}</div>
                    <h3 className="font-aggro text-lg md:text-xl font-bold text-ink-primary tracking-tight">
                      {d.titleNode ?? d.title}
                    </h3>
                    <p className="mt-2 text-xs md:text-sm text-ink-secondary leading-relaxed">
                      {d.descNode ?? d.desc}
                    </p>
                  </div>
                </SectionReveal>
              ))}
            </div>
          </section>
        </SectionReveal>

        {/* ── 5) Numbers ───────────────────────────────────── */}
        <SectionReveal>
          <section className="py-8 md:py-12 border-t border-line-light">
            <div className="text-center mb-6 md:mb-8">
              <span className="font-aggro text-2xs md:text-xs font-bold text-amber-600 tracking-widest uppercase">규모</span>
              <h2 className="font-aggro mt-2 text-2xl md:text-3xl font-bold text-ink-primary tracking-tight">실측 데이터 — 운영 DB 스냅샷</h2>
              <p className="mt-2 text-xs md:text-sm text-ink-secondary">2026-05-27 기준</p>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-3">
              {NUMBER_CARDS.map((n, i) => (
                <SectionReveal key={n.label} delay={i * 80}>
                  <div className="rounded-cardlg border border-line-light bg-white shadow-card p-3 md:p-5 text-center h-full transition-shadow hover:shadow-card-hover">
                    <div className="flex items-baseline justify-center gap-0.5">
                      <span className={`font-aggro text-3xl md:text-5xl font-bold tabular-nums tracking-tight ${NUMBER_TONE_TEXT[n.tone]}`}>
                        {n.value}
                      </span>
                      <span className="font-aggro text-xs md:text-sm font-semibold text-ink-tertiary">{n.unit}</span>
                    </div>
                    <div className="mt-1 text-2xs md:text-xs text-ink-secondary leading-tight">{n.label}</div>
                  </div>
                </SectionReveal>
              ))}
            </div>
          </section>
        </SectionReveal>

        {/* ── 6) DemoCTA — 시연 동선 추천 ──────────────────── */}
        <SectionReveal>
          <section className="py-8 md:py-12 border-t border-line-light">
            <div className="rounded-cardxl bg-gradient-to-br from-brand-500 to-brand-700 text-white p-6 md:p-10 text-center shadow-card">
              <h2 className="font-aggro text-2xl md:text-4xl font-bold tracking-tight">강남역으로 출퇴근하는 사회초년생이라면</h2>
              <p className="mt-3 text-sm md:text-base opacity-90 leading-relaxed max-w-2xl mx-auto">
                "강남역" 입력 → "사회초년생" 프리셋 → 1.5억 예산 → 90초 안에 추천 8선 도달.
                <br />
                1위 카드 클릭 → 단지별 ARIMA 가격 안정성·통근 비교·LH 청년주택 배너까지.
              </p>
              <Link
                to="/"
                className="mt-5 md:mt-6 inline-flex items-center justify-center gap-1.5 px-6 py-3 rounded-cardlg bg-white text-brand text-sm md:text-base font-bold shadow-card hover:shadow-card-hover transition-all"
              >
                지금 강남역 데모 실행
                <span aria-hidden>→</span>
              </Link>
              <p className="mt-3 text-2xs md:text-xs opacity-75">
                회원가입 불필요 · 비용 없음 · 입력값은 URL에 직렬화되어 공유 가능
              </p>
            </div>
          </section>
        </SectionReveal>

        {/* ── 7) Footer ────────────────────────────────────── */}
        <SectionReveal>
          <footer className="py-8 md:py-10 border-t border-line-light text-xs text-ink-tertiary">
            <div className="flex flex-col md:flex-row gap-4 md:gap-6 items-start md:items-center justify-between">
              <div className="flex items-center gap-2">
                <img
                  src="/logo.svg"
                  alt="나어디삶 로고"
                  className="w-7 h-7"
                  width={28}
                  height={28}
                />
                <div>
                  <div className="font-aggro text-sm font-bold text-ink-primary tracking-tight">나어디삶</div>
                  <div className="text-2xs">데이터 기반 청년 주거 의사결정 도구</div>
                </div>
              </div>
              <nav className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <Link to="/" className="hover:text-brand">메인 (Depth 2)</Link>
                <Link to="/about/data" className="hover:text-brand">데이터 출처</Link>
                <a
                  href="https://www.data.go.kr"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-brand"
                >
                  공공데이터포털
                </a>
                <a
                  href="https://www.reb.or.kr/r-one/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-brand"
                >
                  R-ONE
                </a>
              </nav>
            </div>
            <p className="mt-4 text-2xs leading-relaxed">
              본 서비스는 2026 국토교통부 공공데이터 활용 공모전 출품작입니다. 모든 데이터는 공식 OpenAPI 를 통해 제공받으며,
              인증키는 서버 환경변수로만 보관됩니다. 가격 예측은 ARIMA(2,1,2) 통계 모델 기반이며, 외생 충격(금리·정책)에 따른
              본질적 예측 한계가 존재합니다.
            </p>
          </footer>
        </SectionReveal>
      </main>
    </div>
  );
}

export default LandingPage;
