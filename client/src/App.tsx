/**
 * 라우트 컨테이너
 *
 *  /          → Depth 2 · 지역 추천 (메인)
 *  /explore   → 기존 시군구별 매물 탐색 (원본 데이터 둘러보기)
 *  *          → / 로 리다이렉트
 *
 *  ※ 인증 상태는 현재 각 페이지가 직접 fetchMe 호출 — 추후 useAuthStore 로 통합 예정
 */
import { Routes, Route, Navigate } from 'react-router-dom';
import { RecommendationPage } from './pages/Recommendation';
import { ExplorePage } from './pages/Explore';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<RecommendationPage />} />
      <Route path="/explore" element={<ExplorePage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
