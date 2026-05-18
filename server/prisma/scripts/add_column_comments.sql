-- ============================================================
--  컬럼 COMMENT 일괄 적용 스크립트 (HeidiSQL 가시화용)
-- ============================================================
--  목적: 기존 데이터 보존하면서 컬럼 메타데이터(COMMENT)만 추가
--  방식: ALTER TABLE ... MODIFY COLUMN <기존타입> ... COMMENT '...'
--         → 타입을 정확히 동일하게 명시하므로 데이터 변환/유실 없음
--  실행: HeidiSQL 에서 직접 실행 (Prisma 마이그레이션 거치지 않음)
--  검증: 맨 아래 SELECT 문으로 COMMENT 적용 여부 확인
-- ============================================================
--
--  ⚠️ 주의 사항
--   1) 이 스크립트는 prisma/migrations 폴더 밖에 둠 → prisma migrate 가 자동 실행 안 함
--   2) MODIFY COLUMN 은 타입이 동일하면 ROW 데이터를 건드리지 않음 (메타데이터만 변경)
--   3) 실행 전 풀 백업 권장 (mysqldump --single-transaction 등)
--   4) 외래키 컬럼(user_id, complex_id) 도 MODIFY 가능 — 타입만 동일하면 FK 유지됨
--
-- ============================================================


-- ────────────────────────────────────────────────────────────
--  t_user
-- ────────────────────────────────────────────────────────────
ALTER TABLE `t_user`
  MODIFY COLUMN `id`               INTEGER       NOT NULL AUTO_INCREMENT       COMMENT '고유 사용자 ID (PK)',
  MODIFY COLUMN `email`            VARCHAR(191)  NOT NULL                      COMMENT '로그인 이메일 (UNIQUE, 이메일 형식)',
  MODIFY COLUMN `password`         VARCHAR(191)  NOT NULL                      COMMENT 'bcrypt 해시값 (salt rounds=10, 약 60자)',
  MODIFY COLUMN `name`             VARCHAR(191)  NULL                          COMMENT '사용자 이름 (선택)',
  MODIFY COLUMN `phone`            VARCHAR(191)  NULL                          COMMENT '휴대폰번호 (선택, 형식: 010-1234-5678 또는 숫자만)',
  MODIFY COLUMN `created_at`       DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '계정 생성일시',
  MODIFY COLUMN `deleted_at`       DATETIME(3)   NULL                          COMMENT '계정 삭제일시 (soft delete, NULL=활성)',
  MODIFY COLUMN `login_fail_count` INTEGER       NOT NULL DEFAULT 0            COMMENT '연속 로그인 실패 횟수 (3회 이상 시 계정 잠금)';


-- ────────────────────────────────────────────────────────────
--  t_user_token
-- ────────────────────────────────────────────────────────────
ALTER TABLE `t_user_token`
  MODIFY COLUMN `id`                 INTEGER      NOT NULL AUTO_INCREMENT       COMMENT '토큰 레코드 ID (PK)',
  MODIFY COLUMN `user_id`            INTEGER      NOT NULL                      COMMENT '사용자 ID (FK → t_user.id)',
  MODIFY COLUMN `refresh_token_hash` VARCHAR(191) NOT NULL                      COMMENT 'Refresh JWT 의 SHA256 해시 (원본 미저장)',
  MODIFY COLUMN `access_token_hash`  VARCHAR(191) NULL                          COMMENT 'Access JWT 의 SHA256 해시 (선택)',
  MODIFY COLUMN `access_expires_at`  DATETIME(3)  NULL                          COMMENT 'Access 토큰 만료 시각 (UTC, 기본 15분)',
  MODIFY COLUMN `refresh_expires_at` DATETIME(3)  NOT NULL                      COMMENT 'Refresh 토큰 만료 시각 (UTC, 기본 7일)',
  MODIFY COLUMN `remember_me`        BOOLEAN      NOT NULL DEFAULT false        COMMENT '"계정 기억" 옵션 여부 (true=만료 자동 연장)',
  MODIFY COLUMN `user_agent`         VARCHAR(255) NULL                          COMMENT '로그인 시 브라우저 User-Agent (기기 감지/CSRF 방지)',
  MODIFY COLUMN `ip_address`         VARCHAR(64)  NULL                          COMMENT '로그인 IP 주소 (IPv4/IPv6)',
  MODIFY COLUMN `created_at`         DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '토큰 발급 시각',
  MODIFY COLUMN `revoked_at`         DATETIME(3)  NULL                          COMMENT '토큰 폐기 시각 (로그아웃 시 설정)';


