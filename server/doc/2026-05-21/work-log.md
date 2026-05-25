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

## 8. 파일 통계

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

## 10. 다음 세션(2026-05-22+) 첫 한 줄 ~~(← 11번 섹션에서 갱신됨)~~

> ~~"Sprint C 진입 — server 측 `POST /api/recommendations` 라우터 신규 작성. view_region_metrics + 가중합 계산 (풀 프로시저 X). 동시에 매물/LSTM API 도 진행 가능."~~

→ **밤 작업으로 Sprint C-1 도 완료됨. 아래 §11 참고.**

---

## 11. Sprint C-1 — 서버 추천 API (`POST /api/recommendations`)

### 11.1 한 줄 요약
> 클라이언트 wrapper 가 기다리던 서버 라우터 완성. **DEMO 뱃지가 자동으로 사라질 첫 시점.** typecheck 통과.

### 11.2 의사결정 (Q&A 4개 + α)
```
[Q1] 점수 정규화 방식?
     → 단순 선형 매핑 — 시연 안정성 우선
       commuteScore   = 100 → 0 over [0, patience]
       valueScore     = 100 → 0 over [1억, 20억]
       investmentScore = 0 → 100 over [0%, 25%]
       lifeScore      = 50 고정 (Sprint D 까지)

[Q2] 추천 대상 범위?
     → 직장 위치 기반 — Haversine 반경 patience×0.75 km
       지금은 sigunguCodePrefix='11' 로 서울 한정
       추후 전국 확장 시 prefix 만 빼면 전국 자동 적용

[Q3] commute matrix 미존재 시?
     → Haversine 추정값 즉시 반환 (~100ms)
       클라이언트가 /api/commute/matrix 별도 호출하는 흐름 유지

[Q4] lifeScore 임시값?
     → 더미 50점 — Sprint D 에서 POI 카운트로 교체

[α] 추가 결정사항 (claude 측):
     · 행정동 centroid = t_apt_complex.lat/lng 평균 (외부 파일 의존 X)
     · 거래 데이터 없는 행정동 후보 제외 (representative price 산출 불가)
     · patience×2 초과 통근 강제 제외 (무의미한 추천 방지)
     · t_legal_dong 마스터에 없는 동 제외 (legalDongCode 부재)
```

### 11.3 신규 파일
```
server/src/services/recommendation/scoring.ts                       137 lines
  · 순수 함수 모음 — 4축 점수 + 가중합 + TOP K 정렬
  · inverseLinear / forwardLinear / commuteScore / valueScore / ...

server/src/services/repositories/recommendationRepository.ts        199 lines
  · fetchRegionAggregates       행정동 centroid + 단지 수 (raw SQL group)
  · fetchRepresentativePrices   최근 1년 중형 매물 평균가
  · fetchExpectedReturns        t_training_result 의 평균 수익률
  · fetchRegionCandidates       전체 진입점 — workplace 좌표 + patience
                                기반 Haversine 1차 필터 + matrix join + 메트릭 결합

server/src/routes/domains/recommendations.ts                         97 lines
  · POST '/'  =  POST /api/recommendations
  · validateBody (한국 좌표 + 가중치 합 90~110 + patience 5~120)
  · 응답 X-Elapsed-Ms 헤더로 처리 시간 노출
```

### 11.4 편집
```
server/src/routes/api.ts
  · /recommendations 라우터 마운트
```

