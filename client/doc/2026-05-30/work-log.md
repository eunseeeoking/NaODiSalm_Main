# 작업일지 2026-05-30 (client)

## 0. 한 줄 요약
서버에 적재만 되어 있던 국토부 RTMS 실거래 전월세 4종(APT·OFFI·VILLA·SH)을 추천 흐름까지 끌어오는 **수직 슬라이스 1개**를 완성. affordability(주거비 부담) 점수를 "매매가 합성 환산"에서 "실거래 전월세 시세"로 전환하고, 클라이언트에 거래유형(매매/전세/월세) 토글을 추가해 토글 → 서버 재산출 → 카드 재정렬까지 end-to-end로 연결.

---

## 1. 이번 세션 작업 내용 (완료)

### 1-1. 배경 진단 (server work-log 2026-05-30 연계)
- 전월세 4종은 DB(t_offi_rent 17.9만·t_sh_rent 30.3만·t_villa_rent·t_apt_rent 119만)에 적재 완료 상태였으나, **클라이언트까지 노출하는 API 경로가 전무**.
- 추천 스코어링의 affordability 가 실제 전월세가 아니라 **매매가를 이중 가정(전세가율 65% × 전환율 4.5%)으로 역산**(`MONTHLY_COST_RATE`)하고 있어, "청년 전월세 의사결정 도구" 컨셉과 정면 충돌.
- → 이번 세션 레버리지 = 합성 추정을 실거래 전월세 시세로 교체하는 수직 슬라이스.

### 1-2. 서버 — scoring.ts (실거래 전월세 affordability)
- `RegionMetrics.rentMonthlyCost: number | null` 추가 — 선택 거래유형 기준 실거래 환산 월 주거비.
- `JEONSE_TO_MONTHLY_RATE = 0.045 / 12` 신규 상수 (전세가율 가정 제거, 전환율만 1겹 적용).
- `DealType = 'SALE' | 'JEONSE' | 'MONTHLY'`, `AffordabilityBasis = 'rent' | 'sale-proxy'` 타입 추가.
- `scoreRegion`: rentMonthlyCost 있으면 그걸로 RIR 계산(basis='rent'), 없으면 기존 매매가 합성으로 폴백(basis='sale-proxy'). `ScoredRegion`에 `monthlyHousingCost`·`affordabilityBasis` 노출.

### 1-3. 서버 — recommendationRepository.ts (동별 전월세 시세 집계)
- `fetchRentCostByRegion(aggregates, dealType)` 신규:
  - t_apt_rent / t_offi_rent / t_villa_rent / t_sh_rent 를 `UNION ALL` 풀링.
  - 동(sigungu_code + legal_dong) 단위 평균 보증금/월세 → 전세=보증금×환율, 월세=월세+보증금×환율.
  - 최신 계약일−1년 동적 cutoff (기존 가격 집계 전략과 동일), `HAVING COUNT(*) >= 5` 로 표본 부족 동 제외.
  - 테이블 미존재/쿼리 실패 시 빈 맵 → 매매가 합성 폴백 (graceful).
- `fetchRegionCandidates(..., { dealType })` 파라미터 추가, 후보에 `rentMonthlyCost` 매핑. SALE 또는 표본 부족 시 null.

### 1-4. 서버 — recommendations 라우터 (dealType 입출력)
- POST `/api/recommendations` body 에 `dealType?` 수용·검증(SALE|JEONSE|MONTHLY), 생략 시 SALE 기본(하위호환).
- 응답에 `monthlyHousingCost`·`affordabilityBasis`·`rentMonthlyCost` 추가.

### 1-5. 클라이언트 — 타입·API·스토어
- `types/recommendation.ts`: `RecDealType`, `DEAL_TYPE_LABELS`, `RegionRecommendation` 에 `monthlyHousingCost`·`affordabilityBasis`·`rentMonthlyCost` 추가.
- `api/recommendations.ts`: `RecommendationRequest.dealType?`.
- `stores/useRecommendationStore.ts`: `dealType` 상태(**기본 'JEONSE'** — 컨셉 반영) + `setDealType`.
- `utils/urlState.ts`: `dt` 파라미터 인코딩/디코딩(JEONSE 기본이라 그 외만 명시).

### 1-6. 클라이언트 — UI
- `components/DealTypeToggle.tsx` 신규: 매매/전세/월세 3분할 세그먼트 (헤더에 "실거래 전월세 / 매매가 환산" 근거 표시).
- `LeftPanel`(데스크톱) · 모바일 가중치 드로어에 토글 배치.
- `index.tsx`: dealType 을 fetch 요청 · URL · effect deps 에 연결 → 토글 변경 시 추천 재요청.
- `RegionCard`: rent basis 일 때 "가격(매매가)" 대신 "전세/월세 월부담 ○○만" 으로 표출.

---

## 2. 데이터/설계 메모
- affordability 신뢰도: 기존 "가정 2겹(전세가율×전환율)" → "실거래 1겹(전환율)" 으로 감소.
- RIR 분포가 바뀌어 기존 랭킹이 이동함. 단, 서버 기본값은 SALE 유지(하위호환)하고 **클라이언트가 명시적으로 JEONSE 전송**하는 구조라, 다른 호출자/시연 안정성에 미치는 영향은 거래유형 선택으로 격리됨.
- 동 매칭 키 `${sigunguCode}|${dong}` 는 기존 representativePrice 집계와 동일 규약 — 단지 식별이 약한 빌라·단독다가구도 "동 단위 통계"로는 유효.
- 단순화: 정확 median 대신 AVG (기존 가격 집계 관례와 일치). Sprint D 에서 percentile 로 교체 여지.

---

## 3. 검증
- scoring 핵심 분기 standalone 단위 테스트 11/11 통과 (sale-proxy 강남 예시 rir≈0.302·66점 = 문서 예시와 일치 / 전세·월세 환산식 / rent>sale-proxy 점수 정합성 / 고가 전세 변별력 0점).
- 편집 파일 전수 구조 점검(authoritative read) — 병렬 편집으로 발생한 실제 손상 3건 발견·수정: 스토어 말미 잉여 `}`, urlState `parseDealType` 중복 정의, index 하이드레이션 중복 라인.
- `RegionMetrics`/`RegionCandidate` 오브젝트 리터럴 생성 지점은 repository 단 1곳 → 신규 필수 필드 `rentMonthlyCost` 추가가 타 생성자를 깨지 않음 확인.
- ⚠ 전체 `tsc` 는 이 세션 샌드박스에서 미실행(서버 Prisma client 미생성 + 작업 환경 파일 마운트 동기화 이슈). **client/ 와 server/ 에서 `npm run typecheck` 1회 권장.**

---

## 4. 다음 세션 TODO
- [ ] DB 연결 환경에서 `npm run typecheck`(client·server) + 전세/월세 토글 실제 응답 스모크 테스트.
- [ ] Depth2 매물종류 체크박스 핀 on/off (`/complexes` 에 type 파라미터 노출 필요 — 서버 선행).
- [ ] 타입별(매매/전세/월세) 점수를 카드에 **동시 분리 표시** (현재는 선택 1종 기준 재정렬).
- [ ] Depth3 전월세용 "동 단위 시세 통계" 뷰 분기 (빌라·단독다가구).
- [ ] 빈 결과 안내 + 조회범위 확장 제안 (EmptyState 연계).
- [ ] 데모 시나리오 "서울/경기, 전세 2억 이하, 원룸/오피스텔" end-to-end 마감.
