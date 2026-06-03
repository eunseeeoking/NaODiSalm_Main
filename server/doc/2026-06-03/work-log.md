# 작업일지 2026-06-03

## 0. 한 줄 요약
SH(단독·다가구) 수도권 적재 + 4축 시드 완료 후, **그동안 정체불명이던 "전월세 추천 0건"의 진짜 원인(Prisma 파라미터 바인딩 버그)을 끝까지 추적·해결**하고, 데이터 정합을 **법정동 기반으로 복귀**시킨 뒤 **쿼리 성능·용량 최적화**와 **KI-19 수도권 서빙(서울→수도권)**, 클라이언트 통근 히트맵 재설계(§4)·핀클릭 UX까지 진행. 추천 도메인이 수도권 전역에서 4축 실데이터로 동작하게 됨.

> 브랜치: `feat/capital-mvp` (main 미머지·미push). 참조: `docs/known-issues.md`(KI-4~22), `docs/수도권-mvp-plan.md`.

---

## 1. 데이터 적재 (완료)

### 1-1. SH(단독·다가구) 수도권 적재
- `ingest:realty:bulk --type=SH --from=202406 --to=202605 --region=capital` → 1968/1968 step · 실패 0.
- 전월세만(매매 없음), 좌표 없음(지번 마스킹) → 동 centroid 근사.

### 1-2. 수도권 4축 시드
- **안전(safety)**: `seedSafetyIndex.ts` v3 — `SIGUNGU_SAFETY` 키를 **구 이름 → 5자리 시군구 코드**로 전환(인천 중구↔서울 중구 등 동명 충돌 차단) + 경기·인천 57개 점수표 + umbrella/레거시 코드 별칭. 수도권 1187 적재(skip 0).
- **생활(life)·교통(transit)**: provider 추상화(서울 TOPIS / 경기·인천 TAGO) + 수도권 확장. life 적재, transit 경기·인천 662(서울은 TOPIS 승인 대기).

---

## 2. 전월세 추천 0건 — 진짜 원인 추적·해결 (KI-21) ⭐ 이번 세션 핵심

### 2-1. 증상
- JEONSE/MONTHLY 추천이 **항상 0건**(강남 전세 등). `meta.totalCandidates=0, budgetFilteredCount=0`.
- 그동안 KI-19(universe/예산)로 의심했으나 **별개의 숨은 쿼리 버그**였음. SALE은 정상이라 발견이 늦음.

### 2-2. 진단 경로 (단계적 격리)
- aggregates=396·priceMap=1411 정상인데 **rentMap=0** → `fetchRentCostByRegion` 런타임 0행.
- 생SQL(literal 파라미터)은 1078행 정상 반환 → **Prisma 파라미터 바인딩 문제**로 좁힘.
- REC_DEBUG 계측으로 `query.values` 확인 → RATE/contractType/cutoff 값은 맞는데 rows=0.

### 2-3. 원인 (핵심)
- `costExpr = Prisma.sql\`p.deposit_manwon * ${RATE}\`` 를 **SELECT 절에 embed** → 그 뒤 `contract_type`×3·`cutoff`
  파라미터가 붙으며 **`$queryRaw` 파라미터 바인딩 순서가 placeholder 순서와 어긋남** → `deposit*'JEONSE'`·`contract_date>=숫자`
  꼴이 되어 **에러 없이 0행** 반환. (매매가 쿼리는 cutoff 1개뿐이라 무사 → priceMap 1411.)

### 2-4. 해결
- RATE는 상수(`0.045/12`)라 **SQL 리터럴 인라인(`Prisma.raw`)으로 파라미터 제거** → rows 0→1078. semiJeonseFilter도 동일.
- **2차 노출 이슈**: rent 쿼리가 실제 실행되니 **`connection_limit=1`** + Promise.all 4쿼리에서 느린 rent median이
  단일 커넥션 점유 → pool timeout(10s) → 500. → `.env` DATABASE_URL **`connection_limit=10`** 으로 해소.
- **교훈**: Prisma.sql 에 **상수는 파라미터로 두지 말고 인라인**. embed된 fragment 파라미터 순서 주의(유사 패턴 감사 권장).

---

## 3. 법정동 기반 복귀 (KI-20 반전)

- **발단**: 앞서 "행정동 centroid" 접근(t_legal_dong에 lat/lng + `--prune` + POI/transit 행정동화)을 시도했으나,
  prune로 **법정동 행을 지우니 추천 serving이 깨짐**(complex=법정동 이름매칭 345→82 붕괴 → 후보 0).
- **진짜 정답**: `seed:bjd`(kr-legal-dong **전국 법정동**). 원래 "424(인천경기 누락)"도 t_legal_dong에 **수도권 법정동이 없어서**였지
  행정동 전환이 필요했던 게 아님.
