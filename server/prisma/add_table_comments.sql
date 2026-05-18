-- 테이블 및 컬럼 주석 추가
-- MySQL COMMENT 설정으로 데이터 정의 명확화

-- ============================================================
-- t_user (사용자)
-- ============================================================
ALTER TABLE `t_user` COMMENT='시스템 사용자 계정 정보';

ALTER TABLE `t_user`
MODIFY COLUMN `id` INT NOT NULL AUTO_INCREMENT COMMENT '고유 사용자 ID',
MODIFY COLUMN `email` VARCHAR(255) NOT NULL UNIQUE COMMENT '로그인 이메일 (유니크, 이메일 형식)',
MODIFY COLUMN `password` VARCHAR(255) NOT NULL COMMENT 'bcrypt 해시값 (salt rounds=10, 최소 60자)',
MODIFY COLUMN `name` VARCHAR(255) NULL DEFAULT NULL COMMENT '사용자 이름 (선택, 최대 100자)',
MODIFY COLUMN `phone` VARCHAR(20) NULL DEFAULT NULL COMMENT '휴대폰번호 (선택, 형식: 010-1234-5678 또는 숫자만)',
MODIFY COLUMN `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '계정 생성일시',
MODIFY COLUMN `deleted_at` DATETIME NULL DEFAULT NULL COMMENT '계정 삭제일시 (soft delete, null이면 활성 사용자)',
MODIFY COLUMN `login_fail_count` INT NOT NULL DEFAULT '0' COMMENT '연속 로그인 실패 횟수 (3회 이상 시 계정 잠금)';

-- ============================================================
-- t_user_token (세션 토큰)
-- ============================================================
ALTER TABLE `t_user_token` COMMENT='JWT 토큰 저장 및 세션 관리';

ALTER TABLE `t_user_token`
MODIFY COLUMN `id` INT NOT NULL AUTO_INCREMENT COMMENT '토큰 레코드 ID',
MODIFY COLUMN `user_id` INT NOT NULL COMMENT '사용자 ID (FK → t_user)',
MODIFY COLUMN `refresh_token_hash` VARCHAR(255) NOT NULL UNIQUE COMMENT 'Refresh JWT의 SHA256 해시 (보안: 원본 저장 금지)',
MODIFY COLUMN `access_token_hash` VARCHAR(255) NULL DEFAULT NULL COMMENT 'Access JWT의 SHA256 해시 (선택, 필요시에만 저장)',
MODIFY COLUMN `access_expires_at` DATETIME NULL DEFAULT NULL COMMENT 'Access 토큰 만료 시각 (UTC, 기본 15분)',
MODIFY COLUMN `refresh_expires_at` DATETIME NOT NULL COMMENT 'Refresh 토큰 만료 시각 (UTC, 기본 7일)',
MODIFY COLUMN `remember_me` TINYINT(1) NOT NULL DEFAULT '0' COMMENT '"계정 기억" 옵션 여부 (true면 refreshExpiresAt 자동 연장)',
MODIFY COLUMN `user_agent` VARCHAR(255) NULL DEFAULT NULL COMMENT '로그인 시 브라우저 User-Agent (기기 감지/CSRF 방지)',
MODIFY COLUMN `ip_address` VARCHAR(64) NULL DEFAULT NULL COMMENT '로그인 IP 주소 (IPv4/IPv6 형식)',
MODIFY COLUMN `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '토큰 발급 시각',
MODIFY COLUMN `revoked_at` DATETIME NULL DEFAULT NULL COMMENT '토큰 폐기 시각 (로그아웃 시 설정, 이전 토큰 무효화)';

-- ============================================================
-- t_legal_dong (법정동 코드 마스터)
-- ============================================================
ALTER TABLE `t_legal_dong` COMMENT='법정동 코드 마스터 (행정구역 기준 데이터: 한국 시도/시군구/읍면동)';

ALTER TABLE `t_legal_dong`
MODIFY COLUMN `code` VARCHAR(10) NOT NULL COMMENT 'LAWD_CD 코드: 5자리(시군구) 또는 10자리(풀 법정동) 형식. 예: "11680" (강남구), "1168010100" (강남구 강남동)',
MODIFY COLUMN `sido` VARCHAR(40) NOT NULL COMMENT '시도명 (예: "서울특별시", "경기도")',
MODIFY COLUMN `sigungu` VARCHAR(60) NOT NULL COMMENT '시군구명 (예: "강남구", "수원시 영통구")',
MODIFY COLUMN `dong` VARCHAR(60) NULL DEFAULT NULL COMMENT '읍면동명 (선택, 10자리 코드일 때만 저장, 예: "강남동")',
MODIFY COLUMN `is_active` TINYINT(1) NOT NULL DEFAULT '1' COMMENT '활성 구역 여부 (폐지/통합된 행정구역은 false)';

