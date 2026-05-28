# 작업 로그 — 2026-05-28 (클라이언트 모바일 반응형 UI/UX 개선)

## 한 줄 요약

> **모바일 필터 바 + 탑-다운 드로어 패널 + 가중치 슬라이더 접힘/펼침 + ⓘ 뷰포트 클램핑 + input border 제거.** typecheck EXIT:0.

---

## 0. 진입 컨텍스트

- 직전 세션(2026-05-28 서버): Depth 3 신뢰도 픽스 + ML 인프라 + Phase 2-B LH 지오코딩.
- 본 세션: 클라이언트 전용 — 모바일 UX 전면 개선 + 소소한 품질 수정.

---

## 1. 모바일 반응형 UI/UX 전면 개선

### 1.1 모바일 필터 바 (검색 하단 가로 스크롤 메뉴)

**파일**: `src/pages/Recommendation/index.tsx`

- 헤더 검색 바 직하단에 `md:hidden` 필터 바 추가
- 3개 버튼: `통근·예산` / `가중치` / `추천지역`
- 가로 스크롤 가능(`overflow-x-auto scrollbar-none`), `shrink-0` 고정
- 활성 버튼: brand 채워짐 + 화살표 180° 회전 표시

### 1.2 모바일 탑-다운 드로어 패널

**파일**: `src/pages/Recommendation/index.tsx`

- `mobileActivePanel: 'commute' | 'weights' | 'regions' | null` 상태 추가
- 각 버튼 클릭 시 해당 패널이 `translateY(-100%) → translateY(0)` 로 상단에서 슬라이드 인
- 백드롭(`bg-black/30`) 탭 또는 버튼 재클릭으로 닫힘
- `max-h-[72vh] overflow-y-auto` — 키보드 팝업 시 입력 화면 최대한 확보
- 드로어 헤더(타이틀+닫기버튼) 제거 → 상단 8px 드래그 핸들만 유지 (영역 최소화)
- 드로어 `top` 을 `-top-px` 로 설정해 필터 바와 1px 밀착

### 1.3 데스크톱 동작 유지

- `isMobile` 분기로 `!isMobile` 시 기존 좌/우 슬라이드 + 토글 버튼 그대로 렌더
- 뷰포트 전환 시 `mobileActivePanel` 자동 초기화

---

## 2. 가중치 슬라이더 구조 재정의

**파일**: `src/pages/Recommendation/components/WeightSliders.tsx`

### 변경 전
- 프리셋 + 슬라이더(4축) + 소득분위가 모두 한 번에 표시

### 변경 후
```
[가중치]                  [합 100/100]   ← 항상
[사회초년생][신혼부부][실거주][직장인]    ← 항상 (프리셋)
  ▾ 슬라이더 조정                        ← 토글 버튼
    통근 ────────── 30%                  ← 펼침 시만
    부담 ────────── 30%
    안전 ────────── 20%
    생활 ────────── 20%
━━━━━━━━━━━━━━━━━━━━━━━━━━━
[소득 분위]  [주거비 부담률(RIR)]         ← 항상
[미선택][1분위]…[5분위]                  ← 항상
3분위(403만원) 기본값 적용 중             ← 항상
[월 급여 ___만원]                        ← 항상
```

- `gridTemplateRows: 0fr ↔ 1fr` CSS grid trick으로 슬라이더 부드럽게 펼침/접힘
- 합 범위 경고(90~110 벗어남)는 슬라이더 영역 내부에서만 표시
- 소득분위 섹션은 슬라이더와 독립 — 항상 표시

---

## 3. ⓘ InfoTooltip 뷰포트 좌측 클리핑 수정

**파일**: `src/components/InfoTooltip.tsx`

### 원인
- `top`/`bottom` 위치에서 `transform: translate(-50%, ...)` 로 수평 중앙 정렬
- 아이콘이 좌측 가장자리 근처이면 `-50%` 이동으로 뷰포트 밖으로 잘림

### 수정
```typescript
// Before
left: cx,
transform: 'translate(-50%, -100%)'

// After — JS에서 뷰포트 경계 클램핑
const clampedLeft = Math.max(8, Math.min(cx - MAX_TIP_PX / 2, vw - MAX_TIP_PX - 8));
left: clampedLeft,
transform: 'translateY(-100%)'   // 수직만 남김
```

