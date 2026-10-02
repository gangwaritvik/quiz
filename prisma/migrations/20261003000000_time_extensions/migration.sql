-- AlterTable
ALTER TABLE "quizzes" ADD COLUMN     "maxExtensionMinutes" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "quiz_assignments" ADD COLUMN     "extraMinutes" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "quiz_attempts" ADD COLUMN     "extraMinutes" INTEGER NOT NULL DEFAULT 0;
