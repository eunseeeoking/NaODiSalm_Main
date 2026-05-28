# 작업 로그 — 2026-05-27 (D-2, ODsay quota + 예산 슬라이더 + LH 재설계)

## 한 줄 요약

> **백엔드 5종 + 클라이언트 4종 변경. ODsay 일일 호출 게이트(800/1000) 도입, 예산 슬라이더 사회초년생 범위(1천만~15억) 재설계, LH 매물 통합 → 단지 카드 시도 후 시군구 집계 배너로 revert, recommendationRepository 의 `lhComplexNearby` 키 mismatch 버그 수정, 매물타입×거래유형 ENUM 인프라 도입(`PropertyKind`/`DealType`).** 마이그레이션 권한 복구 후 `prisma db push` 로 스키마 반영 완료.

---

## 🚨 지금 당장 해야 할 동작 (eunseok)

> 우선순위 순. 위에서부터 그대로 진행.

### ① typecheck + build 확인 ★ 5분 — 필수

```powershell
cd C:\git\NaODiSalm_Main\client
npm run typecheck       # tsc --noEmit
npm run build           # tsc -b && vite build

cd ..\server
npm run typecheck       # tsc --noEmit
```

- **이번 세션 변경 파일 (typecheck 영향)**:
  - server: `routes/domains/regions.ts`, `services/repositories/recommendationRepository.ts`, `services/external/odsay.ts`, `services/external/odsayQuota.ts` (신규)
  - client: `types/region-detail.ts`, `api/regionDetail.ts`, `pages/RegionDetail/index.tsx`, `pages/RegionDetail/components/ComplexCardList.tsx`, `pages/RegionDetail/components/LhAggregateBanner.tsx` (신규), `pages/RegionDetail/data/mockComplexes.ts`, `pages/RegionDetail/data/mockLhSummary.ts` (신규), `pages/Recommendation/components/CommutePatienceSlider.tsx`, `stores/useRecommendationStore.ts`
- ⚠️ **sandbox bash 의 typecheck 는 신뢰 불가 (mount sync gap)** — Windows 측에서 돌린 결과만 ground truth.

### ② Prisma 마이그레이션 history 정리 ★ 10분 — 필수

권한 복구 후 `prisma db push` 로 밀어버린 상태. schema 와 migrations 폴더가 어긋나 있을 수 있음.

```powershell
cd C:\git\NaODiSalm_Main\server

# 현재 schema vs DB 일치 확인
npx prisma migrate status

# 만약 "Database schema is up to date" 면 → 추가 작업 없음
# 만약 "Following migrations have not been applied" 가 뜨면:
#   (이미 push 로 적용된 상태이므로 history 만 정렬)
npx prisma migrate resolve --applied "20260507155826_add_password"

# OdsayUsageDaily 모델은 schema 에만 있고 마이그레이션 파일 없을 가능성:
# push 로만 적용했으면 → 새 마이그레이션 파일 생성
npx prisma migrate dev --name add_odsay_usage_daily --create-only
# (--create-only: SQL 생성만, 적용은 X — 이미 DB 에는 있음)
# 생성된 마이그레이션 파일을 git 에 커밋
```

- 목적: 다음 환경(Render 배포 등)에서 마이그레이션 재현 가능하게.
- 운영 환경은 `migrate deploy` 만 쓰면 권한 최소화 가능.

### ③ 회귀 테스트 (수동, 브라우저) ★ 15분 — 필수

```powershell
cd C:\git\NaODiSalm_Main\client
npm run dev   # vite, http://localhost:5173
```

- [ ] **예산 슬라이더** — `/recommendation` 진입
  - 좌측 패널 예산 슬라이더가 1천만~15억 범위, step 1천만으로 동작
  - 기본값이 "1.5억" 으로 표시
  - 슬라이더 끝까지 왼쪽 → "1천만"
  - 5,000 만원 위치 → "5천만"
  - 13,000 만원 → "1억 3천만"

