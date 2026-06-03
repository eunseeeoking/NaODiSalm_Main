/**
 * useGtmPageViews — SPA 라우트 전환을 GTM(dataLayer)에 page_view 로 전달
 *
 *  배경 (2026-06-04 신설):
 *    index.html 의 GTM 기본 스니펫은 **최초 문서 로드 시 1회만** pageview 를 잡는다.
 *    이 앱은 react-router SPA 라 /intro → /home → /region/:code 등 클라이언트 라우트
 *    전환은 문서 재로딩이 없어 자동 집계되지 않는다. 이 훅이 라우트 변경마다
 *    dataLayer 에 page_view 이벤트를 push 해 GTM 이 GA4 이벤트 태그를 발화할 수 있게 한다.
 *
 *  중복 방지:
 *    GA4 설정 태그가 컨테이너 로드 시 첫 페이지뷰를 자동 전송하므로, **최초 마운트는 건너뛰고**
 *    이후 전환부터 push 한다. (안 그러면 랜딩 페이지가 2회 집계됨.)
 *
 *  GTM 설정 (대시보드에서 1회):
 *    트리거: 맞춤 이벤트 = `page_view`
 *    태그:   GA4 이벤트 태그(event_name=page_view) + 매개변수 page_path/page_location/page_title 전달
 *    (또는 GTM 기본 'History Change' 트리거를 쓰면 이 훅 없이도 동작하나, 제목 타이밍·이벤트
 *     명세를 명시적으로 제어하기 위해 본 훅 방식을 채택.)
 *
 *  사용:
 *    App 컴포넌트(BrowserRouter 하위)에서 `useGtmPageViews()` 1회 호출.
 */
import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';

declare global {
  interface Window {
    dataLayer?: Record<string, unknown>[];
  }
}

export function useGtmPageViews(): void {
  const location = useLocation();
  // 최초 마운트(=GTM 기본 pageview 와 동일 시점)는 건너뜀
  const isFirst = useRef(true);

  useEffect(() => {
    if (isFirst.current) {
      isFirst.current = false;
      return;
    }

    // GTM 미로딩(스니펫 차단·로컬 등) 환경에서도 안전하도록 배열 보장
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({
      event: 'page_view',
      page_path: location.pathname + location.search,
      page_location: window.location.href,
      page_title: document.title,
    });
  }, [location.pathname, location.search]);
}
