/**
 * 매물종류 필터 (아파트 / 오피스텔 / 빌라 / 단독·다가구) — 2026-05-30 P2 #3
 *
 *  ▷ 배경: 전월세 시세를 4종 한 평균에 섞으면 아파트 전세 3.5억과
 *          빌라·반지하 전세 3천만이 같은 "동 시세"로 합쳐져 통계가 오염됨.
 *          사용자가 실제로 찾는 종류만 골라 affordability 를 산출하도록 분리.
 *  ▷ 동작: 선택 종류가 fetchRecommendations 요청의 propertyTypes 로 전달되어
 *          서버가 해당 풀만 집계 → 동 시세·부담 점수 재계산 → 카드 재정렬.
 *  ▷ 제약: 최소 1개 유지(마지막 칩 해제 불가). 거래유형이 '매매'면 매매가 기준이라
 *          이 필터는 영향이 없어 비활성(흐리게) 처리.
 *
 *  멀티선택 칩 — DealTypeToggle 과 톤 일치.
 */
import { useRecommendationStore } from '../../../stores/useRecommendationStore';
import { InfoTooltip } from '../../../components/InfoTooltip';
import {
  PROPERTY_TYPE_LABELS,
  PROPERTY_TYPE_ORDER,
} from '../../../types/recommendation';

export function PropertyTypeFilter({ bare = false }: { bare?: boolean }) {
  const dealType = useRecommendationStore((s) => s.dealType);
  const propertyTypes = useRecommendationStore((s) => s.propertyTypes);
  const togglePropertyType = useRecommendationStore((s) => s.togglePropertyType);

  // 매매는 매매가 기준 → 매물종류 풀 집계와 무관하므로 비활성
  const disabled = dealType === 'SALE';

  const badge = (
    <span className="text-xs text-ink-tertiary dark:text-ink-tertiary-dark">
      {disabled ? '매매가 기준 (해당 없음)' : '복수 선택'}
    </span>
  );

  const chips = (
    <div
      className={[
        'grid grid-cols-2 gap-1.5',
        disabled ? 'opacity-40 pointer-events-none' : '',
      ].join(' ')}
      role="group"
      aria-label="매물종류 선택"
    >
      {PROPERTY_TYPE_ORDER.map((pt) => {
        const active = propertyTypes.includes(pt);
        // 마지막 1개는 해제 불가 — 시각적으로도 안내
        const isLastSelected = active && propertyTypes.length === 1;
        return (
          <button
            key={pt}
            type="button"
            onClick={() => togglePropertyType(pt)}
            aria-pressed={active}
            disabled={disabled}
            title={isLastSelected ? '최소 1개는 선택되어야 합니다' : undefined}
            className={
              active
                ? 'text-xs font-semibold py-2 rounded-card bg-brand text-white transition-all'
                : 'text-xs font-medium py-2 rounded-card border border-line-light dark:border-line-dark text-ink-secondary dark:text-ink-secondary-dark hover:text-brand hover:border-brand dark:hover:text-brand-300 transition-all'
            }
          >
            {PROPERTY_TYPE_LABELS[pt]}
          </button>
        );
      })}
    </div>
  );

  // bare: 섹션 헤더가 제목을 대신 → 배지 + 칩만
  if (bare) {
    return (
      <div>
        <div className="flex justify-end mb-1.5">{badge}</div>
        {chips}
      </div>
    );
  }

  return (
    <div className="bg-surface-elevated dark:bg-surface-dark-elevated border border-line-light dark:border-line-dark rounded-cardlg p-4 shadow-card">
      <div className="flex items-center justify-between mb-2 whitespace-nowrap">
        <span className="text-sm font-bold text-ink-primary dark:text-ink-primary-dark flex items-center gap-1.5 shrink-0">
          매물종류
          <InfoTooltip
            text="전월세 시세를 고른 매물종류만으로 집계합니다. 아파트와 빌라·단독을 섞으면 동 시세가 왜곡되므로, 실제로 찾는 종류만 선택하세요."
            position="bottom"
          />
        </span>
        {badge}
      </div>
      {chips}
    </div>
  );
}
