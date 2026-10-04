-- CreateEnum
CREATE TYPE "BloomLevel" AS ENUM ('REMEMBER', 'UNDERSTAND', 'APPLY', 'ANALYSE');

-- AlterTable
ALTER TABLE "questions" ADD COLUMN     "bloom" "BloomLevel";

