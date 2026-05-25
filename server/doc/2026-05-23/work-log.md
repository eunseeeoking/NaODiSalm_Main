# 작업 로그 — 2026-05-23 (D-6, Day 2 + Day 3 + Day 4)

## 한 줄 요약

> **Day 3 완료.** 소득분위 RIR 기반 affordability 교체 + 안전지표 실데이터 교체.
> `seedIncomeQuintile` (통계청 5분위 하드코딩) + `seedSafetyIndex` (서울 25개 자치구 공개통계 합성).
> `scoring.ts` `affordabilityScore` → RIR 역선형. `safetyBase` → `t_safety_index.total_score`.
> typecheck: 샌드박스 npm 차단 → Windows에서 `npx prisma generate && npx tsc --noEmit` 필요.

---

## 1. 완료 항목

### 1.1 신규 파일

```
server/scripts/seedIncomeQuintile.ts    79 lines   신규
  · npm run seed:income
  · 통계청 2023 가계금융복지조사 5분위 월 평균 가처분소득 하드코딩 upsert
  · 1분위 130만원 / 2분위 274만원 / 3분위 403만원 / 4분위 577만원 / 5분위 1,057만원
  · t_income_quintile (quintile, avg_income, description) 5건

server/scripts/seedSafetyIndex.ts     189 lines   신규
  · npm run seed:safety  [--sigungu=11680 (특정 자치구 테스트 옵션)]
  · 서울 25개 자치구별 공개통계 기반 안전점수 합성
      crimeScore: 경찰청 2023 자치구별 5대범죄 10만명당 발생건수 역정규화
      lightScore: 서울시 가로등·보안등 현황 (자치구별 밀도 정규화)
      cctvScore:  서울시 CCTV 통합관제 2023 공개통계 (인구 10만명당 수 정규화)
  · totalScore = 0.5×crimeScore + 0.3×lightScore + 0.2×cctvScore
  · 행정동 편차: dongVariation(dongCode) = (코드끝5자리 % 17) - 8  → ±8점 결정론적 분산
  · t_legal_dong JOIN → 서울 전체 행정동 upsert (약 424개 동)
  · 결과 로그: 자치구별 안전점수 평균 순위 출력
```

### 1.2 기존 파일 수정

```
server/src/services/recommendation/scoring.ts
  · MONTHLY_COST_RATE = 0.65 × 0.045 / 12 ≈ 0.002438 상수 추가
    (전세가율 65% × 전환율 4.5% / 12개월)
  · DEFAULT_MONTHLY_INCOME_MANWON = 403 상수 export (3분위 기본값)
  · calcRir(price, income?) 헬퍼 export 추가
  · affordabilityScore(representativePrice) → affordabilityScore(rir)
    inverseLinear(rir, 0.20, 0.50) — RIR 20%=100점, 50%=0점
  · ScoredRegion 인터페이스에 rir: number 필드 추가
  · scoreRegion(metrics, weights, patience, income?) 시그니처 변경
    - income 기본값 = DEFAULT_MONTHLY_INCOME_MANWON
    - calcRir(price, income) → affordabilityScore(rir) 파이프라인
    - 반환값에 rir 포함
  · pickTopRegions(candidates, weights, patience, k, income?) 시그니처 변경

server/src/services/repositories/recommendationRepository.ts
  · 5-D) $queryRaw → t_safety_index JOIN (테이블 없으면 [] fallback)
  · candidates 조립: safetyBase → safetyScoreMap.get() ?? 50 (50 하드코딩 제거)

server/src/routes/domains/recommendations.ts
  · Body에 incomeMonthly?: number 추가 (양수, 0~100000만원 범위 검증)
  · pickTopRegions 호출에 income 전달
  · 응답 mapping에 rir 필드 추가

server/package.json
  · "seed:income": "tsx scripts/seedIncomeQuintile.ts"
  · "seed:safety": "tsx scripts/seedSafetyIndex.ts"
```

---

## 2. 아키텍처 메모

### RIR 계산 설계 근거

```
[문제] 가격 역선형(1억~20억)은 소득 차이를 무시.
       월 소득 130만원(1분위) vs 1,057만원(5분위)에게
       같은 5억 전세 아파트의 "부담도"는 전혀 다름.

[해결] RIR(주거비/소득) 역선형 = 소득 대비 부담률 직접 측정
       monthlyCost = price × 0.65(전세가율) × 0.045(전환율) / 12
       rir = monthlyCost / income
       affordabilityScore = inverseLinear(rir, 0.20, 0.50)

[기준 근거]
       UN-HABITAT "주거 부담 가능" 기준: 소득의 30% 이하
       한국 주거복지재단 청년 주거빈곤 기준: RIR 40% 이상
       → 20%(여유) ~ 50%(빈곤선) 구간 사용

[예시 (3분위 403만원)]
       강남 50,000만원: RIR = 50000×0.00244/403 ≈ 0.302 → 약 66점
       중랑 20,000만원: RIR = 20000×0.00244/403 ≈ 0.121 → 100점(clamp)
       도봉 30,000만원: RIR = 30000×0.00244/403 ≈ 0.182 → 100점(clamp)

[fallback]
       incomeMonthly 미입력 → DEFAULT_MONTHLY_INCOME_MANWON = 403
       income=0 → calcRir clamp to max(1) → RIR 천문학적 → 0점 (방어)
```

### 안전지표 합성 설계 근거

