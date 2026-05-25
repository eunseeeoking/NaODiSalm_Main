/**
 * 우측 사이드 메뉴 — 지역 추천 카드 리스트
 *  - 화면 우측 가장자리에 흡착 (부유 위젯 X, 메뉴 톤)
 *  - 라운드·그림자 없음, 좌측 보더 1줄만으로 영역 구분
 *  - 안의 elevated 카드들이 옅은 회색 트레이 위에 떠 있는 시각 구조
 *  - 가중치 슬라이더는 LeftPanel 로 분리됨
 */
import { useRecommendationStore } from '../../../stores/useRecommendationStore';
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
    <div className="h-full flex flex-col overflow-hidden bg-surface dark:bg-surface-dark border-l border-line-light dark:border-line-dark">
      {!workplace ? (
        <div className="p-6 text-center text-sm text-ink-tertiary dark:text-ink-tertiary-dark">
          직장을 입력하면 추천 지역이 표시됩니다.
        </div>
      ) : isEmpty ? (
        <div className="p-3">
          <EmptyState
            suggestions={[
              { patience: 35, count: 2 },
              { patience: 45, count: 7 },
            ]}
          />
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between px-4 pt-3.5 pb-2.5 shrink-0 border-b border-line-light dark:border-line-dark bg-surface-elevated dark:bg-surface-dark-elevated">
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
          <div className="flex-1 overflow-y-auto flex flex-col gap-2.5 p-3">
            {top.map((r, i) => (
              <RegionCard key={r.legalDongCode} region={r} rank={i + 1} />
            ))}
            {hasMore && (
              <button className="py-2.5 mt-1 text-sm font-semibold text-brand bg-brand-50 dark:bg-brand/[.15] rounded-card hover:bg-brand hover:text-white transition-colors">
                전체 {recommendations.length}건 보기 →
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
