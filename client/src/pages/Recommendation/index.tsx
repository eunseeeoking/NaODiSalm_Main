/**
 * Depth 2 · 지역 추천 페이지 (메인 화면)
 *  - 사용자가 직장을 선택하면 추천 결과 표시
 *  - 현재는 mock data 사용. 실제 API 연동은 Week 2 작업.
 */
import { useEffect } from 'react';
import { useRecommendationStore } from '../../stores/useRecommendationStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { MOCK_REGIONS } from './data/mockRegions';
import { RecommendationHeader } from './components/RecommendationHeader';
import { MapPanel } from './components/MapPanel';
import { CardPanel } from './components/CardPanel';

export function RecommendationPage() {
  const workplace = useRecommendationStore((s) => s.workplace);
  const setRecommendations = useRecommendationStore((s) => s.setRecommendations);
  const bootstrap = useAuthStore((s) => s.bootstrap);

  // 1회 부트 — 인증 상태 확인
  useEffect(() => {
    bootstrap();
  }, [bootstrap]);

  // 직장 선택 시 추천 로드 (실제로는 API 호출)
  //  · TODO: 실제 API 연동 시 fetch('/api/recommendations?lat=...&lng=...&patience=...')
  //  · 현재는 MOCK_REGIONS 그대로 사용
  useEffect(() => {
    if (!workplace) {
      setRecommendations([]);
      return;
    }
    setRecommendations(MOCK_REGIONS);
  }, [workplace, setRecommendations]);

  return (
    <div className="w-screen h-screen flex flex-col bg-[#f4f5f7] overflow-hidden">
      <RecommendationHeader />
      <main className="flex-1 flex gap-2.5 p-2.5 overflow-hidden">
        <MapPanel />
        <CardPanel />
      </main>
    </div>
  );
}
