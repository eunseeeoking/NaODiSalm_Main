/**
 * LSTM 풀 분석 카드 (시안 B)
 *  - 상단: 4축 메트릭 (현재 / 1년 / 3년 / 누적 수익률)
 *  - 본문: 시계열 라인 차트 (과거 60개월 + 예측 36개월 + 신뢰구간 음영)
 *  - 우측: 신뢰도 도넛
 *
 *  ▷ Chart.js 사용
 *  ▷ 토스 한국형 톤 (Pretendard, 브랜드 블루, 그린 수익률)
 *  ▷ 다크 모드 대응 — useThemeStore 구독으로 차트 색상 동기화
 */
import { useEffect, useMemo, useRef } from 'react';
import {
  Chart,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip,
  Legend,
  ArcElement,
} from 'chart.js';
import { Line, Doughnut } from 'react-chartjs-2';
import type { AptComplex, LstmAnalysis } from '../../../types/region-detail';
import { useThemeStore } from '../../../stores/useThemeStore';

// Chart.js 전역 등록 (한 번만)
Chart.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip,
  Legend,
  ArcElement,
);

interface Props {
  complex: AptComplex;
  lstm: LstmAnalysis;
}

function formatManwon(v: number): string {
  return v.toLocaleString();
}

function formatPyMillion(perM2: number, exclusiveArea: number): string {
  // 전용 면적(m²) 기준 총가 → 억 단위
  const total = perM2 * exclusiveArea;
  return `${(total / 10000).toFixed(1)}억`;
}

