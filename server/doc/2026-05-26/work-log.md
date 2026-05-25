# 작업 로그 — 2026-05-26 (D-3, UI/UX 정돈 + 모바일 반응형 도입)

## 한 줄 요약

> **클라이언트 UI/UX 트랙 — 좌측 패널 정돈(예산 통합·가중치 줄바꿈 해소), 우측 패널을 사이드 메뉴로 재설계, 글로벌 button 보더 리셋, Depth 2/3 모바일 반응형 도입.** 백엔드·데이터 변경 없음, 전 client typecheck EXIT:0 유지.

---

## 0. 진입 컨텍스트

- 직전 세션(2026-05-25, 세션 3) 종료 시점: Depth 3 실데이터 연결 완료, 자차 통근시간 비선형 추정.
- 다음 우선순위(`next-steps.md`): typecheck 재확인 / 자차 실경로 API / Render 배포 점검 / README 재작성 / (선택) 이동수단 토글.
- **본 세션은 위 트랙 대신, 사용자 피드백 기반의 UI/UX 정돈 + 모바일 반응형 도입에 집중.**

---

## 1. 좌측 패널 (LeftPanel) 정돈

### 1.1 "가중치" 헤더 줄바꿈 해소 — `WeightSliders.tsx`

```
[증상]   340px 좁은 패널에서 헤더 [가중치 ⓘ 합 100/100] + [프리셋 4종] 가
         같은 줄에 들어가지 못해 "가중치" 텍스트가 두 줄로 잘려 보임.

[원인]   `flex justify-between` 한 줄 구조 + 프리셋 4종 (사회초년생·신혼부부·실거주·직장인)
         이 합산 240~260px → 가용 폭 308px 를 초과.

[수정]   헤더를 2줄로 분리.
         1행: [가중치 ⓘ] [합 N / 100]   ← whitespace-nowrap + shrink-0 가드
         2행: [프리셋 4종]                ← flex-wrap
```

### 1.2 예산 슬라이더를 좌측 패널로 이동 — `CommutePatienceSlider.tsx` 확장

```
[Before]
  · 헤더(RecommendationHeader) 안에 작은 예산 슬라이더 (w-24)
  · 좌측 패널 상단: CommutePatienceSlider (통근 인내심 단독)

[After]
  · 헤더에서 예산 슬라이더 제거 (formatBudget / setBudget import 정리)
  · CommutePatienceSlider 카드 1개 안에 [통근 인내심] + [예산] 묶음
    중앙에 1px 구분선
  · 모듈명은 호환성 유지(LeftPanel 호출부 다수) — 컴포넌트명 유지
```

근거: 사용자 피드백 "예산만 헤더에 표기중인데 통근 인내심과 예산은 같은 블럭 안에 배치".

---

## 2. 우측 패널 (CardPanel) 재설계

### 2.1 직장 미선택 시 자동 접힘 — `index.tsx`

```typescript
// 초기값: collapsed
const [rightCollapsed, setRightCollapsed] = useState(true);

// workplace 변화에 따라 자동 펼침/접힘
useEffect(() => {
  if (!workplace) { setRightCollapsed(true); return; }
  if (!isMobile) setRightCollapsed(false);   // 모바일은 사용자 직접 토글
}, [workplace, isMobile]);
```

### 2.2 백그라운드 부여 + 사이드 메뉴 전환 — `CardPanel.tsx`

```
[Phase 1] 트레이 패널 (위젯 톤)
  · 루트 div 에 bg-surface + border + shadow-card + rounded-cardlg
  · 헤더(추천 지역 N건) shrink-0 + border-b + bg-surface-elevated 띠
  · 카드 리스트 영역 p-3 내부 패딩

[Phase 2] 사이드 메뉴 톤 — 사용자 피드백 "위젯으로 떠있는게 아닌 우측 메뉴 같은 느낌"
  · 위치: right-3 top-3 bottom-3 → right-0 top-0 bottom-0  (화면 가장자리 흡착)
  · 컨테이너: rounded·shadow·전둘레 border 제거 → border-l 만 (좌측 1줄)
  · 닫힘 transform: translate-x-[364px] → translate-x-full  (패널 폭 기반 상대값)
  · 토글 RIGHT_OPEN: 352 → 340  (패널 좌측 가장자리 흡착)
  · 토글 RIGHT_CLOSED: 12 → 8
```

---

