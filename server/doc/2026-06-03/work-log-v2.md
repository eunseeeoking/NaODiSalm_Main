# 작업일지 2026-06-03 (v2 · KI-18 Phase 1 + 서울 transit 대체 + UI/디자인 정합)

## 0. 한 줄 요약
**KI-18 Depth 3 "동 상세 평가" 공통 코어(Phase 1)**를 끝내고, 매매↔매물종류 결합·**비아파트 포함 전 종류 통근 비교(동 centroid)**·**서울 transit 라이브 API(TOPIS) 폐기 → 국토부 정류소 좌표 정적 파일 대체**(서울 적재 완료, 평균 60.5)를 완료. 추가로 다수 UI 수정 중 **사이트가 Tailwind preflight ON 전제로 디자인됐으나 설정이 off였던 근본 문제**를 발견·전환(전반적 미감 정합).

> 브랜치: `feat/capital-mvp` (main 미머지·미push). 참조: `docs/known-issues.md`(KI-6/7/18/24), `docs/depth3-design.md`. 이전 인계: `server/doc/2026-06-03/work-log.md`.
> ⚠️ **전부 미커밋**. 모든 typecheck(client·server) 통과. 서버 파일 변경분은 **dev 서버 재시작** 후 반영(tsx watch 가 변경을 놓치는 상태였음).

---

## 1. KI-18 Phase 1 — Depth 3 "동 상세 평가" 공통 코어 (완료·실DB 검증)

### 1-1. 우선순위 산정
KI-18(다세션 제품 작업)을 영향÷공수로 분해 → 4축 분해 재료(safety 3종·POI 8종·transit 품질)가 **기존 적재 컬럼 노출만으로 가능**(신규 집계 불필요)이라 "공통 코어 + 종류별 분기"를 1순위로 확정. 면적대별 median·반전세 비율·건물 시세 카드는 Phase 2+로 분리.

### 1-2. 서버
- **`fetchDongPriceStructure(sigunguCode, dong, propertyTypes)`** ([recommendationRepository.ts]) 신규 export — 단일 동 합성 aggregate로 기존 `fetchRepresentativePrices`·`fetchRentCostByRegion` 재호출 → **매매/전세/월세 median + 표본**을 KI-8/10/16 규약 그대로(반전세 제외·area 9~330·cutoff·HAVING≥5) 산출. 전 수도권 스캔 없이 후보 1동만.
- **`GET /api/regions/:legalDongCode/detail?types=APT,OFFI,VILLA,SH`** ([regions.ts]) 신규:
  - 4축 분해: `prisma.safetyIndex/poiSummary/transitRouteSummary.findUnique`(미적재 시 graceful null).
  - 시세 구조(위 헬퍼) + `complexCount`(4종 complex UNION count) + `propertyTypes` echo.
  - **사용자 입력 무관 객관 데이터** → 직접 URL 진입·새로고침에도 견고. 가중 4축 점수는 클라가 store 추천에서.
- **검증(실DB, 역삼동 1168010100)**: safety 3종·POI 8종·price 3종·complexCount 정상. SH-only → `sale:null`(매매거래 없음). 종류별 median 합리적 변동.

### 1-3. 클라이언트
- `RegionDetail` 타입군([types/region-detail.ts]) + `fetchRegionDetail`([api/regionDetail.ts]).
- **`RegionDetailEvaluation.tsx`** (신규) — 시세 구조 카드 + 4축 분해 카드(통근/주거비/안전/생활), 표본 칩(KI-11), 미적재 축 "추정·미집계" 정직 표기.
- `index.tsx` 분기: store `propertyTypes` 기반 — **APT 포함=단지 리스트+3년 전망 유지, 비아파트 전용=동 상세 평가 패널+정직 안내**(설계 §3-B).

---

## 2. 매매 전환 시 매물종류 아파트 자동 픽스 (QA 발견·해결)

- **증상**: 전월세로 OFFI/VILLA 선택 후 거래유형만 매매로 바꾸면 store `propertyTypes`가 그대로 남아 Depth 3가 "비아파트"로 오인(매매 추천 시세도 OFFI/VILLA 매매로 집계되던 잠재 불일치).
- **해결** ([useRecommendationStore.ts] `setDealType`): **전월세→매매 시 직전 선택을 `_rentPropertyTypes`에 백업 + `propertyTypes=['APT']` 픽스**, 매매→전월세 복귀 시 **복원**. store가 단일 진실원이라 추천 요청·Depth 3 진입·칩 표시가 자동 정합. `PropertyTypeFilter` 배지 "매매가 기준(해당 없음)" → **"아파트 고정"**.

