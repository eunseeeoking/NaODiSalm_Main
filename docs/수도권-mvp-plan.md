# 수도권 MVP 확장 — 2주 작업 플랜

> 작성: 2026-05-31 · 성격: **살아있는 작업 문서**(2주간 계속 열람·갱신)
> 관련: `docs/known-issues.md`, `docs/depth3-design.md`, 제품 컨셉 §0
> 한 줄 요약: 서비스 범위를 **서울 → 수도권(서울·경기·인천)** 으로 확장. 실거래는 **2년치**만
>            우선 수집하고, **ODsay 쿼터 구조 개선을 선행**한 뒤 데이터를 적재한다.

체크 범례: `[ ]` 예정 · `[~]` 진행 · `[x]` 완료

---

## ▶ 다음 세션 시작점 (인계)  — 갱신 2026-06-02 (수도권 데이터·시드 전부 적재 완료)

- **이 문서가 메인.** 참조: `docs/known-issues.md`(KI 추적), `docs/depth3-design.md`(Depth 3 설계).
- **커밋**: 브랜치 **`feat/capital-mvp`** (최신 `83c1e22`). ⚠️ **main 미머지·미push**(클라이언트 연계 전 — main 머지 시 빌드/배포 트리거).

- **🔥 2026-06-02 심야 디버깅 결과 — 전월세 추천 0건 완전 해결(KI-21):**
  - **진짜 원인**: `fetchRentCostByRegion` rent 쿼리에 `${RATE}` 파라미터 embed → Prisma 바인딩 순서 꼬임 → rent 0행 → 전월세 후보 전멸. (KI-19 universe/예산이 아니었음.) → RATE 리터럴 인라인으로 해결.
  - **데이터**: 행정동 centroid 접근 폐기·**법정동 기반 복귀**(`seed:bjd` 전국 법정동 + POI/transit 법정동 complex-join). KI-20 반전 참조.
  - **환경**: `.env` `connection_limit=1→10` (pool timeout 해소). ⚠️ 로컬 .env만 — 새 환경은 동일 설정 필요(.env.example 가이드 추가 후보).
  - **검증**: 강남역·전세 추천 정상(totalCandidates 230, safety/life 실값, estimatedAxes=[]).

- **🟢 쿼리 성능 최적화 완료(2026-06-XX)**: 후보 동 튜플 IN 필터 · STRAIGHT_JOIN(complex driver) · JEONSE 단일정렬 ·
  cutoff MAX 10분 캐시 · **raw_payload 컬럼 DROP**(7.3M행 archive 후, 용량↓·행축소) · `connection_limit=10`.
  → cold 7s → **warm ~2.7s**(patience 75=서울 전체 worst-case). 상세: KI-21.
  **남은 서브초 해법(미착수)**: 동별 median 배치 **사전집계 summary 테이블**(런타임 조회 ~10ms). 필요 시 별도 세션.
  ⚠️ raw_payload archive 파일은 `server/archive/`(gitignore) 로컬 보관.

- **▶ 2026-06-02 세션 = 수도권 데이터/시드 마무리. 시드 적재 현황:**
  | 축 | 상태 |
  |----|------|
  | 실거래 APT/OFFI/VILLA/SH | 🟢 2년치 적재·지오코딩 완료 (SH 1968/1968·실패 0) |
  | 안전(safety) | 🟢 **1187** (skip 0) |
  | 생활(life) | 🟢 **1187** (평균 43.2) |
  | 교통(transit) | 🟡 **662**(경기·인천, 평균 47.3) — **서울은 TOPIS 승인 대기** |

- **▶ 이번 세션 핵심 코드 변경(전부 typecheck OK):**
  - **KI-20 해결** — `t_legal_dong` 에 `lat/lng` 추가 + `seed:legal-dong --prune`(레거시 1377 삭제→1187 clean).
    POI/transit centroid 출처를 `t_apt_complex` 이름조인 → **`t_legal_dong.lat/lng` 직접 사용**(인천·경기 누락 해소: life 424→1187).
  - **provider 추상화(KI-6/17)** — `transitProvider`(서울 TOPIS / 경기·인천 TAGO). 정류장 노선조회 병렬화. **TAGO 경기·인천 커버리지 프로브 검증 완료.**
  - **안전(KI-5)** — `SIGUNGU_SAFETY` 5자리 코드 키 + 경기·인천 점수표 + 구개편/레거시 umbrella 별칭.

