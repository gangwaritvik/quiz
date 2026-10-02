import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const sampleQuizzes = await prisma.quiz.findMany({
    where: { title: { contains: 'Sample Examination' } },
  });

  for (const q of sampleQuizzes) {
    await prisma.quiz.update({
      where: { id: q.id },
      data: {
        singleAttempt: false,
        status: 'PUBLISHED',
      },
    });
    console.log(`Enabled unlimited attempts on sample quiz "${q.title}" (${q.id}).`);
  }
}

main().catch(console.error).finally(() => prisma['$disconnect']());