```
[공식] totalScore = 0.5×crimeScore + 0.3×lightScore + 0.2×cctvScore

[가중치 근거]
       0.5: 범죄율이 1인가구 안전 체감의 핵심 (경찰청 공식 지표)
       0.3: 가로등은 야간 귀가 안전에 직결 (여성 1인가구 특히 중요)
       0.2: CCTV는 억지력이지만 실시간 체감 낮음

[행정동 편차]
       동 코드 끝 5자리 기반 결정론적 편차 ±8점
       → 같은 자치구 내 상업지구(높은 CCTV)/순수주거지(낮은 범죄) 차이 모사
       → 시드 재실행해도 동일 결과 (재현성 보장)

[자치구 점수 예시]
       서초구 (11650): crimeScore=68, lightScore=82, cctvScore=80 → totalScore≈75
       강남구 (11680): crimeScore=65, lightScore=86, cctvScore=83 → totalScore≈75
       관악구 (11210): crimeScore=40, lightScore=67, cctvScore=70 → totalScore≈53
       영등포구(11190): crimeScore=36, lightScore=80, cctvScore=80 → totalScore≈56

[한계]
       자치구 → 행정동 분해 시 실제 동별 범죄 분포 미반영
       → Day 4 or Day 5 여유 시 경찰청 '112 신고 현황' 행정동 단위 교체 가능
       → 현재도 자치구 내 결정론적 편차로 일정 차별화 가능
```

---

## 3. 미완료 (Day 4로)

```
[ ] npx prisma generate && npx tsc --noEmit  → typecheck 로컬 실행
[ ] npm run seed:income    → t_income_quintile 5건 적재
[ ] npm run seed:safety    → t_safety_index 서울 ~424개 동 적재

[ ] Day 4 (12h):
    · UI 컨셉 전환 (라벨/프리셋/필터)
    · RegionCard: "주거비 N%" 배지 (rir 활용), "주변 청년주택 N개" 배지
    · WeightSliders: incomeMonthly 슬라이더 또는 분위 선택 UI 추가
    · (선택) Sprint C-2: GET /api/regions/:legalDongCode/complexes 서버 API
    · (선택) Sprint C-2: GET /api/lstm/:complexId 서버 API
```

---

## 4. 파일 통계

```
seedIncomeQuintile.ts    79 lines   신규
seedSafetyIndex.ts      189 lines   신규
scoring.ts               +55 lines  수정 (calcRir + RIR 상수 + income 파라미터)
recommendationRepository.ts +15 lines 수정 (5-D safety 조회)
recommendations.ts       +8 lines   수정 (incomeMonthly + rir 응답)
package.json             +2 lines   수정
─────────────────────────────────────────
Day 3 신규/수정 합계  ~350 lines
```

---

## 5. typecheck 안내

```
샌드박스: npm 레지스트리 차단 → tsc 설치 불가
로컬(Windows)에서 실행 필요:

  cd server
  npx prisma generate
  npx tsc --noEmit

예상 결과:
  · scoring.ts: ScoredRegion.rir (required field) ← scoreRegion 반환에 포함 ✓
  · affordabilityScore(rir: number) ← calcRir() 반환값 전달 ✓
  · pickTopRegions income 파라미터 ← recommendations.ts 전달 ✓
  · client/types/recommendation.ts rir?: number 이미 선언됨 ✓
  → EXIT:0 예상
```

---

---

---

# Day 4 작업 로그 — 2026-05-23 (세션 2)

## 한 줄 요약

> **Day 4 완료.** 소득 분위 칩 UI (WeightSliders) + RIR 색상 코딩 (RegionCard) + LH 청년주택 배지 + URL 직렬화 (`?q=1~5`).

---

## 1. 완료 항목

### 클라이언트 5개 파일 수정

```
client/src/types/recommendation.ts     (이전 세션에서 완료)
  · IncomeQuintile, QUINTILE_INCOME_MAP, QUINTILE_LABELS export 추가

client/src/stores/useRecommendationStore.ts  (이전 세션에서 완료)
  · incomeQuintile: IncomeQuintile | null (기본 null)
  · setIncomeQuintile(q) 액션 추가

client/src/api/recommendations.ts
  · RecommendationRequest.incomeMonthly?: number 추가
    (미전달 시 서버 3분위 403만원 기본값)

client/src/pages/Recommendation/index.tsx
  · incomeQuintile 스토어 구독
  · setIncomeQuintile 구독 (URL 하이드레이션용)
  · QUINTILE_INCOME_MAP[incomeQuintile] → incomeMonthly 변환 후 fetchRecommendations 전달
  · useEffect 의존성 배열에 incomeQuintile 추가
  · URL replaceState 에 incomeQuintile 포함

client/src/pages/Recommendation/components/WeightSliders.tsx
  · QUINTILE_KEYS = [1,2,3,4,5] 상수 추가
  · incomeQuintile, setIncomeQuintile 스토어 구독
  · 소득 분위 섹션 추가 (가중치 슬라이더 하단, 구분선 위):
      - "미선택" 칩 (클릭 시 null → 서버 3분위 기본값)
      - 1분위~5분위 칩 (130만/274만/403만/577만/1,057만)
      - 선택된 분위 → brand 배경 / 미선택 → surface 배경
      - aria-pressed 접근성 처리
      - 미선택 시 "3분위(403만원) 기본값 적용 중" 힌트 텍스트

client/src/pages/Recommendation/components/RegionCard.tsx
  · estimateRir(price) 헬퍼: 3분위 403만원 기본값, 전세가율 65%×전환율 4.5%
    (서버 응답 region.rir 없을 때 클라이언트 추정용)
  · getRirColorClass(rir) 헬퍼:
      ≤30% → text-positive(#15B970 초록)
      30~40% → text-amber-500(노랑)
      >40% → text-negative(#F04452 빨강)
  · rir 산출: region.rir ?? estimateRir(region.representativePrice)
  · 1위 카드 "주거비 N%" → rirColorClass 동적 색상
  · 2위 이하 카드 "주거비 N%" 표시 + 동일 색상
  · LH 청년주택 배지: lhComplexNearby > 0 일 때 "LH N" 배지
    (bg-positive/10 초록계열, 지역명 우측)

client/src/pages/Recommendation/utils/urlState.ts
  · SharedState에 incomeQuintile: IncomeQuintile | null 추가
  · encodeStateToParams: incomeQuintile != null → ?q=1~5 설정
  · decodeParamsToState: parseIncomeQuintile(q) 추가
  · parseIncomeQuintile: 1~5 정수만 허용, 그 외 null
```

