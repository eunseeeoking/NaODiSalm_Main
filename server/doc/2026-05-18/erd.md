# DB ERD — 2026-05-18 시점 스냅샷

> 소스: `server/prisma/schema.prisma`
> 명명 규칙: 테이블 `t_{name}`, 컬럼 snake_case (Prisma model 의 `@@map` / `@map` 으로 매핑)

## 다이어그램

```mermaid
erDiagram

  t_user ||--o{ t_user_token : "1:N (cascade delete)"
  t_apt_complex ||--o{ t_apt_trade : "1:N (cascade)"
  t_apt_complex ||--o{ t_apt_rent : "1:N (cascade)"
  t_apt_complex ||--o{ t_training_result : "0..1:N (nullable FK)"

  t_user {
    INT id PK
    VARCHAR_191 email UK
    VARCHAR_191 password "bcrypt"
    VARCHAR_191 name "nullable"
    VARCHAR_191 phone "nullable"
    DATETIME created_at
    DATETIME deleted_at "soft delete"
    INT login_fail_count "default 0"
  }

  t_user_token {
    INT id PK
    INT user_id FK
    VARCHAR_191 refresh_token_hash UK "SHA256"
    VARCHAR_191 access_token_hash "nullable"
    DATETIME access_expires_at "nullable"
    DATETIME refresh_expires_at
    BOOLEAN remember_me "default false"
    VARCHAR_255 user_agent "nullable"
    VARCHAR_64 ip_address "nullable"
    DATETIME created_at
    DATETIME revoked_at "nullable"
  }

  t_legal_dong {
    VARCHAR_10 code PK "LAWD_CD 5 or 10 digits"
    VARCHAR_40 sido
    VARCHAR_60 sigungu
    VARCHAR_60 dong "nullable"
    BOOLEAN is_active "default true"
  }

  t_apt_complex {
    INT id PK
    VARCHAR_40 apt_seq UK "MOLIT 단지 ID, nullable"
    VARCHAR_120 name
    VARCHAR_5 sigungu_code "LAWD_CD"
    VARCHAR_60 legal_dong
    VARCHAR_60 jibun "nullable"
    VARCHAR_200 road_addr "nullable"
    INT built_year "nullable"
    DOUBLE lat "nullable, geocoded later"
    DOUBLE lng "nullable, geocoded later"
    DATETIME created_at
    DATETIME updated_at
  }

  t_apt_trade {
    INT id PK
    INT complex_id FK
    DATE deal_date
    INT price_manwon "만원 단위"
    DOUBLE area_m2
    INT floor "nullable"
    INT built_year "nullable"
    JSON raw_payload "감사 추적용"
    DATETIME created_at
  }

  t_apt_rent {
    INT id PK
    INT complex_id FK
    DATE contract_date
    INT deposit_manwon "만원"
    INT monthly_manwon "default 0"
    ENUM contract_type "JEONSE | WOLSE"
    DOUBLE area_m2
    INT floor "nullable"
    INT built_year "nullable"
    JSON raw_payload "감사 추적용"
    DATETIME created_at
  }

  t_training_result {
    INT id PK
    INT complex_id FK "nullable: 구간/지역 집계 결과"
    VARCHAR_5 sigungu_code
    VARCHAR_60 legal_dong
    ENUM area_bucket "SMALL/MEDIUM/LARGE_MID/LARGE"
    ENUM age_bucket "NEW/SEMI_NEW/MID/OLD"
    DATE base_date "학습 기준일"
    DOUBLE current_price_per_m2 "만원/㎡"
    DOUBLE predicted_1y_price_per_m2 "nullable"
    DOUBLE predicted_3y_price_per_m2 "nullable"
    DOUBLE expected_return_3y "% nullable"
    DOUBLE confidence "0~1 nullable"
    DOUBLE mae "검증오차 nullable"
    DOUBLE mape "% nullable"
    INT sample_count
    VARCHAR_40 model_version "예: lstm-v1"
    JSON model_meta "하이퍼파라미터"
    DATETIME trained_at
  }
```

## 도메인별 그룹

| 그룹 | 테이블 | 책임 / 소유 |
|---|---|---|
| 사용자 / 인증 | `t_user`, `t_user_token` | server (CONTEST) |
| 행정구역 마스터 | `t_legal_dong` | server — 시드 1회 적재 (정적) |
| 부동산 ingest | `t_apt_complex`, `t_apt_trade`, `t_apt_rent` | server — 국토부 API 스케줄 적재 |
| ML 학습 결과 | `t_training_result` | ML 프로젝트 (`2026_MOLIT_ML`) — upsert |

## 관계 요약

```
t_user(1) ─── (N)t_user_token            [user_id, ON DELETE CASCADE]
t_apt_complex(1) ─── (N)t_apt_trade       [complex_id, ON DELETE CASCADE]
t_apt_complex(1) ─── (N)t_apt_rent        [complex_id, ON DELETE CASCADE]
t_apt_complex(0..1) ─── (N)t_training_result  [complex_id nullable, FK 없음 — 코드 매칭]

t_legal_dong  ─── (참조)  sigungu_code 코드 매칭으로 t_apt_complex / t_training_result
                          (FK 제약 없음 — 마스터 데이터)
```

## 유니크/인덱스 (재실행 안전성)

```
t_user                     UK(email)
t_user_token               UK(refresh_token_hash), IDX(user_id)
t_apt_complex              UK(apt_seq), UK(sigungu_code, legal_dong, name, built_year) — fingerprint
                           IDX(sigungu_code, legal_dong)
t_apt_trade                UK(complex_id, deal_date, area_m2, floor, price_manwon) — uniq_trade
                           IDX(complex_id, deal_date)
t_apt_rent                 UK(complex_id, contract_date, area_m2, floor, deposit_manwon, monthly_manwon)
                           IDX(complex_id, contract_date)
t_training_result          UK(sigungu_code, legal_dong, area_bucket, age_bucket, complex_id, base_date, model_version)
                           IDX(sigungu_code, legal_dong), IDX(complex_id), IDX(trained_at)
```

## 추가 예정 테이블 (계획)

```
t_commute_matrix  — 직장 ↔ 행정동 ODsay 통근시간 캐시 (Week 2)
                    cache_key (lat_lng 4자리 반올림), legal_dong_code, transit_minutes, ...
                    같은 직장 재입력 시 API 호출 0건 보장
```
