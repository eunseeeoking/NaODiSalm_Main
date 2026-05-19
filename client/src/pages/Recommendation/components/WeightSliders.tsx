/**
 * 4축 가중치 슬라이더 + 프리셋 (우측 패널 상단)
 *  - 토스 톤: 한글 라벨, 활성 프리셋 풀필 브랜드 컬러
 */
import { useRecommendationStore } from '../../../stores/useRecommendationStore';
import { WEIGHT_PRESETS, type Weights, type WeightPreset } from '../../../types/recommendation';

const ROWS: ReadonlyArray<{ key: keyof Weights; label: string }> = [
  { key: 'commute', label: '통근' },
  { key: 'value', label: '가성비' },
  { key: 'investment', label: '투자' },
  { key: 'life', label: '생활' },
];

const PRESETS: ReadonlyArray<{ key: WeightPreset; label: string }> = [
  { key: 'worker', label: '직장인' },
  { key: 'investor', label: '투자자' },
  { key: 'resident', label: '실거주' },
];

function isSamePreset(weights: Weights, preset: WeightPreset): boolean {
  const p = WEIGHT_PRESETS[preset];
  return (
    weights.commute === p.commute &&
    weights.value === p.value &&
    weights.investment === p.investment &&
    weights.life === p.life
  );
}

export function WeightSliders() {
  const weights = useRecommendationStore((s) => s.weights);
  const setWeight = useRecommendationStore((s) => s.setWeight);
  const applyPreset = useRecommendationStore((s) => s.applyPreset);

  return (
    <div className="bg-surface-elevated dark:bg-surface-dark-elevated border border-line-light dark:border-line-dark rounded-cardlg p-4 shadow-card">
      <div className="flex items-center justify-between mb-3.5">
        <span className="text-sm font-bold text-ink-primary dark:text-ink-primary-dark">
          가중치
        </span>
        <div className="flex gap-1">
          {PRESETS.map((p) => {
            const active = isSamePreset(weights, p.key);
            return (
              <button
                key={p.key}
                onClick={() => applyPreset(p.key)}
                className={
                  active
                    ? 'text-xs px-2.5 py-1 rounded-full bg-brand text-white font-semibold transition-all'
                    : 'text-xs px-2.5 py-1 rounded-full bg-surface dark:bg-surface-dark-elevated-hover text-ink-secondary dark:text-ink-secondary-dark hover:bg-brand-50 dark:hover:bg-surface-dark-elevated-hover hover:text-brand transition-all'
                }
              >
                {p.label}
              </button>
            );
          })}
        </div>
      </div>
      <div className="flex flex-col gap-3">
        {ROWS.map(({ key, label }) => {
          const value = weights[key];
          return (
            <div key={key} className="flex items-center gap-3">
              <span className="text-sm text-ink-secondary dark:text-ink-secondary-dark w-12 font-medium">
                {label}
              </span>
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
              <span className="text-sm text-ink-primary dark:text-ink-primary-dark w-11 text-right tabular-nums font-semibold">
                {value}
                <span className="text-xs text-ink-tertiary dark:text-ink-tertiary-dark ml-0.5 font-normal">
                  %
                </span>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
