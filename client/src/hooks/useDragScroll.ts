/**
 * 수평 스크롤 영역을 "슬라이더"처럼 동작시키는 훅
 *
 *  - 마우스로 클릭 후 드래그하면 좌우로 스크롤 (데스크톱)
 *  - 세로 휠(deltaY) → 가로 스크롤로 변환 (트랙패드 가로 스크롤은 그대로 통과)
 *  - 터치 스와이프는 브라우저 기본 동작에 위임 (모바일)
 *  - 드래그로 판단되면 직후 발생하는 click 1회를 무시 → 칩/카드 오선택 방지
 *
 *  스크롤바 숨김은 `.scroll-x-slider` CSS 클래스가 담당한다.
 *  사용:  const ref = useDragScroll<HTMLDivElement>();  <div ref={ref} className="... scroll-x-slider" />
 */
import { useEffect, useRef } from 'react';

/** 드래그로 간주하는 최소 이동 거리(px) — 이보다 작으면 클릭으로 처리 */
const DRAG_THRESHOLD = 5;

export function useDragScroll<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let isDown = false;
    let startX = 0;
    let startScroll = 0;
    let moved = 0;

    const hasOverflow = () => el.scrollWidth > el.clientWidth + 1;

    const onPointerDown = (e: PointerEvent) => {
      // 좌클릭 + 가로 오버플로 있을 때만, 터치/펜은 네이티브 스크롤에 위임
      if (e.button !== 0 || e.pointerType === 'touch' || !hasOverflow()) return;
      isDown = true;
      moved = 0;
      startX = e.clientX;
      startScroll = el.scrollLeft;
      el.classList.add('is-dragging');
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!isDown) return;
      const dx = e.clientX - startX;
      moved = Math.max(moved, Math.abs(dx));
      el.scrollLeft = startScroll - dx;
      e.preventDefault();
    };

    const endDrag = () => {
      if (!isDown) return;
      isDown = false;
      el.classList.remove('is-dragging');
    };

    // 드래그 직후의 click 은 1회 차단 (버튼형 칩 오선택 방지)
    const onClickCapture = (e: MouseEvent) => {
      if (moved > DRAG_THRESHOLD) {
        e.preventDefault();
        e.stopPropagation();
        moved = 0;
      }
    };

    const onWheel = (e: WheelEvent) => {
      if (!hasOverflow()) return;
      // 트랙패드 가로 스크롤(deltaX 우세)은 기본 동작 유지, 세로 휠만 가로로 변환
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      el.scrollLeft += e.deltaY;
      e.preventDefault();
    };

    el.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove, { passive: false });
    window.addEventListener('pointerup', endDrag);
    el.addEventListener('click', onClickCapture, true);
    el.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      el.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', endDrag);
      el.removeEventListener('click', onClickCapture, true);
      el.removeEventListener('wheel', onWheel);
    };
  }, []);

  return ref;
}
