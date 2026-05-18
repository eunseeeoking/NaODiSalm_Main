/**
 * Depth 2 상단 헤더
 *  - 좌: 서비스명 로고
 *  - 중: 직장 검색 (WorkplaceSearch)
 *  - 우: 예산 슬라이더 + 시군구 탐색 링크
 */
import { Link } from 'react-router-dom';
import { useRecommendationStore } from '../../../stores/useRecommendationStore';
import { WorkplaceSearch } from './WorkplaceSearch';

function formatBudget(manwon: number): string {
  return `${(manwon / 10000).toFixed(1).replace(/\.0$/, '')}억`;
}

export function RecommendationHeader() {
  const budget = useRecommendationStore((s) => s.budget);
  const setBudget = useRecommendationStore((s) => s.setBudget);

  return (
    <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-4">
      <h1 className="text-base font-bold text-brand tracking-tight shrink-0">
        스마트 직세권
      </h1>
      <div className="flex-1 max-w-2xl">
        <WorkplaceSearch />
      </div>
      <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-50 border border-gray-200 rounded-card shrink-0">
        <span className="text-[11px] text-gray-500">예산</span>
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
        <span className="text-sm font-medium w-12 text-right">{formatBudget(budget)}</span>
      </div>
      <Link
        to="/explore"
        className="text-xs text-gray-500 hover:text-brand shrink-0"
      >
        시군구 탐색 →
      </Link>
    </header>
  );
}
