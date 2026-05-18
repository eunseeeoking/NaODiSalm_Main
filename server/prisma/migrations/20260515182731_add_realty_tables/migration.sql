-- CreateTable
CREATE TABLE `t_legal_dong` (
    `code` VARCHAR(10) NOT NULL,
    `sido` VARCHAR(40) NOT NULL,
    `sigungu` VARCHAR(60) NOT NULL,
    `dong` VARCHAR(60) NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,

    PRIMARY KEY (`code`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `t_apt_complex` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(120) NOT NULL,
    `sigungu_code` VARCHAR(5) NOT NULL,
    `legal_dong` VARCHAR(60) NOT NULL,
    `jibun` VARCHAR(60) NULL,
    `road_addr` VARCHAR(200) NULL,
    `built_year` INTEGER NULL,
    `lat` DOUBLE NULL,
    `lng` DOUBLE NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `t_apt_complex_sigungu_code_legal_dong_idx`(`sigungu_code`, `legal_dong`),
    UNIQUE INDEX `uniq_complex_fingerprint`(`sigungu_code`, `legal_dong`, `name`, `built_year`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `t_apt_trade` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `complex_id` INTEGER NOT NULL,
    `deal_date` DATE NOT NULL,
    `price_manwon` INTEGER NOT NULL,
    `area_m2` DOUBLE NOT NULL,
    `floor` INTEGER NULL,
    `built_year` INTEGER NULL,
    `raw_payload` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `t_apt_trade_complex_id_deal_date_idx`(`complex_id`, `deal_date`),
    UNIQUE INDEX `uniq_trade`(`complex_id`, `deal_date`, `area_m2`, `floor`, `price_manwon`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `t_apt_rent` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `complex_id` INTEGER NOT NULL,
    `contract_date` DATE NOT NULL,
    `deposit_manwon` INTEGER NOT NULL,
    `monthly_manwon` INTEGER NOT NULL DEFAULT 0,
    `contract_type` ENUM('JEONSE', 'WOLSE') NOT NULL,
    `area_m2` DOUBLE NOT NULL,
    `floor` INTEGER NULL,
    `built_year` INTEGER NULL,
    `raw_payload` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `t_apt_rent_complex_id_contract_date_idx`(`complex_id`, `contract_date`),
    UNIQUE INDEX `uniq_rent`(`complex_id`, `contract_date`, `area_m2`, `floor`, `deposit_manwon`, `monthly_manwon`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `t_apt_trade` ADD CONSTRAINT `t_apt_trade_complex_id_fkey` FOREIGN KEY (`complex_id`) REFERENCES `t_apt_complex`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `t_apt_rent` ADD CONSTRAINT `t_apt_rent_complex_id_fkey` FOREIGN KEY (`complex_id`) REFERENCES `t_apt_complex`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
