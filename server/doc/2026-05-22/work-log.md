# 작업 로그 — 2026-05-22

## 한 줄 요약

> **D-7 시점 컨셉 전면 전환 결정.** "직장인 + 투자 수익률" → "청년·신혼부부 주거 안전망".
> 평가 항목 점수 영향 추정 +25, 입상 가능성 50% → 80~90% (보수 추정).
> 7일 / 70시간 로드맵 확정. Day 1 = 한국부동산원 R-ONE 융합부터.

---

## 0. 컨셉 전환 배경 (요약)

```
[1] 공공데이터 공모전 취지 (사회적 가치) 와 "투자 수익률 어필" 의 거리
[2] 2024년 대상작 "바로" 가 부동산+AI 카테고리 천장 점유 — 유사 컨셉 위험
[3] 청년 주거 빈곤 / 1인가구 안전 / 정보 격차 해소는 정책 명분 직접 부합
[4] 가점 5점 (주관기관 데이터 융합) 확보가 입상권 진입 결정

상세: server/doc/2026-05-22/pivot-rationale.md
```

---

## 1. 오늘 작업 (D-7 새벽 기준, 아직 시작 전)

### 1.1 직전 완료 — Sprint B 후속 마무리
```
client/src/pages/Recommendation/components/WeightSliders.tsx
  · 가중치 합 표시 + 90~110 밖일 때 인라인 negative 경고
  · 합 색상 (정상=ink-tertiary / 비정상=negative) 시각 분리
  · WEIGHTS_SUM_MIN/MAX 상수 + isWeightsValid() 헬퍼 export

client/src/pages/Recommendation/index.tsx
  · useEffect 에서 isWeightsValid(weights) 가드 → fetchRecommendations 호출 차단
  · 가드 시 이전 결과 유지 (사용자 슬라이더 조작 중 카드 사라짐 방지)

→ 가중치 합 110 초과 시 server 400 → mock 폴백 → DEMO 뱃지 점등의
  어색한 흐름이 사라짐. 사용자가 슬라이더 조작해도 합 잘못되면 갱신 중단 + 인라인 안내.
```

### 1.2 22일자 doc 4개 작성

```
server/doc/2026-05-22/
  ├─ pivot-rationale.md       컨셉 전환 사유 / 평가 영향 / 5개 결정사항
  ├─ 7day-roadmap.md          70h 일자별 작업 박스 + 컷오프 우선순위
  ├─ scoring-redesign.md      4축 재정의 / WEIGHT_PRESETS 교체 / 마이그레이션
  ├─ data-sources.md          4개 기관 융합 명세 + 적재 잡 + 기획서 활용 표
  └─ work-log.md              (현재 파일)
```

---

## 2. 새 4축 (제안)

```
Before                          After (제안)
────────────────────────       ──────────────────────────
commute   (통근)        →       commute       (통근)            유지
value     (가성비)      →       affordability (주거비 부담)     의미 강화
investment(3년 수익률)  →       safety        (1인가구 안전)    완전 교체
life      (생활편의)    →       life          (생활편의)        유지
```

상세 정규화 공식 / RIR 산출 / 안전 점수 합성 → `scoring-redesign.md`

---

## 3. 7일 일정 (확정, 사용자 결정 받은 뒤 Day 1 진입)

```
DAY 1 (10h)  한국부동산원 R-ONE 융합 ★ 가점 +5 결정
DAY 2 (10h)  TAGO 대중교통 + LH 청년주택 진입
DAY 3 (12h)  소득 분위 + 안전 점수 + 청년 알고리즘
DAY 4 (12h)  UI 컨셉 전환 (라벨/프리셋/필터)
DAY 5 (12h)  LSTM 비교 검증 (MA-12 / ARIMA / LSTM) — 구체성 결정타
DAY 6 (14h)  기획서 전면 재작성 + 베타 응답 집계
DAY 7 (12h)  GitHub 정비 + 증빙 패키지 + 최종 검수 + 제출
            합계 82h, 안전 마진 12h
```

상세 → `7day-roadmap.md`

