# DB 상태 스냅샷

> 자동 생성: `npm run db:snapshot` — 2026-05-23 04:50
> 새 AI 세션 시작 전 이 파일을 읽으면 DB 현황을 즉시 파악할 수 있습니다.

---

## 테이블별 Row Count

| 테이블 | Row 수 | 설명 |
|--------|--------|------|
| t_apt_complex | 9,621 | 아파트 단지 마스터 |
| t_apt_trade | 251,197 | 매매 실거래 |
| t_apt_rent | 1,198,385 | 전월세 실거래 |
| t_legal_dong | 6,271 | BJD 법정동 코드 (서울 10자리: 469) |
| t_commute_matrix | 1,708 | ODsay 통근시간 캐시 |
| t_training_result | 2,143 | LSTM 학습 결과 |
| t_reb_price_index | 1,116 | 부동산원 매매/전세 가격지수 (A_2024_00045/00050) |
| t_lh_youth_housing | 3,950 | LH 청년주택 공급 |
| t_transit_route_summary | 33 | TAGO 대중교통 품질 |
| t_safety_index | 469 | 행정동 안전지표 합성 |
| t_income_quintile | 5 | 통계청 소득 분위 |
| t_user | 0 | 서비스 사용자 |

---

## 핵심 데이터 현황

### 아파트 실거래 (t_apt_trade)
```
거래 기간:  2020-01-01 ~ 2025-04-30
평균 가격:  104,507 만원
최고 가격:  2,500,000 만원
```

### 통근 캐시 (t_commute_matrix)
```
직장 그룹 수: 4개 (4자리 반올림 좌표 기준)
총 캐시 row: 1,708건
```

### 추천 가능 행정동
```
단지+거래+좌표 3중 매칭 서울 행정동: 340개
```

### 소득 분위 (t_income_quintile)
```
1분위: 월 130만원  — 하위 20% — 월평균 130만원 (무직·저소득 가구 포함)
2분위: 월 274만원  — 20~40% — 월평균 274만원
3분위: 월 403만원  — 40~60% — 월평균 403만원 (중위소득 기준, RIR 기본값)
4분위: 월 577만원  — 60~80% — 월평균 577만원
5분위: 월 1,057만원  — 상위 20% — 월평균 1,057만원 (맞벌이·전문직 가구)
```

### 안전지표 상위 5개 자치구 (t_safety_index)
```
강남구  : 75.7점  (14개 동)
서초구  : 74.0점  (10개 동)
송파구  : 69.0점  (13개 동)
성동구  : 64.8점  (17개 동)
노원구  : 64.8점  (5개 동)
```

### TAGO 대중교통 품질 (t_transit_route_summary)
```
적재 행정동: 33개
평균 transitScore: 17.5 / 최저: 11 / 최고: 62
```

### LH 청년주택 (t_lh_youth_housing)
```
행복주택: 3725건, 총 2,451,200세대
전세임대: 225건, 총 74,250세대
```

### R-ONE 부동산원 지수 (t_reb_price_index)
```
적재 row: 1,116건 (매매+전세)
기간: ~2023-05 ~ 2026-04 (월별)
자치구 수: 25개 (서울 25구 매칭)
기준점: 2026-01 = 100
샘플: 종로구 2026-04 = 102.58 (4개월간 +2.58%)
STATBL_ID: A_2024_00045 (매매), A_2024_00050 (전세)
```

---

## AI 세션 시작 시 체크리스트

다음 항목이 0이면 해당 시드를 먼저 실행:

```
t_income_quintile  5건  ✅
t_safety_index     469건  ✅
t_lh_youth_housing 3950건  ✅
t_transit_route_summary 33건  ✅
t_reb_price_index  1,116건  ✅
```

## 서버 기동 확인

```powershell
# 서버 기동
cd C:\git\2026_MOLIT_CONTEST
npm run dev

# 강남역 추천 API 테스트
curl -X POST http://localhost:4000/api/recommendations \
  -H 'Content-Type: application/json' \
  -d '{"workplace":{"lat":37.4979,"lng":127.0276,"label":"강남역"},"budget":40000,"weights":{"commute":35,"affordability":30,"safety":20,"life":15},"patience":45}'
```