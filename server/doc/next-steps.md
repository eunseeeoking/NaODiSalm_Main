# 다음 작업 정리 (Next Steps)

> 새 세션 / 후임 / 본인 이어가기용 단일 진입점.
> 우선순위 순으로 정리. 위에서부터 그대로 진행하면 됨.
> 마지막 갱신: 2026-05-25 (D-4, Depth 3 실데이터 연결 완료 + 자차 공식 개선)

---

## 🔥 다음 세션 진입점 (필독)

```
[현황]   UI/UX 컨셉 전환 트랙 ✅ 완료
         · ① 클라이언트 "수익률·투자" 표현 전부 제거 (PriceStabilityAnalysis 리네임 등)
         · ② Depth 3 차트: LSTM → ARIMA 메인 + LSTM 보조 (GET /api/arima/:complexId 신규)
         · ③ 4기관 데이터 융합 배지 (메인 헤더 스트립)
         · ④ 기획서 §2 통계 4건 + §6 KPI 채움
         · ⑤ typecheck client/server 모두 EXIT:0

         Depth 3 실데이터 연결 ✅ 완료
         · DemoBadge 하드코딩 제거 (source='mock' 시만 표시)
         · regions.ts lat 필터 제거 (지오코딩 미완료 단지도 카드 노출)
         · regions.ts BJD↔MOLIT 이름 불일치 폴백 (숫자가 suffix 제거 후 startsWith)
         · mockRegions 8개 지역 legalDongCode 전수 검증·수정 (find:mock-codes 스크립트)
         · GET /api/arima/:complexId 엔드포인트 신규 (ARIMA(2,1,2) 기반)

         자차 통근시간 ✅ 개선
         · 직선 Haversine÷35km/h → 서울 출퇴근 구간별 비선형 추정
         · 강남역→대치동 3분 → 20분 (1.2km 구간)

[중요 한계]
  ⚠️  자차 통근시간은 여전히 직선거리 기반 통계 추정
      실제 도로 경로(교차로·신호·한강 여부) 반영 X
      → ODsay 자동차 경로 API 또는 카카오 모빌리티 API 연동 필요
      (대중교통은 ODsay 이미 연동, 자차만 미연동)

[다음 우선순위]
  ① typecheck 재확인 (seoulRushHourCarMinutes export 추가 후)
  ② 자차 실경로 API 연동 검토 (카카오 모빌리티 or ODsay 자동차)
  ③ Render 운영 배포 점검
  ④ README 전면 재작성 + 데모 GIF
  ⑤ (선택) 이동수단 토글 — Depth 2 히트맵 대중교통/자차 전환 버튼
```

---

## 📋 다음 세션 핵심 작업

### 1. typecheck 확인 ★ 5분
```
cd C:\git\NaODiSalm_Main\client && npx tsc --noEmit
cd C:\git\NaODiSalm_Main\server && npx prisma generate && npx tsc --noEmit

→ seoulRushHourCarMinutes export 추가로 인한 타입 영향 없을 것으로 예상
  이상 있으면 odsay.ts export 확인
```

### 2. 자차 실경로 API 연동 (선택·권장) ★★
```
[현황]  estimateCarMinutes() = Haversine 직선거리 기반 구간별 계수
        실제 도로망·교통신호·한강 도하 여부 무관 → 여전히 추정값

[옵션 A] 카카오 모빌리티 길찾기 API
  · 엔드포인트: https://apis-navi.kakaomobility.com/v1/directions
  · 파라미터: origin(lng,lat), destination(lng,lat), priority=RECOMMEND
  · 응답: duration(초), distance(미터)
  · 키: KAKAO_REST_API_KEY (이미 .env 에 있음 — 추가 발급 불필요)
  · 비용: 무료 (일 300,000회)
  · 연동 위치: server/src/routes/domains/commute.ts GET /compare
              캐시 miss 시 ODsay(대중교통) + 카카오(자차) 동시 호출

[옵션 B] ODsay 자동차 경로
  · /OTP/serviceNew/requestPublicTransportRoute 와 별개 엔드포인트
  · 이미 ODsay_API_KEY 보유 → 추가 비용 없음

[권장]  옵션 A — 카카오는 이미 지도 키 있고, REST로 단순 GET

[구현 규모] odsay.ts 에 fetchKakaoCarRoute() 추가 ~50줄
            commute.ts compare 엔드포인트 자차 분기 ~20줄 수정
            전체 약 1~2시간
```

### 3. Render 운영 배포 점검
```
[ ] server/prisma/schema.prisma 변경분 migrate deploy 확인
    (TransitRouteSummary 추가, arima 엔드포인트는 스키마 무관)

[ ] 빌드 명령 확인
    "build": "npx prisma generate && tsc -p tsconfig.json"

[ ] 환경변수 확인 (Render 대시보드)
    DATABASE_URL / ODSAY_API_KEY / KAKAO_REST_API_KEY / ADMIN_TOKEN

[ ] 운영 서버 smoke test
    curl https://<render-url>/api/regions/1168010600/complexes | head -c 500
```

### 4. README 재작성 + 데모 GIF
```
[ ] 루트 README.md
    · 서비스 한 줄 소개 + 스크린샷 3장 (메인/Depth 2/Depth 3)
    · 아키텍처 다이어그램 (mermaid)
    · 백테스트 결과 표 (ARIMA 10.16% 강조)
    · 로컬 실행 명령 5줄

[ ] 데모 GIF
    강남역 입력 → 히트맵 → 카드 → Depth 3 → ARIMA 차트 흐름
    ScreenToGif 또는 OBS 녹화 후 압축
```

