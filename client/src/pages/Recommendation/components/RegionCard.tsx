/**
 * 추천 지역 카드 (토스 한국형 톤)
 *  - 청년·신혼부부 컨셉 (2026-05-22):
 *      4축 라벨: 통근 / 부담 / 안전 / 생활
 *      1위 카드 메트릭: 통근 / 가격 / 주거비N% (수익률 직설 제거)
 *  - 1위: 브랜드 보더 2px + lift 그림자 + 4축 막대
 *  - 2위 이하: 컴팩트, 호버 시 살짝 lift
 *  - 호버 시 hoveredRegion 스토어 갱신 → 지도 핀 강조 연동
 */
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useRecommendationStore } from '../../../stores/useRecommendationStore';
import { InfoTooltip } from '../../../components/InfoTooltip';
import { BUDGET_SLIDER } from '../../../types/recommendation';
import type { RegionRecommendation } from '../../../types/recommendation';

interface Props {
  region: RegionRecommendation;
  rank: number;
}

function formatEok(manwon: number): string {
  const eok = (manwon / 10000).toFixed(1).replace(/\.0$/, '');
  return `${eok}억`;
}

/** 만원 금액 표기 — 1억 이상은 "X억", 미만은 "Y만" (보증금 분리 표기용, KI-9) */
function formatManwon(manwon: number): string {
  if (manwon >= 10000) return formatEok(manwon);
  return `${Math.round(manwon)}만`;
}

/** 가격 기준 간이 RIR (3분위 소득 403만원 기본값, 전세가율 65% × 전환율 4.5%) */
function estimateRir(representativePrice: number): number {
  const monthlyCost = representativePrice * 0.65 * 0.045 / 12;
  return monthlyCost / 403;
}

/**
 * RIR 값에 따른 Tailwind 색상 클래스
 *  ≤30% → 초록(positive) / 30~40% → 노랑(amber) / >40% → 빨강(negative)
 */
function getRirColorClass(rir: number): string {
  if (rir <= 0.30) return 'text-positive';
  if (rir <= 0.40) return 'text-amber-500';
  return 'text-negative';
}

type ScoreAxis = 'commute' | 'affordability' | 'safety' | 'life';

const METRIC_BARS: ReadonlyArray<{
  label: string;
  axis: ScoreAxis;
  key: keyof Pick<
    RegionRecommendation,
    'commuteScore' | 'affordabilityScore' | 'safetyScore' | 'lifeScore'
  >;
}> = [
  { label: '통근', axis: 'commute', key: 'commuteScore' },
  { label: '부담', axis: 'affordability', key: 'affordabilityScore' },
  { label: '안전', axis: 'safety', key: 'safetyScore' },
  { label: '생활', axis: 'life', key: 'lifeScore' },
];

/** 추정축 한글 라벨 (안내 문구용) */
const AXIS_LABEL: Record<ScoreAxis, string> = {
  commute: '통근',
  affordability: '부담',
  safety: '안전',
  life: '생활',
};

