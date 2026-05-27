# Work Log — 2026-05-27

## 개요

Render(서버) 및 Vercel(클라이언트) 배포 실패 원인을 진단하고 TypeScript 컴파일 에러 4건을 수정함.

---

## 수정 사항

### 1. `server/src/services/recommendation/scoring.ts`
**에러**: `TS2339: Property 'complexCount' does not exist on type 'ScoredRegion'`

**원인**: `RegionMetrics` 인터페이스에 `complexCount` 필드가 정의되지 않았고, `ScoredRegion`이 `RegionMetrics`를 extend하기 때문에 라우터에서 `r.complexCount` 접근 시 컴파일 에러 발생.

**수정**: `RegionMetrics` 인터페이스에 `complexCount: number` 필드 추가.

```ts
// 추가된 필드
/** 행정동 내 단지 수 (마커 호버 툴팁용) */
complexCount: number;
```

---

### 2. `server/src/services/repositories/recommendationRepository.ts`
**에러**: 위 수정 이후 `RegionCandidate` 조립 객체에서 `complexCount` 값이 누락.

**원인**: `RegionCandidate` 조립 부분(`candidates` map)에서 `complexCount`를 전달하지 않아 타입 불일치.
집계 쿼리에서 `complex_count`는 이미 산출되어 `c.agg.complexCount`로 사용 가능한 상태였음.

**수정**: `RegionCandidate` 조립 시 `complexCount: c.agg.complexCount` 추가.

```ts
// 추가된 라인
complexCount: c.agg.complexCount,
```

---

### 3. `client/src/pages/Recommendation/components/MapPanel.tsx`
**에러**: `TS2694: Namespace 'global.kakao.maps' has no exported member 'CustomOverlay'`
`TS2339: Property 'CustomOverlay' does not exist on type 'typeof maps'`

**원인**: 설치된 `@types/kakao.maps` 패키지의 타입 정의에 `CustomOverlay`가 누락되어 있음. 런타임에는 정상 동작하지만 TS 컴파일 단계에서 타입을 찾지 못함.

**수정**: `useRef<kakao.maps.CustomOverlay[]>` → `useRef<any[]>`로 변경.

```ts
// 변경 전
const regionOverlaysRef = useRef<kakao.maps.CustomOverlay[]>([]);

// 변경 후
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const regionOverlaysRef = useRef<any[]>([]);
```

---

### 4. `client/src/pages/RegionDetail/components/LstmFullAnalysis.tsx`
**에러**: `TS2322: Type '{ labels: string[]; datasets: object[]; }' is not assignable to type 'ChartData<"line", ...>'`

**원인**: `datasets` 배열 내 객체들이 `object[]`로 추론되어 `react-chartjs-2`의 `<Line>` 컴포넌트가 요구하는 `ChartData<'line'>` 타입과 불일치.

**수정**: `chart.js`에서 `ChartData` 타입을 import하고 `lineData`에 타입 assertion 추가.

```ts
// import 추가
import type { ChartData } from 'chart.js';

// 변경 전
const lineData = { labels, datasets };

// 변경 후
const lineData = { labels, datasets } as ChartData<'line'>;
```

---

## 배포 상태

| 환경 | 플랫폼 | 빌드 결과 |
|------|--------|-----------|
| 서버 | Render | ✅ 수정 완료 (에러 1, 2) |
| 클라이언트 | Vercel | ✅ 수정 완료 (에러 3, 4) |