### 5. (선택) 이동수단 토글 — Depth 2 히트맵
```
[현재]  MapPanel 히트맵이 transitMinutes 기준으로만 색상
[목표]  헤더에 [대중교통][자차] 토글 버튼
        · 대중교통: 기존 transitMinutes 색상
        · 자차: carMinutes 색상 (구간별 비선형 추정값)
[규모]  MapPanel + useRecommendationStore 에 mode 필드 추가 ~2h
[전제]  자차 실경로 API 연동(#2) 완료 후 의미 있음
        미연동 상태에서 토글해도 추정값 표시 — 그래도 나쁘지 않음
```

---

## 🚀 새 세션 시작 루틴 (필독)

새 AI 세션이 시작되면 **반드시 이 순서로 컨텍스트를 읽을 것**:

```
1. server/doc/next-steps.md           ← 이 파일 (다음 작업 우선순위)
2. server/doc/2026-05-24/work-log.md  ← 직전 세션 작업 로그 (세션 1+2+3)
3. server/doc/db-state.md             ← DB 현황 스냅샷
4. server/doc/2026-05-24/proposal-draft.md ← 기획서 1차 초안
```

---

## ✅ 2026-05-24~25 완료 목록 (세션 1~3)

```
세션 1 (2026-05-24)
  · R-ONE rebClient.ts 전면 재작성 (KOSIS→R-ONE 정식 스펙)
  · t_reb_price_index 1,116건 적재 → 4,216건 확장
  · listRebTables.ts 신규 (STATBL_ID 검색 헬퍼)

세션 2 (2026-05-24)
  · RTMS 19년치 적재 (~1.3M 거래, 2006~2025)
  · ML repo R-ONE 정규화 인프라 (rebNormalize.ts)
  · 백테스트 5회 → ARIMA 10.16% 메인 모델 확정
  · 기획서 1차 초안 (proposal-draft.md)
  · ① 수익률 표현 제거 ✅
  · ② ARIMA 엔드포인트 + Depth 3 차트 교체 ✅
  · ③ 4기관 융합 배지 ✅
  · ④ 기획서 통계·KPI 채움 ✅
  · ⑤ typecheck EXIT:0 ✅

세션 3 (2026-05-25)
  · DemoBadge 하드코딩 제거 (source='mock' 시만) ✅
  · regions.ts lat 필터 제거 + BJD↔MOLIT 폴백 ✅
  · mockRegions 8개 legalDongCode 전수 수정 ✅
  · 자차 통근시간 비선형 구간 공식 (3분→20분 현실화) ✅
  · diagnoseDept3.ts + findMockRegionCodes.ts 진단 도구 ✅
```

---

## ⚠️ 알려진 기술 부채

```
① 자차 통근시간 = Haversine 직선거리 기반 추정
   → 카카오 모빌리티 API 연동 시 정확도 대폭 향상
   → KAKAO_REST_API_KEY 이미 보유, 추가 발급 불필요

② t_reb_price_index unique [sigunguCode, ym]
   → 매매·전세 동시 적재 시 마지막 호출이 이전 덮어씀
   → 현 매매 단독 적재로 OK, 전세 분리 필요 시 schema 확장

③ mockRegions 당산동 dong 필드 '당산동6가'
   → DB 검증으로 실제 저장값은 '당산동'
   → 이미 코드 `1156011700` 로 수정됨. dong 표시명도 맞게 수정돼 있음

④ Render 운영 환경 미검증 (로컬 정상, 운영 빌드 대기 상태)
```

---

## 🚀 새 세션 시작 루틴 (필독)

새 AI 세션이 시작되면 **반드시 이 순서로 컨텍스트를 읽을 것**:

```
1. server/doc/db-state.md             ← DB 현황 스냅샷
2. server/doc/next-steps.md           ← 이 파일 (다음 작업 우선순위)
3. server/doc/2026-05-24/work-log.md  ← 직전 세션 작업 로그 (세션 1+2)
4. server/doc/2026-05-24/proposal-draft.md ← 기획서 1차 초안 (검토 대상)
```

DB 스냅샷이 오래됐다면 사용자에게 먼저 실행 요청:
```powershell
cd server && npm run db:snapshot
```

---

## 🔥 D-7 컨셉 전환 (2026-05-22)

```
"직장인 + 투자 수익률"  →  "청년·신혼부부 주거 안전망"

사유:
  · 공공데이터 공모전 취지(사회적 가치) 와 "투자 어필" 의 거리
  · 2024 대상 "바로" 이후 부동산+AI 카테고리 천장 점유 → 차별화 어려움
  · 청년 주거 빈곤/정보 격차/1인가구 안전 = 정책 명분 직접 부합

평가 영향 (보수 추정):
  본점수 54~65 → 74~87  (+20)
  가점     +10 → +15    (+5  데이터 융합 가점 확보)
  대상 가능성 3~7% → 15~22%
  우수상     15~25% → 40~50%
  입상 합계  ~50% → 80~90%

상세: server/doc/2026-05-22/
  · pivot-rationale.md       전환 사유 + 5개 의사결정
  · 7day-roadmap.md          70h 일자별 작업 박스
  · scoring-redesign.md      4축 재정의 (투자 → 안전)
  · data-sources.md          4개 기관 융합 명세
  · work-log.md              22일자 작업 로그
```

