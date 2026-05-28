# 작업 로그 — 2026-05-28 (D-1, Depth 3 신뢰도 50 픽스 + ML 인프라)

## 한 줄 요약

> **Depth 3 도넛 신뢰도 50 픽스 — 근본 원인 진단 + 3중 패치 완료.** 진단 스크립트로 t_training_result 2,143건 confidence 전부 NULL + 단지의 59%가 ARIMA `monthlyRows < 4` 폴백 진입 확인. ARIMA endpoint는 단지→행정동→시군구 3단계 폴백, LSTM endpoint는 mape/sampleCount 기반 동적 산출. ML repo train.ts:99 의 TODO 해결 + backfill/stats CLI 신설. typecheck 양측 EXIT:0.

---

## 0. 진입 컨텍스트

- 직전 세션(2026-05-27): UI/UX 정돈 + 모바일 반응형 + LH 재설계, ODsay quota.
- 사용자 보고: "3뎁스에서 모든 모델의 신용도가 50으로 픽스된 점이 가장 큰 이슈"
- 본 세션: 진단 → 처방 결정 → 코드 패치 → ML 인프라 → typecheck 검증.

---

## 1. 진단 (npm run diagnose:confidence)

신규 스크립트 `server/scripts/diagnoseConfidence.ts` 가 5개 섹션으로 root cause 확정.

### 1.1 결정적 발견

```
[A] t_training_result.confidence 분포
    총 학습 결과: 2,143건
    confidence NULL: 2,143건 (100%) ← server 코드 `?? 0.7` 폴백 → 모든 LSTM 70 픽스

[B] LSTM 학습 결과 커버리지
    전체 단지: 10,019건
    매칭된 단지 (sigunguCode+legalDong 키): 9,677건 (96.6%)
    미매칭 (LSTM 폴백): 342건 (3.4%)

[C] 거래량 상위 10단지 ARIMA/LSTM 시뮬레이션
    헬리오시티/파크리오/잠실엘스 등: ARIMA 75~88, LSTM 70 (NULL → 0.7 폴백)

[D] 전체 단지 ARIMA `monthlyRows < 4` 폴백 진입률
    < 4개월: 5,909건 (59.0%) ← ARIMA confidence=50 픽스
    4~11개월: 1,939건 (19.4%)
    ≥24개월: 896건 (8.9%)
```

### 1.2 사용자가 보던 "모든 모델 50 픽스"의 정체

- 클릭한 단지가 저거래량(< 4개월) → **ARIMA = 50 즉시 폴백**
- LSTM은 사실 70 픽스였지만 도넛이 `primary = arima ?? lstm` 우선이라 ARIMA 50 가 표시됨
- 본질적으로 **단지(complex_id) 단위 데이터 sparsity** 가 ARIMA 50 픽스의 직접 원인

---

## 2. 처방 (사용자 확정 — Fix 1 + 2 + 3, MAPE 기반)

### 2.1 Fix 1 — LSTM endpoint MAPE/sampleCount 기반 동적 산출

`server/src/routes/domains/lstm.ts`

```typescript
function calcLstmConfidence(mape, sampleCount): { confidence, detail } {
  if (mape == null || sampleCount == null || sampleCount <= 0) {
    return { confidence: 70, detail: '학습 메트릭 미저장 (보수적 기본값)' };
  }
  const base = 100 - mape * 1.5;
  const bonus = Math.log10(Math.max(1, sampleCount)) * 5;
  return {
    confidence: clamp(50, 95, round(base + bonus)),
    detail: `MAPE ${mape}%, 학습 샘플 ${sampleCount}건`,
  };
}
```

기존 `Math.round((trainingResult.confidence ?? 0.7) * 100)` → 모든 단지 70 픽스 해소.

### 2.2 Fix 2 — ARIMA endpoint 3단계 폴백

`server/src/routes/domains/arima.ts`

```
STEP 1: complex_id 기준          (가장 정밀, 단지 고유 추세)
STEP 2: sigungu + legal_dong     (행정동 집계, 50~70개 단지 평균)
STEP 3: sigungu_code             (시군구 집계, 수백 단지 평균)
STEP 4: 모두 < 4 → confidence=50 폴백
```

- 격상 시 신뢰도 페널티: LEGAL_DONG -5, SIGUNGU -10
- 현재가(currentPricePerM2)는 항상 단지 데이터 우선 → 절대값 왜곡 회피
- 성장률(비율)만 격상된 평균에서 추출해서 단지 currentPricePerM2 에 적용
- `disclaimer` 단계별 차별화 (정직 톤)

### 2.3 Fix 3 — UI 도넛 옆 데이터 출처 칩

`client/src/types/region-detail.ts` + `client/src/pages/RegionDetail/components/LstmFullAnalysis.tsx`

```typescript
// 새 타입
export type ConfidenceDataScope = 'COMPLEX' | 'LEGAL_DONG' | 'SIGUNGU' | 'INSUFFICIENT';

// LstmAnalysis 에 추가
dataScope?: ConfidenceDataScope;
confidenceDetail?: string;

// UI 칩 색상
COMPLEX      → bg-positive/15  text-positive  (단지 데이터)
LEGAL_DONG   → bg-brand/15     text-brand     (행정동 평균)
SIGUNGU      → bg-amber-500/15 text-amber-600 (시군구 평균)
INSUFFICIENT → bg-negative/15  text-negative  (데이터 부족)
```

도넛 툴팁에는 `confidenceDetail` 노출 — "MAPE 8%, 학습 샘플 500건" 같은 구체 근거.

---

## 3. 검증 결과 (사용자 직접 실행)

```
curl http://localhost:4000/api/arima/7002 (헬리오시티, 48개월 거래)
  confidence: 88
  dataScope: 'COMPLEX'
  confidenceDetail: '단지 거래 48개월, R²=0.82, 연성장률 12.0%'
  → 정상 작동 ✅

curl http://localhost:4000/api/arima/999 (저거래량 단지, 6개월 거래)
  confidence: 54
  dataScope: 'COMPLEX'
  confidenceDetail: '단지 거래 6개월, R²=0.00, 연성장률 4.6%'
  → 6개월은 < 4 가 아니라 COMPLEX 그대로 사용. R²=0 반영해 54 (정상)

curl http://localhost:4000/api/lstm/7002
  confidence: 50
  dataScope: 'LEGAL_DONG'
  confidenceDetail: 'MAPE 106.8%, 학습 샘플 40건'
  → LSTM 학습 자체가 MAPE 106% (망가진 수준) → 50 floor 적용. 정직 톤.
  → 도넛은 ARIMA 88 우선 표시되므로 사용자 체감 영향 적음.
```

---

## 4. ML repo LSTM 재학습 인프라 (D-2 위험 인지하고 진행)

