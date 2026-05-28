/**
 * 라우트 컨테이너 + 테마 적용
 *
 *  /              → 최초 방문자: /intro 자동 리다이렉트 / 복귀 방문자: Depth 2 (RootRoute 가드)
 *  /intro         → 서비스 소개 + 데모 노출 랜딩 (Phase 7, 2026-05-28)
 *  /region/:code  → Depth 3 · 단지 상세
 *  /about/data    → 4기관 데이터 융합 현황
 *  *              → / 로 리다이렉트
 *
 *  2026-05-28 (D-1 PM): RootRoute 가드 도입 — naodisalm.kr/ 첫 방문 시 /intro 강제 노출.
 *                       localStorage 'nadirisal:intro-seen'=1 설정 후 복귀 사용자는 즉시 / 통과.
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

/** localStorage 키 — 도메인 단위 prefix, 다른 키와 충돌 회피 */
const INTRO_SEEN_KEY = 'nadirisal:intro-seen';

/**
 * 최초 방문자 가드 — naodisalm.kr/ 첫 진입 시 /intro 로 1회 리다이렉트.
 *
 *  플로우:
 *    1) 최초 방문   → localStorage 미설정 → flag 셋팅 + /intro 리다이렉트
 *    2) /intro 에서 "지금 추천 받기" → / 진입 → flag 셋팅됨 → RecommendationPage
 *    3) 다음 방문   → flag 있음 → 바로 RecommendationPage (랜딩 안 거침)
 *
 *  localStorage 차단 환경(시크릿 모드 / 사파리 ITP / 정책)에서는
 *  catch 후 true 반환 → 랜딩 거치지 않고 즉시 메인 노출 (안전한 기본 동작).
 *
 *  강제로 랜딩 다시 보려면: DevTools → Application → Local Storage → 키 삭제, 또는
 *  직접 https://naodisalm.kr/intro 접근.
 */
function RootRoute() {
  // 동기 1회 평가 (useEffect 대신 render 직전 평가) — 깜빡임 없이 즉시 분기
  let seenIntro = true;
  try {
    seenIntro = window.localStorage.getItem(INTRO_SEEN_KEY) === '1';
  } catch {
    // localStorage 접근 차단 환경 → 안전한 기본 = 메인 노출
    seenIntro = true;
  }

  if (!seenIntro) {
    // flag 먼저 셋팅 → 사용자가 /intro 에서 / 로 돌아와도 무한 리다이렉트 안 됨
    try {
      window.localStorage.setItem(INTRO_SEEN_KEY, '1');
    } catch {
      // 쓰기 실패 — 그래도 리다이렉트는 진행 (당장 1회 안내가 더 가치 있음)
    }
    return <Navigate to="/intro" replace />;
  }

  return <RecommendationPage />;
}

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
      <Route path="/" element={<RootRoute />} />
      <Route path="/intro" element={<LandingPage />} />
      <Route path="/region/:legalDongCode" element={<RegionDetailPage />} />
      {/* <Route path="/explore" element={<ExplorePage />} /> */}
      <Route path="/about/data" element={<AboutDataPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
