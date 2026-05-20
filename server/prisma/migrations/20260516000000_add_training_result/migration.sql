-- CreateTable
CREATE TABLE `t_training_result` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `complex_id` INTEGER NULL,
    `sigungu_code` VARCHAR(5) NOT NULL,
    `legal_dong` VARCHAR(60) NOT NULL,
    `area_bucket` ENUM('SMALL', 'MEDIUM', 'LARGE_MID', 'LARGE') NOT NULL,
    `age_bucket` ENUM('NEW', 'SEMI_NEW', 'MID', 'OLD') NOT NULL,
    `base_date` DATE NOT NULL,
    `current_price_per_m2` DOUBLE NOT NULL,
    `predicted_1y_price_per_m2` DOUBLE NULL,
    `predicted_3y_price_per_m2` DOUBLE NULL,
    `expected_return_3y` DOUBLE NULL,
    `confidence` DOUBLE NULL,
    `mae` DOUBLE NULL,
    `mape` DOUBLE NULL,
    `sample_count` INTEGER NOT NULL,
    `model_version` VARCHAR(40) NOT NULL,
    `model_meta` JSON NULL,
    `trained_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `t_training_result_sigungu_code_legal_dong_idx`(`sigungu_code`, `legal_dong`),
    INDEX `t_training_result_complex_id_idx`(`complex_id`),
    INDEX `t_training_result_trained_at_idx`(`trained_at`),
    UNIQUE INDEX `uniq_training_result`(`sigungu_code`, `legal_dong`, `area_bucket`, `age_bucket`, `complex_id`, `base_date`, `model_version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
