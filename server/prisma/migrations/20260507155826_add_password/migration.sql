/*
  Warnings:

  - Added the required column `password` to the `t_user` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE `t_user` ADD COLUMN `password` VARCHAR(191) NOT NULL;
