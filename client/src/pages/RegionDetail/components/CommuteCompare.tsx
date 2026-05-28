/**
 * 통근 비교 — 대중교통 vs 자차
 *  - 편도 시간 · 환승 횟수 · 편도 비용
 *  - 시간 짧은 쪽이 강조 (브랜드 보더)
 */
import type { CommuteCompareData } from '../../../types/region-detail';

interface Props {
  data: CommuteCompareData;
}

function formatWon(won: number): string {
  return `${won.toLocaleString()}원`;
}

export function CommuteCompare({ data }: Props) {
  const fasterMode: 'transit' | 'car' =
    data.transitMinutes <= data.carMinutes ? 'transit' : 'car';

  // 월 통근비 (편도 × 2 × 22 근무일)
  const monthlyTransit = data.transitCost * 2 * 22;
  const monthlyCar = data.carCost * 2 * 22;
  const monthlyDiff = Math.abs(monthlyTransit - monthlyCar);

  return (
    <div className="md:min-h-full rounded-cardlg bg-surface-elevated dark:bg-surface-dark-elevated border border-line-light dark:border-line-dark shadow-card p-4 flex flex-col gap-3">
      <div>
        <h3 className="text-sm font-bold text-ink-primary dark:text-ink-primary-dark">
          통근 비교
        </h3>
        <p className="text-2xs text-ink-tertiary dark:text-ink-tertiary-dark mt-0.5">
          편도 기준 · 직장 좌표 기반
        </p>
      </div>

      <ModeCard
        title="대중교통"
        icon={<TransitIcon />}
        minutes={data.transitMinutes}
        cost={data.transitCost}
        extraLabel="환승"
        extraValue={`${data.transfers}회`}
        emphasized={fasterMode === 'transit'}
      />

      <ModeCard
        title="자가용"
        icon={<CarIcon />}
        minutes={data.carMinutes}
        cost={data.carCost}
        extraLabel="연료비 기준"
        extraValue="연비 12km/L"
        emphasized={fasterMode === 'car'}
      />

      {/* 월 통근비 비교 */}
      <div className="mt-auto pt-3 border-t border-line-light dark:border-line-dark">
        <div className="text-2xs font-medium text-ink-tertiary dark:text-ink-tertiary-dark mb-1">
          월 통근비 차이 (편도 × 2 × 22일)
        </div>
        <div className="flex items-baseline gap-1">
          <span className="text-lg font-extrabold text-ink-primary dark:text-ink-primary-dark tabular-nums tracking-tight">
            {formatWon(monthlyDiff)}
          </span>
          <span className="text-2xs text-ink-tertiary dark:text-ink-tertiary-dark">
            {monthlyTransit < monthlyCar ? '· 대중교통이 저렴' : '· 자가용이 저렴'}
          </span>
        </div>
      </div>
    </div>
  );
}

interface ModeCardProps {
  title: string;
  icon: React.ReactNode;
  minutes: number;
  cost: number;
  extraLabel: string;
  extraValue: string;
  emphasized: boolean;
}

function ModeCard({ title, icon, minutes, cost, extraLabel, extraValue, emphasized }: ModeCardProps) {
  return (
    <div
      className={[
        'rounded-card px-3 py-3 border transition-colors',
        emphasized
          ? 'border-brand bg-brand/5'
          : 'border-line-light dark:border-line-dark bg-surface dark:bg-surface-dark-elevated-hover',
      ].join(' ')}
    >
      <div className="flex items-center gap-2 mb-2">
        <span className={emphasized ? 'text-brand' : 'text-ink-secondary dark:text-ink-secondary-dark'}>
          {icon}
        </span>
        <span className="text-sm font-semibold text-ink-primary dark:text-ink-primary-dark">
          {title}
        </span>
        {emphasized && (
          <span className="ml-auto text-2xs font-bold text-brand px-1.5 py-0.5 rounded bg-brand/10">
            빠름
          </span>
        )}
      </div>

      <div className="flex items-baseline gap-1 mb-1">
        <span className="text-2xl font-extrabold text-ink-primary dark:text-ink-primary-dark tabular-nums tracking-tight">
          {minutes}
        </span>
        <span className="text-xs text-ink-tertiary dark:text-ink-tertiary-dark font-medium">분</span>
      </div>

      <div className="flex items-center justify-between text-2xs text-ink-tertiary dark:text-ink-tertiary-dark tabular-nums">
        <span>
          편도 <span className="font-semibold text-ink-secondary dark:text-ink-secondary-dark">{cost.toLocaleString()}원</span>
        </span>
        <span>
          {extraLabel} <span className="font-semibold text-ink-secondary dark:text-ink-secondary-dark">{extraValue}</span>
        </span>
      </div>
    </div>
  );
}

function TransitIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="4" y="3" width="16" height="16" rx="2" />
      <path d="M4 11h16" />
      <path d="M8 15h.01" />
      <path d="M16 15h.01" />
      <path d="m6 19-2 3" />
      <path d="m18 19 2 3" />
    </svg>
  );
}

function CarIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 16H9m10 0h3v-3.15a1 1 0 0 0-.84-.99L16 11l-2.7-3.6a1 1 0 0 0-.8-.4H5.24a2 2 0 0 0-1.8 1.1l-.8 1.63A6 6 0 0 0 2 12.42V16h2" />
      <circle cx="6.5" cy="16.5" r="2.5" />
      <circle cx="16.5" cy="16.5" r="2.5" />
    </svg>
  );
}
