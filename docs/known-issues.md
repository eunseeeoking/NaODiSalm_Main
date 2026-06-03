# 알려진 이슈 (Known Issues)

> 지역 추천(Depth 2) 도메인 중심. 별도 작업이 필요한 구조적·데이터·UX 한계를 추적한다.
> 작업일지(work-log)와 달리 **살아있는 문서** — 이슈가 해결되면 상태를 갱신하고, 새 이슈는 아래에 추가.
> 최초 작성: 2026-05-30 (P3 QA 과정에서 식별)

상태 범례: 🔴 미해결 · 🟡 부분 완화(우회) · 🟢 해결

---

## 0. 설계 원칙 / 최근 결정 (2026-05-30)

> 이슈 판단의 기준이 되는 제품 원칙. 다음 세션 인계용.

- **제품 컨셉(재확인)**: 개별 매물이 아니라 **지역(행정동)을 먼저 추천**한다. 실제 매물 탐색·계약은 타 부동산 플랫폼에서. → 동 단위 통계는 "그 지역의 시세·특성" 관점이어야 하며, 특정 평형·단지로 좁히면 안 된다. "좋은 집"이 아니라 "좋은 지역"을 고르는 도구.
- **결정 로그**:
  1. ~~**면적 제한(60~85㎡) 제거 예정** → 전체 면적 기준. 컨셉상 동 시세는 시장 전체를 반영해야 함. (KI-16)~~ → 🟢 2026-05-31 해결(KI-16+KI-8, median 동반).
  2. **실거래 테이블 4분할 → 단일+`property_type` 통합은 후순위.** 당장은 인덱싱으로 충분하다고 판단. 통합 시 이점은 크나(쿼리 단순화), 마이그레이션 비용 때문에 미룸. 통합 권장 근거·방법은 work-log/대화 참고.
  3. **최신 거래일 cutoff(−1년) 유지** — 데이터 최신성 위해 당연.

> **▶ 수도권 데이터 세션 (2026-05-31)** — `docs/수도권-mvp-plan.md` "세션 산출물"·row 스냅샷 참조.
> LAWD 코드 centroids 자동생성(`gen:lawd`)·검증(`verify:lawd`, RTMS 82/82)·`--region=capital` ingest 플래그·
> 비아파트 좌표 백필(`geocode:complexes`: 재시도·ETA·bbox 가드·`--fallback-dong`) 신설.
> **완료:** APT/OFFI/VILLA 2년치 수도권 적재 + OFFI 지오코딩 99.98% + VILLA 지오코딩 99.5%(정밀 75% + 법정동 근사 24%).
> 부천·화성 행정구 신설 자동반영. 최종 DB ~696만 행.
> **다음 세션:** SH 적재 → POI 재시드(seed:legal-dong→seed:life) → safety(이름충돌 수정)·transit(provider) 재시드.
> **신규 후속 메모(KI 후보):** VILLA 좌표 24%가 법정동 centroid 근사치(같은 법정동=동일 좌표) → 정밀/근사 구분용
> `coordSource` 컬럼 + "건물 시세 카드"(depth3 §5)용 정밀 재지오코딩이 후속 과제.

---

## A. 데이터 커버리지 / 후보 추출

### KI-1 · 후보 동 universe 가 아파트 단지 기반 🟢 해결 (2026-05-30)
- **증상**: 빌라·단독다가구 전월세 실거래가 있어도, 아파트 단지가 없는 순수 빌라/단독 밀집 동은 추천 후보에 아예 안 잡힘.
- **원인**: `fetchRegionAggregates` 가 `t_apt_complex.lat/lng` 평균으로 동 centroid 와 후보 목록을 만든다.
- **해결**: `fetchRegionAggregates(propertyTypes, prefix)` 가 선택 매물종류 complex 테이블 4종(`t_apt/offi/villa/sh_complex`)을 **UNION ALL** 풀링해 centroid·count 산출. 전세/월세는 선택 종류, 매매는 거래 보유 전 종류(APT/OFFI/VILLA) 고정. → 빌라/단독 단지가 있는 동도 후보화.
- **잔여**: 여전히 `t_legal_dong` 마스터에 legal_dong 이름이 있어야 10자리 코드 매칭(기존 한계 동일). 단지 자체가 없는(좌표 미수집) 동은 불가.

### KI-2 · representativePrice 가 항상 아파트 매매가 🟢 해결 (2026-05-30)
- **증상**: 빌라/단독/오피스텔을 골라도 카드 "가격"·sale-proxy·후보 게이트가 **아파트 60~85㎡ 매매 평균** 기준.
- **원인**: `fetchRepresentativePrices` 가 `t_apt_trade` 만 사용.
- **해결**: `fetchRepresentativePrices(aggregates, propertyTypes)` 가 매매 거래 보유 종류(APT/OFFI/VILLA) trade×complex 를 **UNION ALL** 풀링. SH 는 매매 거래 없어 자동 제외. 매매 모드는 전 종류 고정.
- **잔여**: ① ~~AVG 유지(median 통일은 KI-8).~~ → 🟢 KI-8 해결(median). ② cutoff 가 apt 최신 거래일 기준이라 offi/villa 가 1년 이상 stale 이면 일부 누락. ③ ~~60~85㎡ 밴드는 비아파트엔 다소 큼(→ KI-16).~~ → 🟢 KI-16 해결(전체 면적 9~330 sanity).

### KI-3 · 후보 게이트가 아파트 매매 거래에 의존 🟢 해결 (2026-05-30)
- **증상**: 아파트 매매 거래(60~85㎡, 최근 1년)가 없는 동은 전월세 데이터가 있어도 후보에서 제외.
- **원인**: 후보 루프 최상단 `if (price == null) continue` — price 는 아파트 매매 대표값.
- **해결**: 게이트를 거래유형별로 분리. **SALE** = 매매 표본 필수(`price==null`→제외), **JEONSE/MONTHLY** = 전월세 표본 필수(`!rentStat`→제외, 매매 유무 무관). 전월세 모드에서 매매 표본 없으면 representativePrice=0(카드는 rent basis 라 미표시).

