import { assertSameOrigin, ok, parseBody, route } from '@/lib/api';
import { audit } from '@/lib/audit';
import { prisma } from '@/lib/db';
import { identifierRateLimitKey, verifyOtp } from '@/lib/otp';
import { RATE_LIMITS, enforceRateLimit } from '@/lib/rate-limit';
import { ROLE_HOME } from '@/lib/roles';
import { createSession, getRequestContext } from '@/lib/session';
import { otpVerifySchema } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route(async (request: Request) => {
  assertSameOrigin(request);

  const context = await getRequestContext();
  const body = await parseBody(request, otpVerifySchema);

  // Per-account limit protects the code; the per-IP one is a campus-sized abuse guard.
  enforceRateLimit(RATE_LIMITS.otpVerifyPerIp, `ip:${context.ipHash}`);
  enforceRateLimit(RATE_LIMITS.otpVerify, await identifierRateLimitKey(body.identifier));

  const { userId, role } = await verifyOtp(body.identifier, body.code, context);

  const { session } = await createSession({ userId, context });

  await prisma.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });
  await audit({
    action: 'auth.login',
    userId,
    context,
    metadata: { device: context.deviceLabel },
  });

  return ok({
    role,
    redirectTo: ROLE_HOME[role],
    user: session
      ? { name: session.name, email: session.email, role: session.role }
      : null,
  });
});
