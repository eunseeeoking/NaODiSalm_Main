/**
 * 추천 결과 0건 빈 상태 (토스 톤)
 *  - 조건을 어떻게 넓히면 되는지 "행동" 을 안내 (가짜 카운트 제거, 2026-05-30 P3 후속).
 *  - 별도 가중치 재조회로 실제 건수를 계산하지 않음 — 빈 상태 힌트엔 과한 비용.
 *  - 통근(인내심) · 예산 한도를 함께/각각 넓히는 버튼이 실제 store 를 바꿔 재조회 유도.
 */
import { useRecommendationStore } from '../../../stores/useRecommendationStore';
import { BUDGET_SLIDER } from '../../../types/recommendation';
import { isInServiceArea, SERVICE_AREA_LABEL } from '../serviceArea';

const PATIENCE_MAX = 90; // CommutePatienceSlider 상한과 일치
const PATIENCE_STEP_UP = 15;

/** 예산(만원) → 간이 한글 표기 */
function fmtBudget(manwon: number): string {
  if (manwon < 10000) return `${(manwon / 1000).toFixed(0)}천만`;
  const eok = manwon / 10000;
  return `${Number.isInteger(eok) ? eok : eok.toFixed(1)}억`;
}

export function EmptyState() {
  const workplace = useRecommendationStore((s) => s.workplace);
  const patience = useRecommendationStore((s) => s.patience);
  const setPatience = useRecommendationStore((s) => s.setPatience);
  const budget = useRecommendationStore((s) => s.budget);
  const setBudget = useRecommendationStore((s) => s.setBudget);
  const dealType = useRecommendationStore((s) => s.dealType);

  // 지원범위(수도권) 밖 직장 — 통근·예산을 넓혀도 데이터가 없다. "조건이 빡빡함"이 아니라
  //  "아직 미지원 지역"이므로 잘못된 한도 안내 대신 전국 확장 로드맵으로 분기(2026-06-05).
  if (workplace && !isInServiceArea(workplace.lat, workplace.lng)) {
    return <OutOfServiceArea label={workplace.label} />;
  }

  // 통근 상향안 — +15분, 슬라이더 상한 클램프
  const nextPatience = Math.min(PATIENCE_MAX, patience + PATIENCE_STEP_UP);
  const canRaisePatience = nextPatience > patience;

  // 예산 상향안 — 1.5배(천만 단위), 거래유형별 슬라이더 최대(=무제한) 클램프
  const budgetMax = BUDGET_SLIDER[dealType].max;
  const bumpedBudget = Math.min(budgetMax, Math.round((budget * 1.5) / 1000) * 1000);
  const canRaiseBudget = bumpedBudget > budget;

  const budgetLabel = budget >= budgetMax ? '최대' : fmtBudget(budget);
  const bumpedLabel = bumpedBudget >= budgetMax ? '최대' : fmtBudget(bumpedBudget);
  // 매매=매매가 / 전세=보증금 / 월세=예산(보증금+월세 혼합)
  const budgetWhat =
    dealType === 'SALE' ? '매매가' : dealType === 'MONTHLY' ? '예산' : '보증금';

  const canWidenBoth = canRaisePatience && canRaiseBudget;
  const canWiden = canRaisePatience || canRaiseBudget;

  const widenBoth = () => {
    if (canRaisePatience) setPatience(nextPatience);
    if (canRaiseBudget) setBudget(bumpedBudget);
  };

  return (
    <div className="bg-surface-elevated dark:bg-surface-dark-elevated border border-line-light dark:border-line-dark rounded-cardlg p-6 text-center shadow-card">
      <div className="flex justify-center mb-3">
        <div className="w-14 h-14 rounded-full bg-brand-50 dark:bg-surface-dark-elevated-hover flex items-center justify-center">
          <svg
            width="26"
            height="26"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-brand"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m21 21-4.3-4.3" />
          </svg>
        </div>
      </div>
      <div className="text-base font-bold text-ink-primary dark:text-ink-primary-dark mb-1">
        조건에 맞는 지역이 없어요
      </div>
      <div className="text-sm text-ink-tertiary dark:text-ink-tertiary-dark mb-4">
        통근{' '}
        <span className="text-ink-primary dark:text-ink-primary-dark font-semibold tabular-nums">
          {patience}분
        </span>
        {' · '}
        {budgetWhat} 한도{' '}
        <span className="text-ink-primary dark:text-ink-primary-dark font-semibold tabular-nums">
          {budgetLabel}
        </span>{' '}
        기준
      </div>

      {canWiden ? (
        <>
          <div className="bg-brand-50 dark:bg-brand/[0.12] rounded-card p-3 mb-3 text-sm text-brand-700 dark:text-brand-200 leading-relaxed">
            통근·예산을 조정하면 후보가 늘어나요.
          </div>

          <div className="flex flex-col gap-2">
            {canWidenBoth && (
              <button
                onClick={widenBoth}
                title={`통근 ${nextPatience}분 · ${budgetWhat} ${bumpedLabel}로 넓혀 다시 조회`}
                className="px-4 py-2.5 bg-brand hover:bg-brand-600 text-white rounded-card text-sm font-semibold transition-colors"
              >
                통근·예산 한 번에 넓히기
              </button>
            )}
            {canRaisePatience && (
              <button
                onClick={() => setPatience(nextPatience)}
                className={
                  canWidenBoth
                    ? 'px-4 py-2 text-sm font-medium text-ink-secondary dark:text-ink-secondary-dark bg-surface dark:bg-surface-dark-elevated-hover rounded-card hover:bg-brand-50 dark:hover:bg-brand/[.15] hover:text-brand dark:hover:text-brand-300 transition-colors'
                    : 'px-4 py-2.5 bg-brand hover:bg-brand-600 text-white rounded-card text-sm font-semibold transition-colors'
                }
              >
                통근 {nextPatience}분으로 늘리기
              </button>
            )}
            {canRaiseBudget && (
              <button
                onClick={() => setBudget(bumpedBudget)}
                className={
                  canWidenBoth
                    ? 'px-4 py-2 text-sm font-medium text-ink-secondary dark:text-ink-secondary-dark bg-surface dark:bg-surface-dark-elevated-hover rounded-card hover:bg-brand-50 dark:hover:bg-brand/[.15] hover:text-brand dark:hover:text-brand-300 transition-colors'
                    : 'px-4 py-2.5 bg-brand hover:bg-brand-600 text-white rounded-card text-sm font-semibold transition-colors'
                }
              >
                {budgetWhat} 한도 {bumpedLabel}으로 늘리기
              </button>
            )}
          </div>
        </>
      ) : (
        <div className="bg-surface dark:bg-surface-dark-elevated-hover rounded-card p-3 text-sm text-ink-tertiary dark:text-ink-tertiary-dark leading-relaxed">
          통근·예산을 최대로 넓혀도 매물이 없어요. 매물종류나 거래유형을 바꿔보세요.
        </div>
      )}
    </div>
  );
}

