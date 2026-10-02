import { ok, parseQuery, route } from '@/lib/api';
import { requireAdmin } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { ownQuizWhere } from '@/lib/ownership';
import { RATE_LIMITS, enforceRateLimit } from '@/lib/rate-limit';
import { adminSearchSchema } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Console-wide lookup: quizzes, students and bank questions.
 *
 * Faculty-only, and deliberately narrow — it returns names and links, never
 * answer keys or scores. Everything it points at re-authorises on open, so
 * this is a way to navigate, not a way to read.
 */
export const GET = route(async (request: Request) => {
  const session = await requireAdmin();
  enforceRateLimit(RATE_LIMITS.read, `admin-search:${session.userId}`);

  const { q } = parseQuery(request, adminSearchSchema);
  const term = q.trim();
  if (term.length < 2) return ok({ quizzes: [], students: [], questions: [] });

  const contains = { contains: term, mode: 'insensitive' as const };

  const [quizzes, students, questions] = await Promise.all([
    prisma.quiz.findMany({
      where: { ...ownQuizWhere(session.adminId), title: contains },
      select: {
        id: true,
        title: true,
        status: true,
        subject: { select: { name: true } },
      },
      orderBy: { startsAt: 'desc' },
      take: 5,
    }),
    prisma.student.findMany({
      where: {
        OR: [{ rollNumber: contains }, { user: { name: contains } }],
      },
      select: {
        id: true,
        rollNumber: true,
        section: true,
        user: { select: { name: true } },
      },
      take: 5,
    }),
    prisma.question.findMany({
      // Inline quiz questions are not part of the bank, so they are not
      // browsable here either.
      where: { text: contains, active: true, adHoc: false },
      select: { id: true, text: true, type: true, subject: { select: { name: true } } },
      take: 5,
    }),
  ]);

  return ok({
    quizzes: quizzes.map((quiz) => ({
      id: quiz.id,
      title: quiz.title,
      subtitle: `${quiz.subject.name} · ${quiz.status.toLowerCase()}`,
    })),
    students: students.map((student) => ({
      id: student.id,
      title: student.user.name,
      subtitle: [student.rollNumber, student.section ? `Section ${student.section}` : null]
        .filter(Boolean)
        .join(' · '),
    })),
    questions: questions.map((question) => ({
      id: question.id,
      title: question.text.length > 90 ? `${question.text.slice(0, 89)}…` : question.text,
      subtitle: question.subject.name,
    })),
  });
});