---

## B. 점수 신뢰도

### KI-4 · 생활(life) 점수 미구현 🟢 수도권 시드 적재 완료 (2026-06-01)
- **✅ 적재 완료(2026-06-01)**: `seed:life` 수도권 1187동 전수 적재(lifeScore 평균 43.2). centroid 를 t_legal_dong.lat/lng
  직접 사용으로 전환(KI-20) → 이전 424(서울만) 누락 해소. 더미 50·`lifeIsEstimated` 해제(적재 동 한정).
- **증상**: 생활편의 점수가 항상 더미 50 → 동적 가중치로 총점 분모에서 제외(반영 안 됨).
- **원인**: POI(편의시설) 수집·정규화 미구현.
- **해결(코드)**: 카카오 로컬 카테고리 검색 기반 POI 파이프라인 신규 구현.
  - `prisma/schema.prisma`: `PoiSummary`(`t_poi_summary`) 모델 — 8개 카테고리 카운트 + `lifeScore`.
  - `src/services/external/kakaoPoiClient.ts`: 동 centroid 반경 500m 카테고리별 `meta.total_count` 수집 → `computeLifeScore`(카테고리별 `forwardLinear` 정규화 후 가중합, weight 합 1.0). 1인가구 청년 관점 가중(지하철0.22·편의점0.18·음식점0.15·카페0.12·마트0.12·병원0.09·약국0.07·은행0.05).
  - `scripts/seedPoiSummary.ts` + `npm run seed:life`: transit 시드와 동일하게 서울 행정동 순회 upsert.
  - `recommendationRepository`: `t_poi_summary` 조회 → `lifeScoreBase` 실배선, `lifeIsEstimated = !맵.has(동)`(적재 동만 false). `scoring.ts` 주석 갱신.
  - **검증**: `computeLifeScore` node 시뮬 — 가중치 합 1.0, 빈 동=0·포화=100·지하철 부재 −22점 등 정상.
- **수도권 확장 준비(2026-05-31)**: `seedLegalDong`을 `capital-centroids.json`(1187동·sido 포함)으로 전환,
  `seedPoiSummary` WHERE를 `sido IN (서울·인천·경기)`로 확장. **선행** `seed:legal-dong`(t_legal_dong 수도권 적재) →
  `seed:life`. ⚠️ POI centroid 조인이 `ac.legal_dong(법정동명)=ld.dong(행정동명)`이라 명칭 불일치 동은 누락 가능 —
  `seed:life` 출력 "대상 행정동 N"이 기대(최대 1187)보다 낮으면 매핑/폴백 보정 필요.
- **잔여(🟢 전환 조건)**: 실 환경에서 `prisma db push` + `prisma generate` + `seed:legal-dong` + `npm run seed:life` 실행. 샌드박스는 localhost DB 접속 불가라 적재 미실행.

### KI-5 · 안전(safety) 실데이터 의존 🟢 수도권 시드 적재 완료 (2026-06-01)
- **✅ 적재 완료(2026-06-01)**: `npm run seed:safety` 수도권 실행 → **upsert 2,424건 / skip 140건**. 자치구별 평균
  정상 분포(분당 77.1 ~ 옹진 51.0). 더미 50·`safetyIsEstimated` 해제됨(적재 동 한정).
- **증상**: `t_safety_index` 미적재 시 안전 점수 추정(50) → 총점 제외.
- **원인**: `seed:safety` 미실행 환경.
- **현황**: `scripts/seedSafetyIndex.ts` 완성(자치구 기준점수 + 동별 결정론적 편차 합성, API 불필요·즉시 실행 가능). 코드 변경 불필요.
- **지역 결합 주의(KI-17)**: `SIGUNGU_SAFETY` 상수표가 **서울 25구 전용** → 수도권/전국 확장 시 비서울은 fallback 50. provider 추상화로 해소 예정.
- **⚠️ 이름충돌 발견(2026-05-31)** → 🟢 **코드 해결(2026-06-01)**: `SIGUNGU_SAFETY`가 **구 이름(`'중구'`)을 키**로 쓰고
  매핑도 `dong.sigungu`(이름)로 잡아서, 수도권 확장 시 **인천 중구 ↔ 서울 중구**(동구·서구·남구도) 점수가 충돌·오매핑되던 버그.
  → `seedSafetyIndex.ts` v3: 키를 **5자리 시군구 코드**로 전환(`dong.code.slice(0,5)` 매핑) + **경기·인천 57개 자치구 점수표 추가**
  (도시화도·신도시/공단/농촌 성격 합성, 동일 스케일) + dong 조회를 수도권(11·28·41)으로 확장. typecheck OK. **잔여=시드 실행만**.
- **추가 버그픽스(2026-05-31)**: repository 의 `t_safety_index` 조회가 `arr.join(',')` 로 IN 절을 만들어 `$queryRaw` 에서 CSV 전체가 **단일 문자열 파라미터**로 바인딩 → 시드를 적재해도 항상 0건 매칭(폴백)되던 잠재 버그를 LH 쿼리와 동일한 `Prisma.join` 으로 수정. (transit/life 동일 수정.)
- **⚠️ 별칭 추가(2026-06-01) — skip 140건 원인**: 시드 시 `미정의 시군구 부천시(41190)·안산시(41270)·용인시(41460)·화성시(41590)·양주군(41710)·포천군(41810)`
  경고 + 140동 fallback 발생. 원인은 **`t_legal_dong`(capital-centroids.json)이 신설 구 코드와 옛 시/군 코드를 혼재** —
  특히 화성은 신설 4구(29동)만 매칭되고 나머지 법정동은 옛 `41590` 아래에 잔존. `SIGUNGU_SAFETY` 에 6개 umbrella/레거시 코드
  별칭(시 단위 대표 점수) 추가로 커버 → **`seed:safety` 재실행 시 140동 해소**. (이번 적재본은 재실행 전까지 해당 140동 fallback 50 유지.)
  🔗 **근본 원인은 KI-20**(centroids↔generated LAWD granularity 불일치) — 추천 universe 매칭에도 영향 가능.
