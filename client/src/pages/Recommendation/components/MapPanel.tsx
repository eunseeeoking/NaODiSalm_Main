/**
 * 좌측 지도 패널 (Depth 2)
 *  - 상단: 통근 인내심 슬라이더
 *  - 본문: 카카오맵 (직장 마커 + 단지 핀 + 추후 행정동 폴리곤)
 *  - 하단: 통근시간 범례 5단계
 *
 *  ※ 행정동 폴리곤 + 통근 매트릭스는 다음 단계 (Week 2)
 *    현재는 직장 마커 + 추천 지역 핀만 표시
 */
import { useEffect, useRef } from 'react';
import { useKakaoLoader } from '../../../hooks/useKakaoLoader';
import { useRecommendationStore } from '../../../stores/useRecommendationStore';
import { CommutePatienceSlider } from './CommutePatienceSlider';

export function MapPanel() {
  const appKey = import.meta.env.VITE_KAKAO_MAP_KEY ?? '';
  const status = useKakaoLoader(appKey, ['services', 'clusterer']);
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<kakao.maps.Map | null>(null);
  const workplaceMarkerRef = useRef<kakao.maps.Marker | null>(null);
  const regionMarkersRef = useRef<kakao.maps.Marker[]>([]);

  const workplace = useRecommendationStore((s) => s.workplace);
  const recommendations = useRecommendationStore((s) => s.recommendations);
  const hoveredRegion = useRecommendationStore((s) => s.hoveredRegion);
  const setHovered = useRecommendationStore((s) => s.setHovered);
  const setHoveredRef = useRef(setHovered);
  setHoveredRef.current = setHovered;

  // 지도 초기 생성
  useEffect(() => {
    if (status !== 'ready' || !containerRef.current || mapRef.current) return;
    const k = window.kakao.maps;
    mapRef.current = new k.Map(containerRef.current, {
      center: new k.LatLng(37.5665, 126.978),
      level: 7,
    });
    setTimeout(() => mapRef.current?.relayout(), 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  // 직장 마커 + 중심 이동
  useEffect(() => {
    if (!mapRef.current || status !== 'ready') return;
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
    marker.setMap(mapRef.current);
    workplaceMarkerRef.current = marker;
    mapRef.current.setCenter(pos);
  }, [workplace, status]);

  // 추천 지역 마커
  useEffect(() => {
    if (!mapRef.current || status !== 'ready') return;
    const k = window.kakao.maps;

    // 기존 마커 제거
    regionMarkersRef.current.forEach((m) => m.setMap(null));
    regionMarkersRef.current = [];

    for (const r of recommendations.slice(0, 8)) {
      const marker = new k.Marker({
        position: new k.LatLng(r.lat, r.lng),
        title: r.displayName,
        clickable: true,
      });
      marker.setMap(mapRef.current!);
      k.event.addListener(marker, 'mouseover', () => {
        setHoveredRef.current(r.legalDongCode);
      });
      k.event.addListener(marker, 'mouseout', () => {
        setHoveredRef.current(null);
      });
      regionMarkersRef.current.push(marker);
    }
  }, [recommendations, status]);

  return (
    <div className="flex-1 flex flex-col bg-white border border-gray-200 rounded-card overflow-hidden min-w-0">
      <CommutePatienceSlider />

      <div className="relative flex-1 min-h-[400px] bg-gray-50">
        {!appKey ? (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-gray-500 p-8 text-center">
            VITE_KAKAO_MAP_KEY 환경 변수가 설정되지 않았습니다.
          </div>
        ) : status === 'error' ? (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-gray-500 p-8 text-center">
            지도 SDK 로딩 실패 — 키/도메인 등록을 확인하세요.
          </div>
        ) : (
          <div ref={containerRef} className="w-full h-full" aria-label="지도" />
        )}

        {/* 직장 미선택 안내 오버레이 */}
        {!workplace && status === 'ready' && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/60 backdrop-blur-sm pointer-events-none">
            <div className="bg-white border border-gray-200 rounded-cardlg p-5 text-center shadow-sm max-w-xs">
              <div className="text-2xl mb-2">🏢</div>
              <div className="text-sm font-medium mb-1">직장을 먼저 입력해주세요</div>
              <div className="text-xs text-gray-500">상단 검색창 또는 인기 직장 칩</div>
            </div>
          </div>
        )}

        {/* 우상단 호버 디버그 (개발 단계만) */}
        {hoveredRegion && (
          <div className="absolute top-2 right-2 px-2 py-1 bg-white border border-gray-200 rounded text-[10px] text-gray-500 shadow-sm">
            hover: {hoveredRegion}
          </div>
        )}
      </div>

      {/* 통근시간 범례 */}
      <div className="px-3 py-2 border-t border-gray-200 flex items-center gap-3 text-[10px] text-gray-500 flex-wrap">
        <span>통근시간</span>
        <span className="flex items-center gap-1"><span className="w-3.5 h-2.5 bg-commute-fastest rounded-sm" />≤20분</span>
        <span className="flex items-center gap-1"><span className="w-3.5 h-2.5 bg-commute-fast rounded-sm" />30분</span>
        <span className="flex items-center gap-1"><span className="w-3.5 h-2.5 bg-commute-medium rounded-sm" />45분</span>
        <span className="flex items-center gap-1"><span className="w-3.5 h-2.5 bg-commute-slow rounded-sm" />60분</span>
        <span className="flex items-center gap-1"><span className="w-3.5 h-2.5 bg-commute-slowest rounded-sm" />60+</span>
      </div>
    </div>
  );
}