---

## ✅ 직전 완료 (2026-05-21)

```
Sprint A — URL 공유 기능 (PDF 기획서 차별점 ⑥)
  · workplace + budget + weights + patience + preset 쿼리스트링 직렬화
  · 마운트 시 URL → 스토어 하이드레이션 (hydratedRef 가드)
  · 스토어 → URL 200ms 디바운스 replaceState (히스토리 폭주 방지)
  · [공유] 버튼 (Clipboard API + legacyCopy 폴백)
  · "복사됨"/"실패" 1.5s 토스트

Sprint B — 프리셋/공유/Mock fallback (오후)
  · WeightSliders 프리셋 버튼 a11y 보강 (type="button" + aria-pressed)
  · useShareUrl hook 분리 — Depth 2/3 공통
  · RegionDetailHeader 에 [공유] 버튼 추가
  · src/api/recommendations.ts — 실 API → mock 자동 폴백 (AbortController 지원)
  · store.dataSource 필드 + DemoBadge 컴포넌트 (Depth 2: mock 시 노출, Depth 3: 상시)
  · 에러를 숨기지 말 것 — console.warn + 우상단 DEMO 뱃지

Sprint C-1 — 서버 추천 API (밤)
  · POST /api/recommendations 신규 라우터
  · scoring.ts — 4축 단순 선형 정규화 + 가중합 (순수 함수)
  · recommendationRepository — workplace 좌표 기반 후보 + medianPrice + 수익률 + commute matrix
  · 행정동 centroid = t_apt_complex.lat/lng 평균
  · sigunguCodePrefix='11' (서울 한정, 전국 확장 시 prefix 빼면 자동)
  · typecheck 통과, 클라이언트 코드 변경 0 라인 (wrapper 가 자동 전환)

Sprint C-1 검증 + 시드 패치 (심야)
  · 진단: t_legal_dong 0건 + t_apt_trade cutoff 1년 (2025-05~) 데이터 범위 밖
  · 신규 server/scripts/seedLegalDong.ts — seoul-centroids.json 으로 ~470 행정동 시드 (1회차)
  · recommendationRepository cutoff 동적화: MAX(deal_date)-1년 + 0건 시 전체 fallback
  · package.json: "seed:legal-dong" script 등록

검증 2회차 — 행정동/법정동 불일치 발견 → BJD 정공 전환
  · seoul-centroids 는 행정동(ADM), t_apt_complex.legal_dong 은 법정동(BJD) → 매칭률 23.8%
  · 신규 server/scripts/seedBjd.ts — kr-legal-dong GitHub JSON 자동 fetch
  · 시군구 5자리 row 도 unique guCode 기반으로 같이 시드
  · iconv-lite / 사용자 파일 다운로드 모두 불필요 — npm run seed:bjd 한 줄

→ 상세: server/doc/2026-05-21/work-log.md
   · §1~§7   Sprint A
   · §8~§10  Sprint B
   · §11     Sprint C-1
   · §12     Sprint C-1 검증 1회차 + 시드 패치
   · §13     BJD 정공 전환 (1차)
   · §14     자동 fetch 단순화 (최종)

[2026-05-20 직전 완료]
  · Depth 3 (지역 상세) 1차 구현 — 2026-05-20/work-log.md
  · 서비스명 리브랜딩 "스마트 직세권" → "나어디삶" — 2026-05-20/rebranding.md
  · Depth 3 아키텍처 문서 — 2026-05-20/depth3-architecture.md
  · DB 운영 계정 root → molit 전환 가이드 (.env 만 변경, 권한 OK)
```

---

## 🎯 즉시 다음 (가장 우선) — 데이터 보강 트랙 ★

> Day 5 백테스트 실행 결과 시계열 64개월 한계 확인. 다음 세션에서 가장 먼저 처리.

### A. R-ONE 부동산원 지수 시드 — ✅ 완료 (2026-05-24)

```
[결과]   t_reb_price_index 1,116건 적재
         STATBL_ID: A_2024_00045 (매매), A_2024_00050 (전세)
         기간: ~2023-05 ~ 2026-04 (월별), 서울 25구 매칭
         기준점: 2026-01 = 100
[효과]   ✅ 가점 +5 데이터 융합 확정
[비고]   rebClient.ts 전면 재작성 (KOSIS → R-ONE 정식 스펙)
         listRebTables.ts 신규 (STATBL_ID 검색 헬퍼)
         상세: server/doc/2026-05-24/work-log.md
```

### B. 서울 10년치 RTMS 거래 데이터 보강 — 1~2일 야간 배치 ★

