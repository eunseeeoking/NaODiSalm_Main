/**
 * Kakao 지도 JavaScript API 최소 ambient 타입.
 *  - 정식 @types 가 없어 직접 선언 (필요한 멤버만 점진적으로 추가)
 *  - sdk.js 가 window.kakao 를 주입한다
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

    interface MapOptions {
      center: LatLng;
      level?: number;
      mapTypeId?: unknown;
      draggable?: boolean;
      scrollwheel?: boolean;
      disableDoubleClick?: boolean;
      disableDoubleClickZoom?: boolean;
      projectionId?: string;
      tileAnimation?: boolean;
      keyboardShortcuts?: boolean;
    }

    class Map {
      constructor(container: HTMLElement, options: MapOptions);
      setCenter(latlng: LatLng): void;
      getCenter(): LatLng;
      setLevel(level: number): void;
      getLevel(): number;
      relayout(): void;
    }

    class Marker {
      constructor(opts: { position: LatLng; map?: Map; title?: string });
      setMap(map: Map | null): void;
      setPosition(latlng: LatLng): void;
    }
  }
}

export {};