- **조치**: ① `seed:bjd`로 전국 법정동 복원(매칭 345→342) ② `seedPoiSummary`/`seedTransitSummary`를 **법정동 complex-join으로 복귀**.
  전부 **법정동 단일 키**로 정합(인천·경기도 매칭).

---

## 4. 쿼리 성능 최적화 (KI-21 후속)

rent/price median 쿼리 (cold 7s → **warm ~2.7s**, patience 75=서울 전체 worst-case):
- ① **후보 동(targetAggs) 튜플 IN 필터**(`dongTupleFilter`) — 전 수도권 스캔 회피
- ② **STRAIGHT_JOIN** — complex(소형·`(sigungu_code,legal_dong)` 인덱스)를 driver 강제 → rent/trade 풀스캔 대신 `complex_id` 인덱스 조인
- ③ **JEONSE 단일정렬** — cost=deposit×RATE 단조 → median 정렬 3→1(cost는 JS에서 ×RATE 환산), monthly=0
- ④ **cutoff MAX(date) 10분 인메모리 캐시**(`cachedCutoff`) — 인덱스 미사용 풀스캔 반복 제거
- (REC_DEBUG 게이트 단계별 `timed()` 프로파일링 추가)
- **잔여(서브초, 미착수)**: worst-case는 매 요청 raw 거래 median 재계산이 본질 한계 → 동별 (dealType×매물종류) median을
  **배치 사전집계 summary 테이블**(POI/safety 패턴)로 빼면 런타임 ~10ms. 필요 시 별도 세션.

---

## 5. raw_payload 컬럼 제거 (용량·행 축소)

- `raw_payload`(국토부 원본 JSON)는 **서빙 미사용·ingest write-only** 확인 → trade 3 + rent 4 = **7개 테이블 컬럼 DROP**.
- DROP 전 콜드 아카이브: `scripts/archiveRawPayload.ts` (`archive:raw`) → `server/archive/raw_payload_*.jsonl.gz` **7.33M행 백업**(gitignore).
- schema/ingest(apt·realty)에서 rawPayload 제거. InnoDB 행 축소로 median 스캔도 가벼워짐.

---

## 6. KI-19 — 추천 서빙 universe 서울 → 수도권

- `fetchRegionAggregates` 기본 prefix `'11'`(서울) → **`['11','28','41']`(수도권)**. `sigunguPrefixFilter` 신설.
- 후보 매칭을 sigungu **이름** → **시군구 코드(5자리)+동명** 기반으로 교체 → **동명 시군구 충돌 차단**(인천 중구↔서울 중구 등).
- **서빙 경로 ODsay 라이브 호출 없음**(`findCachedMatrix`=DB캐시, 미스는 Haversine) → 쿼터 안전. 수도권 commute는 §4 전까지 Haversine 근사.
- **검증**: 강남역 totalCandidates 396→**537**(경기·인천 편입). **판교 직장 → top8 전부 경기 성남(분당41135·수정41131·중원41133)** 통근 9~23분.

---

## 7. POI/transit 시드 universe 4종 union (수도권 life 추정 해소)

- **증상**: 수도권(특히 인천·경기) 추천에서 생활(life)이 추정으로 표시.
- **원인**: serving은 4종 단지(APT+OFFI+VILLA+SH) UNION universe인데 seed는 `t_apt_complex`만 조인 →
  **아파트 없는 동(빌라·오피만)이 POI 미적재**(poi 1529 < safety 2564). 서울은 아파트 밀집이라 갭이 작아 안 보였음.
- **해결**: 두 시드의 centroid 조인을 **4종 complex UNION**으로 → serving universe와 정합. 재시드 후 수도권 life 실값 확인.

---

## 8. 클라이언트 (⚠️ 미커밋 — 시각 검증 전, 사용자 직접 커밋 예정)

### 8-1. 통근 히트맵 §4 재설계 (ODsay demand-driven)
- 기존: MapPanel이 centroids 전체(~1200)를 `/api/commute/matrix`로 요청 → 콜드 캐시 시 **ODsay ~1200회 폭발**.
- 변경: **배경 전체 동 = Haversine 추정(무료)** + **추천 top-8만 ODsay 정밀 조회(~8회/조회·캐시)** → 8개는 ODsay 실측 통근 tier색(초록~빨강).
- 추천(법정동)→최근접 행정동 centroid 폴리곤에 매핑(GeoJSON·centroids는 행정동, 추천은 법정동이라).
- (랭킹 점수는 서버 Haversine 그대로 — ODsay는 표시·색 정밀화용.)

