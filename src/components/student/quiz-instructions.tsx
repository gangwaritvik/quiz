'use client';

import { motion } from 'framer-motion';
import {
  AlertTriangle,
  ArrowLeft,
  BatteryMedium,
  Check,
  ClipboardX,
  Clock,
  Copy,
  Loader2,
  ListChecks,
  Lock,
  Maximize,
  Mic,
  Monitor,
  MonitorCheck,
  ScreenShare,
  ShieldCheck,
  Video,
  Wifi,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { toast } from 'sonner';

import { ErrorState } from '@/components/shared/error-state';
import { PageShell } from '@/components/shared/page-header';
import { CameraCheck } from '@/components/student/camera-check';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { type CheckState, useSecurityChecks } from '@/hooks/use-security-checks';
import { useApi } from '@/hooks/use-api';
import { ApiClientError, apiFetch } from '@/lib/client/api';
import { cn, formatDateTime, formatRelativeDay, pluralize } from '@/lib/utils';

interface QuizBriefing {
  quiz: {
    id: string;
    title: string;
    description: string | null;
    subject: string;
    subjectCode: string;
    questionCount: number;
    durationMinutes: number;
    startsAt: string;
    endsAt: string;
    security: {
      requireFullscreen: boolean;
      detectTabSwitch: boolean;
      blockCopyPaste: boolean;
      bindDeviceSession: boolean;
      cameraMonitoring: boolean;
      microphoneMonitoring: boolean;
      singleAttempt: boolean;
      maxFullscreenExits: number;
      blockMultipleDisplays?: boolean;
      requireScreenShare?: boolean;
    };
  };
  canStart: boolean;
  blockedReason: string | null;
  activeAttemptId: string | null;
}

const BASE_RULES = [
  {
    icon: MonitorCheck,
    text: 'Stay inside the examination window until you submit',
  },
  {
    icon: ClipboardX,
    text: 'Do not switch to other applications or browser tabs',
  },
  { icon: Copy, text: 'Do not use copy, paste or cut during the exam' },
  {
    icon: Lock,
    text: 'Do not share, photograph or redistribute the questions',
  },
  { icon: Wifi, text: 'Maintain a stable internet connection throughout' },
  {
    icon: BatteryMedium,
    text: 'Ensure your device has sufficient battery or is plugged in',
  },
];

export function QuizInstructions({ quizId }: { quizId: string }) {
  const router = useRouter();
  const { data, error, initialLoading, refetch } = useApi<QuizBriefing>(
    `/api/student/quizzes/${quizId}`,
  );

  const [acknowledged, setAcknowledged] = React.useState(false);
  const [starting, setStarting] = React.useState(false);
  const [startError, setStartError] = React.useState<string | null>(null);

  // Camera/mic permission is requested only after the student asks (never on load).
  const [mediaStarted, setMediaStarted] = React.useState(false);

  const security = data?.quiz.security;
  // Closed, not yet open, or already completed: show the rules read-only.
  const readOnly = data ? !data.canStart : false;
  const needsMedia =
    !readOnly && Boolean(security?.cameraMonitoring || security?.microphoneMonitoring);
  const mediaOn = needsMedia && mediaStarted;
  const checks = useSecurityChecks({
    requireFullscreen: !readOnly && (security?.requireFullscreen ?? false),
    cameraMonitoring: mediaOn && (security?.cameraMonitoring ?? false),
    microphoneMonitoring: mediaOn && (security?.microphoneMonitoring ?? false),
    blockMultipleDisplays: !readOnly && (security?.blockMultipleDisplays ?? false),
    requireScreenShare: !readOnly && (security?.requireScreenShare ?? false),
  });

  const startExam = async () => {
    if (!data) return;
    setStarting(true);
    setStartError(null);

    try {
      const result = await apiFetch<{ attemptId: string; resumed: boolean }>('/api/exam/start', {
        method: 'POST',
        body: {
          quizId: data.quiz.id,
          acknowledgedRules: true,
          checks: {
            fullscreenSupported: checks.fullscreenSupported,
            cameraReady: checks.checks.find((c) => c.id === 'camera')?.state === 'pass',
            microphoneReady: checks.checks.find((c) => c.id === 'microphone')?.state === 'pass',
          },
        },
      });

      // Release the preview camera so the exam page can claim it cleanly.
      checks.stream?.getTracks().forEach((track) => track.stop());

      if (result.resumed) toast.info('Resuming your attempt in progress.');
      router.push(`/exam/${result.attemptId}`);
    } catch (caught) {
      const message =
        caught instanceof ApiClientError ? caught.message : 'We could not start this exam.';
      setStartError(message);
      toast.error(message);
      setStarting(false);
    }
  };

  if (error && !data) {
    return (
      <PageShell>
        <BackLink />
        <ErrorState error={error} onRetry={() => void refetch()} />
      </PageShell>
    );
  }

  if (initialLoading || !data) {
    return (
      <PageShell>
        <Skeleton className="h-4 w-28" />
        <Skeleton className="mt-6 h-3 w-40" />
        <Skeleton className="mt-3 h-9 w-full max-w-lg" />
        <Skeleton className="mt-3 h-4 w-full max-w-md" />
        <div className="mt-10 grid gap-10 lg:grid-cols-[minmax(0,1fr)_360px]">
          <Skeleton className="h-80 rounded-lg" />
          <Skeleton className="h-96 rounded-lg" />
        </div>
      </PageShell>
    );
  }

  const { quiz } = data;
  const canProceed =
    data.canStart && checks.ready && (!needsMedia || mediaStarted) && acknowledged && !starting;

  const nowMs = Date.now();
  const statusLine =
    nowMs < new Date(quiz.startsAt).getTime()
      ? `Opens on ${formatDateTime(quiz.startsAt)}`
      : nowMs > new Date(quiz.endsAt).getTime()
        ? `This quiz closed on ${formatDateTime(quiz.endsAt)}`
        : (data.blockedReason ?? 'This quiz cannot be started.');

  const exits = quiz.security.maxFullscreenExits;
  const rules = [
    ...BASE_RULES,
    ...(quiz.security.requireFullscreen
      ? [
          {
            icon: Maximize,
            text:
              exits > 0
                ? `Fullscreen is required. ${exits} or more exits from fullscreen are flagged for your faculty`
                : 'Fullscreen is required for this exam',
          },
        ]
      : []),
    ...(quiz.security.cameraMonitoring
      ? [
          {
            icon: Video,
            text: 'Keep your camera on and available throughout the exam',
          },
        ]
      : []),
    ...(quiz.security.microphoneMonitoring
      ? [
          {
            icon: Mic,
            text: 'Keep your microphone on and available throughout the exam',
          },
        ]
      : []),
    ...(quiz.security.requireScreenShare
      ? [
          {
            icon: ScreenShare,
            text: 'Share your entire screen and keep sharing until you submit',
          },
        ]
      : []),
    ...(quiz.security.blockMultipleDisplays
      ? [
          {
            icon: Monitor,
            text: 'Use a single display; disconnect external monitors',
          },
        ]
      : []),
  ];

  return (
    <PageShell>
      <BackLink />

      <motion.header
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2, ease: [0.2, 0, 0, 1] }}
        className="border-b border-border pb-6"
      >
        <p className="type-eyebrow">
          {quiz.subject} · {quiz.subjectCode}
        </p>
        <h1 className="type-title mt-2 break-words">{quiz.title}</h1>
        {quiz.description ? (
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground sm:text-base">
            {quiz.description}
          </p>
        ) : null}

        <dl className="mt-6 grid grid-cols-2 gap-x-8 gap-y-4 sm:flex sm:flex-wrap">
          <Fact label="Questions">
            <ListChecks className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            {quiz.questionCount}
          </Fact>
          <Fact label="Duration">
            <Clock className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            {quiz.durationMinutes} minutes
          </Fact>
          <Fact label="Opens">{formatRelativeDay(quiz.startsAt)}</Fact>
          <Fact label="Closes">{formatRelativeDay(quiz.endsAt)}</Fact>
          {quiz.security.singleAttempt ? (
            <Fact label="Attempts">
              <Badge variant="warning">
                <AlertTriangle aria-hidden />
                One attempt only
              </Badge>
            </Fact>
          ) : null}
        </dl>
      </motion.header>

      {readOnly ? (
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted px-4 py-3.5 text-sm text-foreground">
          <p role="status">{statusLine}</p>
          <Button asChild variant="outline" size="sm">
            <Link href="/quizzes">Back to My quizzes</Link>
          </Button>
        </div>
      ) : null}

      <div
        className={cn(
          'mt-10 grid gap-10',
          !readOnly && 'lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start',
        )}
      >
        <div className="min-w-0 space-y-10">
          <section aria-labelledby="rules-heading">
            <h2 id="rules-heading" className="type-heading">
              Examination rules
            </h2>
            <ul className="mt-4 divide-y divide-border border-y border-border">
              {rules.map((rule) => (
                <li key={rule.text} className="flex items-start gap-3 py-3">
                  <rule.icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="text-sm leading-relaxed text-foreground">{rule.text}</span>
                </li>
              ))}
            </ul>

            <p className="mt-4 max-w-2xl text-xs leading-relaxed text-muted-foreground">
              <span className="font-medium text-foreground">What is monitored.</span> SecureQuiz
              records events such as leaving fullscreen, switching windows and losing connection,
              and shows them to your faculty as context. These signals are an indicator for human
              review — they are not treated as proof of misconduct, and ordinary interruptions are
              expected.
            </p>
          </section>

          {!readOnly && quiz.security.cameraMonitoring ? (
            <CameraCheck
              stream={checks.stream}
              state={checks.checks.find((c) => c.id === 'camera')?.state ?? 'pending'}
              detail={checks.checks.find((c) => c.id === 'camera')?.detail ?? ''}
              onRetry={() => void checks.retryMedia()}
              started={mediaStarted}
              onStart={() => setMediaStarted(true)}
            />
          ) : null}
        </div>

        {/* Readiness and the one primary action live together, so the reason
            the start button is disabled is always right above it. */}
        {readOnly ? null : (
          <section
            aria-labelledby="checks-heading"
            className="rounded-lg border border-border bg-card lg:sticky lg:top-24"
          >
            <div className="p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 id="checks-heading" className="type-subheading">
                  Security checks
                </h2>
                {checks.pending ? (
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Loader2 className="size-3.5 animate-spin" aria-hidden />
                    Checking
                  </span>
                ) : checks.ready ? (
                  <Badge variant="success">
                    <Check aria-hidden />
                    All clear
                  </Badge>
                ) : (
                  <Badge variant="danger">
                    <AlertTriangle aria-hidden />
                    Action needed
                  </Badge>
                )}
              </div>

              <ul className="mt-2 divide-y divide-border">
                {needsMedia && !mediaStarted ? (
                  <li className="flex items-start justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">
                        {quiz.security.cameraMonitoring ? 'Camera' : 'Microphone'}
                      </p>
                      <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                        Not checked yet
                      </p>
                    </div>
                    {quiz.security.cameraMonitoring ? null : (
                      <Button size="sm" variant="outline" onClick={() => setMediaStarted(true)}>
                        Check my microphone
                      </Button>
                    )}
                  </li>
                ) : null}
                {checks.checks.map((check) => (
                  <li key={check.id} className="flex items-start justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{check.label}</p>
                      <p className="mt-0.5 break-words text-xs leading-relaxed text-muted-foreground">
                        {check.detail}
                      </p>
                    </div>
                    <CheckIndicator state={check.state} />
                  </li>
                ))}
              </ul>

              {checks.blocking.length > 0 && !checks.pending ? (
                <p className="mt-2 flex items-start gap-1.5 rounded-md bg-danger-subtle px-3 py-2.5 text-xs leading-relaxed text-danger">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                  Resolve {pluralize(checks.blocking.length, 'check')} before you can start.
                </p>
              ) : null}
            </div>

            <div className="border-t border-border p-5">
              <div className="flex items-start gap-3">
                <Checkbox
                  id="ack-rules"
                  checked={acknowledged}
                  onCheckedChange={(value) => setAcknowledged(value === true)}
                  disabled={!data.canStart}
                  className="mt-0.5"
                  aria-describedby="ack-detail"
                />
                <label
                  htmlFor="ack-rules"
                  className={cn(
                    'text-sm',
                    data.canStart ? 'cursor-pointer' : 'cursor-not-allowed opacity-60',
                  )}
                >
                  <span className="font-medium text-foreground">
                    I understand the examination rules.
                  </span>
                  <span
                    id="ack-detail"
                    className="mt-1 block text-xs leading-relaxed text-muted-foreground"
                  >
                    I confirm I am the registered candidate and will complete this exam on my own.
                  </span>
                </label>
              </div>

              <Button
                size="xl"
                className="mt-5 w-full"
                disabled={!canProceed}
                loading={starting}
                onClick={() => void startExam()}
              >
                {starting ? 'Preparing your paper…' : 'Start secure exam'}
                {starting ? null : <ShieldCheck aria-hidden />}
              </Button>

              {startError ? (
                <p role="alert" className="mt-3 flex items-start gap-1.5 text-xs text-destructive">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                  {startError}
                </p>
              ) : (
                <p className="mt-3 text-center text-xs leading-relaxed text-muted-foreground">
                  Your timer starts the moment the paper is generated and runs on the server.
                </p>
              )}
            </div>
          </section>
        )}
      </div>
    </PageShell>
  );
}

function BackLink() {
  return (
    <Button asChild variant="ghost" size="sm" className="-ml-3 mb-4 h-10 text-muted-foreground">
      <Link href="/quizzes">
        <ArrowLeft />
        My quizzes
      </Link>
    </Button>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="type-eyebrow">{label}</dt>
      <dd className="tabular mt-1 flex items-center gap-1.5 text-sm font-medium text-foreground">
        {children}
      </dd>
    </div>
  );
}

/** Icon + colour + text label, so state never depends on colour alone. */
function CheckIndicator({ state }: { state: CheckState }) {
  if (state === 'pending') {
    return (
      <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" aria-hidden />
        Checking
      </span>
    );
  }

  const config = {
    pass: { icon: Check, className: 'text-success', label: 'Verified' },
    warn: { icon: AlertTriangle, className: 'text-warning', label: 'Warning' },
    fail: { icon: X, className: 'text-danger', label: 'Failed' },
  }[state];

  const Icon = config.icon;

  return (
    <span
      className={cn('flex shrink-0 items-center gap-1.5 text-xs font-medium', config.className)}
    >
      <Icon className="size-3.5" strokeWidth={2.5} aria-hidden />
      {config.label}
    </span>
  );
}