- **▶ 다음 세션 작업 (우선순위):**
  1. **🚧 클라이언트 본작업** (현재 진행 중, `feat/capital-mvp` 브랜치) — 거래유형/매물종류 필터 등 UI 연계.
  2. **서울 transit 마무리** — data.go.kr 서울 정류소/노선 활용신청 **승인 전파(2026-06-02 신청) 후** `npm run seed:transit` 재실행.
     ⚠️ 활성 직후 서울 좌표 1곳 `SEOUL_TOPIS_DEBUG=1` 프로브로 **응답 필드명(arsId/busRouteId/firstBusTm) 확정** 필요(엔드포인트·파라미터는 명세대로 정정됨). 키는 MOLIT_SERVICE_KEY 재사용.
  3. ~~**KI-19 — 수도권 추천 서빙**~~ → 🟢 **완료(2026-06-XX)**: universe 수도권(11·28·41) + 코드기반 매칭(동명 충돌 차단).
     검증: 판교 직장→경기 성남 top8, 강남→서울(통근상 정상), totalCandidates 396→537. 서빙은 ODsay 라이브 무관(캐시+Haversine).
     **잔여**: 수도권 commute Haversine 근사 → §4(ODsay 거점 사전적재)로 정밀화는 별도(정확도 개선, 블로커 아님).

- **빌라 좌표 주의**: VILLA 좌표 중 ~24%는 **법정동 centroid 근사치**(같은 법정동=동일 좌표). 추천 universe·동 집계엔 정상이나
  **지도 핀엔 부정확** → "건물 시세 카드"(depth3 §5) 갈 때 그 단지만 정밀 재지오코딩 필요. (coordSource 플래그 후속)
- **환경 메모**: ⚠️ **prisma 스키마 변경됨**(`LegalDong.lat/lng` 추가) → 다른 환경/머신에선 `prisma db push`+`generate` 필요. `npm run typecheck`(client·server) 1회 권장(KI-15).

---

## ▶ 세션 산출물 (2026-05-31 · 수도권 데이터 확보 세션)

**신규 스크립트 / npm 스크립트**
- `gen:lawd` (`scripts/genLawdCodes.ts`) — `capital-centroids.json` → `src/data/capitalAreaLawdCodes.generated.ts`(82시군구). 하드코딩 폐기, 드리프트 구조적 차단. 서울 25구 ↔ `SEOUL_LAWD_CODES` 교차검증.
- `verify:lawd` (`scripts/verifyLawdCodes.ts`) — LAWD 코드 자체검증. DB(t_legal_dong) 대조 + `--probe`(RTMS 실호출). **probe 82/82 통과**.
- `geocode:complexes` (`scripts/geocodeComplexes.ts`) — 비아파트 단지 좌표 백필(NULL만, 재실행 이어처리). **재시도·백오프 + 실시간 ETA + bbox 가드(타지역 동명 오매칭 저장 거부) + `--fallback-dong`(무매칭 NULL을 법정동 centroid로 채움, API 무관)**.

**코드 변경**
- `seoulLawdCodes.ts` — 합본 재export + `INCHEON/GYEONGGI` sido 필터 뷰 + `lawdCodesByRegion()`. `SEOUL_LAWD_CODES`는 서울 전용 유지(REB name→code 충돌·LH 시드 보호).
- `bulkIngestApt`/`bulkIngestRealty` — `--region=seoul|capital|incheon|gyeonggi`(+`BULK_REGION`). 코드 수동입력 불필요.
- `aptIngest` — sido/시군구 맵을 합본 기반으로 확장(서울 동작 불변).
- `seedLegalDong` — 소스 `seoul-centroids`→`capital-centroids`, sido 파일값 사용(수도권 1187동).
- `seedPoiSummary` — 동 조회 WHERE 서울→수도권.
- (버그픽스) `bulkIngestApt` 소요시간 `/60`→`/60000`(분 1000× 과장).

**적재·지오코딩 결과**
- APT 2년치(202406–202605) 적재 + OFFI/VILLA 적재 완료. SH는 다음 세션(승인 후).
- OFFI 지오코딩: **99.98%**(정밀, bbox 오매칭 0).
- VILLA 지오코딩: **99.5%** = 정밀 90,246(75%) + **법정동 centroid 근사 28,865(24%)** + NULL 669(해당 법정동 정밀좌표 0개). 무매칭율 24.7%(빌라 건물명·지번 비일관 — 예측대로) → `--fallback-dong`으로 복구.
- **발견**: 부천(원미·소사·오정)·화성(만세·효행·병점·동탄) 행정구 신설 → centroids 자동반영으로 코드 일치, RTMS도 신설 구 코드 수용 확인(probe).