```
[현황]   t_apt_trade 251,197건 / 2020-01-01 ~ 2025-04-30 (64개월)
[목표]   2015-01 ~ 2024-12 보강 (5년치 추가) → 약 23만건 추가, 시계열 124개월
         (또는 더 보수적으로 2018-01 ~ 2019-12 만 = 24개월 추가)

[진입점] server/src/services/ingest/aptIngest.ts — 기존 BulkRunner 재활용
[환경변수]
   BULK_START_YM=201501
   BULK_END_YM=201912
   BULK_RATE_LIMIT_PER_SEC=2     # 국토부 OpenAPI 부담 완화
   BULK_SIGUNGU_FILTER=11        # 서울 전 시군구

[배치]   서울 25 시군구 × 60개월 = 1,500 API 호출
         초당 2호출 → 약 12분 + 5단계 retry 여유 → 30분 ~ 1시간

[보강 후 영향]
  · 백테스트 horizon 36개월 안정 (minTrain 60 + horizon 36 = 96mo 가능)
  · LSTM 학습 examples ×2.5 → MAPE 30~50% 개선 기대 (보수)
  · 단지 5개 → 10개 확장 가능 (자치구 5개 다양성 확보)
  · 기획서 톤: "2015~2025 11년치 분석" 신뢰도 ↑

[유의]   국토부 API rate-limit 주의 — 한 번에 너무 빨리 호출 시 차단
         BulkRunner 가 자동 backoff 처리하지만 시간 여유 잡아둘 것
```

### C. 백테스트 재실행 — 보강 완료 후

```
cd C:\git\2026_MOLIT_ML
BACKTEST_HORIZON=36 BACKTEST_MIN_TRAIN=48 npm run backtest:all

→ reports/plots/ 갱신 → Day 6 기획서 §기술 검증 별첨용 최종 PNG
→ "3년 가격 예측 정확도" 표 실측 갱신
```

### D. (선택) 2025-05 이후 거래 보강 — 0.5일

```
[전제]   국토부 RTMS 가 2026-05 시점에 2025-05 ~ 2026-04 까지 공개 시
[효과]   hold-out 가 가장 최신 → 청년 컨셉 톤 일관성 (2026년 정책 의사결정)
[명령]   BULK_START_YM=202505 BULK_END_YM=202604 ...
```

### E. (D-0 후) 외부 보조 시계열 — Day 7 + α

```
· 한국은행 OpenAPI 금리 시계열 (월별)
· KOSIS 인구 이동 (분기별)
· HUG 공급 통계 (분기별)
→ LSTM input feature 확장 (univariate → multivariate)
→ 공모전 제출 후 v2 개선
```

---

## 🎯 (참고) 컨셉 전환 5개 결정 → Day 1 진입 (이미 완료)

### Step 0. 30분 내 처리 (대기 시간 흡수용)

승인 대기 + 자료 준비 때문에 Day 1 오전이 통째로 날아갈 수 있음. **다른 작업 시작 전 처리**.

```
[ ] 한국부동산원 R-ONE API 신청  (승인 1~2일)
    https://www.reb.or.kr/r-one  →  OpenAPI 신청

[ ] 공공데이터포털 TAGO API 신청 (자동 승인)
    https://www.data.go.kr       →  "국가대중교통정보센터 TAGO"

[ ] LH 청년주택 API 신청          (자동 승인)
    https://www.data.go.kr       →  "한국토지주택공사 행복주택" 등

[ ] 베타 테스터 모집 글 초안       Day 1 아침 업로드용
```

### Step 1. 5개 의사결정 — pivot-rationale.md §5

```
[Q1] 4축 재정의   "통근/부담/안전/생활" — OK?
[Q2] 프리셋 4종   "사회초년생/신혼부부/실거주/직장인" — OK?
[Q3] 부제         "데이터 기반 청년 주거 의사결정 도구" — OK?
[Q4] LSTM 노출    "투자" 표현 → 제거 / 안정성 재정의 / Depth 3 부가
[Q5] 데이터 우선  R-ONE > LH > 안전 > TAGO 순으로 진행 — OK?
```

Q1~Q5 확정 후 Day 1 진입.

### Step 2. Day 1 — 한국부동산원 R-ONE 융합 (10h)

```
2h   R-ONE 인증 + 응답 형식 파악 + 호출 클라이언트 작성
3h   공동주택 실거래지수 수집 모듈 (시군구·월 단위)
3h   LSTM 학습 파이프라인에 보정 로직 추가
     · 실거래가 ÷ 부동산원 지수 = 정규화값 → LSTM → 복원
     · 시장 추세 노이즈 제거 → 동 단위 고유 변동만 학습
2h   DB 스키마 (t_reb_price_index) + 적재 스크립트
```

완료 효과: 가점 데이터 융합 **+5점** 확정 (입상권 진입 결정)

### Step 3 ~ Step 7 — 7day-roadmap.md 의 Day 2 ~ Day 7

```
Day 2 (10h)  TAGO 대중교통 융합 + LH 청년주택 진입
Day 3 (12h)  소득 분위 RIR + 안전 점수 + 청년 알고리즘
Day 4 (12h)  UI 컨셉 전환 (라벨/프리셋/필터)
Day 5 (12h)  LSTM 비교 검증 (MA-12 / ARIMA / LSTM)
Day 6 (14h)  기획서 전면 재작성 + 베타 응답 집계
Day 7 (12h)  GitHub 정비 + 증빙 패키지 + 최종 검수 + 제출
```

상세는 `server/doc/2026-05-22/7day-roadmap.md` 그대로 따라가면 됨.

---

## 🧪 (참고용) Sprint C-1 검증 절차

컨셉 전환 후에도 추천 API 동작 자체는 의미만 바뀌고 코드는 유지.
한 번 검증해두면 청년 컨셉 작업 중 회귀 감지 가능.

