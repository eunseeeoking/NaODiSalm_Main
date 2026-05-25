# 점수 알고리즘 재설계 — 4축 재정의

> 2026-05-22, 컨셉 전환에 따른 scoring.ts / RegionRecommendation 영향 분석.

---

## 1. 4축 매핑 (Before → After)

```
Before                          After
─────────────────────────       ──────────────────────────
commute   (통근)        →       commute       (통근)            유지
value     (가성비)      →       affordability (주거비 부담)     의미 강화
investment(3년 수익률)  →       safety        (1인가구 안전)    완전 교체
life      (생활편의)    →       life          (생활편의)        유지

축 4개는 그대로, 의미만 2축이 바뀜.
UI 슬라이더는 색상/라벨만 교체하면 동일하게 동작.
```

---

## 2. 각 축 정규화 공식 (단순 선형 매핑 유지)

### 2.1 commute (통근) — 기존 유지

```
정책:   patience 분 기준 역선형. 0분 → 100점, patience 이상 → 0점
공식:   inverseLinear(commuteMinutes, 0, max(15, patience))

데이터:  t_commute_matrix (ODsay 실측) + Haversine 추정 fallback
보강:   Sprint C-1 + TAGO 배차/환승 보정 (Day 2)
```

### 2.2 affordability (주거비 부담) — 의미 강화

```
정책:   사용자 소득 분위 대비 RIR(Rent-to-Income Ratio) 역선형
         · RIR ≤ 20% → 100점 (매우 여유)
         · RIR = 30% → 50점
         · RIR ≥ 40% → 0점 (주거 빈곤선)

공식:   monthlyHousingCost = representativePrice * 환산률
                            (전세→월세 환산 가정 or 매매→월상환)
         monthlyIncome    = 사용자 입력 또는 분위별 평균
         rir              = monthlyHousingCost / monthlyIncome
         affordabilityScore = inverseLinear(rir, 0.20, 0.50)

데이터: t_apt_trade (현행) + 통계청 가계금융복지조사 (Day 3)
대체:  사용자 소득 미입력 시 분위별 평균 사용 + UI 에 "입력하면 더 정확" 표시
```

### 2.3 safety (1인가구 안전) — 신규

```
정책:   행정동 단위 안전 점수 0~100
        · 범죄주의구간 밀도 (역방향)
        · 가로등 / CCTV 밀도 (정방향)
        · 야간 통행량 데이터 (있을 경우)

공식:  safetyScore = 0.5 * crimeScore + 0.3 * lightScore + 0.2 * cctvScore
       각 sub-score 는 행정동 minmax 정규화

데이터: 경찰청 범죄주의구간 (시군구·동, Day 3)
        서울 열린데이터광장 가로등·CCTV
        없으면 시군구 단위 평균 fallback (정확도 ↓)

대체 (데이터 미확보): 시군구별 5단계 안전등급으로 단순화
```

### 2.4 life (생활편의) — 기존 유지 + Sprint D 보강 예정

```
정책:   행정동 내 POI(편의/문화/병원/마트/카페) 카운트 정규화
공식:   forwardLinear(poiCount, 0, 시군구 95퍼센타일)

데이터: 카카오 로컬 POI API (Sprint D)
현재:  더미 50 고정. 그대로 두되 청년 컨셉에서 의미는 동일
```

---

## 3. 가중합 + TOP K (변경 없음)

```
totalScore = (commuteScore * w.commute
           + affordabilityScore * w.affordability
           + safetyScore * w.safety
           + lifeScore * w.life) / Σw

분모 Σw 동적 → 사용자가 합 100 ± 10 입력 시도 자연스럽게 처리
pickTopRegions(candidates, weights, patience, k=8) 시그니처 그대로
```

---

## 4. WEIGHT_PRESETS 재정의

