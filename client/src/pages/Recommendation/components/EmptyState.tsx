/**
 * 추천 결과 0건 빈 상태
 *  - 자동 제안: "인내심 50분으로 늘리면 3건"
 *  - 클릭 시 슬라이더 갱신 → 즉시 결과 노출
 */
import { useRecommendationStore } from '../../../stores/useRecommendationStore';

interface Props {
  /** 인내심 늘릴 때 잡히는 후보 수 (정렬: 작은 인내심부터) */
  suggestions: Array<{ patience: number; count: number }>;
}

export function EmptyState({ suggestions }: Props) {
  const patience = useRecommendationStore((s) => s.patience);
  const setPatience = useRecommendationStore((s) => s.setPatience);

  // 가장 적은 인내심 증가로 결과를 얻을 수 있는 제안
  const best = suggestions.find((s) => s.count > 0);

  return (
    <div className="bg-white border border-gray-200 rounded-card p-6 text-center">
      <div className="flex justify-center mb-3">
        <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center text-2xl text-gray-400">
          🗺
        </div>
      </div>
      <div className="text-sm font-medium mb-1">조건에 맞는 지역이 없어요</div>
      <div className="text-xs text-gray-500 mb-4">
        통근 인내심 <strong className="text-gray-900 font-medium">{patience}분</strong> 기준
      </div>

      {suggestions.length > 0 && (
        <div className="bg-info-bg rounded-card p-3 text-left mb-3 text-xs text-info-fg leading-relaxed">
          <span className="font-medium">💡 </span>
          {suggestions.map((s, i) => (
            <span key={s.patience}>
              인내심을 <strong className="font-medium">{s.patience}분</strong>으로 늘리면{' '}
              <strong className="font-medium">{s.count}건</strong>
              {i < suggestions.length - 1 ? ', ' : ''}
            </span>
          ))}
          이 보여요
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        {best && (
          <button
            onClick={() => setPatience(best.patience)}
            className="px-3 py-2 bg-info-bg text-info-fg text-xs font-medium rounded-card border border-info-border hover:opacity-90"
          >
            인내심 {best.patience}분으로 늘리기 →
          </button>
        )}
        <button className="px-3 py-2 text-xs text-gray-600 border border-gray-200 rounded-card hover:bg-gray-50">
          예산 조정하기
        </button>
      </div>
    </div>
  );
}
