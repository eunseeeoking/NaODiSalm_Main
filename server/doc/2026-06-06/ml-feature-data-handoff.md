# ML 피처 데이터 수집 핸드오프 (2026-06-06)

> **이 문서만 보고** 다른 세션이 ① 왜 이 데이터가 필요한지 이해하고 ② 무엇을 어디서 수집해 ③ 어떤 테이블 형태로 DB에 넣을지 자력으로 수행할 수 있도록 작성됨.
> 작업 레포: **`NaODiSalm_Main`** (이 레포). 데이터 소비처: **`NaODiSalm_ML`** (별도 레포, `C:\git\NaODiSalm_ML`).

---

## 0. 한 줄 목적

LSTM 가격예측 모델에게 **학계 표준 피처(거시·구조·입지)를 먹일 수 있도록**, 현재 DB에 없는 시계열 공변량과 정적 피처를 수집해 적재한다. ML 세션이 이걸 multivariate + pooled 패널로 학습해 **"제대로 먹인 학습기가 단순 추세추종(~8% MAPE) 천장을 깨는가"**를 검증할 예정.

---

## 1. 배경 — 왜 이 데이터가 필요한가 (안 읽으면 헛수집함)

ML 레포에서 2×2 통제실험으로 규명한 사실:

- **LSTM이 ARIMA에 진 건 모델이 약해서가 아니다.** 같은 데이터에서 표현(가격레벨→로그수익률) + 구조(recursive→direct)만 고치니 LSTM이 20.6% → **9.6%**로 ARIMA(7.7%)와 같은 리그 진입.
- **그런데 ARIMA가 "이긴" 것도 착시다.** 가장 멍청한 베이스라인 MA-12(12개월 이동평균+직선)가 **8.2%**로 ARIMA(7.7%)와 통계적 동률. 즉 **이 데이터에선 "추세를 직선으로 긋기"가 거의 최적**이고, 측정된 천장이 ~8%일 뿐이다.
- **근본 원인: 학습환경 빈곤.** 현재 LSTM 입력은 **단지별 월별 m²단가 한 줄(univariate)**. 학계 표준 부동산 ML 피처 5종(구조·입지·사회경제·거시·시각) 중 **사실상 0개**를 받는다. Makridakis(2018, PLOS ONE)·"Size Matters"(2019)가 규명했듯 **단변량 시계열 + 단일 series 학습은 ML이 통계모델에 지는 게 당연한 setup**이다.

> 즉 데이터 값이 *틀린* 게 아니라 **정보가 빈곤**하다. 이 핸드오프의 목적은 그 빈곤을 메우는 것.
> 상세 근거: ML 레포 `README.md` 의 "실험 — LSTM은 왜 졌나" 섹션 + Sources.

**다음 실험(ML 세션이 할 것):** 입력을 `[window × 1]` → `[window × F]` 다변량으로 확장 + 단지별→전국 pooled 패널 학습. 공변량은 **예측 원점 이전(입력 윈도우)에만** 들어가 누수 없음(direct multi-horizon). 그래서 아래 수집물은 **월별(`ym`) + 지역키**만 맞으면 그대로 join된다.

---

## 2. 이미 DB에 있음 — ⚠️ 재수집 금지 (ML이 배선만 함)

| 신호 | 테이블 | 비고 |
|---|---|---|
| 부동산원 R-ONE 지수 | `t_reb_price_index` (sigungu·ym·indexValue) | **현재 서울 25구만.** 거시 공변량으로 재사용 |
| 층(floor) | `t_apt_trade.floor` (Int?) | 이미 적재됨. ML이 select만 추가 |
| 거래량 | `t_apt_trade` count 파생 | **수집 불필요** — ML이 월별 카운트로 파생 |
| 이웃단지 가격(공간 lag) | `t_apt_trade` + 좌표 파생 | **수집 불필요** — 좌표만 있으면 ML이 파생 |
| 안전·POI·정류소·소득 | `t_safety_index` / `t_poi_summary` / `t_transit_route_summary` / `t_income_quintile` | 정적 입지 피처, 이미 있음 |
| 단지 좌표 | `t_apt_complex.lat/lng` | **일부 NULL일 수 있음** → §4-C 확인 작업 참조 |

> 지하철: `npm run seed:subway-graph`(`t_*` subway 그래프)이 **이미 존재**. 역 좌표가 거기 있으면 §3-T3 재수집 불필요 — 먼저 확인할 것.

---

## 3. 수집 대상 (우선순위)

### 🔴 Tier 1 — 시계열 거시 (최우선, 가장 큰 공백)

