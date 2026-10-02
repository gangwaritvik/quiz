import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const student = await prisma.student.findFirst({
    where: {
      user: {
        OR: [
          { email: { contains: 'gangwar', mode: 'insensitive' } },
          { name: { contains: 'Ritvik', mode: 'insensitive' } },
        ],
      },
    },
    include: { user: true },
  });

  if (!student) {
    console.log('No student found');
    return;
  }

  console.log(`Student: ${student.user.name} (${student.user.email}) ID: ${student.id}`);

  const assignments = await prisma.quizAssignment.findMany({
    where: { studentId: student.id },
    include: {
      quiz: {
        include: {
          attempts: {
            where: { studentId: student.id },
          },
        },
      },
    },
  });

  console.log('Assignments count:', assignments.length);
  for (const a of assignments) {
    console.log(`--- Quiz: "${a.quiz.title}" (ID: ${a.quiz.id}) ---`);
    console.log(`  Status: ${a.quiz.status}`);
    console.log(`  Attempts: ${a.quiz.attempts.length}`);
    for (const att of a.quiz.attempts) {
      console.log(`    - Attempt ID: ${att.id}, status: ${att.status}, score: ${att.score}/${att.maxScore}`);
    }
  }
}

main().catch(console.error).finally(() => prisma['$disconnect']());