**최종 DB row 스냅샷 (2026-05-31, 수도권 적재 후, 총 ~696만)**
- t_apt_rent 3,675,274 · t_apt_trade 1,741,691 · t_villa_rent 423,071 · t_offi_rent 399,930 · t_sh_rent 302,789
- t_villa_complex 147,031 · t_villa_trade 139,178 · t_offi_trade 53,399 · t_apt_complex 20,589 · t_sh_complex 18,350
- t_commute_matrix 15,192 · t_offi_complex 10,216 · t_legal_dong 6,271 · t_reb_price_index 3,400 · t_training_result 2,143
- t_safety_index 469 · t_lh_youth_housing 49 · t_transit_route_summary 33 · t_income_quintile 5 · t_user 0
- ※ 78%가 서울 아파트 19년치(전월세+매매 540만) → TiDB 압박 시 §2 콜드분리 1순위. 진짜 용량 비용은 raw_payload JSON.

**발견된 이슈(미해결, 다음 세션)**: SH 미적재 · safety 표 구이름 키 충돌(KI-5/17) · transit provider(KI-17) · 행정동↔법정동 명칭 매칭(seed:life) · VILLA 좌표 24% 동단위 근사(정밀 재지오코딩/coordSource 플래그 후속).

---

## 0. 왜 수도권인가 (제품 근거)

"나어디삶"의 가치는 *어디 살지 모르는 사람에게 지역을 추천*하는 것. 그런데 **서울만**이면
예산이 동네를 거의 결정해버려(돈 있으면 강남, 없으면 사당) 선택지가 좁아 추천 가치가 낮다.
실제 의사결정 — "서울 직장인데 어디 살지" — 은 사당 vs 일산 vs 분당 vs 부천 vs 인천을
통근·주거비·생활로 저울질하는 **수도권 단위**에서 발생한다. 즉 수도권은 옵션이 아니라
**제품 정체성 그 자체**이며, §0("좋은 집이 아니라 좋은 지역")과 정합적이다.

---

## 1. 범위 정의

- **지역**: 서울 + 경기 + 인천 (수도권). LAWD_CD(시군구 코드) 기준 25 → ~70+ 시군구.
- **매물종류**: 4종 (아파트 / 연립다세대(빌라) / 오피스텔 / 단독·다가구).
- **거래유형**: 매매 / 전세 / 월세.
- **기간**: **2년치** (시세·affordability엔 충분. 시계열 학습 정책은 §6).
- **제외/후순위**: 19년치 장기 시계열은 아파트에 한해 유지(§2 콜드분리), 비아파트 장기 미수집.

---

## 2. 용량 분석 (TiDB Serverless 무료 5GB)

| 항목 | raw | 압축(TiDB ~5.6x) |
|---|---|---|
| 현재 전체 | 2.8 GB | ~500 MB |
| └ 서울 아파트 19년치 (지배 요인) | 1.9 GB | ~340 MB |
| 수도권 2년치 4종 추가(추정) | ~1.5 GB | **~300 MB** |
| 합계(추정) | — | **~800 MB / 5 GB** |

- **결론**: 2년치 수도권은 압축 후 +300MB 수준 → 5GB 한도에 여유. **저장은 병목이 아니다.**
- **진짜 비용은 수집(API rate-limit) + ODsay 쿼터**(§4). 디스크가 아니라 호출이 비싸다.
- **용량 레버(선택)**: ARIMA로 최근 데이터만 학습한다면, **서울 아파트 19년치를 운영 DB에서
  최근 N년으로 트림**하고 원본은 **콜드 스토리지(파일 덤프)** 로 분리 → raw 1.9GB가 급감.
  *지우지 말 것* — LSTM 재도입·장기 백테스트 대비 파일 보관(비용 거의 0).
- **장기**: 고도화에 따라 TiDB 유료 티어 전환 예정(계획 확정됨).

---

## 3. 데이터 수집

