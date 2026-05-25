/**
 * InfoTooltip — ⓘ 아이콘 + 호버/포커스 시 설명 말풍선
 *
 *  사용 예:
 *    <InfoTooltip text="RIR — 월 소득 대비 주거비 비율입니다." />
 *    <InfoTooltip text="..." position="right" />
 *
 *  특성:
 *    - hover + focus 모두 동작 (마우스 / 키보드 접근성)
 *    - 다크 모드 대응 (design token 색상 사용)
 *    - position: 'top' | 'right' | 'bottom'  (기본 top)
 *    - 툴팁 너비 max-w-[13rem] — 긴 텍스트는 자동 줄바꿈
 *    - pointer-events-none 으로 툴팁 자체는 호버 영역 차단 안 함
 *
 *  ── stacking context 탈출 ─────────────────────────────────────
 *  말풍선은 createPortal 로 document.body 에 렌더한다.
 *  부모(예: Recommendation 페이지의 LeftPanel wrapper)가 `transform` 또는
 *  `z-index` 로 새 stacking context 를 만들어도 툴팁이 갇히지 않는다.
 *  또한 `overflow-y-auto` 스크롤 컨테이너에 의한 클리핑도 회피한다.
 *  ──────────────────────────────────────────────────────────────
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

interface Props {
  text: string;
  position?: 'top' | 'right' | 'bottom';
  className?: string;
}

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

/** 아이콘의 viewport 좌표를 받아 툴팁 position 별 좌표 + transform 을 산출 */
function computeTipStyle(
  iconRect: Rect,
  position: 'top' | 'right' | 'bottom',
): React.CSSProperties {
  const gap = 8; // 아이콘과 툴팁 사이 여백
  const cx = iconRect.left + iconRect.width / 2;
  const cy = iconRect.top + iconRect.height / 2;

  switch (position) {
    case 'top':
      return {
        position: 'fixed',
        top: iconRect.top - gap,
        left: cx,
        transform: 'translate(-50%, -100%)',
      };
    case 'bottom':
      return {
        position: 'fixed',
        top: iconRect.top + iconRect.height + gap,
        left: cx,
        transform: 'translateX(-50%)',
      };
    case 'right':
    default:
      return {
        position: 'fixed',
        top: cy,
        left: iconRect.left + iconRect.width + gap,
        transform: 'translateY(-50%)',
      };
  }
}

export function InfoTooltip({ text, position = 'top', className = '' }: Props) {
  const [open, setOpen] = useState(false);
  const [iconRect, setIconRect] = useState<Rect | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // open 상태로 바뀌면 즉시 아이콘 좌표 캡처(레이아웃 phase)
  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    setIconRect({ top: r.top, left: r.left, width: r.width, height: r.height });
  }, [open]);

  // 열려 있는 동안 스크롤/리사이즈 발생 시 좌표 갱신
  useEffect(() => {
    if (!open) return;
    const update = () => {
      if (!triggerRef.current) return;
      const r = triggerRef.current.getBoundingClientRect();
      setIconRect({ top: r.top, left: r.left, width: r.width, height: r.height });
    };
    window.addEventListener('scroll', update, true); // capture: 내부 스크롤 컨테이너도 포착
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [open]);

  const tipStyle: React.CSSProperties = iconRect
    ? computeTipStyle(iconRect, position)
    : { display: 'none' };

  return (
    <span
      className={`relative inline-flex items-center shrink-0 ${className}`}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      <button
        ref={triggerRef}
        type="button"
        tabIndex={0}
        aria-label="용어 설명 보기"
        aria-expanded={open}
        className="
          inline-flex items-center justify-center
          w-[14px] h-[14px] rounded-full
          text-[9px] font-bold leading-none select-none
          text-ink-tertiary dark:text-ink-tertiary-dark
          border border-line-light dark:border-line-dark
          bg-surface dark:bg-surface-dark-elevated-hover
          hover:text-brand hover:border-brand
          focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand
          transition-colors cursor-help
        "
      >
        i
      </button>

      {open && iconRect &&
        createPortal(
          <span
            role="tooltip"
            style={{ ...tipStyle, zIndex: 9999 }}
            className="
              max-w-[13rem] w-max
              text-[11px] leading-relaxed font-normal
              text-ink-secondary dark:text-ink-secondary-dark
              bg-surface-elevated dark:bg-surface-dark-elevated
              border border-line-light dark:border-line-dark
              rounded-card shadow-card-hover
              px-2.5 py-2
              pointer-events-none whitespace-normal
            "
          >
            {text}
          </span>,
          document.body,
        )}
    </span>
  );
}