### 11.5 데이터 흐름
```
POST /api/recommendations
  body { workplace, budget, weights, patience }
        ↓
validateBody (좌표/가중치/patience 검증)
        ↓
fetchRegionCandidates(workplace, patience)
  ├─ fetchRegionAggregates(prefix='11')
  │    · t_legal_dong 마스터 (서울 행정동들) + t_apt_complex 좌표 그룹
  │    → 행정동별 centroid + 단지 수
  ├─ Haversine 거리 ≤ patience×0.75 km 인 후보만 추림
  ├─ Promise.all([
  │    fetchRepresentativePrices    (최근 1년 중형 매물 avg)
  │    fetchExpectedReturns         (t_training_result avg)
  │    findCachedMatrix             (KNN 격자 흡수, 이미 commuteRepository 활용)
  │  ])
  └─ commute matrix 있으면 실측 transitMinutes, 없으면 Haversine 추정
        ↓
pickTopRegions(candidates, weights, patience, k=8)
  · scoreRegion 으로 4축 + 가중합
  · totalScore desc 정렬
        ↓
응답: RegionRecommendation[] (클라이언트 fetchRecommendations 응답 형태)
```

### 11.6 클라이언트 영향
> **클라이언트 코드 변경 0 라인.**
> Sprint B 의 wrapper(`fetchRecommendations`) 가 이미 try → catch fallback 패턴.
> 서버가 200 OK 응답하는 순간 `dataSource='api'` → DEMO 뱃지 자동 소거.

### 11.7 검증
```
[1] 타입체크
    cd server && npx tsc --noEmit  →  통과

[2] 수동 검증 (server 기동 후)
    curl -X POST http://localhost:4000/api/recommendations \
      -H 'Content-Type: application/json' \
      -d '{
        "workplace": { "lat": 37.4979, "lng": 127.0276, "label": "강남역" },
        "budget":    40000,
        "weights":   { "commute": 30, "value": 25, "investment": 20, "life": 25 },
        "patience":  45
      }'

[3] 브라우저 시연
    강남역 입력 → 카드 8건 + DEMO 뱃지 사라짐 확인
    (단, 데이터 부족으로 8건 못 채우면 그 미만)
```

### 11.8 알려진 약점 / 후속 작업
```
[1] 평균(mean) → 중위(median) 으로 교체
    · MySQL 8.x 에서 PERCENTILE_DISC 같은 함수 사용 가능
    · 또는 window 함수 + ROW_NUMBER 트릭
    · Sprint D 폴리시

[2] t_legal_dong 시드가 부족하면 후보 0건 응답
    · 사전 확인: SELECT COUNT(*) FROM t_legal_dong WHERE LENGTH(code)=10 AND code LIKE '11%';
    · 부족 시 시드 잡 별도 필요 (LAWD_CD 공식 데이터에서)

[3] 통근 matrix 가 없는 행정동은 Haversine 추정으로 점수 산출
    · 클라이언트가 /api/commute/matrix 백그라운드 호출 후 갱신은 별 컴포넌트 (MapPanel)
    · 추천 결과 자체는 갱신되지 않음 — workplace 변경하면 재요청되므로 자연스럽게 정확화

[4] AreaBucket / AgeBucket 무시 (집계 평균만 사용)
    · 사용자별 평형 선호도가 다를 수 있음 — 향후 입력 필드로 추가 가능
    · 지금은 60~85m² 중형만 가격 산정 기준

[5] budget 인자 미사용
    · 현재는 valueScore 정규화만 [1억, 20억] 고정 구간
    · 추후: budget × 1.3 초과 행정동은 후보 제외 또는 가성비 점수 패널티

[6] sigunguCodePrefix='11' 하드코딩
    · 전국 확장 시 workplace 좌표로 자동 결정 또는 client 가 명시
    · 현재 정책: 서울 only (PoC 단계)

[7] 단위 테스트 X
    · scoring.ts 는 순수 함수 → vitest 도입 시 가장 먼저 커버 가치 큼
    · 우선순위 낮음 (발표 후)
```

### 11.9 파일 통계 (밤 작업)
```
server/src/services/recommendation/scoring.ts                       137 lines (신규)
server/src/services/repositories/recommendationRepository.ts        199 lines (신규)
server/src/routes/domains/recommendations.ts                         97 lines (신규)
server/src/routes/api.ts                                              +3 lines
────────────────────────────────────────────────────────────────
Sprint C-1 신규/수정 합계                                            ~436 lines
```