#### T1-a. 금리 (한국은행 ECOS) ⭐⭐⭐
- **출처:** 한국은행 ECOS OpenAPI — https://ecos.bok.or.kr → OpenAPI (무료 키)
- **수집 통계표:** ① "한국은행 기준금리" ② "예금은행 가중평균금리 — 신규취급액 기준 **주택담보대출**"
  - 통계표 코드는 ECOS 포털에서 검색해 확정 (REB의 `STATBL_ID` 찾던 방식과 동일).
- **주기/범위:** 월별, 2015-01 ~ 현재 (실거래 데이터 범위와 맞춤). 전국 단일 series.
- **타깃 테이블 (제안):**
  ```prisma
  /// 거시 금융지표 (월별, 전국 단일) — ECOS
  model MacroRate {
    ym           String   @id @db.VarChar(7)        /// "2025-04"
    baseRate     Float?   @map("base_rate")         /// 한국은행 기준금리 (%)
    mortgageRate Float?   @map("mortgage_rate")      /// 주담대 가중평균금리 (%, 신규취급액)
    createdAt    DateTime @default(now()) @map("created_at")
    @@map("t_macro_rate")
  }
  ```

#### T1-b. 주택 공급·미분양 (KOSIS / 부동산원)
- **출처:** KOSIS(통계청) 또는 국토부 통계누리 — "미분양주택현황", "주택건설 인허가/착공/준공실적". 부동산원 청약홈 입주물량도 가능.
- **주기/범위:** 월별, 시군구별(최소 시도별). 공급은 가격을 *선행*하는 핵심 신호.
- **타깃 테이블 (제안):**
  ```prisma
  /// 주택 공급/미분양 (시군구·월별) — KOSIS/부동산원
  model HousingSupply {
    id          Int      @id @default(autoincrement())
    sigunguCode String   @map("sigungu_code") @db.VarChar(5)
    ym          String   @db.VarChar(7)
    unsold      Int?     /// 미분양 호수
    moveInUnits Int?     @map("move_in_units")       /// 입주(준공) 물량 호수
    permitUnits Int?     @map("permit_units")        /// 인허가 호수 (선택)
    createdAt   DateTime @default(now()) @map("created_at")
    @@unique([sigunguCode, ym], map: "uniq_housing_supply")
    @@map("t_housing_supply")
  }
  ```

### 🟡 Tier 2 — 거시 맥락 (여력 되면)

#### T2. CPI · M2 · 가계대출 (ECOS)
- **출처:** ECOS 같은 키로 "소비자물가지수", "M2(광의통화)", "가계신용/가계대출 잔액".
- **타깃 테이블 (제안):**
  ```prisma
  /// 거시 경제지표 (월별, 전국 단일) — ECOS
  model MacroEcon {
    ym            String   @id @db.VarChar(7)
    cpi           Float?   /// 소비자물가지수 (2020=100)
    m2            Float?   /// M2 통화량 (조원)
    householdLoan Float?   @map("household_loan")    /// 가계대출 잔액 (조원)
    createdAt     DateTime @default(now()) @map("created_at")
    @@map("t_macro_econ")
  }
  ```

### 🔵 Tier 3 — 정적 입지 피처 (패널 static features)

#### T3-a. 지하철역 좌표 → 역세권 거리
- ⚠️ **먼저 `seed:subway-graph` 산출물에 역 좌표가 있는지 확인.** 있으면 스킵.
- 없으면 **출처:** 공공데이터포털 "서울교통공사 역사 좌표" / 국가철도공단.
- **타깃 (제안):** `t_subway_station(id, name, line, lat, lng)`.

#### T3-b. 학교 좌표 → 학군 점수
- **출처:** 교육부 학교알리미 / 공공데이터포털 "전국초중등학교위치표준데이터".
- **타깃 (제안):** `t_school(id, name, level["초|중|고"], lat, lng)`.

> T3는 거리 계산을 ML이 단지 좌표와 함께 파생함 — **좌표만 정확히 적재**하면 됨(점수화는 ML 몫).

---

## 4. 적재 방법 — 기존 패턴 그대로

### A. 따라야 할 템플릿 (복붙 시작점)
- **시계열 거시(T1·T2):** `server/scripts/seedRebPriceIndex.ts` + `server/src/services/external/rebClient.ts`
  - 외부 API 클라이언트는 `server/src/services/external/xxxClient.ts`, 시드는 `server/scripts/seedXxx.ts`, `server/package.json` 에 `"seed:xxx": "tsx scripts/seedXxx.ts"` 등록.
  - upsert는 **순차 배치**(Promise.all 금지 — 커넥션 포화). seedReb의 `upsertRows` 참고.
  - API 키는 `server/.env` 에 추가 (예: `ECOS_API_KEY=...`). 깃 커밋 금지.