-- ============================================================
-- t_apt_complex (아파트 단지 마스터)
-- ============================================================
ALTER TABLE `t_apt_complex` COMMENT='아파트 단지 기본 정보 (거래/전월세 데이터 통합)';

ALTER TABLE `t_apt_complex`
MODIFY COLUMN `id` INT NOT NULL AUTO_INCREMENT COMMENT '단지 고유 ID',
MODIFY COLUMN `apt_seq` VARCHAR(40) NULL DEFAULT NULL UNIQUE COMMENT 'MOLIT(국토부) 공식 단지 고유 ID (예: "11680-3621", 선택)',
MODIFY COLUMN `name` VARCHAR(120) NOT NULL COMMENT '단지명 (예: "테헤란 푸르지오")',
MODIFY COLUMN `sigungu_code` VARCHAR(5) NOT NULL COMMENT '시군구 LAWD_CD (5자리, 예: "11680" 강남구)',
MODIFY COLUMN `legal_dong` VARCHAR(60) NOT NULL COMMENT '법정동명 (예: "강남동", 주소 정규화용)',
MODIFY COLUMN `jibun` VARCHAR(60) NULL DEFAULT NULL COMMENT '지번 주소 (선택, 예: "강남구 강남동 1234")',
MODIFY COLUMN `road_addr` VARCHAR(200) NULL DEFAULT NULL COMMENT '도로명 주소 (선택, 예: "서울 강남구 테헤란로 152")',
MODIFY COLUMN `built_year` INT NULL DEFAULT NULL COMMENT '준공년도 (선택, 연도만, 예: 2005, 면적별 분류용)',
MODIFY COLUMN `lat` FLOAT NULL DEFAULT NULL COMMENT 'WGS84 위도 (지오코딩으로 채움, 초기값 NULL)',
MODIFY COLUMN `lng` FLOAT NULL DEFAULT NULL COMMENT 'WGS84 경도 (지오코딩으로 채움, 초기값 NULL)',
MODIFY COLUMN `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '데이터 등록일시',
MODIFY COLUMN `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '데이터 마지막 수정일시';

-- ============================================================
-- t_apt_trade (아파트 매매 실거래)
-- ============================================================
ALTER TABLE `t_apt_trade` COMMENT='아파트 매매 거래 기록 (국토교통부 실거래가)';

ALTER TABLE `t_apt_trade`
MODIFY COLUMN `id` INT NOT NULL AUTO_INCREMENT COMMENT '거래 레코드 ID',
MODIFY COLUMN `complex_id` INT NOT NULL COMMENT '아파트 단지 ID (FK → t_apt_complex)',
MODIFY COLUMN `deal_date` DATE NOT NULL COMMENT '거래 체결일 (년-월-일, 예: 2024-05-15)',
MODIFY COLUMN `price_manwon` INT NOT NULL COMMENT '거래 가격 (만원 단위, 예: 50000은 5억원)',
MODIFY COLUMN `area_m2` FLOAT NOT NULL COMMENT '전용면적 (㎡, 소수점 가능, 예: 59.8)',
MODIFY COLUMN `floor` INT NULL DEFAULT NULL COMMENT '층수 (선택, 1~40 등의 범위)',
MODIFY COLUMN `built_year` INT NULL DEFAULT NULL COMMENT '준공년도 (선택, 거래 당시 단지 나이)',
MODIFY COLUMN `raw_payload` JSON NULL DEFAULT NULL COMMENT '원본 응답 JSON (디버깅/감사 추적용, 선택)',
MODIFY COLUMN `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '데이터 수집/저장 시각';

-- ============================================================
-- t_apt_rent (아파트 전월세)
-- ============================================================
ALTER TABLE `t_apt_rent` COMMENT='아파트 전월세 거래 기록 (국토교통부 실거래가)';

ALTER TABLE `t_apt_rent`
MODIFY COLUMN `id` INT NOT NULL AUTO_INCREMENT COMMENT '전월세 레코드 ID',
MODIFY COLUMN `complex_id` INT NOT NULL COMMENT '아파트 단지 ID (FK → t_apt_complex)',
MODIFY COLUMN `contract_date` DATE NOT NULL COMMENT '계약 체결일 (년-월-일, 예: 2024-05-15)',
MODIFY COLUMN `deposit_manwon` INT NOT NULL COMMENT '보증금 (만원 단위, 예: 50000은 5억원)',
MODIFY COLUMN `monthly_manwon` INT NOT NULL DEFAULT '0' COMMENT '월세 (만원 단위), 전세는 0, 월세는 100 이상',
MODIFY COLUMN `contract_type` ENUM('JEONSE','WOLSE') NOT NULL COMMENT '계약 유형 (JEONSE=전세, WOLSE=월세)',
MODIFY COLUMN `area_m2` FLOAT NOT NULL COMMENT '전용면적 (㎡, 소수점 가능, 예: 59.8)',
MODIFY COLUMN `floor` INT NULL DEFAULT NULL COMMENT '층수 (선택, 1~40 등의 범위)',
MODIFY COLUMN `built_year` INT NULL DEFAULT NULL COMMENT '준공년도 (선택, 계약 당시 단지 나이)',
MODIFY COLUMN `raw_payload` JSON NULL DEFAULT NULL COMMENT '원본 응답 JSON (디버깅/감사 추적용, 선택)',
MODIFY COLUMN `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '데이터 수집/저장 시각';

