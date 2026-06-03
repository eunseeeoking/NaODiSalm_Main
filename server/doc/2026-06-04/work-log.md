# 작업일지 2026-06-04 (Depth3 스와이퍼·KI-18 P2 + KI-21 서브초화 + TiDB 이관 + main 병합)

## 0. 한 줄 요약
Depth3 매물 **스와이퍼·선택 보더 정상화**(근본 원인 = preflight `button{border:0}` 버그, KI-24)로 시작해,
**Depth3 직접진입/새로고침 견고성**(KI-25)·**KI-18 P2 면적대별 시세 분포 + 반전세 비율**·**UI 정합**(전역 스크롤바·통근 빈 블록 제거)·
**저심각도 보강**(KI-7/19 문서 정정·KI-11/13/14)을 거쳐, **KI-21 추천 서브초화**(사전집계 테이블, 2.7s→~0.42s)를 완성.
마지막에 **로컬 MySQL → TiDB Cloud Serverless 763만 행 이관**(전용 스크립트, ~3.5분, COUNT 완전 일치) 후
**`feat/capital-mvp` → `main` 병합·push**.

> 브랜치: 작업은 `feat/capital-mvp`, 종료 시 **`main` 으로 merge commit(`bb0141a`)·origin push 완료**.
> 참조: `docs/known-issues.md`(KI-7/11/13/14/18/19/21/24/25), `server/doc/tidb-migration.md`(신규), 이전: `work-log-v2.md`.
> 환경: 전부 브라우저 실측(Claude in Chrome) + typecheck(client·server) 통과. 종료 시 dev 서버 내림.

---

## 1. Depth3 매물 스와이퍼 + 선택 카드 보더 (KI-24 근본 해결)

- **스와이퍼**: 브라우저 실측 결과 좌우 드래그/휠 정상(기존 `min-w-0` 수정 유효). 구조/로직 버그 아님.
- **선택 보더 — 진짜 버그 발견**: 그림자/ring 제거하니 선택 카드 보더가 **아예 안 보임**. DOM 측정상
  `border-2 border-brand` 인데 `border-style:none·width 0px`. 원인은 index.css `button{border:0}`(preflight off 시절
  워크어라운드)이 **`border-style:none` 까지 강제** → 요소 선택자(button) 우선순위로 preflight `*{border-style:solid}` 를 덮음.
  그동안 ring(box-shadow)이 보더처럼 보여 잠복. → **`button{border:0}` 제거**(preflight 가 border-width:0 담당). **사이트 전역**.
- **디자인 확정(사용자 요청)**: 그림자/ring/lift 전부 제거, **보더만**(선택 2px·미선택 1px). 음수마진 트릭 불필요 → `px-1 py-1`.
- 검증: 대치동 실DB — 선택 보더 2px·미선택 1px·클릭 이동·좌측 클립 없음.

## 2. Depth3 직접진입/새로고침 견고성 (KI-25)

- **증상 A(DEMO 오인)**: 추천된 실 동(종로구 관수동 등)이 Depth3 에서 DEMO 로 표시. 원인은 `fetchComplexes` 가
  **빈 배열(정상 응답)도 mock 폴백** → APT 단지 없는 상업·오피 밀집 동을 가짜 카드+DEMO 로 메움.
  → **빈 배열은 `source:'api'` 로 처리**, mock 은 진짜 API 오류 때만. (교남동 실DB: DEMO 소거·4축/시세 실데이터 정상.)
- **증상 B(새로고침)**: Depth3 새로고침 시 "존재하지 않는 지역". 원인은 `useRecommendationStore` 비영속 →
  `recommendations`·`workplace` 소실. → **zustand `persist`(sessionStorage, partialize=입력+결과)** 적용. 동기 rehydrate(깜빡임 없음).
- **잔여(콜드 진입 갭)**: 공유 링크를 다른 브라우저로 콜드 진입하면 여전히 실패 → `/detail` 폴백 region 구성 후속(미착수).

## 3. KI-18 Phase 2 — 면적대별 시세 분포 + 반전세 비율