```powershell
# server 가동
npm run dev

# 강남역 호출 (가중치 합 100 가드 통과)
curl -X POST http://localhost:4000/api/recommendations `
  -H 'Content-Type: application/json' `
  -d '{\"workplace\":{\"lat\":37.4979,\"lng\":127.0276,\"label\":\"강남역\"},\"budget\":40000,\"weights\":{\"commute\":30,\"value\":25,\"investment\":20,\"life\":25},\"patience\":45}'
```

브라우저: http://localhost:5173/ → 강남역 → DEMO 뱃지 소거 → 카드 8건.

### ✅ Day 4 완료 (2026-05-23 세션 2)

```
[완료] client — 소득 분위 칩 UI (WeightSliders)
  · incomeQuintile 스토어 필드 + setIncomeQuintile 액션
  · WeightSliders: 1~5분위 칩 + 미선택(3분위 기본값) 칩
  · RecommendationRequest.incomeMonthly?: number 추가
  · index.tsx: incomeQuintile → QUINTILE_INCOME_MAP → incomeMonthly 변환 후 API 전달
  · useEffect 의존성 배열 + URL replaceState 에 incomeQuintile 포함

[완료] client — RegionCard RIR 색상 코딩
  · ≤30% 초록(positive) / 30~40% 노랑(amber-500) / >40% 빨강(negative)
  · 서버 region.rir 우선, 없으면 클라이언트 estimateRir(price) 추정
  · 1위 카드 + 2위 이하 카드 모두 적용

[완료] client — LH 청년주택 배지
  · lhComplexNearby > 0 일 때 "LH N" 초록 배지 (지역명 우측)

[완료] client — URL 직렬화 incomeQuintile
  · ?q=1~5 파라미터 (미선택 시 생략)
  · encodeStateToParams + decodeParamsToState + index.tsx 하이드레이션 연결
```

---

### ✅ Sprint C-2 완료 (2026-05-23 세션 3)
```
[완료] GET /api/regions/:legalDongCode/complexes → AptComplex[]
  · regions.ts 신규 라우터
  · t_apt_complex + t_apt_trade(최근 1년) + t_training_result 조합
  · 빈 배열 시 클라이언트 mock fallback

[완료] GET /api/lstm/:complexId → LstmAnalysis (96점 시계열)
  · lstm.ts 신규 라우터
  · t_apt_trade 60개월 actual + 예측 36개월 보간
  · 학습결과 없으면 선형 외삽 + confidence=50

[완료] client/src/api/regionDetail.ts 신규 (fetchComplexes + fetchLstm + mock fallback)
[완료] RegionDetailPage 실 API 연결 (useEffect + AbortController + LoadingBar)

[미완료] GET /api/commute/compare → 통근 비교 여전히 mock
[미완료] Depth 3 DEMO 뱃지 제거 (source='api' 확인 후)
```

### ✅ Sprint C-3 완료 (2026-05-23 세션 4)
```
[완료] GET /api/commute/compare?complexId=&wpLat=&wpLng=
  · t_apt_complex → 단지 좌표
  · t_legal_dong startsWith(sigunguCode) + dong 매핑
  · t_commute_matrix KNN 캐시 → ODsay 단일 호출 → Haversine 추정 (3단계 폴백)
  · DB 비동기 upsert (응답 지연 없음)
  · 응답: { transitMinutes, transfers, transitCost, carMinutes, carCost, source }

[완료] client fetchCommuteCompare() — API → mock → Haversine 3단계 폴백
[완료] RegionDetailPage commute useEffect 교체 (getMockCommuteCompare 제거)

[미완료] 서버 charset 검증 (npm run dev 재시작 후 한글 이름 확인 필요)
[미완료] Depth 3 DEMO 뱃지 — source='api' 확인 후 제거
```

### ✅ Day 5 코드 완료 (2026-05-23 세션 5) — LSTM 비교 검증 ★
```
[완료] ML repo (2026_MOLIT_ML) 백테스트 파이프라인
  · src/backtest/metrics.ts          MAPE / RMSE / R² 공통 평가
  · src/backtest/holdout.ts          시계열 train/test 36개월 분리
  · src/backtest/selectComplexes.ts  거래량 상위 5단지 자동 선정
  · src/backtest/ma12.ts             MA-12 베이스라인 (level + slope)
  · src/backtest/lstmEval.ts         LSTM recursive multi-step (horizon=1×36)
  · src/backtest/run.ts              entry 통합 + CSV dump 5종
  · scripts/backtest/arima.py        ARIMA(2,1,2) — statsmodels, (1,1,1) fallback
  · scripts/backtest/visualize.py    matplotlib PNG 4종 (forecast/MAPE/RMSE/summary)
  · scripts/backtest/requirements.txt
  · src/backtest/README.md           실행 가이드
  · package.json: backtest:run / arima / visualize / all 4 scripts

[미실행 — 사용자 직접 실행 필요]
  cd C:\git\2026_MOLIT_ML
  pip install -r scripts/backtest/requirements.txt
  npm run backtest:all
  → reports/plots/*.png 4종 + reports/backtest_results.csv

[결정사항]
  Q1 언어  하이브리드 (LSTM=TS 기존 자산 / ARIMA+시각화=Python)
  Q2 단위  단지(complex) 단위
  Q3 지역  거래량 상위 5단지 자동 선정 (서울 11% prefix + 60개월+ 시계열)

[근거 기록] server/doc/2026-05-23/work-log.md §Day 5
```