## 3. 글로벌 button 보더 리셋 — `css/index.css`

### 3.1 증상

```
사용자: "지금 각 버튼 요소들의 보더가 너무 두꺼운데 보더를 아예 없애줄 수 있나"
       → 토글 버튼·EmptyState 보조 버튼의 1px gray border 제거
사용자(이어서): "오히려 버튼들에 보더가 완벽히 다 생겼는데"
```

### 3.2 원인

```
tailwind.config.ts 에 `corePlugins.preflight = false` 가 설정되어 있어
Tailwind 의 `* { border-width: 0 }` 글로벌 리셋이 적용되지 않음.

이전에는 명시적으로 `border border-line-light` utility 가 1px solid 로 덮어쓰면서
정돈된 1px 가는 보더로 보였음. utility 를 제거하니 그 아래에 숨어있던
**브라우저 기본 user-agent 스타일** (2~3px outset gray + 회색 배경)이 노출.

(Login.module.css 주석의 "기존 button[type=\"submit\"] 같은 글로벌 element 셀렉터를
클래스로 변환 → 의도치 않은 영향 차단" 도 같은 맥락의 단서)
```

### 3.3 해결 — 글로벌 element 리셋

```css
button {
  font: inherit;
  cursor: pointer;
  border: 0;        /* ← 추가 */
  background: none; /* ← 추가 */
  color: inherit;   /* ← 추가 */
}
```

Tailwind utility(`border-*`, `bg-*`)는 더 뒤에 선언되어 우선 적용 — 의도적으로 설정한 버튼(`RegionCard` 강조 보더 등)은 정상 동작.

### 3.4 부가 — 토글 버튼·EmptyState 보조 버튼 스타일 정리

```
TOGGLE_BTN_CLS (index.tsx)
  · border border-line-light 제거
  · shadow-card 만으로 부유감 표현
  · hover 시 shadow-card-hover 로 강조 (transition box-shadow 추가)

EmptyState "예산 조정하기" (EmptyState.tsx)
  · border 제거 → bg-surface(옅은 회색)로 버튼 영역 표시
  · hover bg-brand-50 + text-brand 로 시각 피드백
```

---

## 4. 모바일 반응형 — Depth 2 (Recommendation)

### 4.1 진입 사유

```
사용자: "지금은 반응형이 전혀 없어서 모바일에서 사이트 접근 시 볼 수 있는 항목이 없어"

진단: 패널 w-[340px] 고정 → 모바일 viewport(~375px) 거의 다 가림.
      헤더 가로 flex 만으로 구성 → 모바일에서 검색창·버튼 겹침.
      데이터 출처 스트립이 헤더 아래 가로 스크롤 영역 차지.
```

### 4.2 패널 — `index.tsx`

```
- 패널 폭: w-[340px] → w-[85vw] max-w-[340px]
  · 데스크톱(>=768): 340px 유지
  · 모바일(<768):    85% 폭, 옆에 지도 살짝 노출

- 닫힘 transform: 상대값으로 전환
  · 좌: -translate-x-[364px] → -translate-x-[calc(100%+12px)]
  · 우: translate-x-[340px]  → translate-x-full

- useIsMobile() 훅 신설 (window.innerWidth<768 + resize listener)

- 모바일 초기값: leftCollapsed=true (지도 우선 노출)
- 상호배타 토글: 모바일에서 한쪽 열면 다른 쪽 자동 접힘 (지도 가림 방지)
  · openLeft()/openRight()/toggleLeft()/toggleRight() 헬퍼

- 토글 버튼 위치: isMobile 분기로 CSS calc(min(85vw, 340px)) 사용
  · LEFT_OPEN: 'calc(min(85vw, 340px) + 12px)' / '352px'
  · RIGHT_OPEN: 'min(85vw, 340px)' / '340px'
```

### 4.3 헤더 — `RecommendationHeader.tsx`

```
- 패딩: px-5 → px-3 md:px-5, py-3 → py-2.5 md:py-3
- 로고: w-7 h-7 → w-6 h-6 md:w-7 md:h-7
- "나어디삶" 텍스트: hidden sm:inline (sm 미만 로고만)
- 구분선(h-4 w-px): hidden sm:block
- WorkplaceSearch flex 영역: max-w-2xl → min-w-0 md:max-w-2xl
- 공유 버튼: 패딩 px-2 md:px-3, 텍스트 "공유" 라벨 hidden sm:inline
- "시군구 탐색 →" 링크: hidden md:inline-block (모바일 숨김)
```

