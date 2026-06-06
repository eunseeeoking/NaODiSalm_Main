# 작업 로그 — 2026-06-07 (Depth 3 정직성 UX + 실거래 원본 노출 + 추천↔상세 정합성 픽스)

## 한 줄 요약

> **ML 가격예측 한계 규명(별도 ML 세션)에서 출발 → 제품 UX의 "과신·공포" 요소를 정직화.** ① 추천은 빌라 매매시세로 점수 내는데 Depth 3는 아파트만 표시해 "추천 1위지만 단지 없음" 깨지던 정합성 버그 픽스(`SALE_TRADE_TYPES → ['APT']`), ② Depth 3 차트 4종 정직화(가짜 LSTM 평면선 제거 · 공포 유발 `-22%` → 정성 "가격 흐름" · 신뢰도 평어 번역 · 저신뢰 추정톤), ③ 실거래 원본 모달 신설(선택 도우미: 판단 대행 ❌, 원본 데이터 그대로 노출). typecheck 양측 EXIT:0 + 서버 health/엔드포인트 curl 실측 확인.

---

## 0. 진입 컨텍스트

- 병행 ML 세션: NaODiSalm_ML 에서 "LSTM은 왜 ARIMA에 졌나"를 2×2 통제실험으로 규명 → **36개월 정밀 매매가 예측은 비현실적, ARIMA(≈MA-12)도 추세추종 천장(~8%)일 뿐**임을 입증. (상세: ML 레포 `README.md` "실험 — LSTM은 왜 졌나")
- 그 통찰이 제품으로 역류: 사용자 QA 중 "Depth 3 차트가 `-22%`로 자산 폭락 공포를 줌 / ARIMA·LSTM 용어 난해 / LSTM 선이 평면" + "수원 매매 추천 1위인데 단지 없음" 보고.
- 본 세션: 정합성 버그 픽스 → 차트 정직화 → 실거래 원본 노출.

---

## 0.5 working tree 정리 (★ 미커밋이 많은 이유)

현재 Main 미커밋은 **두 갈래가 섞여 있음** — 커밋 시 논리 단위로 분리 권장.

```
① ML 피처 데이터 수집 (2026-06-06, 별도 세션 — 자체 문서 보유)
   M  server/.env.example                         (ECOS 키)
   M  server/package.json                         (seed:macro-rate/econ/housing-supply)
   M  server/prisma/schema.prisma                 (+t_macro_rate/t_macro_econ/t_housing_supply)
   M  server/scripts/geocodeComplexes.ts          (APT 좌표 백필)
   M  server/src/services/external/rebClient.ts   (+fetchRebRawSeries)
   ?? server/prisma/migrations/20260606000000_add_ml_feature_tables/
   ?? server/scripts/seedHousingSupply.ts | seedMacroEcon.ts | seedMacroRate.ts
   ?? server/src/services/external/ecosClient.ts
   ?? server/doc/2026-06-06/ml-feature-data-{handoff,RESULT}.md   ← ①의 상세는 이 문서들 참조

② 이번 세션 (2026-06-07, 본 work-log 대상)
   M  server/src/services/repositories/recommendationRepository.ts   (SALE 정합성)
   M  server/src/routes/api.ts                                       (complexes 마운트)
   ?? server/src/routes/domains/complexes.ts                         (실거래 엔드포인트)
   M  client/src/pages/RegionDetail/components/LstmFullAnalysis.tsx  (차트 정직화)
   M  client/src/api/regionDetail.ts                                 (fetchComplexTrades)
   M  client/src/types/region-detail.ts                             (ComplexTrade)
   ?? client/src/pages/RegionDetail/components/TradeHistoryModal.tsx (실거래 모달)
```

> ①은 ML 다변량 실험용 거시·공급 데이터 적재(서울25구 미분양 + 전국 금리/CPI/M2). 제품 런타임은 아직 소비 안 함 — 커밋해도 회귀 위험 0. ②와 별개 커밋으로 묶으면 히스토리가 깨끗.

---

## 1. 추천 ↔ 상세 정합성 픽스 (수원 팔달구 장안동 "단지 없음")

### 1.1 재현 (사용자 QA)

```
직장 수원화성 / 매매 / 예산 1.5억 / 인내심 45 / 직장인 프리셋
→ 추천 1위: 수원 팔달구 장안동
→ Depth 3 진입: "등록된 단지가 없습니다."
→ 의구심: 매물 없는데 매매 랭킹 1위?
```

### 1.2 진단 (DB 실측)

