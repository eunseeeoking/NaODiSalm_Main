# 2026-06-04 Work Log v2 — KI-24 예산 필터 재설계(재고 게이트) + 사전집계 + 점수엔진 테스트

> 핵심 한 줄: **예산 필터를 "동 중위값 게이트" → "재고(inventory) 게이트"로 재설계**해, 동 중위가
> 비싸도 *감당 가능한 매물이 실재하는* 동네를 추천하도록 고침. 개발자 본인의 실제 이사 스토리
> (인천→하남 1억 전세)로 발견·검증. 성능은 보증금 히스토그램 사전집계로 서브초 복구.

---

## 0. 배경 — 어떻게 발견했나

자기 검증(직장 좌표 입력 → 추천 → 사람 직관과 대조) 중, **개발자 본인의 실제 선택을 서비스가 추천하지
못하는** 사례 발견:

- 실화: 인천에서 하남으로 출퇴근하다 동료 입소문("하남 1억 전세면 살 수 있다")으로 하남 오피스텔 이주.
- 그런데 직장=하남 / 예산=1억 전세로 추천을 돌리면 **하남이 0개**, 대신 47분 거리 성북구 안암동이 1위.

원인 추적 → 데이터로 확정:

| 하남 동(전세) | 1억 이하 실거래 | 감당구간 평균 | 동 중위값 |
|---|---:|---:|---:|
| 덕풍동 | 235건 | 0.62억 | 3.46억 |
| 망월동 | 161건 | 0.91억 | 4.00억 |
| 신장동 | 131건 | 0.69억 | 3.69억 |

→ 1억 이하 매물이 **수백 건 실재**하는데, 예산 필터가 **동 보증금 *중위값*(미사 신축 아파트 전세 3~4억이
끌어올림)** 기준으로 동을 통째 제외하고 있었음([recommendationRepository.ts] 구 `rentStat.depositManwon > budget`).
즉 입소문이 전하는 "여기 1억짜리 있어"라는 *감당 가능 매물의 존재* 신호를, 중위값 필터가 지워버림.
서비스가 대체하려는 입소문을 가장 못하는 지점이었음.

---

## 1. KI-24 — 예산 필터: 중위값 게이트 → 재고 게이트

### 정책 변경
- 구: `동 보증금 중위값 ≤ 예산` 이면 후보 유지 (분포 무시)
- 신: **`예산 이하 실거래 ≥ 5건` 이면 후보 유지** + 그 *감당 가능 구간* 시세로 affordability 평가
- 카드 표기 정책(사용자 결정): **감당구간 시세 + "예산 내 N건" 칩** (입소문의 디지털화)

### 구현 (`server/src/services/repositories/recommendationRepository.ts`)
- `fetchRentCostByRegion(..., budgetOpts, outStats)` — 예산 인지형으로 확장.
  - 예산 지정 시: 예산 술어를 집계에 반영해 **median/표본수가 자동으로 '감당 구간' 값**이 되고,
    `HAVING/표본<5` 가 곧 재고 게이트가 됨.
  - **'예산으로 숨김' 카운트(전체 ≥5 이나 감당 <5)** 를 같은 패스에서 산출(`outStats.budgetExcluded`)
    → 별도 스캔 쿼리 불필요.
- 예산 미지정 경로는 **완전 동일**(하위호환): KI-21 사전집계 median 그대로.
- gate 위치: 감당 표본 <5 동은 `rentStat` 없음 → 기존 `if (!rentStat) continue` 가 재고 게이트 역할.

### 검증 결과 (하남 직장 · 1억 전세)
- 수정 전: 후보 5개, 하남 0개, 1위 성북 안암동(47분)
- 수정 후(전체 4종): 후보 135개, 하남 3개 — 신장동(6분·1위)·덕풍동(8분)·**망월동(13분·5위)**
- 수정 후(오피스텔만, 본인 실제 선택): **하남 4개**(신장·덕풍·망월·풍산), 망월동 3위

