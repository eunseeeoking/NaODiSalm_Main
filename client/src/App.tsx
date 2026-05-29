/**
 * 라우트 컨테이너 + 테마 적용
 *
 *  /              → 항상 /intro 로 리다이렉트 (방문 횟수 무관, intro 게이트)
 *  /intro         → 서비스 소개 + 데모 노출 랜딩 (Phase 7, 2026-05-28)
 *  /home          → Depth 2 · 추천 메인 (실제 메인 페이지)
 *  /region/:code  → Depth 3 · 단지 상세
 *  /about/data    → 4기관 데이터 융합 현황
 *  *              → /home 으로 리다이렉트 (미지정 경로)
 *
 *  2026-05-29: intro 게이트 전면화 — bare "/" 진입은 최초/재방문 구분 없이 항상 /intro.
 *              실제 메인은 /home 으로 분리. 랜딩 CTA·앱 내부 "메인" 링크는 /home 사용.
 *              (localStorage 'nadirisal:intro-seen' 1회 가드 폐기.)
 *  2026-05-28: /explore 라우트 비활성화 — 로그인 미사용으로 fetchMe 401 방지.
 *              재활성화 시 ExplorePage import + Route 주석 해제.
 *
 *  ※ 테마 변경 시 <html> 클래스를 'dark' 로 토글
 *    Tailwind 의 dark: prefix 와 src/css/index.css 의 html.dark 셀렉터가 모두 활성화됨
 */
import { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useThemeStore } from './stores/useThemeStore';
import { RecommendationPage } from './pages/Recommendation';
// import { ExplorePage } from './pages/Explore'; // 2026-05-28: 로그인 미사용, 401 방지
import { RegionDetailPage } from './pages/RegionDetail';
import { AboutDataPage } from './pages/AboutData';
import { LandingPage } from './pages/Landing';

export default function App() {
  const theme = useThemeStore((s) => s.theme);

  // 테마 → <html> 클래스 동기화
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') root.classList.add('dark');
    else root.classList.remove('dark');
  }, [theme]);

  return (
    <Routes>
      {/* bare "/" 는 언제나 intro 게이트 → 메인은 /home */}
      <Route path="/" element={<Navigate to="/intro" replace />} />
      <Route path="/intro" element={<LandingPage />} />
      <Route path="/home" element={<RecommendationPage />} />
      <Route path="/region/:legalDongCode" element={<RegionDetailPage />} />
      {/* <Route path="/explore" element={<ExplorePage />} /> */}
      <Route path="/about/data" element={<AboutDataPage />} />
      <Route path="*" element={<Navigate to="/home" replace />} />
    </Routes>
  );
}
