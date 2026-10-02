"use client";

import {
  Clock3,
  MonitorPlay,
  RefreshCw,
  ShieldAlert,
  Wifi,
  WifiOff,
} from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { toast } from "sonner";

import { ErrorState } from "@/components/shared/error-state";
import {
  IntegrityBadge,
  type IntegrityStatus,
} from "@/components/shared/integrity-badge";
import { PageHeader, PageShell } from "@/components/shared/page-header";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SkeletonRows } from "@/components/ui/skeleton";
import { EVENT_LABELS_CLIENT } from "@/lib/event-labels";
import { useApi } from "@/hooks/use-api";
import { ApiClientError, apiFetch } from "@/lib/client/api";
import { cn, formatDuration } from "@/lib/utils";

interface LiveStudent {
  attemptId: string;
  studentId: string;
  name: string;
  rollNumber: string;
  section: string;
  quizId: string;
  quizTitle: string;
  answered: number;
  totalQuestions: number;
  remainingMs: number;
  startedAt: string;
  lastSeenAt: string;
  connection: "STABLE" | "UNSTABLE" | "OFFLINE";
  integrityScore: number;
  integrityStatus: IntegrityStatus;
  events: Array<{ type: string; count: number }>;
}

interface LiveData {
  serverNow: string;
  students: LiveStudent[];
  quizzes: Array<{
    id: string;
    title: string;
    subject: string;
    endsAt: string;
    assigned: number;
    active: number;
  }>;
  summary: { active: number; flagged: number; unstable: number };
}

const CONNECTION_LABEL = {
  STABLE: { label: "Stable", icon: Wifi, className: "text-success" },
  UNSTABLE: { label: "Unstable", icon: Wifi, className: "text-warning" },
  OFFLINE: { label: "Offline", icon: WifiOff, className: "text-danger" },
} as const;

/** Shared column template so the header row and every student row line up. */
const ROW_GRID =
  "lg:grid lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1.2fr)_6rem_7rem_minmax(0,1.1fr)_auto] lg:items-center lg:gap-x-5";

