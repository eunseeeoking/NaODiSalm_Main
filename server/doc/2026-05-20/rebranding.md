# 서비스명 리브랜딩 — "스마트 직세권" → "나어디삶"

> 2026-05-20, Depth 3 1차 구현과 같은 날 일괄 변경.
> 브랜드 정체성: **"매물을 분석하는 서비스는 많습니다. 우리는 사람을 분석합니다."** (기획서 슬로건 유지)

---

## 1. 변경 사유

- 기존 "스마트 직세권" 은 부동산 업계 일반 어휘 "직주근접 + 역세권" 의 결합어로,
  서비스의 본질(*사용자 조건 → 시스템 추천*) 보다 부동산 인프라 측면이 과강조됨
- **"나어디삶"** 은 사용자 시점의 1인칭 질문 그대로 — "내가 어디서 살아야 하지?" — 를 담아
  의사결정 도구로서의 정체성을 직설적으로 표현
- 짧고 외우기 쉬움, 어순 한국어 자연 (영문 표기 가능: NaEoDiSarm / where-do-i-live)

---

## 2. 변경 적용 범위

### 클라이언트 코드
```
client/index.html
  · <title>          → "나어디삶 · 직장인을 위한 AI 주거 추천"
  · <meta description> 추가
  · <link rel="icon" type="image/svg+xml" href="/logo.svg">  ← favicon 도 SVG 단일 파일

client/src/components/Sidebar.tsx
  · h1 "스마트 직세권" → "나어디삶"
  · 부제 "K-MaaS 기반 주거선택" → "직장인을 위한 AI 주거 추천"

client/src/pages/Recommendation/components/RecommendationHeader.tsx
  · img src: ./logo.png → /logo.svg  (public 폴더 기반)
  · alt: "로고" → "나어디삶 로고"
  · 로고 옆에 <span>나어디삶</span> 텍스트 동봉 (이전엔 이미지만)
  · img 크기: w-6 h-6 → w-7 h-7  (SVG 라 선명 + 약간 키움)

client/src/pages/RegionDetail/components/RegionDetailHeader.tsx
  · "돌아가기" 버튼 우측에 작은 로고 + "나어디삶" 브랜드 마크 추가
  · lg 이상 화면에서만 노출 (md 이하에서는 시선 분산 방지로 숨김)
```

### 기존 로고 파일
```
client/src/pages/Recommendation/components/logo.png
  · 그대로 둠 (참고용, 더 이상 import 되지 않음)
  · 정리 시점이 오면 git rm 권장
```

### 미반영 (의도적)
```
README.md / 루트 package.json / repo 이름
  · 공모전 출품 식별자(2026_MOLIT_CONTEST) 는 그대로 유지
  · 발표 자료 작성 시점에 일괄 정리
```

---

## 3. 로고 SVG 사양 (사용자에게 안내된 값)

### 기본 사양
```
파일 경로:     client/public/logo.svg            ← 반드시 public 폴더 (vite 가 그대로 서빙)
viewBox:       0 0 32 32                          ← 정사각 권장
실제 노출 px:
  Depth 2 헤더:    28 x 28  (w-7 h-7)
  Depth 3 헤더:    20 x 20  (w-5 h-5)
  favicon:         16 / 32  (브라우저 자동 스케일)
색상 전략:     fill="currentColor"  또는  fill="#3182F6" (토스 브랜드 블루) 고정
배경:          투명 (배경 없음)
다크 모드:     로고 색상이 light/dark 양쪽에서 잘 보이는 단색 또는
               <style> 안에서 @media (prefers-color-scheme: dark) 분기 가능
```

### viewBox 정사각이 중요한 이유
- 헤더에 `w-7 h-7` (28×28) 정사각 box 로 그릴 때 viewBox 가 정사각이 아니면 비율 왜곡
- favicon 도 동일 SVG 사용 — 가로/세로 비율이 다르면 잘림

### currentColor 권장 이유
- 헤더 텍스트 색상(라이트/다크) 과 자동 동기화
- Tailwind `text-brand` 등으로 클래스만으로 색상 통제 가능

---

## 4. 검증 체크리스트

```
[ ] 메인(/) 헤더 좌측 "나어디삶" + 로고 정상 노출
[ ] /region/:legalDongCode (Depth 3) 헤더에도 작은 브랜드 마크 노출
[ ] /explore Sidebar 헤더 "나어디삶" 노출
[ ] 브라우저 탭 favicon 갱신 (Ctrl+F5 강제 새로고침 필요할 수 있음)
[ ] 다크 모드 토글 시 로고도 자연스럽게 보임
[ ] alt="나어디삶 로고" 스크린리더 음독 확인
```

---

## 5. 발표 자료 톤 가이드 (제안)

```
한 줄 슬로건:   "매물이 아니라 사람을 분석합니다 — 나어디삶"
한 줄 정의:     "직장인을 위한 AI 기반 주거 의사결정 도구"
사용자 호칭:    "당신" (의사결정 주체로서 존중)
경쟁 비교:      "직방/다방은 매물을 보여주고, 나어디삶은 조건을 받습니다"
LSTM 표현:      "3년 후 가격을 LSTM 으로 예측" (모델명 그대로 노출 — 기술 진정성)
```
