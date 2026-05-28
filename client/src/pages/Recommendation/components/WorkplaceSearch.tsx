/**
 * 직장 검색 + 자동완성 + 퀵 칩 (토스 한국형 톤)
 *  - 선택 상태: 브랜드 블루 칩 + 우측 변경 버튼
 *  - 검색 상태: 라운드 입력 + 자동완성
 *  - 퀵 칩: 한글 "인기 직장"
 */
import { useEffect, useRef, useState } from 'react';
import { useKakaoLoader } from '../../../hooks/useKakaoLoader';
import { useDragScroll } from '../../../hooks/useDragScroll';
import { useRecommendationStore } from '../../../stores/useRecommendationStore';
import { POPULAR_WORKPLACES, type PopularWorkplace } from '../data/popularWorkplaces';

interface PlaceResult {
  place_name: string;
  road_address_name?: string;
  address_name: string;
  x: string;
  y: string;
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
  // 진행 중인 keywordSearch 의 순번 — 늦게 도착한 stale 응답이 최신 결과를 덮어쓰지 않도록 가드.
  // (모바일에서 빠르게 입력 시 비동기 응답이 뒤섞여 리스트가 더블링되던 문제 방지)
  const seqRef = useRef(0);
  // 인기 직장 칩 가로 스크롤 — 슬라이더(드래그) 동작 + 스크롤바 숨김
  const chipScrollRef = useDragScroll<HTMLDivElement>();

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
      const mySeq = ++seqRef.current;
      ps.keywordSearch(query, (data: PlaceResult[], statusCode: string) => {
        // 최신 요청의 응답만 반영 (이전 in-flight 응답은 무시)
        if (mySeq !== seqRef.current) return;
        if (statusCode === 'OK') {
          setResults(data.slice(0, 5));
          setOpen(true);
        } else {
          setResults([]);
        }
      });
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
    setWorkplace({ label: w.label, lat: w.lat, lng: w.lng, addressName: w.addressName });
  }

  // ─── 선택 완료 ───
  if (workplace) {
    return (
      <div className="flex items-center gap-2 px-3.5 py-2 bg-brand-50 dark:bg-brand/[0.12] border border-brand/30 rounded-card">
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="currentColor"
          className="text-brand shrink-0"
        >
          <path d="M12 2a8 8 0 0 0-8 8c0 4.5 8 12 8 12s8-7.5 8-12a8 8 0 0 0-8-8zm0 11a3 3 0 1 1 0-6 3 3 0 0 1 0 6z" />
        </svg>
        <span className="text-sm font-semibold text-brand-700 dark:text-brand-100 truncate">
          {workplace.label}
        </span>
        {workplace.addressName && (
          <span className="text-xs text-brand-600/70 dark:text-brand-200/70 truncate hidden md:inline">
            · {workplace.addressName}
          </span>
        )}
        <button
          onClick={() => setWorkplace(null)}
          className="ml-auto text-xs font-medium text-brand hover:text-brand-700 shrink-0 px-2 py-1 rounded-md hover:bg-brand/10 transition-colors"
        >
          변경
        </button>
      </div>
    );
  }

  // ─── 검색 ───
  return (
    <div className="relative">
      <div className="relative">
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-tertiary dark:text-ink-tertiary-dark pointer-events-none"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="m21 21-4.3-4.3" />
        </svg>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder="회사명, 지하철역, 도로명을 입력하세요"
          // 브라우저 기본 검색기록 드롭다운이 커스텀 자동완성 위에 겹쳐 뜨는(모바일 더블링) 현상 차단
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          className="w-full pl-9 pr-3 py-2 bg-surface-elevated dark:bg-surface-dark-elevated-hover border-0 rounded-card text-sm text-ink-primary dark:text-ink-primary-dark placeholder:text-ink-tertiary dark:placeholder:text-ink-tertiary-dark focus:outline-none transition-all"
        />
      </div>
      {open && results.length > 0 && (
        <ul className="list-none m-0 p-0 absolute z-30 top-full left-0 right-0 mt-1.5 bg-surface-elevated dark:bg-surface-dark-elevated border border-line-light dark:border-line-dark rounded-card shadow-card-hover overflow-hidden">
          {results.map((r, i) => (
            <li key={i}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(r)}
                className="w-full text-left px-3.5 py-2.5 hover:bg-brand-50 dark:hover:bg-surface-dark-elevated-hover border-b border-line-light dark:border-line-dark last:border-b-0 transition-colors"
              >
                <div className="text-sm font-semibold text-ink-primary dark:text-ink-primary-dark">
                  {r.place_name}
                </div>
                <div className="text-xs text-ink-tertiary dark:text-ink-tertiary-dark mt-0.5">
                  {r.road_address_name || r.address_name}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
      {/* 퀵 칩 — 모바일: 한 줄 가로 스크롤 / 데스크톱: 줄바꿈 허용 */}
      <div ref={chipScrollRef} className="flex items-center gap-1.5 mt-2 overflow-x-auto scroll-x-slider md:flex-wrap">
        <span className="hidden sm:inline text-xs text-ink-tertiary dark:text-ink-tertiary-dark font-medium shrink-0 mr-0.5">
          인기 직장
        </span>
        {POPULAR_WORKPLACES.map((w, _idx) => (
          <button
            key={w.id}
            onClick={() => pickPopular(w)}
            className="shrink-0 text-xs font-medium px-3 py-1 rounded-full bg-brand-50 dark:bg-brand/[.15] text-brand dark:text-brand-300 hover:bg-brand hover:text-white transition-colors"
          >
            {w.label}
          </button>
        ))}
      </div>
    </div>
  );
}
