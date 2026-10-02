import { NextResponse } from 'next/server';

import { assertSameOrigin, ok, parseBody, route } from '@/lib/api';
import { OtpDeliveryError, identifierRateLimitKey, issueOtp } from '@/lib/otp';
import { RATE_LIMITS, enforceRateLimit } from '@/lib/rate-limit';
import { getRequestContext } from '@/lib/session';
import { otpRequestSchema } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route(async (request: Request) => {
  assertSameOrigin(request);

  const context = await getRequestContext();
  const body = await parseBody(request, otpRequestSchema);

  // The protective limit is per account/identifier; the per-IP one is only a
  // coarse guard, because a whole campus can sit behind one NAT address.
  enforceRateLimit(RATE_LIMITS.otpRequestPerIp, `ip:${context.ipHash}`);
  enforceRateLimit(RATE_LIMITS.otpRequest, await identifierRateLimitKey(body.identifier));

  let result;
  try {
    result = await issueOtp(body.identifier, context);
  } catch (error) {
    if (!(error instanceof OtpDeliveryError)) throw error;
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: 'SERVER_ERROR',
          message: 'We could not send your code. Please contact your faculty.',
        },
      },
      { status: 503 },
    );
  }

  // The response is intentionally identical for known and unknown accounts so
  // the endpoint cannot be used to enumerate valid student IDs.
  return ok({
    sent: true,
    expiresInSeconds: result.expiresInSeconds,
    resendInSeconds: result.resendInSeconds,
    devCode: result.devCode ?? null,
  });
});