train.ts:99 의 `confidence: null` TODO 해결 + 안전한 backfill 명령 신설.

### 4.1 신규 파일

```
ML repo (C:\git\2026_MOLIT_ML)
  src/utils/confidence.ts             신규  ~60 lines
    · calcLstmConfidence(mape, sampleCount)
    · server lstm.ts 와 동일 산식 (forDb 0~1, display 0~100)

  src/scripts/trainStats.ts           신규  ~140 lines
    · 5개 섹션 통계: 전체 row 수, MAPE 분포, sampleCount 분포,
      modelVersion 별 평균, backfill 시뮬레이션
    · npm run train:stats

  src/scripts/backfillConfidence.ts   신규  ~110 lines
    · t_training_result.confidence NULL → mape/sampleCount 기반 산출값 UPDATE
    · --dry / --force 옵션
    · 재학습 X (30초 내 완료)
    · npm run train:backfill
```

### 4.2 train.ts 수정

```typescript
// Before (line 99):
confidence: null, // 추후 변동성 기반 산출

// After:
const confResult = calcLstmConfidence(mape, examples.length);
// ...
confidence: confResult.forDb, // ← MAPE 기반 동적 산출 (NULL 가능)
modelMeta: {
  ...
  confidenceDetail: confResult.detail,  // 메타에 산출 근거 기록
},
```

### 4.3 package.json 스크립트

```json
"train:once": "tsx src/train.ts --once",
"train:stats": "tsx src/scripts/trainStats.ts",
"train:backfill": "tsx src/scripts/backfillConfidence.ts",
"train:backfill:dry": "tsx src/scripts/backfillConfidence.ts -- --dry"
```

### 4.4 권장 실행 순서 (D-2 안전 경로)

```powershell
cd C:\git\2026_MOLIT_ML
npm run train:stats          # 현황 파악
npm run train:backfill:dry   # 시뮬레이션
npm run train:backfill       # 적용 (~30초)
# 시간 충분할 때만:
LIMIT=1 npm run train:once   # 1개 단지 재학습 테스트
npm run train:once           # 전체 재학습 (수십분, 위험)
```

---

## 5. 사전 typecheck 에러 2건 (내 변경과 무관, 같이 수정)

### 5.1 `mockComplexes.ts` 파일 손상 복구

279줄에서 파일이 잘려 있었음 (`bui` 로 끝남). 복구:
- 신도림 SK뷰 (`C-1153010400-03`) 단지 데이터 완성
- `COMPLEXES_BY_REGION` 닫는 `}`
- `getMockComplexesForRegion(legalDongCode)` 함수
- `findMockComplex(complexId)` 함수 (mockLstmResults/mockCommuteCompare 에서 import 중)

### 5.2 `recommendations.ts:134` complexCount 타입 누락

```typescript
// scoring.ts RegionMetrics 에 추가
complexCount: number;

// recommendationRepository.ts candidates 조립에 추가
complexCount: c.agg.complexCount,
```

---

## 6. 변경 파일 통계

```
서버 (C:\git\NaODiSalm_Main\server)
  src/routes/domains/lstm.ts                   +60 lines (calcLstmConfidence + 동적 산출)
  src/routes/domains/arima.ts                  +80 lines (3단계 폴백 + dataScope)
  src/services/recommendation/scoring.ts        +6 lines (complexCount 필드)
  src/services/repositories/recommendationRepository.ts  +2 lines (complexCount 전달)
  scripts/diagnoseConfidence.ts              신규 ~250 lines
  package.json                                  +1 script

클라이언트 (C:\git\NaODiSalm_Main\client)
  src/types/region-detail.ts                   +12 lines (ConfidenceDataScope)
  src/pages/RegionDetail/components/LstmFullAnalysis.tsx  +25 lines (SCOPE_META 칩)
  src/pages/RegionDetail/data/mockComplexes.ts +25 lines (잘린 부분 복구 + findMockComplex)

ML repo (C:\git\2026_MOLIT_ML)
  src/utils/confidence.ts                    신규  ~60 lines
  src/scripts/trainStats.ts                  신규 ~140 lines
  src/scripts/backfillConfidence.ts          신규 ~110 lines
  src/train.ts                                  +6 lines (TODO 해결)
  package.json                                  +4 scripts

총 신규/수정 합계   ~780 lines
```

---

## 7. typecheck 검증

```
cd server  && npm run typecheck   → EXIT:0 ✅
cd client  && npm run typecheck   → EXIT:0 ✅
```

---

## 8. 함정 (다음 세션 인지)

```
① ARIMA dataScope='LEGAL_DONG' 격상 시
   currentPricePerM2 는 단지 데이터 우선 사용하지만,
   단지 거래 0건이면 행정동 평균을 현재가로 표시.
   → 이 경우 disclaimer 에 명시 (정직 톤 유지)

② LSTM MAPE 106.8% (헬리오시티)
   학습 자체 품질 문제 — train.ts 의 WINDOW=24 / HORIZON=36 / epochs=30 조합이
   단지 단위에서는 noise 가 큼.
   해결책: 행정동 집계 학습으로 격상 or 하이퍼파라미터 튜닝.
   D-1 위험 고려해 미수행 — backfill 만 적용 권장.

③ t_training_result.confidence NULL 2,143건 전부
   train.ts:99 의 TODO 가 ~6주 동안 미해결로 있었음.
   → 패치 후 다음 학습부터 자동으로 채워짐.
   → 기존 NULL row 는 backfill 명령으로 즉시 해소 가능.

④ findMockComplex / mockComplexes.ts
   파일이 어딘가에서 잘려 있었음 (git log 확인 필요할 수도).
   복구 후 신도림 SK뷰 1개만 남았는데 원래 의도는 모를 수 있음.
   현재 mock 동작에 큰 영향 없음 (정상 동작).
```

---

## 9. 미해결 / 다음 세션

```
[ ] 사용자가 ML repo 명령 실행 결정:
    · npm run train:stats        — 즉시 (재학습 없음)
    · npm run train:backfill     — 30초 (재학습 없음)
    · npm run train:once         — 수십분 (재학습, 위험)

[ ] 다음 트랙 (사용자 확정):
    · 기획서 §6 KPI + 4기관 데이터 융합 UI (가점 +5 어필)
    · 사회적 가치 통계 4개 수치 채우기
    · about/data 페이지 또는 데이터 출처 배너

[ ] 후순위 (시간 허락 시):
    · Phase 2-B: LH 단지 주소 카카오 지오코딩 (행정동 정밀도)
    · Phase 2-A: 수도권(경기·인천) 거래내역 시드
    · Phase 2-C: 거래유형 토글 UI (매매/전세/월세)
    · Render 운영 배포 점검
```

---

## 10. 다음 세션 첫 한 줄

