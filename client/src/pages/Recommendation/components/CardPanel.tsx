/**
 * 우측 사이드 메뉴 — 지역 추천 카드 리스트
 *  - 화면 우측 가장자리에 흡착 (부유 위젯 X, 메뉴 톤)
 *  - 라운드·그림자 없음, 좌측 보더 1줄만으로 영역 구분
 *  - 안의 elevated 카드들이 옅은 회색 트레이 위에 떠 있는 시각 구조
 *  - 가중치 슬라이더는 LeftPanel 로 분리됨
 */
import { useRecommendationStore } from '../../../stores/useRecommendationStore';
import { BUDGET_SLIDER } from '../../../types/recommendation';
import { RegionCard } from './RegionCard';
import { EmptyState } from './EmptyState';

const TOP_N = 8;

export function CardPanel() {
  const workplace = useRecommendationStore((s) => s.workplace);
  const recommendations = useRecommendationStore((s) => s.recommendations);
  const isLoading = useRecommendationStore((s) => s.isLoading);
  const budgetFilteredCount = useRecommendationStore((s) => s.budgetFilteredCount);
  const budget = useRecommendationStore((s) => s.budget);
  const setBudget = useRecommendationStore((s) => s.setBudget);
  const dealType = useRecommendationStore((s) => s.dealType);

  const isEmpty = workplace != null && recommendations.length === 0;
  const top = recommendations.slice(0, TOP_N);
  const hasMore = recommendations.length > TOP_N;

  // 예산 상한 1.5배(천만 단위), 거래유형별 슬라이더 최대(=무제한)로 클램프
  const budgetMax = BUDGET_SLIDER[dealType].max;
  const bumpedBudget = Math.min(budgetMax, Math.round((budget * 1.5) / 1000) * 1000);
  const canRaiseBudget = bumpedBudget > budget;
  // MONTHLY 는 보증금·월세 두 한도가 섞여 제외될 수 있으므로 '예산' 으로 일반화
  const budgetWhat =
    dealType === 'SALE' ? '매매가' : dealType === 'MONTHLY' ? '예산' : '보증금';

  return (
    <div className="h-full flex flex-col overflow-hidden bg-surface dark:bg-surface-dark border-l border-line-light dark:border-line-dark">
      {!workplace ? (
        <div className="p-6 text-center text-sm text-ink-tertiary dark:text-ink-tertiary-dark">
          직장을 입력하면 추천 지역이 표시됩니다.
        </div>
      ) : isLoading ? (
        <>
          <div className="flex items-center gap-2 px-4 pt-3.5 pb-2.5 shrink-0 border-b border-line-light dark:border-line-dark bg-surface-elevated dark:bg-surface-dark-elevated">
            <span
              className="w-3.5 h-3.5 rounded-full border-2 border-brand/30 border-t-brand animate-spin"
              aria-hidden="true"
            />
            <span className="text-sm text-ink-secondary dark:text-ink-secondary-dark font-medium">
              추천 지역 조회 중…
            </span>
          </div>
          <div className="flex-1 overflow-y-auto flex flex-col gap-2.5 p-3" aria-busy="true">
            {Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                className="rounded-cardlg p-4 border border-line-light dark:border-line-dark bg-surface-elevated dark:bg-surface-dark-elevated animate-pulse"
              >
                <div className="flex items-center gap-2 mb-3">
                  <div className="h-5 w-8 rounded-full bg-line-light dark:bg-line-dark" />
                  <div className="h-4 flex-1 rounded bg-line-light dark:bg-line-dark" />
                </div>
                <div className="h-7 w-16 rounded bg-line-light dark:bg-line-dark mb-3" />
                <div className="grid grid-cols-4 gap-2.5">
                  {Array.from({ length: 4 }).map((__, j) => (
                    <div key={j} className="h-1.5 rounded-full bg-line-light dark:bg-line-dark" />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      ) : isEmpty ? (
        <div className="p-3">
          <EmptyState />
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
            {/* 예산 초과로 숨겨진 후보 안내 — budgetFilteredCount > 0 일 때만 */}
            {budgetFilteredCount > 0 && (
              <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-card bg-amber-500/10 text-amber-700 dark:text-amber-300 text-xs">
                <span>
                  {budgetWhat} 한도 초과로{' '}
                  <span className="font-bold tabular-nums">{budgetFilteredCount}곳</span> 숨김
                </span>
                {canRaiseBudget && (
                  <button
                    onClick={() => setBudget(bumpedBudget)}
                    className="shrink-0 font-semibold text-amber-700 dark:text-amber-300 hover:underline"
                  >
                    한도 늘리기
                  </button>
                )}
              </div>
            )}
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
