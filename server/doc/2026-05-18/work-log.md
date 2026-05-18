# 작업 로그 — 2026-05-18

## 한 줄 요약

> DB 컬럼 코멘트 SQL 스크립트 작성 + Depth 2 (지역 추천) 페이지 UX 설계 및 React 클라이언트 골격 구축 완료.

---

## 1. DB 작업

### 컬럼 코멘트 SQL 스크립트
- **위치**: `server/prisma/scripts/add_column_comments.sql`
- **목적**: HeidiSQL 등 GUI에서 컬럼 의미 즉시 확인 (Prisma `///` 주석은 DB 까지 안 가므로)
- **방식**: `ALTER TABLE ... MODIFY COLUMN <기존타입> ... COMMENT '...'`
- **안전성**: 컬럼 타입 100% 동일 → 메타데이터만 갱신, **데이터 손실 0**
- **대상**: 7개 테이블 × 71개 컬럼
- **검증 쿼리 포함**: `INFORMATION_SCHEMA.COLUMNS` SELECT 로 적용 결과 확인

### 백업 절차 정리
- 사용자가 풀백업 절차 요청 (지난 DB 유실 트라우마)
- 방법 A: HeidiSQL GUI 내보내기 (안전 · 느림)
- 방법 B: `mysqldump --single-transaction --quick --routines --triggers --events` (권장)
- 무결성 3단계 검증 + 별도 DB 시험 복원 권장

---

## 2. UX / 제품 의사결정

### 서비스 포지셔닝 재정의
- ❌ "부동산 매매 플랫폼" (직방·다방·호갱노노)
- ✅ "직장 기준 지역 추천 의사결정 도구"
- 핵심 차별점: **매물 분석 → 사용자(가중치) 분석** — 광고 모델 기반 기존 앱은 못 함

### 화면 깊이 3단계 확정
```
Depth 1   입력 (직장 + 예산 + 4축 가중치)
Depth 2   지역 추천 (지도+카드, 메인)   ← 이번 답변에서 골격 구축
Depth 3   지역 상세 → 매물 + LSTM 분석   ← 다음
```

### Depth 2 화면 결정사항
| 항목 | 결정 |
|---|---|
| 레이아웃 | 좌 지도 60% · 우 카드 40% (데스크탑 우선) |
| 직장 입력 | 카카오 Places 자동완성 + 인기 직장 6 칩 (사전 캐싱) |
| 통근 인내심 | 슬라이더 (지도 상단, 20~90분) — 히트맵·리스트 동시 연동 |
| 가중치 | 4축 슬라이더 + 프리셋 3종 (직장인/투자/실거주) |
| 카드 호버 | **양방향 호버** (카드↔지도 폴리곤 강조) |
| 빈 결과 | **자동 제안** ("인내심을 X분으로 늘리면 N건") |
| 더보기 | 상위 8건 고정 + "전체 N건 보기" 버튼 |
| 모바일 | 이번 단계 미적용 (공모전 이후) |
| 시군구 필터 | 없음 — 직장 + 인내심으로 자동 결정 |

### 통근 데이터 전략
- 지도 표현: **행정동 단위 통근 히트맵** (정밀 등시선 X, 단순 동심원 X)
- API: **ODsay** 도입 (개인 무료 자격, 일 1000회 한도)
- 캐싱: `t_commute_matrix` 테이블 + cache_key 4자리 반올림으로 호출 절감
- 발표 데모: 인기 직장 6곳 사전 캐싱 → 즉시 응답

### LSTM 데이터 표시
- Depth 2 카드: "3년 +7.4%" 축약 한 줄만
- Depth 3 매물 상세: 풀 분석 카드 (5년 추이 + 신뢰구간 음영 + 신뢰도 게이지) — 시안 B 채택
- 데이터 부족 케이스 4종 처리 규칙 정리 (`confidence<0.5` 회색 / 구간 평균 라벨 / sample<30 다운톤 / 3y null `—`)

---

## 3. 클라이언트 코드 작성 (D 단계)

