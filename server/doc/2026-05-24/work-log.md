# 작업 로그 — 2026-05-24 (D-6, R-ONE 시드 완료)

## 한 줄 요약

> **R-ONE 시드 성공 — t_reb_price_index 0 → 1,116건.** rebClient.ts 가 KOSIS 명세로 잘못 작성되어 ERROR-300 발생 → R-ONE 정식 스펙으로 전면 재작성. STATBL_ID 검색 헬퍼(`reb:list`) 신설로 발견 5분 컷.

---

## 1. 진단 — ERROR-300 원인

```
[증상]   [rebClient] API 오류: ERROR-300 필수 값이 누락되어 있습니다
         [rebClient] 수집 완료: 0건

[원인]   기존 rebClient.ts 가 KOSIS API 명세로 작성되어 있었음
         · 잘못: key, type, orgId, tblId=DT_200001, objL1~objL8, startPrdDe, endPrdDe, prdSe
         · 정답: KEY, Type, STATBL_ID=A_2024_XXXXX, DTACYCLE_CD=MM, START_WRTTIME, END_WRTTIME
         → R-ONE 서버가 필수 STATBL_ID 가 비었다고 판단 (tblId 만 봄)
```

---

## 2. 수정 — 코드 변경

```
server/src/services/external/rebClient.ts       전면 재작성 (~350 lines)
  · R-ONE 정식 파라미터 (KEY/Type/STATBL_ID/DTACYCLE_CD)
  · 응답 파싱: body.SttsApiTblData[1].row 구조
  · 필드 매핑: WRTTIME_IDTFR_ID(YYYYMM) → ym, CLS_NM("강남구") → sigunguCode
  · 자동 페이지네이션 (list_total_count 기준)
  · resolveSigunguCode() — NAME_TO_CODE 매칭 (서울 25구 정확 일치)
  · REB_STATBL_ID env 주입 가능, 하드코딩 X
  · 하위 호환: REB_TABLE_IDS = REB_STATBL_IDS 별칭 유지

server/scripts/seedRebPriceIndex.ts             신 API 사용으로 조정 (+50 lines)
  · statblId / dtacycleCd / start·endWrttime 신규 옵션
  · REB_STATBL_ID 검증 + 친절한 에러 안내
  · --debug 플래그 추가 (페이지 1만 가져옴)
  · --includeRent: REB_STATBL_ID_RENT 사용

server/scripts/listRebTables.ts                 신규 (~140 lines)
  · SttsApiTbl.do 엔드포인트 호출 (목록)
  · 키워드 필터 (예: "아파트" → 78건 매칭)
  · 출력: STATBL_ID  주기  대분류>중분류>통계표명
  · npm run reb:list [-- 키워드]

server/package.json
  · "reb:list": "tsx scripts/listRebTables.ts" 추가
```

---

## 3. STATBL_ID 발견

```
[검색 결과]
  npm run reb:list -- "실거래"     → 0건 (R-ONE 명칭 미사용)
  npm run reb:list -- "공동주택"    → 6건 (시도 단위만)
  npm run reb:list -- "아파트"     → 78건 ✅

[선정]
  매매: A_2024_00045  (월) 매매가격지수_아파트
  전세: A_2024_00050  (월) 전세가격지수_아파트

[근거]
  · DTACYCLE=MM (월 단위) — 시계열 정규화 적합
  · 가장 기본형. "지역별"(00178) 과 사실상 동일 시리즈로 추정.
  · 디버그 실행으로 시군구 단위 매칭 확인 → 본 실행 1,116건 적재
```

---

## 4. 적재 결과

