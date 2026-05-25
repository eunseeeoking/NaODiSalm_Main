/**
 * 추천 지역 카드 (토스 한국형 톤)
 *  - 청년·신혼부부 컨셉 (2026-05-22):
 *      4축 라벨: 통근 / 부담 / 안전 / 생활
 *      1위 카드 메트릭: 통근 / 가격 / 주거비N% (수익률 직설 제거)
 *  - 1위: 브랜드 보더 2px + lift 그림자 + 4축 막대
 *  - 2위 이하: 컴팩트, 호버 시 살짝 lift
 *  - 호버 시 hoveredRegion 스토어 갱신 → 지도 핀 강조 연동
 */
import { useNavigate } from 'react-router-dom';
import { useRecommendationStore } from '../../../stores/useRecommendationStore';
import { InfoTooltip } from '../../../components/InfoTooltip';
import type { RegionRecommendation } from '../../../types/recommendation';

interface Props {
  region: RegionRecommendation;
  rank: number;
}

function formatEok(manwon: number): string {
  const eok = (manwon / 10000).toFixed(1).replace(/\.0$/, '');
  return `${eok}억`;
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

const METRIC_BARS: ReadonlyArray<{
  label: string;
  key: keyof Pick<
    RegionRecommendation,
    'commuteScore' | 'affordabilityScore' | 'safetyScore' | 'lifeScore'
  >;
}> = [
  { label: '통근', key: 'commuteScore' },
  { label: '부담', key: 'affordabilityScore' },
  { label: '안전', key: 'safetyScore' },
  { label: '생활', key: 'lifeScore' },
];

export function RegionCard({ region, rank }: Props) {
  const navigate = useNavigate();
  const hoveredRegion = useRecommendationStore((s) => s.hoveredRegion);
  const setHovered = useRecommendationStore((s) => s.setHovered);
  const isHovered = hoveredRegion === region.legalDongCode;
  const isTop = rank === 1;

  const goToDetail = () => navigate(`/region/${region.legalDongCode}`);

  // RIR 산출: 서버 응답값 우선, 없으면 클라이언트 추정
  const rir = region.rir ?? estimateRir(region.representativePrice);
  const rirPct = Math.round(rir * 100);
  const rirColorClass = getRirColorClass(rir);

  const base = 'rounded-cardlg p-4 transition-all cursor-pointer relative';
  const color = isTop
    ? 'bg-surface-elevated dark:bg-surface-dark-elevated border-2 border-brand shadow-card-hover'
    : isHovered
    ? 'bg-surface-elevated dark:bg-surface-dark-elevated border border-brand/40 shadow-card-hover -translate-y-px'
    : 'bg-surface-elevated dark:bg-surface-dark-elevated border border-line-light dark:border-line-dark shadow-card hover:shadow-card-hover hover:-translate-y-px';

  return (
    <div
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
      className={`${base} ${color}`}
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
            <span>
              <span className="text-ink-tertiary dark:text-ink-tertiary-dark mr-1">통근</span>
              <span className="font-semibold text-ink-primary dark:text-ink-primary-dark">
                {region.commuteMinutes}분
              </span>
            </span>
            <span>
              <span className="text-ink-tertiary dark:text-ink-tertiary-dark mr-1">가격</span>
              <span className="font-semibold text-ink-primary dark:text-ink-primary-dark">
                {formatEok(region.representativePrice)}
              </span>
            </span>
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

          {/* 4축 막대 */}
          <div className="grid grid-cols-4 gap-2.5">
            {METRIC_BARS.map((m) => (
              <div key={m.label}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-ink-tertiary dark:text-ink-tertiary-dark font-medium">
                    {m.label}
                  </span>
                  <span className="text-xs text-ink-secondary dark:text-ink-secondary-dark tabular-nums font-semibold">
                    {region[m.key]}
                  </span>
                </div>
                <div className="h-1 bg-surface dark:bg-surface-dark rounded-full overflow-hidden">
                  <div
                    className="h-full bg-brand rounded-full transition-all"
                    style={{ width: `${region[m.key]}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
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
            <span>
              <span className="text-ink-tertiary dark:text-ink-tertiary-dark">통근</span>{' '}
              {region.commuteMinutes}분
            </span>
            <span>
              <span className="text-ink-tertiary dark:text-ink-tertiary-dark">가격</span>{' '}
              {formatEok(region.representativePrice)}
            </span>
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
        </>
      )}
    </div>
  );
}