```
📍 인천→하남 출퇴근자, 1억 전세 [오피스텔(OFFI)만 — 실제 선택]
   후보 25개 · 예산(1억)초과 숨김 222개
 1. 하남시 신장동  82  6분  통71 주100 안68 생81  월27만  ← 하남!
 2. 하남시 덕풍동  80  7분  통70 주 98 안65 생77  월32만  ← 하남!
 3. 하남시 망월동  78 13분  통64 주100 안63 생81  월35만  ← 하남!
 4. 강동구 강일동  76 16분
 5. 강동구 길동    76 21분
 6. 하남시 풍산동  75 12분  ...                            ← 하남!
 🏠 TOP 8 중 하남 4개
```

### 보너스 — 기존 미해결 이슈도 같이 해결
판교 직장(전세 3억)에서 **분당 핵심(수내·정자·서현·분당동)이 안 뜨던 문제**도 같은 재고 게이트로 해결
(분당 핵심도 예산 내 매물 다수 보유 → 등장). 후보 233→400, 숨김 261→34.

### 회귀(regression) 확인
- 강남(예산 없음, 월세): 수정 전과 **결과·점수 100% 동일** (하위호환 확인)
- 여의도(전세 3.5억): 정상, 대방·도화·신길 추가로 더 풍부

---

## 2. 성능 — 회귀 → 사전집계로 서브초 복구

재고 게이트 도입 시 예산 경로가 KI-21 사전집계를 우회하고 live 집계를 돌려 느려짐. 단계적 개선:

| 단계 | warm 지연 | 비고 |
|---|---|---|
| 윈도우 median live | 4.7s | 윈도우 함수(ROW_NUMBER ×N) 병목 |
| + 중복 '숨김' 카운트 쿼리 제거 + AVG 집계 | 2.85s | 한 패스 조건부 집계로 통합 |
| **+ 보증금 히스토그램 사전집계 (KI-24, 활성화 후)** | **서브초(목표)** | live 스캔 0회 |
| (참고) 예산 없음 경로 | 0.4s | KI-21 summary, 불변 |

### 사전집계 설계 (활성화 시 서브초 복구)
동별로 **보증금 히스토그램**(500만 버킷: 버킷별 건수·보증금합·월세합)을 `t_dong_price_summary`에 저장.
런타임은 summary 조회 후 "예산 이하 버킷 합산"으로 감당구간 건수·시세를 **JS로 즉시 계산(live 스캔 0)**.

- `prisma/schema.prisma` — `DongPriceSummary.depositHistogram Json?` 컬럼 추가
- `scripts/seedDongPriceSummary.ts` — seed가 이미 동별 raw를 메모리에 들고 있어 **추가 쿼리 0개**로 히스토그램 생성
  (`HIST_BUCKET_MANWON = 500`, JEONSE/MONTHLY 둘 다)
- `src/services/recommendation/scoring.ts` — `HIST_BUCKET_MANWON` 공용 상수(seed·런타임 정합)
- `recommendationRepository.ts` — `fetchRentSummary`가 예산 지정 시 히스토그램에서 감당구간 산출
  (`affordableFromHistogram`), 히스토그램 보유 동은 `coveredKeys` 기록 → **미커버(구버전·미적재) 동만 live 폴백**
  → 활성화 후 점진적/무중단(컬럼 추가는 additive).

### 히스토그램 정확도 검증 (하남 실데이터)
| 동 | 히스토그램 | 직접계산(정답) | 판정 |
|---|---|---|---|
| 망월동 | 92건·0.89억 | 109건·0.91억 | 게이트·랭킹 불변 |
| 신장동 | 70건·0.62억 | 82건·0.68억 | 동일 |
| 덕풍동 | 131건·0.58억 | 143건·0.62억 | 동일 |

경계 버킷 반올림 차이는 있으나 **게이트(≥5)·랭킹 결과는 불변** — 하남 동들 동일하게 등장.

---

## 3. 점수엔진 단위테스트 (신규)

`src/services/recommendation/scoring.test.ts` — **vitest 36 케이스, 전부 통과**.
명세(주석)에서 기대값을 독립 손계산해 박음 → 구현 회귀 시 즉시 빨간불.