export function LiveMonitoring() {
  const [quizFilter, setQuizFilter] = React.useState("ALL");

  const path =
    quizFilter === "ALL"
      ? "/api/admin/live"
      : `/api/admin/live?quizId=${quizFilter}`;

  // 10 seconds is frequent enough to invigilate without hammering the database.
  const { data, error, initialLoading, loading, refetch } = useApi<LiveData>(
    path,
    {
      refreshInterval: 10_000,
    },
  );

  const students = data?.students ?? [];
  const [releasing, setReleasing] = React.useState<LiveStudent | null>(null);
  const [releaseBusy, setReleaseBusy] = React.useState(false);

  const releaseDevice = async (student: LiveStudent) => {
    setReleaseBusy(true);
    try {
      const result = await apiFetch<{ sessionBound: boolean }>(
        `/api/admin/attempts/${student.attemptId}/release-device`,
        { method: "POST" },
      );
      if (result.sessionBound) {
        toast.success(`${student.name} can continue on their new sign-in.`);
      } else {
        toast.warning(
          `${student.name} has no active sign-in yet. Ask them to sign in, then try again.`,
        );
      }
      setReleasing(null);
      void refetch();
    } catch (caught) {
      toast.error(
        caught instanceof ApiClientError
          ? caught.message
          : `We could not let ${student.name} back in.`,
      );
    } finally {
      setReleaseBusy(false);
    }
  };

  if (error && !data) {
    return (
      <PageShell>
        <ErrorState error={error} onRetry={() => void refetch()} />
      </PageShell>
    );
  }

  return (
    <PageShell>
      <PageHeader
        title="Live exams"
        description="Students currently sitting an examination. Refreshes every 10 seconds."
        actions={
          <>
            {data && data.quizzes.length > 0 ? (
              // The hidden native label/select React Aria renders sizes to its
              // option text and overflowed at 375px; pin it to 1px.
              <div className="relative w-full sm:w-[260px] [&_label]:w-px [&_select]:w-px">
                <Select value={quizFilter} onValueChange={setQuizFilter}>
                  <SelectTrigger aria-label="Filter by quiz">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">All live quizzes</SelectItem>
                    {data.quizzes.map((quiz) => (
                      <SelectItem key={quiz.id} value={quiz.id}>
                        {quiz.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
            <Button
              variant="outline"
              onClick={() => void refetch()}
              loading={loading}
            >
              <RefreshCw />
              Refresh
            </Button>
          </>
        }
      />

      {data && data.summary.active > 0 ? (
        <ul
          aria-label="Live summary"
          className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm"
        >
          <li className="flex items-center gap-2 font-medium text-foreground">
            <span
              className="size-2 animate-pulse-ring rounded-full bg-success"
              aria-hidden
            />
            <span>
              <span className="tabular">{data.summary.active}</span> in progress
            </span>
          </li>
          <li
            className={cn(
              "flex items-center gap-2",
              data.summary.flagged > 0
                ? "text-warning"
                : "text-muted-foreground",
            )}
          >
            <ShieldAlert className="size-4" aria-hidden />
            <span>
              <span className="tabular">{data.summary.flagged}</span> flagged
              for review
            </span>
          </li>
          <li
            className={cn(
              "flex items-center gap-2",
              data.summary.unstable > 0
                ? "text-warning"
                : "text-muted-foreground",
            )}
          >
            <WifiOff className="size-4" aria-hidden />
            <span>
              <span className="tabular">{data.summary.unstable}</span> with
              connection issues
            </span>
          </li>
        </ul>
      ) : null}

      {initialLoading ? (
        <SkeletonRows rows={5} className="mt-6" />
      ) : students.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            icon={MonitorPlay}
            tone="success"
            title="No examinations in progress"
            description="When students start a published quiz, their progress, connection status and integrity indicator appear here in real time."
            action={
              <Button asChild variant="outline">
                <Link href="/admin/quizzes">View quizzes</Link>
              </Button>
            }
          />
        </div>
      ) : (
        <div className="mt-6 rounded-lg border border-border bg-card">
          <div
            className={cn(
              "hidden border-b border-border px-5 py-2.5 text-2xs font-semibold uppercase tracking-[0.08em] text-muted-foreground",
              ROW_GRID,
            )}
            aria-hidden
          >
            <span>Student</span>
            <span>Progress</span>
            <span>Time left</span>
            <span>Connection</span>
            <span>Integrity</span>
            <span className="w-[8.5rem]" />
          </div>
          <ul className="divide-y divide-border">
            {students.map((student) => (
              <LiveStudentRow
                key={student.attemptId}
                student={student}
                onLetBackIn={() => setReleasing(student)}
              />
            ))}
          </ul>
        </div>
      )}

      <AlertDialog
        open={releasing !== null}
        onOpenChange={(open) => {
          if (!open) setReleasing(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="break-words">
              Let {releasing?.name} back in?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Use this if the student&apos;s browser crashed or they changed
              device. Ask the student to sign in again first; this moves their
              exam to their newest sign-in. Their answers are kept.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={releaseBusy}
              onClick={(event) => {
                event.preventDefault();
                if (releasing) void releaseDevice(releasing);
              }}
            >
              Let back in
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageShell>
  );
}

/**
 * One student, one row. On a wide screen every row shares the same columns so
 * a whole room can be scanned top to bottom; on a phone it stacks.
 */
function LiveStudentRow({
  student,
  onLetBackIn,
}: {
  student: LiveStudent;
  onLetBackIn: () => void;
}) {
  const connection = CONNECTION_LABEL[student.connection];
  const ConnectionIcon = connection.icon;
  const progress =
    student.totalQuestions > 0
      ? (student.answered / student.totalQuestions) * 100
      : 0;
  const lowTime = student.remainingMs <= 5 * 60_000;

  return (
    <li className={cn("grid gap-3 px-5 py-4 sm:grid-cols-2", ROW_GRID)}>
      <div className="min-w-0 sm:col-span-2 lg:col-span-1">
        <p className="truncate font-medium text-foreground">{student.name}</p>
        <p className="truncate text-xs text-muted-foreground">
          <span className="font-mono">{student.rollNumber}</span> · Section{" "}
          {student.section} · {student.quizTitle}
        </p>
      </div>

      <div className="min-w-0">
        {/* Navigation position is not tracked server-side, so this is the
            answered count — labelled as such rather than as "Question N". */}
        <p className="tabular text-sm">
          Answered {student.answered} / {student.totalQuestions}
        </p>
        <Progress
          value={progress}
          className="mt-1.5 h-1.5"
          aria-label={`${student.answered} of ${student.totalQuestions} answered`}
        />
      </div>

      <p
        className={cn(
          "tabular flex items-center gap-1.5 whitespace-nowrap font-mono text-sm",
          lowTime ? "font-semibold text-danger" : "text-foreground",
        )}
      >
        {lowTime ? <Clock3 className="size-3.5" aria-hidden /> : null}
        {formatDuration(student.remainingMs / 1000)}
        <span className="font-sans text-xs font-normal text-muted-foreground">
          left
        </span>
        {lowTime ? (
          <span className="sr-only">— under five minutes remaining</span>
        ) : null}
      </p>

      <p
        className={cn(
          "flex items-center gap-1.5 text-sm font-medium",
          connection.className,
        )}
      >
        <ConnectionIcon className="size-4" aria-hidden />
        {connection.label}
      </p>

      <div className="min-w-0 space-y-1">
        <IntegrityBadge
          status={student.integrityStatus}
          score={student.integrityScore}
        />
        {student.events.length > 0 ? (
          <p className="truncate text-xs text-muted-foreground">
            {student.events
              .slice(0, 3)
              .map(
                (event) =>
                  `${event.count}× ${EVENT_LABELS_CLIENT[event.type] ?? event.type}`,
              )
              .join(" · ")}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            No integrity signals recorded.
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2 sm:col-span-2 lg:col-span-1 lg:w-[8.5rem]">
        <Button asChild variant="outline" className="w-full">
          <Link
            href={`/admin/integrity/${student.attemptId}`}
            aria-label={`View timeline for ${student.name}`}
          >
            View timeline
          </Link>
        </Button>
        <Button
          variant="secondary"
          className="w-full"
          onClick={onLetBackIn}
          aria-label={`Let ${student.name} back in`}
        >
          Let back in
        </Button>
      </div>
    </li>
  );
}
