# 작업일지 2026-06-04 (client)

## 0. 한 줄 요약
`/about/data`·인트로·README의 **공공기관 수 표기를 실제 데이터 기준 "6개 공공기관 + 민간 API(ODsay·카카오)"로 통일**하고(재작년 수상작 "바로" 의식 표현 제거), **Google Tag Manager + SPA 페이지뷰 추적**을 도입.
이어서 **Depth 2 모바일 입력 패널 전면 개편**(드래그 핸들 하단화·메뉴 의미단위 분리·추천지역 결과를 하단 바텀시트로 분리)과 **Depth 3 모바일 하단 스크롤 잘림**을 해결.

> 환경: 클라이언트·서버 `tsc --noEmit` 통과 + `vite build` 통과. 실DB(TiDB) 라이브 카운트로 수치 검증.
> 커밋: `5654644`(데이터 정합 + GTM) · 본 세션 모바일분(별도 커밋).

---

## 1. 데이터 출처 정합 — "6개 공공기관 + 민간 API" (커밋 `5654644`)

### 1-1. 배경
- 인트로(`Landing`)는 "5개 공공기관", `/about/data`는 "4개 주관기관", 홈 chip은 5개 등 **기관 수 표기가 제각각**.
- 실제 데이터 기준 공공기관은 **6개**: 국토교통부 · 한국부동산원 · LH · 통계청 · 경찰청 · 국가대중교통(TAGO). 여기에 **민간 API**(ODsay·카카오) + 지자체(안전 보조).

### 1-2. 변경
- **소개 페이지**(`pages/Landing`): Hero 문구·배지(TAGO 배지 신설, cyan 톤)·차별점 카드를 "6개 공공기관 + 민간 API"로 통일. 차별점 헤드라인 `직방·다방·바로(2024 대상)…` → **`기존 부동산 앱과 무엇이 다른가`** (재작년 수상작 "바로" 의식 표현 제거).
- **데이터 페이지**(`pages/AboutData`): 제목·인트로를 6개 공공기관으로. (카드 자체는 라이브 row 수 표시라 그대로.)
- **규모 수치 실측 갱신**(TiDB 라이브):
  - RTMS 실거래 **7.3M건**(매매 1.93M + 전월세 5.40M), apt_trade 기간 **2006~2026(20년치)**, 아파트 단지 **20,589**.
  - 수도권 히트맵 행정동 **1,187**(capital-centroids), safety **2,564**·transit **1,611**(문서엔 옛 서울 469·33로 stale였음), REB 3,400(서울 25구), LH 49단지.
  - 인트로 NUMBER_CARDS, 홈 chip, `README.md` 표/머메이드 모두 위 수치로 정정. 서울→수도권 표기 반영.
- **부수 정합**: 홈 "데이터 출처" 툴팁·`App.tsx`·`ComplexCardList`·`server/.../meta.ts` 주석의 "4기관" 잔재 제거.

### 1-3. 애널리틱스 — GA4(gtag.js) + SPA 추적
- 최초 GTM(`GTM-MPNDNB3Z`)으로 도입했다가 세션 후반 사용자가 **GA4 gtag.js 직접 방식**(`G-8WDEQHDE04`)으로 변경 → 반영.
- `client/index.html`: `<head>` 상단에 gtag.js 스니펫(`gtag('config','G-8WDEQHDE04')`) 배치, GTM 스니펫·noscript 제거. (`dist/index.html`은 빌드 산출물이라 미수정.)
- `hooks/useGaPageViews.ts`(GTM판 리네임): react-router 라우트 전환마다 `gtag('event','page_view',{page_path,…})`. **최초 마운트는 skip**(gtag config 기본 page_view 와 중복 방지). `App`에서 1회 호출.
  - ⚠️ GA4 '향상된 측정 > 브라우저 기록 기반 페이지 변경'이 ON(기본)이면 본 훅과 **이중 집계** → 옵션 OFF(수동 훅) 또는 훅 제거(자동 측정) 중 택1.

---

## 2. Depth 2 모바일 입력 패널 개편

### 2-1. 드래그 핸들 하단화 + 닫기 제스처 (1a)
- 기존: 탑다운 드로어 핸들이 **상단**(시각 힌트만). 사용자가 핸들을 잡아 위로 당겨 닫으려 함(관찰).
- 변경: `MobileDrawer` 컴포넌트로 통일하고 **핸들을 패널 하단에 고정**(flex-col + 콘텐츠 `min-h-0 overflow-y-auto` → 짧으면 shrink-wrap, 길면 콘텐츠만 스크롤·핸들 고정).
- `DrawerHandle`: **탭 또는 위로 스와이프(>30px) 시 닫힘**.

