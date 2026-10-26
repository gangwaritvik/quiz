import 'server-only';

import { after } from 'next/server';
import { Resend } from 'resend';

import { ApiError } from '@/lib/api';
import { audit } from '@/lib/audit';
import { generateOtpCode, hashSecret, verifySecret } from '@/lib/crypto';
import { prisma } from '@/lib/db';
import type { RequestContext } from '@/lib/session';

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

export const OTP_TTL_SECONDS = 300; // 5 minutes
export const OTP_RESEND_COOLDOWN_SECONDS = 30;
export const OTP_MAX_ATTEMPTS = 5;

const isProd = process.env.NODE_ENV === 'production';
const PROD_DEV_MODE_ACK = 'i-understand-this-is-insecure';
let warnedDevModeInProd = false;

/**
 * Development OTP mode: the generated code is returned to the caller so the
 * login screen can display it, which lets anyone sign in as anyone. It is an
 * explicit opt-in (`OTP_DEV_MODE=true`) and stays OFF in production unless
 * `OTP_DEV_MODE_ALLOW_IN_PRODUCTION=i-understand-this-is-insecure` is also set:
 * an escape hatch for local production-build smoke tests and staging only,
 * never for a deployment with real students on it.
 */
export function isDevOtpMode(): boolean {
  if (process.env.OTP_DEV_MODE !== 'true') return false;
  if (!isProd) return true;
  if (process.env.OTP_DEV_MODE_ALLOW_IN_PRODUCTION !== PROD_DEV_MODE_ACK) return false;
  if (!warnedDevModeInProd) {
    warnedDevModeInProd = true;
    console.warn(
      '[securequiz] WARNING: development OTP mode is ENABLED in production ' +
        '(OTP_DEV_MODE_ALLOW_IN_PRODUCTION is set). Login codes are returned to the browser, ' +
        'so anyone can sign in as any account. Never run this with real users.',
    );
  }
  return true;
}

/** Thrown when an OTP cannot be delivered; the request route maps it to a 503. */
export class OtpDeliveryError extends Error {}

let loggedDeliveryConfigProblem = false;

/**
 * In production (outside dev mode) refuse to issue codes that cannot reach the
 * student instead of silently dropping them. Checked before the account lookup
 * so the failure looks the same for known and unknown identifiers.
 */
function assertDeliveryConfigured() {
  if (!isProd || isDevOtpMode()) return;
  const from = process.env.OTP_FROM_EMAIL;
  const problem = !resend
    ? 'RESEND_API_KEY is not set'
    : !from
      ? 'OTP_FROM_EMAIL is not set'
      : /@resend\.dev\b/i.test(from)
        ? 'OTP_FROM_EMAIL uses the resend.dev sandbox sender, which only delivers to the Resend account owner'
        : null;
  if (!problem) return;
  if (!loggedDeliveryConfigProblem) {
    loggedDeliveryConfigProblem = true;
    console.error(`[securequiz] OTP email delivery is misconfigured: ${problem}. No codes can be sent.`);
  }
  throw new OtpDeliveryError(problem);
}

/**
 * Rate-limit key for an identifier: the user id when the account exists, so a
 * student's roll number and email share one bucket; otherwise the normalised
 * string, so unknown identifiers are limited exactly like real ones.
 */
export async function identifierRateLimitKey(identifier: string) {
  const user = await findUserByIdentifier(identifier);
  return user ? `user:${user.id}` : `id:${identifier.trim().toLowerCase()}`;
}

/** Looks a user up by college email or roll number, case-insensitively. */
export async function findUserByIdentifier(identifier: string) {
  const value = identifier.trim();
  if (value.includes('@')) {
    return prisma.user.findFirst({
      where: { email: { equals: value, mode: 'insensitive' } },
      include: { student: true, admin: true },
    });
  }
  const student = await prisma.student.findFirst({
    where: { rollNumber: { equals: value, mode: 'insensitive' } },
    include: { user: true },
  });
  if (!student) return null;
  return prisma.user.findUnique({
    where: { id: student.userId },
    include: { student: true, admin: true },
  });
}