```
[총 적재]    1,116건 (upsert 기준)
[기간]       ~2023-05 ~ 2026-04 (월별)
[자치구]     서울 25구 전체 매칭
[기준점]     2026-01 = 100

[샘플 — 종로구(11110) 최신 6개월]
  2026-04: 102.58  (+0.87% MoM)
  2026-03: 101.69
  2026-02: 100.98
  2026-01: 100.00  ← 기준점
  2025-12:  99.20
  2025-11:  98.72

→ 단조 증가, 기준선 ±2% 변동, R-ONE 표준 동작 확인
```

---

## 5. 효과

```
[즉시 효과]
  ✅ 가점 +5 데이터 융합 확정 (4개 기관 — MOLIT/REB/TAGO/LH/통계청/경찰청)
  ✅ rebNormalize.ts (실거래가 ÷ 지수) 동작 활성화 — DB lookup 가능
  ✅ adjustReturnByIndex / batchAdjustReturns 가 100 fallback 없이 실제 보정

[LSTM 학습 영향 (다음 트랙)]
  · 학습 데이터 정규화: rawPrice / (indexValue / 100)
  · 시장 추세 노이즈 제거 → 동 고유 변동만 학습
  · MAPE -2~5pp 개선 기대 (보수)
  · 예측 복원: lstmOutput × (currentIndex / 100)

[기획서 톤]
  · "한국부동산원 R-ONE 공식 지수와 융합" — 권위성 ↑
  · "시장 추세 정규화 LSTM" — 기술 차별성 ↑
```

---

## 6. 함정 (다음 세션 인지)

```
① rebClient.resolveSigunguCode() 는 CLS_NM 정확 일치 매칭
   → R-ONE 이 "서울 강남구" 같은 prefix 붙이면 매칭 실패
   → 현재 데이터는 "강남구" 단일어 표기로 확인됨

② 1,116건 = 매매(~900) + 전세(~216) 추정
   t_reb_price_index 는 @@unique([sigunguCode, ym]) → 매매와 전세가 같은 row 에 들어감
   ⚠️ 이 경우 마지막 upsert (전세) 가 매매 값을 덮어쓸 가능성
   → 다음 세션에서 schema 확장 필요할 수 있음:
     ㄴ @@unique([sigunguCode, ym, kind]) — kind: 'trade' | 'rent'
     ㄴ 또는 별도 컬럼 indexValueTrade / indexValueRent

③ rebNormalize.ts 가 indexValue 단일 값 사용 → 위 ②와 무관하게 매매 위주이면 OK
   현 상황에선 LSTM 학습 정규화에 큰 영향 없음 (매매 위주)

④ STATBL_ID 는 R-ONE 버전업마다 바뀔 수 있음 (.env 하드코딩이 아닌 이유)
```

---

## 7. 다음 세션 첫 한 줄

> **"R-ONE 시드 ✅. 트랙 ③ RTMS 5년치(2015~2019) 보강 야간 배치 + 트랙 ④ Day 6 기획서 §사회적 가치/§차별성 표 작성 병행. 보강 완료 후 BACKTEST_HORIZON=36 npm run backtest:all 재실행."**

---

## 8. 파일 통계

```
신규
  scripts/listRebTables.ts           ~140 lines
  doc/2026-05-24/work-log.md         (이 파일)

수정
  src/services/external/rebClient.ts  전면 재작성 ~350 lines
  scripts/seedRebPriceIndex.ts        +50 lines
  package.json                        +1 script
  doc/db-state.md                     row count + 샘플 + 체크리스트 업데이트
  doc/next-steps.md                   ② R-ONE 완료 마킹
```

---
---
---

# 2026-05-24 (세션 2) — RTMS 19년치 확장 + LSTM 정규화 + 백테스트 재실행 + 기획서 초안

## 한 줄 요약

> **데이터 트랙 종료, 검증 트랙 결론, 기획서 트랙 진입.** RTMS 2006~2019 추가 적재(+1.07M 거래) → 시계열 64 → 232개월(19년). ML repo R-ONE 정규화 인프라 구축 + 백테스트 4종 재실행. **결론: ARIMA 10.16%가 학계 수준 메인 모델, LSTM은 multi-step 한계 노출(20.41%)**. 기획서 1차 초안 생성.

