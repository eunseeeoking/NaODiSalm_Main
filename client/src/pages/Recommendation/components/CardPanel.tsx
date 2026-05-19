/**
 * 우측 카드 패널 (토스 한국형 톤)
 *  - 가중치 슬라이더 (상단) + 추천 카드 8건 (본문)
 *  - 모든 라벨 한글
 */
import { useRecommendationStore } from '../../../stores/useRecommendationStore';
import { WeightSliders } from './WeightSliders';
import { RegionCard } from './RegionCard';
import { EmptyState } from './EmptyState';

const TOP_N = 8;

export function CardPanel() {
  const workplace = useRecommendationStore((s) => s.workplace);
  const recommendations = useRecommendationStore((s) => s.recommendations);

  const isEmpty = workplace != null && recommendations.length === 0;
  const top = recommendations.slice(0, TOP_N);
  const hasMore = recommendations.length > TOP_N;

  return (
    <div className="w-[340px] shrink-0 flex flex-col gap-3 overflow-hidden">
      <WeightSliders />

      {!workplace ? (
        <div className="bg-surface-elevated dark:bg-surface-dark-elevated border border-line-light dark:border-line-dark rounded-cardlg p-6 text-center text-sm text-ink-tertiary dark:text-ink-tertiary-dark shadow-card">
          직장을 입력하면 추천 지역이 표시됩니다.
        </div>
      ) : isEmpty ? (
        <EmptyState
          suggestions={[
            { patience: 35, count: 2 },
            { patience: 45, count: 7 },
          ]}
        />
      ) : (
        <>
          <div className="flex items-center justify-between px-1">
            <span className="text-sm text-ink-secondary dark:text-ink-secondary-dark font-medium">
              추천 지역{' '}
              <span className="text-ink-primary dark:text-ink-primary-dark font-bold tabular-nums">
                {recommendations.length}건
              </span>
            </span>
            <span className="text-xs text-ink-tertiary dark:text-ink-tertiary-dark">
              종합점수 순
            </span>
          </div>
          <div className="flex-1 overflow-y-auto flex flex-col gap-2.5 pr-1 pb-1">
            {top.map((r, i) => (
              <RegionCard key={r.legalDongCode} region={r} rank={i + 1} />
            ))}
            {hasMore && (
              <button className="py-2.5 mt-1 text-sm font-semibold text-brand border border-line-light dark:border-line-dark rounded-card hover:bg-brand-50 dark:hover:bg-brand/10 hover:border-brand/40 transition-colors">
                전체 {recommendations.length}건 보기 →
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
