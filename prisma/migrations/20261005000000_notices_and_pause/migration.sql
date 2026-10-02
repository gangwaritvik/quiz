-- AlterTable
ALTER TABLE "quiz_attempts" ADD COLUMN     "pausedAt" TIMESTAMP(3),
ADD COLUMN     "pausedTotalMs" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "quiz_notices" (
    "id" TEXT NOT NULL,
    "quizId" TEXT NOT NULL,
    "authorId" TEXT,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quiz_notices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "quiz_notices_quizId_createdAt_idx" ON "quiz_notices"("quizId", "createdAt");

-- AddForeignKey
ALTER TABLE "quiz_notices" ADD CONSTRAINT "quiz_notices_quizId_fkey" FOREIGN KEY ("quizId") REFERENCES "quizzes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
