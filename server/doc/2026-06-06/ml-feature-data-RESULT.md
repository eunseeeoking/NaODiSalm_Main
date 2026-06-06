# ML 피처 데이터 수집 — 수행 결과 / 복귀 보고 (2026-06-06)

> 핸드오프(`ml-feature-data-handoff.md`) §7 "ML 세션에 넘길 것" 에 답하는 문서.
> ML 세션은 이 파일의 **확정 컬럼명 / 커버리지 / 단위** 에 스캐폴딩을 고정하면 된다.

---

## 0. 한눈에 — 무엇이 ML-ready 인가

| 신호 | 테이블 | 상태 | 비고 |
|---|---|---|---|
| 미분양 (T1-b) | `t_housing_supply.unsold` | ✅ **적재 완료** | 서울 25구 × 2015-01~2026-04, 3031행 |
| 단지 좌표 (공간피처 전제) | `t_apt_complex.lat/lng` | ✅ **백필 완료** | 99.6% (NULL 10,977 → 73) |
| 지하철역 좌표 (T3-a) | `data/subway-graph.json` | ✅ **재활용 확정** | 1095/1095 좌표 보유, 재수집 불필요 |
| 금리 (T1-a) | `t_macro_rate` | ✅ **적재 완료** | 2015-01~2026-05, 137행. base_rate 137/137, mortgage 136/137 |
| CPI·M2 (T2) | `t_macro_econ` | ✅ **적재 완료** | 2015-01~2026-05, 137행. cpi 137/137, m2 135/137 |
| 입주/인허가 (T1-b 선택) | — | ⛔ **미적재** | R-ONE 시도(서울전체) 단위뿐 → 구 단위 join 불가 |
| 학교 좌표 (T3-b 선택) | — | ⛔ **미수집** | 이번 범위서 제외(사용자 결정) |

**전 항목 적재 완료** (2026-06-06 ECOS 키 투입 후). 차단점 없음 — ML 패널 빌드 바로 가능.

---

## 1. 확정 테이블·컬럼명 (스키마 고정용)

### `t_housing_supply` (적재됨)
```
sigungu_code  VARCHAR(5)   -- "11680" 등 서울 25구 LAWD. t_apt_complex.sigungu_code 와 동일 키
ym            VARCHAR(7)   -- "2024-01"
unsold        INT          -- 미분양 호수 (NOT NULL, 적재됨)
move_in_units INT          -- NULL (시도단위뿐이라 미적재)
permit_units  INT          -- NULL (동상)
@@unique(sigungu_code, ym)
```

### `t_macro_rate` (적재됨)
```
ym            VARCHAR(7) PK -- 전국 단일 → ym 으로 broadcast join
base_rate     DOUBLE        -- 한국은행 기준금리 (%)
mortgage_rate DOUBLE        -- 예금은행 가중평균금리 신규취급액 주택담보대출 (%)
```

### `t_macro_econ` (적재됨)
```
ym             VARCHAR(7) PK
cpi            DOUBLE       -- 소비자물가지수 (2020=100)
m2             DOUBLE       -- M2 광의통화 평잔(계절조정). ⚠️ 단위 주의(§3)
household_loan DOUBLE       -- 미사용(NULL) — T2 범위서 제외
```

---

## 2. 커버리지

- **미분양**: `MIN(ym)=2015-01`, `MAX(ym)=2026-04`, 시군구 = **서울 25구만** (REB 지수와 동일 범위). 결측은 일부 초기 월(시군구별 데이터 시작 시차) → 25×136=3400 중 3031행.
- **단지 좌표**: `t_apt_complex` 20,589행 중 73행(0.35%)만 NULL(주소 무매칭). 전부 수도권 bbox 내(오매칭 0). 남은 73은 `npm run geocode:complexes -- --type=APT --fallback-dong` 로 동 centroid 근사 채움 가능(정밀 좌표 아님 — 미적용).
- **REB 지수**: 기존 그대로 서울 25구, 2015-01~2026-04 (변경 없음 — §4 참조).

---

## 3. 단위 (반드시 확인)

- `base_rate` / `mortgage_rate`: **퍼센트(%)** 그대로 (예: 3.5).
- `cpi`: 지수 (2020=100).
- `m2`: ECOS 원자료가 **십억원** 단위. `seed:macro-econ` 기본은 원단위 저장 → **조원으로 저장하려면** `npm run seed:macro-econ -- --m2-divisor=1000` 로 실행(권장). 스키마 주석은 "조원" 기준.
- `unsold`: 호수(정수).

---

## 4. REB 확장 여부

**확장 안 함.** 실험 범위가 서울 25구이므로 `t_reb_price_index` 도 서울 25구 그대로. 미분양도 같은 서울 25구로 맞춤 → REB·미분양·단지패널 join 키(`sigungu_code`+`ym`) 정합.
> 서울 밖 확장 시: REB·미분양 모두 시군구 적재 필요. 단, R-ONE 미분양의 경기/인천은 시(市) 단위라 t_apt_complex 의 구 단위와 granularity 불일치 → 별도 매핑 설계 필요(seedHousingSupply 헤더 메모 참조).

---

## 5. 재현·운영 메모

- 멱등: 모든 seed 는 `@@unique` upsert → 재실행 안전.
- 재적재(멱등) 명령:
  ```
  npm run seed:macro-rate
  npm run seed:macro-econ -- --m2-divisor=1000
  npm run seed:housing-supply -- --start=201501 --end=202604
  ```
- ECOS 통계표/항목 코드 (`.env`, 2026-06-06 검증):
  기준금리 `722Y001/0101000`, 주담대 `121Y006/BECBLA0302`, CPI `901Y009/0`, **M2 `161Y005/BBHS00`**.
  ⚠️ M2 구 코드 `101Y003`(1.7.x 섹션)은 현재 빈 응답(INFO-200) → 현행 `161Y005`(1.1.3.1.1) 사용.
- 신규/변경 코드: `src/services/external/ecosClient.ts`(신규), `rebClient.ts`(+`fetchRebRawSeries`),
  `scripts/seedMacroRate.ts`·`seedMacroEcon.ts`·`seedHousingSupply.ts`(신규), `geocodeComplexes.ts`(+APT),
  `prisma/schema.prisma`(+3모델), 마이그레이션 `20260606000000_add_ml_feature_tables`.
