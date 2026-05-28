/**
 * 가격 안정성 분석 카드 (시안 B)
 *  - 상단: 4축 메트릭 (현재 / 1년 / 3년 / 3년 가격 변동성)
 *  - 본문: 시계열 라인 차트 (과거 60개월 + 예측 36개월 + 신뢰구간 음영)
 *  - 우측: 신뢰도 도넛
 *
 *  ▷ Chart.js 사용
 *  ▷ 토스 한국형 톤 (Pretendard, 브랜드 블루)
 *  ▷ 다크 모드 대응 — useThemeStore 구독으로 차트 색상 동기화
 *  ▷ "투자 수익률" 표현 제거 — 가격 안정성 지표로 재정의 (컨셉 전환 2026-05-24)
 */
import { useEffect, useMemo, useRef } from 'react';
import { InfoTooltip } from '../../../components/InfoTooltip';
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
import type { ChartData, ChartDataset } from 'chart.js';
import { Line, Doughnut } from 'react-chartjs-2';
import type { AptComplex, LstmAnalysis, ArimaAnalysis, ConfidenceDataScope } from '../../../types/region-detail';
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
  /** LSTM 분석 (보조 — 변동성 참고용) */
  lstm: LstmAnalysis | null;
  /** ARIMA 분석 (메인 모델 — 백테스트 MAPE 10.16%) */
  arima?: ArimaAnalysis | null;
}

function formatManwon(v: number): string {
  return v.toLocaleString();
}

function formatPyMillion(perM2: number, exclusiveArea: number): string {
  // 전용 면적(m²) 기준 총가 → 억 단위
  const total = perM2 * exclusiveArea;
  return `${(total / 10000).toFixed(1)}억`;
}

/**
 * 신뢰도 데이터 출처 칩 메타 (2026-05-27)
 *  - 도넛 차트 아래에 작은 색상 칩 + 라벨로 표시
 *  - 심사위원·사용자가 "이 신뢰도가 어떤 데이터에 근거하는지" 즉시 인지
 */
const SCOPE_META: Record<ConfidenceDataScope, { label: string; cls: string; }> = {
  COMPLEX:      { label: '단지 데이터',   cls: 'bg-positive/15 text-positive' },
  LEGAL_DONG:   { label: '행정동 평균',   cls: 'bg-brand/15 text-brand' },
  SIGUNGU:      { label: '시군구 평균',   cls: 'bg-amber-500/15 text-amber-600' },
  INSUFFICIENT: { label: '데이터 부족',   cls: 'bg-negative/15 text-negative' },
};

