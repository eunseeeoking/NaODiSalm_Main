# 데이터 융합 4개 기관 — 명세 + 적재 계획

> 2026-05-22, Day 1~3 작업 대상 데이터셋의 출처·형식·적재 전략.

---

## 1. 기관별 데이터 매트릭스

| # | 기관 | 데이터 | 형식 | 갱신 | 가점 | 적재 시점 |
|---|---|---|---|---|---|---|
| 1 | 국토교통부 (기 보유) | 아파트 실거래가 / 전월세 | XML | 월 | — | 완료 |
| 2 | 한국부동산원 | 공동주택 실거래지수 / 전월세지수 | API | 월 | **+5 융합** | Day 1 |
| 3 | 국토교통부 (신규) | TAGO 대중교통 (배차/환승/첫막차) | API | 실시간 | 활용 | Day 2 |
| 4 | LH 한국토지주택공사 | 청년주택 공급 (행복주택·매입임대·전세임대) | API | 월 | — | Day 2~3 |
| 5 | 통계청 | 가계금융복지조사 (분위별 소득) | 파일 | 연 | — | Day 3 |
| 6 | 경찰청 + 서울 열린데이터광장 | 범죄주의구간 + 가로등·CCTV | 파일·API | 분기 | — | Day 3 |

★ 가점은 "주관기관(국토부) + 한국부동산원 융합" 으로 확보 — #2가 핵심.

---

## 2. 한국부동산원 R-ONE (Day 1)

### 2.1 신청 절차

```
URL:    https://www.reb.or.kr/r-one
경로:   "OpenAPI 신청" → 회원가입 → 인증키 발급
승인:   1~2 영업일
주의:   요청량 제한 있음 (일 1만건 정도)
```

### 2.2 활용 데이터

```
공동주택실거래가격지수
  · 시군구 단위 월별 지수 (기준 100)
  · 2010-01 ~ 현재까지 약 200개월
  · LSTM 학습 정규화 입력

전월세 지수 (보조)
  · 청년 affordability 축 보강에 활용
  · monthly_rent 환산 시 시군구별 임대 시세 추적
```

### 2.3 적재 명세

```sql
CREATE TABLE t_reb_price_index (
  id            INT PRIMARY KEY AUTO_INCREMENT,
  sigungu_code  VARCHAR(5),
  ym            VARCHAR(7),     -- "2025-04"
  index_value   FLOAT,          -- 100 기준 상대값
  created_at    DATETIME,
  UNIQUE KEY uniq_reb_idx (sigungu_code, ym)
);
```

### 2.4 LSTM 정규화 효과

```
기존 학습 입력:    실거래가 시퀀스 (강남구 평당 5000~7000만원 변동)
정규화 입력:       실거래가 / R-ONE 지수 = 시장 추세 제거된 잔차
                  → 모델이 "시장 전체 흐름" 이 아닌 "동 단위 고유 변동" 학습
복원 시:           예측 잔차 × 예측 지수 = 미래 실가격

기대 효과:
  · MAPE 9.2% → 7~8% (시장 노이즈 제거)
  · 기획서에 "정규화 보정 LSTM" 으로 차별화 표현 가능
```

---

## 3. TAGO 대중교통 (Day 2)

### 3.1 신청 절차

```
URL:    https://www.data.go.kr
검색:   "국가대중교통정보센터 TAGO"
승인:   자동 (즉시)
경로:   "활용신청" → 일반 인증키 (트래픽 무제한)
```

### 3.2 활용 엔드포인트

```
1) 정류장 정보  /BusSttnInfoInqireService/getSttnNoList
2) 노선 정보   /BusRouteInfoInqireService/getRouteInfoIem
3) 배차 정보   /ArvlInfoInqireService/getSttnAcctoArvlPrearngeInfoList
4) 운행 시간   첫차/막차 데이터 (노선 마스터 안에 포함)
```