- `MAX_TIP_PX = 208` (max-w-[13rem] @ 16px root)
- 좌측 8px / 우측 8px 최소 여백 보장
- 모바일 탑-다운 드로어 안에서도 동일하게 적용

---

## 4. WorkplaceSearch 소소한 개선

**파일**: `src/pages/Recommendation/components/WorkplaceSearch.tsx`

- 검색 input `border-0` 명시 추가 (user-agent stylesheet border 제거)
- `"인기 직장"` 레이블: `hidden sm:inline` — 모바일 숨김, sm+ 표시
- 퀵칩 행: `overflow-x-auto scrollbar-none md:flex-wrap` — 모바일 한 줄 가로 스크롤
- 6번째 항목(마곡): `hidden sm:inline-block` — 모바일에서 5개만 표시

---

## 5. WeightSliders 월급여 input border 제거

**파일**: `src/pages/Recommendation/components/WeightSliders.tsx`

- 월급여 input에 `border-0` 명시 추가

---

## 6. 변경 파일 통계

```
클라이언트 (5)
  src/pages/Recommendation/index.tsx                      전면 재작성 (~430 lines)
    · 모바일 필터 바
    · 모바일 탑-다운 드로어 3종 (통근·예산 / 가중치 / 추천지역)
    · 데스크톱 좌/우 패널 isMobile 조건부 렌더
    · 필터 바 border-b 제거 + 드로어 -top-px 갭 제거

  src/components/InfoTooltip.tsx                          +15 lines (뷰포트 클램핑)

  src/pages/Recommendation/components/WeightSliders.tsx   전면 재작성 (~230 lines)
    · 슬라이더 접힘/펼침 (grid trick)
    · 소득분위 항상 표시로 분리
    · 월급여 input border-0

  src/pages/Recommendation/components/WorkplaceSearch.tsx +8 lines
    · 검색 input border-0
    · 인기 직장 레이블 모바일 숨김
    · 퀵칩 한 줄 스크롤 / 모바일 5개 제한

총 변경 ~700 lines
```

---

## 7. typecheck 검증

```
cd client && npx tsc --noEmit   → EXIT:0 ✅
```

---

## 8. 함정 / 다음 세션 인지

```
① 드로어 -top-px 처리
   main(overflow-hidden) 바깥으로 1px 삐져나오도록 설계.
   브라우저/디바이스에 따라 미세하게 보일 수 있음.
   더 깔끔한 방법: main overflow-hidden 제거 후 각 드로어에 clip-path 적용 (현재 비적용).

② WeightSliders slidersOpen 상태
   리마운트 시 초기화됨 (모바일 드로어 열고 닫으면 접힘 상태로 리셋).
   지속 원하면 zustand 스토어나 sessionStorage 저장 고려.

③ 모바일 드로어 max-h-[72vh]
   소득분위 + 슬라이더 동시 펼침 시 스크롤 필요할 수 있음.
   사용자 경험상 큰 문제 없으나 max-h 조정 가능 (80vh 등).

④ 인기 직장 6→5 모바일 제한
   popularWorkplaces.ts 의 6번째 항목(마곡)은 sm+ 에서만 노출.
   향후 인기 직장 목록 변경 시 인덱스 기반 숨김 로직 함께 수정 필요.
```

---

## 9. 추가 작업 (세션 후반)

### 9.1 헤더 버튼 배경 제거 + 정렬 통일

**파일**: `src/pages/Recommendation/components/RecommendationHeader.tsx`

- 공유 버튼 / 테마 토글 버튼 `bg-brand-50`, `dark:bg-brand/[.15]`, `hover:bg-brand hover:text-white` 제거
- 두 버튼 모두 `inline-flex items-center justify-center p-2` 로 통일 → 동일 박스 크기, 아이콘 중앙 정렬
- 공유 버튼 아이콘 14px → 16px (테마 토글과 동일)
- hover 색상은 배경 채움 대신 `hover:text-brand`만

### 9.2 PC 가로 스크롤바 개선 — `.scroll-x-thin` 전역 클래스

**파일**: `src/css/index.css` + 4개 컴포넌트

#### 문제
`scrollbar-none` 은 WebKit에서 스크롤바를 숨기지만, Windows Chrome/Edge 기본 스크롤바는 두꺼운 화살표+트랙이 노출되어 미관 저해.

