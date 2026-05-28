/**
 * 4축 가중치 슬라이더 + 프리셋 + 소득분위
 *
 *  UX 구조:
 *   ┌────────────────────────────────────┐
 *   │ 가중치               합 100/100    │  ← 항상
 *   │ [사회초년생][신혼부부][실거주][직장인] │  ← 항상
 *   │  ▾ 상세 설정 (슬라이더)             │  ← 토글
 *   │   통근 ─────────────  30%         │  ← 펼침 시만
 *   │   부담 ─────────────  30%         │
 *   │   안전 ─────────────  20%         │
 *   │   생활 ─────────────  20%         │
 *   ├────────────────────────────────────┤
 *   │ 소득 분위        주거비 부담률(RIR)  │  ← 항상
 *   │ [미선택][1분위]…                   │  ← 항상
 *   │ [월 급여 입력]                     │  ← 항상
 *   └────────────────────────────────────┘
 */
import { useState } from 'react';
import { useDragScroll } from '../../../hooks/useDragScroll';
import { useRecommendationStore } from '../../../stores/useRecommendationStore';
import { InfoTooltip } from '../../../components/InfoTooltip';
import {
  WEIGHT_PRESETS,
  QUINTILE_LABELS,
  type Weights,
  type WeightPreset,
  type IncomeQuintile,
} from '../../../types/recommendation';

export const WEIGHTS_SUM_MIN = 90;
export const WEIGHTS_SUM_MAX = 110;

export function salaryToQuintile(salary: number): IncomeQuintile {
  if (salary < 130) return 1;
  if (salary < 274) return 2;
  if (salary < 403) return 3;
  if (salary < 577) return 4;
  return 5;
}

export function isWeightsValid(weights: Weights): boolean {
  const sum = weights.commute + weights.affordability + weights.safety + weights.life;
  return sum >= WEIGHTS_SUM_MIN && sum <= WEIGHTS_SUM_MAX;
}

const AXIS_TOOLTIPS: Record<keyof Weights, string> = {
  commute:       '직장까지 편도 통근 시간 기준. 시간이 짧을수록 높은 점수.',
  affordability: '월 소득 대비 주거비 비율(RIR). 낮을수록 부담이 적어 높은 점수.',
  safety:        '1인가구 안전 지수. 범죄율·CCTV·가로등 밀도를 합산한 점수.',
  life:          '주변 편의시설(마트·병원·카페) 접근성 지수.',
};

const ROWS: ReadonlyArray<{ key: keyof Weights; label: string }> = [
  { key: 'commute',       label: '통근' },
  { key: 'affordability', label: '부담' },
  { key: 'safety',        label: '안전' },
  { key: 'life',          label: '생활' },
];

const PRESETS: ReadonlyArray<{ key: WeightPreset; label: string }> = [
  { key: 'young',    label: '사회초년생' },
  { key: 'newlywed', label: '신혼부부' },
  { key: 'resident', label: '실거주' },
  { key: 'worker',   label: '직장인' },
];

function isSamePreset(weights: Weights, preset: WeightPreset): boolean {
  const p = WEIGHT_PRESETS[preset];
  return (
    weights.commute       === p.commute &&
    weights.affordability === p.affordability &&
    weights.safety        === p.safety &&
    weights.life          === p.life
  );
}

const QUINTILE_KEYS = [1, 2, 3, 4, 5] as const;