- **#1+#4 면적대별 시세 분포**: 소/중/대(전용 9~60·60~85·85~330㎡ 반개구간) median 분리.
  - 서버 `fetchDongAreaTierPrices` — `fetchRepresentativePrices`/`fetchRentCostByRegion` 에 **면적 밴드 파라미터**
    (기본 9~330=핫패스 무변경)만 주입해 KI-8/10/16 규약 재사용. `/detail.priceByTier` 추가.
  - 클라 `AreaTierBars` — 거래유형별 막대(매매가/전세보증금/순수월세 median·표본칩·값없는 구간=표본 부족).
  - 실DB(대치동): 매매 소4.2/중36.5/대46억, 전세 7.2/8/15.5억(표본 216/985/576).
- **#2 반전세 비율 라벨**: KI-10 은 반전세(준전세, `월세 < 보증금×RATE`)를 통계에서 제외만 → 그 **비율을 노출**.
  `fetchDongSemiJeonseRatio` → `/detail.semiJeonseRatio` → 캡션. 실DB(대치동): 월세 2,627건 중 1,062건=**40%**.
- **#3 빌라·오피 건물 시세 카드**: 설계상 "보류·MVP 포함 미정" → 미착수.

## 4. UI 정합

- **전역 세로 스크롤바 통일**: `*::-webkit-scrollbar` 폭 8px·둥근 pill·**상하 화살표 제거** + Firefox `scrollbar-width:thin`.
  클래스 규칙(`.scroll-x-slider`=숨김·`.scroll-x-thin`=3px)은 specificity 로 우선. 중복 `.scroll-x-slider` 정의 1벌 제거.
- **Depth3 통근 비교 빈 블록 제거**: 단지 좌표 없거나 직장 미설정 시 빈 안내 대신 **블록 자체 생략**, 분석 카드 `md:col-span-3` 전체 폭. `EmptyCommute` 삭제.

## 5. 통근 정확도 문서 정정 (KI-7/19)

- 기존 "Depth2 랭킹 전부 Haversine / ODsay 배제" 표현은 **과장**임을 코드로 확인·정정.
  - **표시값**: 추천 후 클라(MapPanel)가 top-8 에 `/api/commute/matrix`(ODsay) 호출 → `commuteOverrides` → 카드/지도 **실측 교체**.
  - **랭킹/게이트**: `fetchRegionCandidates` 가 dong별 `findCachedMatrix`(t_commute_matrix) hit=실측, miss=Haversine. **cold 동만** 추정.
  - **격자**: 3자리(≈110m)+3×3 KNN **이미 완료**. §4 거점 사전적재는 쿼터 대비 저ROI → **보류 결정**(오피·빌라 정밀 지오코딩 불가인 동 단위 추천 컨셉상 현 수준 적정).

## 6. 저심각도 보강 (KI-13/11/14)

- **KI-13**: 소득 미입력 시 "소득 미입력 — 3분위(403만원) 기준으로 주거비 부담을 추정 중" 안내(보강).
- **KI-14**: 연 전환율·전세가율을 **env 갱신 가능**하게(`JEONSE_CONVERSION_RATE_ANNUAL`·`JEONSE_PRICE_RATIO`, 기본값 동일=점수 불변).
- **KI-11**: 저표본(5~9건) 전월세 동 affordability **신뢰 보정 0.94~1.0**(rent 기반만, 게이트 아닌 가중). 실측: 표본 7·11건 동 top-8 잔존하되 소폭↓.

## 7. ⭐ KI-21 — 추천 서브초화 (사전집계 summary)

worst-case 추천이 매 요청 raw 거래 median 을 재계산하던 본질 한계 해소.

- **스키마**: `t_dong_price_summary`(동 × 거래유형 × 매물종류조합 별 median·표본). `prisma db push` 적용.
- **median 합산 불가 해결**: **전 조합 사전집계**(JEONSE/MONTHLY 각 15 + SALE 7) → 임의 종류 선택도 정확 조회.
  `seedDongPriceSummary.ts`(`npm run seed:price-summary`) — 동별 raw 거래 1스캔 후 JS 로 조합 median 계산(SQL 윈도우 규약 1:1).
  **41,214행 / 2,344동**.
