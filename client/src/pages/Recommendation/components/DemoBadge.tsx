/**
 * DEMO 뱃지 — mock 폴백 시 우상단에 노출
 *  - 데이터 출처를 숨기지 않는다는 21일 의사결정 반영
 *  - 토스 톤: 작은 둥근 알약, 노란/주황 톤 (warn) 으로 시선 끌되 자극적이지 않게
 *  - hover 툴팁으로 사유 노출 (있을 시)
 */
interface Props {
  /** undefined 또는 'api' 이면 렌더링 안 함 */
  visible: boolean;
  /** hover 시 노출할 짧은 사유 */
  reason?: string;
}

export function DemoBadge({ visible, reason }: Props) {
  if (!visible) return null;
  return (
    <span
      title={reason ? `mock 데이터 사용 — ${reason}` : 'mock 데이터 사용'}
      role="status"
      className="inline-flex items-center gap-1 text-2xs font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 tabular-nums"
    >
      <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <circle cx="12" cy="12" r="10" />
      </svg>
      DEMO
    </span>
  );
}