> **"신뢰도 50 픽스 ✅ + ML 인프라 ✅. 사용자가 npm run train:stats / train:backfill 실행해서 결과 공유 후, 기획서 §6 KPI 작성 + 4기관 데이터 융합 UI(about/data 페이지) 진입."**

---

# Part 2 — 2026-05-27 PM 세션 (Phase 2-B + about/data + 기획서·README 슬롯)

> 실제 작업일은 2026-05-27. 28일 work-log 와 동일 폴더에 후속 섹션으로 통합.
> ML 모델 작업은 별도 세션 처리 가정 — 본 세션은 client/server + 기획서·README만.

## 11. 한 줄 요약

> **Phase 2-B(LH 카카오 지오코딩) + /api/meta/data-sources + /about/data 페이지 + 기획서 §6 운영KPI 슬롯 + README 스크린샷 자리 잡기.** 28일 work-log §9 미해결 3건 중 2건 해소(4기관 융합 UI ✅ / 기획서 KPI 자리 잡기 ✅) + Phase 2-B 진입.

## 12. 본 세션 배경 정리

- 28일 work-log 작성 직후 사용자가 "ML 모델은 다른 세션, 클라이언트/서버 트랙은 7일 계획과 매칭 점검 후 진행" 요청.
- 7일 로드맵 vs 실제 진행 매트릭스에서 **TAGO 누락 / LH 행정동 정밀도 / 4기관 융합 UI / §6 운영KPI / README 슬롯 / 베타·증빙 / 27일 §② Prisma history** 갭 식별.
- 도전안(Phase 2-B 포함) 선택 + Prisma 정리 같이 + 기획서 §6 KPI는 자리만 결정.

## 13. Phase 2-B — LH 단지 주소 카카오 지오코딩

### 13.1 진단

```
기존 lhClient.ts:153
  legalDongCode: sigunguCode     // ← 시군구 5자리만 저장 (LH 응답에 dong 코드 없음)

→ 같은 강남구 어느 동에 가도 동일 LH 배너 (정밀도 0)
→ recommendationRepository lhCountMap 가 5자리 prefix 매칭 (27일에 임시 수정)
→ regions.ts /lh-summary 도 시군구 5자리 정확 일치만
```

### 13.2 처방 — A→B→C→D 4단계

| 단계 | 파일 | 변경 |
|---|---|---|
| A | `server/src/services/external/geocoder.ts` | `coord2regioncode()` + `addressToLegalDongCode()` 신규. Kakao `/v2/local/geo/coord2regioncode.json` 호출 → `region_type='B'` = BJD 10자리. |
| B | `server/scripts/seedLhYouthHousing.ts` | 전면 재작성. `--reset` / `--no-geocode` 플래그, in-memory cache `Map<addr, bjd>`, 진행률 + 정밀도 분포 로그. 시군구 간 200ms · row 간 50ms rate-limit. |
| C | `server/src/services/repositories/recommendationRepository.ts` | `lhCountMap` 을 (a) 10자리 정확 일치 + (b) 5자리 시군구 폴백 합산으로 전환. 두 raw query 병행. |
| D | `server/src/routes/domains/regions.ts` | `/lh-summary` 응답에 `scope: 'DONG'\|'SIGUNGU'\|'INSUFFICIENT'` + `legalDongCode` + `sigunguTotalRows/Units` 추가. `aggregate()` 헬퍼로 중복 제거. |

### 13.3 클라이언트 동기화

| 파일 | 변경 |
|---|---|
| `client/src/types/region-detail.ts` | `LhSummaryScope` type + `LhSummary` 에 optional 필드 4종 (`legalDongCode`/`scope`/`sigunguTotalRows`/`sigunguTotalUnits`) |
| `client/src/pages/RegionDetail/components/LhAggregateBanner.tsx` | `dongDisplayName` prop + `scopeMeta()` 함수. scope=DONG → "역삼동 ... [행정동]" 칩, SIGUNGU → "강남구 ... [시군구]" 칩. DONG 모드에서 시군구 통계 비교 노출. |
| `client/src/pages/RegionDetail/index.tsx` | `<LhAggregateBanner dongDisplayName={region.dong}>` 1줄 |
| `client/src/pages/RegionDetail/data/mockLhSummary.ts` | `SUMMARY_BY_DONG` (1156013000 당산동 데모) + DONG/SIGUNGU/INSUFFICIENT 분기. 기존 SIGUNGU 데이터 보존. |

### 13.4 운영 절차 (사용자)

```powershell
cd C:\git\NaODiSalm_Main\server
npm run seed:lh -- --reset      # 기존 5자리 row 삭제 후 지오코딩 결과로 재적재
# 마지막 로그:
#   지오코딩: ok N / fail M / cache hit K / 주소없음 skip S
#   코드 정밀도: 시군구 5자리=A / 행정동 10자리=B / 기타=C
# → B/(A+B+C) 비율이 지오코딩 성공률
```

## 14. about/data 페이지 + /api/meta/data-sources

### 14.1 서버 신규 라우터

```
server/src/routes/domains/meta.ts      신규 ~200 lines
  public — 인증 불필요
  GET /api/meta/data-sources
    응답: {
      asOf: "2026-05-27 14:32 KST",
      totalRows: 1,317,000,
      sources: [
        { id, agency, agencyEn, name, description,
          rowCount, rowLabel, lastUpdated, apiUrl, tables, badge },
        ... 4기관
      ]
    }

server/src/routes/api.ts               +2 lines
  apiRouter.use('/meta', metaRouter)
```

`safeCount()` 헬퍼로 테이블 미생성 시 0 fallback — 운영/개발 환경 차이 graceful.

### 14.2 클라이언트 신규 페이지

```
client/src/pages/AboutData/index.tsx   신규 ~230 lines
  /about/data 라우트
  fetch('/api/meta/data-sources') → 카드 4종 렌더
  서버 미응답 시 정적 FALLBACK
  카드: 좌측 보더 색상으로 기관 구분 (brand/positive/amber/purple)
  하단 푸터: asOf 안내 + 보안(인증키) 멘트

client/src/App.tsx                     +2 lines
  <Route path="/about/data" element={<AboutDataPage />} />

client/src/pages/Recommendation/components/RecommendationHeader.tsx  +7 lines
  헤더에 "데이터 출처" 링크 (sm+ 노출)
```

## 15. 기획서 §6 운영KPI 슬롯 + §4 실시간 검증 안내 + Phase 2-B 산출물 박스

`server/doc/2026-05-24/proposal-draft.md` 보강:

- **§4 표**: 적재량 셀에 `[채울 곳: about/data 페이지 확인]` 슬롯 + 상단 안내 박스
- **§6 "운영·품질 KPI" 신규 서브섹션**: 6개 지표 표 (응답 p95 / 행정동 매칭률 / ARIMA MAPE / LH 지오코딩 성공률 / NPS / 데이터 융합 횟수). 사용자 직접 채울 위치 + 검증 가이드 4단계.
- **§6 "Phase 2-B 산출물 박스"**: R-ONE ✅ / LH 정밀화 ✅ / /api/meta/data-sources ✅ / /about/data ✅ / TAGO ⌛(Phase 3)

