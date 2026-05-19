/**
 * Depth 2 · 지역 추천 페이지 (메인)
 *  - 토스 한국형 톤 (Pretendard + 브랜드 블루 + 그림자 lift)
 *  - 더미 데이터 (실제 API 연동은 다음 단계)
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

  useEffect(() => {
    bootstrap();
  }, [bootstrap]);

  useEffect(() => {
    if (!workplace) {
      setRecommendations([]);
      return;
    }
    setRecommendations(MOCK_REGIONS);
  }, [workplace, setRecommendations]);

  return (
    <div className="w-screen h-screen flex flex-col bg-surface dark:bg-surface-dark overflow-hidden text-ink-primary dark:text-ink-primary-dark font-sans">
      <RecommendationHeader />
      <main className="flex-1 flex gap-3 p-3 overflow-hidden">
        <MapPanel />
        <CardPanel />
      </main>
    </div>
  );
}