### 도입한 라이브러리
```
zustand            ─ 상태 관리 (3KB, 가볍고 직관)
react-router-dom   ─ /, /explore 라우팅
tailwindcss@^3     ─ 스타일링 (preflight OFF 로 기존 CSS 보존)
```

### 라우팅 구조
| 경로 | 화면 | 비고 |
|---|---|---|
| `/` | RecommendationPage | 새 Depth 2 메인 |
| `/explore` | ExplorePage | **기존 App.tsx 화면 보존** (시군구 → 단지 마커) |
| `*` | → `/` | catch-all redirect |

### 신규 파일 (총 14)
```
client/tailwind.config.ts                  Tailwind 설정 (commute/roi 컬러 ramp)
client/postcss.config.cjs

client/src/types/recommendation.ts         도메인 타입 + WEIGHT_PRESETS
client/src/stores/useRecommendationStore.ts  workplace/budget/weights/patience/hovered/recs
client/src/stores/useAuthStore.ts          fetchMe 통합 부트

client/src/pages/Explore.tsx               기존 App.tsx 내용 보존
client/src/pages/Recommendation/
  ├─ index.tsx                              페이지 컨테이너
  ├─ data/popularWorkplaces.ts             인기 직장 6곳
  ├─ data/mockRegions.ts                   더미 추천 8건
  └─ components/
      ├─ RecommendationHeader.tsx           로고 + 검색 + 예산
      ├─ WorkplaceSearch.tsx                카카오 Places 자동완성 + 퀵 칩
      ├─ MapPanel.tsx                       지도 + 인내심 슬라이더 + 범례
      ├─ CommutePatienceSlider.tsx
      ├─ CardPanel.tsx                      가중치 + 카드 리스트
      ├─ WeightSliders.tsx
      ├─ RegionCard.tsx                     양방향 호버 연동
      └─ EmptyState.tsx                     자동 제안
```

### 편집 파일
```
client/src/main.tsx                BrowserRouter 적용
client/src/App.tsx                 Routes 컨테이너로 재구성
client/src/index.css               @tailwind directives 최상단 추가
client/src/types/kakao.d.ts        services.Places + Geocoder 타입 보강
```

---

## 4. 알려진 미구현 (의도적 — 다음 단계)

```
1. 행정동 폴리곤 통근 히트맵        ← GeoJSON 다운로드 + ODsay 매트릭스
2. 실제 API 연동 (/api/recommendations) ← 서버 엔드포인트 설계 필요
3. Depth 3 (지역 상세) 페이지        ← Week 2 후반
4. 카드↔지도 양방향 호버 (폴리곤 측) ← 폴리곤 통합 후
5. ODsay 가입 + 통근 매트릭스 캐시   ← Week 2 본격 시작 시
6. 모바일 반응형                     ← 공모전 이후
7. Depth 1 (입력) 별도 페이지        ← Week 2 후반
```

---

## 5. 다음 우선순위 후보

```
[A]  서버 API 설계 — /api/recommendations 응답 스키마 + 컨트롤러
[B]  행정동 GeoJSON 다운로드 + 카카오맵 폴리곤 오버레이 통합
[C]  ODsay 가입 + t_commute_matrix 캐시 테이블
[D]  Depth 3 (지역 상세 + 매물 + LSTM 풀 분석)
```

---

## 부록 — 발표 메시지 시안 (정리)

```
서비스 한 줄: "매물을 분석하는 서비스는 많습니다. 우리는 사람을 분석합니다."

화면 흐름:    직장 입력 → 4축 가중치 + 통근 인내심 → 지역 추천 → 매물 상세 → LSTM 예측

차별 포인트:
  1. 매물 중심 → 사용자(가중치) 중심 — 패러다임 차이
  2. 직장 기준 통근이 절대 메트릭 — 호갱노노 등엔 없는 입력축
  3. LSTM + ODsay + 카카오 + 국토부 — 4종 데이터 융합
  4. 캐시 영구화로 발표 즉시 응답 (인기 직장 6곳 사전 계산)
```