export interface OtpIssueResult {
  /** True when a code was actually generated (i.e. the account exists). */
  issued: boolean;
  expiresInSeconds: number;
  resendInSeconds: number;
  /** Only ever populated in development OTP mode. */
  devCode?: string;
}

/**
 * Issues a login code.
 *
 * Callers must return an identical response whether or not the account exists —
 * the boolean is for logging and the dev banner only, never for the UI copy.
 */
export async function issueOtp(
  identifier: string,
  context: RequestContext,
): Promise<OtpIssueResult> {
  const baseResult: OtpIssueResult = {
    issued: false,
    expiresInSeconds: OTP_TTL_SECONDS,
    resendInSeconds: OTP_RESEND_COOLDOWN_SECONDS,
  };

  assertDeliveryConfigured();

  const user = await findUserByIdentifier(identifier);
  if (!user || user.status === 'DISABLED') {
    await hashSecret(generateOtpCode()); // same cost as a real issue, so timing does not reveal the account
    await audit({
      action: 'auth.otp_requested',
      context,
      metadata: { identifier, outcome: user ? 'disabled' : 'unknown_account' },
    });
    return baseResult;
  }

  // Enforce the resend cooldown against the most recent live challenge.
  const recent = await prisma.otpChallenge.findFirst({
    where: { userId: user.id, consumedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
  });
  // Inside the cooldown, answer exactly as for an unknown account (no new code):
  // a distinct error here would reveal that the account exists.
  if (recent && Date.now() - recent.createdAt.getTime() < OTP_RESEND_COOLDOWN_SECONDS * 1000) {
    await hashSecret(generateOtpCode());
    return baseResult;
  }

  const code = generateOtpCode();
  const codeHash = await hashSecret(code);

  const [, challenge] = await prisma.$transaction([
    // A new code invalidates every outstanding one for this account.
    prisma.otpChallenge.updateMany({
      where: { userId: user.id, consumedAt: null },
      data: { consumedAt: new Date() },
    }),
    prisma.otpChallenge.create({
      data: {
        userId: user.id,
        codeHash,
        expiresAt: new Date(Date.now() + OTP_TTL_SECONDS * 1000),
        maxAttempts: OTP_MAX_ATTEMPTS,
        requestIpHash: context.ipHash,
      },
    }),
  ]);

  await audit({
    action: 'auth.otp_requested',
    userId: user.id,
    context,
    metadata: { outcome: 'issued' },
  });

  if (isDevOtpMode()) {
    // Never write a login secret to production logs, even with the escape hatch on.
    if (!isProd) console.info(`[securequiz] development OTP for ${user.email}: ${code}`);
  } else {
    // Sent after the response, so email latency cannot tell a real account from an unknown one.
    after(async () => {
      try {
        await deliverOtp(user.email, code);
      } catch (error) {
        // Kill the undelivered code so the resend cooldown does not block a retry.
        await prisma.otpChallenge.updateMany({
          where: { id: challenge.id, consumedAt: null },
          data: { consumedAt: new Date() },
        });
        console.error('[securequiz] OTP email failed', error);
      }
    });
  }

  return {
    issued: true,
    expiresInSeconds: OTP_TTL_SECONDS,
    resendInSeconds: OTP_RESEND_COOLDOWN_SECONDS,
    ...(isDevOtpMode() ? { devCode: code } : {}),
  };
}

/**
 * Delivery adapter, backed by Resend. Outside production it falls back to
 * logging the code when RESEND_API_KEY is not set, so local testing works
 * without an email account; in production assertDeliveryConfigured() has
 * already refused that case. Throws OtpDeliveryError when Resend rejects a send.
 */
async function deliverOtp(email: string, code: string) {
  if (!resend) {
    console.warn(
      `[securequiz] RESEND_API_KEY is not set; code for ${email} was not sent. ` +
        `Code (server log only): ${code}. Set RESEND_API_KEY in .env to send real email.`,
    );
    return;
  }

  const from = process.env.OTP_FROM_EMAIL ?? 'SecureQuiz <onboarding@resend.dev>';
  const minutes = Math.round(OTP_TTL_SECONDS / 60);

  const { error } = await resend.emails.send({
    from,
    to: email,
    subject: `Your SecureQuiz sign-in code is ${code}`,
    text: `Your SecureQuiz sign-in code is ${code}.\n\nIt expires in ${minutes} minutes. If you didn't request this, you can ignore this email.`,
    html: otpEmailHtml(code, minutes),
  });

  if (error) {
    // Fail the request rather than telling the student a code is on its way.
    // (A per-recipient failure is only observable for real accounts; that is
    // the accepted price of not stranding students without a code.)
    console.error(`[securequiz] Resend delivery failed for ${email}:`, error);
    throw new OtpDeliveryError('Resend rejected the send');
  }
}

function otpEmailHtml(code: string, minutes: number) {
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:420px;margin:0 auto;padding:32px 24px">
  <p style="font-size:14px;color:#667085;margin:0 0 4px">Your SecureQuiz sign-in code</p>
  <p style="font-size:32px;font-weight:700;letter-spacing:6px;color:#101828;margin:0 0 16px">${code}</p>
  <p style="font-size:13px;line-height:1.6;color:#667085;margin:0">
    This code expires in ${minutes} minutes. If you didn't request this, you can safely ignore this email.
  </p>
</div>`;
}

export interface OtpVerification {
  userId: string;
  role: 'STUDENT' | 'ADMIN';
}

export async function verifyOtp(
  identifier: string,
  code: string,
  context: RequestContext,
): Promise<OtpVerification> {
  const genericFailure = new ApiError(
    'VALIDATION',
    'That code is incorrect or has expired. Try again, or request a new code.',
  );

  const user = await findUserByIdentifier(identifier);
  if (!user || user.status === 'DISABLED') {
    await audit({ action: 'auth.otp_failed', context, metadata: { identifier } });
    throw genericFailure;
  }

  const challenge = await prisma.otpChallenge.findFirst({
    where: { userId: user.id, consumedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
  });

  if (!challenge) {
    await audit({
      action: 'auth.otp_failed',
      userId: user.id,
      context,
      metadata: { reason: 'no_active_challenge' },
    });
    throw genericFailure;
  }

  // Claim an attempt atomically before the slow hash comparison, so parallel
  // guesses cannot all slip past the attempt limit.
  const claimed = await prisma.otpChallenge.updateMany({
    where: {
      id: challenge.id,
      consumedAt: null,
      expiresAt: { gt: new Date() },
      attempts: { lt: challenge.maxAttempts },
    },
    data: { attempts: { increment: 1 } },
  });
  if (claimed.count === 0) {
    await audit({
      action: 'auth.otp_failed',
      userId: user.id,
      context,
      metadata: { reason: 'attempts_exhausted' },
    });
    throw genericFailure;
  }

  const valid = await verifySecret(code, challenge.codeHash);

  // Consume conditionally: only one concurrent correct guess can win.
  const consumed = valid
    ? await prisma.otpChallenge.updateMany({
        where: { id: challenge.id, consumedAt: null },
        data: { consumedAt: new Date() },
      })
    : { count: 0 };

  if (consumed.count !== 1) {
    await audit({
      action: 'auth.otp_failed',
      userId: user.id,
      context,
      metadata: { reason: valid ? 'already_consumed' : 'wrong_code' },
    });
    // Same message as for unknown accounts: no attempts-remaining hint.
    throw genericFailure;
  }

  return { userId: user.id, role: user.role };
}
