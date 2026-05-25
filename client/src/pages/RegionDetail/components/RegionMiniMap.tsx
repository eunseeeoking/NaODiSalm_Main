/**
 * 지역 상세 미니 지도
 *  - 카카오맵 + 해당 행정동 중심 + 단지 핀 + 직장 마커(있을 시)
 *  - 단지 핀 클릭 → onSelectComplex
 *  - 선택된 단지는 강조 (size up + brand 색)
 *
 *  ※ 행정동 폴리곤 오버레이는 의도적으로 생략 (Depth 2 에서 이미 봤음 — 시선 분산 방지)
 *  ※ Choropleth 가 필요해질 경우 useChoroplethLayer 재사용 가능
 */
import { useEffect, useRef, useState } from 'react';
import { useKakaoLoader } from '../../../hooks/useKakaoLoader';
import type { AptComplex } from '../../../types/region-detail';
import type { RegionRecommendation, Workplace } from '../../../types/recommendation';

interface Props {
  region: RegionRecommendation;
  complexes: AptComplex[];
  workplace: Workplace | null;
  selectedComplexId: string | null;
  onSelectComplex: (complex: AptComplex) => void;
}

export function RegionMiniMap({
  region,
  complexes,
  workplace,
  selectedComplexId,
  onSelectComplex,
}: Props) {
  const appKey = import.meta.env.VITE_KAKAO_MAP_KEY ?? '';
  const status = useKakaoLoader(appKey, ['services']);
  const containerRef = useRef<HTMLDivElement>(null);
  const [mapInstance, setMapInstance] = useState<kakao.maps.Map | null>(null);
  const markersRef = useRef<kakao.maps.Marker[]>([]);
  const workplaceMarkerRef = useRef<kakao.maps.Marker | null>(null);

  // 지도 초기 생성
  useEffect(() => {
    if (status !== 'ready' || !containerRef.current || mapInstance) return;
    const k = window.kakao.maps;
    const map = new k.Map(containerRef.current, {
      center: new k.LatLng(region.lat, region.lng),
      level: 5,
    });
    setMapInstance(map);
    setTimeout(() => map.relayout(), 0);
  }, [status, mapInstance, region.lat, region.lng]);

  // 단지 마커 갱신
  useEffect(() => {
    if (!mapInstance) return;
    const k = window.kakao.maps;

    // 기존 마커 정리
    markersRef.current.forEach((m) => m.setMap(null));
    markersRef.current = [];

    // 단지 마커 (SVG 데이터URL)
    // lat/lng = 0 은 지오코딩 미완료 단지 → 핀 생략 (카드 목록엔 표시됨)
    complexes.filter((c) => c.lat !== 0 && c.lng !== 0).forEach((c) => {
      const isSelected = c.complexId === selectedComplexId;
      const fill = isSelected ? '#3182F6' : '#FFFFFF';
      const stroke = isSelected ? '#FFFFFF' : '#3182F6';
      const size = isSelected ? 22 : 16;

      const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}' viewBox='0 0 24 24'>
        <circle cx='12' cy='12' r='9' fill='${fill}' stroke='${stroke}' stroke-width='3'/>
      </svg>`;
      const url = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
      const image = new k.MarkerImage(url, new k.Size(size, size), {
        offset: new k.Point(size / 2, size / 2),
      });

      const marker = new k.Marker({
        position: new k.LatLng(c.lat, c.lng),
        image,
        title: c.name,
      });
      marker.setMap(mapInstance);

      k.event.addListener(marker, 'click', () => onSelectComplex(c));
      markersRef.current.push(marker);
    });

    return () => {
      markersRef.current.forEach((m) => m.setMap(null));
      markersRef.current = [];
    };
  }, [mapInstance, complexes, selectedComplexId, onSelectComplex]);

  // 직장 마커
  useEffect(() => {
    if (!mapInstance) return;
    const k = window.kakao.maps;

    if (workplaceMarkerRef.current) {
      workplaceMarkerRef.current.setMap(null);
      workplaceMarkerRef.current = null;
    }

    if (workplace) {
      const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='28' height='34' viewBox='0 0 28 34'>
        <path d='M14 0C6.27 0 0 6.27 0 14c0 10.5 14 20 14 20s14-9.5 14-20C28 6.27 21.73 0 14 0z' fill='#F04452'/>
        <circle cx='14' cy='14' r='5' fill='white'/>
      </svg>`;
      const url = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
      const image = new k.MarkerImage(url, new k.Size(28, 34), {
        offset: new k.Point(14, 34),
      });
      const marker = new k.Marker({
        position: new k.LatLng(workplace.lat, workplace.lng),
        image,
        title: workplace.label,
        zIndex: 99,
      });
      marker.setMap(mapInstance);
      workplaceMarkerRef.current = marker;
    }

    return () => {
      if (workplaceMarkerRef.current) {
        workplaceMarkerRef.current.setMap(null);
        workplaceMarkerRef.current = null;
      }
    };
  }, [mapInstance, workplace]);

  return (
    <div className="relative w-full h-full">
      <div ref={containerRef} className="absolute inset-0" />
      {status === 'error' && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-negative bg-surface-elevated dark:bg-surface-dark-elevated">
          지도를 불러올 수 없습니다.
        </div>
      )}
    </div>
  );
}