---

## 4. 평가 영향 요약 (보수 추정)

```
                Before        After      Δ
독창성  /30     14~17        20~24      +6~7
구체성  /30     22~25        26~29      +4
성장성  /40     18~23        28~34      +10~11
가점    /15     +10          +15        +5
─────────────────────────────────────────
합계   /115    64~75        89~102     +25

입상 가능성    ~50%         80~90%
대상 가능성    3~7%         15~22%
우수상         15~25%       40~50%
```

---

## 5. 기존 자산 처리

```
폐기 (의미만)
  · WEIGHT_PRESETS.investor             "투자자형" 프리셋 제거
  · weights.investment 의미              "3년 수익률" → "안전" 으로 교체
  · LSTM 풀카드의 "수익률" 직설 표현      "가격 안정성" 으로 재정의

흡수 (코드는 그대로, 의미만 교체)
  · scoring.ts 4축 골격
  · recommendationRepository
  · WEIGHT_PRESETS.worker/resident
  · URL state 직렬화

유지 (100%)
  · Sprint A URL 공유 / Sprint B mock 폴백 / Sprint C-1 추천 API
  · BJD 시드 + 행정동 마스터 (99.13% 매칭)
  · ODsay 매트릭스 + KNN 캐시 / 행정동 히트맵
  · 토스 한국형 디자인 톤
  · "나어디삶" 브랜드 (1인칭 정체성 정합)
```

---

## 6. 즉시 처리 — 30분 이내 (사용자 액션)

승인 대기 때문에 Day 1 오전이 통째로 날아갈 수 있음.
다른 작업 시작 전 처리.

```
[1] 한국부동산원 R-ONE API 신청 (승인 1~2일)
    https://www.reb.or.kr/r-one

[2] 공공데이터포털 TAGO API 신청 (자동 승인이지만 지금 처리)
    https://www.data.go.kr  →  "국가대중교통정보센터 TAGO"

[3] LH 청년주택 API 신청 (자동 승인)
    https://www.data.go.kr  →  "한국토지주택공사 행복주택"

[4] 베타 테스터 모집 게시글 초안 작성
    부동산스터디 / 클리앙 등 — Day 1 아침 업로드용
```

---

## 7. 5개 의사결정 (사용자 확인 필요 → Day 1 진입 전)

상세는 `pivot-rationale.md §5` 참고. 요약:

```
[Q1] 4축 재정의   "통근/부담/안전/생활" — OK?
[Q2] 프리셋 4종   "사회초년생/신혼부부/실거주/직장인" — OK?
[Q3] 부제         "데이터 기반 청년 주거 의사결정 도구" — OK?
[Q4] LSTM 노출    "투자" 직설 표현 처리 방식 (제거 / 안정성 재정의 / Depth 3 부가)
[Q5] 데이터 우선  R-ONE > LH > 안전 > TAGO 순으로 진행 — OK?
```

---

## 8. 5월 21일 → 22일 연결 메모

```
21일 마지막 한 줄 (next-steps.md):
  "cd server && npm run seed:bjd 한 줄 실행 → 매칭률 95%↑ + DEMO 뱃지 소거 확인 → Sprint C-2"

22일 변경:
  · 시드는 완료 (매칭률 99.13% 확인)
  · DEMO 뱃지 확인은 아직 (사용자가 청년 컨셉 진입 우선시)
  · Sprint C-2 (매물/LSTM API mock 대체) 는 **순서 변경**
      → Day 1~2 의 R-ONE/TAGO/LH 데이터 융합이 먼저
      → Sprint C-2 자체는 청년 컨셉으로 흡수되며 자연스럽게 진행
        (RegionDetail mock 은 마지막에 청년 라벨로 교체)
```

---

## 9. 22일자 파일 통계

