# 작업 로그 — 2026-05-29 (가로 슬라이더 정리 + 모바일 z-index + 통근 캐시 INSERT 부하 3중 패치)

## 한 줄 요약

> **내부 가로 스크롤 영역 6곳을 스크롤바 숨김 슬라이더로 통일 + 모바일 검색 드롭다운 z-index 픽스 + 통근 매트릭스 캐시 INSERT 부하 3중 패치 완료.** `useDragScroll` 훅 + `.scroll-x-slider` 클래스로 칩셋류를 드래그 슬라이더화. 검색목록 z-30→z-50 으로 드로어 위 노출. 캐시 미스 반복 검색 시 DB INSERT 폭주를 ① bulk write ② 클라이언트 debounce+abort ③ 서버 in-flight 락 으로 해소. esbuild 문법 검증 EXIT:0.

---

## 0. 진입 컨텍스트

- 직전 세션(2026-05-28): `/intro` 랜딩 + 폰트 + 안정성 핫픽스 + ODsay 3×3 격자 재설계 단서.
- 본 세션 3트랙:
  - (A) 좌우 배열 항목(소득분위·인기직장·통근시간 칩셋 등) 전부 스크롤바 숨긴 슬라이더로 통일.
  - (B) 모바일에서 검색 리스트가 펼쳐질 때 통근/가중치/추천지역 칩셋 라인의 그림자가 리스트 위로 올라오는 z-index 버그.
  - (C) "캐싱 안 된 곳을 연달아 검색하면 DB INSERT 부담이 너무 큼" → 사용자가 ①+②+③ 전부 적용 선택.

---

## 1. (A) 가로 스크롤 → 드래그 슬라이더 통일

### 1.1 신규 훅 + CSS

```
client/src/hooks/useDragScroll.ts          신규  포인터 드래그로 가로 스크롤
  · pointerdown/move/up + setPointerCapture
  · 드래그 중 .is-dragging 토글 (cursor: grabbing)
  · 제네릭 ref 반환 useDragScroll<HTMLDivElement>()

client/src/css/index.css                   +4 lines
  .scroll-x-slider { scrollbar-width: none; -ms-overflow-style: none; }
  .scroll-x-slider::-webkit-scrollbar { width: 0; height: 0; display: none; }
  .scroll-x-slider.is-dragging { cursor: grabbing; user-select: none; }
```

### 1.2 적용 6곳

```
client/src/pages/Recommendation/index.tsx                         데이터 스트립 + 모바일 필터 바
client/src/pages/Recommendation/components/WeightSliders.tsx      소득분위 칩셋
client/src/pages/Recommendation/components/WorkplaceSearch.tsx    인기직장 칩셋
client/src/pages/Recommendation/components/MapPanel.tsx           통근시간 범례
client/src/pages/Recommendation/components/ComplexCardList.tsx    카드 가로 스크롤
```

각 영역에 `ref={useDragScroll()}` + `overflow-x-auto scroll-x-slider` 부여. 데스크톱은 `md:flex-wrap` 으로 줄바꿈 유지, 모바일만 슬라이더.

### 1.3 파일 손상 복구

타입체크 중 .tsx 5개가 한 줄 중간에서 잘려 있던 것 발견(JSX 닫힘 누락 / unterminated string). `git show HEAD:"$f" > "$f"` 로 원복 후 편집 재적용. (Windows 마운트가 unlink 차단 → `git checkout`·`rm` 불가, 리다이렉트 덮어쓰기로 우회.)

---

## 2. (B) 모바일 검색 드롭다운 z-index 픽스

### 2.1 증상

> 모바일에서 검색 후 리스트가 아래로 펼쳐지면, 통근/가중치/추천지역 칩셋 라인 아래 그림자가 리스트 위로 올라와 가림.

### 2.2 진단

- 드로어 3종이 `z-40`, 백드롭이 `z-30`, 검색 드롭다운 `<ul>` 도 `z-30`.
- 헤더는 정적(별도 stacking context 없음) → 같은 루트 컨텍스트에서 동일 z-30 이면 후순위 DOM(드로어 그림자)이 위로.

### 2.3 처방 (1줄)

```
client/src/pages/Recommendation/components/WorkplaceSearch.tsx
  드롭다운 <ul>  z-30 → z-50   (드로어 z-40 / 백드롭 z-30 위로)
```