### Sprint C-3. 자동 백업 cron 등록 ★ (랜섬웨어 재발 방지)
```
[스크립트]  2026-05-19 work-log.md 의 auto-backup.ps1 참고
[등록]      Windows 작업 스케줄러 → 매일 03:00
[보관]      C:\backups\ + 7일 자동 정리
```
- Sprint C-1 진행 중간 30분 짬에 처리 가능

### Sprint C-4. (선택) RecommendationHeader 의 [공유] 버튼을 useShareUrl 로 통합
- 현재 21일 본 작업의 [공유] 버튼이 별도 로직 사용 중
- useShareUrl 로 교체하면 ~50줄 감소, 동작 동일
- 폴리시 우선순위 낮음

---

## 📈 단기 (Depth 3 후, 며칠 안)

### 1. 서울 10년치 거래 데이터 보강
```
[이유]    LSTM 시계열 길이 ↑ → 예측 신뢰도 ↑
[규모]    115만건 → 230만건 (60개월 → 120개월)
[방법]    server/src/services/ingest 의 aptIngest 재활용
          BulkRunner 로 야간 batch 실행
[부담]    국토부 API 호출 약 3,000건 (1주일 분산)
```

### 2. 이동수단 토글 (대중교통/자차)
```
[현재]    Depth 2 MapPanel 의 colorByCode 가 transitMinutes 기준
[목표]    헤더에 [대중교통][자차] 토글 → 모드별 매트릭스 사용
[연계]    Depth 3 CommuteCompare 와 일관성 ↑
[추정]    1~2시간 작업
```

---

## 🚀 중기 (발표 직전, D-3 ~ D-1)

### 1. TiDB 데이터 이관
```
1. mysqldump --single-transaction molit_contest > full.sql
2. TiDB Cloud SQL Editor 또는 mysql -h <tidb> 로 import
3. Render server 자동 빌드 통과 → 운영 라이브
4. 검증: Vercel 도메인에서 강남역 검색 → 즉시 응답
```

### 2. 발표 자료
```
[노션 메인 페이지]      서비스 한 줄 + 화면 흐름 + 차별 포인트
[기술 명세]             ERD + 컴포넌트 다이어그램 + LSTM 수식
[데모 영상]             3~5분, 강남역 시연 + 인내심 슬라이더 조작
[심사 자료]             평가 기준 매핑 (독창성/구체성/성장성)
```

### 3. 발표 데모 시나리오
```
1. 메인 진입 — "강남역" 칩 클릭
2. 인내심 슬라이더 조작 → 히트맵 실시간 갱신
3. 가중치 조정 → 추천 카드 재정렬
4. 1위 카드 클릭 → Depth 3 풀 LSTM 분석
5. 다른 직장 입력 → KNN 캐시 동작 (즉시 응답)
```

---

## 🌱 장기 (공모전 후)

### 후순위 — 우선순위 낮음
```
[1] 2000만건 전국 10년치 스케줄러 가동
    · t_ingest_job 큐 테이블 + Render Cron Job
    · 한 달간 자동 수집 + LSTM v2 재학습
    · TiDB 유료 플랜 전환 검토 (5GB 초과 시)

[2] Depth 1 (입력 페이지) 별도 분리
    · 현재 헤더 안에 통합 — 신규 사용자엔 부담
    · /input → /recommend 흐름 (튜토리얼)

[3] 모바일 반응형
    · 768px 미만 분기
    · 지도/카드 탭 토글
    · 슬라이더 큰 thumb

[4] KNN v2 — 거리 기반 (PostGIS / Haversine 정공)
    · 9격자 격자 경계 불연속 해소

[5] 캐시 TTL 90일 만료
    · t_commute_matrix.computed_at 기준 90일 이상은 무효 처리
    · 도로/노선 변경 반영
```

---

## 🧭 후임 개발자 onboarding

### 환경 세팅
```powershell
git clone <repo>
cd NaODiSalm_Main

# 루트
npm install

# .env 파일 (루트) — 비밀번호 직접 입력
notepad .env
# MYSQL_ROOT_PASSWORD=<강력한 값>
# MYSQL_PASSWORD=<별도 강력한 값>

# server/.env — DATABASE_URL + ODSAY_API_KEY + KAKAO_REST_API_KEY 등
notepad server\.env

# client/.env — VITE_KAKAO_MAP_KEY 등
notepad client\.env

# ⚠️ 2026_MOLIT_ML repo 도 같은 DB 를 사용하므로 .env 동기화 필수
# DATABASE_URL 을 server/.env 와 동일하게 (molit 계정 사용)
# root 계정은 sha256_password 인증으로 Prisma 5.x 미지원
notepad C:\git\2026_MOLIT_ML\.env

# Docker MySQL 기동
docker compose up -d

# Prisma 동기화
cd server
npx prisma migrate dev

# 모두 띄우기 (루트에서)
cd ..
npm run dev
```

### 필독 문서 (`server/doc/`)
```
2026-05-18/   초기 백엔드/UX 설계 + 시안 v1
2026-05-19/   디자인 톤 전환 + 행정동 히트맵 + ODsay + 랜섬웨어 사고
commute-cache-logic.md   캐시 동작 (4자리 반올림 + KNN 9격자)
next-steps.md            (현재 문서)
```