### 11.10 다음 세션 첫 한 줄 ~~(§12에서 갱신됨)~~

> ~~"server 띄우고 curl 검증 → 브라우저에서 DEMO 뱃지 소거 확인 → 정상이면 Sprint C-2 (매물/LSTM API). 비정상이면 t_legal_dong 시드 상태 점검."~~

---

## 12. Sprint C-1 검증 — 데이터 진단 + 시드 패치

### 12.1 검증 결과 (사용자 환경)
```
t_legal_dong  LENGTH=10 AND code LIKE '11%'     →  0건  ❌  ← 결정적
t_apt_complex lat IS NOT NULL AND ...            →  9,612건 ✓
t_apt_trade   deal_date >= NOW()-1년 AND 60~85   →  0건  ❌  ← 두 번째 결정적
t_apt_trade   total / first / last               →  251,197건 / 2020-01-01 / 2025-04-30
t_apt_trade   area 분포                          →  m² 단위 OK (min 10.16, max 317, avg 75)
t_training_result                                →  2,143건 / 모두 expected_return_3y ★ ML 완벽
```

### 12.2 진단
```
[원인 1] t_legal_dong 마스터 시드 자체가 안 들어옴
         → fetchRegionAggregates 의 첫 쿼리에서 sigunguNames=[] → 0건 응답

[원인 2] 거래 최신일이 2025-04-30 인데 코드는 NOW()-1년(2025-05~) 기준
         → 1년 cutoff 가 데이터 범위 밖 → fetchRepresentativePrices=[] → 0건 응답

[원인 3] (관찰 only) ML 완벽 — t_training_result 2143건 + 모두 수익률 보유
         → 시드 + cutoff 만 고치면 investmentScore 도 즉시 의미있는 값
```

### 12.3 패치 — 신규 / 편집
```
신규
  server/scripts/seedLegalDong.ts                                    104 lines
    · client/public/data/seoul-centroids.json 을 그대로 활용 (5-19 자산 재활용)
    · ~470개 서울 행정동 10자리 코드 upsert
    · 50개씩 트랜잭션 묶음 (커넥션 점유 최소화)

편집
  server/src/services/repositories/recommendationRepository.ts
    · fetchRepresentativePrices cutoff: NOW()-1년 → MAX(deal_date)-1년 (동적)
    · 거래 0건 시 전체 거래로 fallback (안전망)
    · 시간 흐름 영향 없도록 영구 해결

  server/package.json
    · "seed:legal-dong": "tsx scripts/seedLegalDong.ts"  script 등록
```

### 12.4 시드 실행 절차 (사용자)
```powershell
cd C:\git\2026_MOLIT_CONTEST\server
npm run seed:legal-dong
# 콘솔 로그:
# [seed:legal-dong] start
# [seed:legal-dong] 입력: 470 entries
# [seed:legal-dong] 100 / 470
# [seed:legal-dong] 200 / 470
# ...
# [seed:legal-dong] 완료 — t_legal_dong 서울 10자리: 470건
```

### 12.5 시드 후 재검증 (5분)
```sql
-- 시드 완료 확인
SELECT COUNT(*) FROM t_legal_dong WHERE LENGTH(code)=10 AND code LIKE '11%';
-- 기대: ~470건

-- 서울 행정동 마스터 ↔ 단지 매칭률
SELECT
  COUNT(DISTINCT CONCAT(ac.sigungu_code, '|', ac.legal_dong)) AS dong_groups_with_complex,
  COUNT(DISTINCT CASE WHEN ld.code IS NOT NULL THEN CONCAT(ac.sigungu_code, '|', ac.legal_dong) END) AS matched
FROM t_apt_complex ac
LEFT JOIN t_legal_dong ld
  ON ld.dong = ac.legal_dong
 AND ld.code LIKE CONCAT(ac.sigungu_code, '%')
WHERE ac.sigungu_code LIKE '11%';
-- 기대: matched / dong_groups_with_complex ≈ 1.0
```

