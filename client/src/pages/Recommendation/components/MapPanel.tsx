/**
 * 좌측 지도 패널 (토스 한국형 톤)
 *  - 본문: 카카오맵 + **추천 지역 폴리곤**(통근 시간대별 신호등 색) + 직장/추천 마커
 *  - 하단: 통근시간 범례
 *
 *  ▷ 폴리곤 정책 (2026-06-03 재설계)
 *    - 직장 주변 "전체" 배경 히트맵 제거 → **추천 top-8 지역구 폴리곤만** 강조.
 *    - 색상 = 서버 통근시간(commuteMinutes) tier: 초록(가까움)→노랑→빨강(멀음).
 *    - 추천은 법정동, GeoJSON 은 행정동 → 좌표 최근접 행정동 폴리곤에 매핑.
 *    - ODsay 정밀 통근은 Depth 2 에선 호출 안 함 → **Depth 3 진입 시 실제 매물 단위로 연동**(쿼터 절약).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useKakaoLoader } from '../../../hooks/useKakaoLoader';
import { useRecommendationStore } from '../../../stores/useRecommendationStore';
import { useDragScroll } from '../../../hooks/useDragScroll';
import { useChoroplethLayer } from '../hooks/useChoroplethLayer';
import { haversineKm, pickCommuteTierColor } from '../utils/commuteEstimate';
import { fetchCommuteMatrix } from '../../../api/commute';
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

/** showLegend: 지도가 화면 메인일 때만 통근 범례 노출 (모바일 시트 펼침/입력 드로어 열림 시 false) */
export function MapPanel({ showLegend = true }: { showLegend?: boolean } = {}) {
  const appKey = import.meta.env.VITE_KAKAO_MAP_KEY ?? '';
  const status = useKakaoLoader(appKey, ['services', 'clusterer']);
  const containerRef = useRef<HTMLDivElement>(null);
  // 통근시간 범례 가로 스크롤 — 드래그 슬라이더 + 스크롤바 숨김
  const legendScrollRef = useDragScroll<HTMLDivElement>();
  const [mapInstance, setMapInstance] = useState<kakao.maps.Map | null>(null);
  const workplaceMarkerRef = useRef<kakao.maps.Marker | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const regionOverlaysRef = useRef<any[]>([]);

  const workplace = useRecommendationStore((s) => s.workplace);
  const recommendations = useRecommendationStore((s) => s.recommendations);
  const hoveredRegion = useRecommendationStore((s) => s.hoveredRegion);
  const setHovered = useRecommendationStore((s) => s.setHovered);
  const setFocused = useRecommendationStore((s) => s.setFocused);
  const isLoading = useRecommendationStore((s) => s.isLoading);
  const commuteOverrides = useRecommendationStore((s) => s.commuteOverrides);
  const setCommuteOverrides = useRecommendationStore((s) => s.setCommuteOverrides);
  const setHoveredRef = useRef(setHovered);
  setHoveredRef.current = setHovered;
  const setFocusedRef = useRef(setFocused);
  setFocusedRef.current = setFocused;
  const setCommuteOverridesRef = useRef(setCommuteOverrides);
  setCommuteOverridesRef.current = setCommuteOverrides;

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

  // ── 추천 top-8 ODsay 정밀 통근 조회 (Depth 2) ──────────────────
  //   추천 8곳만 ODsay 호출(쿼터 ~8/조회, 서버 9격자 KNN 캐시) → store 에 기록 →
  //   지도 폴리곤 색 + 카드 통근분 표시 공유. 매물 단위 호출은 불가(수십만) → 행정동 단위가 한계.
  //   미스 시 서버 commuteMinutes(Haversine) 폴백. 랭킹/총점은 서버값 그대로.
  useEffect(() => {
    const top = recommendations.slice(0, 8);
    if (!workplace || top.length === 0) return;
    const controller = new AbortController();
    const id = window.setTimeout(() => {
      fetchCommuteMatrix(
        { lat: workplace.lat, lng: workplace.lng, label: workplace.label },
        top.map((r) => ({ code: r.legalDongCode, lat: r.lat, lng: r.lng })),
        controller.signal,
      )
        .then((resp) => {
          if (controller.signal.aborted) return;
          const next: Record<string, number> = {};
          for (const [code, entry] of Object.entries(resp.matrix)) {
            next[code] = entry.transitMinutes;
          }
          setCommuteOverridesRef.current(next);
        })
        .catch((e) => {
          if (!controller.signal.aborted) console.error('[commute top8] fail:', e);
        });
    }, 400);
    return () => {
      window.clearTimeout(id);
      controller.abort();
    };
  }, [workplace, recommendations]);

  // ── 추천(법정동) → 최근접 행정동 폴리곤 매핑 (2026-06-03 재설계) ──
  //   추천 top-8 만 강조. GeoJSON 은 행정동이라 좌표 최근접 행정동에 매핑.
  //   recommendations/centroids 만 의존 → ODsay 값 도착 시 폴리곤 재생성(깜빡임) 방지.
  const recAdmCodes = useMemo(() => {
    const pairs: Array<{ legalDongCode: string; admCode: string; serverMin: number }> = [];
    if (centroids.length === 0) return pairs;
    for (const r of recommendations.slice(0, 8)) {
      let bestCode = '';
      let bestKm = Infinity;
      for (const c of centroids) {
        const km = haversineKm({ lat: r.lat, lng: r.lng }, c);
        if (km < bestKm) {
          bestKm = km;
          bestCode = c.code;
        }
      }
      if (bestCode) {
        pairs.push({ legalDongCode: r.legalDongCode, admCode: bestCode, serverMin: r.commuteMinutes });
      }
    }
    return pairs;
  }, [recommendations, centroids]);

  // 화이트리스트(렌더 대상 행정동) — 추천만 바뀔 때 갱신
  const includeCodes = useMemo(
    () => new Set(recAdmCodes.map((p) => p.admCode)),
    [recAdmCodes],
  );

  // 색상 = 통근시간 tier(초록→빨강). ODsay 정밀값(commuteOverrides) 우선, 없으면 서버값.
  //   같은 행정동에 추천 2곳이 겹치면 더 짧은 통근(=초록 우선)으로.
  const colorByCode = useMemo(() => {
    const colors: Record<string, string> = {};
    const minutesByCode = new Map<string, number>();
    for (const p of recAdmCodes) {
      const minutes = commuteOverrides[p.legalDongCode] ?? p.serverMin;
      const prev = minutesByCode.get(p.admCode);
      const merged = prev == null ? minutes : Math.min(prev, minutes);
      minutesByCode.set(p.admCode, merged);
      colors[p.admCode] = pickCommuteTierColor(merged);
    }
    return colors;
  }, [recAdmCodes, commuteOverrides]);

  // ── 추천 폴리곤 레이어 (화이트리스트 = 추천 8곳만 렌더) ──────────
  const { loaded: heatmapLoaded } = useChoroplethLayer(
    mapInstance,
    status,
    GEOJSON_URL,
    {
      colorByCode,
      includeCodes,
      // 핀과 동일하게 조회 중에는 이전 추천 폴리곤 숨김(스테일 혼동 방지)
      visible: recommendations.length > 0 && !isLoading,
      fillOpacity: 0.55,
      strokeColor: '#FFFFFF',
      strokeWeight: 2,
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

    // 조회 중에는 핀을 그리지 않음 — 이전 추천 핀이 잔류해 혼동되는 문제 방지
    if (isLoading) return;

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
      // 핀 클릭 → 해당 카드로 스크롤+flash (특히 모바일: hover 없이 탭으로 카드 위치 안내)
      wrap.style.cursor = 'pointer';
      wrap.addEventListener('click', () => {
        tip.style.display = 'block'; // 탭 피드백(매물 N개 툴팁)
        setHoveredRef.current(r.legalDongCode);
        setFocusedRef.current(r.legalDongCode);
      });

      // ── CustomOverlay 생성 ────────────────────────────────
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const overlay = new (k as any).CustomOverlay({
        position: new k.LatLng(r.lat, r.lng),
        content: wrap,
        yAnchor: 1.0,  // 핀 꼬리 끝이 좌표에 닿도록
        zIndex: 20,
      });
      overlay.setMap(mapInstance);
      regionOverlaysRef.current.push(overlay);
    });
  }, [recommendations, mapInstance, status, isLoading]);

  // ─── 좌상단 진행 배지 텍스트 결정 ──────────────────────────
  //   추천 지역만 ODsay 실측 통근으로 시간대별 강조(초록~빨강).
  let badgeText: string | null = null;
  if (workplace && heatmapLoaded && recommendations.length > 0) {
    const shown = recommendations.length > 8 ? 8 : recommendations.length;
    const precise = Object.keys(commuteOverrides).length > 0;
    badgeText = precise
      ? `추천 ${shown}곳 · ODsay 실측 통근(초록~빨강)`
      : `추천 ${shown}곳 · 통근 시간대별 강조(초록~빨강)`;
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

      {/* 추천 조회 중 — 지도 중앙 로딩 표시 (핀이 제거된 동안 "조회중" 안내) */}
      {isLoading && workplace && status === 'ready' && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none" style={{ zIndex: 6 }}>
          <div className="flex items-center gap-2.5 px-4 py-2.5 bg-surface-elevated/95 dark:bg-surface-dark-elevated/95 border border-line-light dark:border-line-dark rounded-cardlg shadow-card-hover">
            {/* 또렷한 SVG 호 스피너 — 기존 흐린 CSS 링은 다크 패널에서 빈 공간처럼 보였음 */}
            <svg
              className="animate-spin shrink-0 text-brand"
              width="18" height="18" viewBox="0 0 24 24"
              fill="none" stroke="currentColor" strokeWidth="2.5"
              aria-hidden="true"
            >
              <path d="M21 12a9 9 0 1 1-6.22-8.56" strokeLinecap="round" />
            </svg>
            <span className="text-sm font-semibold text-ink-secondary dark:text-ink-secondary-dark">
              추천 지역 조회 중…
            </span>
          </div>
        </div>
      )}

      {/* 데이터 로딩 배지 — 지도 하단 중앙 (모바일 숨김, 데스크톱만 표시) */}
      {badgeText && (
        <div
          style={{ zIndex: 5 }}
          className={[
            'hidden md:block',
            'absolute bottom-12 left-1/2 -translate-x-1/2 pointer-events-none',
            'px-2.5 py-1 rounded-card text-xs shadow-card font-medium',
            'bg-surface-elevated dark:bg-surface-dark-elevated border border-line-light dark:border-line-dark text-ink-tertiary dark:text-ink-tertiary-dark',
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

      {/* 통근시간 범례 — absolute 하단. 지도가 메인일 때만 노출 */}
      {showLegend && (
      <div
        ref={legendScrollRef}
        style={{ zIndex: 5 }}
        className="absolute bottom-0 left-0 right-0 h-9 px-4 bg-surface-elevated/90 dark:bg-surface-dark-elevated/90 backdrop-blur-sm border-t border-line-light dark:border-line-dark flex items-center gap-3 text-xs text-ink-secondary dark:text-ink-secondary-dark overflow-x-auto scroll-x-slider tabular-nums"
      >
        <span className="font-semibold shrink-0">추천지역 통근</span>
        <span className="flex items-center gap-1.5 shrink-0"><span className="w-3.5 h-2.5 rounded-sm" style={{ background: '#16A34A' }} />20분 이내</span>
        <span className="flex items-center gap-1.5 shrink-0"><span className="w-3.5 h-2.5 rounded-sm" style={{ background: '#65A30D' }} />30분</span>
        <span className="flex items-center gap-1.5 shrink-0"><span className="w-3.5 h-2.5 rounded-sm" style={{ background: '#EAB308' }} />45분</span>
        <span className="flex items-center gap-1.5 shrink-0"><span className="w-3.5 h-2.5 rounded-sm" style={{ background: '#F97316' }} />60분</span>
        <span className="flex items-center gap-1.5 shrink-0"><span className="w-3.5 h-2.5 rounded-sm" style={{ background: '#EF4444' }} />60분 이상</span>
      </div>
      )}
    </div>
  );
}