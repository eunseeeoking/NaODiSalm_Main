# 작업일지 2026-05-30 P2 (client+server) — 통계 정합성 · 예산 필터 · 매물종류

> 같은 날 오전 세션(work-log.md, 전월세 affordability 수직 슬라이스)의 후속.
> 오전 세션 TODO 중 "Depth2 매물종류 필터", "예산 필터" 를 당겨서 처리하고,
> 집계 신뢰도(이상치/혼합) 문제를 함께 교정.

## 0. 한 줄 요약
전월세 affordability 의 **신뢰도 결함 3종**(① 4종 매물 혼합 평균, ② AVG 이상치 취약, ③ 예산 슬라이더 미동작)을 교정. 매물종류 필터(아파트/오피스텔/빌라/단독·다가구)를 추가해 사용자가 찾는 종류만 집계하고, 동 시세를 **중위값**으로 산출하며, 예산 슬라이더가 **거래유형별 자본 상한**으로 실제 후보를 필터링하도록 end-to-end 연결.

---

## 1. 배경 진단 (왜 이 작업을 했나)

오전 세션으로 affordability 가 "매매가 합성(가정 2겹)" → "실거래 전월세(가정 1겹)" 로 개선됐으나, 실거래 집계 자체에 신뢰도 구멍이 남아 있었음. 코드 근거와 함께 정리:

1. **매물종류 혼합 오염** — `fetchRentCostByRegion` 이 `t_apt_rent + t_offi_rent + t_villa_rent + t_sh_rent` 를 `UNION ALL` 로 풀링한 뒤 동 단위 평균. 아파트 전세 3.5억과 빌라·단독 반지하 전세 3천만이 한 평균에 섞여 "동 시세" 의미가 무너짐. 사용자가 아파트를 찾아도 빌라가 끌어내린 값이라 부담 점수가 후하게 나옴.

2. **평형 필터 부재 + AVG 이상치 취약** — 매매가 경로(`fetchRepresentativePrices`)는 `area_m2 BETWEEN 60 AND 85` 로 평형을 걸렀으나, 전월세 경로엔 평형 필터가 전무. 반지하 원룸~대형이 다 들어가고 `AVG` 라 이상치 1~2건이 동 시세를 흔듦 (옆집 월세 120 vs 반지하 30).

3. **예산 슬라이더 미동작** — `fetchRegionCandidates(budget)` 주석이 "현재 단계에선 사용 안 함" 그대로. 라우터가 budget 을 검증만 하고 repository 에 **전달조차 안 함**. 예산 1.5억으로 맞춰도 5억 동이 추천에 남아 신뢰도 직격.

4. **(향후) 소득분위 그룹핑 착시** — 이번 범위 밖. 서버는 이미 `incomeMonthly` raw 숫자를 수용하므로, 클라이언트 직접 입력만 붙이면 해소. (P1에서 입력란 제공 확인 → 보류)

5. **(향후) 고정축 50 가중치 문제** — `safetyBase`/`lifeScoreBase` 가 실데이터 적재 전 50 고정. worker 가중치 기준 100점 중 45점이 모든 동에서 동일 50 → 총점이 둔감해 "이게 무슨 점수냐" 반론의 핵심. P3 후보.

---

## 2. 이번 세션 작업 내용 (완료)

### 2-1. 서버 — scoring.ts
- `PropertyType = 'APT' | 'OFFI' | 'VILLA' | 'SH'` 타입 + `ALL_PROPERTY_TYPES` 상수 추가 (집계 풀 선택용).

### 2-2. 서버 — recommendationRepository.ts (집계 재작성, #3·#4)
- `RentStat { monthlyCost, depositManwon, sampleCount }` 인터페이스 신규 — 기존 `Map<string, number>` → `Map<string, RentStat>`.
- `rentSource(type, contractType)` 헬퍼 — 매물종류별 rent×complex JOIN `Prisma.Sql` 조각.
- `fetchRentCostByRegion(aggregates, dealType, propertyTypes)` 재작성:
  - **선택 매물종류만** 동적 `UNION ALL` (`Prisma.join(..., ' UNION ALL ')`). 종류 미선택 시 빈 맵 → 폴백.
  - 평형 sanity 필터 `area_m2 BETWEEN 9 AND 330` (면적 0/누락·비현실 레코드 제거).
  - 건별 cost 산출(전세=deposit×RATE / 월세=monthly+deposit×RATE) 후 **동별 중위값**을 MySQL 8 윈도우 함수로 한 쿼리에 계산: `ROW_NUMBER() ... rn IN (FLOOR((cnt+1)/2), FLOOR((cnt+2)/2)) 의 AVG`.
  - median(cost)·median(deposit)·sampleCount 동시 산출. `HAVING MAX(cnt) >= 5` 로 표본 부족 동 제외.
  - 쿼리 실패/테이블 미존재 시 빈 맵 → 매매가 합성 폴백 (graceful 유지).