export function PriceStabilityAnalysis({ complex, lstm, arima }: Props) {
  const theme = useThemeStore((s) => s.theme);
  const isDark = theme === 'dark';

  // ARIMA 우선, 없으면 LSTM 폴백 (메인 데이터 소스)
  const primary: LstmAnalysis | ArimaAnalysis | null = arima ?? lstm;

  // 차트 색상 팔레트 (토스 톤)
  const colors = useMemo(
    () => ({
      brand: '#3182F6',          // ARIMA 메인 — 브랜드 블루
      brandSoft: 'rgba(49, 130, 246, 0.12)',
      lstm: '#B0B8C1',           // LSTM 보조 — 중성 회색
      lstmSoft: 'rgba(176, 184, 193, 0.10)',
      ink: isDark ? '#B0B8C1' : '#4E5968',
      grid: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)',
      surface: isDark ? '#1E1E24' : '#FFFFFF',
    }),
    [isDark],
  );

  // ── 메인(ARIMA) 시계열 분할 ───────────────────────────────
  const labels = (primary?.series ?? []).map((p) => p.ym);
  const actuals = (primary?.series ?? []).map((p) => (p.kind === 'actual' ? p.pricePerM2 : null));
  const arimaForecasts = (primary?.series ?? []).map((p) => (p.kind === 'forecast' ? p.pricePerM2 : null));
  const lowers = (primary?.series ?? []).map((p) => p.lower ?? null);
  const uppers = (primary?.series ?? []).map((p) => p.upper ?? null);

  // 과거 마지막 값을 예측 시작점에 연결 (라인 연속성)
  let lastActualIdx = -1;
  for (let i = (primary?.series ?? []).length - 1; i >= 0; i--) {
    if (primary!.series[i].kind === 'actual') { lastActualIdx = i; break; }
  }
  if (lastActualIdx >= 0 && lastActualIdx + 1 < arimaForecasts.length) {
    arimaForecasts[lastActualIdx] = primary!.series[lastActualIdx].pricePerM2;
  }

  // ── LSTM 보조 예측 라인 (arima가 있을 때만 표시) ─────────────
  const lstmForecasts = useMemo(() => {
    if (!arima || !lstm) return null;
    const fcs: (number | null)[] = labels.map(() => null);
    let lastActIdx = -1;
    for (let i = lstm.series.length - 1; i >= 0; i--) {
      if (lstm.series[i].kind === 'actual') { lastActIdx = i; break; }
    }
    lstm.series.forEach((p, i) => {
      if (p.kind === 'forecast') fcs[i] = p.pricePerM2;
    });
    if (lastActIdx >= 0 && lastActIdx + 1 < fcs.length) {
      fcs[lastActIdx] = lstm.series[lastActIdx].pricePerM2;
    }
    return fcs;
  }, [arima, lstm, labels]);

  const datasets: ChartDataset<'line', (number | null)[]>[] = [
    // 신뢰구간 상한 (ARIMA)
    {
      label: '예측 상한',
      data: uppers,
      borderColor: 'transparent',
      backgroundColor: colors.brandSoft,
      pointRadius: 0,
      fill: '+1',
      spanGaps: true,
      order: 4,
    },
    // 신뢰구간 하한 (ARIMA)
    {
      label: '예측 하한',
      data: lowers,
      borderColor: 'transparent',
      backgroundColor: 'transparent',
      pointRadius: 0,
      fill: false,
      spanGaps: true,
      order: 3,
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
    // ARIMA 예측 (메인, 점선)
    {
      label: arima ? 'ARIMA 예측' : 'LSTM 예측',
      data: arimaForecasts,
      borderColor: colors.brand,
      backgroundColor: colors.brand,
      borderWidth: 2,
      borderDash: [5, 4],
      pointRadius: 0,
      tension: 0.2,
      spanGaps: false,
      order: 1,
    },
    // LSTM 보조 (회색, arima 있을 때만)
    ...(lstmForecasts ? [{
      label: 'LSTM 변동성',
      data: lstmForecasts,
      borderColor: colors.lstm,
      backgroundColor: colors.lstm,
      borderWidth: 1.5,
      borderDash: [3, 5],
      pointRadius: 0,
      tension: 0.2,
      spanGaps: false,
      order: 2,
    }] : []),
  ];

  const lineData: ChartData<'line', (number | null)[], string> = { labels, datasets };

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
          filter: (item: { text: string }) => !item.text.startsWith('예측 상') && !item.text.startsWith('예측 하'),
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
        data: [primary?.confidence ?? 50, 100 - (primary?.confidence ?? 50)],
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
    <div className="md:min-h-full rounded-cardlg bg-surface-elevated dark:bg-surface-dark-elevated border border-line-light dark:border-line-dark shadow-card p-3 md:p-4 flex flex-col gap-3 md:gap-4">
      {/* 단지 헤더 */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h3 className="text-base font-bold text-ink-primary dark:text-ink-primary-dark truncate">
            {complex.name}
          </h3>
          <p className="text-xs text-ink-tertiary dark:text-ink-tertiary-dark mt-0.5">
            {complex.exclusiveArea}m² · {complex.sizeBucket} · {complex.ageBucket} ·{' '}
            {complex.builtYear}년 · {complex.households.toLocaleString()}세대
          </p>
        </div>
        <span className="text-xs font-semibold px-2 py-1 rounded bg-brand/10 text-brand shrink-0">
          {arima ? 'ARIMA 가격 안정성' : 'LSTM 시계열 예측'}
        </span>
      </div>

      {/* 4축 메트릭 — 모바일 2x2, 데스크톱 4컬 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Metric
          label="현재 m²당"
          value={`${formatManwon(primary?.currentPricePerM2 ?? 0)}만`}
          sub={`총 ${formatPyMillion(primary?.currentPricePerM2 ?? 0, complex.exclusiveArea)}`}
        />
        <Metric
          label="1년 후"
          value={`${formatManwon(primary?.predicted1yPricePerM2 ?? 0)}만`}
          sub={`총 ${formatPyMillion(primary?.predicted1yPricePerM2 ?? 0, complex.exclusiveArea)}`}
        />
        <Metric
          label="3년 후"
          value={`${formatManwon(primary?.predicted3yPricePerM2 ?? 0)}만`}
          sub={`총 ${formatPyMillion(primary?.predicted3yPricePerM2 ?? 0, complex.exclusiveArea)}`}
        />
        <Metric
          label="3년 변동성"
          value={
            <span className="text-ink-secondary dark:text-ink-secondary-dark">
              {(primary?.expectedReturn3y ?? 0) >= 0 ? '+' : ''}
              {primary?.expectedReturn3y ?? 0}%
            </span>
          }
          sub="가격 변동 지표"
          tooltip="현재 가격 대비 3년 후 예측 가격의 변동률(%). 투자 수익률이 아닌 가격 안정성 참고 지표입니다."
        />
      </div>

      {/* 본문: 차트 + 신뢰도 도넛 — 모바일에선 차트 위, 도넛 아래로 stacking */}
      <div className="flex-1 grid grid-cols-1 md:grid-cols-4 gap-4 min-h-[280px]">
        {/* 라인 차트 (md+: 3컬, 모바일: 풀폭) */}
        <div className="col-span-1 md:col-span-3 min-h-[240px] md:min-h-[280px]">
          <Line key={`line-${isDark}`} data={lineData} options={lineOptions} />
        </div>

        {/* 신뢰도 도넛 (md+: 1컬, 모바일: 풀폭) */}
        <div className="col-span-1 flex flex-col items-center justify-center">
          <div className="text-xs font-semibold text-ink-secondary dark:text-ink-secondary-dark mb-2 flex items-center gap-1 justify-center">
            예측 신뢰도
            <InfoTooltip
              text={
                primary?.confidenceDetail
                  ? `${primary.confidenceDetail} · ${
                      arima
                        ? '회귀 적합도(R²) + 거래 데이터 수 반영. 50~88 범위.'
                        : '학습 MAPE + 샘플 수 기반. 50~95 범위.'
                    }`
                  : '회귀 적합도(R²)와 실거래 데이터 수를 반영한 신뢰 지수.'
              }
              position="top"
            />
          </div>
          <div className="relative w-32 h-32">
            <Doughnut key={`do-${isDark}`} data={doughnutData} options={doughnutOptions} />
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-2xl font-extrabold text-ink-primary dark:text-ink-primary-dark tabular-nums tracking-tight">
                {primary?.confidence ?? 50}
              </span>
              <span className="text-2xs text-ink-tertiary dark:text-ink-tertiary-dark">/ 100</span>
            </div>
          </div>
          {/* 데이터 출처 칩 — 2026-05-27 추가 */}
          {primary?.dataScope && (
            <span
              className={`mt-3 text-2xs font-semibold px-2 py-0.5 rounded-full ${SCOPE_META[primary.dataScope].cls}`}
              title={primary.confidenceDetail}
            >
              {SCOPE_META[primary.dataScope].label}
            </span>
          )}
          <p className="mt-2 text-2xs text-ink-tertiary dark:text-ink-tertiary-dark text-center leading-relaxed">
            {arima ? 'ARIMA(2,1,2)' : 'LSTM'}
            <br />
            과거 실거래 기반
          </p>
        </div>
      </div>

      {/* disclaimer — 정직 톤 (컨셉 전환 핵심) */}
      <p className="text-2xs text-ink-tertiary dark:text-ink-tertiary-dark leading-relaxed border-t border-line-light dark:border-line-dark pt-2">
        {arima?.disclaimer
          ? arima.disclaimer
          : 'ARIMA(2,1,2) 통계 모델 기반. 금리·정책 등 외생 충격(금리·정책)으로 본질적 한계 존재. LSTM 변동성 점수는 보조 지표.'}
      </p>
    </div>
  );
}

interface MetricProps {
  label: string;
  value: React.ReactNode;
  sub: string;
  tooltip?: string;
}

function Metric({ label, value, sub, tooltip }: MetricProps) {
  return (
    <div className="rounded-card bg-surface dark:bg-surface-dark-elevated-hover px-3 py-2.5">
      <div className="text-2xs font-medium text-ink-tertiary dark:text-ink-tertiary-dark flex items-center gap-1">
        {label}
        {tooltip && <InfoTooltip text={tooltip} position="bottom" />}
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
