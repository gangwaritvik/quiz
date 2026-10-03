-- CreateTable
CREATE TABLE "QuestionEmbedding" (
    "questionId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "vector" DOUBLE PRECISION[],

    CONSTRAINT "QuestionEmbedding_pkey" PRIMARY KEY ("questionId")
);

-- AddForeignKey
ALTER TABLE "QuestionEmbedding" ADD CONSTRAINT "QuestionEmbedding_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