- **런타임**: `fetchRepresentativePrices`/`fetchRentCostByRegion` 가 **전체 면적 경로만**(`areaFilter===FULL_AREA_FILTER`)
  summary 우선 조회(`fetchSaleSummary`/`fetchRentSummary`) → **미적재 동만 live 폴백**(정합·견고). 면적대별은 live 유지.
- **검증**: 강남역 JEONSE/SALE/MONTHLY patience75 전부 **~0.42s warm(기존 2.7s, ~6배↑)** + 결과 live 동일(쌍림동 96/표본7·석촌동 91/849). 브라우저 E2E OK.
- **재시드 조건**: cutoff(최신 거래일)·환산율(RATE) 변경 시 재실행(cost_median 이 RATE 의존).

## 8. 로컬 MySQL → TiDB Cloud Serverless 이관

- 기존 HeidiSQL SQL 재생(단일 커넥션·작은 배치)이 느려 전용 도구 작성.
- **`scripts/exportToTidb.ts`**(`npm run export:tidb`): 배치 multi-row INSERT + 병렬 커넥션, DATETIME 문자열 이관,
  FK/unique 체크 off, `--truncate/--tables/--exclude/--batch/--concurrency`. mysql2 devDep.
- **절차**: ① `prisma db push`(TiDB, 옛 `raw_payload` 정리·새 테이블 포함) ② `export:tidb --truncate` ③ COUNT 대조.
- **결과**: **7,630,321행 / 25테이블 / 207초(~3.5분)**, 양쪽 COUNT(*) **완전 일치**. apt_rent 3.67M·apt_trade 1.74M.
- 가이드: `server/doc/tidb-migration.md`. 비밀은 `.env`(gitignore)에만.

## 9. 브랜치 병합

- `feat/capital-mvp`(17커밋) → `main` **merge commit `bb0141a`**(충돌 없음, main 의 `client/index.html` 타이틀 수정과 비충돌).
- **origin/main push 완료**(`5d6b296..bb0141a`). feat 브랜치는 로컬 유지.

---

## 10. 변경 파일 (이번 세션)

**서버**: `services/repositories/recommendationRepository.ts`(면적밴드·반전세·KI-21 summary fast-path) ·
`services/recommendation/scoring.ts`(KI-11/14) · `routes/domains/regions.ts`(priceByTier·semiJeonseRatio) ·
`prisma/schema.prisma`(t_dong_price_summary) · `scripts/seedDongPriceSummary.ts`(신규) · `scripts/exportToTidb.ts`(신규) ·
`package.json`(mysql2·seed:price-summary·export:tidb) · `doc/tidb-migration.md`(신규)
**클라**: `pages/RegionDetail/{index.tsx, components/{ComplexCardList, RegionDetailEvaluation}.tsx}` ·
`pages/Recommendation/components/WeightSliders.tsx` · `api/regionDetail.ts` · `stores/useRecommendationStore.ts` ·
`types/region-detail.ts` · `css/index.css`
**문서**: `docs/known-issues.md`(KI-7/11/13/14/18/19/21/24/25) · `docs/depth3-design.md`

**커밋**: `f78c148`(스와이퍼+KI-18 P1 체크포인트) · `7ec91b4`(견고성/면적대별·반전세 + UI·정확도) ·
`23f5871`(KI-21 서브초화) · `92fdc2b`(TiDB 도구) · `bb0141a`(merge→main).

---

## 11. 다음 세션 출발점

1. **KI-25 콜드 진입 갭**: 공유 링크 새 브라우저 진입 시 `/detail` 응답으로 최소 region 폴백 구성(개인화 점수는 미상 처리, dong centroid lat/lng 필요).
2. **KI-18 Phase 2 #3**: 빌라·오피 "건물 시세 카드"(설계 §6 보류) — MVP 포함 여부 결정부터.
3. **preflight 회귀**: `button{border:0}` 제거가 전역 → 전 화면 1회 점검 + 남은 `border-0`·수동 마진 정리(KI-24 잔여).
4. **운영 루틴**: 실거래 재적재 → `seed:price-summary`(로컬 재집계) → `export:tidb --truncate`(TiDB 갱신) 순서 준수.