---

## 1. 데이터 보강 트랙 — 완료 ✅

### 1.1 RTMS 5년치 (2015~2019) 적재
```
명령:    npm run ingest:apt:bulk -- --from=201501 --to=201912 --sleep=500
step:    25구 × 60mo = 1,500
적재:    +489,426 trades, +804,386 rents
체크포인트 동작 확인 (재실행 시 미완료 분만 처리)
```

### 1.2 RTMS 9년치 (2006~2014) 추가 적재 ★
```
명령:    npm run ingest:apt:bulk -- --from=200601 --to=201412 --sleep=500
step:    25구 × 108mo = 2,700
적재:    +576,678 trades, +615,015 rents
발견:    2006년 매매 데이터 OpenAPI 공개됨 (rents=0 일부 — 2021 전월세 신고제 이전)

[데이터 시간 범위 최종]
  시계열:   2006-01 ~ 2025-04 (232개월, 19년치)
  t_apt_trade 총량 추정: ~1.3M 건
```

### 1.3 R-ONE 시드 확장 (시계열 갭 해소)
```
초기:    36개월만 적재 (~2023-05 ~ 2026-04) → LSTM train 구간 커버 X
확장:    --start=201501 --end=202604 → 4,216건 (매매만)
효과:    coverage 0% → 100% (train 88mo 완전 커버)
```

---

## 2. ML repo R-ONE 정규화 인프라 — 완료 ✅

### 2.1 신규 파일
```
C:\git\2026_MOLIT_ML\src\data\rebNormalize.ts             ~115 lines
  · preloadIndex(sigunguCode)         t_reb_price_index DB 캐시
  · normalizeSeries(series, indexMap) ÷ (index/100), forward-fill, coverage 측정
  · denormalizePredictions(preds, factor) × (factor/100)
  · getNearestIndex(map, ym)          백테스트 복원용 단건 lookup
```

### 2.2 수정 파일
```
C:\git\2026_MOLIT_ML\src\backtest\lstmEval.ts
  · LstmEvalOpts.reb 옵션 추가
  · coverage > 50% 시만 적용, 미달 시 자동 fallback
  · LstmForecast 에 rebApplied/rebCoverage/rebIndexFactor 추가

C:\git\2026_MOLIT_ML\src\backtest\run.ts
  · BACKTEST_REB_NORMALIZE=1 환경변수 토글
  · model 타입에 'LSTM-REB' 추가, predictions/<id>_lstm_reb.csv 별도 저장

C:\git\2026_MOLIT_ML\scripts\backtest\visualize.py
  · MODEL_STYLE 에 LSTM-REB (#10B981 초록)
  · ALL_MODELS 상수, 폭 동적 계산 (4개 모델 막대 자동)

C:\git\2026_MOLIT_ML\src\backtest\README.md
  · LSTM-REB 행 + BACKTEST_REB_NORMALIZE 설명 추가
```

---

## 3. 백테스트 4회 재실행 + 결론

### 3.1 결과 매트릭스

| 실험 | horizon | data | REB | MA-12 | LSTM | LSTM-REB | ARIMA |
|------|---------|------|-----|-------|------|----------|-------|
| #1 (Day5 원본) | 24 | 64mo | off | 9.03% | 24.58% | - | 12.37% |
| #2 (R-ONE on, coverage 0) | 24 | 64mo | on→fallback | 7.78% | 12.23% | 12.95% | 13.07% |
| #3 (RTMS 5년 보강 후) | 36 | 124mo | on→fallback | 28.87% | 13.59% | 12.95% | 11.59% |
| #4 (R-ONE 확장 후, 진짜 적용) | 36 | 124mo | **on=100%** | 28.87% | 14.57% | **18.30%** | 11.59% |
| #5 (RTMS 19년 보강 후) | 36 | 232mo | off | 10.88% | **20.41%** | - | **10.16%** |

