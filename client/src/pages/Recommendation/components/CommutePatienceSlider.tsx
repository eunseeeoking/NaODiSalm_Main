/**
 * 기본 입력 블록 — 통근 인내심 + 예산 슬라이더 (좌측 상단)
 *  - 두 슬라이더를 같은 카드 안에 묶어 시각·기능적 응집
 *  - 토스 한국형 톤: Pretendard, 큰 라운드, 친근한 한글
 *  - 컴포넌트 명은 호환을 위해 CommutePatienceSlider 유지 (LeftPanel/index.tsx 호출부 다수)
 */
import { useState } from 'react';
import { useRecommendationStore } from '../../../stores/useRecommendationStore';
import { BUDGET_SLIDER, MONTHLY_RENT_SLIDER } from '../../../types/recommendation';

/**
 * 예산(만원) → 사람이 읽는 한글 표기
 *  · 1억 미만        → "X천만"            (예: 3000 → "3천만")
 *  · 1억 이상 정확히 → "N억"               (예: 10000 → "1억")
 *  · 1억 이상 잔여   → "N억 M천만"        (예: 13000 → "1억 3천만", 12500 → "1억 2500만")
 *
 *  step 이 1000(천만원) 이라 천만 단위까지 표현하면 충분.
 *  step 보다 작은 잔여(예: 500만원)는 "X만" 으로 fallback.
 */
function formatBudget(manwon: number): string {
  if (manwon < 10000) {
    // 1억 미만
    if (manwon % 1000 === 0) return `${manwon / 1000}천만`;
    return `${manwon.toLocaleString()}만`;
  }
  const eok = Math.floor(manwon / 10000);
  const rest = manwon - eok * 10000; // 0~9999 만원
  if (rest === 0) return `${eok}억`;
  if (rest % 1000 === 0) return `${eok}억 ${rest / 1000}천만`;
  return `${eok}억 ${rest.toLocaleString()}만`;
}

/**
 * 거래유형별 예산의 의미 — 슬라이더가 실제로 무엇을 제한하는지 명시.
 *  · 전세/월세 → 보증금(자본) 상한. 동 보증금 중위값이 이를 넘으면 후보 제외.
 *  · 매매     → 매매가 상한.
 */
const BUDGET_CAPTION: Record<string, string> = {
  SALE: '매매가 한도',
  JEONSE: '보증금 한도',
  MONTHLY: '보증금 한도',
};