### 2-2. 메뉴 의미단위 분리 (1b)
- `가중치` 하나에 묶였던 거래유형·매물종류·가중치·소득분위를 →
  **`통근·예산 / 거래유형 / 매물종류 / 가중치·소득분위`** 4개 입력 칩으로 분리.

### 2-3. 추천지역(결과) → 하단 바텀시트 (1c)
- 결과는 입력이 아니므로 칩 바에서 제외하고 **`ResultsSheet`**(하단에서 올라오는 바텀시트)로 분리.
- **peek**: 높이 `3.25rem`(제목 줄 `추천지역 N곳`만) — 그 아래 바닥에 지도 통근 범례가 그대로 깔림.
- **펼침**: 높이 `75%`·`bottom-0`, 범례 숨김, CardPanel 전체 노출.
- **입력 드로어 열림**: 높이 `0`(접힘).
- 헤더 탭=토글, 위/아래 드래그=펼침/접힘. `translateY` 대신 **height 토글**로 구현(translateY는 본문이 범례를 덮는 문제가 있었음).

### 2-4. 지도 통근 범례 (MapPanel)
- 범례를 `bottom-0`·고정 높이 `h-9`로 **가장 하단에 고정**, 결과 시트 peek가 그 위에 얹힘.
- `showLegend` prop 추가 → **결과 시트를 펼쳤을 때만 숨김**. 입력 드로어가 내려와도 범례 유지.

### 2-5. 칩 바 / 드로어 경계 1px 투명 틈 (서브픽셀 seam)
- 원인: 드로어 `-top-px` 상단 1px이 `main`의 `overflow-hidden`에 잘려 칩 바와의 경계에 서브픽셀 틈(지도 비침).
- 수정: 모바일 칩 바에 `-mb-px`로 `main`을 1px 끌어올려 드로어가 경계를 덮고, 그 겹침에 지도가 새지 않도록 `relative z-10` 부여.

---

## 3. Depth 3 모바일 하단 스크롤 잘림 (문제 2)

- 증상: 모바일에서 최하단 블록까지 스크롤이 안 되고 잘림(PC 반응형은 정상).
- 원인: 페이지 루트가 `h-screen`(=100vh, 모바일 동적 툴바 높이만큼 `#root`(`height:100%; overflow:hidden`)를 초과 → 하단 클립).
- 수정: 루트 `h-screen` → **`h-full`**(=`#root` 100% 정확히 일치, 100% 체인). Depth 3(`RegionDetail`) + 동일 셸 Depth 2(`Recommendation`) 모두 적용.

---

## 4. 변경 파일

**커밋 `5654644` (데이터 정합 + GTM)**
- `README.md` · `client/index.html` · `client/src/hooks/useGtmPageViews.ts`(신규)
- `client/src/{App.tsx, pages/Landing/index.tsx, pages/AboutData/index.tsx, pages/Recommendation/index.tsx, pages/RegionDetail/components/ComplexCardList.tsx}`
- `server/src/routes/domains/meta.ts`

**모바일 개편 커밋 `b3c4569` (본 세션 후속)**
- `client/src/pages/Recommendation/index.tsx`(MobileDrawer·DrawerHandle·ResultsSheet·칩 분리·seam·h-full)
- `client/src/pages/Recommendation/components/MapPanel.tsx`(범례 하단 고정 + `showLegend`)
- `client/src/pages/RegionDetail/index.tsx`(h-full 스크롤 수정)
- `client/doc/2026-06-04/work-log.md`(본 문서)

**애널리틱스 GA4 전환 커밋 (본 세션 후속)**
- `client/index.html`(GTM → gtag.js `G-8WDEQHDE04`, noscript 제거)
- `client/src/hooks/useGaPageViews.ts`(`useGtmPageViews` 리네임 + gtag 방식) · `client/src/App.tsx`(import/호출명)

---

## 5. 다음 세션 출발점 / 미처리

1. **`server/doc/db-state.md` 갱신** (사용자 보류): 2026-05-29자 stale(safety 469·transit 33 → 실제 2,564·1,611). `npm run db:snapshot` 실행 전 **`scripts/dbSnapshot.ts`의 추천 행정동 쿼리 `ac.sigungu_code LIKE '11%'`(서울 한정)를 수도권(11·28·41)으로 수정** 후 실행할 것.
2. **GA4 이중 집계 점검**(대시보드): '향상된 측정 > 브라우저 기록 기반 페이지 변경'이 ON이면 `useGaPageViews` 와 SPA page_view 이중 집계 → 옵션 OFF(수동 훅 유지) 또는 훅 제거(자동 측정) 중 택1.
3. **모바일 실기기 최종 점검**: peek↔펼침 전환, Depth 3 최하단 스크롤, 범례/seam.
4. (선택) 결과 펼침 시 CardPanel 자체 헤더("추천 지역 N건")와 시트 제목("추천지역 N곳") 경미한 중복 — 필요 시 정리.
