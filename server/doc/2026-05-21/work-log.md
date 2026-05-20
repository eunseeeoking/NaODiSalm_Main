# 작업 로그 — 2026-05-21

## 한 줄 요약

> 프로젝트 전수 분석 + PDF 기획서 정합성 점검 + Sprint A (URL 공유 기능) 1차 구현. workplace/budget/weights/patience 가 쿼리스트링으로 직렬화되고 마운트 시 복원됨. 헤더에 [공유] 버튼 추가 (Clipboard API + 폴백). **기획서 핵심 차별점 "URL 공유 → 동일 결과 재현"의 클라이언트측 완성.**
>
> **오후 추가:** Sprint B 완료 — 프리셋 3종 a11y 보강 + Depth 3 [공유] 버튼 + 추천 API wrapper (실 API → mock 폴백 + DEMO 뱃지). 아래 §8 ~ §10 참고.

---

## 0. 컨텍스트

- 이전(2026-05-20) work-log 마지막 한 줄: **"npm install → Depth 3 시연 검증 → 서버 추천 API mock 대체"**
- 사용자가 우선순위 재설정: chart.js 설치 검증보다 **PDF 기획서의 미구현 차별점**부터 메우기로 결정
- 4지선다 결정사항:
  - 첫 작업: **URL 공유 기능** (가성비 최고)
  - PDF 차별점 우선순위: URL 공유 → 프리셋 3종 → POI(lifeScore) → 전월세(valueScore)
  - 점수 계산 위치: **하이브리드 (SQL 뷰 + JS 가중합)** — 풀 프로시저 권장 안함 (디버깅 비용)
  - Mock 처리: **실 API + try/catch fallback** + DEMO 뱃지 (에러를 숨기지 말 것)

---

## 1. 신규 / 편집 파일

### 신규
```
client/src/pages/Recommendation/utils/urlState.ts                184 lines
  · encodeStateToParams / decodeParamsToState / buildShareUrl
  · resolveWeights (preset 우선, 없으면 raw weights)
  · 한국 영역 좌표 검증, 가중치 합계 95~105 허용, label 만 URI 인코딩
```

### 편집
```
client/src/pages/Recommendation/index.tsx
  · 마운트 1회 URL → 스토어 하이드레이션 (hydratedRef 가드)
  · 스토어 → URL 200ms 디바운스 replaceState (히스토리 폭주 방지)
  · 동일 URL 이면 스킵 (무한 루프 방지)

client/src/pages/Recommendation/components/RecommendationHeader.tsx
  · [공유] 버튼 추가 — Clipboard API + legacyCopy 폴백
  · workplace 없을 땐 disabled
  · 1.5s "복사됨" / "실패" 상태 표시
```

---

## 2. URL 스키마 (공유 URL 가독성 유지)

```
?wp=37.4979,127.0276,강남역    workplace (lat,lng,encodedLabel)
&b=40000                       budget (만원)
&w=30-25-20-25                 weights commute-value-investment-life (preset 미일치 시)
&p=45                          patience (분)
&pre=worker                    preset 키 (w 보다 우선)
```

설계 메모:
- 좌표 4자리 (≈11m) → t_commute_matrix 의 cacheKey 정밀도와 자연스럽게 일치 → 공유 시에도 캐시 hit
- weights 가 정확히 preset 과 일치하면 `pre=` 만 쓰고 `w=` 생략 (URL 짧게 + 의도 보존)
- 부분 파싱 허용 — 일부 잘못돼도 나머지는 적용

---

## 3. 검증

### 사용자 PC 시연 시나리오
```
1. cd client && npm install                              # chart.js 포함
2. npm run dev
3. http://localhost:5173/  →  "강남역" 검색 → workplace 설정
4. 슬라이더 조작 → 주소창 URL 이 ?wp=...&w=... 형태로 갱신되는지 확인
5. [공유] 버튼 클릭 → "복사됨" 토스트
6. 시크릿 창에 붙여넣기 → 동일 workplace + weights + patience 로 재현
7. 새로고침 → 상태 유지 (URL 이 진실의 원천이 됨)
```

