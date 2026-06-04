# 인계 문서 — SALE(매매) 경로 재고 게이트 (KI-24 후속)

> 한 줄: **전월세에 적용한 KI-24 "재고 게이트"를 매매(SALE)에도 적용**한다. 현재 매매는 아직
> *동 매매 중위값 > 예산 → 제외*(중위값 블라인드)라, 비싼 동에 감당 가능한 매물이 실재해도
> 통째로 빠진다. 전월세에서 고친 바로 그 문제가 매매엔 남아 있음.

작성: 2026-06-05 · 선행 작업: [work-log-v2.md](../2026-06-04/work-log-v2.md) (KI-24 본체)
상태: **미착수(설계만)**. 브랜치 `feat/KI-24-inventory-gate`.

---

## 1. 문제 (왜 하는가)

KI-24는 전월세에서 "동 보증금 *중위값* 게이트"를 "예산 이하 실거래 ≥5건이면 후보 유지"로
바꿔, 미사 신축이 끌어올린 중위값 때문에 하남 1억 전세가 통째로 빠지던 문제를 고쳤다.

**매매(SALE)는 아직 안 고쳐짐.** 현재 게이트:

```ts
// recommendationRepository.ts  (메인 루프, 대략 line 1194~1196)
if (dealType === 'SALE') {
  if (price == null) continue;                         // 매매 거래 없는 동 제외
  if (price > budget) { budgetFilteredBreakdown.salePrice++; continue; }  // ← 중위값 게이트
}
```

`price` = `fetchRepresentativePrices` 가 준 **동 매매 median**. 비싼 신축이 median을 끌어올린 동은
감당 가능한 구축·소형 매물이 수십 건 있어도 제외된다(전세 하남 사례의 매매판).

---

## 2. 현재 코드 지형 (건드릴 곳)

모두 `server/` 기준.

| 위치 | 역할 | 현재 한계 |
|---|---|---|
| `src/services/repositories/recommendationRepository.ts` `fetchRepresentativePrices` (≈ line 390~466) | 동 매매 median 산출. `fetchSaleSummary`(KI-21 저장 `sale_median`) 우선 + 미적재 동 live 폴백 | **median만** 반환(`Map<key, number>`). 표본수·감당구간 없음 |
| 같은 파일 `fetchSaleSummary` (≈ line 243~261) | `t_dong_price_summary` 에서 `sale_median` 조회 | 히스토그램·표본수 없음 |
| 같은 파일 메인 루프 SALE 분기 (≈ line 1194~1196) | `price > budget → 제외` | 중위값 게이트(이번에 교체할 대상) |
| `scripts/seedDongPriceSummary.ts` `computeDong` SALE 블록 (line 135~147) | 동별 매매 raw `prices[]` 로 `saleMedian`+`sampleCount` 적재 | **이미 raw prices 보유** → 히스토그램화 쉬움 (`buildHistogram` line 52 참고) |
| `prisma/schema.prisma` `DongPriceSummary` (line 475~495) | 사전집계 테이블. `depositHistogram Json?` 있음 | `salePriceHistogram` 없음 |

참고 — 전월세 KI-24 구현(그대로 미러링하면 됨):
- `affordableFromHistogram` (line 271~299): 보증금 히스토그램 → 예산 이하 버킷 합산(건수·median).
- `rentQueryBudget` (line 703~738): live 예산 경로 — `SUM(CASE WHEN aff THEN 1) AS sample_count`,
  `COUNT(*) AS total_cnt`, `AVG(CASE WHEN aff THEN price) AS median`. **재고 게이트(≥5)와 '숨김'
  (전체≥5·감당<5) 분기는 JS 파싱(line 746~766)에서.**
- `fetchRentSummary` (line 309~366): summary(히스토그램) 우선 + `coveredKeys` 로 미커버 동만 live.

---

## 3. 두 가지 구현안 (이번 세션 미결 — 사용자 결정 필요)

### 안 A — 히스토그램 (KI-24와 동일, 서브초) ※ 권장
전월세와 동일 구조. 일관성·성능(서브초) 확보.

1. **스키마**: `DongPriceSummary` 에 `salePriceHistogram Json? @map("sale_price_histogram")` 추가.
   - 마이그레이션 파일은 ②와 동일 패턴: `ALTER TABLE t_dong_price_summary ADD COLUMN sale_price_histogram JSON NULL;`
     → `db push` 후 `migrate resolve --applied`, 또는 신규 환경은 `migrate deploy` 가 적용.
2. **seed** (`seedDongPriceSummary.ts`): SALE 블록에서 `prices[]` → 히스토그램 적재.
   - 버킷: 매매가는 수억~수십억이라 `HIST_BUCKET_MANWON`(500만)이면 버킷이 과다(40억=800버킷, sparse라
     동작은 하나 비효율). **별도 `SALE_HIST_BUCKET_MANWON`(예: 2500~5000만)을 `scoring.ts` 공용 상수로**
     추가해 seed·런타임 정합 유지 권장.
   - `buildHistogram` 은 `{deposit, monthly}` 용 → sale용 `[idx, n, sumPrice, 0]` (idx=floor(price/SALE_BUCKET)) 만들면 됨.