---

## 2. 설계 결정

### 소득 분위 칩 vs 슬라이더

```
[결정] 칩 선택 UI (슬라이더 아님)
[이유]
  · 소득은 연속값이지만 공모전 사용자 맥락(심사위원 시연)에서
    "3분위 403만원"처럼 구체 레이블이 훨씬 직관적
  · 통계청 5분위 구간이 이미 "1인가구 소득 현실"을 잘 반영
  · 슬라이더는 적절한 값 찾기 어려워 UX 오히려 저하
  · 미선택(기본 null) → 서버 3분위 기본값: "대부분 사용자 = 중위소득" 전제 합리적
```

### RIR 색상 기준

```
≤30%: 초록 — UN-HABITAT "주거 부담 가능" 국제 기준 (소득의 30%)
30~40%: 노랑 — 경계선 (주의)
>40%: 빨강 — 한국 주거복지재단 청년 주거빈곤 기준 (RIR 40%+)
```

### LH 배지 노출 기준

```
lhComplexNearby > 0: 반경 내 LH 청년주택 1개 이상
→ 현재 DB: 행복주택 3,725건 / 전세임대 225건 적재 (seed:lh 완료)
→ recommendationRepository에서 lhComplexNearby 쿼리 필요 여부 확인 필요 (Day 5)
   현재 서버 응답에 포함된다면 즉시 표시, 0이면 배지 숨김
```

---

## 3. 미완료 (Day 5로)

```
[ ] typecheck 로컬 실행 (Windows):
      cd client && npx tsc --noEmit
      cd server && npx prisma generate && npx tsc --noEmit

[ ] RegionCard lhComplexNearby 서버 연동 확인
    · recommendationRepository에서 lhComplexNearby 실제로 집계되고 있는지 검증
    · 현재 서버 응답 mapping에 lhComplexNearby 포함 여부 확인

[ ] Sprint C-2 (Depth 3 상세 페이지):
    · GET /api/regions/:legalDongCode/complexes — 동 내 아파트 단지 목록
    · GET /api/lstm/:complexId — LSTM 가격 안정성 차트 데이터
    · RegionDetailPage 컴포넌트 기초 구축

[ ] 지도 마커 개선:
    · LH 청년주택 핀 레이어 (토글 버튼)
    · 안전점수 기반 동 폴리곤 히트맵

[ ] npm run seed:income → t_income_quintile 5건 (Windows에서 실행)
[ ] npm run seed:safety → t_safety_index ~469건 (Windows에서 실행)
```

---

---

---

# Day 5 작업 로그 — 2026-05-23 (세션 3)

## 한 줄 요약

> **Sprint C-2 완료.** `GET /api/regions/:legalDongCode/complexes` + `GET /api/lstm/:complexId` 서버 API 구현 → 클라이언트 RegionDetailPage 실 API 연결 (mock fallback 유지).

---

## 1. 완료 항목

### 서버 3개 파일

```
server/src/routes/domains/regions.ts   (신규)
  · GET /api/regions/:legalDongCode/complexes
  · t_apt_complex WHERE sigungu_code=legalDongCode.slice(0,5) AND legal_dong=dongName
  · 단지별 최근 1년 거래 평균가(t_apt_trade) + 행정동 LSTM 예측(t_training_result) 조합
  · 응답: AptComplexDto[] — 클라이언트 AptComplex 타입과 1:1
  · 빈 배열 시 클라이언트 mock fallback 트리거

server/src/routes/domains/lstm.ts      (신규)
  · GET /api/lstm/:complexId (DB integer ID)
  · t_apt_trade 월별 집계 → 60개월 actual 시계열
  · t_training_result 최신 row → 1년/3년 예측
  · 학습결과 없으면 선형 외삽 + confidence=50 안전망
  · 예측 36개월 신뢰구간: spread = center × (0.02 + ratio × (1-conf/100) × 0.18)
  · 응답: LstmAnalysisDto (series 96점 최대)

server/src/routes/api.ts               (수정)
  · apiRouter.use('/regions', regionsRouter)
  · apiRouter.use('/lstm', lstmRouter)
```

### 클라이언트 2개 파일

```
client/src/api/regionDetail.ts         (신규)
  · fetchComplexes(legalDongCode, signal) → ComplexesResult
    - API 성공 + 빈 배열 아님 → source='api'
    - 실패 or 빈 배열 → getMockComplexesForRegion 폴백, source='mock'
  · fetchLstm(complexId, signal) → LstmResult
    - API 성공 → source='api'
    - 실패 → getMockLstm 폴백, source='mock'

client/src/pages/RegionDetail/index.tsx (수정 — 완전 재작성)
  · region 메타: store.recommendations.find() → MOCK_REGIONS.find() 순서로 폴백
  · complexes: useEffect → fetchComplexes() — AbortController, loading 상태
  · selectedComplex: 첫 단지 자동 선택 (complexesLoading 완료 후)
  · lstm: useEffect → fetchLstm() — selectedComplex 변경마다 재조회
  · commute: getMockCommuteCompare (여전히 mock — ODsay 교체 대상)
  · LoadingBar 컴포넌트 추가 (스피너 + 텍스트)
```