검색목록이 항상 최상위로 올라옴 — 사용자 요구("검색목록 리스트가 z-index 가장 위로") 충족.

---

## 3. (C) 통근 매트릭스 캐시 INSERT 부하 3중 패치

### 3.1 진단 — 부하의 정체

```
1. 캐시 미스 1건당 upsertCommuteEntries 가 행마다 await prisma.upsert
   → 미스 검색 1회당 DB 왕복 최대 ~1000번
2. 사용자가 캐싱 안 된 곳을 빠르게 연달아 검색하면
   → 이전 요청을 클라이언트가 무시만 하고 서버는 끝까지 ODsay 호출 + INSERT
3. 같은 origin(=cacheKey) 동시 요청이 각자 ODsay+write 폭주 (중복)
```

→ 3중 원인: per-row upsert 루프 + 버려진 요청의 서버 완주 + 동일 cacheKey 동시 폭주.

### 3.2 ① Bulk write — `createMany`

`server/src/services/repositories/commuteRepository.ts`

```typescript
export async function upsertCommuteEntries(cacheKey, entries) {
  if (entries.length === 0) return 0;
  const result = await prisma.commuteMatrix.createMany({
    data: entries.map((e) => ({ cacheKey, workLat: e.workLat, /* ... */ })),
    skipDuplicates: true,   // = INSERT IGNORE (MySQL/TiDB)
  });
  return result.count;
}
```

- 미스 1건당 DB 왕복 **N → 1**.
- 두 콜러(`/matrix`·`/compare`) 모두 캐시 미스 경로에서만 호출 → 정의상 행 없음, `skipDuplicates` 안전.
- "존재 시 update / computedAt 갱신" 동작은 상실 — 캐시이므로 stale 은 TTL/재시드로 처리(주석 명시).

### 3.3 ② 클라이언트 debounce + AbortController

`client/src/api/commute.ts`

```typescript
export async function fetchCommuteMatrix(origin, targets, signal?: AbortSignal) {
  // 단일/청크 apiFetch 양쪽에 signal 전달
}
```

`apiFetch` 는 `RequestOptions extends Omit<RequestInit,'body'>` 라 `signal` 이 `...rest` 로 자동 전달(클라 래퍼 변경 불필요).

`client/src/pages/Recommendation/components/MapPanel.tsx` — 매트릭스 effect 재작성

```typescript
setMatrix(null); setMatrixStats(null); setMatrixLoading(true);
const controller = new AbortController();
const debounceId = window.setTimeout(() => {
  fetchCommuteMatrix(origin, centroids, controller.signal)
    .then((resp) => { if (controller.signal.aborted) return; /* set */ })
    .catch((e) => { if (controller.signal.aborted) return; console.error(e); })
    .finally(() => { if (!controller.signal.aborted) setMatrixLoading(false); });
}, 400);
return () => { window.clearTimeout(debounceId); controller.abort(); };
```

- 기존 `cancelled` 플래그(응답만 무시)와 달리 **실제로 요청 취소** → 서버가 버려질 검색을 완주하지 않음.
- 400ms debounce 로 연타 검색을 1회로 수렴.

### 3.4 ③ 서버 in-flight 락 (cacheKey 단위)

`server/src/routes/domains/commute.ts`

```typescript
const inFlight = new Map<string, Promise<unknown>>();

async function withCacheKeyLock<T>(cacheKey: string, fn: () => Promise<T>): Promise<T> {
  const prev = inFlight.get(cacheKey) ?? Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  inFlight.set(cacheKey, next);
  next.finally(() => { if (inFlight.get(cacheKey) === next) inFlight.delete(cacheKey); });
  return next;
}
```

- `/matrix` 핸들러의 캐시조회+ODsay+upsert+payload 조립을 `withCacheKeyLock(cacheKey, ...)` 로 감싸 직렬화.
- 같은 cacheKey 요청이 줄지어 실행 → 앞 요청이 캐시를 채우면 뒤 요청은 cache hit 으로 흡수 → ODsay/INSERT 중복 폭주 제거.
- 결과 공유가 아닌 "순차 실행"만 보장(뒤 요청은 앞이 쓴 캐시를 읽음).
- 핸들러 전체를 try/catch 로 감싸 실패 시 500 JSON 응답 + `elapsedMs` 는 락 밖에서 측정.

