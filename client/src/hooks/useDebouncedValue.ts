/**
 * useDebouncedValue — 값 변경을 N ms 안정된 후에만 노출
 *
 *  사용처 (2026-05-27 신설):
 *    Recommendation 페이지의 가중치/예산/통근인내심 슬라이더
 *      → 매 입력마다 fetchRecommendations 호출되면 서버 부담 폭증
 *      → 슬라이더 정지 후 350ms 안정되어야 1회 호출
 *
 *  주의:
 *    - 객체/배열을 value 로 넣으면 reference 변경마다 트리거됨
 *    - 동일 의미의 객체를 매 렌더 새로 생성하지 말 것 (zustand selector 권장)
 *
 *  예시:
 *    const debounced = useDebouncedValue(weights, 350);
 *    useEffect(() => { fetch(debounced) }, [debounced]);
 */
import { useEffect, useState } from 'react';

export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState<T>(value);

  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(id);
  }, [value, delayMs]);

  return debounced;
}