-- ────────────────────────────────────────────────────────────
--  t_legal_dong
-- ────────────────────────────────────────────────────────────
ALTER TABLE `t_legal_dong`
  MODIFY COLUMN `code`      VARCHAR(10) NOT NULL              COMMENT 'LAWD_CD 코드: 5자리(시군구) 또는 10자리(풀 법정동). 예: 11680=강남구',
  MODIFY COLUMN `sido`      VARCHAR(40) NOT NULL              COMMENT '시도명 (예: 서울특별시, 경기도)',
  MODIFY COLUMN `sigungu`   VARCHAR(60) NOT NULL              COMMENT '시군구명 (예: 강남구, 수원시 영통구)',
  MODIFY COLUMN `dong`      VARCHAR(60) NULL                  COMMENT '읍면동명 (10자리 코드일 때만 저장)',
  MODIFY COLUMN `is_active` BOOLEAN     NOT NULL DEFAULT true COMMENT '활성 구역 여부 (false=폐지/통합 행정구역)';


-- ────────────────────────────────────────────────────────────
--  t_apt_complex
-- ────────────────────────────────────────────────────────────
ALTER TABLE `t_apt_complex`
  MODIFY COLUMN `id`           INTEGER      NOT NULL AUTO_INCREMENT       COMMENT '단지 고유 ID (PK)',
  MODIFY COLUMN `apt_seq`      VARCHAR(40)  NULL                          COMMENT 'MOLIT(국토부) 공식 단지 고유 ID (예: 11680-3621)',
  MODIFY COLUMN `name`         VARCHAR(120) NOT NULL                      COMMENT '단지명 (예: 테헤란 푸르지오)',
  MODIFY COLUMN `sigungu_code` VARCHAR(5)   NOT NULL                      COMMENT '시군구 LAWD_CD (5자리, 예: 11680=강남구)',
  MODIFY COLUMN `legal_dong`   VARCHAR(60)  NOT NULL                      COMMENT '법정동명 (예: 역삼동, 주소 정규화용)',
  MODIFY COLUMN `jibun`        VARCHAR(60)  NULL                          COMMENT '지번 주소 (예: 강남구 역삼동 1234)',
  MODIFY COLUMN `road_addr`    VARCHAR(200) NULL                          COMMENT '도로명 주소 (예: 서울 강남구 테헤란로 152)',
  MODIFY COLUMN `built_year`   INTEGER      NULL                          COMMENT '준공년도 (연도만, 예: 2005, 면적별 분류용)',
  MODIFY COLUMN `lat`          DOUBLE       NULL                          COMMENT 'WGS84 위도 (지오코딩으로 채움, 초기 NULL)',
  MODIFY COLUMN `lng`          DOUBLE       NULL                          COMMENT 'WGS84 경도 (지오코딩으로 채움, 초기 NULL)',
  MODIFY COLUMN `created_at`   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '데이터 등록일시',
  MODIFY COLUMN `updated_at`   DATETIME(3)  NOT NULL                      COMMENT '데이터 마지막 수정일시 (@updatedAt)';


-- ────────────────────────────────────────────────────────────
--  t_apt_trade  (아파트 매매 실거래)
-- ────────────────────────────────────────────────────────────
ALTER TABLE `t_apt_trade`
  MODIFY COLUMN `id`            INTEGER     NOT NULL AUTO_INCREMENT       COMMENT '거래 레코드 ID (PK)',
  MODIFY COLUMN `complex_id`    INTEGER     NOT NULL                      COMMENT '아파트 단지 ID (FK → t_apt_complex.id)',
  MODIFY COLUMN `deal_date`     DATE        NOT NULL                      COMMENT '거래 체결일 (YYYY-MM-DD)',
  MODIFY COLUMN `price_manwon`  INTEGER     NOT NULL                      COMMENT '거래 가격 (만원 단위, 예: 50000=5억원)',
  MODIFY COLUMN `area_m2`       DOUBLE      NOT NULL                      COMMENT '전용면적 (㎡, 소수점 가능, 예: 59.8)',
  MODIFY COLUMN `floor`         INTEGER     NULL                          COMMENT '층수 (선택)',
  MODIFY COLUMN `built_year`    INTEGER     NULL                          COMMENT '준공년도 (거래 당시 단지 연식)',
  MODIFY COLUMN `raw_payload`   JSON        NULL                          COMMENT '국토부 API 원본 응답 JSON (감사 추적용)',
  MODIFY COLUMN `created_at`    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '데이터 수집/저장 시각';


-- ────────────────────────────────────────────────────────────
--  t_apt_rent  (아파트 전월세 실거래)
-- ────────────────────────────────────────────────────────────
ALTER TABLE `t_apt_rent`
  MODIFY COLUMN `id`              INTEGER                  NOT NULL AUTO_INCREMENT       COMMENT '전월세 레코드 ID (PK)',
  MODIFY COLUMN `complex_id`      INTEGER                  NOT NULL                      COMMENT '아파트 단지 ID (FK → t_apt_complex.id)',
  MODIFY COLUMN `contract_date`   DATE                     NOT NULL                      COMMENT '계약 체결일 (YYYY-MM-DD)',
  MODIFY COLUMN `deposit_manwon`  INTEGER                  NOT NULL                      COMMENT '보증금 (만원 단위, 예: 50000=5억원)',
  MODIFY COLUMN `monthly_manwon`  INTEGER                  NOT NULL DEFAULT 0            COMMENT '월세 (만원 단위, 전세=0)',
  MODIFY COLUMN `contract_type`   ENUM('JEONSE', 'WOLSE')  NOT NULL                      COMMENT '계약 유형 (JEONSE=전세, WOLSE=월세)',
  MODIFY COLUMN `area_m2`         DOUBLE                   NOT NULL                      COMMENT '전용면적 (㎡, 소수점 가능)',
  MODIFY COLUMN `floor`           INTEGER                  NULL                          COMMENT '층수 (선택)',
  MODIFY COLUMN `built_year`      INTEGER                  NULL                          COMMENT '준공년도 (계약 당시 단지 연식)',
  MODIFY COLUMN `raw_payload`     JSON                     NULL                          COMMENT '국토부 API 원본 응답 JSON (감사 추적용)',
  MODIFY COLUMN `created_at`      DATETIME(3)              NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '데이터 수집/저장 시각';


