/**
 * useGaPageViews — SPA 라우트 전환을 GA4(gtag.js)에 page_view 로 전달
 *
 *  배경 (2026-06-04):
 *    index.html 의 gtag.js 기본 스니펫은 `gtag('config', …)` 로딩 시 **최초 page_view 1회**만 보낸다.
 *    이 앱은 react-router SPA 라 /intro → /home → /region/:code 등 클라이언트 라우트 전환은
 *    문서 재로딩이 없어 추가 집계되지 않는다. 이 훅이 라우트 변경마다 gtag page_view 이벤트를 보낸다.
 *
 *  중복 방지:
 *    gtag('config') 가 로드 시 첫 page_view 를 자동 전송하므로 **최초 마운트는 건너뛰고**
 *    이후 전환부터 전송한다. (안 그러면 랜딩 페이지가 2회 집계됨.)
 *
 *  ⚠️ GA4 Enhanced Measurement 와의 중복:
 *    GA4 '향상된 측정 > 브라우저 기록 이벤트 기반 페이지 변경'이 켜져 있으면(기본 ON) GA 가 SPA
 *    history 변경을 자동 page_view 로 잡아 본 훅과 **이중 집계**된다. 본 훅으로 명시 제어하려면 해당
 *    옵션을 끄고, 자동 측정에 맡기려면 본 훅 호출을 제거할 것. (둘 중 하나만.)
 *
 *  사용: App 컴포넌트(BrowserRouter 하위)에서 `useGaPageViews()` 1회 호출.
 */
import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

export function useGaPageViews(): void {
  const location = useLocation();
  // 최초 마운트(=gtag config 기본 page_view 와 동일 시점)는 건너뜀
  const isFirst = useRef(true);

  useEffect(() => {
    if (isFirst.current) {
      isFirst.current = false;
      return;
    }

    // gtag 미로딩(스니펫 차단·로컬 등) 환경에서도 안전
    window.gtag?.('event', 'page_view', {
      page_path: location.pathname + location.search,
      page_location: window.location.href,
      page_title: document.title,
    });
  }, [location.pathname, location.search]);
}
