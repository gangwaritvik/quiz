'use client';

import { motion } from 'framer-motion';
import {
  AlertTriangle,
  ArrowLeft,
  BatteryMedium,
  Check,
  ChevronRight,
  ClipboardX,
  Copy,
  Loader2,
  type LucideIcon,
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
import { type ExamRule, type ExamRuleKey, buildExamRules } from '@/lib/quiz-rules';
import { readExtraMinutes } from '@/lib/timer-sync';
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
    extraMinutes?: number;
  };
  /** This student's agreed extra time in minutes; absent means none. */
  extraMinutes?: number;
  canStart: boolean;
  blockedReason: string | null;
  activeAttemptId: string | null;
}

const RULE_ICONS: Record<ExamRuleKey, LucideIcon> = {
  window: MonitorCheck,
  tabs: ClipboardX,
  clipboard: Copy,
  confidentiality: Lock,
  connection: Wifi,
  battery: BatteryMedium,
  fullscreen: Maximize,
  camera: Video,
  microphone: Mic,
  screenShare: ScreenShare,
  singleDisplay: Monitor,
};

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
  const extraMinutes = readExtraMinutes({ extraMinutes: data.extraMinutes ?? quiz.extraMinutes });
  const canProceed =
    data.canStart && checks.ready && (!needsMedia || mediaStarted) && acknowledged && !starting;

  const nowMs = Date.now();
  const statusLine =
    nowMs < new Date(quiz.startsAt).getTime()
      ? `Opens on ${formatDateTime(quiz.startsAt)}`
      : nowMs > new Date(quiz.endsAt).getTime()
        ? `This quiz closed on ${formatDateTime(quiz.endsAt)}`
        : (data.blockedReason ?? 'This quiz cannot be started.');

  const rules = buildExamRules(quiz.security);

  // Checks that are not a clean pass, plus a camera/microphone not yet asked for.
  const needAttention =
    checks.checks.filter((check) => check.state === 'warn' || check.state === 'fail').length +
    (needsMedia && !mediaStarted ? 1 : 0);

  // The reason the start button is disabled, in the order the page is read.
  const startHint =
    canProceed || starting
      ? null
      : needsMedia && !mediaStarted
        ? `Check your ${quiz.security.cameraMonitoring ? 'camera' : 'microphone'} to continue`
        : checks.pending
          ? 'Waiting for your device checks to finish'
          : !checks.ready
            ? `Resolve ${pluralize(checks.blocking.length, 'device check')} above to continue`
            : !acknowledged
              ? 'Tick the confirmation above to continue'
              : null;

  return (
    <PageShell>
      <BackLink />

      <motion.header
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2, ease: [0.2, 0, 0, 1] }}
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
      </motion.header>

      <section
        aria-labelledby="briefing-heading"
        className="mt-6 rounded-lg border border-border bg-card p-5 sm:p-6"
      >
        <h2 id="briefing-heading" className="type-subheading">
          {readOnly ? 'Quiz details' : 'Before you begin'}
        </h2>
        {readOnly ? null : (
          <p className="mt-1 text-sm text-muted-foreground">
            Your timer starts only when you press Start.
          </p>
        )}
        <dl className="mt-5 grid grid-cols-2 gap-x-8 gap-y-4 sm:flex sm:flex-wrap">
          <Fact label="Duration">{quiz.durationMinutes} minutes</Fact>
          <Fact label="Questions">{quiz.questionCount}</Fact>
          {readOnly ? <Fact label="Opens">{formatRelativeDay(quiz.startsAt)}</Fact> : null}
          <Fact label="Closes">{formatRelativeDay(quiz.endsAt)}</Fact>
          <Fact label="Attempts">
            {quiz.security.singleAttempt ? (
              <Badge variant="warning">
                <AlertTriangle aria-hidden />
                One attempt only
              </Badge>
            ) : (
              'More than one allowed'
            )}
          </Fact>
        </dl>
        {!readOnly && extraMinutes > 0 ? (
          <p className="mt-4 text-sm text-foreground">
            You have {pluralize(extraMinutes, 'extra minute')} (agreed with your faculty). Your
            timer will be {pluralize(quiz.durationMinutes + extraMinutes, 'minute')}.
          </p>
        ) : null}
      </section>

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
          !readOnly && 'lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start',
        )}
      >
        <div className="min-w-0 space-y-10">
          <section aria-labelledby="rules-heading">
            <h2 id="rules-heading" className="type-heading">
              {readOnly ? 'Examination rules' : 'Rules for this exam'}
            </h2>
            {readOnly ? (
              <RuleList rules={rules.all} className="mt-4" />
            ) : (
              <>
                {rules.highlights.length > 0 ? (
                  <RuleList rules={rules.highlights} className="mt-4" />
                ) : (
                  <p className="mt-4 text-sm text-muted-foreground">
                    This exam adds no special settings. The standard rules still apply.
                  </p>
                )}
                <details className="group mt-3">
                  <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-md py-2 text-sm font-medium text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
                    <ChevronRight
                      className="size-4 shrink-0 text-muted-foreground group-open:rotate-90"
                      aria-hidden
                    />
                    Read all exam rules ({rules.all.length})
                  </summary>
                  <RuleList rules={rules.all} className="mt-2" />
                </details>
              </>
            )}
          </section>

          <section
            aria-labelledby="privacy-heading"
            className="rounded-lg border border-border bg-card p-5"
          >
            <h2 id="privacy-heading" className="type-subheading flex items-center gap-2">
              <Lock className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              What is recorded
            </h2>
            <ul className="mt-3 space-y-1.5 text-sm leading-relaxed text-muted-foreground">
              <li>
                Your faculty can see events such as window or tab switches, full-screen exits, copy
                or paste attempts and connection drops, each with a time.
              </li>
              <li>Camera and screen previews stay on your device and are not uploaded.</li>
              <li>These are signals for your faculty to review, not a verdict.</li>
            </ul>
          </section>
        </div>

        {readOnly ? null : (
          <div className="min-w-0 space-y-6">
            <section
              aria-labelledby="checks-heading"
              className="rounded-lg border border-border bg-card p-5"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 id="checks-heading" className="type-subheading">
                  Your device
                </h2>
                <div role="status">
                  {checks.pending ? (
                    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Loader2 className="size-3.5 animate-spin" aria-hidden />
                      Checking
                    </span>
                  ) : needAttention === 0 ? (
                    <Badge variant="success">
                      <Check aria-hidden />
                      All checks passed
                    </Badge>
                  ) : (
                    <Badge variant={checks.blocking.length > 0 ? 'danger' : 'warning'}>
                      <AlertTriangle aria-hidden />
                      {needAttention} {needAttention === 1 ? 'needs' : 'need'} attention
                    </Badge>
                  )}
                </div>
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

              {quiz.security.cameraMonitoring ? (
                <div className="mt-2 border-t border-border pt-4">
                  <CameraCheck
                    stream={checks.stream}
                    state={checks.checks.find((c) => c.id === 'camera')?.state ?? 'pending'}
                    detail={checks.checks.find((c) => c.id === 'camera')?.detail ?? ''}
                    onRetry={() => void checks.retryMedia()}
                    started={mediaStarted}
                    onStart={() => setMediaStarted(true)}
                  />
                </div>
              ) : null}
            </section>

            <div>
              <div className="flex items-start gap-3">
                <Checkbox
                  id="ack-rules"
                  checked={acknowledged}
                  onCheckedChange={(value) => setAcknowledged(value === true)}
                  className="mt-0.5"
                />
                <label
                  htmlFor="ack-rules"
                  className="cursor-pointer text-sm leading-relaxed text-foreground"
                >
                  I understand the exam rules, I am the registered candidate, and I will complete
                  this exam on my own.
                </label>
              </div>

              <Button
                size="xl"
                className="mt-5 w-full"
                disabled={!canProceed}
                loading={starting}
                onClick={() => void startExam()}
                aria-describedby={startHint ? 'start-hint' : undefined}
              >
                {starting ? 'Preparing your paper…' : 'Start secure exam'}
                {starting ? null : <ShieldCheck aria-hidden />}
              </Button>

              {startHint ? (
                <p id="start-hint" className="mt-3 text-center text-sm text-foreground">
                  {startHint}
                </p>
              ) : null}

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
          </div>
        )}
      </div>
    </PageShell>
  );
}

function RuleList({ rules, className }: { rules: ExamRule[]; className?: string }) {
  return (
    <ul className={cn('divide-y divide-border border-y border-border', className)}>
      {rules.map((rule) => {
        const Icon = RULE_ICONS[rule.key];
        return (
          <li key={rule.key} className="flex items-start gap-3 py-3">
            <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="text-sm leading-relaxed text-foreground">{rule.text}</span>
          </li>
        );
      })}
    </ul>
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