#### 해결
```css
/* src/css/index.css 에 추가 */
.scroll-x-thin {
  scrollbar-width: thin;               /* Firefox */
  scrollbar-color: #D1D5DB transparent;
}
.scroll-x-thin::-webkit-scrollbar       { height: 3px; }
.scroll-x-thin::-webkit-scrollbar-track { background: transparent; }
.scroll-x-thin::-webkit-scrollbar-button { display: none; } /* 화살표 제거 */
.scroll-x-thin::-webkit-scrollbar-thumb { background: #D1D5DB; border-radius: 9999px; }
.scroll-x-thin::-webkit-scrollbar-thumb:hover { background: #9CA3AF; }
/* 다크 모드 별도 thumb 색상 */
```

#### 교체 대상 (scrollbar-none → scroll-x-thin)
- `WorkplaceSearch.tsx` — 인기 직장 퀵칩 행
- `WeightSliders.tsx` — 소득 분위 칩 행
- `MapPanel.tsx` — 통근시간 범례
- `index.tsx` — 모바일 필터 바 (모바일은 OS가 숨기므로 실질 영향 없음)

### 9.3 가로 슬라이드 전체 개방

**파일**: `WorkplaceSearch.tsx`

인기 직장 6번째(마곡)의 `hidden sm:inline-block` 제거 → 전 항목 동일 `shrink-0` 클래스, 가로 스크롤로 모두 노출.

### 9.4 소득분위 칩 가로 스크롤

**파일**: `WeightSliders.tsx`

소득분위 칩 컨테이너 `flex-wrap` → `overflow-x-auto scroll-x-thin`, 각 칩 `shrink-0` 추가.

---

## 10. 최종 변경 파일 통계 (전체 세션)

```
클라이언트 (7)
  src/css/index.css                                         +48 lines (scroll-x-thin)
  src/pages/Recommendation/index.tsx                        전면 재작성 (~430 lines)
  src/pages/Recommendation/components/RecommendationHeader.tsx  +12 lines
  src/pages/Recommendation/components/WeightSliders.tsx     전면 재작성 (~230 lines)
  src/pages/Recommendation/components/WorkplaceSearch.tsx   +12 lines
  src/pages/Recommendation/components/MapPanel.tsx          +4 lines (범례 스크롤)
  src/components/InfoTooltip.tsx                            +15 lines (뷰포트 클램핑)

문서 (1)
  client/docs/2026-05-28/work-log.md                        신규

총 변경 ~750 lines
```

---

## 11. typecheck 최종

```
cd client && npx tsc --noEmit   → EXIT:0 ✅
```

---

## 12. 다음 세션 첫 한 줄 (세션 1)

> **"클라이언트 모바일 UX 개선 + 스크롤바/버튼 정리 완료 ✅. 다음 세션: (1) ODsay 3×3 격자 재설계(B안 Neighbor cover), (2) 잔여 9개 서버 라우터 try-catch 일괄 적용, (3) ML 세션 산출물 도착 시 README 스크린샷 + 기획서 §6 KPI 채움 → Render 배포 점검."**

---

---

# 세션 2 — 2026-05-28 (버그 픽스 + OG 메타 + 1뎁스 기획)

## 한 줄 요약

> **RegionDetail 모바일 스크롤 근본 원인 수정 + AboutData 스크롤 + RegionMiniMap 드래그 + 헤더 정리 + OG 메타태그 세팅 + 1뎁스 랜딩 아이디어 정리.**

---

## 13. RegionDetail 모바일 스크롤 불가 — 근본 원인 수정

### 원인 3중 구조

| # | 파일 | 원인 |
|---|------|------|
| 1 | `src/css/index.css` | `html, body, #root { overflow: hidden }` 전역 설정으로 문서 레벨 스크롤 완전 차단 |
| 2 | `RegionDetail/index.tsx` | 외부 컨테이너 `min-h-screen` + 내부 스크롤 컨테이너 없음 → 콘텐츠 클리핑 |
| 3 | `RegionDetail/index.tsx` | 분석 섹션 `flex-1`이 모바일 auto-height 컨텍스트에서 0으로 붕괴 |

### 수정 내역