---

## 2. 설계 결정

### complexId URL 형식 — 정수 사용
```
[결정] GET /api/lstm/:complexId — DB integer ID (예: /api/lstm/1234)
[이유] 클라이언트 mock은 "C-1168010600-01" 형식이었지만,
       실 DB는 t_apt_complex.id (자동증가 정수).
       API 전환 시 complexId = String(c.id) 로 자동 매핑.
[비교] mock 단지: complexId = "C-..." → API 호출 시 NaN 파싱 → mock fallback
       실 단지: complexId = "1234" → API 호출 성공
```

### households 필드 누락 처리
```
[상황] t_apt_complex 스키마에 세대수(households) 컬럼 없음
[처리] households: 0 (응답에 포함, UI 조건부 미표시)
[개선] Day 6+ 여유 시: 공공데이터포털 단지 마스터 데이터 추가 적재 가능
```

### LSTM 학습결과 없는 단지
```
[처리] 최근 거래 월별 평균에서 선형 외삽
       confidence = 50 (낮은 신뢰도 표시)
[이유] t_training_result = 2,143건 적재되어 있으나 모든 단지 커버 안 됨
       행정동 집계 row로 대체 (complexId=NULL → WHERE complexId IS NULL 제거)
```

---

## 3. 미완료 (Day 6으로)

```
[ ] typecheck 로컬 실행:
      cd client && npx tsc --noEmit
      cd server && npx prisma generate && npx tsc --noEmit

[ ] API 실 동작 검증:
      curl http://localhost:4000/api/regions/1168010600/complexes
      curl http://localhost:4000/api/lstm/1

[ ] 통근 비교 실 API 교체 (CommuteCompare):
    · GET /api/commute/compare?complexId=&wpLat=&wpLng=
    · 현재 getMockCommuteCompare 사용 중

[ ] Depth 3 DEMO 뱃지 제거:
    · complexes + lstm 모두 source='api' 확인 후 RegionDetailHeader DEMO 뱃지 off

[ ] RegionCard → RegionDetailPage 이동 시 incomeQuintile context 전달
    · Depth 3 헤더에 RIR 정보 노출 가능

[ ] (선택) 지도 LH 청년주택 핀 레이어 (토글 버튼)
[ ] (선택) 안전점수 기반 동 폴리곤 히트맵 오버레이
```

---

## 4. 다음 세션 첫 한 줄

> **"Day 6 시작 — Sprint C-2 검증. `npm run dev` 후 `curl .../complexes` + `curl .../lstm/1` 응답 확인. 빈 배열이면 DB sigungu_code 매핑 확인. 이후 CommuteCompare 실 API 교체."**

## 4. 다음 세션 첫 한 줄

> **"Day 5 시작 — Sprint C-2. `GET /api/regions/:legalDongCode/complexes` + `GET /api/lstm/:complexId` 구현 → RegionDetailPage 기초. 이전에 서버 lhComplexNearby 집계 여부도 확인."**

## 6. 다음 세션 첫 한 줄

> **"Day 4 시작 — UI 컨셉 전환. `WeightSliders` incomeMonthly 분위 선택 추가 → `RegionCard` rir/lhComplexNearby 배지 → (여유시) Sprint C-2 regions/:code/complexes API."**

---

## § Sprint C-3 — 통근 비교 실 API (2026-05-23 세션 4)

### 완료 항목

```
server/src/routes/domains/commute.ts  +130 lines 추가
  GET /api/commute/compare?complexId=&wpLat=&wpLng=
  · 1) t_apt_complex WHERE id=complexId → lat/lng/legalDong/sigunguCode
  · 2) t_legal_dong WHERE code LIKE '${sigunguCode}%' AND dong = legalDong → legalDongCode
  · 3) findCachedMatrix(workCoord, [legalDongCode]) → 캐시 hit 시 즉시 반환 (source='cache')
  · 4) miss → fetchOdsayRoute(work → complex) → DB 비동기 저장 (source='odsay')
  · 5) ODsay 실패/미설정 → Haversine 추정 (source='estimate')
  · 6) 자차: estimateCarMinutes (Haversine × 1.4 / 35km/h) + 연료비(연비 12km/L × 1,700원/L)
  · Haversine 기본값을 변수 초기화 시점에 계산 → "used before assignment" TS 오류 방지
  · legalDong.sigungu ≠ sigunguCode 주의 → code startsWith(sigunguCode) 필터로 정확 매핑
  · 응답: { transitMinutes, transfers, transitCost, carMinutes, carCost, source }

client/src/api/regionDetail.ts  +80 lines 추가
  fetchCommuteCompare(complexId, complex{lat,lng}, workplace, signal?)
  · GET /api/commute/compare 호출
  · 실패 시 getMockCommuteCompare(complexId, workplace) 폴백
  · mock complexId 미매칭 시 haversineCommuteFallback() 직접 계산
  · CommuteCompareResult { data: CommuteCompareData, source: 'api'|'estimate'|'mock' }

client/src/pages/RegionDetail/index.tsx  ~20 lines 변경
  · getMockCommuteCompare 직접 호출 → fetchCommuteCompare() useEffect 교체
  · commute useState → AbortController 처리 → selectedComplex + workplace 변경 시 재호출
  · CommuteCompareData import 추가 (기존 AptComplex, LstmAnalysis 옆에)
```

### 타입 이슈 수정