### 12.6 브라우저 검증
```
1. 루트에서 npm run dev
2. http://localhost:5173/ → "강남역" 검색
3. DEMO 뱃지 소거 확인 — 서버 추천 응답 성공 시 자동 사라짐
4. 추천 카드 8건 표시 + 1위 클릭 → Depth 3 진입
   (Depth 3 는 매물/LSTM/통근 모두 mock 이라 DEMO 뱃지 유지 — 정상)
5. 가중치 슬라이더 조작 → 카드 재정렬 + URL 갱신
```

### 12.7 알려진 한계 (시드 패치 후에도 남는 것)
```
[1] t_legal_dong 시군구 5자리 row 미시드
    · 추천 동작엔 영향 없음 (코드 앞 5자리로 매핑)
    · 향후 시군구 자체 페이지 만들 때 별도 시드

[2] 행정동 ↔ 단지 매칭에서 동명 변경/오타 케이스
    · 예: 단지의 legal_dong="역삼1동" vs 마스터 "역삼동" 같은 경우 매칭 실패
    · 12.5 의 매칭률 쿼리로 정량 확인 가능 — 90%+ 면 OK
    · 90% 미만이면 정규화 잡 필요 (Sprint D 폴리시)

[3] t_legal_dong 에 lat/lng 컬럼 없음
    · 현재는 t_apt_complex centroid 평균 사용 (충분)
    · 추후 마이그레이션 추가 시 seoul-centroids.json 의 lat/lng 도 시드 가능

[4] 전국 확장 시 별도 시드 데이터 필요
    · seoul-centroids.json 은 서울만
    · 추후: 행정안전부 BJD 코드 전체자료 ingest 잡 (~21,000 행정동)
```

### 12.8 §12 파일 통계
```
server/scripts/seedLegalDong.ts                                   104 lines (신규)
server/src/services/repositories/recommendationRepository.ts      +25 lines
server/package.json                                                +1 line
────────────────────────────────────────────────────────────────
§12 합계                                                          ~130 lines
```

### 12.9 다음 세션 첫 한 줄 (갱신) ~~(§13에서 다시 갱신됨)~~

> ~~"`npm run seed:legal-dong` 1회 실행 → 12.5 매칭률 쿼리 OK 확인 → 브라우저에서 DEMO 뱃지 소거 검증 → 정상이면 Sprint C-2 (매물/LSTM API) 진입."~~

---

## 13. Sprint C-1 검증 2회차 — 행정동/법정동 불일치 발견

### 13.1 진단
```
시드 후 매칭률 점검 결과:
  t_legal_dong  서울 10자리:        427건  (seedLegalDong.ts 실행 완료)
  매칭률 쿼리 결과:                  82 / 345 = 23.8%   ❌
```

### 13.2 근본 원인
> **`seoul-centroids.json` 의 코드 체계는 "행정동(行政洞)" 이고,
> `t_apt_complex.legal_dong` 은 국토부 LAWD_CD 기반 "법정동(法定洞)" 이름.**

```
법정동 (BJD, Beobjeong-dong)   토지·등기 기준        예: "역삼동"        1개
행정동 (ADM, Administrative)    행정 편의 분리        예: "역삼1동", "역삼2동"   2개

코드 체계도 다름:
  법정동 1168010100  (10자리, BJD)
  행정동 1168064000  (10자리, ADM)
  → 같은 "역삼" 이라도 코드가 다름
```

### 13.3 사용자 의사결정 — B안 (BJD 정공)
```
B. 행정안전부 BJD 공식 데이터로 시드
   - 진짜 LAWD_CD 사용 → 추후 전국 확장 + 다른 시스템 연동 자연스러움
   - 1회 다운로드 + 1회 시드 후 영구 사용
```

