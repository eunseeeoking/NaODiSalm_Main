import { useEffect, useRef } from 'react';
import { useKakaoLoader } from '../hooks/useKakaoLoader';

export interface LatLng {
  lat: number;
  lng: number;
}

interface KakaoMapProps {
  /** 초기 중심 좌표 (기본: 서울 시청) */
  center?: LatLng;
  /** 줌 레벨 (1~14, 작을수록 확대) */
  level?: number;
  className?: string;
}

const DEFAULT_CENTER: LatLng = { lat: 37.5665, lng: 126.978 }; // 서울 시청

export function KakaoMap({
  center = DEFAULT_CENTER,
  level = 5,
  className,
}: KakaoMapProps) {
  const appKey = import.meta.env.VITE_KAKAO_MAP_KEY ?? '';
  const status = useKakaoLoader(appKey, ['services']);
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<kakao.maps.Map | null>(null);

  // 지도 최초 생성
  useEffect(() => {
    if (status !== 'ready' || !containerRef.current || mapRef.current) return;
    const k = window.kakao.maps;
    mapRef.current = new k.Map(containerRef.current, {
      center: new k.LatLng(center.lat, center.lng),
      level,
    });
    // 사이드바 등 레이아웃 변화 후 타일이 깨질 때 대비
    setTimeout(() => mapRef.current?.relayout(), 0);
    // 의도적으로 deps 에 center/level 미포함 → 최초 1회만 생성
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  // 외부에서 center/level 변경 반영
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
          <br />
          <code>client/.env</code> 에 키를 추가하고 Vite 재기동 후 다시 보세요.
        </p>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className={`${className ?? ''} kakao-map-fallback`}>
        지도 SDK 로딩 실패 — 키가 유효한지, 플랫폼 도메인에 http://localhost:5173 이
        등록되어 있는지 확인하세요.
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