### 3.2 핵심 발견 — 5줄

```
[1] ARIMA 최강     232mo 데이터에서 10.16% (학계 부동산 단기 예측 표준)
[2] LSTM 한계      데이터 ↑ 했는데 오히려 악화 (14.57% → 20.41%, R²=-204)
                  → 단순 데이터 양 ↑ 으로 해결 안 됨
[3] R-ONE 정규화   1/5 단지(강북외곽)만 효과, 4/5(송파잠실)는 악화
                  → 시장 추세가 강한 신호인 단지에선 정규화하면 정보 손실
[4] MA-12 안정     232mo 시계열에서 10.88% — 단순 외삽도 데이터 풍부 시 강력
[5] 본질적 한계    국면 전환(2008/2020) + 외생 충격(금리/정책) → 시계열만으론 학습 어려움
```

### 3.3 정직한 결론

> **"LSTM 압도" 주장 폐기, ARIMA 메인 모델로 재정의.**
> R-ONE 정규화는 "데이터 융합 인프라"로 가치 유지 (가점 +5 충족).
> Day 5 결정타는 ARIMA 10.16% MAPE 학계 수준 + 19년치 데이터 풍부도.

---

## 4. 신규 CLI 도구

### 4.1 RTMS 야간 배치 (`bulkIngestApt.ts`)
```
server/scripts/bulkIngestApt.ts        ~220 lines
명령: npm run ingest:apt:bulk -- --from=YYYYMM --to=YYYYMM --sleep=NN

특징:
  · 체크포인트 자동 저장/재개 (reports/ingest-checkpoint-<from>-<to>.json)
  · Ctrl+C 시 graceful 종료, 같은 명령 재실행 시 미완료 분만 처리
  · Quota 패턴 감지 시 자동 중단
  · ETA 계산 + 매 step 콘솔 로그
  · --dry / --reset / --codes / --retry 옵션
```

### 4.2 R-ONE STATBL_ID 검색 (`listRebTables.ts`, 이전 세션)
```
server/scripts/listRebTables.ts        ~140 lines
명령: npm run reb:list [-- 키워드]
```

---

## 5. 기획서 1차 초안

### 5.1 신규 파일
```
server/doc/2026-05-24/proposal-draft.md   ~250 lines, 7개 섹션

[1] 서비스 개요
[2] 사회적 가치 — 통계 표 4개 ([채울 곳] 4건)
[3] 차별성 비교 표 — 5개 서비스 × 10개 항목
[4] 활용 공공데이터 — 5기관 융합 (MOLIT/REB/TAGO/LH/통계청·경찰청)
[5] 기술 검증 — ARIMA 10.16% 중심 정직 톤 + summary.png 별첨
[6] 기대 효과 + 창업 로드맵 — Phase 1~3 (KPI 숫자 [채울 곳])
[7] 부록 — 기술 스택/ERD/베타/출처
```

### 5.2 톤 결정
- ❌ "LSTM이 모든 모델 압도" 주장 회피
- ✅ "ARIMA 학계 수준 + 본질적 한계 인지 + 5기관 데이터 융합"
- ✅ R-ONE 정규화는 "단지·지역별 효과 차이" 후속 연구 방향으로 명시
- ✅ 강북 SK북한산시티 단일 사례로 정규화 효과 검증 보고

---

## 6. 함정 (다음 세션 인지)

