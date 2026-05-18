/**
 * 우측 카드 패널 (Depth 2)
 *  - 상단: 가중치 슬라이더 + 프리셋
 *  - 본문: 추천 카드 리스트 (상위 8건 고정) / 빈 상태 / 직장 미선택
 *  - 하단: "전체 N건 보기" 버튼 (8건 초과 시)
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
    <div className="w-[320px] shrink-0 flex flex-col gap-2.5 overflow-hidden">
      <WeightSliders />

      {!workplace ? (
        <div className="bg-white border border-gray-200 rounded-card p-6 text-center text-xs text-gray-500">
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
            <span className="text-xs text-gray-500">
              추천 지역{' '}
              <strong className="text-gray-900 font-medium">
                {recommendations.length}건
              </strong>
            </span>
            <span className="text-[11px] text-gray-500">종합점수 순</span>
          </div>
          <div className="flex-1 overflow-y-auto flex flex-col gap-2 pr-1">
            {top.map((r, i) => (
              <RegionCard key={r.legalDongCode} region={r} rank={i + 1} />
            ))}
            {hasMore && (
              <button className="py-2 mt-1 text-xs text-brand border border-gray-200 rounded-card hover:bg-gray-50">
                전체 {recommendations.length}건 보기 →
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