- `fetchRegionCandidates(..., { budget, propertyTypes })`:
  - **예산 하드필터(#2)** — SALE: `representativePrice > budget` 제외 / JEONSE·MONTHLY: `depositManwon(중위) > budget` 제외. 전월세 표본 없으면(폴백 경로) 보증금 미상이라 예산 필터 생략(오탈락 방지).
  - budget 미지정 시 `Infinity`(필터 비활성), propertyTypes 미지정 시 전체 4종 (둘 다 하위호환).
  - 후보의 `rentMonthlyCost` 를 `RentStat.monthlyCost` 로 매핑.

### 2-3. 서버 — recommendations 라우터
- body 에 `propertyTypes?: PropertyType[]` 수용·검증(APT|OFFI|VILLA|SH 배열).
- `budget` · `propertyTypes` 를 `fetchRegionCandidates` 에 실제 전달 (이전 누락 수정).

### 2-4. 클라이언트 — 타입·스토어·API·URL
- `types/recommendation.ts`: `RecPropertyType`, `PROPERTY_TYPE_LABELS`, `PROPERTY_TYPE_ORDER`, `DEFAULT_PROPERTY_TYPES`(아파트·오피스텔·빌라) 추가.
- `stores/useRecommendationStore.ts`: `propertyTypes` 상태 + `togglePropertyType`(마지막 1개 해제 불가) + `setPropertyTypes`.
- `api/recommendations.ts`: `RecommendationRequest.propertyTypes?`.
- `utils/urlState.ts`: `pt` 파라미터 인코딩/디코딩(표시 순서 정규화·중복 제거, 유효성 검증).
- `index.tsx`: propertyTypes 를 fetch 요청 · URL · effect deps · 하이드레이션에 연결.

### 2-5. 클라이언트 — UI
- `components/PropertyTypeFilter.tsx` 신규: 4종 복수선택 칩. 거래유형 '매매' 면 비활성(흐리게), 최소 1개 유지 안내.
- `LeftPanel`(데스크톱) · 모바일 가중치 드로어에 배치 (DealTypeToggle 아래).
- `CommutePatienceSlider`: 예산 라벨에 거래유형별 캡션(전세·월세→"보증금 한도", 매매→"매매가 한도").

---

## 3. 데이터/설계 메모
- **중위값 채택 근거**: AVG 는 반지하·옥탑 등 극단 1~2건에 끌려감. 중위값은 동 시세의 "대표성"을 회복. 단, 매물종류를 섞은 채 중위만 쓰면 이봉분포의 가운데(둘 다 대표 못 함)가 나오므로 **매물종류 필터와 함께** 써야 효과. 둘을 한 세트로 도입.
- **예산 = 자본 상한** 정의: 전세=보증금 / 매매=매매가. 월세의 "월 임대료 상한"은 이번 범위 밖(보증금만 필터) → 향후 별도 슬라이더 또는 월 한도 입력 검토.
- **SH(단독·다가구) 기본 제외**: area=연면적이라 평형 의미가 다르고 반지하 비중 큼 → 기본 off, 사용자 명시 선택. 기본 포함 전환은 1줄(`DEFAULT_PROPERTY_TYPES`).
- 동 매칭 키 `${sigunguCode}|${dong}` 는 기존 가격 집계와 동일 규약 유지.
- `sampleCount` 를 RentStat 에 실어 뒀으나 아직 응답·UI 로 노출 안 함 → P3 "표본 N건 / 참고용" 신뢰 칩에서 사용 예정.

## 4. 검증
- **중위값 SQL 트릭** 순수 node 시뮬레이션: 홀/짝수, 단일 이상치 포함 6케이스 전부 trueMedian 과 일치. `[100,100,100,100,5000]` → median 100 vs mean 1080 (이상치 방어 확인).
- ⚠ **전체 tsc 미실행**: 작업 환경 샌드박스의 파일 마운트 동기화 지연으로 bash tsc 가 stale/truncated 파일을 읽어 신뢰 불가(오전 세션과 동일 이슈). 권한 있는 파일은 모두 정상. **client·server 에서 `npm run typecheck` 1회 + 전세/월세·매물종류 토글 실제 응답 스모크 테스트 필요.**
- ⚠ **예산 기본값 1.5억** 이라 전세에서 보증금 중위 초과 동(강남권 등)이 실제로 빠짐 — 의도된 동작이나, 결과 0건 시 빈 화면. EmptyState 안내 보강 전까지 데모 시 슬라이더 범위 주의.

## 5. 다음 세션 TODO
- [x] (P3-#5) 고정축 50 가중치 분모 제외 또는 동적 가중치 — 점수 변별력 회복. → §6
- [x] (P3-#6) 점수 투명성 UI: 추정축 표시 + sampleCount 신뢰 칩 + 월부담 환산. → §6
- [x] 예산 초과 "범위 넓히기" 안내 (EmptyState 연계). → §6
- [x] 소득 직접 입력값이 quintile 매핑을 override 하는지 재확인 → **버그 발견·수정**. §7
- [x] 결과>0 이면서 예산으로 일부 제외된 경우 "N개 숨김" (응답 shape 변경). §7
- [x] 월세 "월 임대료 상한" 필터 — MONTHLY 전용 슬라이더 추가. §8
- [ ] `npm run typecheck`(client·server) + 토글 스모크.

---

## 8. 후속 — 월세 한도 필터 (완료)

### 8-1. 배경
예산 슬라이더는 "자본 상한"(전세 보증금 / 매매가)만 제한. 월세는 보증금이 낮아 예산 필터가 거의 안 물려서, **월 임대료 자체의 상한**이 없었음. 월 60만 vs 120만이 같은 동에 섞여 추천되는 문제.

### 8-2. 서버
- `RentStat.monthlyRentManwon` 추가 — 동별 **순수 월세 중위값**(전세=0). 기존 cost·deposit 중위값 쿼리에 `median(monthly_manwon)` 1열 추가(윈도우 함수 동일 트릭).
- `fetchRegionCandidates`: `monthlyBudget` 옵션. MONTHLY 에서 `monthlyRentManwon > monthlyBudget` 인 동 제외 — **보증금 한도와 별개의 AND 조건**. 제외 건수는 `budgetFilteredCount` 에 합산.
- 라우터: `monthlyBudget` 수용·검증(양수)·전달.

### 8-3. 클라이언트
- store `monthlyRentCap`(기본 100만원/월) + `setMonthlyRentCap`.
- api `monthlyBudget?`, index 는 **MONTHLY 일 때만** `monthlyBudget = debouncedMonthlyRentCap` 전송(전세·매매엔 미전송), debounce·deps·URL·하이드레이션 배선.
- urlState `mb` 파라미터 — MONTHLY 일 때만 인코딩.
- `CommutePatienceSlider`: 거래유형이 '월세' 일 때만 "월세 한도" 슬라이더(20~300만, step 5) 노출.
- 배너 카피 일반화 — MONTHLY 는 보증금·월세 혼합 제외라 "예산" 으로 표기(CardPanel·EmptyState).

### 8-4. 검증(node)
SALE/JEONSE/MONTHLY 필터 분기 + 월세 한도 초과/보증금 초과/전세 무시 + URL mb 조건부 인코딩 전 케이스 통과.

---

## 9. 후속 — 추천 조회 로딩 상태 (완료)

### 9-1. 배경
추천 API 가 ~2,850ms 걸리는데 응답 전까지 **이전 추천 데이터·지도 핀이 그대로 잔류** → 사용자가 "조회 중인지" 헷갈림.

### 9-2. 구현
- store `isLoading` + `setLoading`. `setRecommendations` 가 성공 시 자동 false.
- `index.tsx` fetch effect: 시작 시 `setLoading(true)`, then(성공)·catch(실패, AbortError 제외) 에서 false. 직장 미입력 시 false. 빠른 연속 변경은 AbortController 가 직전 요청 abort → 새 요청이 로딩 관리.
- `MapPanel`: `isLoading` 이면 추천 핀 오버레이를 제거하고 **재그리지 않음**(deps 에 isLoading 추가). 지도 중앙에 스피너 + "추천 지역 조회 중…" 표시.
- `CardPanel`: `!workplace → isLoading → isEmpty → 리스트` 순. 로딩 시 스피너 헤더 + 펄스 스켈레톤 카드 5장(EmptyState·이전 데이터 깜빡임 방지).

### 9-3. 메모
- 통근 히트맵(choropleth)은 직장 기준이라 필터 변경과 무관 → 로딩 중에도 유지(핀만 제거).
- 슬라이더 변경은 350ms debounce 후 fetch → 그 사이 최대 350ms 는 로딩 미표시(허용). 초기 로드는 debounce 초기값 즉시 반영이라 지연 없음.

---

## 10. 후속 — 슬라이더 한도 상향 + '최대=무제한' (완료)

### 10-1. 배경
한도를 보수적으로 잡으면 슬라이더 조작만으론 절대 못 보는 매물이 생김. 거래유형별로 한도를 키우고, **슬라이더 최대 위치 = 무제한(전체 매물)** 로 명시.

### 10-2. 슬라이더 범위 (types `BUDGET_SLIDER` / `MONTHLY_RENT_SLIDER`)
- 매매가: 1천만 ~ 10·20·30억 ~ **최대**(센티넬 40억 지점)
- 보증금: 1천만 ~ 5·10·15·20억 ~ **최대**(센티넬 25억 지점)
- 월세  : 5만 ~ 100·200·300·400만 ~ **최대**(센티넬 500만 지점)
- 눈금 라벨은 균등 분할 위치에서 실제값과 일치(검증 완료).

### 10-3. 무제한 동작
- 값이 해당 슬라이더 `max` 이상이면 UI 는 "최대" 표기, index 는 `budget`/`monthlyBudget` 를 **생략(undefined)** 전송 → 서버 예산 필터 OFF = 전체 매물.
- 서버: `budget` 검증을 **선택**으로 완화(생략 시 Infinity = 필터 없음). `monthlyBudget` 은 이미 선택.
- EmptyState·CardPanel "한도 늘리기" 는 거래유형별 `max`(=최대) 로 클램프, 도달 시 "최대" 표기.

### 10-4. 검증(node)
SALE/JEONSE 무제한 전송(undefined), 월세 무제한/전세 미전송, 눈금 라벨 실제값 일치 전 케이스 통과.

---

## 11. 후속 — 좌측 패널 접이식 4섹션 (완료)

### 11-1. 요구
좌측 입력 패널을 4개 그룹으로 각각 접히게: 통근·예산 / 거래유형 / 매물종류 / 가중치·소득분위. 접으면 아이콘 + 라벨 헤더만 남아 작게.

### 11-2. 구현
- `CollapsibleSection` 신규 — 아이콘 박스 + 제목(+툴팁) + chevron 헤더, 본문 토글. 각 섹션 독립(로컬 state), 접힘 시 헤더만 노출.
  - InfoTooltip 이 자체 `<button>` 이라 **헤더 토글 버튼과 분리 배치**(중첩 button 회피, ⓘ 클릭이 토글 안 함).
- 4개 컴포넌트에 `bare` prop 추가 — 외곽 카드·자체 제목 제거(섹션이 대체). 동적 배지(거래유형 근거·매물종류 복수선택)는 본문 상단 캡션으로 유지. 가중치 합계 표시도 유지.
- `LeftPanel`: 4개 `CollapsibleSection` + 인라인 아이콘으로 조립, 전체 스크롤 영역.
- **모바일 드로어는 비-bare(기존 카드형) 그대로** — 영향 없음.

### 11-QA. 전세/월세 모드 매매가 폴백 제거 (QA 보정)
- 증상: 빌라·단독 + 전세 + 예산 4천만에서 광화문이 "가격 2.3억"으로 1위. 
- 원인: 선택 매물종류의 전세 표본이 5건 미만이면 `rentStat=null` → affordability 가 **매매가 합성(sale-proxy)** 으로 폴백 → 카드가 아파트 매매가(representativePrice)를 표시. 게다가 폴백 경로는 보증금 미상이라 **예산 필터가 생략**되어 4천만 초과 매물이 통과.
- 수정: JEONSE/MONTHLY 에서 `rentStat` 없는 동은 후보에서 **제외**(`if (!rentStat) continue`). 전월세 의사결정 컨셉상 전월세 표본 없는 동은 유효 후보 아님. 남는 후보는 전부 보증금 데이터 보유 → 예산 필터 일관 적용, 매매가 폴백 카드 소멸.
- 영향: 희소 지역(빌라/단독 전세 적은 도심)은 결과가 줄거나 0건 → EmptyState 가 통근·예산 넓히기 유도.

### 11-3. 한 번에 하나만 열림 + 패널 닫기 버튼 제거
- `CollapsibleSection` 을 **제어형(open·onToggle)** 으로 전환. `LeftPanel` 이 `openKey` 단일 상태 관리 → 한 섹션 열면 나머지 자동 닫힘(전체 동시 열림 방지). 같은 섹션 재클릭 시 닫힘. 기본 '통근·예산' 열림.
- 좌측 패널 전체 토글(닫기) 버튼 제거 — 좌측 패널은 데스크톱에서 항상 표시. 관련 미사용 `openLeft`/`toggleLeft`/`LEFT_OPEN`/`LEFT_CLOSED` 도 정리. (우측 추천 패널 토글은 유지)

---

## 12. KI-1·2·3 — 후보·대표가 매물종류 인지화 (완료)

> `docs/known-issues.md` KI-1/2/3 해결. 후보 추출이 아파트 단지에 anchor 되어 빌라/단독 컨셉과 충돌하던 구조 교정.

### 12-1. KI-1 후보 universe union
- `complexSource(type, prefix)` 헬퍼 — 4종 complex 테이블을 동일 컬럼(sigungu_code·legal_dong·lat·lng)으로 노출.
- `fetchRegionAggregates(propertyTypes, prefix)` 가 선택 종류 complex 를 **UNION ALL** → centroid·count 산출. 빌라/단독 단지 동도 후보화.

### 12-2. KI-2 대표 매매가 union
- `tradeSource(type)` 헬퍼 — APT/OFFI/VILLA trade×complex JOIN (SH 매매 없음).
- `fetchRepresentativePrices(aggregates, propertyTypes)` 가 매매 보유 종류 **UNION ALL** AVG(60~85㎡). 매매 모드 전 종류 고정.

### 12-3. KI-3 게이트 거래유형별 분리
- 후보 루프 게이트: SALE=매매 표본 필수(`price==null`→제외), JEONSE/MONTHLY=전월세 표본 필수(`!rentStat`→제외, 매매 유무 무관). 전월세 모드 매매 표본 없으면 representativePrice=0.
- `fetchRegionCandidates`: `universeTypes`(매매=전 종류 고정/전월세=선택)·`priceTypes`(매매 보유 종류) 산출해 두 함수에 전달.

### 12-4. 영향 / 잔여
- **매매 모드 결과 변동**: 후보·대표가가 아파트→APT+OFFI+VILLA 로 확장(다종 혼합 AVG). 시연 안정성 영향 가능 — 필요 시 매매를 APT-only 로 되돌리는 건 1줄.
- 잔여: KI-8(매매 median), cutoff apt 기준 stale, 60~85㎡ 밴드 비아파트 과대 — known-issues 에 기록.

### 12-5. 검증(node)
universe/price 종류 산출(전세 빌라+단독→빌라/단독 후보, 매매→전종류 고정), 게이트(전세 동 매매표본 없어도 유지·전세표본 없으면 drop·매매 표본 없으면 drop) 전 케이스 통과.

---

## 7. 후속 세션 — 소득 override · 예산 숨김 수 (완료)

### 7-1. 소득 직접입력 override 버그 수정 (사용자가 지적한 착시의 실제 원인)
- **버그**: `WeightSliders.handleSalaryChange` 가 입력 급여를 `salaryToQuintile(salary)` 로 **분위로 반올림**해 저장 → 월 220 입력해도 2분위(274)로 서버 전송. affordability 가 실제보다 후하게 나오는 착시.
- **수정**: store 에 `incomeManwon`(실제 입력값) 추가. 급여 입력 시 분위 반올림 없이 그대로 저장하고, 분위 칩은 "구간" 하이라이트로만 사용.
  - `index.tsx`: `incomeMonthly = incomeManwon ?? (incomeQuintile ? QMAP : undefined)` — 직접입력 우선.
  - `urlState`: `inc` 파라미터(정확값) 추가, 디코드 시 inc 우선. 1~99,999 범위 검증(서버와 동일).
  - `WeightSliders`: URL 공유 복원 시 입력란 1회 동기화(useEffect).
- 검증(node): 220 직접입력 → 220 그대로(착시 제거) / 3분위 칩 → 403 / 미입력 → 서버 기본.

### 7-2. 예산 초과 "N곳 숨김" (응답 shape 변경)
- `fetchRegionCandidates` 가 `{ candidates, budgetFilteredCount }` 반환 (예산 상한으로 제외된 후보 수 카운트).
- 라우터 응답을 `{ regions, meta: { budgetFilteredCount, totalCandidates } }` 로 래핑.
- 클라이언트 `fetchRecommendations` 는 **신규 객체 / 레거시 배열 / mock 배열 모두 수용**(graceful). meta 를 store `budgetFilteredCount` 로 보관.
- `CardPanel`: 결과>0 이어도 숨긴 후보가 있으면 상단에 "○○ 한도 초과로 N곳 숨김 · 한도 늘리기" amber 배너. 0건이면 기존 EmptyState 가 처리.
- 검증(node): 배열/객체/빈객체 정규화 + meta 파싱 전부 통과.

---

## 6. P3 세션 — 점수 변별력 · 투명성 · 예산 안내 (완료)

### 6-1. 배경
오전~P2 로 affordability 시세 신뢰도는 올렸으나, **총점 100점 중 45점(안전 15 + 생활 30)이 모든 동에서 더미 50 고정**이라 동 간 총점이 뭉개짐 → "이게 무슨 점수냐" 반론의 핵심. 또 점수 산출 근거가 카드에 드러나지 않아 신뢰가 안 섬.

### 6-2. 서버 — scoring.ts (#5 동적 가중치)
- `RegionMetrics` 에 `safetyIsEstimated` · `lifeIsEstimated` · `rentSampleCount` 추가, `ScoreAxis` 타입 추가.
- `scoreRegion`: 추정 축(더미 50)을 **총점 분모에서 제외**. 통근·주거비는 항상 활성, 안전·생활은 실데이터 적재 전이면 제외. `ScoredRegion` 에 `estimatedAxes` · `effectiveWeightSum` 노출.
- 검증(순수 node): 안전·생활 둘 다 추정 시 동A(통근78)·동B(통근40) 변별 격차 old 13 → new 24(**1.85배**). 추정 0개면 new==old(하위호환 일치).

### 6-3. 서버 — repository · 라우터
- repository: `safetyIsEstimated = !safetyScoreMap.has(dong)`, `lifeIsEstimated = true`, `rentSampleCount = rentStat.sampleCount`.
- 라우터 응답에 `estimatedAxes` · `rentSampleCount` 추가.

### 6-4. 클라이언트 — RegionCard (#6 투명성)
- `RegionRecommendation` 에 `estimatedAxes` · `rentSampleCount` 추가.
- 4축 막대: 추정 축은 흐리게 + 점수 대신 "추정", 막대 회색. 하단에 "○○은 데이터 준비 중이라 종합점수에 반영하지 않았어요" 안내.
- 헤더에 전월세 **표본 신뢰 칩**("표본 N건", 10건 미만은 amber·"참고").
- 기존 "전세 월 ○○만" · "주거비 N%" 환산 표시 유지.

### 6-5. 클라이언트 — EmptyState (예산 안내)
- 현재 예산을 거래유형별 표기("보증금 한도 2억" / "매매가 한도")로 노출.
- "예산 늘리기" 버튼이 실제 `setBudget`(현재×1.5, 슬라이더 상한 15억 클램프)으로 동작 → 재조회 유도. 상한 도달 시 숨김.

### 6-6. 검증 주의 (P2 와 동일)
샌드박스 마운트 동기화 지연으로 bash tsc 불가 — 권한 파일은 정상. 동적 가중치·중위값 로직은 순수 node 시뮬레이션으로 검증. **실 환경 `npm run typecheck`(client·server) + 추천 응답 스모크 권장.**
