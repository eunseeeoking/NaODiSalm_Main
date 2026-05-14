import { useEffect, useState } from 'react';

/**
 * Kakao Maps SDK 동적 로더.
 *  - autoload=false 로 받아와서 kakao.maps.load(cb) 를 직접 호출 → 초기화 타이밍 제어
 *  - 한 번만 <script> 를 주입하고, 이후 같은 키 재호출 시 기존 스크립트 재사용
 *
 * 반환: 'idle' | 'loading' | 'ready' | 'error'
 */
export type KakaoLoaderState = 'idle' | 'loading' | 'ready' | 'error';

const SCRIPT_ID = 'kakao-maps-sdk';

export function useKakaoLoader(
  appKey: string,
  libraries: string[] = [],
): KakaoLoaderState {
  const [state, setState] = useState<KakaoLoaderState>('idle');

  useEffect(() => {
    if (!appKey) {
      setState('idle');
      return;
    }

    // 이미 로드되어 있으면 즉시 ready
    if (window.kakao?.maps) {
      setState('ready');
      return;
    }

    setState('loading');

    const onReady = () => {
      window.kakao.maps.load(() => setState('ready'));
    };

    const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener('load', onReady, { once: true });
      existing.addEventListener('error', () => setState('error'), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.id = SCRIPT_ID;
    const lib = libraries.length ? `&libraries=${libraries.join(',')}` : '';
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${appKey}&autoload=false${lib}`;
    script.async = true;
    script.addEventListener('load', onReady, { once: true });
    script.addEventListener('error', () => setState('error'), { once: true });
    document.head.appendChild(script);
  }, [appKey, libraries.join(',')]);

  return state;
}