---

## 3. 동 centroid 통근 비교 — 비아파트 포함 전 종류 (QA 발견·해결, KI-7 부분개선)

- **증상**: Depth 3 통근 비교(자차/대중교통)가 `complexId`로 `t_apt_complex`만 조회 → 비아파트·미지오코딩 단지에서 불가. `EmptyCommute` 문구도 무조건 "직장 미설정"이라 오도(직장은 SPA store로 정상 전달됨).
- **해결**:
  - 서버 `/api/commute/compare` ([commute.ts]) — `complexId` 없으면 **`oLat/oLng`(동 centroid)+`legalDongCode`** 출발지 허용(기존 complexId 경로 호환). 검증: 동 centroid 200·`source:cache`·`carSource:kakao`, 인자누락 400.
  - 클라 `fetchRegionCommute` + `index.tsx`가 `region.lat/lng→직장` 조회 → 패널 통근 축에 **자차/대중교통 실측** 표시(전 매물종류). `EmptyCommute` 문구 직장 유무로 분기.

---

## 4. 서울 transit — TOPIS 라이브 API 폐기 → 정적 정류소 좌표 파일 대체 (완료·적재 확인)

### 4-1. 진단(폐기 결정)
서울 TOPIS(`ws.bus.go.kr`) `SERVICE KEY IS NOT REGISTERED` 가 승인(자동승인·활용기간 2026-06-02~2028) 후에도 지속.
**TAGO가 동일 data.go.kr 키로 `apis.data.go.kr`에선 정상 작동**하므로 키/인코딩 문제가 아니라 **ws.bus.go.kr 백엔드로의 키 등록 불일치**가 본질 → 무한 대기 대신 **폐기** 결정.

### 4-2. 대체 구현
- **`seoulBusStopTransit.ts`** (신규) — 국토부 "전국 버스정류장 위치정보"(공공데이터포털 **15067528**) **정적 좌표 CSV**에서 **동 centroid 반경 1km 정류소 밀도**로 `transitScore` 산출(라이브 호출 0). 인코딩/열순서 무관 좌표 휴리스틱(위도 37~38·경도 126~128 범위) + 서울권 bbox 필터. 파일 없으면 안전 폴백.
- `transitProvider.ts` — 서울(11***) → 정적 프로바이더로 리다이렉트(경기·인천 TAGO 유지). `seoulTopisClient.ts` **삭제**.
- `server/data/README.md`(파일 받는 곳·두는 법) + `seedTransitSummary.ts` 주석 갱신. `server/data/*.csv`는 기존 gitignore 적용.
- **참고**: 정적이라 서울은 배차/막차(야간접근성) 미상 → 밀도 위주 점수(경기인천 합성점수와 방법론 차이, 둘 다 0~100 commute 보정용).

### 4-3. 적재 결과(사용자 실행 확인)
`seed:transit` → 처리 958동(서울/정적 396 · 경기인천/TAGO 562), **적재 949건**, transitScore 평균 **60.5**(11~100). → 서울 적재가 비던 마지막 블로커 해소(KI-6 🟢).

---

## 5. UI/디자인 수정 (QA 다발)

### 5-1. ⭐ Tailwind preflight 근본 발견 (KI-24)
검색바 보더 작업 중, `corePlugins.preflight = false`인데 **디자인은 preflight ON 전제**임을 발견. 그동안 input 기본 테두리(상/하 비대칭) 회피용 `border-0` 워크어라운드가 누적돼 있었음. → **preflight = true 전환**. 사용자 확인 "어쩐지 어색하던 부분이 다 맞다, 눈이 편해졌다". (잔여: index.css 수동 리셋 일부 중복·전 화면 회귀 점검 권장.)

