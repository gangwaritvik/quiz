-- CreateEnum
CREATE TYPE "AppealStatus" AS ENUM ('OPEN', 'UPHELD', 'REJECTED');

-- CreateTable
CREATE TABLE "result_appeals" (
    "id" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "AppealStatus" NOT NULL DEFAULT 'OPEN',
    "facultyNote" TEXT,
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "result_appeals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "result_appeals_attemptId_idx" ON "result_appeals"("attemptId");

-- CreateIndex
CREATE INDEX "result_appeals_status_createdAt_idx" ON "result_appeals"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "result_appeals" ADD CONSTRAINT "result_appeals_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "quiz_attempts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