**`RegionDetail/index.tsx`**
```
외부 컨테이너: w-screen md:h-screen min-h-screen md:overflow-hidden
           → w-screen h-screen overflow-hidden

<main>:      flex-1 grid ... md:overflow-hidden
           → flex-1 min-h-0 overflow-y-auto md:overflow-hidden grid ...

분석 div:    flex-1 grid ... md:overflow-hidden
           → grid ... md:flex-1 md:min-h-0 md:overflow-hidden

EmptyAnalysis/EmptyCommute: h-full → min-h-[80px] md:h-full
```

**`LstmFullAnalysis.tsx` / `CommuteCompare.tsx`**
```
h-full → md:h-full  (모바일 auto-height, 데스크톱 grid 행 채움)
```

**부산물 버그 수정**: 두 컴포넌트에 `return ()` 최상위 JSX 주석 삽입으로 발생한 파싱 오류 수정.

---

## 14. AboutData 페이지 스크롤 수정

**파일**: `src/pages/AboutData/index.tsx`

```
<div className="min-h-screen ...">
→ <div className="h-screen overflow-y-auto ...">
```

동일 원인 (`#root overflow:hidden`) — 컨테이너 자체를 스크롤 컨테이너로 전환.  
`sticky top-0` 헤더는 이 컨테이너 기준으로 고정되어 그대로 동작.

---

## 15. RegionMiniMap 드래그 수정

**파일**: `src/pages/RegionDetail/components/RegionMiniMap.tsx`

### 원인
- 카카오 지도 생성 시 `draggable` 옵션 미명시 (SDK 타입 정의에도 없는 필드)
- `relayout()` 을 `setTimeout(0)` 으로 즉시 호출 → 컨테이너 크기 미확정 시점에 바인딩 오류 가능성
- 리사이즈 리스너 누락 (2뎁스 MapPanel에는 있었음)

### 수정
```typescript
// relayout + 드래그 명시 활성화 — 100ms 여유
setTimeout(() => {
  map.relayout();
  const m = map as any;
  if (typeof m.setDraggable === 'function') m.setDraggable(true);
  if (typeof m.setScrollWheelZoomable === 'function') m.setScrollWheelZoomable(true);
}, 100);

// 리사이즈 리스너 추가 (2뎁스와 동일)
window.addEventListener('resize', () => mapInstance.relayout());
```

---

## 16. Recommendation 헤더 · 데이터 출처 정리

**파일**: `src/pages/Recommendation/components/RecommendationHeader.tsx`  
**파일**: `src/pages/Recommendation/index.tsx`

| 항목 | 변경 |
|------|------|
| 헤더 "데이터 출처" 링크 | 제거 |
| 헤더 "시군구 탐색 →" 링크 | 제거 (페이지 비활성화 상태이므로) |
| 공유 버튼 + 테마 토글 | `ml-auto` 래퍼 div로 묶어 우측 끝 고정 |
| 데이터 출처 칩 스트립 라벨 | `<span>` → `<Link to="/about/data">` + `underline underline-offset-2` |

---

## 17. MapPanel 배지 모바일 숨김

**파일**: `src/pages/Recommendation/components/MapPanel.tsx`

"행정동 N개 · 캐시 즉시 응답 (Xms)" 배지에 `hidden md:block` 추가.  
모바일에서는 공간 협소 + 정보 과부하로 숨김 처리.

---

## 18. Vercel 빌드 오류 3건 수정

```
TS6133  RecommendationHeader.tsx — Link import 미사용 → 삭제
TS2353  RegionMiniMap.tsx — MapOptions에 draggable 없음 → 생성 옵션 제거, any 캐스팅으로 런타임 호출
TS2339  RegionMiniMap.tsx — Map 타입에 setDraggable 없음 → 동일 any 캐스팅
```

---

## 19. OG 메타태그 + 카카오톡 공유 세팅

**파일**: `client/index.html`, `client/public/og-image.png`, `client/public/og-generator.html`

### index.html 추가 태그
```html
<!-- Open Graph (카카오톡·페이스북·슬랙) -->
og:type / og:site_name / og:title / og:description
og:url  → https://naodisalm.kr
og:image → https://naodisalm.kr/og-image.png (1200×630)
og:image:width / og:image:height / og:image:alt / og:locale

<!-- Twitter Card -->
twitter:card / twitter:title / twitter:description / twitter:image
```

