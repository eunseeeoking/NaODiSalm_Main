/**
 * Depth 2 상단 헤더 (토스 한국형 톤)
 *  - 로고 + 직장 검색 + 예산 슬라이더 + 테마 토글 + /explore 링크
 *  - 모든 라벨 한글
 */
import { Link } from 'react-router-dom';
import { useRecommendationStore } from '../../../stores/useRecommendationStore';
import { useThemeStore } from '../../../stores/useThemeStore';
import { WorkplaceSearch } from './WorkplaceSearch';

function formatBudget(manwon: number): string {
  return `${(manwon / 10000).toFixed(1).replace(/\.0$/, '')}억`;
}

export function RecommendationHeader() {
  const budget = useRecommendationStore((s) => s.budget);
  const setBudget = useRecommendationStore((s) => s.setBudget);
  const theme = useThemeStore((s) => s.theme);
  const toggleTheme = useThemeStore((s) => s.toggle);

  return (
    <header className="bg-surface-elevated dark:bg-surface-dark-elevated border-b border-line-light dark:border-line-dark px-5 py-3 flex items-center gap-3 shadow-card">
      <h1 className="text-lg font-extrabold text-ink-primary dark:text-ink-primary-dark tracking-tight shrink-0">
        스마트 직세권
      </h1>
      <div className="h-4 w-px bg-line-light dark:bg-line-dark shrink-0" />

      <div className="flex-1 max-w-2xl">
        <WorkplaceSearch />
      </div>

      {/* 예산 슬라이더 */}
      <div className="flex items-center gap-2.5 px-3 py-1.5 bg-surface dark:bg-surface-dark-elevated-hover border border-line-light dark:border-line-dark rounded-card shrink-0">
        <span className="text-xs text-ink-tertiary dark:text-ink-tertiary-dark font-medium">
          예산
        </span>
        <input
          type="range"
          min={20000}
          max={150000}
          step={5000}
          value={budget}
          onChange={(e) => setBudget(Number(e.target.value))}
          className="w-24"
          aria-label="예산"
        />
        <span className="text-sm font-bold text-ink-primary dark:text-ink-primary-dark w-12 text-right tabular-nums">
          {formatBudget(budget)}
        </span>
      </div>

      {/* 테마 토글 */}
      <button
        onClick={toggleTheme}
        className="p-2 rounded-card border border-line-light dark:border-line-dark hover:bg-surface dark:hover:bg-surface-dark-elevated-hover text-ink-secondary dark:text-ink-secondary-dark transition-colors shrink-0"
        aria-label="테마 전환"
        title={theme === 'dark' ? '라이트 모드' : '다크 모드'}
      >
        {theme === 'dark' ? (
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2" />
            <path d="M12 20v2" />
            <path d="m4.93 4.93 1.41 1.41" />
            <path d="m17.66 17.66 1.41 1.41" />
            <path d="M2 12h2" />
            <path d="M20 12h2" />
            <path d="m6.34 17.66-1.41 1.41" />
            <path d="m19.07 4.93-1.41 1.41" />
          </svg>
        ) : (
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
          </svg>
        )}
      </button>

      <Link
        to="/explore"
        className="text-xs font-medium text-ink-tertiary dark:text-ink-tertiary-dark hover:text-brand shrink-0 transition-colors border-none"
      >
        시군구 탐색 →
      </Link>
    </header>
  );
}