### 5-2. 개별 수정
- **로딩 스피너**: 지도 중앙(MapPanel)·추천 패널 헤더(CardPanel)의 흐린 CSS 링 → **또렷한 SVG 호 스피너**(brand). 다크 패널에서 빈 공간처럼 보이던 문제 해소.
- **검색바**([WorkplaceSearch.tsx]): 화이트모드 구별 불가 → 우여곡절(보더→연파랑→) 끝에 **preflight ON 후 보더 복원**(중립 배경 + 균일 보더 + `focus:border-brand`). 다크모드는 원복.
- **Depth 3 매물 스와이퍼**: 섹션 `md:overflow-y-auto`가 `overflow-x:auto`를 강제하던 것 → `md:overflow-x-hidden`+`min-w-0`, ComplexCardList 래퍼 `min-w-0`. ⚠️ **브라우저 미검증**(다음 세션 실측 필요).
- **Depth 3 지도 선택 지역 폴리곤**([RegionMiniMap.tsx]): `useChoroplethLayer` 재사용 — 법정동 centroid→최근접 행정동 폴리곤 1개를 옅은 brand 채움+외곽선으로 강조("지금 보는 지역" 시각화).
- **가중치 오류 메시지 중복 제거**([WeightSliders.tsx]): 하단(소득분위 아래) 중복 배너 삭제, **슬라이더 영역 배너 하나**로 상세 텍스트(프리셋 안내 포함) 통합.
- **매물 단지 매매·참고용 명시**([ComplexCardList.tsx]): "아파트 **매매** 실거래 기준 · 참고용" 안내 — 전월세 조회 사용자 혼동 방지.
- **선택 매물 카드 파란 보더**: 이미 `border-2 border-brand`였으나 preflight off로 기본 버튼 보더에 가려져 있던 것 → preflight ON으로 노출 + `ring-2 ring-brand/25` 강화.

---

## 6. 변경 파일

**서버**: `recommendationRepository.ts`(+helper) · `routes/domains/regions.ts`(+detail) · `routes/domains/commute.ts`(+origin) · `services/external/seoulBusStopTransit.ts`(신규) · `transitProvider.ts` · `scripts/seedTransitSummary.ts` · `seoulTopisClient.ts`(삭제) · `server/data/README.md`(신규)
**클라**: `types/region-detail.ts` · `api/regionDetail.ts` · `pages/RegionDetail/{index.tsx, components/RegionDetailEvaluation.tsx(신규), RegionMiniMap.tsx, ComplexCardList.tsx}` · `stores/useRecommendationStore.ts` · `pages/Recommendation/components/{PropertyTypeFilter, WeightSliders, WorkplaceSearch, MapPanel, CardPanel}.tsx` · `tailwind.config.ts`(preflight)
**문서**: `docs/known-issues.md`(KI-6/7/18/24)

---

## 6-bis. 후속(2026-06-03) — Depth 3 스와이퍼/선택 보더 브라우저 실측·확정

§7-1(스와이퍼 실측)을 브라우저(Claude in Chrome, 강남구 대치동 실DB)로 처리:
- **스와이퍼 정상** — 좌우 드래그/휠 스와이프 동작 확인(코드/오버플로 구조 정상, 이전 `min-w-0` 수정 유효).
- **선택 카드 디자인 = 보더만**(사용자 요청): 그림자(`shadow-card`/`shadow-card-hover`)·헤일로(`ring`)·lift(`-translate-y-px`) 전부 제거 → 선택 2px brand · 미선택 1px 중립. 그림자 제거로 음수마진(`-mx-2`) 트릭 불필요 → 스크롤 컨테이너 `px-1 py-1` 로 단순화(좌측 첫 카드 클립도 해소).
- **⭐ 근본 버그 발견·해소(KI-24)**: ring 제거하니 선택 보더가 **아예 안 보임** → DOM 측정상 `border-2 border-brand` 인데 `border-style:none·width 0px`. 원인은 index.css `button{border:0}`(preflight off 워크어라운드)이 `border-style:none` 까지 강제 → 요소 선택자 우선순위로 preflight `*{border-style:solid}` 를 덮음. 그동안 ring(box-shadow)이 보더처럼 보여 잠복. → `button{border:0}` 제거(preflight 가 border-width:0 담당). **사이트 전역** 변경이라 회귀 1회 권장.
- 변경: `ComplexCardList.tsx`(카드 스타일·패딩) · `css/index.css`(button 리셋) · `known-issues.md`(KI-18/24).

## 7. 다음 세션 출발점
1. ~~**Depth 3 매물 스와이퍼 브라우저 실측**~~ → 🟢 §6-bis 완료(스와이퍼·선택 보더 확정, KI-24 근본 해소).
2. **preflight ON 전 화면 회귀 점검** — `button{border:0}` 제거가 전역이므로 다른 화면 확인 + 남은 `border-0`·수동 마진 정리(KI-24 잔여).
3. **KI-18 Phase 2** — 면적대별(소·중·대) median 분리(KI-16 후속) · 반전세 비율 라벨(KI-10 후속) · 빌라·오피 건물 시세 카드(설계 §6) · 시세 분포 시각화.
4. (선택) KI-21 median 사전집계로 추천 서브초화 · Depth 2 통근 랭킹 정밀화(KI-7).
5. **커밋**(미요청 상태) — 기능 단위로 분리 커밋 권장.