### 13.4 신규 / 편집
```
신규
  server/scripts/seedBjd.ts                                         174 lines
    · 행정안전부 법정동코드 전체자료 (탭 구분) 파싱
    · EUC-KR/CP949 자동 감지 + UTF-8 변환 (iconv-lite)
    · 기존 t_legal_dong DELETE 후 createMany 200개씩 청크
    · "폐지" 상태는 isActive=false 로 보존
    · 휴리스틱: 한글 비율로 인코딩 판정, BOM 인식

편집
  server/package.json
    · "seed:bjd": "tsx scripts/seedBjd.ts" script 등록
    · "iconv-lite": "^0.6.3" dependency 추가 (인코딩 변환)

  .gitignore (루트)
    · server/data/legal_dong_codes.txt 무시 (3MB, 공공데이터지만 repo 비대화 방지)
    · server/data/*.csv, *.zip 도 무시
```

### 13.5 사용자 액션 — BJD 데이터 다운로드 + 시드

#### 1) 파일 다운로드
```
사이트: 행정표준코드관리시스템
URL:    https://www.code.go.kr/stdcode/regCodeL.do

페이지 우상단의 "법정동코드 전체자료" 또는 "코드 다운로드" 클릭
  → "법정동코드 전체자료.txt" 또는 .zip 다운로드
  → zip 이면 압축 해제하여 txt 파일 확보

대안 (공공데이터포털, 무로그인):
  https://www.data.go.kr/data/15077871/fileData.do
```

#### 2) 파일 배치
```
다운로드한 파일을 다음 경로에 저장:
  C:\git\2026_MOLIT_CONTEST\server\data\legal_dong_codes.txt
  (server/data/ 폴더가 없으면 생성)

※ 인코딩 변환 불필요 — 스크립트가 EUC-KR/CP949 → UTF-8 자동 처리
```

#### 3) 의존성 설치 + 시드 실행
```powershell
cd C:\git\2026_MOLIT_CONTEST\server
npm install                # iconv-lite 추가됨
npm run seed:bjd

# 콘솔 로그 예시:
# [seed:bjd] start
# [seed:bjd] 인코딩 감지: EUC-KR / CP949 → UTF-8 변환
# [seed:bjd] 파싱 완료: 46,234 행
# [seed:bjd]   - 행정동 단위 (10자리 + dong 보유): 21,503
# [seed:bjd]   - 활성: 20,387 / 폐지: 25,847
# [seed:bjd]   - 서울 행정동 후보: 467
# [seed:bjd] 기존 row 삭제: 427
# [seed:bjd] 2000 / 46234
# ...
# [seed:bjd] 완료 — t_legal_dong 총 46,234건
# [seed:bjd]        서울 법정동 (10자리 + dong) 467건
```

### 13.6 시드 후 매칭률 재검증
```sql
SELECT
  COUNT(DISTINCT CONCAT(ac.sigungu_code, '|', ac.legal_dong)) AS dong_groups,
  COUNT(DISTINCT CASE WHEN ld.code IS NOT NULL
        THEN CONCAT(ac.sigungu_code, '|', ac.legal_dong) END) AS matched
FROM t_apt_complex ac
LEFT JOIN t_legal_dong ld
  ON ld.dong = ac.legal_dong
 AND ld.code LIKE CONCAT(ac.sigungu_code, '%')
WHERE ac.sigungu_code LIKE '11%';

-- 기대 (BJD 정확 매칭): matched / dong_groups ≈ 0.95+
-- 95% 미만이면 단지 이름 정규화 이슈 — 별도 후속
```

