# 다음 작업 정리 (Next Steps)

> 새 세션 / 후임 / 본인 이어가기용 단일 진입점.
> 우선순위 순으로 정리. 위에서부터 그대로 진행하면 됨.
> 마지막 갱신: 2026-05-21 (오후 — Sprint B 완료)

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

→ 상세: server/doc/2026-05-21/work-log.md
   · §1~§7   Sprint A
   · §8~§10  Sprint B

[2026-05-20 직전 완료]
  · Depth 3 (지역 상세) 1차 구현 — 2026-05-20/work-log.md
  · 서비스명 리브랜딩 "스마트 직세권" → "나어디삶" — 2026-05-20/rebranding.md
  · Depth 3 아키텍처 문서 — 2026-05-20/depth3-architecture.md
  · DB 운영 계정 root → molit 전환 가이드 (.env 만 변경, 권한 OK)
```

---

## 🎯 즉시 다음 (가장 우선) — Sprint C 진입

> 클라이언트는 wrapper 가 이미 mock 폴백을 처리 → 서버 라우터만 붙으면
> DEMO 뱃지가 사라지고 실 데이터로 자동 전환됨. 클라 변경 0 라인.

### Sprint C-1. **서버 `POST /api/recommendations` 신규** (3~4h, 핵심)

**서버 계약 (이미 클라이언트가 기대하는 모양):**
```ts
// Request
{
  workplace: { lat: number, lng: number, label?: string },
  budget:    number,                    // 만원
  weights:   { commute, value, investment, life },  // 합 ~100
  patience:  number                     // 편도 분
}

// Response — 클라이언트 RegionRecommendation[] 타입과 1:1
[
  {
    legalDongCode, displayName, sigunguCode, sigungu, dong,
    lat, lng,
    totalScore, commuteScore, valueScore, investmentScore, lifeScore,
    commuteMinutes, representativePrice, expectedReturn3y
  }, ...
]
```

**구현 가이드:**
```
[1] 라우터 파일:  server/src/routes/domains/recommendations.ts
    · POST '/' (= /api/recommendations)
    · 입력 validation 은 lightweight (lat 33~39, lng 124~132, weights ≥0)

[2] 점수 계산 — 하이브리드 (SQL view + JS 가중합, 5-21 결정사항)
    · SQL view (또는 raw query):
        SELECT
          legal_dong_code, display_name, lat, lng,
          median_price,                  -- 가성비 베이스
          commute_minutes,               -- t_commute_matrix from cacheKey
          forecast_3y,                   -- t_training_result 3년 예측 m²단가
          life_score                     -- POI 카운트 (Sprint D 까지는 0)
        FROM t_apt_complex c
        LEFT JOIN t_training_result t ON ...
        LEFT JOIN t_commute_matrix  m ON m.cache_key = ? AND m.legal_dong_code = c.legal_dong_code
        WHERE c.sigungu_code LIKE '11%'  -- 우선 서울
        GROUP BY legal_dong_code

    · 위 결과를 행정동 단위로 집계 후, Node 측에서:
        commuteScore   = patience 대비 분수 변환 (예: 100 - clamp((m-15)/0.7))
        valueScore     = 1 / (median_price / sigungu_median)
        investmentScore = forecast_3y - current  (정규화)
        lifeScore       = POI 카운트 정규화 (Sprint D)
        totalScore     = Σ score * weight / 100

[3] 응답 길이 8건 (totalScore desc) — 클라이언트 mockRegions 와 동일

[4] 통근 매트릭스가 없는 (직장이 처음인) 경우:
    · ODsay 비동기 fetch 큐에 enqueue + 즉시 Haversine 추정 응답
    · 또는 클라이언트가 /api/commute/matrix 따로 호출하므로 그쪽이 이미 처리
```

**검증:**
- DemoBadge 가 사라지는지 (= dataSource='api')
- 시연 흐름: 강남역 → 카드 8건 → 1위 클릭 → /region/...
- 빠르게 다른 직장 입력 시 AbortController 가 이전 요청 취소하는지 (콘솔)

### Sprint C-2. **매물 + LSTM 서버 API** (4~6h, Depth 3 mock 대체)
```
GET /api/regions/:legalDongCode/complexes      → AptComplex[]
GET /api/lstm/:complexId                       → LstmAnalysis (series 96점 + confidence)
GET /api/commute/compare?complexId=&wpLat=&wpLng=  → CommuteCompareData
```
- mock 파일과 동일 응답 모양으로 설계 → 클라 변경 최소화
- LSTM 시리즈는 t_training_result + 과거 거래에서 조합 (현재 mock 의 결정론적 합성과 동일 구조)

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
cd 2026_MOLIT_CONTEST

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

## 🚦 다음 세션(2026-05-22+) 시작 시 첫 한 줄

> **"server/src/routes/domains/recommendations.ts 신규 — POST /api/recommendations 라우터 작성. SQL view + Node 가중합 (풀 프로시저 X). 응답 모양은 클라이언트 RegionRecommendation[] 그대로. 첫 200 OK 받는 순간 DEMO 뱃지 자동 소거."**

### 권장 순서

```
[A] Sprint C-1  서버 추천 API           ← 시작점. 클라 변경 0 라인 (wrapper 가 처리)
[B] 자동 백업 cron                       ← C-1 중간 30분 짬
[C] Sprint C-2  매물/LSTM API           ← Depth 3 mock 대체
[D] Sprint D    POI lifeScore + AptRent valueScore + TiDB 이관 + 발표 자료
```

위에서부터 진행하면 됩니다.
