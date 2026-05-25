/**
 * 기본 입력 블록 — 통근 인내심 + 예산 슬라이더 (좌측 상단)
 *  - 두 슬라이더를 같은 카드 안에 묶어 시각·기능적 응집
 *  - 토스 한국형 톤: Pretendard, 큰 라운드, 친근한 한글
 *  - 컴포넌트 명은 호환을 위해 CommutePatienceSlider 유지 (LeftPanel/index.tsx 호출부 다수)
 */
import { useRecommendationStore } from '../../../stores/useRecommendationStore';

/** 예산(만원) → "X.X억" 표기, .0 트리밍 */
function formatBudget(manwon: number): string {
  return `${(manwon / 10000).toFixed(1).replace(/\.0$/, '')}억`;
}

export function CommutePatienceSlider() {
  const patience = useRecommendationStore((s) => s.patience);
  const setPatience = useRecommendationStore((s) => s.setPatience);
  const budget = useRecommendationStore((s) => s.budget);
  const setBudget = useRecommendationStore((s) => s.setBudget);

  return (
    <div className="px-4 py-3.5 bg-surface-elevated dark:bg-surface-dark-elevated border border-line-light dark:border-line-dark rounded-cardlg shadow-card shrink-0 flex flex-col gap-3.5">
      {/* 통근 인내심 */}
      <div>
        <div className="flex items-center justify-between mb-2 whitespace-nowrap">
          <span className="text-sm text-ink-secondary dark:text-ink-secondary-dark font-medium shrink-0">
            통근 인내심
          </span>
          <span className="text-xl font-bold text-ink-primary dark:text-ink-primary-dark tabular-nums shrink-0">
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
        <div className="flex justify-between text-xs text-ink-tertiary dark:text-ink-tertiary-dark mt-1 tabular-nums font-medium">
          <span>20분</span>
          <span>45분</span>
          <span>90분</span>
        </div>
      </div>

      {/* 구분선 */}
      <div className="h-px bg-line-light dark:bg-line-dark" aria-hidden="true" />

      {/* 예산 */}
      <div>
        <div className="flex items-center justify-between mb-2 whitespace-nowrap">
          <span className="text-sm text-ink-secondary dark:text-ink-secondary-dark font-medium shrink-0">
            예산
          </span>
          <span className="text-xl font-bold text-ink-primary dark:text-ink-primary-dark tabular-nums shrink-0">
            {formatBudget(budget)}
          </span>
        </div>
        <input
          type="range"
          min={20000}
          max={150000}
          step={5000}
          value={budget}
          onChange={(e) => setBudget(Number(e.target.value))}
          className="w-full"
          aria-label="예산"
        />
        <div className="flex justify-between text-xs text-ink-tertiary dark:text-ink-tertiary-dark mt-1 tabular-nums font-medium">
          <span>2억</span>
          <span>8.5억</span>
          <span>15억</span>
        </div>
      </div>
    </div>
  );
}
