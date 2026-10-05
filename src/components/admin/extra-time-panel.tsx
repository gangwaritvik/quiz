'use client';

import { Search, Users } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';
import { toast } from 'sonner';

import { MinutesPicker } from '@/components/admin/add-time-dialog';
import { ErrorState } from '@/components/shared/error-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SkeletonRows } from '@/components/ui/skeleton';
import { useApi } from '@/hooks/use-api';
import { ApiClientError, apiFetch } from '@/lib/client/api';
import {
  MAX_EXTENSION_MINUTES,
  PRESTART_PRESETS,
  initialPicker,
  matchesStudentQuery,
  pickerFor,
  resolvePicker,
} from '@/lib/extension-ui';
import { cn } from '@/lib/utils';

interface ExtensionStudent {
  studentId: string;
  name: string;
  rollNumber: string;
  section: string;
  /** Minutes already granted before the quiz starts; 0 for none. */
  extraMinutes: number;
  /** Once true, time can only be added from Live exams. */
  started: boolean;
}

interface ExtensionsData {
  students: ExtensionStudent[];
}

/** A search box earns its place only when the list is long. */
const SEARCH_THRESHOLD = 10;

/** One set of columns for the header and every row on wide screens. */
const ROW_GRID =
  'lg:grid lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_4.5rem_7rem_13rem] lg:items-center lg:gap-x-4';

/**
 * Per-student time extensions that apply before a quiz starts (for example an
 * accessibility accommodation). Once a student has started, time is added from
 * Live exams instead, so those rows are read-only here.
 */
export function ExtraTimePanel({
  quizId,
  durationMinutes,
}: {
  quizId: string;
  durationMinutes: number;
}) {
  const { data, error, initialLoading, refetch } = useApi<ExtensionsData>(
    `/api/admin/quizzes/${quizId}/extensions`,
  );
  const [query, setQuery] = React.useState('');
  const [editing, setEditing] = React.useState<ExtensionStudent | null>(null);

  const students = data?.students ?? [];
  const visible = students.filter((student) => matchesStudentQuery(student, query));

  return (
    <div className="space-y-5">
      <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
        Give a student extra time before the quiz starts, for example for an accessibility
        accommodation. It is added to the quiz duration when they start.
      </p>

      {error && !data ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : initialLoading || !data ? (
        <div aria-busy="true">
          <SkeletonRows rows={5} />
        </div>
      ) : students.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No students are assigned to this quiz yet."
          description="Extra time can be set once students have been assigned to it."
        />
      ) : (
        <>
          {students.length > SEARCH_THRESHOLD ? (
            <div className="relative max-w-sm">
              <Label htmlFor="extra-time-search" className="sr-only">
                Search students
              </Label>
              <Search
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                id="extra-time-search"
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search name, roll number or section"
                className="pl-9"
              />
            </div>
          ) : null}
          <p className="sr-only" role="status">
            Showing {visible.length} of {students.length} students
          </p>

          <div className="rounded-lg border border-border bg-card">
            <div
              className={cn(
                'hidden border-b border-border px-4 py-2.5 bg-muted/50 text-xs font-medium text-muted-foreground',
                ROW_GRID,
              )}
              aria-hidden
            >
              <span>Student</span>
              <span>Roll number</span>
              <span>Section</span>
              <span>Extra time</span>
              <span />
            </div>

            {visible.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-muted-foreground">
                No students match &ldquo;{query.trim()}&rdquo;.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {visible.map((student) => (
                  <ExtraTimeRow
                    key={student.studentId}
                    student={student}
                    onEdit={() => setEditing(student)}
                  />
                ))}
              </ul>
            )}
          </div>
        </>
      )}

      <SetExtraTimeDialog
        quizId={quizId}
        durationMinutes={durationMinutes}
        student={editing}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
        onSaved={() => void refetch()}
      />
    </div>
  );
}

/**
 * One student. Below `lg` the row stacks (name, then extra time, then the
 * action) so nothing scrolls sideways on a phone.
 */