```ts
// types/recommendation.ts (제안)
export interface Weights {
  commute: number;
  affordability: number;   // ← (기존 value → 의미 강화)
  safety: number;          // ← (기존 investment → 완전 교체)
  life: number;
}

export const WEIGHT_PRESETS = {
  young:    { commute: 35, affordability: 30, safety: 20, life: 15 },  // 사회초년생형
  newlywed: { commute: 30, affordability: 25, safety: 15, life: 30 },  // 신혼부부형
  resident: { commute: 25, affordability: 30, safety: 20, life: 25 },  // 실거주형 (유지)
  worker:   { commute: 35, affordability: 20, safety: 15, life: 30 },  // 직장인형 (유지, 4번째)
} as const satisfies Record<string, Weights>;
```

투자자형 `investor` 는 명시적 폐기. 마이그레이션 노트:
- URL `?pre=investor` 가 들어와도 무시 (`parsePreset` 에서 null 반환)
- 기존 URL 공유로 들어온 사용자는 자동으로 기본값(young) 적용

---

## 5. RegionRecommendation 필드 변화

```ts
// types/recommendation.ts
export interface RegionRecommendation {
  // 기존 그대로
  legalDongCode, displayName, sigunguCode, sigungu, dong, lat, lng,
  totalScore,
  commuteScore,
  lifeScore,
  commuteMinutes,
  representativePrice,

  // 의미 교체 (필드명 변경)
  affordabilityScore;   // ← valueScore
  safetyScore;          // ← investmentScore

  // 폐기 (또는 부가 정보로 유지)
  expectedReturn3y;     // ← Depth 3 부가 표시 (Q4 사용자 결정 따라)

  // 신규 (청년 타겟)
  rir?: number;          // 소득 대비 주거비 부담률 (사용자 소득 입력 시)
  lhComplexNearby?: number; // 주변 LH 청년주택 개수
}
```

---

## 6. scoring.ts 함수 시그니처 변화

```ts
// 신규
export function affordabilityScore(rir: number): number {
  return inverseLinear(rir, 0.20, 0.50);
}

export function safetyScore(rawSafety: number): number {
  // rawSafety 는 0~100 으로 이미 정규화된 값 (repository 책임)
  return Math.min(100, Math.max(0, Math.round(rawSafety)));
}

// 변경
export function scoreRegion(
  metrics: RegionMetrics,
  weights: Weights,
  patience: number,
  income?: number,           // 사용자 소득 (선택)
): ScoredRegion {
  const cs = commuteScore(metrics.commuteMinutes, patience);
  const as_ = affordabilityScore(rirOf(metrics, income));
  const ss = safetyScore(metrics.safetyBase);
  const ls = lifeScore(metrics.lifeScoreBase);
  // ... 동일한 가중합
}
```

`rirOf(metrics, income)`:
- 사용자 소득 입력 있으면 그대로 사용
- 없으면 통계청 분위별 평균 (Day 3 시드 데이터)

---

## 7. repository 측 변화

```
fetchRegionCandidates 의 SQL 조인 추가:
  · t_lh_youth_housing (LH 청년주택 행정동별 공급 카운트)
  · t_safety_index (경찰청·서울 데이터 합성 안전 점수)
  · t_reb_price_index (한국부동산원 시장 추세 — LSTM 정규화에 사용)

응답 RegionMetrics 에 추가:
  · rir (사용자 소득 받아서 계산)
  · safetyBase (0~100)
  · lhComplexNearby (개수)
```

---

## 8. UI 영향

```
WeightSliders.tsx
  · ROWS 라벨: [통근, 가성비, 투자, 생활] → [통근, 부담, 안전, 생활]
  · PRESETS:   [직장인, 투자자, 실거주] → [사회초년생, 신혼부부, 실거주, 직장인]
  · 합 표시 / 90~110 가드는 그대로 (기존 Sprint B 산출물 재사용)

RegionCard.tsx
  · METRIC_BARS 라벨: [통근, 가성비, 투자, 생활] → [통근, 부담, 안전, 생활]
  · 1위 카드의 "수익률 +X.X%" 부분 → "주거비 N%" 또는 "주변 청년주택 N개"

RegionDetailHeader.tsx
  · 4축 점수 라벨 동일하게 교체

LstmFullAnalysis.tsx
  · 카드 타이틀: "LSTM 시계열 예측" → "LSTM 가격 안정성 분석"
  · "3년 누적 수익률" 카드 → "변동성 지표" 또는 카드 제거
  · 신뢰도 도넛 유지
```

