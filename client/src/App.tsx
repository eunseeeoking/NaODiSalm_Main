/**
 * 라우트 컨테이너 + 테마 적용
 *
 *  /              → Depth 2 · 지역 추천 (메인)
 *  /region/:code  → Depth 3 · 단지 상세
 *  /about/data    → 4기관 데이터 융합 현황
 *  *              → / 로 리다이렉트
 *
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
      <Route path="/" element={<RecommendationPage />} />
      <Route path="/region/:legalDongCode" element={<RegionDetailPage />} />
      {/* <Route path="/explore" element={<ExplorePage />} /> */}
      <Route path="/about/data" element={<AboutDataPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
