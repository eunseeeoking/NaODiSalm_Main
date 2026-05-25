/**
 * 매물 단지 카드 가로 스크롤 리스트
 *  - 선택 단지 강조
 *  - 단지명 / 평형·연식 / 거래가 / 3년 가격 변동성
 *  - LH 국가매물 배지 (isLhComplex)
 *  - 필터 탭: 전체 / 민간 / LH국가
 */
import { useState } from 'react';
import type { AptComplex } from '../../../types/region-detail';

interface Props {
  complexes: AptComplex[];
  selectedId: string | null;
  onSelect: (complex: AptComplex) => void;
}

type FilterTab = 'all' | 'private' | 'lh';

const FILTER_TABS: ReadonlyArray<{ key: FilterTab; label: string }> = [
  { key: 'all',     label: '전체' },
  { key: 'private', label: '민간' },
  { key: 'lh',      label: 'LH 국가' },
];

function formatEok(manwon: number): string {
  const eok = (manwon / 10000).toFixed(1).replace(/\.0$/, '');
  return `${eok}억`;
}

/** LH 단지 판별 — 카운트/필터 양쪽이 동일한 술어를 쓰도록 강제 */
const isLh = (c: AptComplex): boolean => c.isLhComplex === true;

/** 3년 가격 변동성 (%) — 투자 수익률 표현 제거, 가격 안정성 지표로 재정의 */
function priceVolatility3y(c: AptComplex): number {
  // 분모 0 가드 — 서버에서 0/NaN이 와도 +Infinity 노출 방지
  if (!c.pricePerM2 || !Number.isFinite(c.pricePerM2)) return 0;
  return Math.round(((c.predictedPricePerM2_3y - c.pricePerM2) / c.pricePerM2) * 1000) / 10;
}

export function ComplexCardList({ complexes, selectedId, onSelect }: Props) {
  const [filter, setFilter] = useState<FilterTab>('all');

  if (complexes.length === 0) {
    return (
      <div className="shrink-0 h-32 rounded-cardlg bg-surface-elevated dark:bg-surface-dark-elevated border border-line-light dark:border-line-dark shadow-card flex items-center justify-center text-sm text-ink-tertiary dark:text-ink-tertiary-dark">
        등록된 단지가 없습니다.
      </div>
    );
  }

  const lhCount = complexes.filter(isLh).length;
  const privateCount = complexes.length - lhCount;

  const filtered = complexes.filter((c) => {
    if (filter === 'lh') return isLh(c);
    if (filter === 'private') return !isLh(c);
    return true;
  });

  return (
    <div className="shrink-0">
      {/* 헤더: 제목 + 필터 탭 */}
      <div className="flex items-center justify-between mb-2 px-1 flex-wrap gap-2">
        <h2 className="text-sm font-bold text-ink-primary dark:text-ink-primary-dark">
          매물 단지
          <span className="ml-2 text-xs font-medium text-ink-tertiary dark:text-ink-tertiary-dark tabular-nums">
            {filtered.length}건
          </span>
        </h2>

        <div className="flex items-center gap-1.5" role="group" aria-label="매물 필터">
          {FILTER_TABS.map((t) => {
            const active = filter === t.key;
            // LH탭 비어있을 때 숫자 힌트 숨김
            const count = t.key === 'lh' ? lhCount : t.key === 'private' ? privateCount : complexes.length;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setFilter(t.key)}
                aria-pressed={active}
                className={
                  active
                    ? 'text-xs px-2.5 py-1 rounded-full bg-brand text-white font-semibold transition-all'
                    : 'text-xs px-2.5 py-1 rounded-full bg-brand-50 dark:bg-brand/[.15] text-brand dark:text-brand-300 hover:bg-brand hover:text-white transition-all'
                }
              >
                {t.label}
                {t.key !== 'all' && (
                  <span className="ml-1 tabular-nums opacity-70">{count}</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* 필터 결과 없음 */}
      {filtered.length === 0 && (
        <div className="h-24 rounded-cardlg bg-surface-elevated dark:bg-surface-dark-elevated border border-line-light dark:border-line-dark shadow-card flex items-center justify-center text-sm text-ink-tertiary dark:text-ink-tertiary-dark">
          {filter === 'lh' ? 'LH 국가매물이 없습니다.' : '민간매물이 없습니다.'}
        </div>
      )}

      {filtered.length > 0 && (
        <div className="overflow-x-auto -mx-1 px-1 pb-1">
          <div className="flex gap-2.5 min-w-min">
            {filtered.map((c) => {
              const isSelected = c.complexId === selectedId;
              const vol = priceVolatility3y(c);

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
                  {/* 단지명 + LH 배지 */}
                  <div className="flex items-start gap-1.5 mb-1">
                    <span className="text-sm font-semibold text-ink-primary dark:text-ink-primary-dark truncate flex-1">
                      {c.name}
                    </span>
                    {c.isLhComplex && (
                      <span
                        title="LH 청년주택 (행복주택·청년매입임대·전세임대)"
                        className="shrink-0 text-2xs font-bold px-1.5 py-0.5 rounded bg-positive/10 text-positive leading-tight"
                      >
                        LH
                      </span>
                    )}
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
                    <span className="text-xs font-bold text-ink-secondary dark:text-ink-secondary-dark tabular-nums">
                      3년 변동 {vol >= 0 ? '+' : ''}{vol}%
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
      )}

      <p className="mt-1.5 px-1 text-2xs text-ink-tertiary dark:text-ink-tertiary-dark">
        카드를 선택하면 가격 안정성 분석이 표시돼요
      </p>
    </div>
  );
}