### 8-2. 지도 핀 클릭 → 카드 포커스 (모바일 UX)
- 모바일에서 핀 탭했는데 무반응이던 문제. store `focusedRegion`/`focusTick`/`setFocused` 추가.
- 핀 클릭 → `setFocused` → RegionCard `scrollIntoView` + `card-flash` 애니메이션(index.css 키프레임).

---

## 9. 발견·미해결

### KI-22 · 통근 게이트가 인내심에 비해 너무 헐거움 🔴
- 인내심 45분 조회인데 **commuteMinutes 60·69·75·89분** 지역이 5~8위 노출.
- 원인: 후보 게이트 `commuteMinutes > safePatience * 2`(=90분)가 헐거워, 멀고 싼 경기·인천이 affordability/life로 top8 진입.
  수도권 확장(KI-19)의 부작용(서울 한정일 땐 다 가까워 안 보였음).
- 제안: 게이트를 **`safePatience * 1.2`(±버퍼)** 로 강화. 상세 근거 `known-issues.md` KI-22.

### 기타 잔여
- 서울 transit TOPIS: data.go.kr 승인 전파 지연(24h+) — 활성 후 `seed:transit` 재실행 + 필드 프로브.
- 수도권 commute Haversine 근사 → ODsay 거점/§4 demand-driven으로 정밀화(서빙 자체는 동작).
- KI-18 Depth 3 "동 상세 평가" + Depth3 진입 시 ODsay(demand-driven 나머지).

---

## 10. 커밋 (feat/capital-mvp)

```
b8347e4 fix(KI-19 후속): POI/transit 시드 4종 union (수도권 life 추정 해소)
44b5242 feat(KI-19): universe 서울→수도권 + 코드기반 동 매칭
97e8d8b perf: 추천 쿼리 최적화 + raw_payload 제거 (KI-21 후속)
57d3d9a docs: 인계 갱신
83c1e22 fix: 전월세 추천 0건 해결 — rent RATE 파라미터 인라인 + 법정동 복귀
d9a2ba0 feat: 수도권(서울·인천·경기) MVP 확장
```
- **미커밋**: 클라이언트 4파일(§8, 시각 검증 후 커밋) + `docs/known-issues.md`(KI-22).
- ⚠️ `.env` `connection_limit=10`은 로컬만 — 새 환경은 동일 설정 필요(.env.example 가이드 후보).

---

## 11. 다음 세션 출발점
1. **KI-22 수정** (게이트 `*2 → *1.2`) — 빠른 1순위.
2. 클라 §8 작업 `npm run dev` 시각 검증 → 커밋(또는 추천 폴리곤 가시성 튜닝).
3. KI-18 Depth 3 동 상세 + Depth3 ODsay(demand-driven 나머지).
4. (선택) median 사전집계로 서브초 / 서울 transit TOPIS 승인 후 재시드.

---

# ───────────── 후속 세션 추가분 (2026-06-03 오후) ─────────────

## 12. KI-22 — 통근 게이트 강화 (완료·커밋)
- `recommendationRepository.ts`에 `PATIENCE_GATE_MULT = 1.2` 도입 →
  ① 시간 게이트 `commuteMinutes > safePatience * 2` → **`* 1.2`** (인내심 45분에 60~89분
  경기·인천이 affordability/life로 top8 진입하던 KI-19 부작용 차단).
  ② 보조 거리필터 `maxKm`도 게이트 배율에 종속화(정밀 제외는 시간 게이트, maxKm은 coarse 사전필터).
- known-issues KI-22 🟢. 커밋 `38dac62`.

## 13. 추천 지도 폴리곤 재설계 + Depth2 top-8 ODsay 실측 (완료·커밋)
> §8(이전 세션) 통근 히트맵을 사용자 사전 요청 설계대로 재구성.
- **배경 전체 폴리곤 제거 → 추천 top-8 지역구 폴리곤만 강조**: `useChoroplethLayer`에
  `includeCodes` 화이트리스트 추가. 추천(법정동)→최근접 행정동 폴리곤 매핑.
- **신호등 tier 색**: 파랑 램프(`pickHeatmapColor`) → `pickCommuteTierColor`(초록→노랑→빨강).
  범례도 동일 갱신.
- **Depth2 추천 8곳만 ODsay 호출**(요청당 ≤8콜) → store `commuteOverrides` → 지도 폴리곤 색 +
  카드 통근분 공유(미스 시 서버 Haversine 폴백, 카드 `~` 표시). `includeCodes`(추천 의존)와
  `colorByCode`(통근값 의존) 분리로 ODsay 도착 시 폴리곤 깜빡임 방지.
- **매물 단위 ODsay = 폐기**(수십만건 불가). Depth 3는 동의 top-8 캐시 재사용(추가 호출 0).
- 커밋 `f86cf85`.

