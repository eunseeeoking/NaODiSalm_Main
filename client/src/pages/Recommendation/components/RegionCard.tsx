/**
 * 추천 지역 카드 (토스 한국형 톤)
 *  - 1위: 브랜드 보더 2px + lift 그림자 + 4축 막대
 *  - 2위 이하: 컴팩트, 호버 시 살짝 lift
 *  - 호버 시 hoveredRegion 스토어 갱신 → 지도 핀 강조 연동
 */
import { useNavigate } from 'react-router-dom';
import { useRecommendationStore } from '../../../stores/useRecommendationStore';
import type { RegionRecommendation } from '../../../types/recommendation';

interface Props {
  region: RegionRecommendation;
  rank: number;
}

function formatEok(manwon: number): string {
  const eok = (manwon / 10000).toFixed(1).replace(/\.0$/, '');
  return `${eok}억`;
}

const METRIC_BARS: ReadonlyArray<{
  label: string;
  key: keyof Pick<
    RegionRecommendation,
    'commuteScore' | 'valueScore' | 'investmentScore' | 'lifeScore'
  >;
}> = [
  { label: '통근', key: 'commuteScore' },
  { label: '가성비', key: 'valueScore' },
  { label: '투자', key: 'investmentScore' },
  { label: '생활', key: 'lifeScore' },
];

export function RegionCard({ region, rank }: Props) {
  const navigate = useNavigate();
  const hoveredRegion = useRecommendationStore((s) => s.hoveredRegion);
  const setHovered = useRecommendationStore((s) => s.setHovered);
  const isHovered = hoveredRegion === region.legalDongCode;
  const isTop = rank === 1;

  const goToDetail = () => navigate(`/region/${region.legalDongCode}`);

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
      {/* 순위 + 지역명 */}
      <div className="flex items-center gap-2 mb-2">
        <span
          className={
            isTop
              ? 'text-xs font-bold px-2 py-0.5 rounded-full bg-brand text-white shrink-0'
              : 'text-xs font-semibold px-2 py-0.5 rounded-full bg-surface dark:bg-surface-dark-elevated-hover text-ink-secondary dark:text-ink-secondary-dark shrink-0'
          }
        >
          {rank}위
        </span>
        <span className="text-sm font-semibold text-ink-primary dark:text-ink-primary-dark flex-1 truncate">
          {region.displayName}
        </span>
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

          {/* 메트릭 3개 */}
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
            <span>
              <span className="text-ink-tertiary dark:text-ink-tertiary-dark mr-1">수익률</span>
              <span className="font-bold text-positive">+{region.expectedReturn3y}%</span>
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
            <span className="text-positive font-semibold">+{region.expectedReturn3y}%</span>
          </div>
        </>
      )}
    </div>
  );
}
