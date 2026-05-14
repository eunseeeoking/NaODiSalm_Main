-- CreateTable
CREATE TABLE `t_user_token` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL,
    `refresh_token_hash` VARCHAR(191) NOT NULL,
    `access_token_hash` VARCHAR(191) NULL,
    `access_expires_at` DATETIME(3) NULL,
    `refresh_expires_at` DATETIME(3) NOT NULL,
    `remember_me` BOOLEAN NOT NULL DEFAULT false,
    `user_agent` VARCHAR(255) NULL,
    `ip_address` VARCHAR(64) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `revoked_at` DATETIME(3) NULL,

    UNIQUE INDEX `t_user_token_refresh_token_hash_key`(`refresh_token_hash`),
    INDEX `t_user_token_user_id_idx`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `t_user_token` ADD CONSTRAINT `t_user_token_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `t_user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