export function LstmFullAnalysis({ complex, lstm }: Props) {
  const theme = useThemeStore((s) => s.theme);
  const isDark = theme === 'dark';

  // 차트 색상 팔레트 (토스 톤)
  const colors = useMemo(
    () => ({
      brand: '#3182F6',
      brandSoft: 'rgba(49, 130, 246, 0.12)',
      forecastSoft: 'rgba(49, 130, 246, 0.06)',
      positive: '#15B970',
      ink: isDark ? '#B0B8C1' : '#4E5968',
      grid: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)',
      surface: isDark ? '#1E1E24' : '#FFFFFF',
    }),
    [isDark],
  );

  // 시계열 분할
  const labels = lstm.series.map((p) => p.ym);
  const actuals = lstm.series.map((p) => (p.kind === 'actual' ? p.pricePerM2 : null));
  const forecasts = lstm.series.map((p) => (p.kind === 'forecast' ? p.pricePerM2 : null));
  const lowers = lstm.series.map((p) => p.lower ?? null);
  const uppers = lstm.series.map((p) => p.upper ?? null);

  // 과거 마지막 값을 예측 시작점에 연결 (라인 연속성)
  // findLastIndex 는 ES2023 — TS lib 보강 대신 역방향 루프로 대체
  let lastActualIdx = -1;
  for (let i = lstm.series.length - 1; i >= 0; i--) {
    if (lstm.series[i].kind === 'actual') {
      lastActualIdx = i;
      break;
    }
  }
  if (lastActualIdx >= 0 && lastActualIdx + 1 < forecasts.length) {
    forecasts[lastActualIdx] = lstm.series[lastActualIdx].pricePerM2;
  }

  const lineData = {
    labels,
    datasets: [
      // 신뢰구간 (upper)
      {
        label: '예측 상한',
        data: uppers,
        borderColor: 'transparent',
        backgroundColor: colors.brandSoft,
        pointRadius: 0,
        fill: '+1',
        spanGaps: true,
        order: 3,
      },
      // 신뢰구간 (lower)
      {
        label: '예측 하한',
        data: lowers,
        borderColor: 'transparent',
        backgroundColor: 'transparent',
        pointRadius: 0,
        fill: false,
        spanGaps: true,
        order: 2,
      },
      // 과거 실거래가
      {
        label: '과거 실거래',
        data: actuals,
        borderColor: colors.brand,
        backgroundColor: colors.brand,
        borderWidth: 2,
        pointRadius: 0,
        tension: 0.2,
        spanGaps: false,
        order: 0,
      },
      // 예측치 (점선)
      {
        label: 'LSTM 예측',
        data: forecasts,
        borderColor: colors.brand,
        backgroundColor: colors.brand,
        borderWidth: 2,
        borderDash: [5, 4],
        pointRadius: 0,
        tension: 0.2,
        spanGaps: false,
        order: 1,
      },
    ],
  };

  const lineOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: true,
        position: 'bottom' as const,
        labels: {
          color: colors.ink,
          font: { family: 'Pretendard Variable', size: 11, weight: 600 as const },
          filter: (item: { text: string }) => !item.text.startsWith('예측 '),
          boxWidth: 10,
          boxHeight: 10,
          padding: 16,
        },
      },
      tooltip: {
        backgroundColor: colors.surface,
        titleColor: isDark ? '#F7F8F9' : '#191F28',
        bodyColor: colors.ink,
        borderColor: isDark ? '#2D2F36' : '#E5E8EB',
        borderWidth: 1,
        padding: 10,
        cornerRadius: 8,
        displayColors: false,
        callbacks: {
          label: (ctx: { parsed: { y: number | null }; dataset: { label?: string } }) => {
            if (ctx.parsed.y == null) return '';
            return `${ctx.dataset.label}: ${ctx.parsed.y.toLocaleString()}만/m²`;
          },
        },
      },
    },
    scales: {
      x: {
        ticks: {
          color: colors.ink,
          font: { family: 'Pretendard Variable', size: 10 },
          maxTicksLimit: 10,
          autoSkip: true,
        },
        grid: { color: colors.grid, drawTicks: false },
      },
      y: {
        ticks: {
          color: colors.ink,
          font: { family: 'Pretendard Variable', size: 10 },
          callback: (v: string | number) => `${Number(v).toLocaleString()}`,
        },
        grid: { color: colors.grid, drawTicks: false },
      },
    },
    interaction: { mode: 'index' as const, intersect: false },
  };

  // 도넛 차트 데이터
  const doughnutData = {
    labels: ['신뢰도', ''],
    datasets: [
      {
        data: [lstm.confidence, 100 - lstm.confidence],
        backgroundColor: [colors.brand, isDark ? '#2D2F36' : '#E5E8EB'],
        borderWidth: 0,
        circumference: 360,
      },
    ],
  };

  const doughnutOptions = {
    responsive: true,
    maintainAspectRatio: false,
    cutout: '72%',
    plugins: { legend: { display: false }, tooltip: { enabled: false } },
  };

  // 다크 모드 전환 시 모든 차트 인스턴스 강제 갱신
  // (Chart.js 캐시 컬러로 인해 toggle 직후 색상이 안 바뀌는 이슈 회피)
  const chartKey = useRef(0);
  useEffect(() => {
    chartKey.current += 1;
  }, [isDark]);

  return (
    <div className="h-full rounded-cardlg bg-surface-elevated dark:bg-surface-dark-elevated border border-line-light dark:border-line-dark shadow-card p-4 flex flex-col gap-4">
      {/* 단지 헤더 */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-bold text-ink-primary dark:text-ink-primary-dark">
            {complex.name}
          </h3>
          <p className="text-xs text-ink-tertiary dark:text-ink-tertiary-dark mt-0.5">
            {complex.exclusiveArea}m² · {complex.sizeBucket} · {complex.ageBucket} ·{' '}
            {complex.builtYear}년 · {complex.households.toLocaleString()}세대
          </p>
        </div>
        <span className="text-xs font-semibold px-2 py-1 rounded bg-brand/10 text-brand">
          LSTM 시계열 예측
        </span>
      </div>

      {/* 4축 메트릭 */}
      <div className="grid grid-cols-4 gap-2">
        <Metric
          label="현재 m²당"
          value={`${formatManwon(lstm.currentPricePerM2)}만`}
          sub={`총 ${formatPyMillion(lstm.currentPricePerM2, complex.exclusiveArea)}`}
        />
        <Metric
          label="1년 후"
          value={`${formatManwon(lstm.predicted1yPricePerM2)}만`}
          sub={`총 ${formatPyMillion(lstm.predicted1yPricePerM2, complex.exclusiveArea)}`}
        />
        <Metric
          label="3년 후"
          value={`${formatManwon(lstm.predicted3yPricePerM2)}만`}
          sub={`총 ${formatPyMillion(lstm.predicted3yPricePerM2, complex.exclusiveArea)}`}
        />
        <Metric
          label="3년 누적"
          value={
            <span className="text-positive">
              {lstm.expectedReturn3y >= 0 ? '+' : ''}
              {lstm.expectedReturn3y}%
            </span>
          }
          sub="예상 수익률"
        />
      </div>

      {/* 본문: 차트 + 신뢰도 도넛 */}
      <div className="flex-1 grid grid-cols-4 gap-4 min-h-[280px]">
        {/* 라인 차트 (3컬) */}
        <div className="col-span-3 min-h-[280px]">
          <Line key={`line-${isDark}`} data={lineData} options={lineOptions} />
        </div>

        {/* 신뢰도 도넛 (1컬) */}
        <div className="col-span-1 flex flex-col items-center justify-center">
          <div className="text-xs font-semibold text-ink-secondary dark:text-ink-secondary-dark mb-2">
            예측 신뢰도
          </div>
          <div className="relative w-32 h-32">
            <Doughnut key={`do-${isDark}`} data={doughnutData} options={doughnutOptions} />
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-2xl font-extrabold text-ink-primary dark:text-ink-primary-dark tabular-nums tracking-tight">
                {lstm.confidence}
              </span>
              <span className="text-2xs text-ink-tertiary dark:text-ink-tertiary-dark">/ 100</span>
            </div>
          </div>
          <p className="mt-3 text-2xs text-ink-tertiary dark:text-ink-tertiary-dark text-center leading-relaxed">
            과거 60개월 거래
            <br />
            기반 LSTM 학습
          </p>
        </div>
      </div>
    </div>
  );
}

interface MetricProps {
  label: string;
  value: React.ReactNode;
  sub: string;
}

function Metric({ label, value, sub }: MetricProps) {
  return (
    <div className="rounded-card bg-surface dark:bg-surface-dark-elevated-hover px-3 py-2.5">
      <div className="text-2xs font-medium text-ink-tertiary dark:text-ink-tertiary-dark">
        {label}
      </div>
      <div className="mt-1 text-base font-bold text-ink-primary dark:text-ink-primary-dark tabular-nums tracking-tight">
        {value}
      </div>
      <div className="mt-0.5 text-2xs text-ink-tertiary dark:text-ink-tertiary-dark tabular-nums">
        {sub}
      </div>
    </div>
  );
}
