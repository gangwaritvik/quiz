import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Searching for student gangwaritvik...');

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
    throw new Error('Student Ritvik Gangwar (gangwaritvik) not found in database!');
  }

  console.log(`Found student: ${student.user.name} (${student.user.email}) | Roll: ${student.rollNumber} | ID: ${student.id}`);

  // Find faculty author
  const faculty = await prisma.admin.findFirst({
    include: { user: true },
  });

  if (!faculty) {
    throw new Error('Faculty admin not found in database!');
  }

  console.log(`Authoring as faculty: ${faculty.user.name} (${faculty.user.email}) | ID: ${faculty.id}`);

  // Find Computer Networks subject
  const subject = await prisma.subject.findUnique({
    where: { code: 'CS304' },
  });

  if (!subject) {
    throw new Error('Subject CS304 not found!');
  }

  // Check existing attempts for this student
  const existingAttempts = await prisma.quizAttempt.findMany({
    where: { studentId: student.id },
    include: { quiz: true },
  });

  console.log(`Existing attempts for ${student.user.name}:`, existingAttempts.map(a => ({
    attemptId: a.id,
    quizId: a.quizId,
    quizTitle: a.quiz.title,
    status: a.status,
  })));

  const now = new Date();
  const startsAt = new Date(now.getTime() - 15 * 60 * 1000); // Window open 15 mins ago
  const endsAt = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000); // Open for 14 days

  // Ensure the quiz title is one that the student hasn't already attempted
  const attemptedTitles = new Set(existingAttempts.map(a => a.quiz.title));
  
  let quizTitle = 'Sample Examination — Screen & Display Lockdown';
  if (attemptedTitles.has(quizTitle)) {
    quizTitle = `Sample Examination — Screen & Display Lockdown (${new Date().toLocaleDateString('en-GB')})`;
  }

  console.log(`Using quiz title: "${quizTitle}"`);

  // Complete security settings including the newly added lockQuestionNavigation
  const securitySettings = {
    randomizeQuestions: true,
    randomizeOptions: true,
    singleAttempt: true,
    requireFullscreen: true,
    detectTabSwitch: true,
    blockCopyPaste: true,
    bindDeviceSession: true,
    cameraMonitoring: true,
    microphoneMonitoring: true,
    lockQuestionNavigation: true, // The new security protocol!
    blockMultipleDisplays: true, // Single display enforced
    requireScreenShare: true, // Entire-screen sharing required
    maxFullscreenExits: 3,
    releaseResults: true,
    releaseAnswers: false,
  };

  let quiz = await prisma.quiz.findFirst({
    where: { title: quizTitle },
  });

  if (quiz) {
    console.log(`Updating existing quiz ID: ${quiz.id}...`);
    quiz = await prisma.quiz.update({
      where: { id: quiz.id },
      data: {
        status: 'PUBLISHED',
        startsAt,
        endsAt,
        ...securitySettings,
      },
    });
  } else {
    console.log('Creating new sample quiz with all security protocols enabled...');
    quiz = await prisma.quiz.create({
      data: {
        title: quizTitle,
        description:
          'Sample examination demonstrating all security protocols active: full-screen lock, tab switch detection, clipboard restriction, device & session binding, webcam proctoring, microphone proctoring, and locked forward-only question navigation.',
        subjectId: subject.id,
        authorId: faculty.id,
        status: 'PUBLISHED',
        durationMinutes: 30,
        questionCount: 10,
        totalMarks: 10,
        sourceMode: 'POOL',
        poolTopicIds: [],
        easyPct: 30,
        mediumPct: 50,
        hardPct: 20,
        startsAt,
        endsAt,
        ...securitySettings,
      },
    });
  }

  console.log(`Quiz ready: "${quiz.title}" (ID: ${quiz.id})`);

  // Assign quiz to student
  const assignment = await prisma.quizAssignment.upsert({
    where: {
      quizId_studentId: {
        quizId: quiz.id,
        studentId: student.id,
      },
    },
    create: {
      quizId: quiz.id,
      studentId: student.id,
      assignedAt: now,
    },
    update: {
      assignedAt: now,
    },
  });

  console.log(`Assigned quiz to student ${student.user.name} (Assignment ID: ${assignment.id})`);

  // Create audit log entry
  await prisma.auditLog.create({
    data: {
      userId: faculty.userId,
      action: 'admin.quiz_assigned',
      entityType: 'QuizAssignment',
      entityId: assignment.id,
      metadata: {
        quizId: quiz.id,
        quizTitle: quiz.title,
        studentId: student.id,
        studentRoll: student.rollNumber,
        studentEmail: student.user.email,
        securityProtocols: securitySettings,
      },
    },
  });

  console.log('Audit log entry recorded.');
  console.log('\n========================================');
  console.log('ASSIGNMENT SUCCESSFUL');
  console.log('========================================');
  console.log(`Student Name: ${student.user.name}`);
  console.log(`Student Email: ${student.user.email}`);
  console.log(`Student Roll: ${student.rollNumber}`);
  console.log(`Quiz Title: ${quiz.title}`);
  console.log(`Quiz ID: ${quiz.id}`);
  console.log(`Quiz URL for Student: /quizzes/${quiz.id}`);
  console.log(`Faculty Admin URL: /admin/quizzes/${quiz.id}`);
  console.log('Security Protocols Active:');
  console.log('  [x] Fullscreen Required (requireFullscreen: true)');
  console.log('  [x] Tab Switch Detection (detectTabSwitch: true)');
  console.log('  [x] Copy/Paste Blocked (blockCopyPaste: true)');
  console.log('  [x] Device & Session Binding (bindDeviceSession: true)');
  console.log('  [x] Camera Monitoring (cameraMonitoring: true)');
  console.log('  [x] Microphone Monitoring (microphoneMonitoring: true)');
  console.log('  [x] Lock Question Navigation / Forward-only (lockQuestionNavigation: true)');
  console.log('  [x] Single Display Enforced (blockMultipleDisplays: true)');
  console.log('  [x] Mandatory Entire-Screen Share (requireScreenShare: true)');
  console.log('  [x] Single Attempt Only (singleAttempt: true)');
  console.log('  [x] Randomize Questions (randomizeQuestions: true)');
  console.log('  [x] Randomize Options (randomizeOptions: true)');
  console.log('  [x] Max Fullscreen Exits Tolerated (maxFullscreenExits: 3)');
  console.log('========================================\n');
}

main()
  .catch((e) => {
    console.error('Failed to assign quiz:', e);
    process.exit(1);
  })
  .finally(() => prisma['$disconnect']());
