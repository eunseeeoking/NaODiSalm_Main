/**
 * 지역 상세 미니 지도
 *  - 카카오맵 + 해당 행정동 중심 + 단지 핀 + 직장 마커(있을 시)
 *  - 단지 핀 클릭 → onSelectComplex
 *  - 선택된 단지는 강조 (size up + brand 색)
 *
 *  ※ 선택 지역(현재 보는 동) 경계 폴리곤을 옅게 강조 — "내가 어디를 보는지" 시각화.
 *    추천은 법정동 코드이고 GeoJSON 은 행정동이라 Depth 2(MapPanel)와 동일하게
 *    centroid 최근접 행정동 폴리곤에 매핑. useChoroplethLayer(includeCodes 단일) 재사용.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useKakaoLoader } from '../../../hooks/useKakaoLoader';
import { useChoroplethLayer } from '../../Recommendation/hooks/useChoroplethLayer';
import type { AptComplex } from '../../../types/region-detail';
import type { RegionRecommendation, Workplace } from '../../../types/recommendation';

// 수도권 행정동 GeoJSON / centroid — Depth 2(MapPanel)와 동일 자산 재사용.
const GEOJSON_URL = '/data/capital-hjd-simplified.geojson';
const CENTROIDS_URL = '/data/capital-centroids.json';

function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

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
    // 컨테이너 크기 확정 후 relayout — 늦은 렌더링 대비 100ms 여유
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const m = map as any;
    setTimeout(() => {
      map.relayout();
      // 타입 정의에 없지만 Kakao Maps SDK 런타임 메서드로 드래그 명시 활성화
      if (typeof m.setDraggable === 'function') m.setDraggable(true);
      if (typeof m.setScrollWheelZoomable === 'function') m.setScrollWheelZoomable(true);
    }, 100);
    setMapInstance(map);
  }, [status, mapInstance, region.lat, region.lng]);

  // 윈도우 리사이즈 시 지도 재배치 (2뎁스와 동일하게)
  useEffect(() => {
    if (!mapInstance) return;
    const onResize = () => mapInstance.relayout();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [mapInstance]);

  // 선택 지역(법정동) → 최근접 행정동 코드 매핑 — 경계 폴리곤 강조용 (Depth 2 와 동일 규약)
  const [admCode, setAdmCode] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch(CENTROIDS_URL)
      .then((r) => r.json() as Promise<Array<{ code: string; lat: number; lng: number }>>)
      .then((centroids) => {
        if (cancelled) return;
        let best = '';
        let bestKm = Infinity;
        for (const c of centroids) {
          const km = haversineKm(region.lat, region.lng, c.lat, c.lng);
          if (km < bestKm) { bestKm = km; best = c.code; }
        }
        setAdmCode(best || null);
      })
      .catch((e) => console.error('[miniMap] centroids fetch fail:', e));
    return () => { cancelled = true; };
  }, [region.lat, region.lng]);

  const includeCodes = useMemo(
    () => (admCode ? new Set([admCode]) : new Set<string>()),
    [admCode],
  );
  const colorByCode = useMemo(
    () => (admCode ? { [admCode]: '#3182F6' } : {}),
    [admCode],
  );

  // 선택 동 경계 폴리곤(옅은 brand 채움 + 또렷한 외곽선) — "지금 보는 지역" 시각화
  useChoroplethLayer(mapInstance, status, GEOJSON_URL, {
    colorByCode,
    includeCodes,
    visible: admCode != null,
    fillOpacity: 0.1,
    strokeColor: '#3182F6',
    strokeWeight: 2.5,
    defaultFill: '#3182F6',
  });

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
