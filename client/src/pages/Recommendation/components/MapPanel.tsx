/**
 * 좌측 지도 패널 (토스 한국형 톤)
 *  - 인내심 슬라이더 (상단)
 *  - 본문: 카카오맵 + 행정동 통근 히트맵 + 직장/추천 마커
 *  - 하단: 통근시간 범례
 *
 *  ▷ 통근시간 산출 우선순위
 *    1순위  ODsay 매트릭스 (서버 캐싱) — 실거리 + 환승
 *    2순위  Haversine 추정 — 응답 대기 중 fallback (UX 끊김 방지)
 *
 *  ▷ 흐름
 *    [직장 선택]
 *      → 즉시 Haversine 색상 적용 (대기 없음)
 *      → 백그라운드 fetchCommuteMatrix
 *      → 응답 도착하면 정확한 색상으로 갱신
 *      → 인내심 슬라이더는 두 단계 모두 즉시 반응
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useKakaoLoader } from '../../../hooks/useKakaoLoader';
import { useRecommendationStore } from '../../../stores/useRecommendationStore';
import { useChoroplethLayer } from '../hooks/useChoroplethLayer';
import {
  estimateCommuteMinutes,
  haversineKm,
  pickHeatmapColor,
} from '../utils/commuteEstimate';
import { fetchCommuteMatrix, type CommuteEntry } from '../../../api/commute';
import { CommutePatienceSlider } from './CommutePatienceSlider';

interface SeoulCentroid {
  code: string;
  name: string;
  sigungu: string;
  sigunguCode: string;
  lat: number;
  lng: number;
}

const GEOJSON_URL = '/data/seoul-hjd-simplified.geojson';
const CENTROIDS_URL = '/data/seoul-centroids.json';

export function MapPanel() {
  const appKey = import.meta.env.VITE_KAKAO_MAP_KEY ?? '';
  const status = useKakaoLoader(appKey, ['services', 'clusterer']);
  const containerRef = useRef<HTMLDivElement>(null);
  const [mapInstance, setMapInstance] = useState<kakao.maps.Map | null>(null);
  const workplaceMarkerRef = useRef<kakao.maps.Marker | null>(null);
  const regionMarkersRef = useRef<kakao.maps.Marker[]>([]);

  const workplace = useRecommendationStore((s) => s.workplace);
  const patience = useRecommendationStore((s) => s.patience);
  const recommendations = useRecommendationStore((s) => s.recommendations);
  const hoveredRegion = useRecommendationStore((s) => s.hoveredRegion);
  const setHovered = useRecommendationStore((s) => s.setHovered);
  const setHoveredRef = useRef(setHovered);
  setHoveredRef.current = setHovered;

  // ── 행정동 centroid 로드 (1회) ─────────────────────────────
  const [centroids, setCentroids] = useState<SeoulCentroid[]>([]);
  useEffect(() => {
    fetch(CENTROIDS_URL)
      .then((r) => r.json() as Promise<SeoulCentroid[]>)
      .then(setCentroids)
      .catch((e) => console.error('[centroids] fetch fail:', e));
  }, []);

  // ── 지도 초기 생성 ────────────────────────────────────────
  useEffect(() => {
    if (status !== 'ready' || !containerRef.current || mapInstance) return;
    const k = window.kakao.maps;
    const map = new k.Map(containerRef.current, {
      center: new k.LatLng(37.5665, 126.978),
      level: 7,
    });
    setMapInstance(map);
    setTimeout(() => map.relayout(), 0);
  }, [status, mapInstance]);

  // ── ODsay 통근 매트릭스 (백그라운드) ────────────────────────
  const [matrix, setMatrix] = useState<Record<string, CommuteEntry> | null>(
    null,
  );
  const [matrixLoading, setMatrixLoading] = useState(false);
  const [matrixStats, setMatrixStats] = useState<{
    hit: number;
    nearby: number;
    miss: number;
    elapsedMs: number;
  } | null>(null);

  useEffect(() => {
    if (!workplace || centroids.length === 0) {
      setMatrix(null);
      setMatrixStats(null);
      return;
    }
    let cancelled = false;
    setMatrixLoading(true);
    setMatrix(null); // 이전 직장 매트릭스 비우기 → Haversine fallback 으로 즉시 색칠
    setMatrixStats(null);

    fetchCommuteMatrix(
      { lat: workplace.lat, lng: workplace.lng, label: workplace.label },
      centroids.map((c) => ({ code: c.code, lat: c.lat, lng: c.lng })),
    )
      .then((resp) => {
        if (cancelled) return;
        setMatrix(resp.matrix);
        setMatrixStats({
          hit: resp.cacheHit,
          nearby: resp.cacheNearby,
          miss: resp.cacheMiss,
          elapsedMs: resp.elapsedMs,
        });
      })
      .catch((e) => {
        console.error('[commute matrix] fail:', e);
      })
      .finally(() => {
        if (!cancelled) setMatrixLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [workplace, centroids]);

  // ── 통근시간 → 행정동 색상 매핑 ──────────────────────────────
  //   ODsay 매트릭스 있으면 우선, 없으면 Haversine fallback
  const colorByCode = useMemo(() => {
    if (!workplace || centroids.length === 0) return {};
    const result: Record<string, string> = {};
    for (const c of centroids) {
      const odsay = matrix?.[c.code]?.transitMinutes;
      let minutes: number;
      if (typeof odsay === 'number') {
        minutes = odsay;
      } else {
        const km = haversineKm(workplace, c);
        minutes = estimateCommuteMinutes(km);
      }
      result[c.code] = pickHeatmapColor(minutes, patience);
    }
    return result;
  }, [workplace, patience, centroids, matrix]);

  // ── 히트맵 폴리곤 ─────────────────────────────────────────
  const { loaded: heatmapLoaded, featureCount } = useChoroplethLayer(
    mapInstance,
    status,
    GEOJSON_URL,
    {
      colorByCode,
      visible: !!workplace,
      fillOpacity: 0.45,
      strokeColor: '#FFFFFF',
      strokeWeight: 0.8,
      defaultFill: '#E5E8EB',
      onHover: (code) => setHoveredRef.current(code),
    },
  );

  // ── 직장 마커 ─────────────────────────────────────────────
  useEffect(() => {
    if (!mapInstance || status !== 'ready') return;
    const k = window.kakao.maps;
    if (workplaceMarkerRef.current) {
      workplaceMarkerRef.current.setMap(null);
      workplaceMarkerRef.current = null;
    }
    if (!workplace) return;
    const pos = new k.LatLng(workplace.lat, workplace.lng);
    const marker = new k.Marker({
      position: pos,
      title: workplace.label,
      zIndex: 10,
    });
    marker.setMap(mapInstance);
    workplaceMarkerRef.current = marker;
    mapInstance.setCenter(pos);
  }, [workplace, mapInstance, status]);

  // ── 추천 지역 마커 ─────────────────────────────────────────
  useEffect(() => {
    if (!mapInstance || status !== 'ready') return;
    const k = window.kakao.maps;
    regionMarkersRef.current.forEach((m) => m.setMap(null));
    regionMarkersRef.current = [];
    for (const r of recommendations.slice(0, 8)) {
      const marker = new k.Marker({
        position: new k.LatLng(r.lat, r.lng),
        title: r.displayName,
        clickable: true,
        zIndex: 20,
      });
      marker.setMap(mapInstance);
      k.event.addListener(marker, 'mouseover', () => {
        setHoveredRef.current(r.legalDongCode);
      });
      k.event.addListener(marker, 'mouseout', () => {
        setHoveredRef.current(null);
      });
      regionMarkersRef.current.push(marker);
    }
  }, [recommendations, mapInstance, status]);

  // ─── 좌상단 진행 배지 텍스트 결정 ──────────────────────────
  let badgeText: string | null = null;
  let badgeKind: 'loading' | 'ok' | 'fallback' = 'fallback';
  if (workplace && heatmapLoaded) {
    if (matrixLoading) {
      badgeText = `행정동 ${featureCount}개 · 통근시간 분석 중...`;
      badgeKind = 'loading';
    } else if (matrixStats) {
      const { hit, nearby, miss, elapsedMs } = matrixStats;
      if (miss === 0 && nearby === 0) {
        badgeText = `행정동 ${featureCount}개 · 정확 캐시 즉시 응답 (${elapsedMs}ms)`;
      } else if (miss === 0) {
        // KNN 흡수만으로 해결
        badgeText = `행정동 ${featureCount}개 · 정확 ${hit} + 근접 ${nearby} 흡수 (${elapsedMs}ms)`;
      } else {
        badgeText = `행정동 ${featureCount}개 · 정확 ${hit} / 근접 ${nearby} / 신규 ${miss}`;
      }
      badgeKind = 'ok';
    } else {
      badgeText = `행정동 ${featureCount}개 · 추정값 표시`;
      badgeKind = 'fallback';
    }
  }

  return (
    <div className="flex-1 flex flex-col bg-surface-elevated dark:bg-surface-dark-elevated border border-line-light dark:border-line-dark rounded-cardlg overflow-hidden min-w-0 shadow-card">
      <CommutePatienceSlider />

      <div className="relative flex-1 min-h-[400px] bg-surface dark:bg-surface-dark">
        {!appKey ? (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-ink-tertiary dark:text-ink-tertiary-dark p-8 text-center">
            VITE_KAKAO_MAP_KEY 환경 변수가 설정되지 않았습니다.
          </div>
        ) : status === 'error' ? (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-ink-tertiary dark:text-ink-tertiary-dark p-8 text-center">
            지도 SDK 로딩 실패
          </div>
        ) : (
          <div ref={containerRef} className="w-full h-full" aria-label="지도" />
        )}

        {!workplace && status === 'ready' && (
          <div className="absolute inset-0 flex items-center justify-center bg-surface/70 dark:bg-surface-dark/70 backdrop-blur-sm pointer-events-none">
            <div className="bg-surface-elevated dark:bg-surface-dark-elevated border border-line-light dark:border-line-dark rounded-cardlg p-6 text-center max-w-xs shadow-card-hover">
              <div className="w-12 h-12 rounded-full bg-brand-50 dark:bg-brand/[0.12] flex items-center justify-center mx-auto mb-3">
                <svg
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="text-brand"
                >
                  <path d="M3 21h18M5 21V7l8-4v18M19 21V11l-6-4" />
                </svg>
              </div>
              <div className="text-base font-bold text-ink-primary dark:text-ink-primary-dark mb-1">
                직장을 먼저 입력해주세요
              </div>
              <div className="text-sm text-ink-tertiary dark:text-ink-tertiary-dark">
                상단 검색창 또는 인기 직장 칩
              </div>
            </div>
          </div>
        )}

        {/* 좌상단 진행 배지 — z-30 + pointer-events-none 으로 지도 위 고정 */}
        {badgeText && (
          <div
            className={
              badgeKind === 'loading'
                ? 'absolute top-3 left-3 z-30 pointer-events-none px-2.5 py-1 bg-surface-elevated dark:bg-surface-dark-elevated border border-line-light dark:border-line-dark rounded-card text-xs text-ink-secondary dark:text-ink-secondary-dark shadow-card font-medium animate-pulse'
                : badgeKind === 'ok'
                ? 'absolute top-3 left-3 z-30 pointer-events-none px-2.5 py-1 bg-brand-50 dark:bg-brand/[0.12] border border-brand/30 rounded-card text-xs text-brand-700 dark:text-brand-100 shadow-card font-semibold'
                : 'absolute top-3 left-3 z-30 pointer-events-none px-2.5 py-1 bg-surface-elevated dark:bg-surface-dark-elevated border border-line-light dark:border-line-dark rounded-card text-xs text-ink-tertiary dark:text-ink-tertiary-dark shadow-card font-medium'
            }
          >
            {badgeText}
          </div>
        )}

        {hoveredRegion && (
          <div className="absolute top-3 right-3 z-30 pointer-events-none px-2.5 py-1 bg-surface-elevated dark:bg-surface-dark-elevated border border-line-light dark:border-line-dark rounded-card text-xs text-ink-secondary dark:text-ink-secondary-dark shadow-card font-medium">
            {hoveredRegion}
          </div>
        )}
      </div>

      {/* 범례 */}
      <div className="px-4 py-2.5 border-t border-line-light dark:border-line-dark flex items-center gap-3 text-xs text-ink-secondary dark:text-ink-secondary-dark flex-wrap tabular-nums">
        <span className="font-semibold text-ink-secondary dark:text-ink-secondary-dark">
          통근시간
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3.5 h-2.5 bg-commute-fastest rounded-sm" />
          20분 이내
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3.5 h-2.5 bg-commute-fast rounded-sm" />
          30분
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3.5 h-2.5 bg-commute-medium rounded-sm" />
          45분
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3.5 h-2.5 bg-commute-slow rounded-sm" />
          60분
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3.5 h-2.5 bg-commute-slowest rounded-sm" />
          60분 이상
        </span>
      </div>
    </div>
  );
}