---

## 4. 변경 파일 통계

```
서버 (2)
  src/services/repositories/commuteRepository.ts   루프 upsert → createMany (bulk write)
  src/routes/domains/commute.ts                    +30 lines (in-flight 락 + try/catch)

클라이언트 (8)
  src/hooks/useDragScroll.ts             신규  드래그 가로 스크롤 훅
  src/css/index.css                      +4 lines (.scroll-x-slider)
  src/api/commute.ts                     +signal 인자 (단일/청크 전달)
  src/pages/Recommendation/index.tsx                          데이터 스트립 + 모바일 필터 슬라이더
  src/pages/Recommendation/components/WeightSliders.tsx       소득분위 칩셋 슬라이더
  src/pages/Recommendation/components/WorkplaceSearch.tsx     인기직장 슬라이더 + 드롭다운 z-50
  src/pages/Recommendation/components/MapPanel.tsx            범례 슬라이더 + 매트릭스 debounce/abort
  src/pages/Recommendation/components/ComplexCardList.tsx     카드 가로 슬라이더
```

---

## 5. 검증

```
esbuild 문법 검증 (마운트 fresh-path 복사 후)
  server/src/routes/domains/commute.ts      EXIT:0 ✅
  client/src/api/commute.ts                 EXIT:0 ✅
  client/src/pages/.../MapPanel.tsx         EXIT:0 ✅
```

> ⚠ 샌드박스 Linux 마운트가 **이미 존재하던 inode 의 read-cache 를 write 후에도 무효화하지 않음**(신규 파일은 정상 동기화). 따라서 bash `tsc` 는 편집 파일에 대해 신뢰 불가 — esbuild 문법 검증만 수행. 타입 확정은 사용자 로컬 실행 필요.

---

## 6. 사용자 측 후속 작업

```
[★★★] 타입체크 양측 EXIT:0 확인
        cd C:\git\NaODiSalm_Main\server && npx tsc --noEmit
        cd C:\git\NaODiSalm_Main\client && npx tsc -b --noEmit

[★★]  회귀 스모크
        - 모바일에서 칩셋류 좌우 드래그 슬라이드 (스크롤바 비노출)
        - 모바일 검색 리스트가 드로어 그림자 위로 정상 노출 (z-50)
        - 캐싱 안 된 곳 연타 검색 → 마지막 1건만 fetch, 서버 살아 있음
        - 같은 직장 재검색 시 즉시 응답(캐시 hit)

[★]   임시 파일 정리
        client/__synctest.txt (마운트 unlink 제약으로 미삭제 — 삭제 무방)
```

---

## 7. 함정 (다음 세션 인지)

```
① createMany skipDuplicates 의 update 상실
   캐시 항목의 computedAt/값 갱신이 사라짐. stale 데이터는 TTL/재시드 정책으로
   처리해야 함. 현재 캐시 미스 경로 전용이라 동작 정상.

② in-flight 락은 단일 프로세스 한정
   Map 이 인스턴스 메모리라 다중 인스턴스(Render 스케일아웃) 환경에선 cacheKey
   직렬화가 인스턴스별로만 적용. 운영 단일 인스턴스면 무관. 분산 시 Redis 락 검토.

③ 마운트 read-cache staleness
   편집한 기존 파일은 bash tsc/cat 가 옛 내용을 읽을 수 있음. Windows 측(Read/Write/
   Edit)이 진실. 신규 경로 복사 + esbuild 로만 문법 확인. 타입은 로컬 tsc 필수.

④ debounce 400ms 와 UX
   매트릭스 로딩 인디케이터가 400ms 지연 후 시작. 너무 길면 체감 느려질 수 있음 —
   필요 시 250~300ms 로 조정 검토.
```

---

## 8. 다음 세션 첫 한 줄

> **"가로 슬라이더 통일 + 모바일 검색 z-index(z-50) + 통근 캐시 INSERT 3중 패치(bulk write / 클라 debounce·abort / 서버 in-flight 락) ✅. esbuild EXIT:0. 사용자 로컬 tsc 양측 + 회귀 스모크 후 → ODsay 3×3 격자 재설계(28일 §24.1 옵션 B Neighbor cover) 또는 잔여 9개 라우터 try-catch 일괄 도입 진입."**
