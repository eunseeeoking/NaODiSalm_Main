/**
 * URL 공유 동작 훅 — Depth 2 / Depth 3 헤더 공통
 *
 *  ▷ buildShareUrl 의 절대 경로화 + Clipboard API + legacyCopy 폴백을 한 곳에 모아
 *    헤더 컴포넌트는 버튼 UI 만 담당하도록 분리.
 *
 *  ▷ pathname 옵션:
 *    Depth 2 (메인 / )      → 현재 location.pathname 사용 (기본)
 *    Depth 3 (/region/...)  → pathname 을 명시적으로 전달하여 공유 URL 의 base 를 고정
 *
 *  ▷ copyState 1.5s 자동 리셋 — 토스트 없이 버튼 자체 텍스트로 피드백.
 */
import { useCallback, useState } from 'react';
import { useRecommendationStore } from '../../../stores/useRecommendationStore';
import { encodeStateToParams } from '../utils/urlState';

export type CopyState = 'idle' | 'ok' | 'fail';

/** Clipboard API 미지원/권한거부 환경 폴백 (file:// 등) */
function legacyCopy(text: string): boolean {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

export interface UseShareUrlOptions {
  /**
   * 공유 URL 의 pathname 을 강제로 지정.
   * 생략 시 window.location.pathname 사용 (= 현재 페이지 그대로 공유).
   *
   * 예) Depth 3 진입 후 메인(/) 으로 공유하고 싶을 때 '/' 전달.
   */
  pathname?: string;
}

export function useShareUrl(options: UseShareUrlOptions = {}) {
  const workplace = useRecommendationStore((s) => s.workplace);
  const budget = useRecommendationStore((s) => s.budget);
  const weights = useRecommendationStore((s) => s.weights);
  const patience = useRecommendationStore((s) => s.patience);

  const [copyState, setCopyState] = useState<CopyState>('idle');

  const share = useCallback(async () => {
    // encodeStateToParams 로 쿼리 직접 조합 → pathname 충돌 위험 0
    const params = encodeStateToParams({ workplace, budget, weights, patience });
    const qs = params.toString();
    const basePath = options.pathname ?? window.location.pathname;
    const path = qs ? `${basePath}?${qs}` : basePath;
    const absolute = `${window.location.origin}${path}`;

    let ok = false;
    try {
      await navigator.clipboard.writeText(absolute);
      ok = true;
    } catch {
      ok = legacyCopy(absolute);
    }
    setCopyState(ok ? 'ok' : 'fail');
    window.setTimeout(() => setCopyState('idle'), 1500);
  }, [workplace, budget, weights, patience, options.pathname]);

  return {
    /** 공유 버튼 onClick 핸들러 */
    share,
    /** "idle" | "ok" | "fail" — 버튼 라벨 분기용 */
    copyState,
    /** workplace 없으면 공유 비활성 */
    canShare: Boolean(workplace),
  };
}