## 16. README 추가 슬롯

`README.md` 보강:

- **📸 화면 (Day 7 첨부 예정)**: 5개 스크린샷 슬롯 + `docs/screenshots/` 경로 안내
- **🎬 데모 영상**: [채울 곳] 슬롯
- **융합 데이터 출처**: about/data 페이지 안내 + Phase 2-B 변경 박스
- **관련 저장소**: ML repo 명령(train:stats / train:backfill / backtest) 추가
- **운영 명령 (server)** 섹션 신설: seed:reb / seed:lh --reset / seed:safety / seed:income / diagnose:* / admin ingest curl 예시

## 17. 변경 파일 통계 (본 세션)

```
서버 (6)
  src/services/external/geocoder.ts                                   +60  lines (coord2regioncode + addressToLegalDongCode)
  scripts/seedLhYouthHousing.ts                                       ~190 lines (전면 재작성)
  src/services/repositories/recommendationRepository.ts               +25  lines (lhCountMap 10/5 합산)
  src/routes/domains/regions.ts                                       +60  lines (/lh-summary scope 확장)
  src/routes/domains/meta.ts                              신규        ~200 lines (4기관 메타)
  src/routes/api.ts                                                   +2   lines (meta 마운트)

클라이언트 (6)
  src/types/region-detail.ts                                          +15  lines (LhSummaryScope)
  src/pages/RegionDetail/components/LhAggregateBanner.tsx             +30  lines (scope 칩)
  src/pages/RegionDetail/index.tsx                                    +1   line  (dongDisplayName)
  src/pages/RegionDetail/data/mockLhSummary.ts                        +50  lines (DONG/SIGUNGU/INSUFFICIENT)
  src/pages/AboutData/index.tsx                          신규         ~230 lines
  src/App.tsx                                                         +2   lines
  src/pages/Recommendation/components/RecommendationHeader.tsx        +7   lines

문서 (2)
  server/doc/2026-05-24/proposal-draft.md                             +60  lines (§4 안내 / §6 운영KPI + Phase 2-B 박스)
  README.md                                                           +60  lines (스크린샷 / 데모 영상 / Phase 2-B 박스 / 운영 명령)
  server/doc/2026-05-28/work-log.md                                   +본 Part 2 (현재 작성 중)

총 신규/수정 합계   ~1,000 lines
```

## 18. typecheck 결과

- 샌드박스 bash `npx tsc --noEmit` — `regions.ts:370` / `recommendationRepository.ts:421` 가짜 에러 2건 (27일 work-log §6 mount sync gap 재현).
- Windows 측 검증 대기 — 사용자가 `cd server && npm run typecheck` + `cd client && npm run typecheck` 실행 후 결과 공유.
- 새 코드는 기존 패턴(`prisma.$queryRaw` + `Prisma.join`, `safeCount`, `Map<string, number>`) 그대로 사용 → 회귀 위험 낮음.

## 19. 사용자 측 후속 작업 (우선순위)

```
[★★★] Windows typecheck 양측 EXIT:0 확인 (server + client)
[★★★] cd server && npx prisma migrate status        — 결과 공유 (history 정리 명령 결정)
[★★]  cd server && npm run seed:lh -- --reset       — Phase 2-B 데이터 적재
[★★]  cd client && npm run dev → 회귀 5점:
        - 당산동(1156013000) LH 배너 "당산동 ... [행정동]" 노출
        - 강남구(1168010600) LH 배너 [시군구] 또는 숨김
        - Depth 3 도넛 dataScope 칩 정상 (COMPLEX/LEGAL_DONG/SIGUNGU)
        - 예산 슬라이더 1천만~15억
        - ODsay quota /api/admin/odsay-usage
[★]   /about/data 진입 — 4기관 카드 + 실시간 row 수 확인
[★]   ML 세션 결과 도착 후:
        - README 스크린샷 5장 캡처 + LSTM/ARIMA 비교 PNG 첨부
        - 기획서 §6 운영KPI 슬롯 4건 채움
        - 베타 응답·정성 인터뷰 3건 (시간 허락 시)
```

## 20. 함정 (다음 세션 인지)

```
① Phase 2-B 지오코딩 실패율
   ARA_NM 이 "서울특별시 강남구 역삼동 736" 같은 정형 주소가 아니면 실패 가능.
   seedLhYouthHousing 의 마지막 로그 "코드 정밀도" 에서 5자리 비율이 30% 넘으면
   주소 정제 로직 추가 검토.

② lhCountMap 합산의 중복 카운트 위험
   같은 단지가 10자리 row 와 5자리 row 양쪽에 동시 저장되면 2회 카운트.
   --reset 으로 적재하면 한쪽 정밀도만 남으므로 OK. 부분 재적재 시 위험.
   해결: seed 가 항상 (legalDongCode, programType) 기준 단일 row 유지.

③ /api/meta/data-sources 의 transitCount
   현재 totalRows 합산에서 의도적 제외 (void transitCount). 통근 캐시는 운영
   메타지 "데이터 융합" 어필 카운트로는 부적절. 마음에 들지 않으면 sources 에
   별도 카드 추가.

④ /about/data 페이지 fetch 경로
   현재 `fetch('/api/meta/data-sources')` 직접 호출. apiFetch 래퍼 사용 시
   인증 헤더 자동 첨부 회피 가능. 인증 불필요 라우터라 OK.

⑤ 기획서 §4 "5개 기관" vs about/data "4기관"
   §4 는 통계청+경찰청을 각각 카운트해 5개, about/data 는 합쳐서 4개. 양쪽 모두
   정확한 표현 — "주관기관 (가점) 4개 / 합산 5개" 어휘로 통일 검토.

⑥ Prisma migration history
   27일 §② 가 본 세션에서도 미완. 사용자 prisma migrate status 결과 받은 뒤
   다음 세션에서 migrate dev --create-only 로 add_realty_full_schema 마이그
   레이션 생성 권장. Render 배포 재현성 확보.
```

## 21. 다음 세션 첫 한 줄 (당초)

> **"Phase 2-B + about/data + 기획서·README 슬롯 ✅. 사용자 typecheck/회귀/Prisma history 결과 받고 → ML 세션 산출물(backtest PNG + train:backfill 결과) 도착 시 스크린샷/§6 KPI/§7-D 베타 슬롯 일괄 채움 → 최종 검수 + Render 배포 점검 + 마감 24h 전 제출."**

---

## 22. Phase 2-B 옵션 B (LH schema 보강) — 사용자 명령 결과 + 후속

