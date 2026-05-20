/**
 * Depth 3 헤더
 *  - 좌: 뒤로가기 + 지역명
 *  - 우: 종합점수 + 4축 점수 미니뷰
 *  - 토스 한국형 톤, 다크모드 대응
 */
import type { RegionRecommendation } from '../../../types/recommendation';
import { useThemeStore } from '../../../stores/useThemeStore';
import { useShareUrl } from '../../Recommendation/hooks/useShareUrl';
import { DemoBadge } from '../../Recommendation/components/DemoBadge';

interface Props {
  region: RegionRecommendation;
  onBack: () => void;
}

const METRICS: ReadonlyArray<{ label: string; key: keyof Pick<RegionRecommendation, 'commuteScore' | 'valueScore' | 'investmentScore' | 'lifeScore'> }> = [
  { label: '통근', key: 'commuteScore' },
  { label: '가성비', key: 'valueScore' },
  { label: '투자', key: 'investmentScore' },
  { label: '생활', key: 'lifeScore' },
];

export function RegionDetailHeader({ region, onBack }: Props) {
  const theme = useThemeStore((s) => s.theme);
  const toggle = useThemeStore((s) => s.toggle);

  // Depth 3 에서도 [공유] — 현재 region 페이지 URL 을 그대로 공유 (workplace/weights 쿼리 동봉)
  // 받는 쪽이 같은 단지를 자동 선택하지는 않음 (selectedComplexId 미공유) → 후속 작업으로 분리
  const { share, copyState, canShare } = useShareUrl();

  return (
    <header className="shrink-0 px-4 py-3 border-b border-line-light dark:border-line-dark bg-surface-elevated dark:bg-surface-dark-elevated">
      <div className="flex items-center gap-4">
        {/* 뒤로가기 + 브랜드 */}
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-card text-sm font-semibold text-ink-secondary dark:text-ink-secondary-dark hover:bg-surface dark:hover:bg-surface-dark-elevated-hover transition-colors"
          aria-label="추천 페이지로 돌아가기"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M19 12H5" />
            <path d="m12 19-7-7 7-7" />
          </svg>
          돌아가기
        </button>

        <div className="hidden lg:flex items-center gap-1.5 text-sm font-bold text-ink-primary dark:text-ink-primary-dark tracking-tight pr-1">
          <img src="/logo.svg" alt="" className="w-5 h-5" aria-hidden="true" />
          <span>나어디삶</span>
          <span className="text-ink-tertiary dark:text-ink-tertiary-dark font-medium mx-1">·</span>
        </div>

        {/* Depth 3 는 매물/LSTM/통근 비교 모두 mock 기반 — 항상 DEMO 노출 */}
        <DemoBadge visible reason="매물·LSTM·통근 비교가 모두 mock — Sprint C 에서 대체" />


        {/* 지역명 */}
        <div className="flex items-baseline gap-2">
          <h1 className="text-lg font-bold text-ink-primary dark:text-ink-primary-dark tracking-tight">
            {region.displayName}
          </h1>
          <span className="text-xs text-ink-tertiary dark:text-ink-tertiary-dark tabular-nums">
            {region.legalDongCode}
          </span>
        </div>

        {/* 4축 점수 (가운데, 여유 공간) */}
        <div className="hidden md:flex flex-1 justify-center items-center gap-5">
          {METRICS.map((m) => (
            <div key={m.label} className="flex items-center gap-1.5">
              <span className="text-xs font-medium text-ink-tertiary dark:text-ink-tertiary-dark">
                {m.label}
              </span>
              <span className="text-sm font-bold text-ink-primary dark:text-ink-primary-dark tabular-nums">
                {region[m.key]}
              </span>
            </div>
          ))}
        </div>

        {/* 우측: 종합점수 + 공유 + 테마 토글 */}
        <div className="ml-auto flex items-center gap-3">
          <div className="flex items-baseline gap-1">
            <span className="text-xs font-medium text-ink-tertiary dark:text-ink-tertiary-dark">
              종합
            </span>
            <span className="text-2xl font-extrabold text-brand tabular-nums tracking-tight">
              {region.totalScore}
            </span>
            <span className="text-xs text-ink-tertiary dark:text-ink-tertiary-dark">점</span>
          </div>

          {/* [공유] — workplace 없을 땐 비활성 */}
          <button
            type="button"
            onClick={share}
            disabled={!canShare}
            className="relative flex items-center gap-1.5 px-3 py-1.5 rounded-card border border-line-light dark:border-line-dark hover:bg-surface dark:hover:bg-surface-dark-elevated-hover text-ink-secondary dark:text-ink-secondary-dark transition-colors shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
            aria-label="현재 지역 URL 공유"
            title={canShare ? '현재 지역 URL 을 클립보드에 복사' : '직장을 먼저 입력하세요'}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="18" cy="5" r="3" />
              <circle cx="6" cy="12" r="3" />
              <circle cx="18" cy="19" r="3" />
              <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
              <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
            </svg>
            <span className="text-xs font-semibold">
              {copyState === 'ok' ? '복사됨' : copyState === 'fail' ? '실패' : '공유'}
            </span>
          </button>

          <button
            onClick={toggle}
            className="w-9 h-9 flex items-center justify-center rounded-card text-ink-secondary dark:text-ink-secondary-dark hover:bg-surface dark:hover:bg-surface-dark-elevated-hover transition-colors"
            aria-label={theme === 'dark' ? '라이트 모드' : '다크 모드'}
          >
            {theme === 'dark' ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2v2" /><path d="M12 20v2" /><path d="m4.93 4.93 1.41 1.41" /><path d="m17.66 17.66 1.41 1.41" /><path d="M2 12h2" /><path d="M20 12h2" /><path d="m6.34 17.66-1.41 1.41" /><path d="m19.07 4.93-1.41 1.41" />
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </header>
  );
}
