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
    throw new Error('Student Ritvik Gangwar not found!');
  }

  const quizId = 'cmun9pd8x0001irwok0y3mmbq';

  // 1. Delete previous attempts on this test quiz so student can start fresh
  const deletedAttempts = await prisma.quizAttempt.deleteMany({
    where: {
      quizId,
      studentId: student.id,
    },
  });

  console.log(`Deleted ${deletedAttempts.count} previous attempt(s) on quiz ${quizId}.`);

  // 2. Set singleAttempt: false so the user can test multiple times without lockout
  const updatedQuiz = await prisma.quiz.update({
    where: { id: quizId },
    data: {
      singleAttempt: false, // Allow unlimited attempts for testing!
      blockMultipleDisplays: true,
      requireScreenShare: true,
      lockQuestionNavigation: true,
      requireFullscreen: true,
      detectTabSwitch: true,
      blockCopyPaste: true,
      cameraMonitoring: true,
      microphoneMonitoring: true,
      status: 'PUBLISHED',
    },
  });

  console.log(`Updated quiz "${updatedQuiz.title}" (singleAttempt: ${updatedQuiz.singleAttempt}).`);
  console.log('Quiz is ready for unlimited testing!');
}

main().catch(console.error).finally(() => prisma['$disconnect']());
