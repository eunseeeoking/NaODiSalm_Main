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
 *
 *  ▷ 콜백 ref 방식 (2026-06-07 수정 — Depth3 매물 카드 스와이퍼 먹통 근본 해결)
 *    기존 `useRef + useEffect([])` 는 마운트 시점에 `ref.current` 가 가리키는 노드에만
 *    1회 부착했다. "빈 상태(early-return·로딩) → 데이터 채워져 대상 div 가 뒤늦게 마운트"
 *    되는 컴포넌트(예: ComplexCardList)에서는 effect 가 `el=null` 로 한 번 돌고 끝나
 *    실제 카드 div 에는 리스너가 영영 안 붙었다(드래그·휠 전부 먹통).
 *    → 콜백 ref 로 노드가 DOM 에 붙는/떨어지는 순간마다 (재)부착·정리해 타이밍 무관하게 동작.
 */
import { useCallback, useRef } from 'react';

/** 드래그로 간주하는 최소 이동 거리(px) — 이보다 작으면 클릭으로 처리 */
const DRAG_THRESHOLD = 5;

export function useDragScroll<T extends HTMLElement = HTMLDivElement>() {
  // 직전 부착 노드의 정리 함수 — 재마운트/언마운트 시 중복 부착 방지
  const detachRef = useRef<(() => void) | null>(null);

  return useCallback((el: T | null) => {
    // 이전 노드가 있으면 먼저 정리
    if (detachRef.current) {
      detachRef.current();
      detachRef.current = null;
    }
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

    detachRef.current = () => {
      el.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', endDrag);
      el.removeEventListener('click', onClickCapture, true);
      el.removeEventListener('wheel', onWheel);
      el.classList.remove('is-dragging');
    };
  }, []);
}