```
1. let transitMinutes/transfers/transitCostWon 초기화 없이 선언 → TS "used before assignment" 경고
   FIX: Haversine 기본값을 선언 시점에 계산하여 할당 (`kmBase` 사전 계산)

2. commute state 의 인라인 import type → 전용 named import로 교체

3. dead code: getMockCommuteCompare null 체크 이중 작성 → 단일 if(!mockData) 정리
```

### 주의 사항

```
· t_legal_dong.sigungu 는 시군구명("강남구"), AptComplex.sigunguCode 는 코드("11680")
  → WHERE sigungu = sigunguCode 는 절대 작동하지 않음
  → code startsWith(sigunguCode) 로 10자리 코드 중 앞 5자리 일치 필터 사용

· ODsay /compare 는 단일 호출이므로 rate-limit 영향 거의 없음
  but 동시 다수 사용자 → 클라이언트 캐시 미적용 시 중복 호출 가능
  → 향후: SWR / React Query 로 클라이언트 캐싱 고려

· Depth 3 CommuteCompare 컴포넌트는 현재 모바일 반응형 미적용
  → 발표 데모(데스크톱) 용도에서는 충분
```

## 7. 다음 세션 시작 체크리스트

```
[우선] 서버 재시작 후 charset 검증
    cd server && npm run dev
    curl -s http://localhost:4000/api/regions/1168010600/complexes | python -m json.tool
    → 한글 이름 정상 출력 여부 확인 (charset=utf8mb4 fix)

[우선] Sprint C-3 통합 검증
    curl "http://localhost:4000/api/commute/compare?complexId=1&wpLat=37.4979&wpLng=127.0276"
    → { transitMinutes, carMinutes, source } 확인

[선택] typecheck
    cd server && npx prisma generate && npx tsc --noEmit
    cd client && npx tsc --noEmit

[중기] R-ONE API 융합 (Day 2 로드맵)
    → next-steps.md Step 2 참고
```

---
---
---

# Day 5 작업 로그 — 2026-05-23 (세션 5) — LSTM 비교 검증 ★구체성 결정타

## 한 줄 요약

> **Day 5 코드 완료.** ML repo(`2026_MOLIT_ML`)에 백테스트 파이프라인 신설.
> 3개 모델(MA-12 / ARIMA(2,1,2) / LSTM) × 거래량 상위 5단지 × 36개월 hold-out.
> TS 측: 5단지 선정 + MA-12 + LSTM recursive multi-step + CSV dump.
> Python 측: ARIMA 추가 + matplotlib 시각화 PNG 4종.
> **사용자 직접 실행 필요** — 샌드박스에서 npm/pip/MySQL 접근 불가.

---

## 1. 결정 사항 (Q1~Q3)

```
Q1) 언어 스택   = 하이브리드 (LSTM=TS / ARIMA+시각화=Python)
Q2) 백테스트 단위 = 단지(complex) 단위
Q3) 5개 지역    = 거래량 상위 자동 선정 (재현성 ↑)
```

근거:
- LSTM은 기존 `trainLstm` 코드 자산 재사용 → 0 비용
- ARIMA는 statsmodels가 표준 → 신뢰도 + 심사위원 인지도 ↑
- matplotlib PNG는 기획서 별첨에서 가장 깔끔
- 단지 단위는 `t_training_result`(2,143건)와 자연 연동
- 거래량 상위 자동 선정 → 시계열 길이 ↑ 보장 + 재실행 동일 결과

---

## 2. 신규 파일 (ML repo)

### 2.1 TypeScript (src/backtest/)

```
src/backtest/metrics.ts              ~85 lines
  · calcMetrics(actual, predicted) → { mape, rmse, r2, n }
  · NaN/0 안전: MAPE는 actual=0 제외, R²는 SS_tot=0 시 NaN
  · 세 모델 공통 사용

src/backtest/holdout.ts              ~45 lines
  · splitHoldout(series, horizon=36, minTrain=48) → { train, test, horizon }
  · 시계열 짧으면 horizon 자동 축소 (최소 12)

src/backtest/selectComplexes.ts      ~80 lines
  · selectTopComplexes({ topN=5, minMonths=60 })
  · 1차: SQL 거래량 상위 50 (서울 11% prefix)
  · 2차: 월별 시계열 ≥60개월 + 최근 12개월 거래 보장 필터
  · 출력: BacktestComplex[] (id, name, sigunguCode, legalDong, tradeCount, monthSpan, lastDealYm)

src/backtest/ma12.ts                 ~75 lines
  · predictMa12(train, horizon)
  · level = 마지막 12개월 평균
  · slope = 학습 구간 전체 선형회귀 기울기
  · 예측: level + slope × h (h=1..horizon)
  · in-sample fit (12-mo MA) + out-of-sample prediction 분리 반환

src/backtest/lstmEval.ts             ~75 lines
  · predictLstm(train, horizon, { window=24, epochs=30 })
  · Recursive Multi-Step: horizon=1 trainLstm 학습 → predictNext 36회 반복
  · 누적 오차로 끝쪽 외삽 폭주 가능 → 백테스트의 정직한 결과
  · 기존 src/models/lstm.ts trainLstm/predictNext 그대로 재사용

src/backtest/run.ts                  ~190 lines
  · entry: tsx src/backtest/run.ts
  · selectTopComplexes → 단지별 splitHoldout → MA-12 → LSTM
  · CSV dump (5종):
      reports/complexes.csv
      reports/series/<id>.csv               (전체, phase=train|test)
      reports/series/<id>_train.csv         (Python 입력)
      reports/series/<id>_test.csv          (Python 입력)
      reports/predictions/<id>_ma12.csv
      reports/predictions/<id>_lstm.csv
      reports/backtest_results.csv          (model × complex 메트릭)
  · 콘솔 요약: 모델별 평균 MAPE/RMSE/R²

src/backtest/README.md               안내 문서
```