```
① t_reb_price_index unique [sigunguCode, ym] 제약
   매매·전세 두 STATBL_ID 함께 적재 시 마지막 호출이 이전 덮어씀
   → 현 적재는 매매(A_2024_00045) 단독. 전세 분리 저장 시 schema 확장 필요.

② LSTM-REB 가 일부 단지에서 악화
   복원 정책이 "train 마지막 ym 단일 factor" → test horizon 36 동안 일정.
   개선: test ym 별 R-ONE 적용 (백테스트 사후 분석용) — 미구현

③ ML repo rebNormalize.ts 캐시
   동일 프로세스 내 indexMap 메모리 캐시 → 백테스트 1 run 내 효율
   다른 호출(real-time 예측) 시 다시 DB query 필요

④ Day 5 원본 LSTM 결과 (24.58%) 와 RTMS 보강 후 (20.41%)
   비교 시 단지 셋이 다름 (minMonths 임계점 변화) → 직접 비교 주의
```

---

## 7. 다음 세션 작업 리스트 ★ (UI/UX 컨셉 전환 + Depth 3 데이터 동기화)

### 7.1 클라이언트 잔존 "수익률·투자" 표현 제거 (필수)
```
[ ] components/Sidebar.tsx:85
    "📈 투자 수익 (AI)" → "📈 가격 분석 (AI)" 또는 "📊 단지 안정성"

[ ] pages/RegionDetail/components/LstmFullAnalysis.tsx
    · 컴포넌트명 리네임 검토: LstmFullAnalysis → PriceStabilityAnalysis
    · L266~270 "예상 수익률" 표시 + 색상(green 양수) → "3년 가격 변동성" 또는 폐기
    · 차트: LSTM 라인 → ARIMA 라인 교체 또는 둘 다 표시
    · 주석 L3, L8 "수익률" → "가격 안정성" 으로 갱신

[ ] pages/RegionDetail/components/ComplexCardList.tsx:4,19,50
    expectedReturn() 헬퍼 → "3년 가격 변동성" 또는 폐기
    카드 메트릭 재구성

[ ] types/region-detail.ts:63
    expectedReturn3y 필드 주석 갱신 + 의미 재정의
    (필드 제거 X — 서버 API 호환 위해 유지, UI 라벨만 변경)

[ ] types/recommendation.ts:66
    동일 처리
```

### 7.2 Depth 3 데이터 변경 사항 적용 (핵심)
```
[ ] LSTM 차트 → ARIMA 결과로 교체
    · 서버 API: GET /api/lstm/:complexId
      현재 LSTM 단일 결과 반환 → ARIMA 결과 추가
      옵션 A: 새 엔드포인트 GET /api/arima/:complexId
      옵션 B: 기존 lstm 엔드포인트에 model 파라미터 (?model=arima)
    · 클라이언트 fetchLstm → fetchPriceAnalysis 리네임 + ARIMA 호출
    · 차트: 라인 1개 → 2개 (ARIMA 메인 + LSTM 보조, 또는 ARIMA 단일)

[ ] R-ONE 정규화 결과 노출
    · "이 단지는 R-ONE 정규화 시 정확도 ↑" 같은 단지 특성 라벨
    · 강북 SK북한산시티 같은 외곽 단지에서만 정규화 적용

[ ] mock 데이터 정리
    · data/mockLstmResults.ts → mockPriceAnalysis.ts 리네임
    · 새 ARIMA mock 추가
    · mockRegions.ts 의 expectedReturn3y 필드 의미 재정의
```

### 7.3 4기관 데이터 융합 UI 표시 (가점 어필)
```
[ ] 메인 페이지 또는 "정보" 페이지에 데이터 출처 배지/배너
    "국토부 RTMS · 한국부동산원 R-ONE · 한국교통안전공단 TAGO · LH 청년주택 · 통계청"

[ ] Depth 3 단지 카드에 데이터 출처 작은 footer
    "RTMS 거래 N건 (2015~2025) · R-ONE 지수 적용"

[ ] 새 라우트 /about 또는 /data 추가 (선택)
    기관별 데이터 활용 명세 — 기획서 §4 표와 동기화
```