### 샌드박스 한계
- npm registry 차단 → 빌드/타입체크는 Windows 측에서
- 정적 참조 grep 으로 import/export 정합성만 확인 (OK)

---

## 4. 의도적 미구현 / 후속 작업

### Sprint B (다음 세션)
```
⏳  프리셋 3종 UI (직장인형/투자자형/실거주형) — WEIGHT_PRESETS 는 이미 존재, WeightSliders 에 버튼만 추가
⏳  실 API + mock fallback 와이어업 (DEMO 뱃지 + console.warn)
⏳  Depth 3 (RegionDetailPage) 에도 [공유] 버튼 → /region/:code?wp=...&w=... 지원
```

### Sprint C (D-5 ~ D-3)
```
⏳  /api/recommendations — view_region_metrics + Node 가중합 (풀 프로시저 X)
⏳  /api/regions/:code/complexes, /api/lstm/:complexId — mock 대체
```

### Sprint D (D-3 ~ D-1)
```
⏳  생활편의 POI (카카오) → lifeScore 실데이터
⏳  AptRent 데이터 → valueScore 보강
⏳  자동 백업 cron (랜섬웨어 안전망)
⏳  TiDB 이관 + 발표 자료
```

---

## 5. Steelman — 이번 구현의 약점

```
[1] hydratedRef 가 React.StrictMode 의 더블 마운트에서 idempotent 한지 검증 안됨
    · useRef + early return 이라 OK 일 가능성 높지만, 사용자 검증 시 더블 마운트 환경에서 한 번 더 확인

[2] 200ms 디바운스가 슬라이더 빠른 조작에서 마지막 값만 URL 에 들어감
    · 의도된 동작이지만, 발표 데모 시 "URL 이 실시간 갱신 안되는데?" 질문 가능 → 50ms 로 줄이거나 라이브 갱신은 트레이드오프

[3] Depth 3 (/region/:code) 진입 후 돌아오면 URL 이 쿼리 잃었다가 다시 복원됨
    · 200ms 짧은 시간 URL 이 ?없는 상태였다 갱신 — 시각적으로 깜빡임은 없지만 깔끔하진 않음
    · 해결: useNavigate 호출 시 search 를 명시적으로 전달하거나, Depth 3 자체에도 URL 동기화 도입

[4] 가중치 합계가 95~105 허용 → 외부 사용자가 92 같은 값 넣으면 무시되는데, 그 사실을 알려주지 않음
    · 발표 평가에 영향 없으면 OK, 친절도는 떨어짐

[5] PWA / 모바일 공유 시트 (Web Share API navigator.share) 미지원
    · 데스크탑 시연이 메인이라 OK, 모바일 시연 시 한 줄 추가 권장
```

---

## 6. 다음 세션 시작 시 첫 한 줄

> **"`cd client && npm install` 후 **루트에서** `npm run dev` (client+server 동시 기동) → 강남역 입력 → 슬라이더 조작하며 주소창 URL 변화 확인 → [공유] 버튼 → 시크릿 창에서 동일 결과 재현 확인. 정상이면 Sprint B (프리셋 3종 버튼 + Depth 3 공유 버튼)."**

> ⚠️  `client/` 에서 `npm run dev` 만 돌리면 Vite 프록시는 떠도 백엔드(:4000) 가 없어 API 가 다 죽음. **루트에서 실행**할 것.

---

## 7. 세션 중 트러블슈팅