### 3.3 통근 효율 점수 보강

```
기존 (ODsay):   경로 소요 시간만 반영
개선:           - 배차 간격 (10분 vs 30분 = 큰 차이)
                - 환승 횟수 (직행 vs 2회 환승)
                - 첫차/막차 시간 (야근 가능성)
                - 출근 시간대(07:00~09:00) 평균 vs 그 외

응용:
  · "막차 24:00 이전 도착 가능" 매물 강조 (1인가구 안전과 연계)
  · "환승 0회" 매물 우대
```

### 3.4 적재 명세 (요약)

```
t_transit_route_summary (행정동 → 직장 단위)
  legal_dong_code, work_cache_key,
  avg_headway_min,        -- 평균 배차 간격
  transfers_min,           -- 최소 환승 횟수
  first_bus_time,          -- 첫차 (가장 빠른)
  last_bus_time,           -- 막차
  night_accessible BOOL    -- 24:00 이전 도착 가능
```

API 호출 다중 단계라 캐싱 필수. ODsay 매트릭스 캐싱 패턴 재사용.

---

## 4. LH 청년주택 (Day 2~3)

### 4.1 데이터 소스

```
공공데이터포털
  · 한국토지주택공사_행복주택 공급 정보
  · 한국토지주택공사_청년매입임대 정보
  · 한국토지주택공사_전세임대 정보
승인:   자동
```

### 4.2 활용 필드

```
단지명, 주소, 위치 좌표, 공급 형태, 공급 호수,
임대료(보증금/월세), 모집 시기, 모집 대상 (청년/신혼부부/대학생)
```

### 4.3 적재 명세

```sql
CREATE TABLE t_lh_youth_housing (
  id                  INT PRIMARY KEY AUTO_INCREMENT,
  legal_dong_code     VARCHAR(10),
  program_type        VARCHAR(40),     -- 행복주택/청년매입임대/전세임대
  units_available     INT,
  monthly_rent_min    INT,              -- 만원
  monthly_rent_max    INT,
  target_audience     VARCHAR(40),      -- 청년/신혼부부/대학생
  application_period  VARCHAR(40),
  updated_at          DATETIME,
  INDEX (legal_dong_code)
);
```

### 4.4 UI 영향

```
RegionCard / RegionDetail
  · "주변 LH 청년주택 N개" 카드
  · "행복주택 모집중 N건" 강조 (모집 중일 때)
  · 청년 전용 토글 [LH 청년주택만 보기]
```

---

## 5. 통계청 가계금융복지조사 (Day 3)

### 5.1 데이터 소스

```
KOSIS 국가통계포털
  · 가구주 연령별·소득분위별 평균 소득
  · 가구주 연령별 주거비 부담률(RIR)
승인:   회원가입 후 즉시 다운로드
형식:   엑셀 또는 API
```

### 5.2 활용

```
사용자가 월 소득을 입력하면:
  · 청년(25~34) 기준 분위 자동 추정
  · 분위별 평균 RIR 표시 ("같은 분위 평균은 25%")
  · 사용자 RIR vs 분위 평균 비교

소득 미입력 시:
  · 분위 2~3 (청년 평균) 으로 가정
  · UI 에 "소득 입력 시 정확도 향상" 안내
```

### 5.3 적재 명세

```sql
CREATE TABLE t_income_quintile (
  quintile     INT PRIMARY KEY,        -- 1~5
  avg_income   INT,                     -- 월 만원
  rir_avg      FLOAT,                   -- 분위 평균 RIR
  description  VARCHAR(60)
);

-- 시드 데이터 (예시, 2024년 기준)
INSERT INTO t_income_quintile VALUES
  (1, 150, 0.42, '하위 20% (1분위)'),
  (2, 230, 0.35, '하위 40% (2분위)'),
  (3, 320, 0.28, '중위 (3분위)'),
  (4, 450, 0.22, '상위 40% (4분위)'),
  (5, 750, 0.18, '상위 20% (5분위)');
```

