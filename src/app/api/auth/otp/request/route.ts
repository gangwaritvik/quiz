import { assertSameOrigin, ok, parseBody, route } from '@/lib/api';
import { issueOtp } from '@/lib/otp';
import { RATE_LIMITS, enforceRateLimit } from '@/lib/rate-limit';
import { getRequestContext } from '@/lib/session';
import { otpRequestSchema } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route(async (request: Request) => {
  assertSameOrigin(request);

  const context = await getRequestContext();
  const body = await parseBody(request, otpRequestSchema);

  // Two independent limits: one stops a single browser hammering the endpoint,
  // the other stops an attacker cycling identifiers from one address.
  enforceRateLimit(RATE_LIMITS.otpRequest, `ip:${context.ipHash}`);
  enforceRateLimit(RATE_LIMITS.otpRequest, `id:${body.identifier.toLowerCase()}`);

  const result = await issueOtp(body.identifier, context);

  // The response is intentionally identical for known and unknown accounts so
  // the endpoint cannot be used to enumerate valid student IDs.
  return ok({
    sent: true,
    expiresInSeconds: result.expiresInSeconds,
    resendInSeconds: result.resendInSeconds,
    maskedDestination: result.maskedDestination ?? null,
    devCode: result.devCode ?? null,
  });
});