```
[증상]    "npm run dev 시 서버 연결 안됨"
[원인]    client/ 디렉토리에서 npm run dev 실행 → Vite(:5173) 만 기동, Express(:4000) 미기동
          → 모든 /api 요청이 Vite 프록시 → http://localhost:4000 → ECONNREFUSED
[해결]    루트 디렉토리에서 npm run dev (workspaces parallel) → 두 서버 동시 기동
[교훈]    next-steps.md 의 "환경 세팅" 섹션은 루트에서 실행하라고 명시하지만,
          chart.js 설치 안내가 "cd client && npm install" 로 시작해서 그 흐름에 끌려감
          → 안내 문구에 "그 다음 cd .. 로 루트로 돌아가서 npm run dev" 명시 권장
```

---

## 7. 파일 통계

```
client/src/pages/Recommendation/utils/urlState.ts                184 lines (신규)
client/src/pages/Recommendation/index.tsx                          +50 lines
client/src/pages/Recommendation/components/RecommendationHeader.tsx +60 lines
────────────────────────────────────────────────────────────────
신규/수정 합계                                                    ~294 lines
```

---

## 8. Sprint B — 프리셋/공유/Mock fallback (오후 작업)

### 8.1 한 줄 요약
> next-steps.md 의 Sprint B (0-B) 항목 3개 완료 — UI a11y 보강 + Depth 3 [공유] + 추천 API 폴백 와이어업.

### 8.2 결정사항 재확인
```
[A] 데이터 출처를 숨기지 말 것
    · mock 폴백 시 콘솔 warn + 우상단 DEMO 뱃지 노출
    · 발표 시연 시 "지금은 mock 입니다" 가 시각적으로 명시

[B] 공유 로직은 hook 으로 분리
    · useShareUrl — Depth 2/3 공통, pathname 옵션으로 base path 지정
    · encodeStateToParams 를 직접 호출 (buildShareUrl 가공 X → pathname 충돌 위험 0)
```

### 8.3 신규/편집 파일
```
신규
  client/src/api/recommendations.ts                                  73 lines
    · fetchRecommendations(req, signal?)
    · 실 API try → ApiError/Network/etc 모두 catch → MOCK_REGIONS 폴백
    · AbortError 는 호출처에 위임 (race condition 방지)
    · RecommendationResult { regions, source: 'api'|'mock', fallbackReason? }

  client/src/pages/Recommendation/hooks/useShareUrl.ts               74 lines
    · share() · copyState · canShare
    · pathname 옵션 — Depth 3 에서도 동일 hook 재사용

  client/src/pages/Recommendation/components/DemoBadge.tsx           23 lines
    · 우측 상단 알약 형태 (amber 톤, 자극 X)
    · title 속성에 fallbackReason 노출 (hover 툴팁)

편집
  client/src/stores/useRecommendationStore.ts
    · dataSource: 'api'|'mock'|null 필드 추가
    · setRecommendations(recs, source?) — 두 번째 인자 옵셔널

  client/src/pages/Recommendation/index.tsx
    · MOCK_REGIONS 즉시 세팅 → fetchRecommendations + AbortController
    · workplace/budget/weights/patience 의존성 4개 모두 추적

  client/src/pages/Recommendation/components/RecommendationHeader.tsx
    · dataSource === 'mock' 일 때만 DemoBadge 노출
    · 기존 [공유] 버튼은 그대로 유지 (useShareUrl 미적용 — 21일 본 작업 호환성 유지)

  client/src/pages/Recommendation/components/WeightSliders.tsx
    · 프리셋 버튼에 type="button" + aria-pressed + aria-label + title 폴리시
    · role="group" / aria-label="가중치 프리셋"

  client/src/pages/RegionDetail/components/RegionDetailHeader.tsx
    · [공유] 버튼 추가 — useShareUrl() 적용
    · DemoBadge visible (상시) — Depth 3 는 매물/LSTM/통근 모두 mock 이므로
```