### 핵심 코드 진입점
```
client/src/pages/Recommendation/                새 메인 (Depth 2)
client/src/pages/Recommendation/components/     8개 컴포넌트
client/src/stores/                              Zustand (recommendation/auth/theme)
client/src/api/                                 fetch 래퍼

server/src/routes/domains/                      도메인 라우터
server/src/services/external/                   외부 API (MOLIT, ODsay, Kakao)
server/src/services/repositories/               Prisma 접근
server/prisma/schema.prisma                     스키마 단일 소스
```

### 보안 체크 (매주)
```sql
SELECT user, host FROM mysql.user;  -- 의심 계정 없는지
```
```powershell
netstat -ano | findstr :3306         # 0.0.0.0 노출 없는지
```

---

## 📌 현재 상태 스냅샷 (2026-05-20 기준)

```
DB         로컬 Docker MySQL · 115만 거래 + 강남역/광화문 ODsay 캐시
서버       로컬 npm run dev 정상 · 운영(Render) 빌드 오류 (의도된 대기)
클라이언트  로컬 정상 · Depth 3 1차 구현 완료 (mock) · npm install 대기
ML         로컬 학습 결과 t_training_result 에 저장 중
보안       127.0.0.1 바인딩 + 방화벽 + root@'%' 제거 완료
백업       어제 sqldump 1회 (자동 cron 미설정 — 등록 필요)
```

---

## ✅ Day 3 완료 (2026-05-23 오후)

```
완료
  · seedIncomeQuintile.ts (신규) — 통계청 2023 소득 5분위 하드코딩 upsert
  · seedSafetyIndex.ts (신규) — 서울 25개 자치구 공개통계 안전지표 합성 (~424동)
      totalScore = 0.5×crimeScore + 0.3×lightScore + 0.2×cctvScore
      행정동 편차: dongCode 기반 결정론적 ±8점
  · scoring.ts:
      MONTHLY_COST_RATE / DEFAULT_MONTHLY_INCOME_MANWON(=403) 상수 추가
      calcRir(price, income?) 헬퍼 export
      affordabilityScore: 가격역선형 → RIR 역선형 (0.20~0.50)
      ScoredRegion에 rir: number 필드 추가
      scoreRegion / pickTopRegions에 income 파라미터 추가
  · recommendationRepository: 5-D t_safety_index $queryRaw 추가, safetyBase 실데이터 교체
  · recommendations.ts: incomeMonthly? body 파라미터 + rir 응답 필드
  · package.json: seed:income / seed:safety 스크립트 추가
  · typecheck: 샌드박스 npm 차단 → 로컬 Windows에서 실행 필요

사용자 직접 실행 필요
  npm run seed:income        (t_income_quintile 5건)
  npm run seed:safety        (t_safety_index 서울 ~424개 동)
  npx tsc --noEmit           (typecheck 확인)
```

## ✅ Day 2 완료 (2026-05-23)

```
완료
  · lhClient.ts (신규) — LH 행복주택/청년매입임대/전세임대 API 클라이언트
  · seedLhYouthHousing.ts (신규) — 서울 25개 시군구 LH 청년주택 수집
  · tagoClient.ts (신규) — TAGO 버스정류장·배차간격·첫막차 API 클라이언트
  · seedTransitSummary.ts (신규) — 행정동별 대중교통 품질 점수 적재
  · Prisma 스키마: TransitRouteSummary (t_transit_route_summary) 추가
  · scoring.ts commuteScore: transitScore 보정 추가 (0.75*base + 0.25*transit)
  · recommendationRepository: transitScore + lhComplexNearby 조회 연동
  · routes/recommendations.ts: 응답에 transitScore/lhComplexNearby 추가
  · client/types/recommendation.ts: transitScore? 필드 추가
  · package.json: seed:lh / seed:transit 스크립트 추가
  · typecheck server EXIT:0, client EXIT:0

사용자 직접 실행 필요
  npx prisma db push        (t_transit_route_summary 테이블 생성)
  npm run seed:lh           (LH_API_KEY 또는 PUBLIC_DATA_KEY 필요)
  npm run seed:transit      (TAGO_API_KEY 또는 PUBLIC_DATA_KEY 필요)
```

## ✅ Day 1 완료 (2026-05-22 저녁)

```
완료
  · Q1~Q5 5개 의사결정 확정
  · 4축 rename (affordability/safety) — client + server 전체
  · scoring.ts / recommendationRepository / routes 업데이트
  · UI 컴포넌트 4개 컨셉 전환 (WeightSliders/RegionCard/RegionDetailHeader/mockRegions)
  · Prisma 스키마: RebPriceIndex / LhYouthHousing / SafetyIndex / IncomeQuintile 추가
  · rebClient.ts / seedRebPriceIndex.ts / rebNormalize.ts 신규 작성
  · npx prisma db push 완료 (DB already in sync)
  · typecheck server EXIT:0, client EXIT:0

남은 Day 1 액션 (사용자 직접)
  · npm run seed:reb   ← R-ONE-KEY 발급 완료 후 실행
```

## 🚦 다음 세션(D-5) 시작 시 첫 한 줄

> **"먼저 `reports\backtest_results.csv` 메트릭 5분 검토 → `npm run seed:reb` (10분) → RTMS 5년치(2015~2019) 보강 배치 시작 (1~2일, 백그라운드) → 배치 진행 중 Day 6 §사회적 가치 + §차별성 표 작성 병행. 보강 완료 후 `BACKTEST_HORIZON=36 npm run backtest:all` 재실행 → 최종 PNG."**