```
수원 팔달구(41115) 장안동:
  t_dong_price_summary SALE  type=VILLA  sale_median=9000만  n=2   ← 빌라 2건이 출처
  아파트 단지        0
  아파트 매매거래     0
  빌라 단지          2
```

근본 원인 — **추천 universe 와 상세 표시 범위 불일치**:

```
recommendationRepository.ts:58  SALE_TRADE_TYPES = ['APT','OFFI','VILLA']
  → fetchRegionAggregates 가 이 종류들의 complex 테이블을 UNION 해 후보 동 universe 구성
  → 빌라만 있는 장안동도 universe 진입 → 빌라 9천만 SALE median → 예산 1.5억에 초저렴 → 1위
regions.ts:58 (주석)  "단지 카드는 APT/SALE 만. VILLA/OFFI 는 Phase 3 까지 비활성"
  → Depth 3 는 prisma.aptComplex 만 조회 → 장안동 아파트 0 → "등록된 단지 없음"
```

### 1.3 픽스 (1줄)

```typescript
// recommendationRepository.ts:58
- const SALE_TRADE_TYPES = ['APT', 'OFFI', 'VILLA'];
+ const SALE_TRADE_TYPES = ['APT'];   // 상세가 APT-only(Phase 3까지)이므로 추천 universe 도 APT 로 정합
```

- 효과: 아파트 매매 없는 동은 매매 랭킹에서 제외 → "추천됐는데 단지 없음" 소멸. 아파트 있는 동은 정상.
- 새 결정 아님 — 이미 "아파트만(Phase 3까지)"으로 정해진 상세 스코프에 스코어링을 맞춘 것.
- `SALE_TRADE_TYPES` 6개 사용처(universe/price/scoring) 전부 SALE 경로라 일괄 APT 정합. JEONSE/MONTHLY 무영향.
- 주석에 재현 사례 + Phase 3 복원 조건(`['APT','OFFI','VILLA']`) 명시.

---

## 2. Depth 3 차트 정직화 (LstmFullAnalysis.tsx, 4종)

### 2.0 진단 (arima.ts 정독)

```
[a] "LSTM 변동성" 선이 평면(현재가에 평평)
    arima.ts 는 LSTM 데이터를 1도 안 만듦. 라이브 LSTM 은 2026-05-25 폐기.
    → 차트의 LSTM 선 = client mockLstmResults 의 장식선(잔재). "아무것도 안 함" 오해.

[b] "3년 변동성 -22%" 공포
    arima.ts: annualRate = clamp(MIN_ANNUAL=-8%, ...); predicted3y = current*(1+rate)^3
    → 하락 단지는 -8% 하한에 클램프된 뒤 3년 복리 = 0.92³ = -22.1%
    → "허용된 최악 기울기의 세제곱" = false precision. 게다가 라벨도 틀림(변동성 아닌 변동률).
    → 제품 원칙("투자 수익률 표현 제거")을 UI 가 스스로 위반.

[c] 신뢰도 50~88 불투명
    confidence = clamp(50, 88, 50 + r2*30 + min(n,24)/24*15)
    → floor 50 때문에 R²=0.12(엉망 적합)도 57 → "절반 넘게 신뢰"처럼 보임. 숫자가 행동 가이드 안 됨.
```

### 2.1 가짜 LSTM 평면선 제거

```
- lstmForecasts useMemo (109~124) 삭제
- datasets 의 'LSTM 변동성' dataset 스프레드 (174~186) 삭제
→ 범례도 "과거 실거래 / ARIMA 예측"만. LSTM 가치는 백테스트 연구 서사로 이전.
```

### 2.2 공포 숫자 → 정성 "가격 흐름" (거주 프레임)

```typescript
function trendLabel(ret3y: number) {
  if (ret3y >= 5)  return { label: '완만한 상승세', hint: '최근 실거래 추세 기준' };
  if (ret3y > -5)  return { label: '안정적',       hint: '큰 변동 없음' };
  if (ret3y > -15) return { label: '완만한 약세',   hint: '매매 시 가격 협상 여지' };
  return            { label: '약세 추세',          hint: '협상 여지 · 추정 불확실' };
}
```

- 4번째 메트릭 `3년 변동성 -22%` → `가격 흐름: 약세 추세 / 협상 여지·추정 불확실`.
- 하락을 "자산 폭락"이 아니라 "협상 여지"(거주·매수자 관점)로 중립화. 투자 수익률 프레임 제거.

### 2.3 신뢰도 평어 번역

```typescript
function confidenceLabel(c: number) {
  if (c >= 75) return '높음';
  if (c >= 62) return '보통';
  return '낮음 · 참고만';
}
```