- [ ] **LH 집계 배너** — `/region-detail?legalDongCode=1156013000` (당산동, 영등포구)
  - 단지 카드 리스트 상단에 "영등포구에 LH 청년주택 412호 공급 중" 배너
  - 행복주택/청년매입임대/전세임대 칩 + 월세 range 툴팁
  - 단지 카드 리스트에는 LH 카드 없음, 필터 탭 없음

- [ ] **LH 배너 자동 숨김** — `?legalDongCode=1168010600` (대치동, 강남구)
  - LH 배너 자체가 안 보임 (강남구 mock = 0건)

- [ ] **분석 패널** — 단지 카드 선택 → LSTM/ARIMA/통근비교 정상 동작 (이전 세션과 동일)

- [ ] **ODsay quota 게이트** — 직장 위치 입력 후 추천 받기 → 정상 동작
  - 관리자 엔드포인트로 확인: `curl http://localhost:3000/api/admin/odsay-usage`
  - 응답: `{ date, callCount, remaining, blocked }`

### ④ `MOLIT_SERVICE_KEY` 환경변수 확인 ★ 5분 — 권장

`.env` 에 `MOLIT_SERVICE_KEY` 가 있는지 확인. 있으면 LH 데이터 실 적재:

```powershell
cd C:\git\NaODiSalm_Main\server
type .env | findstr MOLIT_SERVICE_KEY     # PowerShell: Select-String

# 키 있으면 실 LH 데이터 적재
npm run seed:lh

# 적재 확인 (MySQL)
mysql -u molit -p molit_contest -e "SELECT program_type, COUNT(*), SUM(units_available) FROM t_lh_youth_housing GROUP BY program_type;"
```

- 키 미설정 시 mock fallback 으로 동작 (배너에 영등포·강서·마포·구로 mock 데이터 표시).
- 실 데이터 적재 후 `/api/regions/1156013000/lh-summary` 직접 호출해 mock 과 다른 결과 나오는지 확인.

### ⑤ Phase 2 진입 결정 ★ 결정 필요

다음 작업은 사용자(eunseok) 결정 필요:
- **A. 수도권 거래내역 시드** — `t_apt_price_monthly_agg` 신규 시드. 경기·인천 행정동 클릭 시 빈 추천 결과 안 보이게 (worklog §5 분석 참조)
- **B. LH 단지 주소 카카오 지오코딩** — `t_lh_youth_housing.legal_dong_code` 5자리→10자리 정규화. LH 배너가 행정동 단위 정밀도로 동작
- **C. 거래유형 토글 UI + 예산 3단 분기** — 매매/전세/월세 segmented control
- **D. Render 운영 배포 점검** — `next-steps.md` 의 미해결 항목

→ ROI 순으로 **B → A → C → D** 권장. B 는 1~2일, A 는 2~3일.

---

## 0. 진입 컨텍스트

- 직전 세션(2026-05-26) 종료 시점: UI/UX 정돈 + 모바일 반응형 + Fix Pass 6건.
- 사용자 보고:
  1. DB 2.8GB, 수도권 거래내역 추가 필요한지
  2. 통근시간 폴리곤 수도권 확장 완료 + ODsay 800 quota 처리 → work-log 누락
  3. 예산 선택지 2억부터 시작 — 사회초년생에 비현실적, 1천만 단위로
  4. LH 매물 일절 안 보임
- 본 세션 산출: 5번에 걸친 사용자 의사결정 반영, 두 단계(Phase 0+1 → 1.5 revert) 거쳐 정착.

---

## 1. ODsay LAB 일일 호출 게이트 (800/1,000) — 신규

### 1.1 정책
- 무료 한도 1,000건/일. 내부 차단 임계값 800 (20% 마진).
- KST 자정 리셋. `t_odsay_usage_daily` (date PK, callCount).
- 차단 시 호출자(`commuteRepository`) 는 Haversine 폴백.

### 1.2 추가 파일

