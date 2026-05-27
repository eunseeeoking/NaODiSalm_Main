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
// CommutePatienceSlider → LeftPanel 로 이동

interface RegionCentroid {
  code: string;
  name: string;
  sigungu: string;
  sigunguCode: string;
  /** 시도명 (예: "서울특별시", "경기도", "인천광역시") — 수도권 확장 후 추가 */
  sido?: string;
  lat: number;
  lng: number;
}

// 수도권 (서울 + 경기 + 인천) 통합 데이터 — 2026-05-27 확장
const GEOJSON_URL = '/data/capital-hjd-simplified.geojson';
const CENTROIDS_URL = '/data/capital-centroids.json';

export function MapPanel() {
  const appKey = import.meta.env.VITE_KAKAO_MAP_KEY ?? '';
  const status = useKakaoLoader(appKey, ['services', 'clusterer']);
  const containerRef = useRef<HTMLDivElement>(null);
  const [mapInstance, setMapInstance] = useState<kakao.maps.Map | null>(null);
  const workplaceMarkerRef = useRef<kakao.maps.Marker | null>(null);
  const regionOverlaysRef = useRef<kakao.maps.CustomOverlay[]>([]);

  const workplace = useRecommendationStore((s) => s.workplace);
  const patience = useRecommendationStore((s) => s.patience);
  const recommendations = useRecommendationStore((s) => s.recommendations);
  const hoveredRegion = useRecommendationStore((s) => s.hoveredRegion);
  const setHovered = useRecommendationStore((s) => s.setHovered);
  const setHoveredRef = useRef(setHovered);
  setHoveredRef.current = setHovered;

  // ── 행정동 centroid 로드 (1회) ─────────────────────────────
  const [centroids, setCentroids] = useState<RegionCentroid[]>([]);
  useEffect(() => {
    fetch(CENTROIDS_URL)
      .then((r) => r.json() as Promise<RegionCentroid[]>)
      .then(setCentroids)
      .catch((e) => console.error('[centroids] fetch fail:', e));
  }, []);

  // ── 윈도우 리사이즈 시 지도 재배치 ─────────────────────────
  //   오버레이 아키텍처상 패널 collapse는 map canvas 크기에 영향 없음.
  //   따라서 isCollapsed 추적 대신 window resize만 감지하면 충분.
  useEffect(() => {
    if (!mapInstance) return;
    const onResize = () => mapInstance.relayout();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [mapInstance]);

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

  // ── 추천 지역 커스텀 핀 마커 ────────────────────────────────
  //   - 순위 번호가 든 원형 배지 + 삼각 꼬리
  //   - 호버 시 '매물 N개' 툴팁 표시
  useEffect(() => {
    if (!mapInstance || status !== 'ready') return;
    const k = window.kakao.maps;

    // 이전 오버레이 제거
    regionOverlaysRef.current.forEach((o) => o.setMap(null));
    regionOverlaysRef.current = [];

    // 순위별 핀 색상: 1위=파랑, 2~3위=인디고, 4~8위=보라
    const PIN_COLORS = ['#2563EB', '#4F46E5', '#4F46E5', '#7C3AED', '#7C3AED', '#7C3AED', '#7C3AED', '#7C3AED'];

    recommendations.slice(0, 8).forEach((r, i) => {
      const rank = i + 1;
      const color = PIN_COLORS[i] ?? '#7C3AED';
      const count = r.complexCount ?? 0;
      const countLabel = count > 0 ? `매물 ${count}개` : r.displayName;
      // 1위는 살짝 크게
      const size = rank === 1 ? 32 : 26;
      const fontSize = rank === 1 ? 13 : 11;

      // ── DOM 구성 ──────────────────────────────────────────
      const wrap = document.createElement('div');
      wrap.style.cssText =
        'position:relative;text-align:center;cursor:pointer;user-select:none;';

      // 툴팁 (기본 hidden, 호버 시 show)
      const tip = document.createElement('div');
      tip.textContent = countLabel;
      tip.style.cssText = [
        'position:absolute',
        'bottom:calc(100% + 6px)',
        'left:50%',
        'transform:translateX(-50%)',
        `background:${color}`,
        'color:#fff',
        'border-radius:6px',
        'padding:3px 9px',
        'white-space:nowrap',
        'font-size:11px',
        'font-weight:700',
        'letter-spacing:-0.2px',
        'box-shadow:0 2px 8px rgba(0,0,0,0.22)',
        'display:none',
        'pointer-events:none',
        // 말풍선 꼬리 (after 불가 → border trick 대신 box-shadow 사용)
      ].join(';');

      // 순위 배지 원형
      const badge = document.createElement('div');
      badge.textContent = String(rank);
      badge.style.cssText = [
        `width:${size}px`,
        `height:${size}px`,
        'border-radius:50%',
        `background:${color}`,
        'color:#fff',
        `font-size:${fontSize}px`,
        'font-weight:800',
        'display:flex',
        'align-items:center',
        'justify-content:center',
        'border:2.5px solid #fff',
        'box-shadow:0 3px 8px rgba(0,0,0,0.28)',
        'margin:0 auto',
        'transition:transform 0.15s',
      ].join(';');

      // 삼각형 꼬리
      const tail = document.createElement('div');
      tail.style.cssText = [
        'width:0',
        'height:0',
        'border-left:5px solid transparent',
        'border-right:5px solid transparent',
        `border-top:6px solid ${color}`,
        'margin:0 auto',
      ].join(';');

      wrap.appendChild(tip);
      wrap.appendChild(badge);
      wrap.appendChild(tail);

      // ── 이벤트 ────────────────────────────────────────────
      wrap.addEventListener('mouseover', () => {
        tip.style.display = 'block';
        badge.style.transform = 'scale(1.15)';
        setHoveredRef.current(r.legalDongCode);
      });
      wrap.addEventListener('mouseout', () => {
        tip.style.display = 'none';
        badge.style.transform = 'scale(1)';
        setHoveredRef.current(null);
      });

      // ── CustomOverlay 생성 ────────────────────────────────
      const overlay = new k.CustomOverlay({
        position: new k.LatLng(r.lat, r.lng),
        content: wrap,
        yAnchor: 1.0,  // 핀 꼬리 끝이 좌표에 닿도록
        zIndex: 20,
      });
      overlay.setMap(mapInstance);
      regionOverlaysRef.current.push(overlay);
    });
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

  // CommutePatienceSlider 는 LeftPanel 로 이동 — MapPanel 은 순수 지도 배경만 담당

  return (
    // 카드 스타일 제거 — 지도 배경이므로 border/shadow/rounded 불필요
    <div className="flex-1 relative min-h-0 bg-surface dark:bg-surface-dark">

      {/* 지도 캔버스 */}
      {!appKey ? (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-ink-tertiary dark:text-ink-tertiary-dark p-8 text-center">
          VITE_KAKAO_MAP_KEY 환경 변수가 설정되지 않았습니다.
        </div>
      ) : status === 'error' ? (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-ink-tertiary dark:text-ink-tertiary-dark p-8 text-center">
          지도 SDK 로딩 실패
        </div>
      ) : (
        <div ref={containerRef} className="absolute inset-0" aria-label="지도" />
      )}

      {/* 직장 미입력 안내 — 지도 중앙 오버레이 */}
      {!workplace && status === 'ready' && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none" style={{ zIndex: 5 }}>
          <div className="bg-surface-elevated dark:bg-surface-dark-elevated border border-line-light dark:border-line-dark rounded-cardlg p-6 text-center max-w-xs shadow-card-hover pointer-events-auto">
            <div className="w-12 h-12 rounded-full bg-brand-50 dark:bg-brand/[0.12] flex items-center justify-center mx-auto mb-3">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-brand">
                <path d="M3 21h18M5 21V7l8-4v18M19 21V11l-6-4" />
              </svg>
            </div>
            <div className="text-base font-bold text-ink-primary dark:text-ink-primary-dark mb-1">직장을 먼저 입력해주세요</div>
            <div className="text-sm text-ink-tertiary dark:text-ink-tertiary-dark">상단 검색창 또는 인기 직장 칩</div>
          </div>
        </div>
      )}

      {/* 데이터 로딩 배지 — 지도 하단 중앙 (패널과 겹치지 않는 위치) */}
      {badgeText && (
        <div
          style={{ zIndex: 5 }}
          className={[
            'absolute bottom-12 left-1/2 -translate-x-1/2 pointer-events-none',
            'px-2.5 py-1 rounded-card text-xs shadow-card font-medium',
            badgeKind === 'loading'
              ? 'bg-surface-elevated dark:bg-surface-dark-elevated border border-line-light dark:border-line-dark text-ink-secondary dark:text-ink-secondary-dark animate-pulse'
              : badgeKind === 'ok'
              ? 'bg-brand-50 dark:bg-brand/[0.12] border border-brand/30 text-brand-700 dark:text-brand-100'
              : 'bg-surface-elevated dark:bg-surface-dark-elevated border border-line-light dark:border-line-dark text-ink-tertiary dark:text-ink-tertiary-dark',
          ].join(' ')}
        >
          {badgeText}
        </div>
      )}

      {/* 호버된 지역명 — 지도 하단 우측 */}
      {hoveredRegion && (
        <div
          style={{ zIndex: 5 }}
          className="absolute bottom-12 right-4 pointer-events-none px-2.5 py-1 bg-surface-elevated dark:bg-surface-dark-elevated border border-line-light dark:border-line-dark rounded-card text-xs text-ink-secondary dark:text-ink-secondary-dark shadow-card font-medium"
        >
          {hoveredRegion}
        </div>
      )}

      {/* 통근시간 범례 — absolute 하단 */}
      <div
        style={{ zIndex: 5 }}
        className="absolute bottom-0 left-0 right-0 px-4 py-2 bg-surface-elevated/90 dark:bg-surface-dark-elevated/90 backdrop-blur-sm border-t border-line-light dark:border-line-dark flex items-center gap-3 text-xs text-ink-secondary dark:text-ink-secondary-dark flex-wrap tabular-nums"
      >
        <span className="font-semibold">통근시간</span>
        <span className="flex items-center gap-1.5"><span className="w-3.5 h-2.5 bg-commute-fastest rounded-sm" />20분 이내</span>
        <span className="flex items-center gap-1.5"><span className="w-3.5 h-2.5 bg-commute-fast rounded-sm" />30분</span>
        <span className="flex items-center gap-1.5"><span className="w-3.5 h-2.5 bg-commute-medium rounded-sm" />45분</span>
        <span className="flex items-center gap-1.5"><span className="w-3.5 h-2.5 bg-commute-slow rounded-sm" />60분</span>
        <span className="flex items-center gap-1.5"><span className="w-3.5 h-2.5 bg-commute-slowest rounded-sm" />60분 이상</span>
      </div>
    </div>
  );
}
