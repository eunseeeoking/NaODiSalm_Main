/**
 * Depth 2 상단 헤더 (토스 한국형 톤)
 *  - 로고 + 직장 검색 + 공유 + 테마 토글 + /explore 링크
 *  - 예산 슬라이더는 좌측 패널(CommutePatienceSlider) 로 이동 — 통근 인내심과 같은 블록
 *  - 모든 라벨 한글
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useRecommendationStore } from '../../../stores/useRecommendationStore';
import { useThemeStore } from '../../../stores/useThemeStore';
import { WorkplaceSearch } from './WorkplaceSearch';
import { buildShareUrl } from '../utils/urlState';
import { DemoBadge } from './DemoBadge';
// 로고는 client/public/logo.svg — 절대 경로로 직접 참조 (import 불필요)

/** Clipboard API 미지원/권한거부 환경 폴백 (file:// 등) */
function legacyCopy(text: string): boolean {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

export function RecommendationHeader() {
  const budget = useRecommendationStore((s) => s.budget);
  const workplace = useRecommendationStore((s) => s.workplace);
  const weights = useRecommendationStore((s) => s.weights);
  const patience = useRecommendationStore((s) => s.patience);
  const dataSource = useRecommendationStore((s) => s.dataSource);
  const theme = useThemeStore((s) => s.theme);
  const toggleTheme = useThemeStore((s) => s.toggle);

  const [copyState, setCopyState] = useState<'idle' | 'ok' | 'fail'>('idle');

  async function handleShare() {
    const path = buildShareUrl({ workplace, budget, weights, patience });
    const absolute = `${window.location.origin}${path}`;
    let ok = false;
    try {
      await navigator.clipboard.writeText(absolute);
      ok = true;
    } catch {
      ok = legacyCopy(absolute);
    }
    setCopyState(ok ? 'ok' : 'fail');
    window.setTimeout(() => setCopyState('idle'), 1500);
  }

  return (
    <header className="bg-surface-elevated dark:bg-surface-dark-elevated border-b border-line-light dark:border-line-dark px-3 md:px-5 py-2.5 md:py-3 flex items-center gap-2 md:gap-3 shadow-card">
      <h1 className="text-base md:text-lg font-extrabold text-ink-primary dark:text-ink-primary-dark tracking-tight shrink-0 flex items-center gap-1.5">
        <img src="/logo.svg" alt="나어디삶 로고" className="w-6 h-6 md:w-7 md:h-7" />
        <span className="hidden sm:inline">나어디삶</span>
      </h1>
      <DemoBadge
        visible={dataSource === 'mock'}
        reason="서버 추천 API 미구현 — Sprint C 에서 대체"
      />
      <div className="h-4 w-px bg-line-light dark:bg-line-dark shrink-0 hidden sm:block" />

      <div className="flex-1 min-w-0 md:max-w-2xl">
        <WorkplaceSearch />
      </div>

      {/* 공유 버튼 — workplace 가 있을 때만 의미 있음. 모바일은 아이콘만 */}
      <button
        onClick={handleShare}
        disabled={!workplace}
        className="relative flex items-center gap-1.5 px-2 md:px-3 py-1.5 rounded-card bg-brand-50 dark:bg-brand/[.15] text-brand dark:text-brand-300 hover:bg-brand hover:text-white transition-colors shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
        aria-label="현재 조건 URL 공유"
        title={workplace ? '현재 조건을 URL로 공유' : '직장을 먼저 입력하세요'}
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
        >
          <circle cx="18" cy="5" r="3" />
          <circle cx="6" cy="12" r="3" />
          <circle cx="18" cy="19" r="3" />
          <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
          <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
        </svg>
        <span className="text-xs font-medium hidden sm:inline">
          {copyState === 'ok' ? '복사됨' : copyState === 'fail' ? '실패' : '공유'}
        </span>
      </button>

      {/* 테마 토글 */}
      <button
        onClick={toggleTheme}
        className="p-2 rounded-card bg-brand-50 dark:bg-brand/[.15] text-brand dark:text-brand-300 hover:bg-brand hover:text-white transition-colors shrink-0"
        aria-label="테마 전환"
        title={theme === 'dark' ? '라이트 모드' : '다크 모드'}
      >
        {theme === 'dark' ? (
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2" />
            <path d="M12 20v2" />
            <path d="m4.93 4.93 1.41 1.41" />
            <path d="m17.66 17.66 1.41 1.41" />
            <path d="M2 12h2" />
            <path d="M20 12h2" />
            <path d="m6.34 17.66-1.41 1.41" />
            <path d="m19.07 4.93-1.41 1.41" />
          </svg>
        ) : (
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
          </svg>
        )}
      </button>

      <Link
        to="/explore"
        className="hidden md:inline-block text-xs font-medium text-ink-tertiary dark:text-ink-tertiary-dark hover:text-brand shrink-0 transition-colors border-none"
      >
        시군구 탐색 →
      </Link>
    </header>
  );
}
