/**
 * Depth 2 · 지역 추천 페이지 (메인)
 *  - 토스 한국형 톤 (Pretendard + 브랜드 블루 + 그림자 lift)
 *  - 더미 데이터 (실제 API 연동은 다음 단계)
 *  - URL ↔ 스토어 양방향 동기화 (공유 시 동일 결과 재현 — PDF 기획서 차별점)
 */
import { useEffect, useRef } from 'react';
import { useRecommendationStore } from '../../stores/useRecommendationStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { fetchRecommendations } from '../../api/recommendations';
import { RecommendationHeader } from './components/RecommendationHeader';
import { MapPanel } from './components/MapPanel';
import { CardPanel } from './components/CardPanel';
import {
  decodeParamsToState,
  encodeStateToParams,
  resolveWeights,
} from './utils/urlState';

export function RecommendationPage() {
  const workplace = useRecommendationStore((s) => s.workplace);
  const budget = useRecommendationStore((s) => s.budget);
  const weights = useRecommendationStore((s) => s.weights);
  const patience = useRecommendationStore((s) => s.patience);
  const setRecommendations = useRecommendationStore((s) => s.setRecommendations);
  const setWorkplace = useRecommendationStore((s) => s.setWorkplace);
  const setBudget = useRecommendationStore((s) => s.setBudget);
  const setPatience = useRecommendationStore((s) => s.setPatience);
  const setWeight = useRecommendationStore((s) => s.setWeight);
  const bootstrap = useAuthStore((s) => s.bootstrap);

  // ─── 마운트 1회: 인증 + URL 하이드레이션 ─────────────────
  const hydratedRef = useRef(false);
  useEffect(() => {
    bootstrap();
  }, [bootstrap]);

  useEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;

    const params = new URLSearchParams(window.location.search);
    if (params.toString() === '') return; // 공유 URL 이 아니면 스토어 기본값 유지

    const shared = decodeParamsToState(params);

    if (shared.workplace) setWorkplace(shared.workplace);
    if (shared.budget !== null) setBudget(shared.budget);
    if (shared.patience !== null) setPatience(shared.patience);

    const finalWeights = resolveWeights(shared);
    if (finalWeights) {
      setWeight('commute', finalWeights.commute);
      setWeight('value', finalWeights.value);
      setWeight('investment', finalWeights.investment);
      setWeight('life', finalWeights.life);
    }
  }, [setWorkplace, setBudget, setPatience, setWeight]);

  // ─── 추천 결과 (실 API + mock 폴백) ──────────────────────
  // 정책 (2026-05-21):
  //  · 서버 미구현/장애 시 wrapper 가 자동으로 MOCK_REGIONS 폴백
  //  · 폴백 시 dataSource='mock' → 헤더에 DEMO 뱃지 노출
  //  · workplace/예산/가중치/인내심 중 어느 하나라도 바뀌면 재요청
  //  · AbortController 로 직전 요청 정리 (race condition 방지)
  useEffect(() => {
    if (!workplace) {
      setRecommendations([], null);
      return;
    }
    const ac = new AbortController();
    let alive = true;

    fetchRecommendations({ workplace, budget, weights, patience }, ac.signal)
      .then((result) => {
        if (!alive) return;
        setRecommendations(result.regions, result.source);
      })
      .catch((err) => {
        // AbortError 는 정상 흐름이므로 조용히 무시
        if (err instanceof DOMException && err.name === 'AbortError') return;
        console.error('[RecommendationPage] fetch fail:', err);
      });

    return () => {
      alive = false;
      ac.abort();
    };
  }, [workplace, budget, weights, patience, setRecommendations]);

  // ─── 스토어 → URL (replaceState, 디바운스 200ms) ──────────
  useEffect(() => {
    // 하이드레이션 전엔 쓰지 않음 (덮어쓰기 방지)
    if (!hydratedRef.current) return;

    const handle = window.setTimeout(() => {
      const params = encodeStateToParams({ workplace, budget, weights, patience });
      const next = `${window.location.pathname}?${params.toString()}`;
      // 동일하면 스킵 (히스토리 노이즈 + 무한 루프 방지)
      if (next === window.location.pathname + window.location.search) return;
      window.history.replaceState(null, '', next);
    }, 200);

    return () => window.clearTimeout(handle);
  }, [workplace, budget, weights, patience]);

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