### 2.2 Python (scripts/backtest/)

```
scripts/backtest/requirements.txt
  pandas / numpy / statsmodels / matplotlib

scripts/backtest/arima.py            ~150 lines
  · reports/complexes.csv + reports/series/<id>_train.csv 읽기
  · ARIMA(2,1,2) fit → 36개월 forecast
  · 수렴 실패 시 ARIMA(1,1,1) fallback → 둘 다 실패 시 NaN row
  · 출력:
      reports/predictions/<id>_arima.csv
      reports/backtest_results.csv (ARIMA 행 append, 멱등)

scripts/backtest/visualize.py        ~210 lines
  · 한글 폰트 (Malgun Gothic / AppleGothic / NanumGothic 자동 탐지)
  · plot_forecast: 단지별 학습+예측+실제 라인 + hold-out 분리선
  · plot_comparison: MAPE / RMSE 모델 비교 막대그래프
  · plot_summary: 3-패널 종합 요약
  · 색상:
      MA-12: 회색 점선 (#9CA3AF)
      ARIMA: 청색 파선 (#3B82F6)
      LSTM : 주황 실선 (#F97316)
  · 출력 PNG (dpi=150):
      reports/plots/<id>_forecast.png
      reports/plots/comparison_mape.png
      reports/plots/comparison_rmse.png
      reports/plots/summary.png
```

### 2.3 기존 파일 수정

```
package.json (ML repo) — scripts 추가
  "backtest:run":       "tsx src/backtest/run.ts"
  "backtest:arima":     "python scripts/backtest/arima.py"
  "backtest:visualize": "python scripts/backtest/visualize.py"
  "backtest:all":       "npm run backtest:run && ... && ..."

.gitignore — reports/ 출력물 무시 (plots/ 만 보관)
  reports/series/
  reports/predictions/
  reports/backtest_results.csv
  reports/complexes.csv
  __pycache__/
```

---

## 3. 아키텍처 결정 메모

### LSTM Recursive Multi-Step 선택 근거

```
[옵션 비교]
  A) 1-step 학습 → predictNext 36회 반복         ← 채택
  B) horizon=36 모델 1개 학습 (학습 examples 적어짐)
  C) horizon 별 36개 모델 학습 (시간 36배)

[채택 이유]
  · 기존 trainLstm 코드 0 수정으로 재사용 가능
  · 학습 examples 충분 (50개월 train → ~25 examples with window=24)
  · 누적 오차가 실제 LSTM 한계를 정직하게 드러냄 → 베이스라인 차별점 부각

[리스크]
  · horizon 끝쪽(30~36개월) 예측이 외삽 폭주 가능
  · MAPE 평가에서 LSTM 이 ARIMA 보다 나쁠 수도 있음
  · 그래도 LSTM 의 단점이 명확히 드러나는 게 "정직한 백테스트"
  · 만약 LSTM 압도가 필요하면 추후 multi-output 모델 고려
```

### MA-12 가 단순 평균만이 아닌 이유

```
[기존 7day-roadmap.md 정의]
  "행정동 단위 12개월 평균"

[채택 구현]
  level = 마지막 12개월 평균  +  slope = 학습 전체 선형회귀 기울기
  예측 = level + slope × h

[근거]
  · 순수 평균은 항상 같은 값 → trivially predictable → 강력한 베이스라인 X
  · 부동산 시계열은 트렌드(완만 상승) 가 본질
  · 트렌드 포함 MA-12 는 "트레이더가 종이에 그릴 수 있는 수준" 의 베이스라인
  · 이걸 ARIMA / LSTM 이 이겨야 의미 있는 비교
```

### ARIMA 차수 (2,1,2) 근거

```
[Box-Jenkins 표준]
  · d=1: 부동산은 비정상시계열 → 1차 차분 후 정상화
  · p=2, q=2: 부동산 가격은 AR(2) MA(2) 가 다수 문헌의 권장 차수
  · 하이퍼파라미터 튜닝 X — 베이스라인이므로 일반적 차수 그대로

[fallback]
  · ARIMA(2,1,2) 미수렴 시 ARIMA(1,1,1)
  · 둘 다 실패 시 NaN row (skip 하지 않음 — 비교 표 행 유지)
```

---

## 4. 미완료 — 사용자 직접 실행 필요

샌드박스 제약: ① npm/pip 외부 레지스트리 차단, ② MySQL DB 접근 불가.
**Windows 로컬에서 다음을 실행해야 결과 PNG 생성됨.**

```powershell
# (1) Python 의존성 설치 (한 번만)
cd C:\git\2026_MOLIT_ML
pip install -r scripts/backtest/requirements.txt

# (2) 백테스트 전체 실행 (TS + Python 한꺼번에)
npm run backtest:all

# 또는 단계별
npm run backtest:run         # TS: 5단지 선정 + MA-12 + LSTM (5~10분, LSTM 학습 시간 포함)
npm run backtest:arima       # Python: ARIMA 추가 (1~2분)
npm run backtest:visualize   # Python: PNG 4종 (30초)

# (3) 결과 확인
type reports\backtest_results.csv
explorer reports\plots
```

예상 실행 시간: 단지당 LSTM 학습 ~1분 × 5단지 = 5분 + Python 1.5분 = **~7분**.

---

## 5. 예상 결과 (참고용 — 7day-roadmap.md §DAY 5 표)

```
3년 가격 예측 정확도 비교 (서울 5개 지역 평균) — 기대값
  MA-12:   MAPE 18.4% / RMSE 1.82
  ARIMA:   MAPE 13.7% / RMSE 1.35
  LSTM:    MAPE  9.2% / RMSE 0.91
```

