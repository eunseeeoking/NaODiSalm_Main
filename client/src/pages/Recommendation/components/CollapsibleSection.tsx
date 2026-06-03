/**
 * 접이식 섹션 (좌측 패널 아코디언) — 2026-05-30 P3 후속
 *  - 헤더: 아이콘 박스 + 제목(+ 선택 툴팁) + chevron. 클릭 시 본문 토글.
 *  - 접힌 상태: 헤더(아이콘 + 라벨)만 남아 작게 — "아이콘 박스" 형태.
 *  - 제어형(controlled): 열림 상태는 부모(LeftPanel)가 관리 → 한 번에 하나만 열림.
 */
import { type ReactNode } from 'react';
import { InfoTooltip } from '../../../components/InfoTooltip';

interface Props {
  /** 헤더 좌측 아이콘 (인라인 SVG 등) */
  icon: ReactNode;
  /** 섹션 제목 (접힘 시에도 노출되는 라벨) */
  title: string;
  /** 제목 옆 도움말 (선택) */
  tooltip?: string;
  /** 펼침 여부 (부모가 관리) */
  open: boolean;
  /** 헤더 클릭 시 호출 — 부모가 열림 상태 전환 */
  onToggle: () => void;
  children: ReactNode;
}

export function CollapsibleSection({
  icon,
  title,
  tooltip,
  open,
  onToggle,
  children,
}: Props) {
  const chevron = (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 text-ink-tertiary dark:text-ink-tertiary-dark transition-transform duration-200 ${
        open ? 'rotate-180' : ''
      }`}
      aria-hidden="true"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );

  return (
    <div className="bg-surface-elevated dark:bg-surface-dark-elevated border border-line-light dark:border-line-dark rounded-cardlg shadow-card overflow-hidden shrink-0">
      {/* 헤더 행 — 토글 버튼 + (선택)툴팁 분리 (InfoTooltip 이 자체 button 이라 중첩 회피) */}
      <div className="flex items-center gap-1.5 px-3 py-2.5 hover:bg-brand-50/60 dark:hover:bg-brand/[.08] transition-colors">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="flex items-center gap-2.5 flex-1 min-w-0 text-left"
        >
          <span className="shrink-0 w-7 h-7 rounded-card bg-brand-50 dark:bg-brand/[.15] text-brand dark:text-brand-300 flex items-center justify-center">
            {icon}
          </span>
          <span className="flex-1 min-w-0 text-sm font-bold text-ink-primary dark:text-ink-primary-dark truncate">
            {title}
          </span>
        </button>
        {tooltip && <InfoTooltip text={tooltip} position="bottom" />}
        <button
          type="button"
          onClick={onToggle}
          aria-label={`${title} 펼치기/접기`}
          className="shrink-0 flex items-center"
        >
          {chevron}
        </button>
      </div>

      {/* 부드러운 펼침/접힘 — grid-rows 0fr↔1fr 트랜지션 (auto 높이도 애니메이션) */}
      <div
        className={`grid transition-[grid-template-rows] duration-300 ease-in-out ${
          open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        }`}
      >
        <div className="overflow-hidden min-h-0">
          <div className="px-3 pb-3 pt-0.5">{children}</div>
        </div>
      </div>
    </div>
  );
}