-- ────────────────────────────────────────────────────────────
--  t_training_result  (LSTM 학습 결과 — ML 프로젝트 소유)
-- ────────────────────────────────────────────────────────────
ALTER TABLE `t_training_result`
  MODIFY COLUMN `id`                          INTEGER                                          NOT NULL AUTO_INCREMENT COMMENT '학습 결과 레코드 ID (PK)',
  MODIFY COLUMN `complex_id`                  INTEGER                                          NULL                    COMMENT '아파트 단지 ID (NULL=구간/지역 집계 결과)',
  MODIFY COLUMN `sigungu_code`                VARCHAR(5)                                       NOT NULL                COMMENT '시군구 LAWD_CD (5자리)',
  MODIFY COLUMN `legal_dong`                  VARCHAR(60)                                      NOT NULL                COMMENT '법정동명 (예: 역삼동)',
  MODIFY COLUMN `area_bucket`                 ENUM('SMALL','MEDIUM','LARGE_MID','LARGE')       NOT NULL                COMMENT '면적 구간 (SMALL≤60㎡ / MEDIUM 60~85 / LARGE_MID 85~135 / LARGE>135)',
  MODIFY COLUMN `age_bucket`                  ENUM('NEW','SEMI_NEW','MID','OLD')               NOT NULL                COMMENT '연식 구간 (NEW≤10년 / SEMI_NEW 10~20 / MID 20~30 / OLD>30)',
  MODIFY COLUMN `base_date`                   DATE                                             NOT NULL                COMMENT '학습 기준일 (입력 데이터의 마지막 시점)',
  MODIFY COLUMN `current_price_per_m2`        DOUBLE                                           NOT NULL                COMMENT '현재 m²당 단가 (만원/㎡, base_date 시점)',
  MODIFY COLUMN `predicted_1y_price_per_m2`   DOUBLE                                           NULL                    COMMENT '1년 후 예측 m²당 단가 (만원/㎡)',
  MODIFY COLUMN `predicted_3y_price_per_m2`   DOUBLE                                           NULL                    COMMENT '3년 후 예측 m²당 단가 (만원/㎡)',
  MODIFY COLUMN `expected_return_3y`          DOUBLE                                           NULL                    COMMENT '예상 3년 수익률 (%, 예: 15.5=+15.5%)',
  MODIFY COLUMN `confidence`                  DOUBLE                                           NULL                    COMMENT '모델 신뢰도 (0~1, 0.5 이상 권장)',
  MODIFY COLUMN `mae`                         DOUBLE                                           NULL                    COMMENT '검증 평균절대오차 (MAE, 만원/㎡)',
  MODIFY COLUMN `mape`                        DOUBLE                                           NULL                    COMMENT '검증 평균절대백분율오차 (MAPE %)',
  MODIFY COLUMN `sample_count`                INTEGER                                          NOT NULL                COMMENT '학습 사용 거래 샘플 수 (통계적 유의성 지표)',
  MODIFY COLUMN `model_version`               VARCHAR(40)                                      NOT NULL                COMMENT '모델 버전 ID (예: lstm-v1, A/B 비교용)',
  MODIFY COLUMN `model_meta`                  JSON                                             NULL                    COMMENT '모델 메타데이터 JSON (하이퍼파라미터, 학습 설정)',
  MODIFY COLUMN `trained_at`                  DATETIME(3)                                      NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '모델 학습/저장 시각';


-- ============================================================
--  ✅ 검증 쿼리 — 적용 결과 확인
-- ============================================================
--  아래 SELECT 를 실행해서 모든 컬럼에 COMMENT 가 채워졌는지 확인
--  COLUMN_COMMENT 컬럼이 비어있으면 적용 안 된 것
-- ============================================================

SELECT
  TABLE_NAME,
  COLUMN_NAME,
  COLUMN_TYPE,
  IS_NULLABLE,
  COLUMN_DEFAULT,
  COLUMN_COMMENT
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN (
    't_user',
    't_user_token',
    't_legal_dong',
    't_apt_complex',
    't_apt_trade',
    't_apt_rent',
    't_training_result'
  )
ORDER BY TABLE_NAME, ORDINAL_POSITION;