export function CommutePatienceSlider({ bare = false }: { bare?: boolean }) {
  const patience = useRecommendationStore((s) => s.patience);
  const setPatience = useRecommendationStore((s) => s.setPatience);
  const budget = useRecommendationStore((s) => s.budget);
  const setBudget = useRecommendationStore((s) => s.setBudget);
  const dealType = useRecommendationStore((s) => s.dealType);
  const monthlyRentCap = useRecommendationStore((s) => s.monthlyRentCap);
  const setMonthlyRentCap = useRecommendationStore((s) => s.setMonthlyRentCap);

  const budgetCfg = BUDGET_SLIDER[dealType];
  const rentCfg = MONTHLY_RENT_SLIDER;

  // 예산 직접 입력 — 슬라이더 step(1000만원)으로 정확히 맞추기 어려워,
  // 연필 클릭 시 숫자 타이핑(1 = 1000만원). 입력 이벤트마다 즉시 파싱·반영해
  // '천만원' 같은 헷갈리는 단위 없이 환산 금액(1000만원, 1억 1000만원…)을 라이브로 보여줌.
  const [editingBudget, setEditingBudget] = useState(false);
  const [budgetDraft, setBudgetDraft] = useState('');

  // 입력값(1 = 1000만원) → 클램프된 만원 금액. 빈 값/0 이하면 null.
  const draftToManwon = (raw: string): number | null => {
    const n = parseFloat(raw);
    if (Number.isNaN(n) || n <= 0) return null;
    const manwon = Math.round(n) * 1000; // 입력 1단위 = 1000만원
    return Math.max(budgetCfg.min, Math.min(manwon, budgetCfg.max));
  };

  const openBudgetEdit = () => {
    // 현재 예산(만원)을 입력 단위로 환산해 초기값 채움. 최대(무제한) 상태면 비움.
    setBudgetDraft(budget >= budgetCfg.max ? '' : String(Math.round(budget / 1000)));
    setEditingBudget(true);
  };

  return (
    <div
      className={
        bare
          ? 'flex flex-col gap-3.5'
          : 'px-4 py-3.5 bg-surface-elevated dark:bg-surface-dark-elevated border border-line-light dark:border-line-dark rounded-cardlg shadow-card shrink-0 flex flex-col gap-3.5'
      }
    >
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

      {/* 예산 (보증금/매매가) — 거래유형별 한도, 최대 위치는 무제한(전체 매물) */}
      <div>
        <div className="flex items-center justify-between mb-2 whitespace-nowrap">
          <span className="text-sm text-ink-secondary dark:text-ink-secondary-dark font-medium shrink-0 flex items-baseline gap-1.5">
            예산
            <span className="text-xs text-ink-tertiary dark:text-ink-tertiary-dark font-normal">
              {BUDGET_CAPTION[dealType] ?? '한도'}
            </span>
          </span>
          {editingBudget ? (
            // 입력 숫자는 숨기고(투명 input), 그 자리에 환산 결과만 노출.
            // 사용자가 보는 건 '1억 3천만' 같은 결과뿐 — 타이핑 중인 raw 숫자는 안 보임.
            <span className="relative shrink-0 inline-flex items-baseline border-b-2 border-brand pb-0.5">
              <span className="text-xl font-bold text-brand tabular-nums whitespace-nowrap">
                {(() => {
                  const manwon = draftToManwon(budgetDraft);
                  if (manwon === null) return '0원';
                  return manwon >= budgetCfg.max ? '최대' : formatBudget(manwon);
                })()}
              </span>
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={Math.round(budgetCfg.max / 1000)}
                value={budgetDraft}
                onChange={(e) => {
                  setBudgetDraft(e.target.value);
                  const manwon = draftToManwon(e.target.value);
                  if (manwon !== null) setBudget(manwon); // 입력 즉시 반영
                }}
                onFocus={(e) => e.target.select()}
                onBlur={() => setEditingBudget(false)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === 'Escape') setEditingBudget(false);
                }}
                autoFocus
                aria-label="예산 직접 입력 (1 = 1000만원)"
                className="absolute inset-0 w-full h-full bg-transparent text-transparent caret-transparent border-0 p-0 focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
            </span>
          ) : (
            <button
              type="button"
              onClick={openBudgetEdit}
              aria-label="예산 직접 입력"
              className="group flex items-center gap-1.5 shrink-0 rounded-md px-1 -mr-1 hover:bg-brand/[0.06] transition-colors"
            >
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-ink-tertiary dark:text-ink-tertiary-dark group-hover:text-brand transition-colors"
              >
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
              </svg>
              <span className="text-xl font-bold text-ink-primary dark:text-ink-primary-dark tabular-nums">
                {budget >= budgetCfg.max ? '최대' : formatBudget(budget)}
              </span>
            </button>
          )}
        </div>
        <input
          type="range"
          min={budgetCfg.min}
          max={budgetCfg.max}
          step={budgetCfg.step}
          value={Math.min(budget, budgetCfg.max)}
          onChange={(e) => setBudget(Number(e.target.value))}
          className="w-full"
          aria-label="예산"
        />
        <div className="flex justify-between text-xs text-ink-tertiary dark:text-ink-tertiary-dark mt-1 tabular-nums font-medium">
          {budgetCfg.labels.map((l) => (
            <span key={l}>{l}</span>
          ))}
        </div>
      </div>

      {/* 월세 한도 — 거래유형이 '월세' 일 때만 노출 (보증금 한도와 별개) */}
      {dealType === 'MONTHLY' && (
        <>
          <div className="h-px bg-line-light dark:bg-line-dark" aria-hidden="true" />
          <div>
            <div className="flex items-center justify-between mb-2 whitespace-nowrap">
              <span className="text-sm text-ink-secondary dark:text-ink-secondary-dark font-medium shrink-0 flex items-baseline gap-1.5">
                월세 한도
                <span className="text-xs text-ink-tertiary dark:text-ink-tertiary-dark font-normal">
                  월 임대료
                </span>
              </span>
              <span className="text-xl font-bold text-ink-primary dark:text-ink-primary-dark tabular-nums shrink-0">
                {monthlyRentCap >= rentCfg.max ? (
                  '최대'
                ) : (
                  <>
                    {monthlyRentCap}
                    <span className="text-sm text-ink-tertiary dark:text-ink-tertiary-dark ml-1 font-medium">
                      만원
                    </span>
                  </>
                )}
              </span>
            </div>
            <input
              type="range"
              min={rentCfg.min}
              max={rentCfg.max}
              step={rentCfg.step}
              value={Math.min(monthlyRentCap, rentCfg.max)}
              onChange={(e) => setMonthlyRentCap(Number(e.target.value))}
              className="w-full"
              aria-label="월세 한도 (월 임대료, 만원)"
            />
            <div className="flex justify-between text-xs text-ink-tertiary dark:text-ink-tertiary-dark mt-1 tabular-nums font-medium">
              {rentCfg.labels.map((l) => (
                <span key={l}>{l}</span>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