- [x] **LAWD 코드 확장**(2026-05-31): **하드코딩 폐기 → `client/public/data/capital-centroids.json`
      (행정동 universe) 단일 소스에서 자동 생성**. `npm run gen:lawd`(`scripts/genLawdCodes.ts`) →
      `src/data/capitalAreaLawdCodes.generated.ts`(`CAPITAL_AREA_LAWD_CODES` 82개 = 서울25·인천10·경기47).
      `seoulLawdCodes.ts`는 합본 재export + `INCHEON/GYEONGGI`(sido 필터 뷰), `SEOUL_LAWD_CODES`는 서울 전용 유지.
      `aptIngest` sido/시군구 맵을 합본 기반으로 확장(서울 동작 불변). 검증: `verify:lawd`.
      ⚠️ **개편 발견**: 부천(원미·소사·오정 3구 재설치 → 41192/41194/41196)·화성(만세·효행·병점·동탄 4구 신설 →
      41591/41593/41595/41597). centroids가 이미 반영 → 자동 생성으로 코드 일치. **단 RTMS가 신설 구 코드를
      받는지 옛 단일코드(41190/41590)를 받는지는 `verify:lawd -- --probe`로 확정 필요**(WATCH_CODES 플래그).
      `recommendationRepository.sigunguCodePrefix`는 이미 파라미터화 → prefix 다중화/제거만 남음.
- [x] **실거래 2년치 수집**(2026-05-31): `--region=capital`로 APT·OFFI·VILLA 일괄 적재 완료(각 82×24M=1968 step, 실패 0).
      VILLA 승인 확인됨. **SH는 다음 세션**(승인 확인 후 `--type=SH`, 좌표 불가·전월세만).
      - (버그픽스) `bulkIngestApt` 소요시간 `/60`→`/60000` 단위 오류 수정(분 표시 1000× 과장).
- [x] **비아파트 좌표 = 지오코딩**(2026-05-31, OFFI·VILLA 완료): `upsertComplexes`는 lat·lng NULL로 적재 →
      `npm run geocode:complexes`로 별도 백필(`lat IS NULL`만, 도로명→지번→키워드, 재실행 이어처리, 재시도·ETA·bbox 가드).
      - **OFFI**: 99.98% 정밀(실패 2건, bbox 0).
      - **VILLA**: 99.5% = 정밀 90,246 + **법정동 centroid 근사 28,865**(`--fallback-dong`) + NULL 669. 무매칭율 24.7%(건물명 비일관).
        ⚠️ 근사 좌표 24%는 동 단위(같은 법정동=동일 좌표) → 지도 핀 부정확, 추천 universe·동 집계엔 정상.
      - 단독(SH)은 지번 마스킹이라 지오코딩 불가 → 동 centroid 근사(`depth3-design.md` §1).
- [ ] **POI·safety·transit 재시드**: 동 universe가 수도권으로 늘면 재적재(§5 의존). POI는 코드 준비 완료(seed:legal-dong→seed:life), safety/transit는 코드 수정 필요.
- **매물종류별 학습/표시 정책**: `docs/depth3-design.md` 참조 (아파트=단지 예측, 비아파트=동 평가).

---

## 4. ODsay 쿼터 전략  ⭐ (수도권 **추천 서빙**의 선행 blocker — *수집과는 무관*)

> ⚠️ 오해 주의: **실거래 수집(§3)은 ODsay를 쓰지 않는다.** ODsay는 추천 시점의 통근 매트릭스
> 계산에만 쓰임. 따라서 데이터 확보는 ODsay와 독립적으로 먼저 시작해도 막히지 않는다.
> ODsay 쿼터는 "수도권 추천을 실제로 서빙"하기 전에 갖춰지면 된다.

문제: 후보 동이 ~3배(서울 ~400 → 수도권 ~1,500+)로 늘면 추천 서빙 시 통근 매트릭스 미스
폭증 → 일 1,000건(800 게이트) 한도가 터진다. **추천 서빙 전에 구조를 고쳐야 한다.**

핵심 전략 — ODsay를 *런타임 의존*에서 *배치로 한번 채우는 자산*으로:

- [ ] **격자 양자화 확대**: `commuteRepository`의 KNN 격자 흡수 단위를 키움(예 1km→2km).
      직장 좌표를 격자 중심으로 스냅 → 캐시 히트율 급등(정확도 약간 ↔ 호출량 급감).
- [ ] **업무지구 거점 사전적재**: 강남·여의도·판교·광화문·구로·송도 등 주요 업무지 20~30곳
      × 전 동 매트릭스를 배치로 미리 채움. 사용자 직장은 최근접 거점으로 스냅.
      → 거점 25 × 수도권 1,500동 ≈ 37,500쌍, 하루 800건씩 며칠 분산 적재 → 런타임 호출 ≈ 0.