- **잔여(🟢 유지 조건)**: 별칭 반영 위해 `npm run seed:safety` **1회 재실행** 권장(API 불필요).

### KI-6 · 대중교통 품질(transitScore) 미적재 🟡 코드 완료·시드 대기 (2026-06-01)
- **증상**: 통근 점수에 배차·야간접근성·정류장밀도 보정이 없음(`transitScore=null`).
- **현황**: `scripts/seedTransitSummary.ts` + provider 레이어 완성.
- **추가 버그픽스(2026-05-31)**: `t_transit_route_summary` 조회도 KI-5 와 동일한 `arr.join(',')` IN 절 버그 → `Prisma.join` 으로 수정.
- **provider 추상화(2026-06-01, KI-17 본체)**: TAGO 가 **서울 시내버스 미등재**라 서울은 0건이던 문제 →
  `transitProvider.ts` 디스패처(코드 prefix)로 **서울(11)→TOPIS(`seoulTopisClient.ts` 신규)·경기인천(28/41)→TAGO** 분기.
  `seedTransitSummary` 를 수도권(11·28·41)으로 확장 + provider 분기 카운트 로그. typecheck OK.
- **✅ 경기·인천 적재 완료(2026-06-02)**: `seed:transit` → 처리 1187(서울/TOPIS 427·경기인천/TAGO 760), **적재 662건**(정류장 0인 농촌동 ~98 제외), transitScore 평균 47.3(11~89). 서울 427은 TOPIS 승인 대기로 0건 skip → 활성 후 재실행하면 채워짐.
  - 성능: 정류장별 노선조회 병렬화(`Promise.all` 동시≤10) + 타임아웃 8→5초로 직렬 대비 수 배 단축(총 호출수·쿼터 불변).
- **프로브 결과(2026-06-01~02)**:
  - ✅ **TAGO 경기·인천 커버리지 확인**(수원 매탄1동·인천 옥련1동 정류장·노선 반환, transitScore 적재) — provider 분기 정상.
  - ⏳ **서울 TOPIS = 승인 활성 대기**: `SERVICE KEY IS NOT REGISTERED`. **data.go.kr 자체 테스트 콘솔에서도 동일 오류** →
    코드·키·인코딩 무관, **활용신청 승인(2026-06-02)이 ws.bus.go.kr 로 아직 전파 안 됨**(TOPIS 서버는 apis.data.go.kr 와 별개). 수 시간~익일 후 자동 활성.
  - 🔧 **TOPIS 엔드포인트·파라미터 정정(2026-06-02, data.go.kr 명세 확인)**: `getStationByPos`→**`getStaionsByPosList`**(철자 "Staions"),
    좌표 `gpsX/gpsY`→**`tmX=위도·tmY=경도`**(샘플값 기준 반대), 노선=`getRouteByStationList`, 첫·막차=`getBustimeByStationList`(arsId,busRouteId).
    배차(term)는 서울 명세에 없어 headway 기본값 처리. **응답 필드명은 키 활성 후 프로브로 최종 확정**(미검증).
  - 키: 별도 발급 불필요 — data.go.kr 인증키는 계정당 1개라 **MOLIT_SERVICE_KEY 재사용**(코드 `||` 폴백). 같은 계정 승인 시 통용.
- **잔여(🟢 전환 조건)**: ① 서울 TOPIS 승인 전파 대기 후 재프로브(정류소 N>0 + 응답 필드명 arsId/busRouteId/firstBusTm 확정) → ② `npm run seed:transit` 본실행(경기·인천은 이미 검증).

### KI-7 · 통근시간 Haversine 폴백 🟡 (심각도: 중간)
- **증상**: commute matrix 캐시가 없으면 직선거리 기반 추정(25km/h + 5분)으로 통근시간 산정 → 실제와 괴리.
- **제안**: matrix 사전 적재 범위 확대 / 실시간 호출 백필.

### KI-8 · 매매 대표값이 평균(AVG), median 아님 🟢 해결 (2026-05-31)
- **증상**: 전월세는 동별 **중위값** 적용(P2)했으나 `representativePrice`(매매)는 여전히 AVG → 이상치 취약.
- **해결**: `fetchRepresentativePrices` 의 AVG → 동별 median 으로 전환. 전월세 경로(`fetchRentCostByRegion`)와 **동일한 윈도우 함수 규약**(`ROW_NUMBER`/`COUNT` 후 `rn IN (FLOOR((cnt+1)/2), FLOOR((cnt+2)/2))` AVG = 홀수 1건·짝수 2건 평균). KI-16(면적 제한 제거)과 동반 처리 — 전체 면적이라 분산이 커진 만큼 median 효과가 큼. node 시뮬레이션으로 홀/짝수·이상치 케이스 true median 일치 검증.

