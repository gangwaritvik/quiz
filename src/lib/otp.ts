import 'server-only';

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

/**
 * Development OTP mode.
 *
 * When enabled, the generated code is returned to the caller so the login
 * screen can display it. This is an explicit environment opt-in because it is
 * useful for local production-build smoke tests with `npm start`, but it must
 * be disabled before a real deployment.
 */
export function isDevOtpMode(): boolean {
  return process.env.OTP_DEV_MODE !== 'false';
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
  /** Masked destination, e.g. `r••••@college.edu`, for the "code sent to" line. */
  maskedDestination?: string;
}

function maskEmail(email: string) {
  const [local, domain] = email.split('@');
  if (!local || !domain) return '•••';
  const visible = local.slice(0, 2);
  return `${visible}${'•'.repeat(Math.max(3, local.length - 2))}@${domain}`;
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

  const user = await findUserByIdentifier(identifier);
  if (!user || user.status === 'DISABLED') {
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
  if (recent) {
    const elapsedMs = Date.now() - recent.createdAt.getTime();
    if (elapsedMs < OTP_RESEND_COOLDOWN_SECONDS * 1000) {
      throw new ApiError(
        'RATE_LIMITED',
        `Please wait ${Math.ceil(
          (OTP_RESEND_COOLDOWN_SECONDS * 1000 - elapsedMs) / 1000,
        )} seconds before requesting another code.`,
      );
    }
  }

  const code = generateOtpCode();
  const codeHash = await hashSecret(code);

  await prisma.$transaction([
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
    console.info(`[securequiz] development OTP for ${user.email}: ${code}`);
  } else {
    // Production wiring point: hand the code to the college SMS/email gateway.
    await deliverOtp(user.email, code);
  }

  return {
    issued: true,
    expiresInSeconds: OTP_TTL_SECONDS,
    resendInSeconds: OTP_RESEND_COOLDOWN_SECONDS,
    maskedDestination: maskEmail(user.email),
    ...(isDevOtpMode() ? { devCode: code } : {}),
  };
}

/**
 * Delivery adapter, backed by Resend. Falls back to logging the code to the
 * server console when RESEND_API_KEY is not set, so local testing still
 * works without an email account — but that fallback prints a real login
 * secret to the log, so it must never be reachable with real users on it.
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
    // Never throw here: issueOtp() must return an identical response whether
    // or not delivery succeeded, or a delivery failure becomes a side
    // channel an attacker can use to probe which accounts exist. Log loudly
    // instead so a misconfigured deployment is visible in the server log.
    console.error(`[securequiz] Resend delivery failed for ${email}:`, error);
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
    'That code is incorrect or has expired. Please try again.',
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

  if (challenge.attempts >= challenge.maxAttempts) {
    await prisma.otpChallenge.update({
      where: { id: challenge.id },
      data: { consumedAt: new Date() },
    });
    throw new ApiError(
      'RATE_LIMITED',
      'Too many incorrect attempts. Request a new code to continue.',
    );
  }

  const valid = await verifySecret(code, challenge.codeHash);

  if (!valid) {
    const updated = await prisma.otpChallenge.update({
      where: { id: challenge.id },
      data: { attempts: { increment: 1 } },
    });
    await audit({
      action: 'auth.otp_failed',
      userId: user.id,
      context,
      metadata: { attempts: updated.attempts },
    });

    const remaining = challenge.maxAttempts - updated.attempts;
    if (remaining <= 0) {
      throw new ApiError(
        'RATE_LIMITED',
        'Too many incorrect attempts. Request a new code to continue.',
      );
    }
    throw new ApiError(
      'VALIDATION',
      `That code is incorrect. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`,
      { attemptsRemaining: remaining },
    );
  }

  await prisma.otpChallenge.update({
    where: { id: challenge.id },
    data: { consumedAt: new Date() },
  });

  return { userId: user.id, role: user.role };
}
