'use client';

import { AlertTriangle, ArrowLeft, Loader2 } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import * as React from 'react';
import { toast } from 'sonner';

import { OtpInput } from '@/components/auth/otp-input';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiClientError, apiFetch } from '@/lib/client/api';
import { cn } from '@/lib/utils';

type Step = 'identifier' | 'otp';

interface OtpRequestResponse {
  sent: boolean;
  expiresInSeconds: number;
  resendInSeconds: number;
  devCode: string | null;
}

interface VerifyResponse {
  role: 'STUDENT' | 'ADMIN';
  redirectTo: string;
}

export function LoginPanel() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [step, setStep] = React.useState<Step>('identifier');
  const [identifier, setIdentifier] = React.useState('');
  const [code, setCode] = React.useState('');

  const [sending, setSending] = React.useState(false);
  const [verifying, setVerifying] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [lockedOut, setLockedOut] = React.useState(false);

  const [sentTo, setSentTo] = React.useState('');
  const [devCode, setDevCode] = React.useState<string | null>(null);
  const [expiresIn, setExpiresIn] = React.useState(0);
  const [resendIn, setResendIn] = React.useState(0);

  // The middleware appends ?reason=session when it bounces an expired session.
  const sessionExpired = searchParams.get('reason') === 'session';
  const nextPath = searchParams.get('next');

  // One interval drives both countdowns.
  React.useEffect(() => {
    if (step !== 'otp') return;
    const timer = window.setInterval(() => {
      setExpiresIn((value) => Math.max(0, value - 1));
      setResendIn((value) => Math.max(0, value - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [step]);

  const requestOtp = async (isResend = false) => {
    setError(null);
    setSending(true);
    try {
      const result = await apiFetch<OtpRequestResponse>('/api/auth/otp/request', {
        method: 'POST',
        body: { identifier: identifier.trim() },
      });

      setSentTo(identifier.trim());
      setDevCode(result.devCode);
      setExpiresIn(result.expiresInSeconds);
      setResendIn(result.resendInSeconds);
      setStep('otp');
      setLockedOut(false);
      if (isResend) {
        setCode('');
        toast.success('A new code is on its way.');
      }
    } catch (caught) {
      const message =
        caught instanceof ApiClientError ? caught.message : 'We could not send a code right now.';
      setError(message);
      if (caught instanceof ApiClientError && caught.code === 'RATE_LIMITED') {
        const retry = Number(
          (caught.details as unknown as { retryAfterSeconds?: number })?.retryAfterSeconds ?? 0,
        );
        if (retry > 0) setResendIn(retry);
      }
    } finally {
      setSending(false);
    }
  };

  const verify = async (submittedCode = code) => {
    if (submittedCode.length !== 6) {
      setError('Enter all six digits of your code.');
      return;
    }

    setError(null);
    setVerifying(true);
    try {
      const result = await apiFetch<VerifyResponse>('/api/auth/otp/verify', {
        method: 'POST',
        body: { identifier: identifier.trim(), code: submittedCode },
      });

      toast.success('Signed in successfully.');
      // Only same-site paths are honoured, mirroring the server-side guard.
      const destination =
        nextPath &&
        nextPath.startsWith('/') &&
        !nextPath.includes('\\') &&
        new URL(nextPath, window.location.origin).origin === window.location.origin
          ? nextPath
          : result.redirectTo;
      router.replace(destination);
      router.refresh();
    } catch (caught) {
      const apiError = caught instanceof ApiClientError ? caught : null;
      setError(apiError?.message ?? 'That code could not be verified.');
      setLockedOut(apiError?.code === 'RATE_LIMITED');
      setCode('');
    } finally {
      setVerifying(false);
    }
  };

  const restart = () => {
    setStep('identifier');
    setCode('');
    setError(null);
    setLockedOut(false);
    setDevCode(null);
  };

  const countdown = `${Math.floor(expiresIn / 60)}:${(expiresIn % 60).toString().padStart(2, '0')}`;

  return (
    <div className="w-full">
      {sessionExpired && step === 'identifier' ? (
        <div className="mb-6 flex items-start gap-2.5 rounded-md border border-warning/25 bg-warning-subtle px-3.5 py-3 text-sm text-warning">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p>Your session expired. Sign in again to continue.</p>
        </div>
      ) : null}

      <div>
          {step === 'identifier' ? (
            <div key="identifier">
              <h1 className="text-xl font-semibold">Sign in</h1>
              <p className="mt-1.5 text-sm text-muted-foreground">
                Use your student ID or college email. We&apos;ll send you a one-time code.
              </p>

              <form
                className="mt-6 space-y-5"
                onSubmit={(event) => {
                  event.preventDefault();
                  void requestOtp();
                }}
              >
                <div className="space-y-2">
                  <Label htmlFor="identifier">Student ID or college email</Label>
                  <Input
                    id="identifier"
                    name="identifier"
                    value={identifier}
                    onChange={(event) => setIdentifier(event.target.value)}
                    placeholder="23CSE041 or you@college.edu"
                    autoComplete="username"
                    autoFocus
                    required
                    invalid={Boolean(error)}
                    aria-describedby={error ? 'identifier-error' : 'identifier-hint'}
                    className="h-11 text-base sm:text-sm"
                  />
                  {error ? (
                    <p
                      id="identifier-error"
                      role="alert"
                      className="flex items-start gap-1.5 text-sm text-destructive"
                    >
                      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                      {error}
                    </p>
                  ) : (
                    <p id="identifier-hint" className="text-xs text-muted-foreground">
                      Faculty sign in with their college email.
                    </p>
                  )}
                </div>

                <Button type="submit" className="w-full" loading={sending}>
                  {sending ? 'Sending code…' : 'Send OTP'}
                </Button>
              </form>
            </div>
          ) : (
            <div key="otp">
              <h1 className="text-xl font-semibold">Enter your code</h1>
              {/* The identifier as typed, never the server's view of it: echoing
                the user's own input tells an attacker nothing about whether
                the account exists. */}
              <p className="mt-1.5 text-sm text-muted-foreground [overflow-wrap:anywhere]">
                Sent to <span className="font-medium text-foreground">{sentTo}</span>
              </p>

              {devCode ? (
                // Dashed edge and its own label so it can never be mistaken for
                // part of the production sign-in flow.
                <div className="mt-5 rounded-md border border-dashed border-warning/60 bg-warning-subtle px-4 py-3">
                  <p className="text-xs font-semibold text-warning">Development mode</p>
                  <p className="mt-1 text-sm text-warning">
                    Your code is{' '}
                    <span className="tabular font-mono text-lg font-semibold tracking-[0.2em]">
                      {devCode}
                    </span>
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-warning">
                    Codes are shown on screen because OTP_DEV_MODE is on. Anyone can sign in as
                    anyone; never use this mode with real students.
                  </p>
                </div>
              ) : null}

              <form
                className="mt-6 space-y-5"
                onSubmit={(event) => {
                  event.preventDefault();
                  void verify();
                }}
              >
                <OtpInput
                  value={code}
                  onChange={(value) => {
                    setCode(value);
                    if (error) setError(null);
                  }}
                  onComplete={(value) => void verify(value)}
                  disabled={verifying || lockedOut}
                  invalid={Boolean(error)}
                />

                {error ? (
                  <div
                    role="alert"
                    className={cn(
                      'flex items-start gap-2 text-sm',
                      lockedOut
                        ? 'rounded-md border border-danger/25 bg-danger-subtle px-3 py-2.5 text-danger'
                        : 'text-destructive',
                    )}
                  >
                    <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                    <span>{error}</span>
                  </div>
                ) : null}

                <div className="flex flex-wrap items-center justify-between gap-x-3 text-sm">
                  <span
                    className={cn(
                      'tabular text-muted-foreground',
                      expiresIn > 0 && expiresIn <= 30 && 'text-warning',
                    )}
                  >
                    {expiresIn > 0 ? `Code expires in ${countdown}` : 'This code has expired'}
                  </span>
                  <button
                    type="button"
                    onClick={() => void requestOtp(true)}
                    disabled={resendIn > 0 || sending}
                    className="tabular -mr-2 inline-flex min-h-10 items-center rounded-md px-2 font-medium text-primary underline-offset-4 transition-colors duration-fast ease-standard hover:underline disabled:cursor-not-allowed disabled:text-muted-foreground disabled:no-underline"
                  >
                    {sending ? (
                      <span className="inline-flex items-center gap-1.5">
                        <Loader2 className="size-3.5 animate-spin" aria-hidden />
                        Sending
                      </span>
                    ) : resendIn > 0 ? (
                      `Resend in ${resendIn}s`
                    ) : (
                      'Resend code'
                    )}
                  </button>
                </div>

                <Button
                  type="submit"
                  className="w-full"
                  loading={verifying}
                  disabled={lockedOut || code.length !== 6}
                >
                  {verifying ? 'Verifying…' : 'Verify and sign in'}
                </Button>

                <Button
                  type="button"
                  variant="ghost"
                  onClick={restart}
                  className="w-full text-muted-foreground"
                >
                  <ArrowLeft aria-hidden />
                  Use a different ID
                </Button>
              </form>
            </div>
          )}
      </div>
    </div>
  );
}