- 도넛 아래 `신뢰도 낮음·참고만` 라벨 추가.
- 툴팁: "50~88 범위" → "낮을수록 추세가 불안정해 추정을 단정하기 어렵습니다".

### 2.4 저신뢰 시 점예측 추정톤

```
const uncertain = (primary?.confidence ?? 50) < 62;
1년 후/3년 후 메트릭:
  uncertain → "≈235만" 회색(text-ink-tertiary) + sub "불확실 · 참고만"
  정상      → "235만" + sub "총 1.6억"
```

- 넓은 신뢰구간(195~236) + 낮은 신뢰(57)가 이미 "정확히 모름"을 말하는데, 헤드라인 숫자가 그걸 덮던 문제 해소. "정직하되 겁주지 않기".
- disclaimer fallback 에서 "LSTM 변동성 점수는 보조 지표" 문구 제거.

> ARIMA 크레딧("ARIMA 가격 안정성" 배지, "ARIMA(2,1,2) 과거 실거래 기반")은 유지 — 채점위원용 신호는 살리고 사용자 공포 요소만 제거.

---

## 3. 실거래 원본 모달 (선택 도우미 — 판단 대행 ❌)

### 3.1 컨셉

모델 예측은 불확실 → 사용자가 못 믿음. **실거래 원본은 ground truth.** "우리 예측 믿어" → "실제 거래가 이거다, 직접 보고 판단해". 컨셉("선택을 돕되 판단은 대신하지 않음") 정합 + 신뢰 근거를 데이터로 이전.

### 3.2 서버 (신규 엔드포인트)

```
server/src/routes/domains/complexes.ts            신규
  GET /api/complexes/:complexId/trades?limit=100   (상한 200)
    t_apt_trade 최근순 → { ym, dealDate, areaM2, floor, priceManwon, pricePerM2 }
    404(미존재) / 400(잘못된 id) / 500(에러) 처리
server/src/routes/api.ts                           +1 mount
  apiRouter.use('/complexes', complexesRouter)
```

### 3.3 클라이언트

```
types/region-detail.ts            +ComplexTrade
api/regionDetail.ts               +fetchComplexTrades() (mock 폴백 없음 — 원본만)
components/TradeHistoryModal.tsx   신규 — createPortal, Esc·배경 닫기, 로딩/빈/에러, 다크모드
                                   테이블: 거래월 / 면적(평) / 층 / 거래가(억) / m²당
                                   푸터: "국토부 실거래가 원본. 면적·층에 따라 가격이 다릅니다. 실제 매물은 별도 확인."
LstmFullAnalysis.tsx              +"실제 거래 내역 보기 →" 버튼 + 모달 연결
```

- **면적·층 노출이 핵심**: 차트 median 이 숨기는 가격 편차의 이유(대형/소형·고층/저층)를 사용자가 스스로 이해 → dump 가 아닌 "비교 가능한" 리스트.
- 100건 한정(참고자료 포지셔닝 — 전체 덤프로 "지금이 고점" 판단을 *대신* 내리지 않음).
- 거래 희박 단지(ARIMA 폴백 동)는 리스트도 희박하게 노출 → 신뢰도 낮았던 이유를 사용자가 납득.

---

## 4. 변경 파일 통계 (②, 본 세션)

```
서버 (3)
  src/services/repositories/recommendationRepository.ts   ~10 lines (SALE_TRADE_TYPES + 주석)
  src/routes/domains/complexes.ts              신규       ~70  lines (실거래 엔드포인트)
  src/routes/api.ts                                       +2   lines (mount)

클라이언트 (4)
  src/pages/RegionDetail/components/LstmFullAnalysis.tsx  ~124 lines diff (차트 정직화 4종 + 모달 연결)
  src/pages/RegionDetail/components/TradeHistoryModal.tsx 신규 ~150 lines
  src/api/regionDetail.ts                                 +26  lines (fetchComplexTrades)
  src/types/region-detail.ts                              +16  lines (ComplexTrade)

총 ②   ~400 lines
```

---

## 5. typecheck

```
cd server && npm run typecheck   → EXIT:0 ✅
cd client && npm run typecheck   → EXIT:0 ✅ (tsc -b)
```

---

## 6. 검증 (실측)

```
GET /health                       → {"status":"ok","uptime":89s}  (tsx watch 재시작 직후)
GET /api/complexes/6902/trades?limit=3  (파크리오)
  → {"complexId":6902,"name":"파크리오","count":3,"trades":[
       {"ym":"2026-05","areaM2":144.77,"floor":28,"priceManwon":364000,"pricePerM2":2514}, ...]}
  → 모양·면적·층·m²당 단가 정상 ✅
```

