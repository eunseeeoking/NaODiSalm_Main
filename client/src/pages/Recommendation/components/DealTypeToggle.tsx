/**
 * 거래유형 토글 (매매 / 전세 / 월세) — 2026-05-30
 *
 *  ▷ 배경: 국토부 RTMS 실거래 전월세 4종 적재 → affordability(주거비 부담) 점수를
 *          매매가 합성이 아닌 실거래 전월세 시세로 산출 가능해짐.
 *  ▷ 동작: 선택 거래유형이 fetchRecommendations 요청의 dealType 으로 전달되어
 *          서버가 해당 시세 기준으로 RIR·부담 점수를 재계산 → 카드 재정렬.
 *  ▷ 기본값: 전세 (청년 전월세 의사결정 도구 컨셉). '매매' 선택 시 기존 점수로 회귀.
 *
 *  세그먼트 스타일 — WeightSliders 프리셋 칩과 톤 일치.
 */
import { useRecommendationStore } from '../../../stores/useRecommendationStore';
import { InfoTooltip } from '../../../components/InfoTooltip';
import { DEAL_TYPE_LABELS, type RecDealType } from '../../../types/recommendation';

const ORDER: readonly RecDealType[] = ['SALE', 'JEONSE', 'MONTHLY'];

/** 거래유형 산출근거 배지 텍스트 */
const basisLabel = (dealType: RecDealType) =>
  dealType === 'SALE' ? '매매가 환산' : '실거래 전월세';

export function DealTypeToggle({ bare = false }: { bare?: boolean }) {
  const dealType = useRecommendationStore((s) => s.dealType);
  const setDealType = useRecommendationStore((s) => s.setDealType);

  const segment = (
    <div
      className="grid grid-cols-3 gap-1 p-1 rounded-card bg-surface dark:bg-surface-dark"
      role="group"
      aria-label="거래유형 선택"
    >
      {ORDER.map((dt) => {
        const active = dealType === dt;
        return (
          <button
            key={dt}
            type="button"
            onClick={() => setDealType(dt)}
            aria-pressed={active}
            className={
              active
                ? 'text-xs font-semibold py-1.5 rounded-[7px] bg-brand text-white transition-all'
                : 'text-xs font-medium py-1.5 rounded-[7px] text-ink-secondary dark:text-ink-secondary-dark hover:text-brand dark:hover:text-brand-300 transition-all'
            }
          >
            {DEAL_TYPE_LABELS[dt]}
          </button>
        );
      })}
    </div>
  );

  // bare: 섹션 헤더가 제목을 대신 → 근거 배지 + 세그먼트만
  if (bare) {
    return (
      <div>
        <div className="flex justify-end mb-1.5">
          <span className="text-xs text-ink-tertiary dark:text-ink-tertiary-dark">
            {basisLabel(dealType)}
          </span>
        </div>
        {segment}
      </div>
    );
  }

  return (
    <div className="bg-surface-elevated dark:bg-surface-dark-elevated border border-line-light dark:border-line-dark rounded-cardlg p-4 shadow-card">
      <div className="flex items-center justify-between mb-2 whitespace-nowrap">
        <span className="text-sm font-bold text-ink-primary dark:text-ink-primary-dark flex items-center gap-1.5 shrink-0">
          거래유형
          <InfoTooltip
            text="주거비 부담 점수의 기준이 됩니다. 전세·월세는 국토부 실거래 전월세 시세, 매매는 매매가 환산을 사용합니다."
            position="bottom"
          />
        </span>
        <span className="text-xs text-ink-tertiary dark:text-ink-tertiary-dark">
          {basisLabel(dealType)}
        </span>
      </div>
      {segment}
    </div>
  );
}