/**
 * 지원범위 밖(현재 수도권만) 직장을 입력했을 때 — 빈 결과를 "오류/조건 빡빡함"이 아니라
 *  전국 확장 로드맵으로 보여 준다. (out-of-coverage 는 서버가 빈 배열 200 으로 정상 응답하며,
 *  DEMO 폴백이 아님 — 잘못된 "한도 넓히기" 안내를 피하려는 분기.)
 */
function OutOfServiceArea({ label }: { label?: string }) {
  return (
    <div className="bg-surface-elevated dark:bg-surface-dark-elevated border border-line-light dark:border-line-dark rounded-cardlg p-6 text-center shadow-card">
      <div className="flex justify-center mb-3">
        <div className="w-14 h-14 rounded-full bg-brand-50 dark:bg-surface-dark-elevated-hover flex items-center justify-center">
          {/* 지도 핀 — "곧 찾아갈 지역" 톤 */}
          <svg
            width="26" height="26" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" strokeWidth="1.8"
            strokeLinecap="round" strokeLinejoin="round"
            className="text-brand"
          >
            <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
            <circle cx="12" cy="10" r="3" />
          </svg>
        </div>
      </div>
      <div className="text-base font-bold text-ink-primary dark:text-ink-primary-dark mb-1">
        곧 전국으로 확장돼요
      </div>
      <div className="text-sm text-ink-tertiary dark:text-ink-tertiary-dark mb-4">
        {label ? (
          <>
            <span className="text-ink-primary dark:text-ink-primary-dark font-semibold">{label}</span>
            {' '}은 아직 준비 중이에요
          </>
        ) : (
          <>이 지역은 아직 준비 중이에요</>
        )}
      </div>

      {/* 전국 확장 로드맵 */}
      <div className="bg-surface dark:bg-surface-dark-elevated-hover rounded-card p-3 mb-3 text-left text-sm leading-relaxed">
        <div className="flex items-center gap-2 text-brand-700 dark:text-brand-200 font-semibold">
          <span className="inline-flex w-4 h-4 items-center justify-center rounded-full bg-brand text-white text-[10px] leading-none">✓</span>
          {SERVICE_AREA_LABEL} · 지원 중
        </div>
        <div className="flex items-center gap-2 mt-1.5 text-ink-tertiary dark:text-ink-tertiary-dark">
          <span className="inline-flex w-4 h-4 items-center justify-center rounded-full border border-line-light dark:border-line-dark text-[10px] leading-none">◷</span>
          부산·대구·광주·대전 등 — 확장 예정
        </div>
      </div>

      <div className="bg-brand-50 dark:bg-brand/[0.12] rounded-card p-3 text-sm text-brand-700 dark:text-brand-200 leading-relaxed">
        지금은 {SERVICE_AREA_LABEL} 직장으로 검색하면 바로 추천받을 수 있어요.
      </div>
    </div>
  );
}
