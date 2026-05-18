import { useEffect, useRef } from 'react';
import { useKakaoLoader } from '../hooks/useKakaoLoader';
import type { ComplexMarker } from '../api/realty';

export interface LatLng {
  lat: number;
  lng: number;
}

interface KakaoMapProps {
  /** 초기 중심 좌표 (기본: 서울 시청) */
  center?: LatLng;
  /** 줌 레벨 (1~14, 작을수록 확대) */
  level?: number;
  /** 마커로 표시할 단지 목록 */
  markers?: ComplexMarker[];
  /** 마커 클릭 시 콜백 */
  onMarkerClick?: (complex: ComplexMarker) => void;
  className?: string;
}

const DEFAULT_CENTER: LatLng = { lat: 37.5665, lng: 126.978 };

export function KakaoMap({
  center = DEFAULT_CENTER,
  level = 5,
  markers,
  onMarkerClick,
  className,
}: KakaoMapProps) {
  const appKey = import.meta.env.VITE_KAKAO_MAP_KEY ?? '';
  const status = useKakaoLoader(appKey, ['services', 'clusterer']);
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<kakao.maps.Map | null>(null);
  const clustererRef = useRef<kakao.maps.MarkerClusterer | null>(null);
  const markersRef = useRef<kakao.maps.Marker[]>([]);
  const onMarkerClickRef = useRef(onMarkerClick);
  onMarkerClickRef.current = onMarkerClick;

  // 지도 + clusterer 최초 생성
  useEffect(() => {
    if (status !== 'ready' || !containerRef.current || mapRef.current) return;
    const k = window.kakao.maps;
    mapRef.current = new k.Map(containerRef.current, {
      center: new k.LatLng(center.lat, center.lng),
      level,
    });
    clustererRef.current = new k.MarkerClusterer({
      map: mapRef.current,
      averageCenter: true,
      minLevel: 6, // 줌 레벨 6 이하에서만 클러스터
      gridSize: 80,
    });
    setTimeout(() => mapRef.current?.relayout(), 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  // markers 변경 시 다시 그리기
  useEffect(() => {
    if (status !== 'ready' || !mapRef.current || !clustererRef.current) return;
    const k = window.kakao.maps;

    // 기존 마커 제거
    clustererRef.current.clear();
    markersRef.current = [];

    if (!markers || markers.length === 0) return;

    const created: kakao.maps.Marker[] = [];
    for (const m of markers) {
      const marker = new k.Marker({
        position: new k.LatLng(m.lat, m.lng),
        title: m.name,
        clickable: true,
      });
      k.event.addListener(marker, 'click', () => {
        onMarkerClickRef.current?.(m);
      });
      created.push(marker);
    }
    clustererRef.current.addMarkers(created);
    markersRef.current = created;
  }, [markers, status]);

  // center/level 외부 변경
  useEffect(() => {
    if (!mapRef.current) return;
    const k = window.kakao.maps;
    mapRef.current.setCenter(new k.LatLng(center.lat, center.lng));
  }, [center.lat, center.lng]);

  useEffect(() => {
    if (!mapRef.current) return;
    mapRef.current.setLevel(level);
  }, [level]);

  if (!appKey) {
    return (
      <div className={`${className ?? ''} kakao-map-fallback`}>
        <p>
          <strong>VITE_KAKAO_MAP_KEY</strong> 가 설정되지 않았습니다.
        </p>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className={`${className ?? ''} kakao-map-fallback`}>
        지도 SDK 로딩 실패 — 키/도메인 등록을 확인하세요.
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ width: '100%', height: '100%' }}
      aria-label="지도"
    />
  );
}