### KI-16 · 매매 대표가 면적 60~85㎡ 제한 — 제품 컨셉과 불일치 🟢 해결 (2026-05-31)
- **출처/맥락**: 전용 60~85㎡(= 국민주택규모 상한, "중형/국민평형")는 **아파트 시대 ML 파이프라인**(`AreaBucket` enum, `MEDIUM 60~85`)에서 "동 간 비교 가능한 대표 시세"를 만들려고 둔 데이터 모델링 기본값. **제품 결정이 아님.** (2026-05-21 work-log 에 cutoff+면적으로 0건 나던 디버깅 흔적도 있음.)
- **현 동작**: `fetchRepresentativePrices` 가 `WHERE area_m2 BETWEEN 60 AND 85`. KI-2 이후 APT/OFFI/VILLA 에 동일 적용 → 오피스텔/빌라엔 60~85가 과대(표본 희박).
- **문제**: 본 서비스는 "좋은 집"이 아니라 **"좋은 지역"을 먼저 추천**하고, 실제 매물은 타 플랫폼에서 확인하는 컨셉(§0). 따라서 동 시세는 특정 평형이 아니라 **시장 전체**를 반영해야 함. 60~85 제한은 컨셉과 불일치 + 비아파트에 부적합.
- **해결**: `fetchRepresentativePrices` 의 `WHERE area_m2 BETWEEN 60 AND 85` → 전월세 경로와 동일한 `BETWEEN 9 AND 330` sanity 로 교체(면적 0/누락·비현실 레코드만 제거, 사실상 전체 면적). 분산 확대 대비 **AVG→median 동반**(KI-8). 면적대별(소/중/대) 분리 표출은 Depth3 후속으로 남김.
- **caveat**: SH 는 area=연면적이라 전용면적과 직접 비교 불가(단, SH 는 매매 거래 없어 `SALE_TRADE_TYPES` 에서 자동 제외 → 실질 영향 없음).
- **연관**: §0 컨셉 · KI-2 잔여(밴드, 본 건으로 해소) · KI-8(median, 동반 해결).

### KI-17 · 지역 결합도 / transit·safety provider 추상화 🟡 코드 완료·시드/프로브 대기 (2026-06-01)
- **증상**: 전국/수도권 확장 시 일부 데이터 소스의 출처가 지역마다 달라짐.
  - **교통**: TAGO 전국 API가 **서울 시내버스 미등재**(2026-05-31 진단, KI-6) → 서울은 TOPIS 필요, 경기·인천은 TAGO 가능(프로브 검증 필요).
  - **안전**: `seedSafetyIndex`의 `SIGUNGU_SAFETY` 상수표가 **서울 25구 전용** → 비서울 전 동 fallback 50.
    추가로 표 키가 **구 이름**이라 수도권 확장 시 **인천 중구↔서울 중구 등 동명 자치구 충돌**(KI-5 상세).
- **원인**: 데이터 결합이 호출부에 노출. (실거래·ODsay·Kakao·통계청·R-ONE·LH 는 전국 단일 API라 무관.)
- **해결(코드, 2026-06-01)**:
  - **교통 provider**: `src/services/external/transitProvider.ts`(디스패처, 코드 prefix 로 분기) +
    `seoulTopisClient.ts`(서울 TOPIS, 신규) + `tagoClient.fetchTagoTransitSummary`(경기·인천). 단일 시그니처
    `fetchTransitSummary(lat,lng,regionCode)` 유지. `seedTransitSummary` 수도권 확장.
  - **안전 provider 효과**: `seedSafetyIndex` v3 — 점수표 키를 5자리 코드로(동명 충돌 차단) + 경기·인천 점수표 추가 +
    수도권 dong 조회. (별도 `SafetyProvider` 인터페이스 없이 코드-키 상수표로 해소.)
- **잔여(🟢 전환 조건)**: 서울 TOPIS 필드매핑·경기인천 TAGO 커버리지 **프로브 검증**(DEBUG 플래그) 후 `seed:transit`/`seed:safety` 실행. 상세: `docs/수도권-mvp-plan.md` §5.

### KI-18 · Depth 3 매물종류별 분기 (비아파트 = 동 상세 평가) 🔴 (심각도: 중간 · 제품)
- **증상**: Depth 3(`/api/regions/:code/complexes`)가 **아파트 단지 + 3년 예측가 중심**, 비아파트(빌라·오피·단독) 비활성.
- **원인**: 비아파트는 매물 단위 시계열 예측 부적합 — 단독·다가구는 식별이 동 단위(지번 마스킹/부재·연면적), 빌라·오피는 식별 가능하나 좌표·반복거래 부족. (RTMS API 컬럼 근거: `docs/depth3-design.md` 부록 A.)
- **제안**: Depth 3 본체를 **"동 상세 평가"**(4축 분해 + 시세 분포 + POI/안전/교통/LH)로 재정의, 시계열 전망은 아파트 부가 모듈로 격리. 상세: `docs/depth3-design.md`.

### KI-19 · 추천 서빙 universe 가 서울 한정 (수도권 데이터 적재됐으나 미서빙) 🟢 해결 (2026-06-XX)
- **✅ 해결**: `fetchRegionAggregates` 기본 prefix 를 **수도권(11·28·41)** 로 확장 + 후보 매칭을 sigungu **이름** →
  **시군구 코드(5자리)+동명** 기반으로 교체(인천 중구↔서울 중구 등 **동명 시군구 충돌 차단**).
  서빙 경로는 ODsay 라이브 호출 없음(findCachedMatrix=DB캐시, 미스는 Haversine) → **쿼터 안전**. 수도권 commute 는 §4 배치 전까지 Haversine 근사(KI-7).
  **검증**: 강남역 → totalCandidates 396→**537**(경기·인천 편입, top8은 통근상 서울). 판교 직장 → top8 전부 **경기 성남(분당41135·수정41131·중원41133)** 통근 9~23분.
- **잔여(정확도, 미착수)**: 수도권 commute 가 Haversine 근사 → `수도권-mvp-plan` §4(ODsay 거점 사전적재 배치)로 정밀화. 서빙 자체는 이미 동작.
- **증상(2026-06-01 발견)**: 수도권 실거래(APT/OFFI/VILLA 2년치) 적재 완료 후에도 추천이 **서울 동만** 반환.
  재현: 강남역·전세·예산 2.3억·인내심 75분·전체 → **0건**. (낮은 전세 예산이라 서울 동은 보증금 median 초과로
  전부 예산 게이트 제외되고, 2.3억 가능한 **수도권 외곽 동은 universe 에 아예 없음** → 빈 결과.)