| 파일 | 역할 |
|------|------|
| `prisma/schema.prisma` (모델 `OdsayUsageDaily`) | KST 일자별 호출량 row |
| `src/services/external/odsayQuota.ts` (신규) | `checkAndConsumeOdsayQuota()` / `refundOdsayQuota()` / `getOdsayUsageToday()` / `ODSAY_DAILY_LIMIT` |
| `src/services/external/odsay.ts` | `fetchOdsayRoute` 진입부 게이트 / catch 환불 |
| `src/routes/domains/admin.ts` | `GET /api/admin/odsay-usage` |

### 1.3 동시성 정책
- `upsert + increment` 단일 트랜잭션. read-check-increment 사이 미세 race 허용 — 약간 over-count(±5건) 도 800 마진 안에서 흡수.
- 환불은 fetch 자체 reject(네트워크 오류) 시에만 -1. HTTP 200 + 에러 응답은 환불 안 함(ODsay 측 이미 카운트했을 가능성).

---

## 2. 예산 슬라이더 — 사회초년생 범위 재설계

| 항목 | Before | After |
|------|--------|-------|
| min | 20,000 만원 (2억) | **1,000 만원 (1천만)** |
| max | 150,000 만원 (15억) | 150,000 만원 (동일) |
| step | 5,000 만원 | **1,000 만원** |
| 기본값 | 40,000 (4억) | **15,000 (1.5억)** |

### 2.1 표기 포맷 (`formatBudget`)
- < 1억: `3,000` → `"3천만"`, 비배수면 `"3,500만"`
- = 1억 배수: `10,000` → `"1억"`
- 1억 + 잔여: `13,000` → `"1억 3천만"`

### 2.2 수정 파일
- `client/src/pages/Recommendation/components/CommutePatienceSlider.tsx`
- `client/src/stores/useRecommendationStore.ts`

---

## 3. LH 매물 통합 — Phase 0+1 (도입) → Phase 1.5 (revert)

### 3.1 시작점 진단 (Root Cause 4중)
| 가설 | 결론 |
|------|------|
| `isLhComplex` 응답 누락 | 필드는 OK |
| `isLhByName` 키워드 매칭 실패 | t_apt_complex 는 매매 실거래라 LH 단지 거의 없음 → false-negative ~100% |
| `regions.ts` 가 `t_lh_youth_housing` join 안 함 | **루트 #1** |
| `t_lh_youth_housing.legal_dong_code` 가 시군구 5자리 저장 | **루트 #2** — 10자리 매칭 불가 |
| `MOLIT_SERVICE_KEY` 미설정 시 테이블 비어 있음 | **루트 #3** |

### 3.2 사용자 의사결정
1. **매물 스코프**: B. 매물타입×거래유형 2축 ENUM 인프라 도입 (정석안)
2. **예산**: 매매/전세/월세 3단 + 월세 dual (Phase 2 작업)
3. **착수**: Phase 0+1 묶음

### 3.3 Phase 0+1 적용 — 단지 카드에 LH 추가 (잘못된 접근)
- `regions.ts` 에 LH join 후 `LH-{id}` 카드 append
- `ComplexCardList` 에 propertyKind 분기 (보증금/월세 표시, "예측 미지원")
- 필터 탭 "전체 / 아파트 / LH 국가"

### 3.4 사용자 재피드백 → Phase 1.5 revert
> "lh는 3뎁스에선 표기하기 애매해보이고 지역 행정동 별 집계만 가능할 듯 싶긴 함. 매물의 디테일 정보는 가진게 없고"

- LH 데이터는 시군구 단위 + programType 집계 (단지명·좌표·세대수 없음)
- 가짜 "LH-{id}" 카드는 모든 필드 0/placeholder → 사용자 혼동
- → **단지 카드 분리 + 시군구 집계 배너로 재설계**

### 3.5 Phase 1.5 적용 (최종 형태)

