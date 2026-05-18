/*
  Warnings:

  - A unique constraint covering the columns `[apt_seq]` on the table `t_apt_complex` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE `t_apt_complex` ADD COLUMN `apt_seq` VARCHAR(40) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `t_apt_complex_apt_seq_key` ON `t_apt_complex`(`apt_seq`);
