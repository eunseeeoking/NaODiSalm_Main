/**
 * 4축 가중치 슬라이더 + 프리셋 (우측 패널 상단)
 *  - 청년·신혼부부 컨셉 (2026-05-22):
 *      4축: 통근 / 부담(주거비) / 안전(1인가구) / 생활
 *      프리셋: 사회초년생 / 신혼부부 / 실거주 / 직장인
 *  - 토스 톤: 한글 라벨, 활성 프리셋 풀필 브랜드 컬러
 *  - 가중치 합 표시 + 90~110 밖 시 시각적 경고 (서버 validation 과 일치)
 */
import { useState } from 'react';
import { useRecommendationStore } from '../../../stores/useRecommendationStore';
import { InfoTooltip } from '../../../components/InfoTooltip';
import {
  WEIGHT_PRESETS,
  QUINTILE_LABELS,
  type Weights,
  type WeightPreset,
  type IncomeQuintile,
} from '../../../types/recommendation';

/** 서버 validation 과 동일한 허용 범위 — 동일 범위를 클라이언트에서 미리 가드 */
export const WEIGHTS_SUM_MIN = 90;
export const WEIGHTS_SUM_MAX = 110;

/** 월 급여(만원) → 소득 분위 자동 산출 (통계청 2023 기준) */
export function salaryToQuintile(salary: number): IncomeQuintile {
  if (salary < 130) return 1;
  if (salary < 274) return 2;
  if (salary < 403) return 3;
  if (salary < 577) return 4;
  return 5;
}

/** 가중치 합이 허용 범위 안인지 — 추천 호출 여부 판단에 재사용 */
export function isWeightsValid(weights: Weights): boolean {
  const sum = weights.commute + weights.affordability + weights.safety + weights.life;
  return sum >= WEIGHTS_SUM_MIN && sum <= WEIGHTS_SUM_MAX;
}

/** 4축 ⓘ 설명 */
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
  const weights = useRecommendationStore((s) => s.weights);
  const setWeight = useRecommendationStore((s) => s.setWeight);
  const applyPreset = useRecommendationStore((s) => s.applyPreset);
  const incomeQuintile = useRecommendationStore((s) => s.incomeQuintile);
  const setIncomeQuintile = useRecommendationStore((s) => s.setIncomeQuintile);

  // 월 급여 입력 → 분위 자동 파악
  const [salaryInput, setSalaryInput] = useState('');
  const [salaryHint, setSalaryHint] = useState<string | null>(null);

  /** 입력 + 분위 + hint를 항상 같은 시점에 비움 — ✕ 버튼 / 칩 직접조작 경로 공통 사용 */
  function clearSalaryAndQuintile() {
    setSalaryInput('');
    setSalaryHint(null);
    setIncomeQuintile(null);
  }

  function handleSalaryChange(raw: string) {
    // 숫자만 허용
    const cleaned = raw.replace(/[^0-9]/g, '');
    setSalaryInput(cleaned);
    if (!cleaned) {
      // 입력 자체가 비면 분위·hint도 함께 리셋(상태 모순 방지)
      setSalaryHint(null);
      setIncomeQuintile(null);
      return;
    }
    const salary = Number(cleaned);
    const q = salaryToQuintile(salary);
    setIncomeQuintile(q);
    setSalaryHint(`월 ${salary.toLocaleString()}만원 → ${QUINTILE_LABELS[q]}`);
  }

  /**
   * 사용자가 직접 분위 칩을 조작하면 salary 입력은 더 이상 truth가 아님 → 입력·hint를 비움.
   * (입력값 그대로면 hint와 칩이 서로 다른 분위를 가리키는 모순 상태가 됨)
   */
  function handleQuintileChipClick(next: IncomeQuintile | null) {
    setIncomeQuintile(next);
    if (salaryInput) {
      setSalaryInput('');
      setSalaryHint(null);
    }
  }

  const sum = weights.commute + weights.affordability + weights.safety + weights.life;
  const valid = sum >= WEIGHTS_SUM_MIN && sum <= WEIGHTS_SUM_MAX;
  // 합 색상: 정상 90~110 → ink-tertiary, 그 외 → negative
  const sumColorCls = valid
    ? 'text-ink-tertiary dark:text-ink-tertiary-dark'
    : 'text-negative';

  return (
    <div className="bg-surface-elevated dark:bg-surface-dark-elevated border border-line-light dark:border-line-dark rounded-cardlg p-4 shadow-card">
      {/* 1행: 제목 + 합계 (좁은 폭에서도 줄바꿈 방지 — whitespace-nowrap) */}
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
          <span className="text-ink-tertiary dark:text-ink-tertiary-dark font-normal">
            {' / 100'}
          </span>
        </span>
      </div>
      {/* 2행: 프리셋 — 별도 줄로 분리하여 제목 줄바꿈 방지 */}
      <div className="flex gap-1 flex-wrap mb-3.5" role="group" aria-label="가중치 프리셋">
        {PRESETS.map((p) => {
          const active = isSamePreset(weights, p.key);
          return (
            <button
              key={p.key}
              type="button"
              onClick={() => applyPreset(p.key)}
              aria-pressed={active}
              aria-label={`${p.label}형 프리셋`}
              title={`${p.label}형 프리셋 적용`}
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
      <div className="flex flex-col gap-3">
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

      {/* 소득 분위 칩 — RIR 산정 기준 소득 */}
      <div className="mt-4 pt-3.5 border-t border-line-light dark:border-line-dark">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-bold text-ink-primary dark:text-ink-primary-dark flex items-center gap-1">
            소득 분위
            <InfoTooltip
              text="통계청 2023 기준 월 소득 분위. 선택한 소득으로 주거비 부담률(RIR)을 계산합니다."
              position="top"
            />
          </span>
          <span className="text-xs text-ink-tertiary dark:text-ink-tertiary-dark">
            주거비 부담률(RIR) 기준
          </span>
        </div>
        <div
          className="flex flex-wrap gap-1.5"
          role="group"
          aria-label="소득 분위 선택"
        >
          {/* 미선택 칩 — 3분위(기본값) 명시 */}
          <button
            type="button"
            onClick={() => handleQuintileChipClick(null)}
            aria-pressed={incomeQuintile === null}
            title="미선택 시 3분위(403만원) 기본값 적용"
            className={
              incomeQuintile === null
                ? 'text-xs px-2.5 py-1 rounded-full bg-brand text-white font-semibold transition-all'
                : 'text-xs px-2.5 py-1 rounded-full bg-brand-50 dark:bg-brand/[.15] text-brand dark:text-brand-300 hover:bg-brand hover:text-white transition-all'
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
                onClick={() =>
                  handleQuintileChipClick(active ? null : (q as IncomeQuintile))
                }
                aria-pressed={active}
                aria-label={`${QUINTILE_LABELS[q]} 선택`}
                className={
                  active
                    ? 'text-xs px-2.5 py-1 rounded-full bg-brand text-white font-semibold transition-all'
                    : 'text-xs px-2.5 py-1 rounded-full bg-brand-50 dark:bg-brand/[.15] text-brand dark:text-brand-300 hover:bg-brand hover:text-white transition-all'
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

        {/* 월 급여 입력 → 자동 분위 파악 */}
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
              className="w-full px-2.5 py-1.5 pr-8 rounded-card bg-surface dark:bg-surface-dark border border-line-light dark:border-line-dark text-xs text-ink-primary dark:text-ink-primary-dark placeholder:text-ink-tertiary dark:placeholder:text-ink-tertiary-dark focus:outline-none focus:border-brand transition-colors"
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
