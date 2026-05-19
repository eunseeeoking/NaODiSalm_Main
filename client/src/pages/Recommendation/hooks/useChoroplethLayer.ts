/**
 * 카카오맵 위에 GeoJSON 폴리곤을 통근 히트맵으로 그리는 hook
 *
 *  ▷ 입력
 *    - map         : 카카오맵 인스턴스 (null 이면 대기)
 *    - status      : SDK 로딩 상태
 *    - geojsonUrl  : 한 번만 fetch (브라우저 캐싱)
 *    - colorByCode : 행정동 코드 → fill 색상 매핑 (인내심 슬라이더 등에 따라 갱신)
 *    - onHover     : 폴리곤 호버 시 코드 전달 (지도↔카드 양방향 호버 연동용)
 *    - onClick     : 폴리곤 클릭 시 코드 전달
 *    - visible     : false 면 전체 숨김 (히트맵 OFF)
 *    - fillOpacity / strokeColor 등 시각 옵션
 *
 *  ▷ 동작
 *    - GeoJSON 은 1회 fetch → polygonsRef 에 보관
 *    - colorByCode 변경 시 setOptions 로 색상만 갱신 (폴리곤 재생성 X)
 *    - visible 변경 시 setMap(null) / setMap(map)
 *    - cleanup 에서 모든 폴리곤 제거
 *
 *  ▷ properties 스키마
 *    - adm_cd2 (10자리) 또는 adm_cd 로 행정동 코드 추출
 */
import { useEffect, useRef, useState } from 'react';
import type { KakaoLoaderState } from '../../../hooks/useKakaoLoader';

interface Feature {
  type: 'Feature';
  geometry: {
    type: 'Polygon' | 'MultiPolygon';
    coordinates: number[][][] | number[][][][];
  };
  properties: Record<string, string | number | undefined>;
}

interface FeatureCollection {
  type: 'FeatureCollection';
  features: Feature[];
}

interface ChoroplethOptions {
  /** 행정동 코드 → fill 색상 (예: { "1168051000": "#3182F6" }) */
  colorByCode: Record<string, string>;
  /** 폴리곤 호버 시 호출 (null 이면 leave) */
  onHover?: (code: string | null) => void;
  /** 폴리곤 클릭 시 호출 */
  onClick?: (code: string) => void;
  /** 표시 여부 (히트맵 ON/OFF) */
  visible?: boolean;
  /** fill 투명도 0~1 */
  fillOpacity?: number;
  /** 외곽선 색 */
  strokeColor?: string;
  strokeWeight?: number;
  /** 색상이 지정되지 않은 행정동의 기본 fill */
  defaultFill?: string;
}

interface ChoroplethResult {
  /** GeoJSON 로드 완료 여부 */
  loaded: boolean;
  /** 로드된 feature 수 */
  featureCount: number;
}

export function useChoroplethLayer(
  map: kakao.maps.Map | null,
  status: KakaoLoaderState,
  geojsonUrl: string,
  options: ChoroplethOptions,
): ChoroplethResult {
  const [loaded, setLoaded] = useState(false);
  const [featureCount, setFeatureCount] = useState(0);

  // GeoJSON 원본 (1회 로드)
  const geojsonRef = useRef<FeatureCollection | null>(null);
  // 생성된 폴리곤 + 매핑된 행정동 코드
  const polygonsRef = useRef<Array<{ poly: kakao.maps.Polygon; code: string }>>([]);
  // 콜백 ref (함수 reference 변경에 폴리곤 재생성 안 되게)
  const onHoverRef = useRef(options.onHover);
  const onClickRef = useRef(options.onClick);
  onHoverRef.current = options.onHover;
  onClickRef.current = options.onClick;

  // ── 1) GeoJSON fetch (URL 변경 시에만) ────────────────────
  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    fetch(geojsonUrl)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<FeatureCollection>;
      })
      .then((g) => {
        if (cancelled) return;
        geojsonRef.current = g;
        setFeatureCount(g.features.length);
        setLoaded(true);
      })
      .catch((e) => {
        console.error('[choropleth] geojson fetch fail:', e);
      });
    return () => {
      cancelled = true;
    };
  }, [geojsonUrl]);

  // ── 2) 폴리곤 생성 (map / loaded / visible 변경 시) ────────
  useEffect(() => {
    if (status !== 'ready' || !map || !geojsonRef.current) return;
    const k = window.kakao.maps;
    const visible = options.visible !== false;

    // 기존 제거
    polygonsRef.current.forEach(({ poly }) => poly.setMap(null));
    polygonsRef.current = [];

    if (!visible) return;

    for (const feature of geojsonRef.current.features) {
      const code = extractCode(feature.properties);
      const paths = geomToKakaoPaths(feature.geometry, k);
      const fillColor =
        options.colorByCode[code] ?? options.defaultFill ?? '#E5E8EB';

      for (const path of paths) {
        const poly = new k.Polygon({
          path,
          fillColor,
          fillOpacity: options.fillOpacity ?? 0.45,
          strokeColor: options.strokeColor ?? '#FFFFFF',
          strokeWeight: options.strokeWeight ?? 1,
          strokeOpacity: 0.6,
        });
        poly.setMap(map);

        k.event.addListener(poly, 'mouseover', () => {
          onHoverRef.current?.(code);
        });
        k.event.addListener(poly, 'mouseout', () => {
          onHoverRef.current?.(null);
        });
        k.event.addListener(poly, 'click', () => {
          onClickRef.current?.(code);
        });

        polygonsRef.current.push({ poly, code });
      }
    }

    return () => {
      polygonsRef.current.forEach(({ poly }) => poly.setMap(null));
      polygonsRef.current = [];
    };
    // colorByCode 는 별도 useEffect 에서 처리 (재생성 비용 회피)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    map,
    status,
    loaded,
    options.visible,
    options.fillOpacity,
    options.strokeColor,
    options.strokeWeight,
    options.defaultFill,
  ]);

  // ── 3) 색상만 변경 (인내심 슬라이더 등) ────────────────────
  useEffect(() => {
    if (polygonsRef.current.length === 0) return;
    for (const { poly, code } of polygonsRef.current) {
      const fillColor =
        options.colorByCode[code] ?? options.defaultFill ?? '#E5E8EB';
      poly.setOptions({ fillColor });
    }
  }, [options.colorByCode, options.defaultFill]);

  return { loaded, featureCount };
}

// ─────────────────────────────────────────────────────────
// GeoJSON 좌표 → 카카오 LatLng[]
//  - Polygon: outer ring 만 사용 (hole 무시)
//  - MultiPolygon: 각 polygon 의 outer ring 을 별도 배열로
// ─────────────────────────────────────────────────────────
function geomToKakaoPaths(
  geom: Feature['geometry'],
  k: typeof window.kakao.maps,
): kakao.maps.LatLng[][] {
  if (geom.type === 'Polygon') {
    const coords = geom.coordinates as number[][][];
    return [coords[0].map(([lng, lat]) => new k.LatLng(lat, lng))];
  }
  if (geom.type === 'MultiPolygon') {
    const polys = geom.coordinates as number[][][][];
    return polys.map((poly) =>
      poly[0].map(([lng, lat]) => new k.LatLng(lat, lng)),
    );
  }
  return [];
}

function extractCode(props: Feature['properties']): string {
  return String(props.adm_cd2 ?? props.adm_cd ?? '');
}