### 22.1 사용자 측 실행 결과

```
[1] npx prisma migrate status     "Database schema is up to date!" — 깨끗 (27일 §② 종결)
[2] npx prisma db push (1차)      complex_name NOT NULL 추가 막힘 (기존 16건 충돌)
                                   → 사용자가 'N' 입력해서 전체 DB 손실 회피 ✅
[3] truncate-lh.sql 로 테이블만 비움
[4] npx prisma db push (2차)      unique constraint 추가 'y' (0 row 라 안전)
[5] npx prisma generate            ✅
[6] npm run seed:lh -- --reset
       총 수집 (API 응답): 3,950건
       DB 신규: 49 / 갱신: 3,901
       지오코딩 ok 14 / cache hit 3,936 (= 49 unique × 약 80회 중복 응답)
       행복주택: 47건 / 32,433호
       전세임대: 2건 / 620호
       코드 정밀도: 10자리 49건 (100%)
       좌표 보유: 49/49 (100%)
       unique 행정동 수: 14곳
```

### 22.2 진단 — LH API 노출 한도

- `lhClient.ts` 의 `CNP_CD="11"` (시도 2자리) 호출이 25시군구 루프에서 25번 동일 응답 반환.
- API `lhLeaseInfo1` 노출 단지 = **서울 전체 49건이 한도**. 다른 LH 임대(영구·국민)는 별도 엔드포인트라 본 API 범위 밖.
- 비교: 이전 16건 → 49건 = 단지명 키 추가 효과(덮어쓰기 사고 해소).
- 비교: 8,901호 → 32,433호 = 마지막 row 값 → 단지별 정확 합산.

### 22.3 핵심 보강 — 시군구 prefix 폴백 (1줄 수정 × 2파일)

```
server/src/routes/domains/regions.ts   /lh-summary
  Before: where: { legalDongCode: sigunguCode }              // 5자리 정확 일치 → 항상 0
  After:  where: { legalDongCode: { startsWith: sigunguCode } }  // 같은 시군구 모든 row

server/src/services/repositories/recommendationRepository.ts  lhCountMap
  Before: WHERE legal_dong_code IN (시군구 5자리들)            // 0 rows
  After:  WHERE LEFT(legal_dong_code, 5) IN (시군구들)         // 시군구 prefix
          + 행정동 우선, 없으면 시군구 폴백 (중복 카운트 회피)
```

효과:
- 14개 행정동 → 14곳 시군구의 모든 동에서 LH 배너 노출 가능
- 행정동 단위 정밀도(scope=DONG, 14곳)는 그대로 유지
- 14곳 시군구(영등포·강서·마포·구로 등) 안의 다른 동은 scope=SIGUNGU 로 폴백 표시
- LH 데이터 없는 시군구는 INSUFFICIENT → 배너 자체 숨김

### 22.4 사전 typecheck 에러 1건 (본 세션 변경과 무관, 같이 수정)

```
client/src/stores/useAuthStore.ts:7  TS6133 'fetchMe' is declared but its value is never read
  → fetchMe import 만 제거 (bootstrap 안 주석된 fetchMe 호출 그대로 둠)
```

### 22.5 typecheck 양측 EXIT:0 ✅

```
cd client && npm run typecheck   → EXIT:0
cd server && npm run typecheck   → EXIT:0
```

### 22.6 본 세션 (Phase 2-B 옵션 B) 변경 파일 통계

```
schema/seed (3)
  server/prisma/schema.prisma                                LhYouthHousing 보강 (complexName/address/lat/lng + @@unique)
  server/src/services/external/geocoder.ts                   addressToLegalDongCode 좌표 같이 반환 (+5 lines)
  server/scripts/seedLhYouthHousing.ts                       전면 재작성 (upsert 키 확장 + 좌표 저장)

regions/repository (2, 시군구 prefix 폴백)
  server/src/routes/domains/regions.ts                       /lh-summary (b) startsWith 매칭
  server/src/services/repositories/recommendationRepository.ts  (b) LEFT(legal_dong_code,5) prefix + 중복 회피

client typecheck 정리 (1)
  client/src/stores/useAuthStore.ts                          unused import 제거 (1 line)

총 변경 ~250 lines (옵션 B 보강 한정)
```

### 22.7 사용자 측 후속 작업

```
[★★★] 서버 재시작 후 회귀 스모크 4점:
        /region/1156013000   영등포 당산동 — LH 배너 [행정동] 또는 [시군구] 노출
        /region/1168010600   강남 대치동   — 배너 숨김 또는 [시군구]
        /about/data          4기관 카드, LH "단지 49건/32,433호" 확인
        curl /api/meta/data-sources   JSON 응답 sanity

[★★]  ML 세션 산출물 도착 시 (별도 세션):
        - README 스크린샷 5장 캡처 (LSTM/ARIMA 비교 PNG 포함)
        - 기획서 §6 운영KPI 슬롯 4건 채움
        - 기획서 §7-D 베타 슬롯 채움 (정성 인터뷰 3건 또는 응답 N건)

[★]   마감 24h 전:
        - Render 운영 배포 점검
        - 증빙 자료 폴더 정리 (4기관 API 응답 캡처 + 학습 로그)
        - 기획서 최종 검수 (오탈자/분량)
```

### 22.8 함정 보강 (28일 §20 추가분)

```
⑦ LH API 노출 한도 (49건)
   lhLeaseInfo1 가 모집 중 단지만 보여줘서 자연스러운 수치.
   기획서/about 페이지에서 "노출 단지 49건/32,433호" 정직 톤 유지.
   다른 LH API (예: lhLeaseInfo2, lhBalanceList) 시도는 D-day 이후.

⑧ 시군구 prefix 폴백의 cover 한도
   14곳 시군구에만 LH 데이터 존재 → 11개 시군구는 INSUFFICIENT (배너 숨김).
   채점위원 시연 시 LH 있는 시군구 (영등포 등) 우선 안내 권장.

⑨ lhClient.ts CNP_CD=시도 2자리 호출 비효율
   25시군구 루프에서 25번 동일 응답 → 약 100,000건 API 호출 낭비.
   해결책: SEOUL_LAWD_CODES 루프 1회로 줄이고 ARA_NM 으로 시군구 분류.
   D-day 후순위 (현 동작 정상이라 마감엔 영향 없음).
```

### 22.9 다음 세션 첫 한 줄 (당초)

> **"Phase 2-B 옵션 B 완료 — LH 단지 49건/14동/좌표100%/시군구폴백 + typecheck 양측 EXIT:0 ✅. 사용자 회귀 스모크 후, ML 세션 산출물(backtest PNG + train:backfill) 도착 시 README 스크린샷 + 기획서 §6/§7-D 슬롯 일괄 채움 → Render 배포 점검 → 마감 24h 전 제출."**

---