-- ============================================================
-- t_training_result (LSTM 학습 결과)
-- ============================================================
ALTER TABLE `t_training_result` COMMENT='LSTM 모델 예측 결과 저장소 (단지/구간별 가격 예측)';

ALTER TABLE `t_training_result`
MODIFY COLUMN `id` INT NOT NULL AUTO_INCREMENT COMMENT '학습 결과 레코드 ID',
MODIFY COLUMN `complex_id` INT NULL DEFAULT NULL COMMENT '아파트 단지 ID (선택, null이면 구간/지역 집계 결과)',
MODIFY COLUMN `sigungu_code` VARCHAR(5) NOT NULL COMMENT '시군구 LAWD_CD (5자리, 예: "11680")',
MODIFY COLUMN `legal_dong` VARCHAR(60) NOT NULL COMMENT '법정동명 (예: "강남동")',
MODIFY COLUMN `area_bucket` ENUM('SMALL','MEDIUM','LARGE_MID','LARGE') NOT NULL COMMENT '면적 구간 분류 (SMALL≤60㎡, MEDIUM 60~85, LARGE_MID 85~135, LARGE>135)',
MODIFY COLUMN `age_bucket` ENUM('NEW','SEMI_NEW','MID','OLD') NOT NULL COMMENT '준공연도 구간 분류 (NEW≤10년, SEMI_NEW 10~20, MID 20~30, OLD>30)',
MODIFY COLUMN `base_date` DATE NOT NULL COMMENT '학습 기준일 (모델 입력 데이터의 마지막 시점)',
MODIFY COLUMN `current_price_per_m2` FLOAT NOT NULL COMMENT '현재 m²당 단가 (만원/㎡, baseDate 시점)',
MODIFY COLUMN `predicted_1y_price_per_m2` FLOAT NULL DEFAULT NULL COMMENT '1년 후 예측 m²당 단가 (만원/㎡, baseDate+1년)',
MODIFY COLUMN `predicted_3y_price_per_m2` FLOAT NULL DEFAULT NULL COMMENT '3년 후 예측 m²당 단가 (만원/㎡, baseDate+3년)',
MODIFY COLUMN `expected_return_3y` FLOAT NULL DEFAULT NULL COMMENT '예상 3년 수익률 (%, 예: 15.5는 +15.5%)',
MODIFY COLUMN `confidence` FLOAT NULL DEFAULT NULL COMMENT '모델 신뢰도 (0~1 범위, 1.0이 최고, 0.5 이상 권장)',
MODIFY COLUMN `mae` FLOAT NULL DEFAULT NULL COMMENT '검증 평균절대오차 (Mean Absolute Error, 만원/㎡)',
MODIFY COLUMN `mape` FLOAT NULL DEFAULT NULL COMMENT '검증 평균절대백분율오차 (MAPE %, 예: 5.2는 ±5.2%)',
MODIFY COLUMN `sample_count` INT NOT NULL COMMENT '학습에 사용된 거래 샘플 수 (통계적 유의성 지표)',
MODIFY COLUMN `model_version` VARCHAR(40) NOT NULL COMMENT '모델 버전 ID (예: "lstm-v1", A/B 비교용)',
MODIFY COLUMN `model_meta` JSON NULL DEFAULT NULL COMMENT '모델 메타데이터 JSON (하이퍼파라미터, 학습 설정 등)',
MODIFY COLUMN `trained_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '모델 학습/저장 시각';