---

## 6. 안전 지표 (Day 3)

### 6.1 데이터 소스

```
경찰청 범죄주의구간 (경찰청 공공데이터)
  · 시군구 단위 (행정동 단위는 제한적)
  · 5대 범죄 발생 빈도 등급

서울 열린데이터광장 (서울 한정)
  · 가로등 위치 (좌표 단위)
  · CCTV 위치 (좌표 단위)
  · 행정동 단위 집계 가능

대안 (전국 확장 시):
  · 안전드림 어플 데이터 미공개
  · 시군구 단위 5단계 등급으로 단순화
```

### 6.2 점수 산출

```
crimeScore  = inverseLinear(crime_per_1000, 시군구 5퍼센타일, 95퍼센타일)
lightScore  = forwardLinear(lights_per_km2, 0, 95퍼센타일)
cctvScore   = forwardLinear(cctvs_per_km2, 0, 95퍼센타일)

safetyTotal = 0.5*crimeScore + 0.3*lightScore + 0.2*cctvScore
```

### 6.3 적재 명세

```sql
CREATE TABLE t_safety_index (
  legal_dong_code  VARCHAR(10) PRIMARY KEY,
  crime_score      FLOAT,
  light_score      FLOAT,
  cctv_score       FLOAT,
  total_score      FLOAT,
  updated_at       DATETIME
);
```

---

## 7. 적재 잡 우선순위 (시간 박스)

```
P0 (가점 직결)
  R-ONE 시군구 지수 — Day 1 오전 3시간

P1 (청년 컨셉 핵심)
  LH 청년주택 — Day 2 오후 2시간
  통계청 분위별 소득 — Day 3 오전 1시간

P2 (구체성 보강)
  TAGO 통근 보정 — Day 2 오후 4시간 (시간 부족 시 ODsay 만으로 가능)
  안전 점수 — Day 3 오후 4시간 (전국 데이터 부족 시 서울만)

P3 (사후 보강)
  AptRent 전월세 → affordability 의 월세 환산 정확도 ↑ (Sprint D)
  POI → life 점수 (Sprint D)
```

---

## 8. 기획서용 활용 데이터 표 (Day 6 오전 작성용 초안)

| 데이터 | 출처 | 활용 목적 | 비고 |
|---|---|---|---|
| 아파트 실거래가 | 국토교통부 공공데이터 API | LSTM 학습 + 매물 추천 | 5년 / 25만건 |
| 공동주택 실거래지수 | **한국부동산원 R-ONE** | LSTM 시장 추세 정규화 | **+가점** |
| 전월세 / 보증금 | 국토교통부 + 한국부동산원 | 주거비 부담률(RIR) 계산 | |
| 대중교통 배차·노선 | 국토교통부 TAGO | 통근 효율 점수 보강 | 야간 통근 가능성 |
| LH 청년주택 공급 | 한국토지주택공사 | 청년 전용 매물 매칭 | 행복/매입/전세임대 |
| 소득 분위별 평균 | 통계청 가계금융복지조사 | RIR 비교 기준 | 같은 분위 평균 |
| 범죄·가로등·CCTV | 경찰청 + 지자체 | 1인가구 안전 점수 | 행정동별 |
| 행정구역 마스터 | 행정안전부 BJD | 행정동 ↔ 단지 매칭 | 시드 완료 |
| 행정동 폴리곤 | vuski/admdongkor | 지도 히트맵 | 시드 완료 |
| 통근 매트릭스 | ODsay LAB | 행정동 ↔ 직장 통근 시간 | KNN 캐싱 |
| 좌표 변환 | 카카오 로컬 API | 주소 → 좌표 | 지오코딩 |

→ **공공·주관기관 4개 + 민간 보조 4개 = 8개 데이터 융합** 으로 명시 가능.
