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
import { useEffect, useMemo, useRef, useState } from 'react';
import { InfoTooltip } from '../../../components/InfoTooltip';
import { TradeHistoryModal } from './TradeHistoryModal';
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

/** 3년 추세 → 정성 라벨 (수익률 숫자 대신 — 공포 제거·거주 프레임). */
function trendLabel(ret3y: number): { label: string; hint: string } {
  if (ret3y >= 5) return { label: '완만한 상승세', hint: '최근 실거래 추세 기준' };
  if (ret3y > -5) return { label: '안정적', hint: '큰 변동 없음' };
  if (ret3y > -15) return { label: '완만한 약세', hint: '매매 시 가격 협상 여지' };
  return { label: '약세 추세', hint: '협상 여지 · 추정 불확실' };
}

/** 신뢰도 → 정성 라벨 (숫자만으론 뭘 하라는지 모호 → 평어). */
function confidenceLabel(c: number): string {
  if (c >= 75) return '높음';
  if (c >= 62) return '보통';
  return '낮음 · 참고만';
}

export function PriceStabilityAnalysis({ complex, lstm, arima }: Props) {
  const theme = useThemeStore((s) => s.theme);
  const isDark = theme === 'dark';

  // ARIMA 우선, 없으면 LSTM 폴백 (메인 데이터 소스)
  const primary: LstmAnalysis | ArimaAnalysis | null = arima ?? lstm;

  const ret3y = primary?.expectedReturn3y ?? 0;
  const trend = trendLabel(ret3y);
  const conf = primary?.confidence ?? 50;
  // 추세 적합도 낮음(신뢰도 낮음) → 점예측을 단정 톤으로 보여주지 않음 (겁주지 않기).
  const uncertain = conf < 62;

  const [showTrades, setShowTrades] = useState(false);
  const complexId = complex.complexId ?? primary?.complexId;

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

  // LSTM 보조선 제거 (2026-06-06): 라이브 LSTM 폐기(2026-05-25) 후 현재가에 평평한
  //   장식선만 남아 "LSTM이 아무것도 안 한다"는 오해를 줘 삭제. LSTM 가치는 백테스트
  //   연구 서사(왜 LSTM이 졌나 2×2)로 이전. 차트는 ARIMA 추세 + 신뢰구간만 표시.

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

      {/* 메트릭 — 현재가 + 추정(저신뢰 시 '추정' 톤) + 가격 흐름(정성, 공포 숫자 대체) */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Metric
          label="현재 m²당"
          value={`${formatManwon(primary?.currentPricePerM2 ?? 0)}만`}
          sub={`총 ${formatPyMillion(primary?.currentPricePerM2 ?? 0, complex.exclusiveArea)}`}
        />
        <Metric
          label="1년 후 (추정)"
          value={
            <span className={uncertain ? 'text-ink-tertiary dark:text-ink-tertiary-dark' : undefined}>
              {uncertain ? '≈' : ''}
              {formatManwon(primary?.predicted1yPricePerM2 ?? 0)}만
            </span>
          }
          sub={uncertain ? '불확실 · 참고만' : `총 ${formatPyMillion(primary?.predicted1yPricePerM2 ?? 0, complex.exclusiveArea)}`}
        />
        <Metric
          label="3년 후 (추정)"
          value={
            <span className={uncertain ? 'text-ink-tertiary dark:text-ink-tertiary-dark' : undefined}>
              {uncertain ? '≈' : ''}
              {formatManwon(primary?.predicted3yPricePerM2 ?? 0)}만
            </span>
          }
          sub={uncertain ? '불확실 · 참고만' : `총 ${formatPyMillion(primary?.predicted3yPricePerM2 ?? 0, complex.exclusiveArea)}`}
        />
        <Metric
          label="가격 흐름"
          value={<span className="text-ink-secondary dark:text-ink-secondary-dark">{trend.label}</span>}
          sub={trend.hint}
          tooltip="최근 실거래 추세의 방향이에요. 투자 수익률이 아니라 거주·협상 참고용이며, 금리·정책 변화로 달라질 수 있습니다."
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
                        ? '추세 적합도(R²)와 실거래 양 기반. 낮을수록 추세가 불안정해 추정을 단정하기 어렵습니다.'
                        : '학습 MAPE + 샘플 수 기반. 낮을수록 추정 불확실.'
                    }`
                  : '추세 적합도(R²)와 실거래 양을 반영한 신뢰 지수. 낮으면 참고용으로만 보세요.'
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
          <span className="mt-2 text-xs font-bold text-ink-primary dark:text-ink-primary-dark">
            신뢰도 {confidenceLabel(conf)}
          </span>
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

      {/* 실거래 원본 보기 — 선택 도우미: 예측 근거 데이터를 그대로 노출 */}
      {complexId && (
        <button
          type="button"
          onClick={() => setShowTrades(true)}
          className="self-start text-xs font-semibold text-brand hover:underline"
        >
          실제 거래 내역 보기 →
        </button>
      )}

      {/* disclaimer — 정직 톤 (컨셉 전환 핵심) */}
      <p className="text-2xs text-ink-tertiary dark:text-ink-tertiary-dark leading-relaxed border-t border-line-light dark:border-line-dark pt-2">
        {arima?.disclaimer
          ? arima.disclaimer
          : '최근 실거래 추세 기반 통계 추정이에요. 금리·정책 등 외생 변수는 반영되지 않아 참고용입니다.'}
      </p>

      {showTrades && complexId && (
        <TradeHistoryModal
          complexId={complexId}
          complexName={complex.name}
          onClose={() => setShowTrades(false)}
        />
      )}
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
