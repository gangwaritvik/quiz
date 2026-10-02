import { ok, route } from '@/lib/api';
import { requireAdmin } from '@/lib/auth';
import { prisma } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Reference data used to populate admin form controls. */
export const GET = route(async () => {
  await requireAdmin();

  const [subjects, sections, questionCounts] = await Promise.all([
    prisma.subject.findMany({
      orderBy: { name: 'asc' },
      include: { topics: { orderBy: { name: 'asc' }, select: { id: true, name: true } } },
    }),
    prisma.student.findMany({
      distinct: ['department', 'section'],
      select: { department: true, section: true },
      orderBy: [{ department: 'asc' }, { section: 'asc' }],
    }),
    prisma.question.groupBy({
      by: ['subjectId', 'difficulty'],
      _count: { _all: true },
      // Mirrors the selector: inline quiz questions are not part of the pool.
      where: { active: true, adHoc: false },
    }),
  ]);

  // Lets the quiz form warn before a pool is too small for the requested count.
  const poolBySubject: Record<string, { EASY: number; MEDIUM: number; HARD: number; total: number }> =
    {};
  for (const row of questionCounts) {
    const entry = poolBySubject[row.subjectId] ?? { EASY: 0, MEDIUM: 0, HARD: 0, total: 0 };
    entry[row.difficulty] = row._count._all;
    entry.total += row._count._all;
    poolBySubject[row.subjectId] = entry;
  }

  return ok({
    subjects: subjects.map((subject) => ({
      id: subject.id,
      name: subject.name,
      code: subject.code,
      topics: subject.topics,
      pool: poolBySubject[subject.id] ?? { EASY: 0, MEDIUM: 0, HARD: 0, total: 0 },
    })),
    departments: [...new Set(sections.map((s) => s.department))],
    sections,
  });
});