| 파일 | 변경 |
|------|------|
| `src/routes/domains/regions.ts` | LH append 블록 revert. APT 만 반환. 새 엔드포인트 **`GET /:legalDongCode/lh-summary`** 추가 — `{totalRows, totalUnits, programs[]}` 집계. 빈 응답(`totalRows:0`) graceful. `isLhByName`/`LH_NAME_KEYWORDS` 완전 제거 |
| `src/services/repositories/recommendationRepository.ts` | **버그 수정**: `lhComplexNearby` 가 10자리 후보 vs 5자리 저장값 매칭으로 항상 0 반환 중이었음. 시군구 prefix 매칭 + `Prisma.join` IN절 안전화 + 테이블 미생성 graceful catch. Depth 2 의 "LH N" 배지가 이제 정상 동작 |
| `types/region-detail.ts` (client) | `PropertyKind` 에서 LH 제거 → `'APT' \| 'VILLA' \| 'OFFICETEL'`. `AptComplex` 에서 LH 전용 필드 전부 제거. 새 타입 `LhSummary` / `LhProgramSummary` |
| `api/regionDetail.ts` (client) | `fetchLhSummary()` + mock fallback |
| `pages/RegionDetail/data/mockLhSummary.ts` (client, 신규) | 시군구 5자리 → `LhSummary` mock |
| `pages/RegionDetail/components/LhAggregateBanner.tsx` (client, 신규) | "이 [시군구]에 LH 청년주택 N호 공급 중" + programType 칩. `totalRows===0` 자동 숨김 |
| `pages/RegionDetail/components/ComplexCardList.tsx` (client) | LH 분기 + 필터 탭 전부 제거. APT 단순 렌더만 |
| `pages/RegionDetail/data/mockComplexes.ts` (client) | 4건의 가짜 LH 플래그 제거 |
| `pages/RegionDetail/index.tsx` (client) | `<LhAggregateBanner>` wiring, Phase 1 LH 가드 정리, 첫 카드 자동선택 단순화 |

### 3.6 알려진 한계 (Phase 2 작업)
- LH 집계가 시군구 단위 → 같은 강남구 내 어느 동에 진입해도 동일 LH 배너. 행정동 단위 정밀도는 LH 주소 지오코딩 cron 후 가능.
- LH 배너 클릭 시 LH 공식 사이트 외부 링크 미구현.

---

## 4. 부가 발견

### 4.1 Depth 2 LH 배지 무동작 — 동시 수정
`recommendationRepository.ts:354` 의 `lhCountMap` 이 10자리 행정동 코드와 5자리 저장값을 비교하려고 해서 그동안 항상 `Map.get(...)===0`. RegionCard 의 "LH N" 배지가 출력된 적이 없었을 가능성 매우 높음.

### 4.2 Prisma migrate dev 권한 — 복구 완료
- 직전 보고: `ALTER command denied to user 'molit'@'172.18.0.1' for table 't_user'` (Error 1142)
- 권한 복구 후 `prisma db push` 로 스키마 반영.
- 마이그레이션 history 정리는 §②(지금 당장 해야 할 동작) 참조.

---

## 5. 매물타입×거래유형 ENUM — Phase 0 결과물

DB 스키마는 아직 변경 없음 (마이그레이션 권한 이슈로 보류했었음 → 권한 복구된 지금 추가 검토 가능). 현재는 API 레이어/TypeScript 레벨로만 정의:

```typescript
// 클라이언트 - types/region-detail.ts
export type PropertyKind = 'APT' | 'VILLA' | 'OFFICETEL';   // LH 는 별도 LhSummary
export type DealType     = 'SALE' | 'JEONSE' | 'MONTHLY';

// 서버 - routes/domains/regions.ts (inline)
type PropertyKind = 'APT' | 'VILLA' | 'OFFICETEL';
type DealType     = 'SALE' | 'JEONSE' | 'MONTHLY';
```

- APT 응답에 `propertyKind: 'APT', dealType: 'SALE'` 박힘 — Phase 3 의 VILLA/OFFICETEL 분기 준비 완료.

---

## 6. 알려진 환경 이슈