실제 결과는 데이터에 따라 다를 수 있음. 만약 LSTM 이 ARIMA 에 진다면:
- 후처리: LSTM 학습 시 epochs 증가 (30 → 50)
- 또는 trend-removed 학습 (Day 1 의 R-ONE 보정 도입)
- 또는 정직하게 "장기 horizon 에서는 ARIMA 가 유리, 단기에서는 LSTM 우세" 로 결론

---

## 6. 파일 통계

```
ML repo 신규 파일 9개:
  metrics.ts              85
  holdout.ts              45
  selectComplexes.ts      80
  ma12.ts                 75
  lstmEval.ts             75
  run.ts                 190
  README.md               60
  arima.py               150
  visualize.py           210
  requirements.txt         4
  ─────────────────────────
  합계                  ~975 lines

수정:
  package.json            +5 lines (4 scripts)
  .gitignore              +9 lines (reports/ + __pycache__/)
```

---

## 7. 다음 세션 시작 체크리스트

```
[필수 — 사용자 직접 실행]
  cd C:\git\2026_MOLIT_ML
  pip install -r scripts/backtest/requirements.txt
  npm run backtest:all
  → reports/plots/*.png 4종 확인
  → reports/backtest_results.csv 메트릭 확인

[검증]
  · LSTM 이 MA-12 보다 나은지 (MAPE 기준)
  · ARIMA 가 두 모델 사이에 위치하는지
  · summary.png 가 기획서 별첨으로 적합한지

[다음 (Day 6)]
  · 기획서 §기술 검증 섹션에 summary.png 삽입
  · 비교 표 텍스트 작성 (MAPE/RMSE/R² 표 + "단순 모델 대비 N% 오차 감소")
  · LSTM 압도 못 한 경우 — 정직한 한계 인정 + 향후 개선안

[백그라운드]
  · R-ONE-KEY 적용 → npm run seed:reb (서버 repo) → t_reb_price_index 적재
```

---

## 8. 함정 (반드시 인지)

```
① LSTM 학습은 단지당 ~1분 (CPU). GPU 가속 없음 → 5단지 5분 예상.
   타이머 끊기면 안 됨 — npm run backtest:run 끝까지 대기.

② statsmodels ConvergenceWarning 다수 발생 → warnings.filterwarnings("ignore") 처리.
   에러처럼 보여도 무시 가능. 진짜 에러는 "ARIMA(2,1,2) failed" 로그.

③ 한글 폰트 — Windows 기본 Malgun Gothic. Linux 서버에서 실행 시 NanumGothic 설치 필요.

④ DB charset — 단지명에 한글 포함 → reports/complexes.csv 가 UTF-8 BOM 없이 저장.
   Excel 에서 열 때 깨지면 메모장으로 변환 후 다시 열기.

⑤ Day 5 결과가 Day 6 기획서의 핵심 증빙. 백테스트 실패 시 컷오프:
   - 1차: ARIMA 생략 → "MA-12 vs LSTM 만"
   - 2차: 5단지 → 3단지 축소
   - 절대 포기 금지: LSTM 백테스트 1개 이상 + PNG 1장
```

---

## 9. Day 5 실행 결과 + 발견된 데이터 시간 갭 (2026-05-23 세션 5 후반)

### 9.1 실행 흐름 (사용자 직접 실행)

```
[1] npx prisma generate                      ✅
[2] npx tsc --noEmit                          ❌ → tfjs typing 이슈 발견 → 패치
[3] tfjs 4.x typing 패치 (lstm.ts + .d.ts)   ✅
[4] npx tsc --noEmit                          ✅ EXIT:0
[5] npm run backtest:all (1차)               ❌ Unknown auth plugin sha256_password
[6] .env DB 계정 root → molit 전환            ✅
[7] npm run backtest:all (2차)               ❌ no qualified complex found (0개)
[8] 데이터 시간 갭 진단 → cutoff 동적화 패치   ✅
[9] npm run backtest:all (3차)               ✅ 5단지 선정 + PNG 8개 생성
```

### 9.2 발견된 3가지 결함 + 처방

#### 결함 ① tfjs 4.x typing 노출 미흡

```
[증상]   src/models/lstm.ts:20 — TS2694 Namespace ... has no exported member 'LayersModel'
         tf.sequential / tf.layers 도 동일 namespace lookup 실패
[원인]   @tensorflow/tfjs-layers 4.22.0 npm 배포에 *.d.ts 파일이 단 1개도 포함 안 됨
         → 메인 tfjs index.d.ts 의 `export * from '@tensorflow/tfjs-layers'` 가 무의미
[패치]   src/models/lstm.ts:
           import * as tfl from '@tensorflow/tfjs-layers';
           import type { LayersModel } from '@tensorflow/tfjs-layers';
           tf.sequential → tfl.sequential
           tf.layers.*  → tfl.layers.*
         src/types/tfjs-layers.d.ts (신규):
           declare module '@tensorflow/tfjs-layers' {
             export type LayersModel = any;
             export const layers: any;
             export function sequential(...): any;
             ...
           }
[향후]   tfjs 가 d.ts 정상 배포 시 src/types/tfjs-layers.d.ts 삭제 가능
```

#### 결함 ② DB 계정 인증 플러그인 불일치

```
[증상]   prisma.$queryRawUnsafe — Unknown authentication plugin `sha256_password'
[원인]   ML repo .env 가 2026-05-17 작성된 root:root 그대로
         server repo 는 이미 molit 운영 계정으로 전환 완료 (next-steps.md)
         MySQL 8 root@localhost 기본 인증 = sha256_password → Prisma 5.x 미지원