### 13.7 알려진 한계 / 후속 작업
```
[1] 파일 형식 변동 가능성
    · 행정안전부가 컬럼 순서/구분자 바꾸는 경우 발생 가능 (드물지만)
    · 스크립트는 헤더 자동 skip + 다중 구분자 지원 — 대부분 변동 흡수

[2] sigungu name 매칭 케이스
    · BJD 마스터: "수원시 영통구" (공백 포함)
    · 단지 sigungu_code: "41117" (영통구 코드 5자리)
    · 매칭은 code prefix 로 하므로 sigungu name 표기 영향 없음 — OK

[3] 행정동 데이터는 폐기됨
    · seoul-centroids.json 은 클라이언트(MapPanel 히트맵)에서 그대로 사용
    · 서버 측 t_legal_dong 은 BJD only — 일관성 확보

[4] 다운로드 자동화 미구현
    · 행정안전부 사이트는 form 기반 → 자동 fetch 어려움
    · 정공: 분기별 1회 수동 갱신 (대량 변경 거의 없음)
    · 또는 공공데이터 API 활용 (인증키 별도)
```

### 13.8 §13 파일 통계
```
server/scripts/seedBjd.ts                                          174 lines (신규)
server/package.json                                                +2 lines
.gitignore (루트)                                                  +4 lines
────────────────────────────────────────────────────────────────
§13 합계                                                          ~180 lines
```

### 13.9 다음 세션 첫 한 줄 ~~(§14에서 추가 단순화됨)~~

> ~~"행정안전부 BJD 데이터 다운로드 → `server/data/legal_dong_codes.txt` 배치 → `npm install && npm run seed:bjd` → 매칭률 95%↑ 확인 → DEMO 뱃지 소거 검증 → 정상이면 Sprint C-2 진입."~~

---

## 14. seedBjd 자동 fetch 전환 — 사용자 작업 0건

### 14.1 한 줄 요약
> 사용자가 행정안전부 사이트에서 텍스트 파일 다운로드받지 않아도 됨.
> kr-legal-dong GitHub JSON 자동 fetch 로 단순화 — **`npm run seed:bjd` 한 줄로 완료**.

### 14.2 데이터 소스
```
https://github.com/kr-legal-dong/kr-legal-dong
  · 행정안전부 BJD 코드를 정제한 공개 JSON repo
  · archived (2024-08) 이지만 BJD 코드 자체가 분기 단위 안정 → 그대로 사용 OK
  · raw URL: https://raw.githubusercontent.com/kr-legal-dong/kr-legal-dong/main/dong.json

데이터 shape (사용자 확인 완료):
{
  "code":     "1111010100",     ← BJD 10자리, t_legal_dong.code 1:1
  "siName":   "서울특별시",       ← t_legal_dong.sido
  "guName":   "종로구",           ← t_legal_dong.sigungu
  "name":     "청운동",           ← t_legal_dong.dong
  "active":   true               ← t_legal_dong.isActive
}
```

### 14.3 변경
```
편집  server/scripts/seedBjd.ts
  · 이전: 행정안전부 EUC-KR 파일 파싱 + iconv-lite 인코딩 변환
  · 이후: Node 18+ 글로벌 fetch 로 raw URL JSON 직접 GET
         shape 검증 (첫 row 의 code/name/siName 키 확인)
         시군구 5자리 row 도 unique guCode 기반으로 같이 시드
         배치 500개 createMany

편집  server/package.json
  · iconv-lite 의존성 제거 (사용처 사라짐)

편집  .gitignore (루트)
  · server/data/legal_dong_codes.txt 라인은 유지 (오프라인 시드 옵션 대비)
```

### 14.4 사용자 액션 — 한 줄

```powershell
cd C:\git\2026_MOLIT_CONTEST\server
npm run seed:bjd
```

> ※ npm install 도 불필요 (의존성 추가 없음).
>   ※ 인터넷 연결 필요 (kr-legal-dong raw URL fetch).

콘솔 로그 예상:
```
[seed:bjd] fetching from kr-legal-dong/kr-legal-dong …
[seed:bjd]   https://raw.githubusercontent.com/.../dong.json
[seed:bjd] fetched ~21,000 dong rows
[seed:bjd] unique 시군구 그룹: ~250
[seed:bjd] deleted 427 existing rows           ← 기존 ADM 시드 row 정리
[seed:bjd] sigungu rows inserted: ~250
[seed:bjd] 5000 / 21000
[seed:bjd] 10000 / 21000
...
[seed:bjd] 완료 — t_legal_dong 총 ~21,250건
[seed:bjd]        서울 법정동 (10자리 + dong) ~470건
```