function ExtraTimeRow({ student, onEdit }: { student: ExtensionStudent; onEdit: () => void }) {
  const reasonId = `extra-time-reason-${student.studentId}`;
  const hasExtra = student.extraMinutes > 0;

  return (
    <li
      className={cn(
        'flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between',
        ROW_GRID,
      )}
    >
      <div className="min-w-0 sm:flex-1 lg:flex-none">
        <p className="truncate font-medium text-foreground">{student.name}</p>
        <p className="truncate text-xs text-muted-foreground lg:hidden">
          <span className="font-mono">{student.rollNumber}</span> · Section {student.section}
        </p>
      </div>

      <p className="hidden truncate font-mono text-sm lg:block">{student.rollNumber}</p>
      <p className="hidden truncate text-sm lg:block">{student.section}</p>

      <div className="flex items-center gap-2 text-sm sm:shrink-0 lg:justify-self-start">
        <span className="text-muted-foreground lg:hidden">Extra time:</span>
        <span className={cn('tabular', hasExtra ? 'font-medium text-foreground' : 'text-muted-foreground')}>
          {hasExtra ? (
            `${student.extraMinutes} min`
          ) : (
            <>
              <span aria-hidden>—</span>
              <span className="sr-only">None</span>
            </>
          )}
        </span>
        {student.started ? <Badge variant="muted">Started</Badge> : null}
      </div>

      <div className="flex flex-col gap-1.5 sm:shrink-0 sm:items-end lg:items-stretch">
        <Button
          variant="outline"
          className="w-full sm:w-auto lg:w-full"
          disabled={student.started}
          onClick={onEdit}
          aria-label={`${hasExtra ? 'Change' : 'Set'} extra time for ${student.name}`}
          aria-describedby={student.started ? reasonId : undefined}
        >
          {hasExtra ? 'Change extra time' : 'Set extra time'}
        </Button>
        {student.started ? (
          <p id={reasonId} className="text-xs leading-snug text-muted-foreground sm:text-right lg:text-left">
            Already started: add time from{' '}
            <Link
              href="/admin/live"
              className="font-medium text-primary underline underline-offset-2"
            >
              Live exams
            </Link>
          </p>
        ) : null}
      </div>
    </li>
  );
}

/* ------------------------------------------------------------------ */

function SetExtraTimeDialog({
  quizId,
  durationMinutes,
  student,
  onOpenChange,
  onSaved,
}: {
  quizId: string;
  durationMinutes: number;
  student: ExtensionStudent | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [busy, setBusy] = React.useState(false);

  // Keep the last student on screen while the dialog fades out.
  const last = React.useRef(student);
  if (student) last.current = student;
  const shown = student ?? last.current;

  return (
    <Dialog open={student !== null} onOpenChange={busy ? undefined : onOpenChange}>
      <DialogContent hideClose={busy} className="max-w-2xl">
        {shown ? (
          <SetExtraTimeForm
            key={shown.studentId}
            quizId={quizId}
            durationMinutes={durationMinutes}
            student={shown}
            busy={busy}
            setBusy={setBusy}
            onClose={() => onOpenChange(false)}
            onSaved={onSaved}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function SetExtraTimeForm({
  quizId,
  durationMinutes,
  student,
  busy,
  setBusy,
  onClose,
  onSaved,
}: {
  quizId: string;
  durationMinutes: number;
  student: ExtensionStudent;
  busy: boolean;
  setBusy: (busy: boolean) => void;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [picker, setPicker] = React.useState(() =>
    student.extraMinutes > 0
      ? pickerFor(PRESTART_PRESETS, student.extraMinutes)
      : initialPicker(PRESTART_PRESETS, 15, MAX_EXTENSION_MINUTES),
  );

  const check = resolvePicker(picker, 1, MAX_EXTENSION_MINUTES);
  const minutes = check.ok ? check.minutes : null;

  const submit = async () => {
    if (minutes === null) return;
    setBusy(true);
    try {
      await apiFetch<{ studentId: string; extraMinutes: number }>(
        `/api/admin/quizzes/${quizId}/extensions`,
        { method: 'PUT', body: { studentId: student.studentId, minutes } },
      );
      toast.success(
        minutes === 0
          ? `Extra time removed for ${student.name}.`
          : `${student.name} will get ${minutes} extra ${minutes === 1 ? 'minute' : 'minutes'} when they start.`,
      );
      onSaved();
      onClose();
    } catch (caught) {
      if (!(caught instanceof ApiClientError)) {
        toast.error(`We could not save extra time for ${student.name}.`);
        return;
      }
      toast.error(caught.message);
      // 409: they started in the meantime, so the row is stale. Refresh and
      // close; any other error is fixable here, so the dialog stays open.
      if (caught.status === 409) {
        onSaved();
        onClose();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="grid gap-5"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <DialogHeader>
        <DialogTitle className="break-words">Extra time for {student.name}</DialogTitle>
        <DialogDescription>
          Added to the quiz duration when they start. Choose None to remove it.
        </DialogDescription>
      </DialogHeader>

      <MinutesPicker
        idPrefix="extra-time"
        legend="Extra minutes"
        presets={PRESTART_PRESETS}
        state={picker}
        onChange={setPicker}
        min={1}
        max={MAX_EXTENSION_MINUTES}
        check={check}
        disabled={busy}
      />

      <p
        aria-live="polite"
        className="tabular rounded-md border border-border bg-muted/60 px-3.5 py-3 text-sm"
      >
        <span className="text-muted-foreground">Their timer </span>
        <span className="font-medium">{durationMinutes} min</span>
        <span aria-hidden> → </span>
        <span className="sr-only"> will be </span>
        <span className="font-semibold">
          {minutes === null ? '—' : `${durationMinutes + minutes} min`}
        </span>
      </p>

      <DialogFooter>
        <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" loading={busy} disabled={minutes === null}>
          {minutes === 0 ? 'Remove extra time' : 'Save extra time'}
        </Button>
      </DialogFooter>
    </form>
  );
}