## 23. 안정성 핫픽스 + 슬라이더 debounce (사용자 부하 테스트 발견)

### 23.1 발견 경위

> 사용자가 매물 정보(가중치 슬라이더)를 단기간에 많이 흔드는 내구도 테스트 진행 →
> 서버 process 죽음 + `Unknown column 'sigungu_code' in 'where clause'` (1054) 에러 보고.

### 23.2 진단 — 죽음의 시퀀스

```
1. 가중치 슬라이더 다량 변경 → setWeight 50+회 → useEffect 50+회 트리거
   → fetchRecommendations 50+회 동시 호출
2. 추천 결과 카드 변경 → ARIMA endpoint 다량 호출
3. 저거래량 단지(전체 59%) 진입 시 STEP 2/3 폴백 SQL 실행
   → t_apt_trade 에 sigungu_code / legal_dong 컬럼 없음 (실제로 t_apt_complex 에 있음)
   → P2010 throw
4. arima.ts async handler 에 catch 없음 → unhandled promise rejection
5. Node 15+ 기본 정책 → process 종료 → 서버 다운
```

→ **3중 원인**: ARIMA SQL 컬럼 오참조 + handler try-catch 부재 + 클라이언트 호출 빈도 폭주.

### 23.3 Hotfix 3건

```
[1] arima.ts STEP 2/3 SQL — t_apt_trade INNER JOIN t_apt_complex
    Before: WHERE sigungu_code = ? AND legal_dong = ?     (t_apt_trade 에 없음)
    After:  FROM t_apt_trade t INNER JOIN t_apt_complex c ON c.id = t.complex_id
            WHERE c.sigungu_code = ? AND c.legal_dong = ?

[2] arima.ts 전체 handler try-catch
    SQL/계산 에러 안전 캡처 → 500 JSON 응답 (이전 unhandled → timeout)

[3] index.ts process-level 안전망
    process.on('unhandledRejection', ...) + process.on('uncaughtException', ...)
    10개 라우터 모두 보호 (응답은 못 줘도 process 는 살아 있음)
```

### 23.4 슬라이더 debounce (호출 빈도 자체 차단)

```
신규: client/src/hooks/useDebouncedValue.ts        ~30 lines (재사용 가능 훅)
수정: client/src/pages/Recommendation/index.tsx    +15 lines
       weights / budget / patience 만 350ms debounce
       workplace / incomeQuintile 은 즉시 (슬라이더 아님)
       UI 표시 값 자체는 즉시 반영 (라벨/색상 변화 OK)
       fetch 호출에만 debounced 값 사용

효과: 슬라이더 50회 흔들기 → fetchRecommendations 1~5회 (50배 ↓)
```

### 23.5 사용자 회귀 검증

- 기능 정상 ✅ (가중치 빠르게 흔들어도 서버 살아 있음, 추천 결과 350ms 후 갱신)

### 23.6 본 세션 (안정성 핫픽스) 변경 파일 통계

```
서버 (2)
  src/routes/domains/arima.ts                  +25 lines (JOIN + try-catch)
  src/index.ts                                 +18 lines (process-level 안전망)

클라이언트 (2)
  src/hooks/useDebouncedValue.ts  신규         ~30 lines
  src/pages/Recommendation/index.tsx           +15 lines (debounce)

총 ~90 lines
```

---

## 24. 다음 세션 진입 고찰 (사용자 메모)

### 24.1 ODsay 호출 범위 — 3×3 격자 캐싱 재설계

> 사용자 보고: "ODsay 호출 범위가 너무 넓어진 것 같다.
> 3x3 격자 인덱싱 처리한 범위를 더 넓혀야 하나, 보든 캐싱 단위마다 재조회 시 API 호출량 감당 불가."

**현황** (22일 work-log §4 + 27일 §1 ODsay quota 게이트):
- 격자 = ~1km × 1km (3x3 KNN 캐시)
- 무료 한도 1,000건/일, 내부 차단 임계 800 (마진 20%)
- 직장 위치가 격자 경계 가까우면 인근 4~9개 격자 cover 필요 → cache miss 폭증

**선택지 (다음 세션 결정)**:

```
[A] 격자 크기 확장 (3×3 → 5×5, 격자 자체 1km → 2km)
    장점: cover ↑, miss ↓
    단점: 정확도 ↓ (같은 격자 안에서도 거리 1~2km 차이)

[B] Neighbor 일괄 cover (현재 격자 + 인접 8개 한 번에 미리 cover)
    장점: 1회 cache miss → 9개 격자 채움 → 다음 사용자 99% hit
    단점: 호출 1회당 9x ODsay 호출 — 빈도 낮으면 효율

[C] 캐시 TTL 무한 + 인기 직장 사전 워밍업
    장점: 운영 안정성 ↑
    단점: 워밍업 잡 추가 작업 + 메타데이터 관리

[D] ODsay 폴백 강화 — Haversine 비선형 추정만으로도 충분한 영역 확대
    장점: 호출 자체 ↓
    단점: 환승·배차 반영 못 함 (정확도 ↓)

권장 순서: B → C → A → D
```

### 24.2 클라이언트 UI/UX 후속

> 사용자 메모: "클라이언트 UI/UX 고민 중."

후보 아이디어 (다음 세션 진입 시 사용자와 확정):
- Depth 2 LH 배지 가시성 (Phase 2-B 후 cover 시군구 14곳에서 어떻게 노출되는지)
- Depth 3 도넛 dataScope 칩의 모바일 가독성
- AboutData 페이지의 다국어/접근성 검토
- 가중치 슬라이더 debounce 350ms — UI 피드백 (로딩 인디케이터?) 추가 검토

### 24.3 잔여 라우터 try-catch 일괄 적용

> arima.ts 만 hotfix 했고, lstm.ts / regions.ts / recommendations.ts 등 9개 라우터는
> process-level 안전망으로만 보호 중. 다음 세션에서 라우터별 try-catch 일괄 도입 권장.

---

## 25. 다음 세션 첫 한 줄 (최종)

> **"Phase 2-B 옵션 B + 안정성 핫픽스(ARIMA JOIN/try-catch/process 안전망/슬라이더 debounce) ✅. 기능 정상 검증 완료. 다음 세션 진입 단서: (1) ODsay 3×3 격자 재설계 — B(Neighbor cover) 우선 검토, (2) 클라이언트 UI/UX 후속, (3) 잔여 9개 라우터 try-catch 일괄 도입. + ML 세션 산출물 도착 시 README 스크린샷 + 기획서 §6 KPI/§7-D 베타 슬롯 채움 → Render 배포 점검 → 마감 24h 전 제출."**

---

## 26. /intro 랜딩 페이지 + 영상 촬영 기획서 + 폰트 적용 (D-1 오후 세션)

### 26.0 진입 컨텍스트