- [ ] **캐시 만료 연장**: 90일 → **1년+** (통근시간은 노선 개편 없으면 거의 불변). 또는
      만료 대신 노선개편 이벤트 기반 무효화.
- **결정**: ODsay 폐기 안 함(대안 카카오모빌리티·TMAP는 대중교통 약하거나 유료). 위 3종으로 한도 무력화.

---

## 5. Provider 추상화 (KI-17 신규) — 지역별 데이터 출처 격리

전국/수도권 확장 시 **호출부가 갈리지 않도록** 분기를 provider 레이어에 캡슐화.

- [x] **POI/생활 재시드 준비**(2026-05-31): Kakao POI는 전국 단일 API라 provider 불필요. 동 조회만 확장 →
      `seedLegalDong`을 `capital-centroids.json`(1187동·sido 포함)으로 전환, `seedPoiSummary` WHERE를 수도권으로.
      **실행 대기**: `seed:legal-dong` → `seed:life`(인계 블록 3번).
      ⚠️ **명칭 매칭 메모**: POI centroid 조인이 `ac.legal_dong(법정동명) = ld.dong(행정동명)`이라, 행정동·법정동
      이름이 다른 동은 누락 가능(서울에서도 있던 한계). `seed:life` "대상 행정동 N" 보고 낮으면 매핑/폴백 보정.
- [x] **TransitProvider**(2026-06-01): `fetchTransitSummary(lat,lng,regionCode)` 단일 시그니처 — `transitProvider.ts` 디스패처가
      코드 prefix 로 분기. 서울(`11`)→**SeoulTopisProvider**(`seoulTopisClient.ts` 신규, ws.bus.go.kr) / 그 외(`28`·`41`)→**TagoProvider**(`tagoClient`).
      `seedTransitSummary` 수도권 확장 + provider 카운트 로그. **단 TOPIS 필드매핑·경기인천 TAGO 커버리지는 프로브 미검증(아래).**
- [x] **TAGO 경기·인천 프로브(2026-06-01)**: 수원 매탄1동·인천 옥련1동 모두 정류장·노선 반환 + transitScore 적재 성공 → 커버리지 검증 완료.
- [ ] **서울 TOPIS(잔여, 승인 전파 대기)**: 프로브 시 `SERVICE KEY IS NOT REGISTERED` — **data.go.kr 테스트 콘솔도 동일** →
      활용신청 승인(2026-06-02)이 ws.bus.go.kr 로 전파 대기(수 시간~익일). 키 별도 불필요(MOLIT 재사용). 엔드포인트·파라미터는 명세대로 정정
      (`getStaionsByPosList`·`tmX=위도/tmY=경도`·`getRouteByStationList`·`getBustimeByStationList`). 활성 후 재프로브로 응답 필드 확정 → 본실행.
- [x] **SafetyProvider 효과**(2026-06-01): 별도 인터페이스 없이 `seedSafetyIndex.ts` v3 로 해소 — `SIGUNGU_SAFETY`
      키를 **5자리 시군구 코드**로 전환(`dong.code.slice(0,5)` 매핑)해 **인천 중구↔서울 중구** 등 동명 자치구 충돌 차단 +
      **경기·인천 57개 점수표**(도시화도·신도시/공단/농촌 성격 합성) 추가 + 수도권 dong 조회. **잔여=`seed:safety` 실행만.**
- 참고: 실거래·ODsay·Kakao(지오코딩/POI)·통계청·R-ONE·LH는 전국 단일 API라 호출부 불변.

---

## 6. ML / 시계열 데이터 정책

- **학습 기간 ≠ 시세 윈도우 분리**: 시세 대표값·affordability는 cutoff −1년(최근 1~2년) 충분.
  ARIMA 학습용으로는 아파트의 긴 시계열 유지.
- **ARIMA(2,1,2) lookback 주의**: 파라미터 4개 → 안정 추정에 관측치 50+ 권장.
  월단위 24개월(2년)은 빠듯 → **최소 36, 안정적으론 48~60개월**. 아파트는 길게 확보.
- **비아파트 예측 부적합**: 단독·다가구=식별이 동 단위(❌), 빌라·오피=식별 가능하나 표본·좌표
  부족(⚠️). → Depth 3는 예측 대신 **시세 분포·동 평가**(`docs/depth3-design.md`). 2년치로 충분.

