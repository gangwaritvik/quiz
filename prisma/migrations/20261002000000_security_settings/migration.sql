-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ExamEventType" ADD VALUE 'MULTIPLE_DISPLAYS_DETECTED';
ALTER TYPE "ExamEventType" ADD VALUE 'SCREEN_SHARE_STOPPED';
ALTER TYPE "ExamEventType" ADD VALUE 'SCREEN_SHARE_PERMISSION_LOST';

-- AlterTable
ALTER TABLE "quizzes" ADD COLUMN     "blockMultipleDisplays" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lockQuestionNavigation" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "requireScreenShare" BOOLEAN NOT NULL DEFAULT false;