### 🔀 트랙 분기 (Day 6 진입)

```
[트랙 1 — 데이터 보강 (배치, 백그라운드)]
  R-ONE 시드 → RTMS 5년치 보강 → 백테스트 재실행
  소요: 1~2일 (대부분 야간 배치 대기)
  결정타: 가점 +5 + LSTM 정확도 +30~50% + 기획서 신뢰도

[트랙 2 — 기획서 작성 (병행)]
  §사회적 가치 / §차별성 표 / §활용 데이터 표 → 트랙 1 결과 무관 작성 가능
  §기술 검증 만 트랙 1 완료 후 PNG 삽입
  소요: 6~8h

두 트랙 병행으로 D-5 ~ D-4 동안 진행 권장.
```

### Day 6 작업 목록 (14h, 기획서 + 베타 집계)

```
오전 (6h) — 기획서 전면 재작성
  · 1h   활용 데이터 표 → 공공기관 4개로 확장 (MOLIT/REB/TAGO/LH/통계청/경찰청)
  · 1h   차별성 비교 표 (직방 / 바로 / 나어디삶)
  · 1.5h 사회적 가치 섹션 2배 확장 (청년 주거 빈곤·정보 격차 통계)
  · 1.5h 기술 검증 섹션 (LSTM 백테스트 표·그래프 — Day 5 PNG 삽입)
  · 1h   기대효과 + 창업 로드맵 단계별 KPI

오후 (8h) — 베타 응답 집계 + 사용성 데이터
  · 4h   베타 응답 집계 (구글폼 / 부동산스터디 / 클리앙)
  · 4h   사용성 데이터 정리 (응답 그래프 + 정성 인터뷰 3건)
```

### 다음다음 세션(D-4 ~ D-0, Day 7+) 첫 한 줄

> **"Day 7 시작 — GitHub README 전면 재작성 + 증빙 패키지 + 최종 검수 + 제출."**

---

## 📜 과거 세션 첫 한 줄 (참고)

> Day 4 시작 — UI 컨셉 전환. `WeightSliders` incomeMonthly 분위 선택 추가 → `RegionCard` rir/lhComplexNearby 배지 → (여유시) Sprint C-2 regions/:code/complexes API.

### Day 4 작업 목록 (12h)

```
필수
  · WeightSliders: 소득 분위 선택 UI (1~5분위 칩, 미선택=3분위 기본)
    - useRecommendationStore 에 incomeQuintile: 1~5 | null 필드 추가
    - POST body에 incomeMonthly 자동 매핑 (quintile → 만원 변환 테이블)
  · RegionCard:
    - "주거비 N%" 배지 (rir × 100 반올림, 예: "주거비 30%")
    - "주변 청년주택 N개" 배지 (lhComplexNearby > 0 시 노출)
  · (선택) rir 색상 구분: ≤30% 초록 / 30~40% 노랑 / >40% 빨강

Sprint C-2 (여유 시)
  · GET /api/regions/:legalDongCode/complexes → AptComplex[]
  · GET /api/lstm/:complexId              → LstmAnalysis
  → Depth 3 DEMO 뱃지 소거 목적
```

상세 정리 문서:
```
server/doc/2026-05-22/
  ├─ pivot-rationale.md     컨셉 전환 사유 + 5개 의사결정 (Q1~Q5)
  ├─ 7day-roadmap.md         70h 일자별 작업 박스 + 컷오프 우선순위
  ├─ scoring-redesign.md     4축 재정의 (investment → safety, value → affordability)
  ├─ data-sources.md         4개 기관 융합 명세 (R-ONE / TAGO / LH / 안전)
  └─ work-log.md             22일자 작업 로그 + 즉시 처리 4가지
```

### 컨셉 전환 후 권장 순서 (D-7 ~ D-0)

```
[Q]  5개 의사결정 확인                                ← 30분
[Step 0] API 4건 신청 (R-ONE / TAGO / LH / 베타글)   ← 30분
[Day 1]  한국부동산원 R-ONE 융합 (가점 +5 확정)        ← 10h
[Day 2]  TAGO + LH 진입                              ← 10h
[Day 3]  소득 분위 + 안전 점수 + 청년 알고리즘          ← 12h
[Day 4]  UI 컨셉 전환 + 청년 필터                    ← 12h
[Day 5]  LSTM 비교 검증 (구체성 결정타)              ← 12h
[Day 6]  기획서 재작성 + 베타 집계                    ← 14h
[Day 7]  GitHub / 증빙 / 검수 / 제출                 ← 12h
```

### 폐기 / 흡수 / 유지

```
폐기   investor 프리셋 / "3년 수익률" 직설 표현
흡수   scoring.ts 4축 골격 → 의미 교체 (investment → safety, value → affordability)
유지   Sprint A/B/C-1 인프라 / BJD 시드 / ODsay 캐시 / 토스 디자인 톤
```

### 시간 부족 시 컷오프

```
1차 컷  베타 응답 수집 → 정성 인터뷰 5건으로 축소
2차 컷  1인가구 안전 점수 → LH 청년주택만 유지
3차 컷  ARIMA 비교 → MA-12 vs LSTM 만
🚫 절대 포기 금지: R-ONE 융합 / 청년 컨셉 전환 / LSTM 백테스트 1개 / 기획서 재작성
```

위에서부터 진행하면 됩니다.
