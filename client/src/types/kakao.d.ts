/**
 * Kakao 지도 JavaScript API 최소 ambient 타입.
 *  - 정식 @types 가 없어 직접 선언 (필요한 멤버만 점진적으로 추가)
 */
declare global {
  interface Window {
    kakao: typeof kakao;
  }

  namespace kakao.maps {
    function load(callback: () => void): void;

    class LatLng {
      constructor(lat: number, lng: number);
      getLat(): number;
      getLng(): number;
    }

    class LatLngBounds {
      constructor();
      extend(latlng: LatLng): void;
      isEmpty(): boolean;
    }

    interface MapOptions {
      center: LatLng;
      level?: number;
    }

    class Map {
      constructor(container: HTMLElement, options: MapOptions);
      setCenter(latlng: LatLng): void;
      getCenter(): LatLng;
      setLevel(level: number): void;
      getLevel(): number;
      setBounds(bounds: LatLngBounds): void;
      relayout(): void;
    }

    class Marker {
      constructor(opts: {
        position: LatLng;
        title?: string;
        clickable?: boolean;
        zIndex?: number;
        image?: MarkerImage;
        map?: Map;
      });
      setMap(map: Map | null): void;
      setPosition(latlng: LatLng): void;
      getPosition(): LatLng;
      setZIndex(zIndex: number): void;
      setImage(image: MarkerImage): void;
    }

    class Size {
      constructor(width: number, height: number);
    }

    class Point {
      constructor(x: number, y: number);
    }

    interface MarkerImageOptions {
      offset?: Point;
      alt?: string;
      shape?: string;
      coords?: string;
    }

    class MarkerImage {
      constructor(src: string, size: Size, options?: MarkerImageOptions);
    }

    // ─── Polygon (행정동 통근 히트맵용) ──────────────────────
    interface PolygonOptions {
      path: LatLng[] | LatLng[][];
      strokeWeight?: number;
      strokeColor?: string;
      strokeOpacity?: number;
      strokeStyle?: string;
      fillColor?: string;
      fillOpacity?: number;
      zIndex?: number;
    }

    class Polygon {
      constructor(opts: PolygonOptions);
      setMap(map: Map | null): void;
      setOptions(opts: Partial<PolygonOptions>): void;
      setPath(path: LatLng[] | LatLng[][]): void;
    }

    namespace event {
      function addListener(target: unknown, type: string, handler: (...args: unknown[]) => void): void;
      function removeListener(target: unknown, type: string, handler: (...args: unknown[]) => void): void;
    }

    // ─── CustomOverlay (추천 지역 커스텀 핀 마커용) ────────────
    interface CustomOverlayOptions {
      position: LatLng;
      content: HTMLElement | string;
      xAnchor?: number;
      yAnchor?: number;
      zIndex?: number;
      clickable?: boolean;
      map?: Map;
    }

    class CustomOverlay {
      constructor(opts: CustomOverlayOptions);
      setMap(map: Map | null): void;
      setPosition(latlng: LatLng): void;
      getPosition(): LatLng;
      setContent(content: HTMLElement | string): void;
      setZIndex(zIndex: number): void;
    }

    namespace MarkerClusterer {
      // namespace placeholder for nested types
    }

    // ─── services 라이브러리 (Places, Geocoder 등) ────────────
    namespace services {
      type Status = 'OK' | 'ZERO_RESULT' | 'ERROR';

      interface PlaceSearchResultItem {
        id: string;
        place_name: string;
        category_name?: string;
        address_name: string;
        road_address_name?: string;
        x: string; // 경도(lng) — 문자열로 반환됨
        y: string; // 위도(lat)
        phone?: string;
        place_url?: string;
      }

      interface KeywordSearchOptions {
        page?: number;
        size?: number;
        location?: LatLng;
        radius?: number;
        bounds?: LatLngBounds;
      }

      class Places {
        constructor(map?: Map);
        keywordSearch(
          keyword: string,
          callback: (result: PlaceSearchResultItem[], status: Status) => void,
          options?: KeywordSearchOptions,
        ): void;
      }

      interface GeocoderAddressResult {
        address_name: string;
        x: string;
        y: string;
      }

      class Geocoder {
        addressSearch(
          address: string,
          callback: (result: GeocoderAddressResult[], status: Status) => void,
        ): void;
      }
    }
  }

  namespace kakao.maps.MarkerClusterer {
    interface Options {
      map: kakao.maps.Map;
      markers?: kakao.maps.Marker[];
      gridSize?: number;
      minLevel?: number;
      minClusterSize?: number;
      averageCenter?: boolean;
      disableClickZoom?: boolean;
    }
  }

  namespace kakao.maps {
    class MarkerClusterer {
      constructor(options: MarkerClusterer.Options);
      addMarkers(markers: Marker[], skipRender?: boolean): void;
      removeMarkers(markers: Marker[], skipRender?: boolean): void;
      clear(): void;
      redraw(): void;
    }
  }
}

export {};
