/**
 * 통근 인내심 슬라이더 (지도 상단)
 *  - 사용자가 견딜 수 있는 편도 최대 통근시간 설정
 *  - 슬라이더 변경 시 히트맵 컷오프 + 추천 리스트 동시 갱신
 */
import { useRecommendationStore } from '../../../stores/useRecommendationStore';

export function CommutePatienceSlider() {
  const patience = useRecommendationStore((s) => s.patience);
  const setPatience = useRecommendationStore((s) => s.setPatience);

  return (
    <div className="px-3.5 py-2.5 border-b border-gray-200 bg-white">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[11px] text-gray-500">통근 인내심 (편도 최대)</span>
        <span className="text-[13px] font-medium">{patience}분</span>
      </div>
      <input
        type="range"
        min={20}
        max={90}
        step={5}
        value={patience}
        onChange={(e) => setPatience(Number(e.target.value))}
        className="w-full"
        aria-label="통근 인내심"
      />
      <div className="flex justify-between text-[10px] text-gray-400 mt-0.5">
        <span>20분</span>
        <span>45분</span>
        <span>90분</span>
      </div>
    </div>
  );
}