export function RegionCard({ region, rank }: Props) {
  const navigate = useNavigate();
  const hoveredRegion = useRecommendationStore((s) => s.hoveredRegion);
  const setHovered = useRecommendationStore((s) => s.setHovered);
  const dealType = useRecommendationStore((s) => s.dealType);
  // 예산 필터 활성 여부 — 슬라이더 '최대'(무제한 센티넬)면 비활성. index.tsx 의 전송 로직과 동일 기준.
  const budget = useRecommendationStore((s) => s.budget);
  const budgetActive = budget < BUDGET_SLIDER[dealType].max;
  // 통근시간: top-8 ODsay 실측(commuteOverrides) 우선, 없으면 서버 Haversine 추정.
  const commuteMin = useRecommendationStore(
    (s) => s.commuteOverrides[region.legalDongCode],
  );
  const isPreciseCommute = commuteMin != null;
  const displayCommute = commuteMin ?? region.commuteMinutes;
  const focusedRegion = useRecommendationStore((s) => s.focusedRegion);
  const focusTick = useRecommendationStore((s) => s.focusTick);
  const isHovered = hoveredRegion === region.legalDongCode;
  const isTop = rank === 1;

  // 지도 핀 클릭 → 해당 카드로 스크롤 + 잠깐 flash (모바일: 핀 탭 후 카드 위치 안내)
  const cardRef = useRef<HTMLDivElement>(null);
  const [flashing, setFlashing] = useState(false);
  const isFocused = focusedRegion === region.legalDongCode;
  useEffect(() => {
    if (!isFocused) return;
    cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    setFlashing(true);
    const t = window.setTimeout(() => setFlashing(false), 1100);
    return () => window.clearTimeout(t);
    // focusTick 으로 같은 핀 재클릭에도 재발화
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusTick]);

  // KI-9: 거래유형별 대표가 분리 표기 (표시 기준 = 필터 기준 일치로 혼동 해소).
  //  · JEONSE  → "보증금 X억"(전세금=보증금 한도 필터와 동일)
  //  · MONTHLY → "월세 X만"(순수 월세=월세 한도 필터와 동일) + 보조 "보증금 Y"
  //  · SALE / 표본부족(sale-proxy) → 기존 "가격 X억"(매매가)
  //  (RIR·주거비%는 별도로 합산 월주거비 monthlyHousingCost 기준 — 다른 개념.)
  const isRentBasis = region.affordabilityBasis === 'rent';
  const hasDeposit = region.rentDepositManwon != null;
  let priceLabel = '가격';
  let priceDisplay = formatEok(region.representativePrice);
  let depositSub: string | null = null;
  if (isRentBasis && dealType === 'MONTHLY' && region.rentPureMonthlyManwon != null) {
    priceLabel = '월세';
    priceDisplay = `${Math.round(region.rentPureMonthlyManwon)}만`;
    if (hasDeposit) depositSub = formatManwon(region.rentDepositManwon as number);
  } else if (isRentBasis && dealType === 'JEONSE' && hasDeposit) {
    priceLabel = '보증금';
    priceDisplay = formatManwon(region.rentDepositManwon as number);
  }

  const goToDetail = () => navigate(`/region/${region.legalDongCode}`);

  // RIR 산출: 서버 응답값 우선, 없으면 클라이언트 추정
  const rir = region.rir ?? estimateRir(region.representativePrice);
  const rirPct = Math.round(rir * 100);
  const rirColorClass = getRirColorClass(rir);

  // P3 #5: 총점 분모에서 제외된 추정 축 (안전·생활 더미)
  const estimatedSet = new Set<ScoreAxis>(region.estimatedAxes ?? []);
  const estimatedLabels = (region.estimatedAxes ?? []).map((a) => AXIS_LABEL[a]);

  // 전월세 표본수 칩 (rent basis 일 때만). 의미가 예산 유무에 따라 달라짐:
  //  · 예산 지정(KI-24 재고 게이트): sampleCount = '예산 이하 실거래 건수' → "예산 내 N건"
  //    칩으로 입소문("여기 N건 있어") 디지털화. 게이트(≥5)라 항상 5건 이상.
  //  · 예산 미지정: sampleCount = 동 전체 표본수 → 기존 "표본 N" 신뢰 칩(P3 #6).
  const sampleCount = isRentBasis ? region.rentSampleCount ?? null : null;
  const lowSample = sampleCount != null && sampleCount < 10;
  // 예산 활성 + rent basis 일 때만 재고(예산 내 N건) 칩으로 전환.
  const isInventoryChip = budgetActive && isRentBasis && sampleCount != null;

  const base = 'rounded-cardlg p-4 transition-all cursor-pointer relative';
  const color = isTop
    ? 'bg-surface-elevated dark:bg-surface-dark-elevated border-2 border-brand shadow-card-hover'
    : isHovered
    ? 'bg-surface-elevated dark:bg-surface-dark-elevated border border-brand/40 shadow-card-hover -translate-y-px'
    : 'bg-surface-elevated dark:bg-surface-dark-elevated border border-line-light dark:border-line-dark shadow-card hover:shadow-card-hover hover:-translate-y-px';

  return (
    <div
      ref={cardRef}
      role="button"
      tabIndex={0}
      onMouseEnter={() => setHovered(region.legalDongCode)}
      onMouseLeave={() => setHovered(null)}
      onClick={goToDetail}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          goToDetail();
        }
      }}
      className={`${base} ${color} ${flashing ? 'card-flash' : ''}`}
      aria-label={`${region.displayName} 상세 페이지로 이동`}
    >
      {/* 순위 + 지역명 + LH 배지 */}
      <div className="flex items-center gap-2 mb-2">
        <span
          className={
            isTop
              ? 'text-xs font-bold px-2 py-0.5 rounded-full bg-brand text-white shrink-0'
              : 'text-xs font-semibold px-2 py-0.5 rounded-full bg-brand-50 dark:bg-brand/[.15] text-brand dark:text-brand-300 shrink-0'
          }
        >
          {rank}위
        </span>
        <span className="text-sm font-semibold text-ink-primary dark:text-ink-primary-dark flex-1 truncate">
          {region.displayName}
        </span>
        {/* 전월세 표본 칩 —
            · 예산 활성: "예산 내 N건"(감당 가능 매물 실재 신호). 표본 충분하면 positive,
              적으면(<10) amber·참고(시세 신뢰도 caveat).
            · 예산 미지정: 기존 "표본 N" 신뢰 칩(적으면 amber·참고). */}
        {sampleCount != null && (
          <span
            title={
              isInventoryChip
                ? lowSample
                  ? `예산 이하 실거래 ${sampleCount}건 — 감당 가능한 매물은 실재하나 표본이 적어 시세는 참고용`
                  : `예산 이하 실거래 ${sampleCount}건 — 감당 가능한 매물이 실재해요`
                : lowSample
                ? `실거래 ${sampleCount}건으로 산출 — 표본이 적어 참고용`
                : `실거래 ${sampleCount}건으로 산출한 동 시세`
            }
            className={
              lowSample
                ? 'shrink-0 text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400'
                : isInventoryChip
                ? 'shrink-0 text-xs font-semibold px-2 py-0.5 rounded-full bg-brand-50 dark:bg-brand/[.15] text-brand dark:text-brand-300'
                : 'shrink-0 text-xs font-semibold px-2 py-0.5 rounded-full bg-surface dark:bg-surface-dark text-ink-tertiary dark:text-ink-tertiary-dark'
            }
          >
            {isInventoryChip
              ? `예산 내 ${sampleCount}건${lowSample ? '·참고' : ''}`
              : `표본 ${sampleCount}${lowSample ? '·참고' : ''}`}
          </span>
        )}
        {/* LH 청년주택 배지 — lhComplexNearby 1개 이상일 때만 노출 */}
        {(region.lhComplexNearby ?? 0) > 0 && (
          <span
            title={`인근 LH 청년주택 ${region.lhComplexNearby}개`}
            className="shrink-0 text-xs font-semibold px-2 py-0.5 rounded-full bg-positive/10 text-positive"
          >
            LH {region.lhComplexNearby}
          </span>
        )}
      </div>

      {isTop ? (
        <>
          {/* 큰 점수 */}
          <div className="flex items-baseline gap-1 mb-3">
            <span className="text-metric-xl text-ink-primary dark:text-ink-primary-dark tabular-nums">
              {region.totalScore}
            </span>
            <span className="text-sm text-ink-tertiary dark:text-ink-tertiary-dark font-medium">
              점
            </span>
          </div>

          {/* 메트릭 3개 (청년 컨셉: 통근 / 가격 / 주거비 부담) */}
          <div className="flex gap-4 text-sm text-ink-secondary dark:text-ink-secondary-dark mb-3.5 tabular-nums flex-wrap">
            <span title={isPreciseCommute ? 'ODsay 실측 대중교통 통근시간' : '직선거리 기반 추정 통근시간'}>
              <span className="text-ink-tertiary dark:text-ink-tertiary-dark mr-1">통근</span>
              <span className="font-semibold text-ink-primary dark:text-ink-primary-dark">
                {displayCommute}분{isPreciseCommute ? '' : '~'}
              </span>
            </span>
            <span>
              <span className="text-ink-tertiary dark:text-ink-tertiary-dark mr-1">{priceLabel}</span>
              <span className="font-semibold text-ink-primary dark:text-ink-primary-dark">
                {priceDisplay}
              </span>
            </span>
            {depositSub && (
              <span>
                <span className="text-ink-tertiary dark:text-ink-tertiary-dark mr-1">보증금</span>
                <span className="font-semibold text-ink-primary dark:text-ink-primary-dark">
                  {depositSub}
                </span>
              </span>
            )}
            <span className="inline-flex items-center gap-1">
              <span className={`font-semibold ${rirColorClass}`}>
                주거비 {rirPct}%
              </span>
              <InfoTooltip
                text="RIR — 월 소득 대비 예상 주거비 비율. ≤30% 안정, 30~40% 주의, 40% 초과 부담."
                position="top"
              />
            </span>
          </div>

          {/* 4축 막대 — 추정 축(안전·생활 더미)은 흐리게 + '추정' 표시, 총점 미반영 */}
          <div className="grid grid-cols-4 gap-2.5">
            {METRIC_BARS.map((m) => {
              const estimated = estimatedSet.has(m.axis);
              return (
                <div key={m.label} className={estimated ? 'opacity-50' : ''}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-ink-tertiary dark:text-ink-tertiary-dark font-medium">
                      {m.label}
                    </span>
                    <span className="text-xs text-ink-secondary dark:text-ink-secondary-dark tabular-nums font-semibold">
                      {estimated ? '추정' : region[m.key]}
                    </span>
                  </div>
                  <div className="h-1 bg-surface dark:bg-surface-dark rounded-full overflow-hidden">
                    <div
                      className={
                        estimated
                          ? 'h-full bg-line-dark/40 rounded-full transition-all'
                          : 'h-full bg-brand rounded-full transition-all'
                      }
                      style={{ width: `${region[m.key]}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          {/* 추정 축 안내 — 더미 데이터라 총점에서 제외했음을 명시 (투명성) */}
          {estimatedLabels.length > 0 && (
            <p className="mt-2.5 text-xs text-ink-tertiary dark:text-ink-tertiary-dark leading-snug">
              {estimatedLabels.join('·')}은 데이터 준비 중이라 종합점수에 반영하지 않았어요.
            </p>
          )}
        </>
      ) : (
        <>
          {/* 컴팩트 */}
          <div className="flex items-baseline gap-1 mb-2">
            <span className="text-metric-lg text-ink-primary dark:text-ink-primary-dark tabular-nums">
              {region.totalScore}
            </span>
            <span className="text-xs text-ink-tertiary dark:text-ink-tertiary-dark font-medium">
              점
            </span>
          </div>
          <div className="flex gap-3 text-xs text-ink-secondary dark:text-ink-secondary-dark tabular-nums flex-wrap">
            <span title={isPreciseCommute ? 'ODsay 실측 대중교통 통근시간' : '직선거리 기반 추정 통근시간'}>
              <span className="text-ink-tertiary dark:text-ink-tertiary-dark">통근</span>{' '}
              {displayCommute}분{isPreciseCommute ? '' : '~'}
            </span>
            <span>
              <span className="text-ink-tertiary dark:text-ink-tertiary-dark">{priceLabel}</span>{' '}
              {priceDisplay}
            </span>
            {depositSub && (
              <span>
                <span className="text-ink-tertiary dark:text-ink-tertiary-dark">보증금</span>{' '}
                {depositSub}
              </span>
            )}
            <span className="inline-flex items-center gap-1">
              <span className={`font-semibold ${rirColorClass}`}>
                주거비 {rirPct}%
              </span>
              <InfoTooltip
                text="RIR — 월 소득 대비 예상 주거비 비율. ≤30% 안정, 30~40% 주의, 40% 초과 부담."
                position="top"
              />
            </span>
          </div>

          {/* 4축 미니 막대 — 실데이터(안전·생활) 변별을 리스트에서도 노출. 라벨은 hover 툴팁. */}
          <div className="mt-2 grid grid-cols-4 gap-1.5" aria-label="통근·부담·안전·생활 점수">
            {METRIC_BARS.map((m) => {
              const estimated = estimatedSet.has(m.axis);
              return (
                <div
                  key={m.label}
                  title={`${m.label} ${estimated ? '추정(총점 미반영)' : region[m.key]}`}
                  className={estimated ? 'opacity-40' : ''}
                >
                  <div className="h-1 bg-surface dark:bg-surface-dark rounded-full overflow-hidden">
                    <div
                      className={
                        estimated
                          ? 'h-full bg-line-dark/40 rounded-full transition-all'
                          : 'h-full bg-brand/70 rounded-full transition-all'
                      }
                      style={{ width: `${region[m.key]}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