3. **런타임**:
   - `affordableFromSaleHistogram(hist, budget)` → 예산 이하 버킷 합산: `n`(감당 건수)·`affordableMedian≈sumPrice/n`. 게이트 `n<5 → null`.
   - `fetchSaleSummary` 예산 인지 버전: 히스토그램 있으면 위로 산출 + `coveredKeys`; 없으면 미커버(live 폴백).
   - `fetchRepresentativePrices` 가 **표본수도 반환**하도록 확장(현재 `Map<key, number>` → `Map<key, {price, sampleCount}>` 또는 병렬 맵). 메인 루프·`budgetExcluded` 산출에 필요.
   - 메인 루프 SALE 분기: `price>budget 제외` → **감당 표본<5 제외(전체≥5면 `salePrice++`)** + `representativePrice = affordableMedian`.
   - live 폴백: `rentQueryBudget` 의 매매판(trade 풀, `price_manwon <= budget` CASE WHEN). `tradeSource`/`tradeUnion`(line 428) 재사용.
4. **재적재**: `npm run seed:price-summary` 재실행(`deleteMany` 동안 summary 잠깐 비어 추천 일시 느려짐 → 저트래픽 시간). **prod DB도 재적재 필요.**

비용: 스키마+seed+런타임+재적재 + (선택)카드 칩. prod 데이터 재적재 동반.

### 안 B — live 우선 (가벼움, 나중에 히스토그램 최적화)
스키마·seed 무변경. 런타임에서만 예산 인지 live 집계.

- `fetchRepresentativePrices` 예산 활성 시 KI-21 `sale_median` summary 우회하고 **전 후보 동 live 집계**
  (감당 건수·감당 median·전체 건수). `rentQueryBudget` 매매판을 직접 사용.
- 장점: 작음, prod 재적재 없음. 단점: **SALE+예산 경로가 수초로 느려짐**(전월세 히스토그램 전 2.85s 수준).
  매매는 비기본 경로(기본 JEONSE)라 빈도 낮음 → v1 허용 가능, 추후 히스토그램(안 A 3·4)으로 승격.

권장: **안 A**(전월세와 동일 서사·성능). 재적재 부담이 크면 **안 B로 먼저 출시 후 A로 최적화**.

---

## 4. 파급(잊지 말 것)

- **점수(scoring)**: SALE affordability 는 `representativePrice` 기반. 게이트 통과 동의 대표가가
  *감당 구간 median* 으로 바뀌면 affordabilityScore·RIR 도 그 값 기준 → 의도된 변화(전세와 동일 논리).
- **카드 "예산 내 N건" 칩**: 현재 칩은 `isRentBasis`(rent) 일 때만 노출. SALE 은 `affordabilityBasis='sale-proxy'`,
  `rentSampleCount=null` → **SALE 에선 칩이 안 뜸**. SALE 에도 "예산 내 N건"을 보이려면:
  - 서버: 매매 감당 표본수를 새 필드(예: `saleSampleCount`)로 응답에 추가(`recommendations.ts` 라우터 + repository).
  - 클라(`RegionCard.tsx`): 칩 조건을 rent 전용에서 "예산 활성 + (rent or sale 감당표본)"로 확장.
  - **별도 소작업으로 분리 가능** — ③ 서버 게이트부터 먼저, 칩 확장은 후속.
- **`budgetFilteredBreakdown.salePrice`**: 이미 존재(매매 숨김 카운트). 재고 게이트로 의미가
  "감당 표본<5(전체≥5)"로 바뀜 — KI-12 분리 안내 문구는 그대로 호환.
- **회귀**: 예산 미지정 SALE 경로는 **불변**(KI-21 `sale_median` 그대로) 보장할 것. `budgetActive` 분기로만 새 경로 진입.

---

## 5. 검증 시나리오 (구현 후)
- `scripts/sanityRecommend.ts` 에 SALE+예산 시나리오 추가(예: 강남 직장, 매매 예산 8억) →
  비싼 동(예: 대치)이 *감당 구간(8억 이하) 매물 ≥5* 면 등장하는지, 숨김 카운트가 합리적인지 콘솔 확인.
- 회귀: 예산 미지정 SALE 결과가 수정 전과 동일(점수·순위)한지 대조.
- 성능(`REC_DEBUG=1`): 안 A=서브초, 안 B=수초(허용 여부 판단).

---

## 6. 함께 남은 자잘한 후속 (이번 세션에서 발견)
- **④ 검증**: MONTHLY+월세한도 폴백 수정(commit `3dc26f1`)은 실데이터 sanity 미실행 — 배포 전 확인.
- **② prod 마이그레이션**: prod DB가 로컬(`127.0.0.1:3306`)과 다른 별도 DB면 prod에도
  `migrate resolve --applied 20260604120000_add_deposit_histogram` 필요(중복 컬럼 에러 방지). 배포 전 토폴로지 확인.
- **카드 시각 확인**: "예산 내 N건"(brand) 칩 + LH 마이홈 지도찾기 링크 dev 서버 육안 확인 미실행.