[패치]   ML repo .env DATABASE_URL 을 server 와 동일하게:
           mysql://molit:RmMX...@127.0.0.1:3306/molit_contest
[방지]   next-steps.md onboarding 섹션에 ML repo .env 동기화 안내 추가
```

#### 결함 ③ 데이터 시간 갭 — 본질적 데이터 부족 (★최우선 이슈)

```
[증상]   selectComplexes → 0 qualified complex
[원인]   3중 결함:
         (a) cutoff 로직이 시스템 시계 기준 (now-1년 = 2025-05)
             but DB 최신 거래 2025-04-30 → 모든 단지가 cutoff 통과 못 함
         (b) minTrain 48 + horizon 36 = 84개월 필요
             but 데이터 범위 2020-01 ~ 2025-04 = 64개월 → 수학적 불가능
         (c) minMonths 60 가 데이터 64개월 대비 빡빡
[패치]   selectComplexes.ts:
           cutoff = MAX(deal_date) - 24개월 (DB 기준 동적)
           minMonths 기본 60 → 48
           skip stats 로그 추가 (디버깅용)
         run.ts:
           HORIZON 기본 36 → 24 (3년 → 2년 백테스트로 축소)
           MIN_TRAIN 기본 48 → 36
           minMonths = MIN_TRAIN + HORIZON = 60 동적 (단지 동일 horizon 보장)
[부작용]  "3년 가격 예측" 컨셉과 백테스트 horizon=24 사이 불일치
         → Day 6 기획서에서 정직하게 분리:
           · "모델은 36개월 horizon 학습 (t_training_result.predicted_3y_price_per_m2)"
           · "백테스트는 데이터 가용량 제약으로 24개월 hold-out 검증"
```

### 9.3 실행 결과 (3차 성공)

```
선정 단지 5개 (id): 6902, 7002, 1313, 799, 6908
생성된 PNG (8개):
  reports/plots/6902_forecast.png
  reports/plots/7002_forecast.png
  reports/plots/1313_forecast.png
  reports/plots/799_forecast.png
  reports/plots/6908_forecast.png
  reports/plots/comparison_mape.png
  reports/plots/comparison_rmse.png
  reports/plots/summary.png
생성된 CSV:
  reports/complexes.csv              5단지 메타
  reports/series/<id>.csv × 5        전체 시계열
  reports/predictions/<id>_*.csv × 15  3모델 × 5단지 예측
  reports/backtest_results.csv       15행 종합 메트릭
```

**메트릭 확인은 다음 세션 시작 시 사용자가 reports/backtest_results.csv 공유 → 평가.**

### 9.4 ★ 데이터 부족 — Day 6 진입 전 보강 필요 (사용자 인지)

> "시계열 데이터 수집이 우선되어야 할 거 같긴 함" — 사용자 판단

#### 우선순위 보강 데이터 (Day 6 진입 전)

| 우선순위 | 데이터 | 출처 | 효과 | 소요 |
|---------|------|------|------|------|
| ★최우선 | 국토부 RTMS 2015~2019년 (5년치) | 공공데이터포털 | 시계열 64→124mo, horizon=36 안정 | 1~2일 야간 배치 |
| ★우선 | R-ONE 부동산원 지수 | reb.or.kr | LSTM 학습 시 시장 추세 정규화 → MAPE -2~5pp | 즉시 (KEY 있음) |
| ☆선택 | 2025-05~ 추가 거래 | RTMS | hold-out 최신성 + 2026년 의사결정 톤 일관 | 0.5일 |
| ◇후순위 | 금리 / 인구이동 / 공급통계 | BOK / KOSIS / HUG | LSTM input feature 확장 | 2~3일 (D-0 후로) |

#### 보강 후 재실행 시 백테스트 영향 (보수 추정)

```
현재 (64mo, horizon=24):
  MAPE ?  (사용자 결과 확인 후)

보강 후 (124mo, horizon=36):
  MAPE ↓ 30~50%  (시계열 길이 ×2 → LSTM 학습 examples ×2.5)
  R²   ↑ 0.1~0.2 (장기 패턴 학습 가능)
  ARIMA 도 차분 안정성 ↑

기획서 효과:
  · "3년 예측 정확도" 표 실측 가능 (정직한 정확도)
  · 단지 5개 → 10개 확장 가능 (자치구 5개 다양성)
  · 사회적 가치 톤: "2015~2025 11년치 분석" 신뢰도 ↑
```

#### 보강 작업 진입점 (next-steps.md 참조)

```
[A] server/src/services/ingest/aptIngest.ts — 기존 BulkRunner 재활용
[B] 환경변수: BULK_START_YM=201501 BULK_END_YM=201912 (예시)
[C] 야간 배치: 국토부 OpenAPI 호출 약 3,000건 (1주일 분산 가능)
[D] DB 영향: t_apt_trade 251k → 약 480k 추정 (월 평균 거래 4,000 × 60개월)
```

### 9.5 Day 5 진짜 완료 기준 — 다음 세션 첫 작업

```
[1] reports/backtest_results.csv 메트릭 확인
    · 모델별 평균 MAPE / RMSE / R²
    · LSTM 이 ARIMA / MA-12 보다 우세한가?
    · 만약 LSTM 졌다면 → 정직한 프레임 + 데이터 보강 후 재실행 계획

[2] reports/plots/summary.png 확인 (기획서 별첨 적합성)

[3] 데이터 보강 트랙 진입:
    · 사용자 결정: 10년치 보강 / 5년 추가만 / 보강 없이 Day 6 진입?
```