- 사용자 요청: "70시간 계획 미이행 항목 파악 후, 마감 직전이라 ① 랜딩페이지 ② 영상 촬영 기획서 마무리 ③ README 정리".
- 7day-roadmap.md (DAY 1~7) vs 실제 진행 매트릭스 대조 → 미이행 = TAGO 시드, 베타 응답·§7-D 베타 슬롯, §6 운영KPI 4건 슬롯, **랜딩페이지(7day-roadmap에 항목 누락)**, README 스크린샷·데모 영상.
- 사용자 결정 (4문항):
  - 랜딩 형태: `/intro` 새 라우트로 분리 (기존 `/` Depth 2 유지)
  - 주요 CTA: 서비스 설명 + 데모 노출 (회원가입 강요 X)
  - 영상 기획서: 30~60초 데모 GIF/동영상용 콘티
  - README: 후순위 (이번 세션 미진행)

### 26.1 신규 — `/intro` 랜딩 페이지

```
client/src/pages/Landing/index.tsx                            신규 ~510 lines
  · 라우트: /intro (App.tsx 1줄 추가, 기존 / 동작 100% 유지)
  · 7개 섹션: Hero / Pain / Flow / Diff / Numbers / DemoCTA / Footer
  · DemoCardMock + ArimaChartMock 컴포넌트 (실 화면 캡쳐 도착 전 placeholder)
  · IntersectionObserver 기반 SectionReveal — 진입 시 fade-up 1회성
    - rootMargin '-10%', threshold 0.15, duration 700ms ease-out
    - prefers-reduced-motion 사용자 즉시 visible (a11y)
    - IO 미지원 환경 즉시 visible (안전망)

client/src/App.tsx                                            +2 lines
  · import LandingPage + <Route path="/intro">
```

### 26.2 톤·시각 디자인 (3회 반복 조정)

**1차 (다크 모드 영향 받음)**: `bg-surface dark:bg-surface-dark` 사용 → 사용자 피드백 "너무 어둡다, 공모전 제출용 화이트톤".

**2차 (화이트톤 + 차트 가시성 + 스크롤 reveal)**:
- 페이지 전체 `dark:` variant 제거, `bg-white` 고정 → 사용자 피드백 "카드가 배경에 묻혀서 텍스트만 떠있는 느낌".
- ArimaChartMock 가독성 보강: 가로 그리드 5줄 + Y축 라벨, X축 시간 라벨(2021/2026/2029), 학습/예측 분리선 + 인-차트 라벨, 영역 음영 linearGradient, 라인 두께 1.5→2.5/3px, 분기점·종점 dot 4r + 흰 stroke.
- SectionReveal 도입.

**3차 (카드 입체감)**: 루트 `bg-white` → `bg-surface(#F5F6F8)` 전환 + 모든 카드 `shadow-card transition-shadow hover:shadow-card-hover`. AboutData와 톤 일치.

**4차 (폰트 + 가독성)**:
- 사용자: "타이틀 SB 어그로, 본문 NotoSans, 심사위원 첫 화면"
- `client/public/font/` 4개 TTF 확인:
  - `SB 어그로 L.ttf` / `M.ttf` / `B.ttf`
  - `NotoSansKR-VariableFont_wght.ttf`
- `client/src/css/index.css` 에 @font-face 4개 등록 (한글 파일명 percent-encoded URL `/font/SB%20%EC%96%B4%EA%B7%B8%EB%A1%9C%20*.ttf`, `font-display: swap`)
- `.font-aggro` / `.font-noto` 유틸 클래스 신규 — fallback chain은 Pretendard 시스템.
- Landing 루트에 `font-noto`, 타이틀 11곳에 `font-aggro` (h1/h2/h3 + section label + 큰 숫자 + 로고).
- Hero 본문 `text-sm md:text-base leading-relaxed` → `text-base md:text-lg leading-[1.75]`.
- 큰 숫자(Pain 통계, Number 카드) 폰트 크기 한 단계 ↑.

**5차 (로고 교체)**:
- 기존: 인라인 `<div>나</div>` 톤. 사용자 요청 "public/logo.svg 쓰자".
- Header / Footer 2곳 모두 `<img src="/logo.svg" alt="나어디삶 로고" width={32} height={32} />` 로 교체.

### 26.3 신규 — 영상 촬영 기획서

```
server/doc/2026-05-28/video-shoot-plan.md                     신규 ~250 lines
  · 30~60초 데모 GIF/동영상용 콘티 (README §🎬 슬롯 채울 용도)
  · 0~9 섹션: 사전 체크 / 8씬 리스트 / 자막 가이드 / 내레이션 30초 본
                ffmpeg 인코딩 명령 / 후처리 체크리스트 / A·B·C 백업 시나리오 / 6대 함정
  · 50초 8씬 동선:
      Scene 1 (5초) Hero & 진입 (/intro)
      Scene 2 (4초) "지금 추천 받기" 클릭 → /
      Scene 3 (8초) 강남역 입력 + 사회초년생 프리셋 + 자동 fetch
      Scene 4 (7초) 추천 카드 8선 + 지도 동기화
      Scene 5 (6초) 안전 가중치 ↑ → 재정렬 (debounce 350ms 시연)
      Scene 6 (8초) 1위 카드 클릭 → /region/1168010600
      Scene 7 (7초) ARIMA 도넛 + dataScope 칩 단지간 전환
      Scene 8 (5초) /about/data 4기관 카드 클로징
```

### 26.4 진입 경로 점검 — `/intro` 노출

- **현재**: `/intro` 는 직접 URL 접근만 가능. Depth 2(`/`), Depth 3(`/region/:code`), AboutData(`/about/data`) 어디에도 `/intro` 로의 링크 없음.
- **의도된 동작**: 심사위원이 제출 URL 또는 README 링크를 통해 `/intro` 로 직접 진입 → "지금 추천 받기" CTA 로 `/` 진입.
- **위험**: 일반 사용자가 `/` 로 먼저 들어오면 랜딩을 영원히 안 봄. 채점위원 시연 동선이 깨질 수 있음.
- **권장 (마감 전 결정 필요)**:
  - 옵션 A: 그대로 유지 + 제출 시 URL을 `https://<vercel>/intro` 로 명시
  - 옵션 B: 헤더 (`RecommendationHeader.tsx`)에 "서비스 소개" 작은 링크 1개 추가 (이미 "데이터 출처" 링크 있는 자리 옆)
  - 옵션 C: 신규 방문자(`localStorage.firstVisit`) 첫 진입 시 `/intro` 자동 리다이렉트 — 복귀 사용자 영향 0, 작업량 ~10줄

### 26.5 변경 파일 통계 (본 세션)