- **원인**: `fetchRegionAggregates(propertyTypes, sigunguCodePrefix = '11')` 기본값이 **서울(`11`)**, 라우트
  `recommendations.ts` 가 `fetchRegionCandidates` 호출 시 `sigunguCodePrefix` 를 안 넘김 → 후보 universe 가 서울로 고정.
  (`recommendationRepository.sigunguCodePrefix` 는 이미 파라미터화 — `수도권-mvp-plan` §3 의 "prefix 다중화/제거만 남음" 미완 작업.)
  ※ **면적 제한과 무관**: `fetchRepresentativePrices`(:254)·`fetchRentCostByRegion`(:397) 모두 `area_m2 BETWEEN 9 AND 330`
    으로 KI-16 적용 완료. 면적 제한은 원인이 아님(사용자 초기 가설 반증).
- **확인 지표**: 응답 `meta.budgetFilteredCount` >0 = 예산 게이트로 숨김(서울 동 보증금 초과), 0 = universe/표본 부재.
- **제안/연계**: `fetchRegionAggregates` 를 **다중 prefix(11·28·41) 또는 prefix 제거**로 확장하고 라우트가 전달.
  ⚠️ **선행 조건(중요)**: 후보 동이 ~3배(서울 ~400 → 수도권 ~1,500+)로 늘면 통근 매트릭스 미스 폭증 →
  **ODsay 쿼터 구조개선(`수도권-mvp-plan` §4: 격자 양자화·거점 사전적재·만료 연장)이 서빙 전 선행**(§8 의존도).
  또한 POI/safety/transit 시드 전 동은 해당 축 estimated 처리(설계상 허용). → KI-4/5/6 시드 + §4 와 묶어 진행.

### KI-20 · t_legal_dong 레거시 행 잔존 + POI/transit centroid 출처 미정합 🟢 해결 (2026-06-01)
- **✅ 검증 완료(2026-06-01)**: `seed:legal-dong --prune`(레거시 1377 삭제) → safety `upsert 1187 / skip 0`(별칭 미사용) →
  **life `대상 1187 / 적재 1187`(이전 424=서울만 → 1187, 인천·경기 정상 편입, lifeScore 평균 43.2)**. 입도 단일화 확인.
- **확정 진단(2026-06-01)**: `capital-centroids.json` 은 **정상**(1187행 = 서울427·인천158·경기602, 좌표 100%, 전부 10자리 신 코드).
  구버전 아님. 문제는 **`seedLegalDong` 이 `upsert`만 하고 기존 행을 안 지움** → `t_legal_dong` 에:
  - centroids 신규 1187행(좌표 有, 신 구 코드) + **이전 법정동 시드의 레거시 ~1377행(좌표 無, 부천41190·안산41270·용인41460·
    화성41590·양주군41710·포천군41810 등)** 이 **혼재 = 2564행**. safety skip 140건의 정체가 이 레거시 행.
- **영향**:
  - **safety**: t_legal_dong 직조회라 레거시 행까지 점수화 → 별칭으로 우회(KI-5). 레거시 정리 시 별칭 불필요.
  - **POI/transit**: centroid 를 `t_apt_complex` **이름조인**(`ac.legal_dong=ld.dong`)으로 얻는데 법정동↔행정동 명칭
    불일치로 **인천·경기 대거 누락** → `seed:life` "대상 424개"(≈서울만, 기대 1187). §5 예고 갭이 숫자로 확정.
- **해결(코드 진행중, 2026-06-01)** — *JSON 좌표를 DB 로 이관*(사용자 제안 채택):
  1. `LegalDong` 에 `lat/lng` 컬럼 추가(schema) → `seedLegalDong` 이 centroids 좌표 저장 + `--prune` 로 centroids 에 없는
     수도권 10자리 레거시 행 삭제(코드 입도 단일화).
  2. `seedPoiSummary`·`seedTransitSummary` 가 `t_apt_complex` 이름조인 대신 **`ld.lat/ld.lng` 직접 사용** → 1187 전수 커버.
  3. 재실행: `prisma db push`+`generate` → `seed:legal-dong -- --prune` → `seed:safety`(1187 clean) → `seed:life`/`seed:transit`.
- **⚠️ 반전(2026-06-02) — 위 "행정동 centroid" 접근은 폐기**: prune로 법정동 행을 지우니 **추천 serving이 깨짐**.
  serving(`fetchRegionAggregates`)은 complex(RTMS=**법정동**명)를 t_legal_dong에 이름매칭하는데, t_legal_dong을 행정동만 남기니
  매칭 345→82로 붕괴 → 후보 0. **진짜 정답은 `seed:bjd`(kr-legal-dong 전국 법정동)** 였음 — 원래 424(인천경기 누락)도
  t_legal_dong에 수도권 **법정동**이 없어서였지 행정동 전환이 필요했던 게 아님.
- **최종 해결(2026-06-02)**: ① `seed:bjd`로 전국 법정동 복원(345→342 매칭) ② `seedPoiSummary`/`seedTransitSummary`를
  **법정동 complex-join으로 복귀**(seed:bjd가 수도권 법정동 제공 → 인천경기도 매칭). 전부 **법정동 단일 키**로 정합.
  (schema `lat/lng`·`--prune`는 잔존하나 미사용·무해.) → KI-19(서빙 universe)는 여전히 prefix='11' 서울 한정으로 남음.

### KI-21 · 전월세 추천 항상 0건 — rent median 쿼리 RATE 파라미터 바인딩 버그 + connection_limit 🟢 해결 (2026-06-02)
- **증상**: JEONSE/MONTHLY 추천이 **항상 0건**(예: 강남 전세, 예산 무관). `meta.totalCandidates=0, budgetFilteredCount=0`.
  그동안 KI-19(universe/예산)로 의심했으나 실제는 **별개의 숨은 쿼리 버그**. (SALE은 정상이라 더 늦게 발견.)