---

## 7. 2주 일정 (제안 — 조정 가능)

### Week 1 — 기반(쿼터·추상화·코드)
- [ ] §4 ODsay 격자 확대 + 만료 연장 (선행 blocker 해소)
- [ ] §4 업무지구 거점 목록 확정 + 거점 사전적재 배치 스크립트
- [ ] §5 TransitProvider/SafetyProvider 추상화 골격 + TAGO 경기·인천 프로브
- [ ] §3 LAWD 코드 수도권 확장 + 비아파트 지오코딩 파이프 점검
- [ ] (코드) KI-6 점수 분리(score-neutral) — 작은 수정, 이번 사이클 합류

### Week 2 — 적재·검증·Depth3
- [ ] §3 수도권 2년치 실거래 4종 수집(매매·전월세) + 지오코딩 적재
- [ ] §4 거점 통근 매트릭스 배치 적재(분산)
- [ ] §5 TOPIS(서울)·TAGO(경기·인천) provider 적재 + safety 수도권 확장
- [ ] §2 서울 아파트 19년치 콜드 분리(운영 DB 트림 + 파일 덤프)
- [ ] Depth 3 비아파트 "동 상세 평가" 뷰 착수(KI-18)
- [ ] 통합 검증: 수도권 추천 1회 호출 → 점수·시세·estimatedAxes 확인

---

## 8. 우선순위 / 의존성

```
수도권 실거래 수집·지오코딩(§3)  ──▶  POI/safety/transit 재시드(§3·§5)  ──┐
   (ODsay 무관 — 지금 바로 시작)                                          │
                                                                          ▼
ODsay 쿼터 구조개선(§4)  ──선행──▶  수도권 추천 서빙 / Depth3 검증
   (서빙 전까지 갖추면 됨)
```

- **지금 시작**: §3 실거래 수집 + 지오코딩 (ODsay와 독립, blocker 없음).
- **수집과 병행**: §4 ODsay 쿼터 구조개선, §5 provider 골격 — 추천 서빙 전에 완료.
- **수집 후**: 동 universe 확장됐으니 POI/safety/transit 재시드 → provider 적재.
- **마지막**: Depth 3(KI-18) + 통합 검증.

> 즉 **"데이터 먼저"가 정답** — 수집은 막힘이 없고, 그 사이 ODsay·provider를 준비하면 서빙 시점에 맞아떨어진다.

---

## 9. 리스크 / 열린 질문

- TAGO 경기·인천 커버리지 = **가정**. 프로브 전 적재 베팅 금지(서울에서 가정이 틀린 전례).
- 비아파트 지오코딩 품질(건물명 비일관) → 좌표 누락률 모니터링 필요.
- TiDB 유료 전환 시점 — 수도권 + 19년치 동시 보관하려면 트림/콜드분리 선결.
- 거점 스냅으로 인한 통근시간 정확도 손실 허용 범위(격자 크기 튜닝).

---

## 10. KI 연계 현황

- 🟢 KI-8·10·16: 시세 median·반전세·면적제한 — 완료(2026-05-31).
- 🟡 KI-4 생활: 수도권 재시드 **코드 준비**(seedLegalDong+seedPoiSummary capital). 실행만 남음(+명칭매칭 점검).
- 🟢→🟡 KI-5 안전: **코드 완료(2026-06-01)** — 구이름 키 충돌 수정(5자리 코드 키) + 경기·인천 점수표. 잔여=`seed:safety` 실행.
- 🟢→🟡 KI-6 교통: **provider 추상화 코드 완료(2026-06-01)**(TOPIS+TAGO 분기). 잔여=프로브 검증 + `seed:transit`.
- 🟡 **KI-17**: 지역 결합도 / transit·safety **provider 추상화 코드 완료(2026-06-01)** — transitProvider(TAGO+TOPIS) + safety 5자리 코드 키 + 경기·인천 점수표. 잔여=프로브·시드.
- 🆕 **KI-18**: Depth 3 매물종류별 분기 — 비아파트 "동 상세 평가" 뷰(`depth3-design.md`). 빌라·오피 지오코딩 확보로 '건물 시세 카드' 선행조건 충족(이번 세션).
- ℹ️ 데이터: 수도권 LAWD 자동생성 + APT/OFFI/VILLA 2년치 적재·지오코딩(VILLA 진행) 완료 — "세션 산출물" 참조.