### 8.4 데이터 흐름
```
[직장 변경 / 예산·가중치·인내심 변경]
        ↓
useEffect 트리거 → AbortController 신규
        ↓
fetchRecommendations({wp, budget, weights, patience}, signal)
        ↓
   ┌──── try ─────┐         ┌──── catch ─────┐
   │ POST /api/   │  실패→  │ console.warn    │
   │ recommendat. │         │ MOCK_REGIONS    │
   │ → regions[]  │         │ source:'mock'   │
   └──────────────┘         └─────────────────┘
        ↓                              ↓
setRecommendations(regions, source)
        ↓
useRecommendationStore: { recommendations, dataSource }
        ↓
┌─ MapPanel/CardPanel: recommendations 렌더
└─ RecommendationHeader: dataSource==='mock' → <DemoBadge/>
```

### 8.5 검증 시나리오
```
[1] 서버 다운 상태:
    · 강남역 입력 → 카드 8건 렌더 + 우상단 "DEMO" 뱃지 점등
    · 콘솔: [recommendations] API 실패 → mock 폴백: 네트워크 오류 (Failed to fetch)
    · 가중치 슬라이더 조작 → 재요청 + 동일하게 mock 폴백
    · 뱃지 hover → "서버 추천 API 미구현 — Sprint C 에서 대체" 툴팁

[2] 서버 정상 상태 (Sprint C 후):
    · 동일 입력 → 카드 8건 + 뱃지 미노출
    · 직장 빠르게 전환 → AbortController 로 이전 요청 취소

[3] Depth 3 진입:
    · 헤더에 항상 DEMO 뱃지 (매물/LSTM/통근 모두 mock)
    · [공유] 버튼 → /region/:code?wp=...&w=... 형태로 클립보드 복사
```

### 8.6 알려진 약점 / 후속 작업
```
[1] RecommendationHeader 의 기존 [공유] 버튼은 useShareUrl 로 교체하지 않음
    · 이미 정상 작동 중이라 보존 — 단, useShareUrl 로 통합하면 코드 50줄 감소
    · 후순위 폴리시

[2] AbortController 단위 테스트 없음
    · 빠른 직장 전환 race 검증은 수동
    · React Strict Mode 의 더블 마운트에서도 AbortError 정상 흐름 → 콘솔 정리됨

[3] Depth 3 공유 URL 에 selectedComplexId 미포함
    · 받는 쪽이 같은 단지를 자동 선택하지는 않음
    · 후속: encodeStateToParams 에 sc= 키 추가 + RegionDetail 에서 ?sc= 우선 선택

[4] DemoBadge 의 amber 팔레트는 Tailwind 기본 — tailwind.config.ts 의
    토스 톤과 약간 이질감 있을 수 있음. 필요 시 brand-200 + ink-secondary 톤으로 교체 가능

[5] fetchRecommendations 의 응답 검증이 Array.isArray 한 줄
    · zod 같은 런타임 검증은 의도적 생략 (응답 shape 안정화 후 도입 검토)
```

---

## 9. 새 파일 통계 (오후 추가)

```
client/src/api/recommendations.ts                                  73 lines (신규)
client/src/pages/Recommendation/hooks/useShareUrl.ts               74 lines (신규)
client/src/pages/Recommendation/components/DemoBadge.tsx           23 lines (신규)
client/src/stores/useRecommendationStore.ts                       +12 lines
client/src/pages/Recommendation/index.tsx                          +20 lines
client/src/pages/Recommendation/components/RecommendationHeader.tsx +6 lines
client/src/pages/Recommendation/components/WeightSliders.tsx        +5 lines
client/src/pages/RegionDetail/components/RegionDetailHeader.tsx    +30 lines
────────────────────────────────────────────────────────────────
Sprint B 신규/수정 합계                                            ~243 lines
```

---

## 10. 다음 세션(2026-05-22+) 첫 한 줄

> **"Sprint C 진입 — server 측 `POST /api/recommendations` 라우터 신규 작성. view_region_metrics + 가중합 계산 (풀 프로시저 X). 동시에 매물/LSTM API 도 진행 가능."**