- **진단 경로**: aggregates=396·priceMap=1411 정상인데 **rentMap=0** → `fetchRentCostByRegion` 런타임 0행.
  생SQL(literal 파라미터)은 1078행 정상 반환 → **Prisma 파라미터 바인딩 문제**로 좁힘.
- **원인(핵심)**: `costExpr = Prisma.sql\`p.deposit_manwon * ${RATE}\`` 를 SELECT에 embed → 그 뒤 `contract_type`×3·`cutoff`
  파라미터가 붙으며 **Prisma `$queryRaw`의 파라미터 바인딩 순서가 placeholder 순서와 어긋남** → `deposit*'JEONSE'`·`contract_date>=숫자`
  꼴이 되어 **에러 없이 0행**. (매매가 쿼리는 cutoff 1개뿐이라 무사 → priceMap 1411.)
- **해결**: RATE는 상수(`0.045/12`)라 **SQL 리터럴 인라인**(`Prisma.raw`)으로 파라미터 제거 → rows 0→1078. semiJeonseFilter도 동일 인라인.
- **2차(노출된) 이슈**: 위 수정으로 rent 쿼리가 실제 실행되니, **`connection_limit=1`** + `Promise.all` 4쿼리에서
  느린 rent median(전 수도권 실거래 스캔)이 단일 커넥션 점유 → **pool timeout(10s) → 500**. → DATABASE_URL `connection_limit=10`으로 해소.
- **교훈**: Prisma.sql에 **상수는 파라미터로 두지 말고 인라인**, embed된 fragment 파라미터 순서 주의(유사 패턴 감사 권장).
- **perf 최적화 적용(2026-06-XX)**: rent/price median 쿼리에
  ① **후보 동(targetAggs) 튜플 IN 필터**(`dongTupleFilter`) ② **STRAIGHT_JOIN**(complex 작은 테이블을 driver 강제 →
  rent 풀스캔 회피) ③ **JEONSE 단일정렬**(cost=deposit×RATE 단조 → 정렬 3→1, cost는 JS 환산) ④ **cutoff MAX 10분 캐시**
  (`cachedCutoff`) ⑤ **raw_payload 컬럼 DROP**(행 축소, 별도 archive 후). + DB `connection_limit=10`.
  → cold 7s → **warm ~2.7s**(patience 75=서울 전체 worst-case; 현실 patience 는 후보 적어 더 빠름).
- **잔여(서브초 (필요 시))**: worst-case 는 매 요청 "raw 거래 median 재계산"이 본질 한계 → 쿼리 튜닝으로는 ~2.7s 가 바닥.
  **동별 (dealType×매물종류) median 을 배치 summary 테이블로 사전집계**(POI/safety 패턴) → 런타임 조회 ~10ms 가 유일한 근본 해법. (미착수)

### KI-22 · 통근 게이트가 인내심에 비해 너무 헐거움 (인내심 45분인데 89분 매물 노출) 🟢 해결 (2026-06-03)
- **증상**: 인내심(patience) 45분으로 조회했는데 결과 5~8위에 **commuteMinutes 60·69·75·89분** 지역이 뜸.
  재현: 강남역·전세·예산 1.5억·인내심 45·통근35/주거20/안전15/생활30 → 5위 남동구 만수동 **commuteMinutes=89, commuteScore=0** 인데 totalScore 53.
- **원인**: 후보 게이트가 `recommendationRepository.ts` 의 **`if (commuteMinutes > safePatience * 2) continue`** (인내심 × **2**).
  45×2=90분이라 89·75·69·60분이 다 통과 → 통근점수 0이어도 **affordability 100·life 81** 가 총점을 끌어올려 top8 진입.
  서울 한정 universe 일 땐 다 가까워 안 보였으나, **수도권 확장(KI-19)으로 멀고 싼 경기·인천**이 새어 들어옴.
  (추가로 거리 1차 필터 `maxKm = patience*0.75km` 도 시간 대비 헐거움 — patience45→33.75km 는 통근 ~60~90분에 해당.)
- **제안**: 게이트를 **`safePatience * 1.2`(±버퍼)** 수준으로 강화 → 인내심 ~1.2배 초과 통근은 제외(추정오차 버퍼만 허용).
  관측상 서울(≤43분)과 경기·인천(≥60분) 사이 명확한 갭이 있어 1.0~1.3배 어디든 분리 가능. (commute 는 Haversine 추정이라 약간의 버퍼 권장.)
  보조로 maxKm 도 시간정합되게 재산정 검토. **commute 는 demand-driven ODsay 전까지 Haversine 추정**임을 감안.
- **영향/주의**: 게이트 강화 시 인내심 낮으면 결과 수 감소(의도된 동작 — 사용자 인내심 존중). 점수 로직(가중합)은 변경 불필요(게이트만).
- **해결(2026-06-03)**: `recommendationRepository.ts` 에 `PATIENCE_GATE_MULT = 1.2` 상수 도입 →
  ① 시간 게이트 `commuteMinutes > safePatience * 2` → **`* PATIENCE_GATE_MULT`(=1.2)** 로 강화.
  ② 보조 1차 거리필터 `maxKm` 도 시간정합: 게이트 시간(patience×1.2)을 km 환산(×0.5) 후 Haversine↔cached 슬랙용
     1.3× 패딩 → `safePatience × 1.2 × 0.5 × 1.3`(기존 ×0.75 → ≈×0.78, 사실상 유지하되 게이트 배율에 종속화).
  cached 통근(실측)이 Haversine 보다 빠를 수 있어 **정밀 제외는 시간 게이트**가 담당, maxKm 은 coarse 사전필터로 버퍼 유지.
  typecheck OK. (재현 케이스: 인내심 45 → 45×1.2=54분 초과인 만수동 89분 등 제외 기대.)