export function WeightSliders() {
  const weights           = useRecommendationStore((s) => s.weights);
  const setWeight         = useRecommendationStore((s) => s.setWeight);
  const applyPreset       = useRecommendationStore((s) => s.applyPreset);
  const incomeQuintile    = useRecommendationStore((s) => s.incomeQuintile);
  const setIncomeQuintile = useRecommendationStore((s) => s.setIncomeQuintile);

  /** 슬라이더(통근/부담/안전/생활)만 접힘 — 소득분위는 별도 항상 표시 */
  const [slidersOpen, setSlidersOpen] = useState(false);
  // 소득 분위 칩 가로 스크롤 — 드래그 슬라이더 + 스크롤바 숨김
  const quintileScrollRef = useDragScroll<HTMLDivElement>();

  const [salaryInput, setSalaryInput] = useState('');
  const [salaryHint,  setSalaryHint]  = useState<string | null>(null);

  function clearSalaryAndQuintile() {
    setSalaryInput('');
    setSalaryHint(null);
    setIncomeQuintile(null);
  }

  function handleSalaryChange(raw: string) {
    const cleaned = raw.replace(/[^0-9]/g, '');
    setSalaryInput(cleaned);
    if (!cleaned) { setSalaryHint(null); setIncomeQuintile(null); return; }
    const salary = Number(cleaned);
    const q = salaryToQuintile(salary);
    setIncomeQuintile(q);
    setSalaryHint(`월 ${salary.toLocaleString()}만원 → ${QUINTILE_LABELS[q]}`);
  }

  function handleQuintileChipClick(next: IncomeQuintile | null) {
    setIncomeQuintile(next);
    if (salaryInput) { setSalaryInput(''); setSalaryHint(null); }
  }

  const sum   = weights.commute + weights.affordability + weights.safety + weights.life;
  const valid = sum >= WEIGHTS_SUM_MIN && sum <= WEIGHTS_SUM_MAX;
  const sumColorCls = valid
    ? 'text-ink-tertiary dark:text-ink-tertiary-dark'
    : 'text-negative';

  return (
    <div className="bg-surface-elevated dark:bg-surface-dark-elevated border border-line-light dark:border-line-dark rounded-cardlg p-4 shadow-card">

      {/* ── 헤더: 제목 + 합계 ── */}
      <div className="flex items-center justify-between mb-2 whitespace-nowrap">
        <span className="text-sm font-bold text-ink-primary dark:text-ink-primary-dark flex items-center gap-1.5 shrink-0">
          가중치
          <InfoTooltip
            text="4개 축의 중요도 비율을 설정합니다. 합계가 90~110이 되도록 조정하세요."
            position="bottom"
          />
        </span>
        <span
          className={`text-xs font-semibold tabular-nums shrink-0 ${sumColorCls}`}
          aria-live="polite"
          title={
            valid
              ? `합 ${sum} / 100 (허용 ${WEIGHTS_SUM_MIN}~${WEIGHTS_SUM_MAX})`
              : `합 ${sum} — 추천 갱신이 멈춥니다. ${WEIGHTS_SUM_MIN}~${WEIGHTS_SUM_MAX} 범위로 조정해 주세요.`
          }
        >
          합 {sum}
          <span className="text-ink-tertiary dark:text-ink-tertiary-dark font-normal">{' / 100'}</span>
        </span>
      </div>

      {/* ── 프리셋 버튼 (항상 노출) ── */}
      <div className="flex gap-1 flex-wrap" role="group" aria-label="가중치 프리셋">
        {PRESETS.map((p) => {
          const active = isSamePreset(weights, p.key);
          return (
            <button
              key={p.key}
              type="button"
              onClick={() => applyPreset(p.key)}
              aria-pressed={active}
              className={
                active
                  ? 'text-xs px-2.5 py-1 rounded-full bg-brand text-white font-semibold transition-all'
                  : 'text-xs px-2.5 py-1 rounded-full bg-brand-50 dark:bg-brand/[.15] text-brand dark:text-brand-300 hover:bg-brand hover:text-white transition-all'
              }
            >
              {p.label}
            </button>
          );
        })}
      </div>

      {/* ── 상세 슬라이더 토글 버튼 ── */}
      <button
        type="button"
        onClick={() => setSlidersOpen((v) => !v)}
        aria-expanded={slidersOpen}
        className="mt-2.5 w-full flex items-center justify-center gap-1.5 py-1.5 rounded-card text-xs font-medium text-ink-tertiary dark:text-ink-tertiary-dark hover:text-brand dark:hover:text-brand-300 hover:bg-brand-50 dark:hover:bg-brand/[.1] transition-colors"
      >
        <svg
          width="10" height="10" viewBox="0 0 10 10" fill="currentColor"
          className={`transition-transform duration-200 ${slidersOpen ? 'rotate-180' : 'rotate-0'}`}
          aria-hidden="true"
        >
          <path d="M5 7 L1 3 L9 3 Z" />
        </svg>
        {slidersOpen ? '슬라이더 접기' : '슬라이더 조정'}
      </button>

      {/* ── 4축 슬라이더 (grid trick 으로 부드럽게 펼침/접힘) ── */}
      <div
        className="grid transition-[grid-template-rows] duration-300 ease-in-out"
        style={{ gridTemplateRows: slidersOpen ? '1fr' : '0fr' }}
      >
        <div className="overflow-hidden">
          <div className="pt-3 flex flex-col gap-3">
            {ROWS.map(({ key, label }) => {
              const value = weights[key];
              return (
                <div key={key} className="flex items-center gap-3">
                  <span className="text-sm text-ink-secondary dark:text-ink-secondary-dark w-16 font-medium flex items-center gap-1">
                    {label}
                    <InfoTooltip text={AXIS_TOOLTIPS[key]} position="top" />
                  </span>
                  <input
                    type="range"
                    min={0} max={50} step={5}
                    value={value}
                    onChange={(e) => setWeight(key, Number(e.target.value))}
                    className="flex-1"
                    aria-label={`${label} 가중치`}
                  />
                  <span className="text-sm text-ink-primary dark:text-ink-primary-dark w-11 text-right tabular-nums font-semibold">
                    {value}
                    <span className="text-xs text-ink-tertiary dark:text-ink-tertiary-dark ml-0.5 font-normal">%</span>
                  </span>
                </div>
              );
            })}

            {/* 합 범위 경고 — 슬라이더 영역 안에서만 표시 */}
            {!valid && (
              <div
                role="alert"
                className="px-3 py-2 rounded-card bg-negative/10 border border-negative/30 text-xs font-medium text-negative flex items-start gap-2"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 shrink-0" aria-hidden="true">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                <span>
                  가중치 합이 {sum}입니다. {WEIGHTS_SUM_MIN}~{WEIGHTS_SUM_MAX} 범위로 조정하거나 프리셋을 선택하세요.
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ══ 소득 분위 — 항상 표시 (슬라이더 접힘 여부 무관) ══ */}
      <div className="mt-3.5 pt-3.5 border-t border-line-light dark:border-line-dark">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-bold text-ink-primary dark:text-ink-primary-dark flex items-center gap-1">
            소득 분위
            <InfoTooltip
              text="통계청 2023 기준 월 소득 분위. 선택한 소득으로 주거비 부담률(RIR)을 계산합니다."
              position="top"
            />
          </span>
          <span className="text-xs text-ink-tertiary dark:text-ink-tertiary-dark">
            주거비 부담률(RIR)
          </span>
        </div>

        {/* 분위 칩 */}
        <div ref={quintileScrollRef} className="flex overflow-x-auto scroll-x-slider gap-1.5" role="group" aria-label="소득 분위 선택">
          <button
            type="button"
            onClick={() => handleQuintileChipClick(null)}
            aria-pressed={incomeQuintile === null}
            title="미선택 시 3분위(403만원) 기본값 적용"
            className={
              incomeQuintile === null
                ? 'shrink-0 text-xs px-2.5 py-1 rounded-full bg-brand text-white font-semibold transition-all'
                : 'shrink-0 text-xs px-2.5 py-1 rounded-full bg-brand-50 dark:bg-brand/[.15] text-brand dark:text-brand-300 hover:bg-brand hover:text-white transition-all'
            }
          >
            미선택
          </button>
          {QUINTILE_KEYS.map((q) => {
            const active = incomeQuintile === q;
            return (
              <button
                key={q}
                type="button"
                onClick={() => handleQuintileChipClick(active ? null : (q as IncomeQuintile))}
                aria-pressed={active}
                aria-label={`${QUINTILE_LABELS[q]} 선택`}
                className={
                  active
                    ? 'shrink-0 text-xs px-2.5 py-1 rounded-full bg-brand text-white font-semibold transition-all'
                    : 'shrink-0 text-xs px-2.5 py-1 rounded-full bg-brand-50 dark:bg-brand/[.15] text-brand dark:text-brand-300 hover:bg-brand hover:text-white transition-all'
                }
              >
                {QUINTILE_LABELS[q]}
              </button>
            );
          })}
        </div>
        {incomeQuintile === null && (
          <p className="mt-1.5 text-xs text-ink-tertiary dark:text-ink-tertiary-dark">
            3분위(403만원) 기본값 적용 중
          </p>
        )}

        {/* 월 급여 입력 — border 제거, bg로만 구분 */}
        <div className="mt-3 flex items-center gap-2">
          <label className="text-xs text-ink-tertiary dark:text-ink-tertiary-dark font-medium shrink-0">
            월 급여
          </label>
          <div className="relative flex-1">
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              placeholder="예: 350"
              value={salaryInput}
              onChange={(e) => handleSalaryChange(e.target.value)}
              className="w-full px-2.5 py-1.5 pr-8 rounded-card bg-surface dark:bg-surface-dark border-0 text-xs text-ink-primary dark:text-ink-primary-dark placeholder:text-ink-tertiary dark:placeholder:text-ink-tertiary-dark focus:outline-none transition-colors"
              aria-label="월 급여 입력 (만원)"
            />
            <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-ink-tertiary dark:text-ink-tertiary-dark pointer-events-none">
              만원
            </span>
          </div>
          {salaryInput && (
            <button
              type="button"
              onClick={clearSalaryAndQuintile}
              className="shrink-0 text-xs text-ink-tertiary dark:text-ink-tertiary-dark hover:text-negative transition-colors"
              aria-label="급여 입력 초기화"
            >
              ✕
            </button>
          )}
        </div>
        {salaryHint && (
          <p className="mt-1 text-xs font-semibold text-brand dark:text-brand-300">
            {salaryHint}
          </p>
        )}
      </div>

      {/* 합이 허용 범위 밖이면 인라인 경고 — 추천이 갱신되지 않는다는 사실을 명시 */}
      {!valid && (
        <div
          role="alert"
          className="mt-3 px-3 py-2 rounded-card bg-negative/10 border border-negative/30 text-xs font-medium text-negative flex items-start gap-2"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="mt-0.5 shrink-0"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <span>
            가중치 합이 {sum} 입니다. {WEIGHTS_SUM_MIN}~{WEIGHTS_SUM_MAX} 범위로 조정해야
            추천이 갱신됩니다.
            <br />
            <span className="font-semibold">[사회초년생] [신혼부부] [실거주] [직장인]</span>{' '}
            프리셋을 누르면 합 100 으로 자동 맞춰집니다.
          </span>
        </div>
      )}
    </div>
  );
}