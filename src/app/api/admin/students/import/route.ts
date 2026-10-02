import { assertSameOrigin, ok, parseBody, route } from '@/lib/api';
import { audit } from '@/lib/audit';
import { requireAdmin } from '@/lib/auth';
import { type ImportIssue, parseCsv, stripHeader } from '@/lib/csv';
import { prisma } from '@/lib/db';
import { RATE_LIMITS, enforceRateLimit } from '@/lib/rate-limit';
import { getRequestContext } from '@/lib/session';
import { createStudentSchema, importStudentsSchema } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * CSV roster import.
 * Columns: name, email, rollNumber, department, section, semester
 *
 * Rows are validated with the same schema the single-student form uses, so the
 * two paths cannot drift apart.
 */
export const POST = route(async (request: Request) => {
  assertSameOrigin(request);

  const session = await requireAdmin();
  const context = await getRequestContext();
  enforceRateLimit(RATE_LIMITS.adminWrite, `student-import:${session.userId}`);

  const body = await parseBody(request, importStudentsSchema);
  const rows = stripHeader(parseCsv(body.csv), ['name', 'student name']);

  const issues: ImportIssue[] = [];
  let imported = 0;
  let skipped = 0;

  for (const [index, row] of rows.entries()) {
    const rowNumber = index + 2;
    const [name, email, rollNumber, department, section, semester] = row;

    const parsed = createStudentSchema.safeParse({
      name,
      email,
      rollNumber,
      department,
      section,
      semester: semester || 1,
    });

    if (!parsed.success) {
      issues.push({
        row: rowNumber,
        message: parsed.error.issues[0]?.message ?? 'Invalid row.',
      });
      continue;
    }

    const existing = await prisma.student.findFirst({
      where: {
        OR: [
          { rollNumber: { equals: parsed.data.rollNumber, mode: 'insensitive' } },
          { user: { email: { equals: parsed.data.email, mode: 'insensitive' } } },
        ],
      },
    });

    // Re-importing a roster is routine; duplicates are skipped rather than
    // treated as errors.
    if (existing) {
      skipped += 1;
      continue;
    }

    await prisma.student.create({
      data: {
        rollNumber: parsed.data.rollNumber,
        department: parsed.data.department,
        section: parsed.data.section,
        semester: parsed.data.semester,
        user: {
          create: {
            name: parsed.data.name,
            email: parsed.data.email.toLowerCase(),
            role: 'STUDENT',
            status: 'ACTIVE',
          },
        },
      },
    });

    imported += 1;
  }

  await audit({
    action: 'admin.students_imported',
    userId: session.userId,
    context,
    metadata: { imported, skipped, rejected: issues.length },
  });

  return ok({ imported, skipped, rejected: issues.length, issues: issues.slice(0, 50) });
});
