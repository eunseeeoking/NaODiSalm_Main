-- CreateTable
CREATE TABLE `t_commute_matrix` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `cache_key` VARCHAR(40) NOT NULL,
    `work_lat` DOUBLE NOT NULL,
    `work_lng` DOUBLE NOT NULL,
    `work_label` VARCHAR(120) NULL,
    `legal_dong_code` VARCHAR(10) NOT NULL,
    `transit_minutes` INTEGER NOT NULL,
    `transit_transfers` INTEGER NULL,
    `transit_cost_won` INTEGER NULL,
    `car_minutes` INTEGER NOT NULL,
    `computed_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `t_commute_matrix_cache_key_idx`(`cache_key`),
    UNIQUE INDEX `uniq_commute`(`cache_key`, `legal_dong_code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