### 4.4 데이터 출처 스트립

```
- flex → hidden md:flex (모바일 숨김 — 지도 영역 확보)
```

---

## 5. 모바일 반응형 — Depth 3 (RegionDetail)

### 5.1 진입 사유

```
사용자: "3depth쪽은 모바일에선 모든 요소가 뭉게지긴 하네"

진단: main 이 grid-cols-12 고정. 미니지도 col-span-4, 우측 col-span-8.
      내부 grid-cols-3 (분석 col-span-2 + 통근 col-span-1) 도 중첩.
      4축 메트릭 grid-cols-4, 차트+도넛 grid-cols-4 도 좁은 폭에서 뭉개짐.
      page wrapper h-screen overflow-hidden 으로 모바일 세로 스크롤 차단.
```

### 5.2 페이지 컨테이너 — `RegionDetail/index.tsx`

```
- 컨테이너: h-screen overflow-hidden
          → md:h-screen min-h-screen + md:overflow-hidden
  · 모바일: 페이지 자체 세로 스크롤 허용
  · 데스크톱: 기존 화면 고정 동작 유지

- main grid: grid-cols-12 → grid-cols-1 md:grid-cols-12

- 미니지도 section
  · col-span-4 → col-span-1 md:col-span-4
  · 모바일 고정 높이 h-[40vh] (md+ 는 grid 자동)

- 우측 section
  · col-span-8 → col-span-1 md:col-span-8

- 내부 grid (분석 + 통근)
  · grid-cols-3 → grid-cols-1 md:grid-cols-3
  · col-span-2 → col-span-1 md:col-span-2
  · col-span-1 → col-span-1 (그대로)
  · overflow-auto / overflow-hidden 도 md: 한정
```

### 5.3 헤더 — `RegionDetailHeader.tsx`

```
- 컨테이너: px-4 py-3 → px-3 md:px-4, py-2.5 md:py-3, gap-4 → gap-2 md:gap-4
- flex-wrap 허용 (좁은 폭에서 줄바꿈)

- "돌아가기" 버튼 텍스트: hidden sm:inline
- 지역명 h1: text-lg → text-base md:text-lg, min-w-0 flex-1 + truncate
- legalDongCode 번호: hidden md:inline (모바일 숨김)
- 4축 점수 가운데 영역: 이미 hidden md:flex (유지)
- 종합점수: text-2xl → text-xl md:text-2xl, "종합" 라벨 hidden sm:inline
- 공유 버튼 텍스트: hidden sm:inline (아이콘만)
- 테마 토글: w-9 h-9 → w-8 h-8 md:w-9 md:h-9
```

### 5.4 가격 안정성 분석 — `LstmFullAnalysis.tsx`

```
- 카드 패딩: p-4 → p-3 md:p-4, gap-4 → gap-3 md:gap-4
- 단지 헤더 flex-wrap + 내부 min-w-0 + 단지명 truncate
- 4축 메트릭 grid: grid-cols-4 → grid-cols-2 md:grid-cols-4 (모바일 2x2)
- 본문 grid: grid-cols-4 → grid-cols-1 md:grid-cols-4
  · 차트 col-span: 3 → col-span-1 md:col-span-3
  · 차트 min-h: 280 → 240 md:280
  · 도넛 col-span-1 (그대로)
```

---

## 6. 검증

```
변경 직후마다 typecheck:
  cd C:\git\2026_MOLIT_CONTEST\client && npx tsc --noEmit
  → 모든 단계 EXIT:0

서버 측 코드 변경 없음 — server typecheck 미실행 (영향 없음).
```

---

## 7. 파일 통계

```
수정 (10개)
  client/src/css/index.css                                    + button 글로벌 리셋 (border:0; bg:none; color:inherit)
  client/src/pages/Recommendation/index.tsx                   + useIsMobile, 반응형 패널 폭, 토글 calc, 상호배타, rightCollapsed 동기화
  client/src/pages/Recommendation/components/RecommendationHeader.tsx   - 예산 슬라이더 제거, 모바일 패딩/숨김 처리
  client/src/pages/Recommendation/components/CommutePatienceSlider.tsx  통근 인내심 + 예산 단일 카드 통합
  client/src/pages/Recommendation/components/WeightSliders.tsx          제목/프리셋 2줄 분리 (줄바꿈 해소)
  client/src/pages/Recommendation/components/CardPanel.tsx              사이드 메뉴 톤 (border-l 만)
  client/src/pages/Recommendation/components/EmptyState.tsx             보조 버튼 보더 제거
  client/src/pages/RegionDetail/index.tsx                               grid-cols-1 md:grid-cols-12 + 세로 스크롤
  client/src/pages/RegionDetail/components/RegionDetailHeader.tsx       모바일 컴팩트 + 라벨 조건부 숨김
  client/src/pages/RegionDetail/components/LstmFullAnalysis.tsx         4축 2x2, 차트+도넛 1열 stack
```

