/**
 * 4축 가중치 슬라이더 + 프리셋 (우측 패널 상단)
 *  - 각 축 0~50, 합계는 정규화 없이 그대로 사용 (UI 표시)
 *  - 프리셋 클릭 시 4축 일괄 갱신
 */
import { useRecommendationStore } from '../../../stores/useRecommendationStore';
import type { Weights } from '../../../types/recommendation';

const ROWS: ReadonlyArray<{ key: keyof Weights; label: string }> = [
  { key: 'commute',    label: '통근' },
  { key: 'value',      label: '가성비' },
  { key: 'investment', label: '투자' },
  { key: 'life',       label: '생활' },
];

export function WeightSliders() {
  const weights = useRecommendationStore((s) => s.weights);
  const setWeight = useRecommendationStore((s) => s.setWeight);
  const applyPreset = useRecommendationStore((s) => s.applyPreset);

  return (
    <div className="bg-white border border-gray-200 rounded-card p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium">가중치 조정</span>
        <div className="flex gap-1">
          <button
            onClick={() => applyPreset('worker')}
            className="text-[10px] px-1.5 py-0.5 border border-gray-200 rounded hover:bg-gray-50"
          >
            직장인
          </button>
          <button
            onClick={() => applyPreset('investor')}
            className="text-[10px] px-1.5 py-0.5 border border-gray-200 rounded hover:bg-gray-50"
          >
            투자
          </button>
          <button
            onClick={() => applyPreset('resident')}
            className="text-[10px] px-1.5 py-0.5 border border-gray-200 rounded hover:bg-gray-50"
          >
            실거주
          </button>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        {ROWS.map(({ key, label }) => {
          const value = weights[key];
          return (
            <div key={key} className="flex items-center gap-2">
              <span className="text-[11px] text-gray-500 w-10">{label}</span>
              <input
                type="range"
                min={0}
                max={50}
                step={5}
                value={value}
                onChange={(e) => setWeight(key, Number(e.target.value))}
                className="flex-1"
                aria-label={`${label} 가중치`}
              />
              <span className="text-[11px] font-medium w-7 text-right">{value}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
