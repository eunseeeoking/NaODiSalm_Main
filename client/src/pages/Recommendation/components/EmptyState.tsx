/**
 * 추천 결과 0건 빈 상태 (토스 톤)
 *  - 브랜드 블루 카드 + 자동 제안
 */
import { useRecommendationStore } from '../../../stores/useRecommendationStore';

interface Props {
  suggestions: Array<{ patience: number; count: number }>;
}

export function EmptyState({ suggestions }: Props) {
  const patience = useRecommendationStore((s) => s.patience);
  const setPatience = useRecommendationStore((s) => s.setPatience);
  const best = suggestions.find((s) => s.count > 0);

  return (
    <div className="bg-surface-elevated dark:bg-surface-dark-elevated border border-line-light dark:border-line-dark rounded-cardlg p-6 text-center shadow-card">
      <div className="flex justify-center mb-3">
        <div className="w-14 h-14 rounded-full bg-brand-50 dark:bg-surface-dark-elevated-hover flex items-center justify-center">
          <svg
            width="26"
            height="26"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-brand"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m21 21-4.3-4.3" />
          </svg>
        </div>
      </div>
      <div className="text-base font-bold text-ink-primary dark:text-ink-primary-dark mb-1">
        조건에 맞는 지역이 없어요
      </div>
      <div className="text-sm text-ink-tertiary dark:text-ink-tertiary-dark mb-4">
        통근 인내심{' '}
        <span className="text-ink-primary dark:text-ink-primary-dark font-semibold tabular-nums">
          {patience}분
        </span>{' '}
        기준
      </div>

      {suggestions.length > 0 && (
        <div className="bg-brand-50 dark:bg-brand/[0.12] rounded-card p-3 text-left mb-3 text-sm text-brand-700 dark:text-brand-200 leading-relaxed">
          <div className="flex items-start gap-2">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-brand mt-0.5 shrink-0"
            >
              <path d="M9 18h6" />
              <path d="M10 22h4" />
              <path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 0 1 8.91 14" />
            </svg>
            <div>
              {suggestions.map((s, i) => (
                <span key={s.patience}>
                  인내심을{' '}
                  <span className="font-bold tabular-nums">{s.patience}분</span>으로 늘리면{' '}
                  <span className="font-bold tabular-nums">{s.count}건</span>
                  {i < suggestions.length - 1 ? ', ' : '이 보여요'}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2">
        {best && (
          <button
            onClick={() => setPatience(best.patience)}
            className="px-4 py-2.5 bg-brand hover:bg-brand-600 text-white rounded-card text-sm font-semibold transition-colors"
          >
            인내심 {best.patience}분으로 늘리기
          </button>
        )}
        <button className="px-4 py-2.5 text-sm font-medium text-ink-secondary dark:text-ink-secondary-dark bg-surface dark:bg-surface-dark-elevated-hover rounded-card hover:bg-brand-50 dark:hover:bg-brand/[.15] hover:text-brand dark:hover:text-brand-300 transition-colors">
          예산 조정하기
        </button>
      </div>
    </div>
  );
}
