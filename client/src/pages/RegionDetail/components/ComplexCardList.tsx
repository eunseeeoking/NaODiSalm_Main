/**
 * 매물 단지 카드 가로 스크롤 리스트 (APT 매매 전용)
 *  - 선택 단지 강조
 *  - 단지명 / 평형·연식 / 거래가 / 3년 가격 변동성
 *
 *  Phase 1.5 (2026-05-27 revert)
 *  - LH 카드/필터는 제거 — LH 데이터는 단지 디테일이 없어 시군구 집계로만 신뢰 가능
 *  - LH 집계는 별도 컴포넌트 <LhAggregateBanner> 가 상단에서 처리
 *  - propertyKind 필드는 유지 (Phase 3 의 VILLA/OFFICETEL 분기에 재사용)
 */
import { useDragScroll } from '../../../hooks/useDragScroll';
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

/** 3년 가격 변동성 (%) — APT 매매 카드 한정 */
function priceVolatility3y(c: AptComplex): number {
  if (!c.pricePerM2 || !Number.isFinite(c.pricePerM2)) return 0;
  return Math.round(((c.predictedPricePerM2_3y - c.pricePerM2) / c.pricePerM2) * 1000) / 10;
}

export function ComplexCardList({ complexes, selectedId, onSelect }: Props) {
  // 훅은 early return 보다 먼저 (Rules of Hooks)
  const cardScrollRef = useDragScroll<HTMLDivElement>();

  if (complexes.length === 0) {
    return (
      <div className="shrink-0 h-32 rounded-cardlg bg-surface-elevated dark:bg-surface-dark-elevated border border-line-light dark:border-line-dark shadow-card flex items-center justify-center text-sm text-ink-tertiary dark:text-ink-tertiary-dark">
        등록된 단지가 없습니다.
      </div>
    );
  }

  return (
    <div className="shrink-0">
      {/* 헤더: 제목 */}
      <div className="flex items-center justify-between mb-2 px-1">
        <h2 className="text-sm font-bold text-ink-primary dark:text-ink-primary-dark">
          매물 단지
          <span className="ml-2 text-xs font-medium text-ink-tertiary dark:text-ink-tertiary-dark tabular-nums">
            {complexes.length}건
          </span>
        </h2>
      </div>

      <div ref={cardScrollRef} className="overflow-x-auto scroll-x-slider -mx-1 px-1 pb-1">
        <div className="flex gap-2.5 min-w-min">
          {complexes.map((c) => {
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
                {/* 단지명 */}
                <div className="flex items-start gap-1.5 mb-1">
                  <span className="text-sm font-semibold text-ink-primary dark:text-ink-primary-dark truncate flex-1">
                    {c.name}
                  </span>
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

      <p className="mt-1.5 px-1 text-2xs text-ink-tertiary dark:text-ink-tertiary-dark">
        카드를 선택하면 가격 안정성 분석이 표시돼요
      </p>

      {/* 데이터 출처 footer — 가점 어필 (4기관 데이터 융합) */}
      <div className="mt-2 px-1 flex items-center gap-2 flex-wrap text-2xs text-ink-tertiary dark:text-ink-tertiary-dark">
        <span className="font-semibold text-ink-secondary dark:text-ink-secondary-dark shrink-0">데이터</span>
        <span>국토부 RTMS {complexes.length > 0 ? `· ${complexes.length}단지` : ''}</span>
        <span className="w-px h-2.5 bg-line-light dark:bg-line-dark" />
        <span>한국부동산원 R-ONE</span>
        <span className="w-px h-2.5 bg-line-light dark:bg-line-dark" />
        <span>ARIMA 통계 모델</span>
      </div>
    </div>
  );
}
