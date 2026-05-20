/**
 * 매물 단지 카드 가로 스크롤 리스트
 *  - 선택 단지 강조
 *  - 단지명 / 평형·연식 / 거래가 / 3년 수익률
 */
import type { AptComplex } from '../../../types/region-detail';

interface Props {
  complexes: AptComplex[];
  selectedId: string | null;
  onSelect: (complex: AptComplex) => void;
}

function formatEok(manwon: number): string {
  const eok = (manwon / 10000).toFixed(1).replace(/\.0$/, '');
  return `${eok}억`;
}

function expectedReturn(c: AptComplex): number {
  return Math.round(((c.predictedPricePerM2_3y - c.pricePerM2) / c.pricePerM2) * 1000) / 10;
}

export function ComplexCardList({ complexes, selectedId, onSelect }: Props) {
  if (complexes.length === 0) {
    return (
      <div className="shrink-0 h-32 rounded-cardlg bg-surface-elevated dark:bg-surface-dark-elevated border border-line-light dark:border-line-dark shadow-card flex items-center justify-center text-sm text-ink-tertiary dark:text-ink-tertiary-dark">
        등록된 단지가 없습니다.
      </div>
    );
  }

  return (
    <div className="shrink-0">
      <div className="flex items-center justify-between mb-2 px-1">
        <h2 className="text-sm font-bold text-ink-primary dark:text-ink-primary-dark">
          매물 단지
          <span className="ml-2 text-xs font-medium text-ink-tertiary dark:text-ink-tertiary-dark tabular-nums">
            {complexes.length}건
          </span>
        </h2>
        <span className="text-xs text-ink-tertiary dark:text-ink-tertiary-dark">
          카드를 선택하면 LSTM 분석이 표시돼요
        </span>
      </div>

      <div className="overflow-x-auto -mx-1 px-1 pb-1">
        <div className="flex gap-2.5 min-w-min">
          {complexes.map((c) => {
            const isSelected = c.complexId === selectedId;
            const ret = expectedReturn(c);

            return (
              <button
                key={c.complexId}
                onClick={() => onSelect(c)}
                className={[
                  'shrink-0 w-56 rounded-cardlg p-3 text-left transition-all',
                  'bg-surface-elevated dark:bg-surface-dark-elevated',
                  isSelected
                    ? 'border-2 border-brand shadow-card-hover -translate-y-px'
                    : 'border border-line-light dark:border-line-dark shadow-card hover:shadow-card-hover hover:-translate-y-px',
                ].join(' ')}
              >
                <div className="text-sm font-semibold text-ink-primary dark:text-ink-primary-dark truncate mb-1">
                  {c.name}
                </div>
                <div className="flex items-center gap-1.5 mb-2 flex-wrap">
                  <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-surface dark:bg-surface-dark-elevated-hover text-ink-secondary dark:text-ink-secondary-dark">
                    {c.sizeBucket}
                  </span>
                  <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-surface dark:bg-surface-dark-elevated-hover text-ink-secondary dark:text-ink-secondary-dark">
                    {c.ageBucket}
                  </span>
                  <span className="text-2xs text-ink-tertiary dark:text-ink-tertiary-dark tabular-nums">
                    {c.builtYear}년
                  </span>
                </div>
                <div className="flex items-baseline justify-between">
                  <span className="text-base font-bold text-ink-primary dark:text-ink-primary-dark tabular-nums tracking-tight">
                    {formatEok(c.recentPrice)}
                  </span>
                  <span className="text-xs font-bold text-positive tabular-nums">
                    {ret >= 0 ? '+' : ''}
                    {ret}%
                  </span>
                </div>
                <div className="mt-1.5 text-2xs text-ink-tertiary dark:text-ink-tertiary-dark tabular-nums">
                  m²당 {c.pricePerM2.toLocaleString()}만 · {c.households.toLocaleString()}세대
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