```
client/src/pages/Recommendation/components/WeightSliders.tsx        +50 lines
client/src/pages/Recommendation/index.tsx                            +7 lines
server/doc/2026-05-22/pivot-rationale.md                            174 lines (신규)
server/doc/2026-05-22/7day-roadmap.md                               198 lines (신규)
server/doc/2026-05-22/scoring-redesign.md                           215 lines (신규)
server/doc/2026-05-22/data-sources.md                               228 lines (신규)
server/doc/2026-05-22/work-log.md                                   (현재 파일)
────────────────────────────────────────────────────────────────
22일자 신규/수정 합계                                              ~870 lines
```

---

## 10. Day 1 실행 결과 (2026-05-22 세션 완료)

### 10.1 완료 항목

```
[✅] 5개 의사결정 확인 (Q1~Q5)
     Q1: 4축 "통근/부담/안전/생활" OK
     Q2: 프리셋 4종 "사회초년생/신혼부부/실거주/직장인" OK
     Q3: 부제 "데이터 기반 청년 주거 의사결정 도구" OK
     Q4: LSTM = B안 (가격 안정성 지표로 재정의, Depth 3 유지)
     Q5: 데이터 우선순위 R-ONE > LH > 안전 > TAGO OK

[✅] 타입/인터페이스 rename (client + server)
     Weights: value→affordability, investment→safety
     WEIGHT_PRESETS: young/newlywed/resident/worker (investor 제거)
     RegionRecommendation: affordabilityScore, safetyScore 필드 교체

[✅] scoring.ts 점수 함수 교체
     affordabilityScore: inverseLinear(price, 10000, 200000) proxy
     safetyScore: rawSafety 0~100 클램핑
     weights.affordability / weights.safety 반영

[✅] recommendationRepository 업데이트
     safetyBase: 50 (Day 3까지 임시)
     batchAdjustReturns() 연동 (R-ONE fallback 자동 처리)

[✅] routes/recommendations.ts 응답 매핑 업데이트

[✅] UI 컨셉 전환 (4개 컴포넌트)
     WeightSliders: 4축 라벨 + 프리셋 4종
     RegionCard: affordabilityScore/safetyScore 메트릭 바
     RegionDetailHeader: 축 매핑
     mockRegions.ts: 8개 지역 필드 교체

[✅] Prisma 스키마 — 4개 신규 테이블
     t_reb_price_index   (@@unique name: "sigunguCode_ym")
     t_lh_youth_housing
     t_safety_index
     t_income_quintile

[✅] server/src/services/external/rebClient.ts (신규)
     REB_TABLE_IDS: TRADE_INDEX=DT_200001, RENT_INDEX=DT_200002
     fetchRebPriceIndex() / fetchSingleIndex()

[✅] server/scripts/seedRebPriceIndex.ts (신규)
     CLI: --start=YYYYMM --end=YYYYMM --includeRent
     서울 25개 시군구, 배치 upsert 100건

[✅] server/src/services/recommendation/rebNormalize.ts (신규)
     normalizePrice / denormalizePrice / adjustReturnByIndex / batchAdjustReturns

[✅] package.json: "seed:reb" 스크립트 추가

[✅] TypeScript typecheck: server EXIT:0, client EXIT:0

[✅] Prisma DB 적용: npx prisma db push → "already in sync" (테이블 이미 존재)
     (shadow DB 권한 이슈로 migrate dev 대신 db push 사용)
```

### 10.2 미완료 (다음 세션으로)

```
[ ] seed:reb 실행 (R-ONE-KEY 발급 후)
    npm run seed:reb
    → t_reb_price_index 36개월치 적재

[ ] Day 2: TAGO 대중교통 API 클라이언트
[ ] Day 2: LH 청년주택 데이터 수집 모듈
[ ] Day 3: 소득 분위 RIR + 안전 점수 실데이터 교체
[ ] Day 5: LSTM 비교 검증 (MA-12 / ARIMA)
[ ] Day 6: 기획서 전면 재작성
[ ] Day 7: 제출 패키지
```

### 10.3 다음 세션 첫 한 줄

> **"Day 2 시작 — TAGO 대중교통 API 클라이언트 구현. `server/src/services/external/tagoClient.ts` 생성 → 행정동 중심좌표 기준 버스정류장/지하철역 접근성 점수 산출."**