### 14.5 검증 (시드 후)

```sql
-- (1) 총량 + 서울 동 개수
SELECT COUNT(*) AS total FROM t_legal_dong;
SELECT COUNT(*) AS seoul_dongs
FROM t_legal_dong
WHERE LENGTH(code)=10 AND code LIKE '11%' AND dong IS NOT NULL;
-- 기대: 서울 ~470

-- (2) 매칭률 — BJD 정확 매칭으로 95%+ 기대
SELECT
  COUNT(DISTINCT CONCAT(ac.sigungu_code, '|', ac.legal_dong)) AS dong_groups,
  COUNT(DISTINCT CASE WHEN ld.code IS NOT NULL
        THEN CONCAT(ac.sigungu_code, '|', ac.legal_dong) END) AS matched
FROM t_apt_complex ac
LEFT JOIN t_legal_dong ld
  ON ld.dong = ac.legal_dong
 AND ld.code LIKE CONCAT(ac.sigungu_code, '%')
WHERE ac.sigungu_code LIKE '11%';
```

### 14.6 브라우저 시연 검증

```
1. cd C:\git\2026_MOLIT_CONTEST && npm run dev
2. http://localhost:5173/ → "강남역" 검색
3. 우상단 DEMO 뱃지 자동 소거 (서버 200 OK → dataSource='api')
4. 카드 8건 + 1위 클릭 → Depth 3 진입
   (Depth 3 는 매물/LSTM/통근 모두 mock 이라 DEMO 뱃지 유지 — 정상)
```

### 14.7 알려진 약점 / 후속

```
[1] kr-legal-dong repo 가 archived (2024-08)
    · BJD 코드 자체는 분기 단위 안정 → 영향 거의 없음
    · 행정 개편 시점에 데이터 차이 발생 가능 → 분기 갱신 필요
    · 만일 repo 삭제될 경우: 행정안전부 공식 데이터로 fallback 시드 작성 (오프라인 옵션)

[2] DATA_URL 하드코딩
    · 환경변수 BJD_SEED_URL 로 override 가능하도록 보강 가능 (low priority)

[3] dong.json 의 active=false (폐지 동) 도 시드됨
    · 추천 라우터는 활성 여부 무시 (전국 매물 데이터에 폐지동 거의 없음)
    · 향후 정공: WHERE isActive=true 조건 추가
```

### 14.8 §14 파일 통계
```
server/scripts/seedBjd.ts                                완전 재작성 (~140 → ~120 lines)
server/package.json                                       -1 line (iconv-lite 제거)
.gitignore                                                +1 주석 라인
────────────────────────────────────────────────────────
§14 합계                                                  ~120 lines (대체)
```

### 14.9 다음 세션 첫 한 줄 (최최신)

> **"`cd server && npm run seed:bjd` 한 줄 실행 → §14.5 매칭률 95%↑ 확인 → 브라우저에서 DEMO 뱃지 소거 검증 → 정상이면 Sprint C-2 (매물/LSTM API) 진입."**

### 14.10 실제 검증 결과 (2026-05-21 심야, 사용자 환경)

```
시드 후 매칭률 쿼리:
  dong_groups_with_complex  = 345
  matched                   = 342
  매칭률                     = 99.13%   ✅

이전(행정동 ADM): 23.8% → 지금(법정동 BJD): 99.13%
정공 시드가 정답이었음. 발표 시연에 충분한 정확도.

매칭 안 된 3개 동 (0.87%)
  → 추가 진단 쿼리는 §14 끝 사용자 안내 참조
  → 행정 통폐합 또는 표기 변형 가능성, 작업 우선순위 낮음
```