서버·DB·스키마 변경 0건.

---

## 8. 함정 (다음 세션 인지)

```
① 글로벌 button 리셋 (css/index.css)
   - tailwind preflight=false 환경의 대응. preflight 켜면 더 깔끔하지만
     기존 CSS Modules / Login.module.css 등에서 회귀 위험.
   - 다른 form element (input/select/textarea) 의 native 스타일은 그대로.
     필요 시 동일 패턴으로 추가 리셋 검토.

② 모바일 상호배타 토글
   - 모바일에서만 적용. 데스크톱은 좌·우 동시 열림 허용 유지.
   - resize 로 viewport 가 768 경계를 넘나들면 상태가 일시 어색할 수 있음
     (예: 데스크톱에서 좌·우 둘 다 열림 → 모바일로 줄이면 둘 다 표시되어 지도 가림).
     다음 토글 클릭부터 정상화. 필요 시 useEffect 로 isMobile 변화 시 동기화 추가.

③ Depth 3 모바일 세로 스크롤
   - main 이 md+ 에서 overflow-hidden, 모바일은 그대로 자연 스크롤.
   - 내부 ComplexCardList 는 여전히 가로 스크롤 — 모바일에서도 OK.
   - 차트(react-chartjs-2) 의 maintainAspectRatio:false 동작 확인 필요할 수 있음
     (모바일에서 부모 높이 240+ 보장됨).

④ 토글 버튼 calc(min(85vw, 340px))
   - 모던 브라우저 (Chrome/Safari/Firefox ≥ 79) 지원. IE 미지원.
   - 인라인 style 의 transition([left,right]) 가 calc 값에도 보간 동작.

⑤ 예산 슬라이더 위치 변경
   - 기존 URL 공유(?budget=N) 직렬화·복원은 그대로 동작 (스토어는 변경 없음).
   - 헤더 컴포넌트의 budget useStore 호출은 share URL 생성에만 사용 — 유지.
```

---

## 9. 다음 세션 첫 한 줄

> **"UI/UX 정돈 + 모바일 반응형 트랙 ✅. 다음은 next-steps.md 의 우선순위 ②~④:
> 카카오 모빌리티 자차 실경로 API 연동(KAKAO_REST_API_KEY 기보유, ~1-2h) →
> Render 운영 배포 점검 → README 전면 재작성 + 데모 GIF.
> 모바일 회귀 확인은 Chrome DevTools device mode (375px) 로 1회 스모크."**

---

## 10. 미해결 / 후속

```
[ ] 좌측 패널도 동일하게 사이드 메뉴(흡착)로 통일할지 사용자 결정 대기
    현재: 좌측은 floating widget (left-3 top-3 bottom-3), 우측만 흡착
    좌우 비대칭 의도된 결과 (사용자 명시 요청대로) — 변경 시 결정 필요

[ ] 모바일에서 InfoTooltip 위치 검증
    가중치 헤더 ⓘ 의 position="bottom" 이 모바일에서도 잘 보이는지
    (좁은 폭에서 클리핑 발생 가능 — 보고된 이슈 없음)

[ ] WorkplaceSearch placeholder "회사명, 지하철역, 도로명을 입력하세요"
    모바일에서 잘림 — 자연스러운 input 동작이라 OK 판단, 변경 안 함
    필요 시 모바일 placeholder 단축

[ ] Depth 3 모바일에서 차트(라인) 가독성
    화면 폭 < 350 시 x축 라벨 겹칠 수 있음 — Chart.js maxTicksLimit:10 자동 처리
    필요 시 모바일 maxTicksLimit:6 조정

[ ] Render 운영 환경 미검증 (이전 세션부터 누적)
    빌드 명령, 환경변수, smoke test 1회 필요
```