---

## 9. 데이터 모델 추가 (Prisma schema 보강)

```prisma
/// 한국부동산원 공동주택 실거래지수 (시군구·월 단위)
/// LSTM 학습 시 시장 추세 정규화에 사용
model RebPriceIndex {
  id           Int      @id @default(autoincrement())
  sigunguCode  String   @map("sigungu_code") @db.VarChar(5)
  ym           String   @db.VarChar(7)   /// "2025-04" 형식
  indexValue   Float    @map("index_value")  /// 100 기준 상대값
  createdAt    DateTime @default(now()) @map("created_at")
  @@unique([sigunguCode, ym], map: "uniq_reb_idx")
  @@map("t_reb_price_index")
}

/// LH 청년주택 공급 (행정동 단위 집계)
model LhYouthHousing {
  id              Int      @id @default(autoincrement())
  legalDongCode   String   @map("legal_dong_code") @db.VarChar(10)
  programType     String   @map("program_type") @db.VarChar(40) /// "행복주택"/"청년매입임대"/"전세임대"
  unitsAvailable  Int      @map("units_available")
  monthlyRentMin  Int?     @map("monthly_rent_min")  /// 월세 최저 (만원)
  monthlyRentMax  Int?     @map("monthly_rent_max")
  updatedAt       DateTime @updatedAt @map("updated_at")
  @@index([legalDongCode])
  @@map("t_lh_youth_housing")
}

/// 행정동 안전 지표 (합성, Day 3 시드)
model SafetyIndex {
  legalDongCode  String   @id @map("legal_dong_code") @db.VarChar(10)
  crimeScore     Float    @map("crime_score")    /// 0~100, 높을수록 안전
  lightScore     Float    @map("light_score")    /// 가로등 밀도
  cctvScore      Float    @map("cctv_score")     /// CCTV 밀도
  totalScore     Float    @map("total_score")    /// 합성 점수
  updatedAt      DateTime @updatedAt @map("updated_at")
  @@map("t_safety_index")
}

/// 통계청 가계금융복지조사 — 소득 분위별 평균 (시드 1회)
model IncomeQuintile {
  quintile     Int      @id  /// 1~5
  avgIncome    Int      @map("avg_income")   /// 월 만원
  description  String?
  @@map("t_income_quintile")
}
```

---

## 10. 마이그레이션 순서

```
Step 1.  types/recommendation.ts 필드 rename + WEIGHT_PRESETS 재정의
Step 2.  scoring.ts 점수 함수 시그니처 변경 (4축 의미 교체)
Step 3.  recommendationRepository.ts fetch 함수 보강 (LH/safety/RIR)
Step 4.  routes/domains/recommendations.ts validateBody + 응답 매핑
Step 5.  UI 컴포넌트 라벨/프리셋 일괄 교체
Step 6.  urlState.ts 의 preset 검증에서 investor 폐기
Step 7.  DB 마이그레이션 (3개 신규 테이블)
Step 8.  데이터 수집 잡 (R-ONE, LH, 안전, 분위) — 각 Day 1~3
```

코드 변경 자체는 ~6시간. 데이터 수집 + 시드가 메인 작업.

---

## 11. 검증 체크포인트

```
[ ] 추천 API 응답이 청년 타겟 카드 8건 정상
[ ] 사회초년생 프리셋 적용 시 affordability 가중치 30 반영
[ ] 안전 점수가 행정동별로 합리적 분포 (강북·강남 등 차이)
[ ] LH 청년주택 카운트가 매물 카드에 노출
[ ] LSTM 비교 결과 표가 기획서에 들어갈 형태로 출력
```