### OG 이미지 생성
- 임시 영문 PNG (`og-image.png`) Pillow로 생성 — 1200×630, 50KB
- 한글 최종 버전용 `og-generator.html` 제공
  - Pretendard CDN 폰트 로드
  - 다크 배경 + 브랜드 블루 디자인 (한국형 상업 톤)
  - 콘솔 `screenshot()` 호출 → html2canvas → `og-image.png` 자동 다운로드

**og-generator.html 사용법**
1. 크롬에서 파일 열기, 줌 100%
2. 개발자도구 콘솔 → `screenshot()` 입력
3. 다운된 `og-image.png` → `client/public/og-image.png` 덮어쓰기

**배포 후 카카오 캐시 초기화**: https://developers.kakao.com/tool/clear/og

---

## 20. 1뎁스 랜딩 페이지 — 아이디어 (다음 세션 구현)

### 배경
- 현재 `/` 가 바로 2뎁스(지도+추천)로 연결됨
- 카카오톡으로 링크 공유 시 첫 진입자에게 서비스 맥락이 없음
- `Login.tsx` 존재하나 라우트 미연결 상태

### 제안 라우트 재편
```
/ (1뎁스)      → LandingPage  (신규)
/app (2뎁스)   → RecommendationPage  (기존 / 에서 이동)
/region/:code  → RegionDetailPage  (유지)
/about/data    → AboutDataPage  (유지)
```

### 랜딩 페이지 구성안
```
┌─────────────────────────────────────────┐
│  헤더: 로고 + 나어디삶 + 다크모드 토글   │
├─────────────────────────────────────────┤
│  HERO                                   │
│  "직장과 가까운 동네,                    │
│   딱 맞는 매물을 AI가 찾아드립니다"       │
│                                         │
│  [직장 검색창 — WorkplaceSearch 재사용]  │  ← 핵심 CTA
│  [지금 시작하기 →]                       │
├─────────────────────────────────────────┤
│  특징 3카드 (통근 · 예산 · 안전+생활)    │
├─────────────────────────────────────────┤
│  공공데이터 출처 배지 (신뢰도 어필)      │
│  → 공모전 심사위원 대상 포인트           │
├─────────────────────────────────────────┤
│  Footer: naodisalm.kr                   │
└─────────────────────────────────────────┘
```

### 구현 포인트
- `WorkplaceSearch` 컴포넌트 재사용: 직장 입력 후 `/app` 으로 자동 이동
- OG 이미지와 동일한 다크 배경 톤 (브랜드 일관성)
- 모바일 우선 설계 (카카오톡 링크 진입자 대다수 모바일)
- `/app` 직접 접근 시 랜딩 스킵 가능 (북마크 사용자 배려)

---

## 21. 변경 파일 통계 (세션 2)

```
클라이언트 (9)
  src/pages/RegionDetail/index.tsx                       레이아웃 구조 수정
  src/pages/RegionDetail/components/LstmFullAnalysis.tsx h-full → md:h-full
  src/pages/RegionDetail/components/CommuteCompare.tsx   h-full → md:h-full + JSX 주석 오류
  src/pages/RegionDetail/components/RegionMiniMap.tsx    드래그 + 리사이즈 수정
  src/pages/AboutData/index.tsx                          min-h-screen → h-screen overflow-y-auto
  src/pages/Recommendation/index.tsx                     데이터 출처 칩 스트립 복구 + Link import
  src/pages/Recommendation/components/RecommendationHeader.tsx  링크 제거 + 버튼 우측 고정
  src/pages/Recommendation/components/MapPanel.tsx       배지 hidden md:block
  client/index.html                                      OG 메타태그 전체 + naodisalm.kr

문서 / 에셋 (2)
  client/public/og-image.png                             신규 (임시 영문 버전 1200×630)
  client/public/og-generator.html                        신규 (한글 최종 이미지 생성용)
```

---

## 22. 다음 세션 첫 한 줄

> **"세션 2 완료 ✅ — 모바일 스크롤 근본 수정 + OG 메타 세팅. 다음 세션: (1) 1뎁스 랜딩 페이지 구현 (`/` LandingPage, `/app` RecommendationPage 이동), (2) og-generator.html 로 최종 한글 og-image.png 교체, (3) 카카오 OG 캐시 초기화 후 공유 테스트."**