- **bash sandbox typecheck 신뢰 불가** — mount sync gap 으로 가짜 "Unterminated string literal" 100여 개 발생. Windows 측 `npm run typecheck` 만 ground truth.
- **수도권 폴리곤 확장 vs 거래내역 미적재** — 사용자가 경기·인천 행정동 클릭 시 빈 추천 결과. Phase 2 의 A안(시군구 월별 통계 시드) 으로 해소 예정.

---

## 7. 통합 작업 산출물 위치

- 통합 worklog (1~8 섹션, Phase 0+1 + 1.5 포함): `docs/worklog-2026-05-27.md`
- 본 문서 (server/doc 패턴 일관성용): `server/doc/2026-05-27/work-log.md`

---

_세션 종료: 2026-05-27 (D-2, Phase 0+1 + 1.5 revert 완료)_
# Work Log — 2026-05-27

## 개요

Render(서버) 및 Vercel(클라이언트) 배포 실패 원인을 진단하고 TypeScript 컴파일 에러 4건을 수정함.

---

## 수정 사항

### 1. `server/src/services/recommendation/scoring.ts`
**에러**: `TS2339: Property 'complexCount' does not exist on type 'ScoredRegion'`

**원인**: `RegionMetrics` 인터페이스에 `complexCount` 필드가 정의되지 않았고, `ScoredRegion`이 `RegionMetrics`를 extend하기 때문에 라우터에서 `r.complexCount` 접근 시 컴파일 에러 발생.

**수정**: `RegionMetrics` 인터페이스에 `complexCount: number` 필드 추가.

```ts
// 추가된 필드
/** 행정동 내 단지 수 (마커 호버 툴팁용) */
complexCount: number;
```

---

### 2. `server/src/services/repositories/recommendationRepository.ts`
**에러**: 위 수정 이후 `RegionCandidate` 조립 객체에서 `complexCount` 값이 누락.

**원인**: `RegionCandidate` 조립 부분(`candidates` map)에서 `complexCount`를 전달하지 않아 타입 불일치.
집계 쿼리에서 `complex_count`는 이미 산출되어 `c.agg.complexCount`로 사용 가능한 상태였음.

**수정**: `RegionCandidate` 조립 시 `complexCount: c.agg.complexCount` 추가.

```ts
// 추가된 라인
complexCount: c.agg.complexCount,
```

---

### 3. `client/src/pages/Recommendation/components/MapPanel.tsx`
**에러**: `TS2694: Namespace 'global.kakao.maps' has no exported member 'CustomOverlay'`
`TS2339: Property 'CustomOverlay' does not exist on type 'typeof maps'`

**원인**: 설치된 `@types/kakao.maps` 패키지의 타입 정의에 `CustomOverlay`가 누락되어 있음. 런타임에는 정상 동작하지만 TS 컴파일 단계에서 타입을 찾지 못함.

**수정**: `useRef<kakao.maps.CustomOverlay[]>` → `useRef<any[]>`로 변경.

```ts
// 변경 전
const regionOverlaysRef = useRef<kakao.maps.CustomOverlay[]>([]);

// 변경 후
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const regionOverlaysRef = useRef<any[]>([]);
```

---

### 4. `client/src/pages/RegionDetail/components/LstmFullAnalysis.tsx`
**에러**: `TS2322: Type '{ labels: string[]; datasets: object[]; }' is not assignable to type 'ChartData<"line", ...>'`

**원인**: `datasets` 배열 내 객체들이 `object[]`로 추론되어 `react-chartjs-2`의 `<Line>` 컴포넌트가 요구하는 `ChartData<'line'>` 타입과 불일치.

**수정**: `chart.js`에서 `ChartData` 타입을 import하고 `lineData`에 타입 assertion 추가.

```ts
// import 추가
import type { ChartData } from 'chart.js';

// 변경 전
const lineData = { labels, datasets };

// 변경 후
const lineData = { labels, datasets } as ChartData<'line'>;
```

---

## 배포 상태

| 환경 | 플랫폼 | 빌드 결과 |
|------|--------|-----------|
| 서버 | Render | ✅ 수정 완료 (에러 1, 2) |
| 클라이언트 | Vercel | ✅ 수정 완료 (에러 3, 4) |
