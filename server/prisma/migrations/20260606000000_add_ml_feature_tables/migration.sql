-- CreateTable
CREATE TABLE `t_macro_rate` (
    `ym` VARCHAR(7) NOT NULL,
    `base_rate` DOUBLE NULL,
    `mortgage_rate` DOUBLE NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`ym`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `t_macro_econ` (
    `ym` VARCHAR(7) NOT NULL,
    `cpi` DOUBLE NULL,
    `m2` DOUBLE NULL,
    `household_loan` DOUBLE NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`ym`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `t_housing_supply` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `sigungu_code` VARCHAR(5) NOT NULL,
    `ym` VARCHAR(7) NOT NULL,
    `unsold` INTEGER NULL,
    `move_in_units` INTEGER NULL,
    `permit_units` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `uniq_housing_supply`(`sigungu_code`, `ym`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