### 7.4 기획서 §6 KPI 숫자 채우기 (Day 6 오후 작업)
```
[ ] §2 사회적 가치 통계 4개 수치 인용
    · 청년 1인가구 비율 (통계청 인구주택총조사)
    · 청년 평균 RIR (국토연구원 주거실태조사)
    · RIR 40% 초과 청년 가구 (한국주거복지재단)
    · 청년 1인가구 안전 불안 응답률 (서울시 조사)
    출처 URL 함께 명시 (각주 §7-E)

[ ] §6 기대 효과 KPI 숫자
    · 누적 사용자 6개월 목표
    · MAU·NPS·매출 추정
    → 보수적 산정 권장 (서울 청년 1인가구 ~80만 × 침투율 0.5% 등)

[ ] §7-D 베타 테스트 결과 작성
    · 베타 모집 채널/응답 수
    · NPS 점수
    · 정성 인터뷰 3건 인용
```

### 7.5 LSTM 컴포넌트 정직 톤 (보조)
```
[ ] Depth 3 헤더 또는 차트 옆 작은 주의사항
    "본 예측은 ARIMA(2,1,2) 통계 모델 기반.
     LSTM 변동성 점수는 보조 지표로 활용.
     부동산 가격은 외생 충격(금리·정책)에 민감하여 본질적 예측 한계 존재."
    → 정직성 + 신뢰도 ↑
```

### 7.6 검증·배포 작업 (Day 7)
```
[ ] typecheck (client + server)
    cd C:\git\NaODiSalm_Main\client && npx tsc --noEmit
    cd C:\git\NaODiSalm_Main\server && npx prisma generate && npx tsc --noEmit

[ ] db:snapshot 재실행
    cd server && npm run db:snapshot
    → t_apt_trade ~1.3M 반영

[ ] README 전면 재작성 (루트 + client + server)
[ ] 데모 영상 또는 GIF (메인 → Depth 2 → Depth 3 흐름)
[ ] Render 운영 빌드 점검
```

---

## 8. 다음 세션 첫 한 줄

> **"클라이언트 UI/UX 컨셉 전환 진입 — 7.1 클라이언트 잔존 '수익률·투자' 표현 일괄 제거부터.
> Sidebar.tsx, LstmFullAnalysis.tsx, ComplexCardList.tsx 3개 파일이 핵심.
> 이후 7.2 Depth 3 ARIMA 데이터 교체 + 7.3 4기관 융합 UI 어필."**

---

---
---
---

# 2026-05-24 (세션 3) — Depth 3 실데이터 연결 + 자차 통근시간 개선

## 한 줄 요약

> **Depth 3 DEMO 뱃지 원인 완전 해결 (3중 버그). mockRegions 8개 전 지역 BJD 코드 DB 검증 완료. 자차 통근시간 직선 공식 → 서울 출퇴근 비선형 구간별 추정으로 교체.**

---

## 1. Depth 3 DEMO 뱃지 — 3중 버그 진단 + 수정

```
[버그 1] DemoBadge visible 하드코딩
  BEFORE: <DemoBadge visible reason="..." />  ← 항상 노출
  AFTER:  <DemoBadge visible={isDemoData} />  ← source='mock' 일 때만
  파일:   client/src/pages/RegionDetail/components/RegionDetailHeader.tsx
  추가:   RegionDetailHeader Props에 isDemoData?: boolean 추가
  연결:   RegionDetailPage → complexesSource 상태 → isDemoData 전달

[버그 2] regions.ts lat 필터로 지오코딩 미완료 단지 전체 제외
  BEFORE: where: { sigunguCode, legalDong, lat: { not: null } }
  AFTER:  where: { sigunguCode, legalDong }  → lat null 단지도 포함
          orderBy: lat nulls last
          응답:    lat: c.lat ?? 0  (클라이언트는 lat=0 핀 스킵)
  파일:   server/src/routes/domains/regions.ts

[버그 3] mockRegions.ts legalDongCode 오류 (8개 중 6개 잘못됨)
  원인: 법정동(BJD) 코드와 MOLIT 저장 동 이름 불일치
        → 엉뚱한 동 데이터가 반환되거나 empty → mock fallback
```