> QA 중 `ECONNREFUSED` 다발 보고 → tsx watch 가 파일 저장마다 서버 재시작하는 1~2초 갭의 in-flight 요청 거부(정상). uptime 89s + 엔드포인트 응답으로 정상 가동 확인.

---

## 7. 함정 (다음 세션 인지)

```
① SALE_TRADE_TYPES=['APT'] 부작용
   빌라/오피만 있는 수도권 동들이 매매 랭킹에서 빠짐(의도된 것). Phase 3(빌라 상세) 완성 시
   ['APT','OFFI','VILLA'] 복원 + Depth 3 가 빌라/오피 단지도 표시하도록 동시 작업 필요.

② confidence floor 50 (미수정)
   R²=0.12 도 57 로 표기 — 정성 라벨/추정톤으로 완화했으나 근본은 floor 가 나쁜 적합을 과대표현.
   원하면 arima.ts 의 raw 산식 floor 를 낮추는 후속(서버 변경) 검토.

③ TradeHistoryModal 렌더 미확인
   샌드박스에서 시각 확인 불가. 사용자 회귀 필요:
   - "실제 거래 내역 보기 →" 버튼 노출 / 클릭 → 모달 + 100건
   - Esc·배경 닫힘 / 다크모드 / 도넛 아래 라벨 3개 쌓임 답답 여부
   - 거래 0건 단지 빈 메시지

④ -22% 제거가 "예측 회피"로 비치지 않게
   가격 흐름 정성 + 신뢰구간 + 실거래 원본의 3중 정직 장치가 함께 있어야 설득력.
   숫자만 숨기면 도리어 불신 — 모달(원본 노출)이 짝.

⑤ ①(거시 데이터) 미커밋과 ②가 한 트리에 공존
   커밋 분리 권장(§8). 특히 schema.prisma 는 ①만 건드림 — ② 커밋에 섞이지 않게.
```

---

## 8. 커밋 가이드 (권장 — 논리 단위 분리)

```
커밋 A (① ML 피처 데이터, 2026-06-06):
  schema.prisma + migrations/ + seedMacro*/seedHousingSupply + ecosClient + rebClient
  + .env.example + package.json + geocodeComplexes + doc/2026-06-06/*.md
  메시지 예: "feat(data): ECOS 금리/CPI/M2 + R-ONE 미분양 + 좌표 백필 (ML 다변량 피처)"

커밋 B (② 추천 정합성 픽스):
  recommendationRepository.ts
  메시지 예: "fix(reco): 매매 추천 universe 를 APT 로 정합 — 빌라전용 동 '단지 없음' 해소"

커밋 C (② Depth 3 정직화 + 실거래 모달):
  LstmFullAnalysis.tsx + TradeHistoryModal.tsx + complexes.ts + api.ts
  + regionDetail.ts + region-detail.ts + doc/2026-06-07/work-log.md
  메시지 예: "feat(depth3): 차트 정직화(가짜 LSTM선 제거·공포 -22% 정성화·저신뢰 추정톤) + 실거래 원본 모달"
```

---

## 9. 미해결 / 다음 세션

```
[★★★] 사용자 회귀 (npm run dev):
        - 수원화성/매매 → 팔달구 장안동 랭킹에서 사라졌나 (서버 재시작 필수)
        - Depth 3: -22% 안 보이고 "가격 흐름: 약세 추세", LSTM 선 사라짐, 신뢰도 평어
        - "실제 거래 내역 보기" 모달 동작 + 면적/층/거래가 표
[★★]  커밋 분리(§8) 후 푸시 여부 결정
[★]   confidence floor 50 후속(②) — 원할 때
[ ]   포트폴리오/공모전 서사 한 장(케이스스터디) — 별도 논의 중
[ ]   (ML 세션) 전세보증 위험(깡통) 지수 설계 = ML 레포 docs/2026-06-06-jeonse-risk-design.md
        — 제출 헤드라인은 LSTM+ARIMA 유지, 전세위험은 향후 확장으로 포지셔닝 합의됨
```

---

## 10. 다음 세션 첫 한 줄

> **"추천↔상세 정합성 픽스(SALE=APT) + Depth 3 정직화(가짜 LSTM선 제거·공포 -22% 정성화·신뢰도 평어·저신뢰 추정톤) + 실거래 원본 모달 ✅. typecheck 양측 0 + 엔드포인트 실측 확인. 사용자 회귀(장안동 소멸·차트·모달) 후 커밋 3분할(§8). 다음: confidence floor 후속 / 포트폴리오 서사 한 장 / (별도) 전세위험 지수 Phase A."**