## 14. ODsay 캐시 격자 4→3자리 + KI-23 캐시 포이즌 방지 (완료·커밋)
- **격자 확대**: `makeCacheKey`/`Candidates` `toFixed(4)`→`toFixed(3)` (~11m→~110m 버킷,
  3×3 KNN ~330m 흡수). 인접 직장 캐시 재사용 ~100배↑. top-8 캡과 함께 ODsay 호출량 절감.
  (행정동 단위 표시엔 ≤150m 원점 스냅 오차 무의미. 기존 4자리 캐시는 재축적.)
- **800 쿼터 가드 확인**: `fetchOdsayRoute`가 호출 직전 `checkAndConsumeOdsayQuota()` →
  ≥800이면 `null`(Haversine 폴백). top-8 경로도 동일 게이트 통과, 요청당 ≤8콜.
- **KI-23(신규·해결)**: 쿼터 차단 중 Haversine 폴백값이 `t_commute_matrix`에 저장돼 리셋 후에도
  고착되던 잠복 버그 → 저장 직전 `getOdsayUsageToday().blocked` 확인, 차단 중엔 추정 폴백
  (`transitTransfers===null`) 미저장(다음 가용 시 재조회). known-issues KI-23 🟢. 커밋 `2e2b656`.

## 15. KI-9 / KI-12 카드 UX 보강 (완료·미커밋 → 본 세션 말미 커밋 예정, 시각검증 권장)
- **KI-9(🟢)** 월세 표시 ↔ 필터 기준 일치: 서버가 `rentDepositManwon`·`rentPureMonthlyManwon`을
  후보→응답까지 노출. 카드 대표가 거래유형별 분리 —
  · MONTHLY → "월세 X만"(=순수 월세, **월세 한도 필터와 동일**) + 보조 "보증금 Y"
  · JEONSE → "보증금 X억"(=전세금, **보증금 한도와 동일**) · SALE/sale-proxy → "가격 X억" 유지.
  RIR·주거비%는 합산 월주거비(`monthlyHousingCost`) 그대로(별개 개념).
- **KI-12(🟢)** 숨김 사유 분리: 게이트가 `budgetFilteredBreakdown{deposit,monthlyRent,salePrice}`
  집계(상호배타) → meta 전달 → 배너 "보증금 초과 N · 월세 초과 M 숨김". 월세만 초과 시
  "월세 한도 늘리기" 버튼이 `monthlyRentCap` 상향(기존엔 항상 예산만).
- typecheck OK(client·server). **시각 검증은 다음 세션에서**(카카오맵/브라우저 필요).

## 16. 커밋 로그 (이번 세션 추가, feat/capital-mvp)
```
38dac62 fix(KI-22): 통근 게이트 인내심 *2 → *1.2 강화
f86cf85 feat: 추천 지역 폴리곤 재설계 + Depth2 top-8 ODsay 실측 통근
2e2b656 perf+fix: ODsay 캐시 격자 4→3자리 확대 + 쿼터 차단 폴백 캐시 포이즌 방지(KI-23)
f338857 docs: KI-22/23 해결 기록 + 2026-06-03 인계 work-log
(+ KI-9/12 feat 커밋 — 본 섹션 직후)
```
- ⚠️ main 미머지·미push(로컬만). push는 미요청.
- ⚠️ 기존 4자리 ODsay 캐시 보존 원하면 1회 마이그레이션:
  `UPDATE t_commute_matrix SET cache_key=CONCAT(FORMAT(work_lat,3),'_',FORMAT(work_lng,3))` (선택).

## 17. 다음 세션 (사용자가 별도 진행)
- **KI-18 Depth 3 "동 상세 평가"** — `docs/depth3-design.md` 기반. 큰 제품 작업.
  - 코어 데이터 이미 확보 확인: `SafetyIndex`에 crime/light/cctv 3종, `PoiSummary`에 8개 카테고리
    카운트, `TransitRouteSummary`에 정류장수/배차/막차 → **4축 분해는 기존 컬럼 노출로 가능**(신규 집계 불필요).
  - 신규 필요: 면적대별(소·중·대) median 집계(KI-16 후속), 반전세 비율(KI-10 후속).
  - 현재 Depth3(`/api/regions/:code/complexes` + `ComplexCardList`/`LstmFullAnalysis`)는 APT 단지 전망
    중심 → 종류별 분기(APT=단지전망 유지, VILLA/OFFI/SH=동 상세평가만 + 정직 안내) 필요.
  - 결정 보류(설계 §6): 빌라/오피 "건물 시세 카드" MVP 포함 여부, 시세 분포 시각화 형태.
- (선택) KI-21 median 사전집계로 추천 서브초화.
