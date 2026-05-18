/**
 * 직장 검색 + 자동완성 + 퀵 칩
 *  - 카카오 Places API (services 라이브러리)로 키워드 검색
 *  - 회사명/지하철역/도로명 자유롭게 입력 가능
 *  - 인기 직장 6곳 칩으로 즉시 선택 가능 (발표 데모용 사전 캐싱)
 *
 *  ※ kakao.maps SDK 가 로딩된 후에야 services.Places 사용 가능 — useKakaoLoader 보장
 */
import { useEffect, useRef, useState } from 'react';
import { useKakaoLoader } from '../../../hooks/useKakaoLoader';
import { useRecommendationStore } from '../../../stores/useRecommendationStore';
import { POPULAR_WORKPLACES, type PopularWorkplace } from '../data/popularWorkplaces';

interface PlaceResult {
  place_name: string;
  road_address_name?: string;
  address_name: string;
  x: string; // lng
  y: string; // lat
}

export function WorkplaceSearch() {
  const appKey = import.meta.env.VITE_KAKAO_MAP_KEY ?? '';
  const status = useKakaoLoader(appKey, ['services', 'clusterer']);

  const workplace = useRecommendationStore((s) => s.workplace);
  const setWorkplace = useRecommendationStore((s) => s.setWorkplace);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PlaceResult[]>([]);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<number | null>(null);

  useEffect(() => {
    if (!query.trim() || status !== 'ready') {
      setResults([]);
      return;
    }
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      const PlacesCtor = window.kakao?.maps?.services?.Places;
      if (!PlacesCtor) return;
      const ps = new PlacesCtor();
      ps.keywordSearch(
        query,
        (data: PlaceResult[], statusCode: string) => {
          if (statusCode === 'OK') {
            setResults(data.slice(0, 5));
            setOpen(true);
          } else {
            setResults([]);
          }
        },
      );
    }, 250);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [query, status]);

  function pick(r: PlaceResult) {
    setWorkplace({
      label: r.place_name,
      lat: Number(r.y),
      lng: Number(r.x),
      addressName: r.road_address_name || r.address_name,
    });
    setQuery('');
    setOpen(false);
  }

  function pickPopular(w: PopularWorkplace) {
    setWorkplace({
      label: w.label,
      lat: w.lat,
      lng: w.lng,
      addressName: w.addressName,
    });
  }

  // ─── 선택 완료 상태 — 칩 ───
  if (workplace) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 bg-info-bg border border-info-border rounded-card">
        <span className="text-info-fg text-sm">◉</span>
        <span className="text-info-fg text-sm font-medium truncate">{workplace.label}</span>
        {workplace.addressName && (
          <span className="text-info-fg/70 text-xs truncate hidden md:inline">
            · {workplace.addressName}
          </span>
        )}
        <button
          onClick={() => setWorkplace(null)}
          className="ml-auto text-xs text-info-fg hover:underline shrink-0"
        >
          변경 ▾
        </button>
      </div>
    );
  }

  // ─── 검색 상태 ───
  return (
    <div className="relative">
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => results.length > 0 && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="🔍 회사명·지하철역·도로명을 입력하세요"
        className="w-full px-3 py-1.5 border border-gray-200 rounded-card text-sm bg-white focus:outline-none focus:border-brand"
      />
      {open && results.length > 0 && (
        <ul className="absolute z-30 top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-card shadow-lg overflow-hidden">
          {results.map((r, i) => (
            <li key={i}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(r)}
                className="w-full text-left px-3 py-2 hover:bg-gray-50 border-b border-gray-100 last:border-b-0"
              >
                <div className="text-sm font-medium text-gray-900">{r.place_name}</div>
                <div className="text-xs text-gray-500 mt-0.5">
                  {r.road_address_name || r.address_name}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
      {/* 퀵 칩 */}
      <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
        <span className="text-[10px] text-gray-500 mr-0.5">⚡ 인기 직장</span>
        {POPULAR_WORKPLACES.map((w) => (
          <button
            key={w.id}
            onClick={() => pickPopular(w)}
            className="text-[11px] px-2 py-0.5 border border-gray-200 rounded-full bg-gray-50 hover:bg-gray-100"
          >
            {w.label}
          </button>
        ))}
      </div>
    </div>
  );
}
