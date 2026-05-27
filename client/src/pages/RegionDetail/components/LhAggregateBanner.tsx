/**
 * LH 청년주택 집계 배너
 *  - Depth 3 상단에서 "이 [행정동/시군구]에 LH 청년주택 N호 공급 중" 안내
 *  - 단지 디테일이 없는 LH 데이터를 정직하게 집계 형태로만 노출
 *  - totalRows === 0 이면 배너 자체를 숨김 (null 반환)
 *
 *  Phase 1.5 (2026-05-27): 시군구 단위만
 *  Phase 2-B (2026-05-27): 행정동 정밀도 지원 — scope=DONG 일 때 "이 동" 으로 표시
 */
import type { LhSummary, LhSummaryScope } from '../../../types/region-detail';

interface Props {
  summary: LhSummary | null;
  /** "강남구", "영등포구" 같은 시군구 표시명 */
  sigunguDisplayName?: string;
  /** "역삼동", "당산동" 같은 행정동 표시명 (Phase 2-B) */
  dongDisplayName?: string;
}

/** scope → 표시용 정밀도 라벨 + tone */
function scopeMeta(scope: LhSummaryScope | undefined) {
  switch (scope) {
    case 'DONG':
      return { label: '행정동', tone: 'bg-positive/15 text-positive', precise: true };
    case 'SIGUNGU':
      return { label: '시군구', tone: 'bg-brand/15 text-brand', precise: false };
    default:
      return { label: '집계', tone: 'bg-ink-tertiary/15 text-ink-tertiary', precise: false };
  }
}

function rentRangeLabel(min: number | null, max: number | null): string {
  if (min == null && max == null) return '월세 정보 없음';
  if (min != null && max != null && min !== max) return `월세 ${min}~${max}만`;
  const v = (min ?? max) as number;
  return `월세 ${v}만`;
}

export function LhAggregateBanner({ summary, sigunguDisplayName, dongDisplayName }: Props) {
  if (!summary || summary.totalRows === 0) return null;

  const meta = scopeMeta(summary.scope);
  const where = meta.precise
    ? (dongDisplayName ?? '이 동')
    : (sigunguDisplayName ?? '이 시군구');

  // 행정동 모드에서 시군구 통계도 함께 있으면 비교 노출
  const showSigunguHint =
    summary.scope === 'DONG' &&
    typeof summary.sigunguTotalUnits === 'number' &&
    summary.sigunguTotalUnits > summary.totalUnits;

  return (
    <section
      aria-label="LH 청년주택 공급 현황"
      className="shrink-0 rounded-cardlg border border-positive/30 bg-positive/[.06] p-3.5"
    >
      <div className="flex items-start gap-2 mb-2">
        <span className="shrink-0 text-2xs font-bold px-1.5 py-0.5 rounded bg-positive/15 text-positive leading-tight mt-0.5">
          LH
        </span>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-bold text-ink-primary dark:text-ink-primary-dark">
            {where}에 LH 청년주택{' '}
            <span className="tabular-nums text-positive">{summary.totalUnits.toLocaleString()}호</span>{' '}
            공급 중
            <span className={`ml-2 text-2xs font-semibold px-1.5 py-0.5 rounded ${meta.tone}`}>{meta.label}</span>
          </h3>
          <p className="text-2xs text-ink-tertiary dark:text-ink-tertiary-dark mt-0.5">
            행복주택·청년매입임대·전세임대 합산 · 단지 단위 정보는 LH 공식 사이트 참고
            {showSigunguHint && (
              <span className="ml-1 opacity-80">
                · 시군구 전체 {summary.sigunguTotalUnits!.toLocaleString()}호
              </span>
            )}
          </p>
        </div>
      </div>

      {/* programType 별 칩 — units 내림차순으로 정렬돼 들어옴 */}
      <ul className="flex flex-wrap gap-1.5">
        {summary.programs.map((p) => (
          <li
            key={p.programType}
            className="text-2xs font-medium px-2 py-1 rounded-full bg-surface-elevated dark:bg-surface-dark-elevated border border-line-light dark:border-line-dark text-ink-secondary dark:text-ink-secondary-dark"
            title={rentRangeLabel(p.monthlyRentMin, p.monthlyRentMax)}
          >
            <span className="font-semibold text-ink-primary dark:text-ink-primary-dark">{p.programType}</span>{' '}
            <span className="tabular-nums">{p.units.toLocaleString()}호</span>
            <span className="ml-1.5 opacity-60 tabular-nums">· {rentRangeLabel(p.monthlyRentMin, p.monthlyRentMax)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