```
신규 (2)
  client/src/pages/Landing/index.tsx                          ~510 lines
  server/doc/2026-05-28/video-shoot-plan.md                   ~250 lines

수정 (3)
  client/src/App.tsx                                          +2  lines  (Landing import + Route)
  client/src/css/index.css                                    +55 lines  (@font-face 4 + .font-aggro / .font-noto)
  server/doc/2026-05-28/work-log.md                           +본 §26 (현재 작성 중)

총 신규/수정    ~820 lines + 폰트 자산 4 TTF 활용
```

### 26.6 D-1 잔존 미이행 (사용자 결정 필요)

```
[★★★] 사용자 직접 — typecheck 양측 EXIT:0 확인
        cd C:\git\NaODiSalm_Main\client && npm run typecheck
        cd C:\git\NaODiSalm_Main\server && npm run typecheck

[★★★] /intro 시각 회귀 1회
        npm run dev → http://localhost:5173/intro
        - 로고 SVG 정상 노출 (헤더 + 푸터)
        - SB 어그로 폰트 적용 확인 (Hero h1, section h2, 큰 숫자)
        - NotoSans 본문 적용 확인 (Hero 부제, 카드 description)
        - 스크롤 시 섹션이 아래에서 올라오는 fade-up 동작
        - 카드 hover 시 그림자 lift
        - 카드들이 배경 위에 떠 있는 입체감 (bg-surface vs bg-white)

[★★]  영상 촬영 (video-shoot-plan.md §0 체크리스트 → §1 씬 1~8)
        - ODsay 캐시 워밍업 (강남역 1회 호출) 필수
        - 라이트 모드 + DevTools 닫힘 + 책갈피 숨김
        - 본편 30~40분 + 후처리 20분
        - docs/screenshots/04-demo.gif 로 저장

[★★]  /intro 진입 경로 결정 (§26.4 옵션 A/B/C)

[★]   README 마무리 (다음 세션)
        - §📸 스크린샷 5장 캡쳐 (Win + Shift + S)
        - §🎬 데모 GIF 경로 첨부
        - 5개 기관 / 6개 기관 표기 일관성 (§4 표 vs Landing Hero 배지 5개 + ODsay·Kakao 2개)

[★]   기획서 §6 운영KPI 슬롯 4건 + §7-D 베타 응답
        - p95 응답시간 / NPS / 데이터 융합 카운트 / 베타 정성 인터뷰 3건
```

### 26.7 개선여지 (마감 후 v1.1)

```
① 폰트 파일명 ASCII rename
   "SB 어그로 *.ttf" 한글+공백 파일명 → "SB-Aggro-Bold.ttf" 등 ASCII 명으로 변경.
   현재 percent-encoded URL 로 우회했지만 일부 CDN/캐싱 환경에서 실패 가능.
   PowerShell 1줄로 rename + CSS @font-face url() 동시 갱신 (10분).

② 영상 첨부 후 Hero 동영상 백그라운드
   현재 Hero 는 정적 텍스트만. 데모 GIF 도착 시 Hero 우측에 작은 muted autoplay loop
   embed (4~6초). 채점위원 시각 임팩트 +α. <video muted autoplay loop> 1개.

③ 진입 경로 옵션 C (신규 방문자 자동 /intro 리다이렉트)
   localStorage 가드 + Recommendation/index.tsx useEffect 5줄.
   복귀 사용자 영향 0, 채점위원 첫 방문 시 랜딩 100% 노출 보장.

④ 모바일 hero 본문 압도 위험
   text-base md:text-lg + leading-1.75 가 모바일에서 본문이 hero 를 압도할 가능성.
   text-sm → text-base (md+ 만 lg) 한 단계 축소 검토 후 모바일 회귀 1회.

⑤ ArimaChartMock 도넛 추가
   실 Depth 3 화면은 라인 차트 + 신뢰도 도넛 2개 컴포넌트인데 mock 에는 도넛 없음.
   현재 우상단 "88" 텍스트만 → 작은 도넛 SVG (24x24) 추가하면 실 화면과 톤 일치.

⑥ AboutData 페이지도 동일한 폰트 패턴
   /intro 와 /about/data 가 채점위원이 가장 많이 볼 두 화면. about/data 도 .font-aggro
   타이틀 적용하면 일관성. ~20줄 수정.

⑦ DemoCTA 그라데이션 카드의 다크 톤
   "강남역으로 출퇴근하는 사회초년생이라면" 그라데이션 카드가 페이지 유일한 다크 영역.
   사용자가 "화이트톤" 강조했으므로 grad 톤 다운 (brand-400 → brand-500) 검토.

⑧ SectionReveal threshold 모바일 조정
   현재 0.15 → 모바일 스크롤 빠르면 reveal 안 보일 수 있음. 0.05 + delay 단축 옵션.

⑨ /intro 메타태그 (og:image, twitter:card)
   index.html 또는 react-helmet 으로 SNS 공유 시 미리보기 이미지 추가.
   채점위원이 URL 공유받았을 때 첫인상 개선.

⑩ Footer 의 ML repo 외부 링크
   현재 푸터에 ML repo 링크 없음. README 의 "관련 저장소" 처럼 GitHub URL 추가.
```

### 26.8 마무리 판정

```
인트로는 이대로 마무리해도 좋은 상태:
  ✅ 화이트톤 + 카드 입체감 + 그림자 hover
  ✅ SB 어그로 타이틀 / NotoSans 본문 / Pretendard fallback
  ✅ logo.svg 헤더·푸터 적용
  ✅ IntersectionObserver 스크롤 reveal (a11y reduced-motion 회피)
  ✅ Depth 3 차트 모사 가독성 보강 (그리드·축·음영·dot)
  ✅ 채점위원 첫 화면 동선 7섹션 자연스러운 흐름

마감 전 마지막 액션 3개만:
  1. typecheck (5분)
  2. 시각 회귀 1회 (10분)
  3. /intro 진입 경로 옵션 결정 (옵션 A 권장 — 변경 없음)

이후 트랙:
  - 영상 촬영 (video-shoot-plan.md 따라)
  - README 스크린샷·GIF 첨부 (다음 세션)
  - 기획서 §6 운영KPI + §7-D 베타 슬롯 (다음 세션)
  - Render 배포 점검 → 마감 24h 전 제출
```

### 26.9 다음 세션 첫 한 줄 (D-Day 또는 D+0)

> **"`/intro` 랜딩 + 영상 촬영 기획서 + 폰트(SB 어그로·NotoSans) + logo.svg + 스크롤 reveal + 카드 입체감 ✅. 사용자 typecheck/시각 회귀/영상 촬영 후, README §📸·§🎬 슬롯 채움 + 기획서 §6 운영KPI·§7-D 베타 슬롯 채움 + Render 배포 점검 → 마감 24h 전 제출. 진입 경로 옵션 C (신규 방문자 /intro 자동 리다이렉트, ~10줄)는 v1.1 후순위."**

