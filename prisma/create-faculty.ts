/**
 * Create one faculty (ADMIN) account — no demo data. Safe for production.
 *
 *   npm run db:create-faculty -- --email a@college.edu --name "Dr X" [--department CS] [--employee-id E123]
 */
import { PrismaClient } from '@prisma/client';
import { randomInt } from 'node:crypto';
import { parseArgs } from 'node:util';
import { z } from 'zod';

const usage =
  'Usage: create-faculty --email a@college.edu --name "Dr X" [--department CS] [--employee-id E123]';

const schema = z.object({
  email: z.string().trim().toLowerCase().email().max(160),
  name: z.string().trim().min(2).max(120),
  department: z.string().trim().min(1).max(120).default('General'),
  'employee-id': z
    .string()
    .trim()
    .min(1)
    .max(40)
    .default(() => `FAC${randomInt(100000, 1000000)}`),
});

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

async function main() {
  let values;
  try {
    ({ values } = parseArgs({
      options: {
        email: { type: 'string' },
        name: { type: 'string' },
        department: { type: 'string' },
        'employee-id': { type: 'string' },
      },
    }));
  } catch (error) {
    fail(`${(error as Error).message}\n${usage}`);
  }

  const parsed = schema.safeParse(values);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  --${i.path.join('.')}: ${i.message}`).join('\n');
    fail(`Invalid input:\n${issues}\n${usage}`);
  }
  const { email, name, department, 'employee-id': employeeId } = parsed.data;

  const prisma = new PrismaClient();
  try {
    // Same case-insensitive matching the login flow uses (src/lib/otp.ts).
    const [emailTaken, idTaken] = await Promise.all([
      prisma.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } }),
      prisma.admin.findUnique({ where: { employeeId } }),
    ]);
    if (emailTaken) fail(`A user with email ${email} already exists (role ${emailTaken.role}). Nothing created.`);
    if (idTaken) fail(`Employee ID ${employeeId} is already in use. Nothing created.`);

    await prisma.admin.create({
      data: {
        employeeId,
        department,
        user: { create: { email, name, role: 'ADMIN', status: 'ACTIVE' } },
      },
    });
    console.info(`Created faculty account ${email} (employee ID ${employeeId}). Sign in with this email via OTP.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => fail(`Failed to create faculty account: ${(error as Error).message}`));