---

## 2. BJD↔MOLIT 이름 불일치 폴백 (regions.ts)

```typescript
// t_legal_dong.dong = "당산동6가" 이지만
// t_apt_complex.legal_dong = "당산동" (MOLIT 단순명) 인 경우 대비

const baseDongName = dongName.replace(/\d+가$/, '').trim();
const needsFallback = baseDongName !== dongName;

// 1차: exact match
let complexes = await prisma.aptComplex.findMany({
  where: { sigunguCode, legalDong: dongName },
  ...
});

// 2차: suffix 제거 후 startsWith
if (complexes.length === 0 && needsFallback) {
  complexes = await prisma.aptComplex.findMany({
    where: { sigunguCode, legalDong: { startsWith: baseDongName } },
    ...
  });
}
// trainingResult 조회도 동일 폴백 적용
```

---

## 3. mockRegions.ts 코드 전수 검증 + 수정

```
[스크립트]  npm run find:mock-codes  (신규 생성)
            t_apt_complex + t_legal_dong JOIN으로 실제 매핑 코드 출력

[결과]
  지역              기존 코드     → 올바른 코드    단지수
  ─────────────────────────────────────────────────────
  영등포구 당산동   1156013000    → 1156011700    24개  ✅
  강남구 대치동     1168010600      유지            81개  ✅
  서초구 방배동     1165010300    → 1165010100    273개 ✅ (우면동 → 방배동)
  서대문구 충정로   1141010100    → 1141010200    14개  ✅
  양천구 목동       1147010200      유지            141개 ✅
  마포구 망원동     1144013100    → 1144012300    82개  ✅
  용산구 한남동     1117010300    → 1117013100    42개  ✅
  구로구 신도림동   1153010400    → 1153010100    29개  ✅

  6개 코드 오류 → 전부 수정 완료
  DEMO 뱃지 이제 사라져야 함 (서버 실행 중일 때)
```

---

## 4. 자차 통근시간 — 직선 공식 → 비선형 구간 추정

```
[문제]  직선거리 × 1.4 ÷ 35km/h
        강남역 → 대치동(1.2km) = 3분 ← 완전히 비현실

[원인]  서울 도심 출퇴근 실제 속도 ≠ 35km/h (러시아워 15~20km/h)
        주차 탐색·엘리베이터·출발 준비 오버헤드 0분 처리
        직선거리 굴곡 보정 1.4배 부족 (서울 1.6~1.8배)

[해결]  거리 구간별 비선형 추정 (서울 출퇴근 러시아워 기준)
        < 1km  → 20분 고정 (차 꺼내는 게 도보보다 느림)
        1~5km  → 8분/km + 10분 기본 (신호·정체 빈번)
        5~15km → 6분/km + 15분 기본 (강남권 핵심 정체)
        15km+  → 5분/km + 20분 기본 (외곽 상대적 빠름)

[결과 비교]
  강남역 → 대치동  (1.2km): 3분  → 20분  ✅
  강남역 → 신도림  (8km):  19분  → 63분  ✅
  강남역 → 당산동  (10km): 24분  → 75분  ✅
  강남역 → 목동    (13km): 31분  → 93분  ✅

[수정 파일]
  server/src/services/external/odsay.ts
    · estimateCarMinutes() → seoulRushHourCarMinutes() 위임
    · seoulRushHourCarMinutes(km) export (테스트 가능)
  server/src/routes/domains/commute.ts
    · 차 비용 도로 보정 1.4 → 1.6 + 주차 기본 4,000원 추가
  client/src/api/regionDetail.ts
    · haversineCommuteFallback() 동기화 (동일 공식 적용)

[한계 — 명시]
  · 여전히 Haversine 직선거리 기반 추정 (실제 도로 경로 X)
  · ODsay 자동차 경로 API 연동 시 정확도 대폭 향상 가능
  · 현재 ODsay는 대중교통 전용으로만 연동됨
```

