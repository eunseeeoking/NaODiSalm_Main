/**
 * 통근 인내심 슬라이더 (지도 상단)
 *  - 토스 한국형 톤: Pretendard, 큰 라운드, 친근한 한글
 */
import { useRecommendationStore } from '../../../stores/useRecommendationStore';

export function CommutePatienceSlider() {
  const patience = useRecommendationStore((s) => s.patience);
  const setPatience = useRecommendationStore((s) => s.setPatience);

  return (
    <div className="px-4 py-3.5 border-b border-line-light dark:border-line-dark">
      <div className="flex items-center justify-between mb-2.5">
        <span className="text-sm text-ink-secondary dark:text-ink-secondary-dark font-medium">
          통근 인내심
        </span>
        <span className="text-xl font-bold text-ink-primary dark:text-ink-primary-dark tabular-nums">
          {patience}
          <span className="text-sm text-ink-tertiary dark:text-ink-tertiary-dark ml-1 font-medium">
            분
          </span>
        </span>
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
      <div className="flex justify-between text-xs text-ink-tertiary dark:text-ink-tertiary-dark mt-1.5 tabular-nums font-medium">
        <span>20분</span>
        <span>45분</span>
        <span>90분</span>
      </div>
    </div>
  );
}