### KI-23 · ODsay 쿼터 차단 중 Haversine 폴백이 캐시에 고착 🟢 해결 (2026-06-03)
- **증상(잠복)**: 일 800 쿼터 소진(`≥ODSAY_DAILY_LIMIT`) 상태에서 **신규 미캐시 지역** 통근 조회 시,
  `fetchOdsayRoute` 가 차단으로 `null` 반환 → 라우트가 `Math.round(carMin*1.4)` Haversine 폴백.
  사용자엔 에러 없이 추정 표시(정상)지만, **이 폴백값이 `t_commute_matrix` 에 저장**됨([commute.ts](../server/src/routes/domains/commute.ts)).
  → 다음부터 캐시 hit 으로 ODsay 재호출 안 함 + **쿼터 리셋 후에도 추정값 고착**(TTL 없음).
  쿼터 터진 날 처음 등장한 지역이 영구히 Haversine 으로 박제됨.
- **원인**: `fetchOdsayRoute` 가 **"쿼터 차단"과 "진짜 무경로(-98/-99)"를 둘 다 `null`** 로 반환 → 구분 없이 저장.
  (기존부터 있던 잠복 버그. 2026-06-03 Depth 2 top-8 라이브 ODsay 도입으로 노출 빈도↑.)
- **해결**: 저장 직전 `getOdsayUsageToday().blocked` 확인 → **차단 중이면 추정 폴백(`transitTransfers===null`)을
  저장에서 제외**(다음 쿼터 가용 시 재조회). 평시엔 진짜 no-route 도 저장(알려진 무경로 재호출 방지). typecheck OK.
- **잔여(선택)**: 추정 엔트리에 명시적 `estimated`/`source` 컬럼 + TTL 재검증을 두면 더 견고(미착수).

---

## C. 필터 / 예산 / 시세

### KI-9 · 월세 표시 기준과 월세 한도 필터 기준 불일치 🟡 (심각도: 낮음)
- **증상**: 카드 "월 ○○만"·RIR 은 `monthlyCost`(월세 + 보증금×환산), 월세 한도 필터는 `monthlyRentManwon`(순수 월세). 두 숫자가 달라 사용자가 혼동할 수 있음.
- **제안**: 카드에 "월세 ○○만 + 보증금 ○○" 분리 표기, 또는 한도/표시 기준 통일.

### KI-10 · 반전세가 월세(WOLSE) 버킷에 혼입 🟢 해결 (2026-05-31)
- **증상**: 보증금이 큰 반전세가 WOLSE 로 분류되어 월세 중위값/표본에 섞임 → 순수 월세 통계 왜곡(monthly median ↓, deposit median ↑).
- **해결**: `fetchRentCostByRegion` pooled CTE 에 **반전세 제외 필터**(MONTHLY 한정) 추가. 반전세 정의 = `보증금×JEONSE_TO_MONTHLY_RATE > 순수 월세`(= 보증금 환산월이 월세 초과 → 사실상 전세에 가까움. ≈보증금 월세의 ~267배 초과, 한국부동산원 '준전세' 240배 기준 근접, 기존 환산율 재사용). 순수 월세(유지) = `monthly >= deposit×RATE`. WOLSE 표본 **전체에서 제외**해 cost·deposit·monthly 3종 median 모두 진짜 월세 시장 반영. JEONSE 는 monthly=0 이라 미적용.
- **검증**: node 시뮬레이션 — 반전세/준전세 제외·경계값(환산=월세) 유지·완전월세(보증금0) 유지 확인, 제외 후 monthly median 왜곡 없이 상향.
- **잔여**: 반전세 제외로 일부 동 표본이 HAVING<5 가 되면 매매가 합성 폴백(설계상 허용). 별도 '반전세 시세' 라벨 표출은 후속(선택).

### KI-11 · 표본 임계(HAVING COUNT≥5)가 낮음 🟡 (심각도: 낮음)
- **증상**: 5~9건 표본 동의 시세 신뢰도가 낮음.
- **현재 완화**: 카드에 `표본 N건` 칩(10건 미만 amber·"참고") 노출.
- **제안**: 임계 상향 또는 표본수 기반 신뢰가중(저표본 동 랭킹 디스카운트).

### KI-12 · "N곳 숨김" 사유 미세분화 🟡 (심각도: 낮음)
- **증상**: `budgetFilteredCount` 가 보증금·월세·매매가 초과를 합산 → 어떤 한도로 숨겼는지 구분 안 됨(배너는 "예산"으로 일반화).
- **제안**: 사유별 카운트 분리(보증금 초과 N / 월세 초과 M).

---

## D. 가정 / 환산율

### KI-13 · 소득 미입력 시 3분위(403만) 가정 🟡 (심각도: 낮음)
- **증상**: 소득 미입력 시 서버 기본 3분위 → 사용자가 인지 못하면 affordability 왜곡.
- **현재 완화**: 월 급여 직접입력 시 실제값 그대로 사용(2026-05-30 버그 수정). 미입력 시 기본 가정은 잔존.
- **제안**: 미입력 상태를 카드/안내에 명시("3분위 기준 추정").

### KI-14 · 고정 환산율 🔴 (심각도: 낮음)
- **증상**: 전세→월 환산 `JEONSE_TO_MONTHLY_RATE`(4.5%/12), 매매→전세 `MONTHLY_COST_RATE`(전세가율 65%×4.5%) 가 상수 → 금리·시장 변동 미반영.
- **제안**: 한국은행 전월세전환율·지역별 전세가율 주기 갱신.

---

## E. 개발 환경