- 커버: `inverseLinear`/`forwardLinear` 경계, `commuteScore`(patience 15분 floor·TAGO 가중합),
  `calcRir`(소득 0 방어), `affordabilityScore` 경계, 안전·생활 클램프,
  **동적 가중치 제외**(estimatedAxes·effectiveWeightSum), 저표본 신뢰계수, `pickTopRegions` 정렬·동점 tie-break
- 실행: `cd server && npm test` (watch: `npm run test:watch`)
- `package.json` 에 `test`/`test:watch` 스크립트 추가, `vitest` devDependency 추가

---

## 4. 변경 파일

```
 M server/package.json                                   # vitest + test 스크립트
 M server/prisma/schema.prisma                           # depositHistogram 컬럼
 M server/scripts/seedDongPriceSummary.ts                # 히스토그램 생성
 M server/src/services/recommendation/scoring.ts         # HIST_BUCKET_MANWON
 M server/src/services/repositories/recommendationRepository.ts  # 재고 게이트 + 히스토그램 경로
 ?? server/src/services/recommendation/scoring.test.ts   # 단위테스트 36
 ?? server/scripts/sanityRecommend.ts                    # 직관 검증(판교/강남/여의도)
 ?? server/scripts/sanityRealStory.ts                    # 하남 실화 재현 검증
 ?? server/scripts/protoInventoryFilter.ts              # 재고 게이트 프로토타입(검증용)
```

상태: 전부 **working tree(미커밋)**. 운영 서버 영향 없음.

---

## 5. 활성화 절차 (TODO — 운영 DB 작업, 저트래픽 시간 권장)

> ⚠️ **순서 중요**: 마이그레이션(컬럼 추가)이 코드 배포보다 **먼저**.
> 컬럼 없으면 summary 조회가 에러→live 폴백(느려짐). 활성화 전까지 예산 추천은 live 폴백으로 정확히 동작.

```bash
# 1. dev 서버 끄기 (prisma query engine DLL 잠금 해제 — 안 끄면 2번이 EPERM)
# 2. 컬럼 추가 + 클라이언트 재생성
cd server && npx prisma db push
# 3. 히스토그램 재적재 (수 분; deleteMany 동안 summary 잠깐 비어 추천 일시 느려짐 → 저트래픽 시간)
npm run seed:price-summary
# 4. 확인 — 하남 등장 + 서브초
npx tsx scripts/sanityRealStory.ts
```

검증 시 ODsay 미사용(통근은 캐시+Haversine), 운영 prod 무영향.

---

## 6. 남은 작업 (선택)

- [ ] **활성화 4단계 실행** (위 5장) — 서브초 복구
- [ ] **클라이언트 카드 "예산 내 N건" 칩** 라벨 — 서버는 준비됨(rentSampleCount=감당구간 건수), 화면 반영 필요
- [ ] 커밋 (현재 `main` 직접 작업 → 브랜치 분리 후 커밋 권장)
- [ ] (후속) SALE(매매) 경로도 재고 게이트 적용 — 현재는 매매 중위값 게이트 유지
- [ ] (후속) MONTHLY + 월세 한도(monthlyBudget) 지정 시 히스토그램이 보증금만 커버 → live 폴백(드묾)

---

## 7. 2차 발표 활용 포인트

- "서비스를 **내 인생으로 검증**했더니 내가 실제 만족하며 사는 집(하남 망월동)조차 추천 못 했다.
  중위값 필터가 감당 가능 매물의 존재를 지웠기 때문. → 재고 기반 추천으로 *'그 동네에 네가 살 집이 있다'*는
  입소문 신호를 데이터로 복원."  ← 독창성(개선·발전)+구체성(논리)+성장성(실증 고도화) 동시 타격
- "핵심 점수엔진은 36개 경계값 단위테스트로 검증" ← 구체성(논리적 도출)
- 만들고→검증하고→한계를 직접 찾아→고치는 **진짜 빌더 서사**