- **정적 좌표(T3):** `server/scripts/seedTransitSummary.ts` / `seedPoiSummary.ts` 패턴 참고.

### B. 명명 규칙 (schema.prisma 헤더 규약 — 반드시 준수)
- 테이블 `t_{name}`, Prisma model 은 camelCase + `@@map("t_name")`.
- 컬럼 snake_case 는 `@map("snake_case")`.
- **월 키는 `ym String @db.VarChar(7)`, 형식 `"YYYY-MM"`** (REB와 동일 — ML join 키).
- 지역 키는 **`sigunguCode @db.VarChar(5)`** (예: "11680"). 기존 `t_apt_complex.sigunguCode` 와 일치해야 join 됨.
- 멱등성: `@@unique` 로 재실행 시 중복 방지 (REB는 `[sigunguCode, ym]`).

### C. 단지 좌표 커버리지 확인 (공간 피처 전제조건)
```sql
SELECT COUNT(*) total, SUM(lat IS NULL) missing FROM t_apt_complex;
```
- NULL 비율이 높으면 `server/src/services/external/geocoder.ts`(Kakao Local, LH 시드가 이미 사용)로 미지오코딩 단지 보강. 공간 lag·역세권·학군 피처가 전부 좌표에 의존.

---

## 5. ML 데이터 계약 (이걸 지키면 ML이 바로 읽음)

ML은 `(complex_id, ym)` 월별 패널로 left join 한다:
- 전국 단일(금리·CPI 등) → `ym` 으로 broadcast join.
- 시군구별(공급·REB) → `t_apt_complex.sigungu_code` + `ym` 으로 join.
- 정적 좌표(역·학교) → 단지 좌표와 Haversine 거리로 파생.

**누수 주의:** 공변량은 ML이 입력 윈도우(예측 원점 이전)에만 쓴다. 수집 쪽은 **시점 정확성만** 지키면 됨 — 즉 각 `ym` 값은 *그 달에 실제로 공표된* 값이어야 함(미래 수정치 backfill로 과거를 덮어쓰지 말 것. 가능하면 발표 시차 그대로).

---

## 6. 완료 기준 (체크리스트)

- [ ] **T1-a 금리**: `t_macro_rate` 에 2015-01~현재 월별 row, `base_rate`·`mortgage_rate` non-null
- [ ] **T1-b 공급**: `t_housing_supply` 에 시군구×월 row (최소 서울 25구)
- [ ] (선택) **T2**: `t_macro_econ` CPI·M2
- [ ] (선택) **T3**: `t_subway_station` / `t_school` 좌표 (또는 subway-graph 재활용 확인)
- [ ] **단지 좌표**: `t_apt_complex.lat/lng` NULL 비율 확인·보강
- [ ] `npm run seed:<name>` 스크립트로 **재실행 멱등** 동작 확인
- [ ] 각 테이블 `GROUP BY ym` 으로 기간·결측 점검

---

## 7. 끝나면 ML 세션에 넘길 것 (복귀 보고)

ML 스캐폴딩이 실제 컬럼명에 고정될 수 있도록 아래만 알려주면 됨:

1. **확정된 테이블명·컬럼명** (위 제안과 다르게 바꿨다면 그 최종형)
2. **커버리지**: 각 테이블 `MIN(ym)~MAX(ym)`, 지역 범위(서울만? 전국?), 결측 구간
3. **단위**: 금리 %인지 소수인지, M2 조원인지 등
4. **REB 확장 여부**: 실험을 서울 밖으로 넓혔다면 `t_reb_price_index` 도 해당 시군구 적재했는지

> 그러면 ML 세션이 `buildFeaturePanel()` + multivariate-direct LSTM(`BACKTEST_MULTIVAR=1` / `BACKTEST_POOLED=1`)을 그 스키마에 맞춰 구현해 "추세 천장 돌파" 실험을 돌린다.

---

## 참고 문헌 (배경 근거)
- Makridakis et al. (2018), "Statistical and ML Forecasting Methods: Concerns and Ways Forward", PLOS ONE — 단변량에서 ML이 통계모델에 압도당함
- Cerqueira et al. (2019), "ML vs Statistical Methods: Size Matters", arXiv:1909.13316 — cross-learning(pooling) 있어야 ML이 이김
- 부동산 ML 표준 피처: hedonic+XGBoost(구조·입지), 국내 KCI 연구(전용면적·층·건축연도·금리·지하철·학군)