### KI-15 · 작업 샌드박스에서 tsc 직접 실행 불가 🟡 (개발 메모)
- **증상**: 마운트 동기화 지연으로 bash `tsc` 가 stale/truncated 파일을 읽어 신뢰 불가. (이 known-issues 문서도 부분 편집 누적 시 마운트가 잘린 버전을 보여준 사례 있음 — 편집 후 에디터 새로고침 권장.)
- **현재 완화**: 권한 파일은 정상. 순수 로직은 node 시뮬레이션으로 검증, 컴파일은 **실 환경 `npm run typecheck`(client·server)** 1회로 확인.

---

## F. 실 환경 시드 실행 체크리스트 (KI-4/5/6 — 코드 완료, 실행만 남음)

> 샌드박스는 localhost MySQL 접속 불가 → 아래는 **사용자 PC(실 환경)** 에서 1회 실행.
> server 디렉터리에서 진행. 각 단계 후 결과 통계 콘솔 출력 확인.

1. **스키마 반영**: `npx prisma db push` → `npx prisma generate`
   - `t_poi_summary` + **`t_legal_dong.lat/lng` 신규 컬럼(KI-20)** 반영 + Prisma Client 재생성.
   - ⚠️ generate 시 EPERM(엔진 DLL 잠김) 나면 **실행 중인 node(dev 서버·시드) 모두 종료 후** 재시도.
2. **(수도권) t_legal_dong 좌표 적재 + 레거시 정리(KI-20)**: `npm run seed:legal-dong -- --prune`
   - `capital-centroids.json`(1187동) 좌표를 t_legal_dong 에 저장 + centroids 에 없는 수도권 레거시 10자리 행(부천41190·양주군41710 등 ~1377) 삭제.
   - 확인: `SELECT sido,COUNT(*) FROM t_legal_dong WHERE LENGTH(code)=10 GROUP BY sido;` → 서울427·인천158·경기602(합 1187).
   - 타입체크: `npm run typecheck`(server) 1회(KI-15).
3. **KI-5 안전(즉시 가능, API 불필요)**: `npm run seed:safety`
   - ✅ 수도권 점수표·5자리 코드 키 **코드 완료(2026-06-01)**. --prune 후엔 1187동 clean(레거시 umbrella/별칭 미사용).
   - 확인: `SELECT ROUND(AVG(total_score),1),MIN(total_score),MAX(total_score) FROM t_safety_index;`
4. **KI-6 교통(키 필요)**: `.env` 에 `MOLIT_SERVICE_KEY`(+서울 `SEOUL_TOPIS_KEY`) → `npm run seed:transit`
   - ✅ TOPIS(서울)/TAGO(경기·인천) provider 분기 **코드 완료(2026-06-01)**. ⚠️ 적재 전 프로브 1회: `SEOUL_TOPIS_DEBUG=1`(서울 좌표)·`TAGO_DEBUG=1`(경기·인천 좌표)로 응답 필드/커버리지 확정.
   - 확인: `SELECT AVG(transit_score),MIN(transit_score),MAX(transit_score) FROM t_transit_route_summary;`
5. **KI-4 생활(키 필요)**: `.env` 에 `KAKAO_REST_API_KEY` → `npm run seed:life`
   - centroid 를 t_legal_dong.lat/lng 직접 사용(KI-20) → **"대상 행정동"이 1187 에 근접해야 정상**(이전 424=서울만 = 이름조인 버그).
   - 동당 8 API 호출 × ~1,187동 ≈ 9,500콜(quota 30만/일 여유). 확인: `SELECT ROUND(AVG(life_score),1),MIN(life_score),MAX(life_score) FROM t_poi_summary;`
6. **검증**: 추천 1회 호출 → 응답 `estimatedAxes` 가 비거나(`[]`) safety/life 가 빠졌는지 확인.
   적재 성공 시 더미 50·`*IsEstimated=true` 해제 → 점수 변별력 상승.

> **진행상황(2026-06-02)**: 1·2(db push/generate/legal-dong --prune)·3(safety 1187)·5(life 1187, 평균 43.2)·4(transit **경기·인천 662**, 평균 47.3) **완료 → KI-4/5/20 🟢, KI-6/17 🟡(서울만 잔존)**.
> **남은 건 서울 transit뿐** — data.go.kr 서울 정류소/노선 활용신청 **승인 전파(2026-06-02 신청)** 후 `seed:transit` 재실행(MOLIT 키 재사용, 별도 키 불필요).

---

## 우선순위 제안 (영향 ÷ 공수)
0. ~~**KI-1 + KI-2 + KI-3** (후보·대표값을 매물종류 인지화)~~ → 🟢 2026-05-30 해결.
1. ~~**KI-16 + KI-8** — 매매 대표가 면적 제한(60~85) 제거 → 전체 면적 + median 통일.~~ → 🟢 2026-05-31 해결(`fetchRepresentativePrices` 한 곳).
2. ~~**KI-10** (반전세 분리) — 월세 통계 정확도.~~ → 🟢 2026-05-31 해결(`fetchRentCostByRegion` pooled 필터).
3. **KI-4 / KI-5 / KI-6** (실데이터 적재) — 🟡 **코드 완료(2026-05-31)**, 실 환경 시드 실행만 남음(§F 체크리스트). IN절 `Prisma.join` 버그픽스 동반.
4. **▶ 다음 2주: 수도권 MVP 확장** — `docs/수도권-mvp-plan.md` (ODsay 쿼터 선행 → 2년치 수도권 수집 → provider 추상화). 동반: **KI-17**(provider 추상화 — 코드 완료), **KI-18**(Depth 3 매물종류별 분기 — `docs/depth3-design.md`), KI-6 점수 분리.
   - 🆕 **KI-19**(수도권 MVP 블로커): 추천 서빙 universe 가 서울 한정(`sigunguCodePrefix='11'`) → 수도권 적재됐어도 미서빙(강남 전세 2.3억 → 0건). **ODsay 쿼터(§4) 선행 후 prefix 다중화**로 해소.
5. 나머지(KI-7·9·11~14)는 정확도·UX 보강.