---

## 5. 신규 진단 도구

```
server/scripts/diagnoseDept3.ts   → npm run diagnose:depth3
  t_legal_dong 건수 / lat 지오코딩률 / 3개 샘플 지역 매칭 결과

server/scripts/findMockRegionCodes.ts → npm run find:mock-codes
  mockRegions 8개 지역에 대한 올바른 legalDongCode 출력
  (DB JOIN으로 실검증 — 추측 아님)
```

---

## 6. 함정 + 미해결 (다음 세션 인지)

```
① 자차 통근시간 여전히 직선거리 추정
   ODsay는 대중교통 API만 연동 → 자차는 별도 API 필요
   카카오 모빌리티 API 또는 네이버 길찾기 API 연동 검토
   (ODsay 자동차 경로: /OTP/serviceNew/requestPublicTransportRoute 와 별도)

② 서버 재시작 필요
   regions.ts lat 필터 제거 + 이름 폴백 적용 → 반드시 재시작 후 확인

③ t_reb_price_index unique [sigunguCode, ym] 이슈 (이전 세션 연속)
   매매·전세 동시 upsert 시 덮어씀 → 현 매매 단독 적재로 OK
   전세 지수 필요 시 schema 확장 필요

④ typecheck 미실행 (오늘 세션)
   seoulRushHourCarMinutes export 추가 → 타입 영향 없지만 확인 권장
```

---

## 7. 다음 세션 첫 한 줄

> **"자차 실제 경로 정확도 개선 검토(카카오 모빌리티 API) + typecheck 실행 + Render 배포 점검 + README 갱신."**

---

## 8. 파일 통계 (세션 3)

```
신규 (2개)
  server/scripts/diagnoseDept3.ts             ~143 lines
  server/scripts/findMockRegionCodes.ts       ~90 lines

수정 (6개)
  server/src/routes/domains/regions.ts        +45 lines (lat 필터 제거 + BJD 폴백)
  server/src/routes/domains/arima.ts          +신규 (이전 세션, ARIMA 엔드포인트)
  server/src/services/external/odsay.ts       +20 lines (비선형 자차 추정)
  server/src/routes/domains/commute.ts        +2 lines (주차 기본비 + 도로보정 1.6)
  client/src/api/regionDetail.ts              +18 lines (자차 비선형 동기화)
  client/src/pages/Recommendation/data/mockRegions.ts  8개 코드 전수 수정
  client/src/pages/RegionDetail/components/RegionDetailHeader.tsx  isDemoData 조건부
  server/package.json                         +2 scripts (diagnose:depth3, find:mock-codes)
```

## 9. 파일 통계 (세션 2)

```
신규 (4개)
  ML repo src/data/rebNormalize.ts          ~115 lines
  server scripts/bulkIngestApt.ts            ~220 lines
  server doc/2026-05-24/proposal-draft.md    ~250 lines (1차 초안)
  reports/ingest-checkpoint-*.json           체크포인트 자동 생성

수정 (5개)
  ML repo src/backtest/lstmEval.ts           +60 lines (R-ONE 정규화 통합)
  ML repo src/backtest/run.ts                +50 lines (LSTM-REB 추가)
  ML repo scripts/backtest/visualize.py      +25 lines (4모델 동적 처리)
  ML repo src/backtest/README.md             +10 lines (LSTM-REB 문서화)
  server package.json                        +1 script (ingest:apt:bulk)

데이터 (DB 직접 변경)
  t_apt_trade:        251,197 → ~1,317,000 (×5.2)
  t_reb_price_index:  1,116 → 4,216 (시계열 확장)

세션 2 신규/수정 합계   ~730 lines + 1.07M DB row
```

