'use client';

import {
  Archive,
  ArchiveRestore,
  BookOpen,
  Camera,
  Clock3,
  Copy,
  Eye,
  FilePlus2,
  Lock,
  Maximize,
  MoreHorizontal,
  Pencil,
  PenLine,
  Send,
  ShieldCheck,
  Shuffle,
  Smartphone,
  Trash2,
  Undo2,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { toast } from 'sonner';

import { QuizEditDialog } from '@/components/admin/quiz-edit-dialog';
import { ErrorState } from '@/components/shared/error-state';
import { PageHeader, PageShell } from '@/components/shared/page-header';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { EmptyState } from '@/components/ui/empty-state';
import { SkeletonRows } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useApi } from '@/hooks/use-api';
import { ApiClientError, apiFetch } from '@/lib/client/api';
import { formatDateTime } from '@/lib/utils';

interface AdminQuiz {
  id: string;
  title: string;
  description: string | null;
  subject: string;
  subjectCode: string;
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  sourceMode: 'POOL' | 'FIXED';
  questionCount: number;
  durationMinutes: number;
  difficultyMix: { easy: number; medium: number; hard: number };
  startsAt: string;
  endsAt: string;
  assignedCount: number;
  attemptCount: number;
  author: string;
  live: boolean;
  security: {
    requireFullscreen: boolean;
    cameraMonitoring: boolean;
    bindDeviceSession: boolean;
    blockCopyPaste: boolean;
  };
}

type StatusFilter = 'ALL' | 'PUBLISHED' | 'DRAFT' | 'ARCHIVED';

export function AdminQuizList() {
  const { data, error, initialLoading, refetch } = useApi<{ quizzes: AdminQuiz[] }>(
    '/api/admin/quizzes',
  );
  const router = useRouter();
  const [filter, setFilter] = React.useState<StatusFilter>('ALL');
  const [updating, setUpdating] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState<AdminQuiz | null>(null);
  const [confirmDelete, setConfirmDelete] = React.useState<AdminQuiz | null>(null);

  const quizzes = data?.quizzes ?? [];
  const filtered = filter === 'ALL' ? quizzes : quizzes.filter((quiz) => quiz.status === filter);

  const duplicate = async (quiz: AdminQuiz) => {
    setUpdating(quiz.id);
    try {
      const result = await apiFetch<{ quizId: string; title: string }>(
        `/api/admin/quizzes/${quiz.id}/duplicate`,
        { method: 'POST' },
      );
      toast.success(`Copied to “${result.title}”.`);
      router.push(`/admin/quizzes/${result.quizId}`);
    } catch (caught) {
      toast.error(
        caught instanceof ApiClientError ? caught.message : 'We could not copy that quiz.',
      );
    } finally {
      setUpdating(null);
    }
  };

  const remove = async (quiz: AdminQuiz) => {
    setUpdating(quiz.id);
    try {
      await apiFetch(`/api/admin/quizzes/${quiz.id}`, { method: 'DELETE' });
      toast.success(`“${quiz.title}” deleted.`);
      setConfirmDelete(null);
      await refetch();
    } catch (caught) {
      toast.error(
        caught instanceof ApiClientError ? caught.message : 'We could not delete that quiz.',
      );
    } finally {
      setUpdating(null);
    }
  };

  const changeStatus = async (quiz: AdminQuiz, status: AdminQuiz['status']) => {
    setUpdating(quiz.id);
    try {
      await apiFetch(`/api/admin/quizzes/${quiz.id}`, { method: 'PATCH', body: { status } });
      toast.success(
        status === 'PUBLISHED'
          ? `“${quiz.title}” is now published.`
          : `“${quiz.title}” moved to ${status.toLowerCase()}.`,
      );
      await refetch();
    } catch (caught) {
      toast.error(
        caught instanceof ApiClientError ? caught.message : 'We could not update that quiz.',
      );
    } finally {
      setUpdating(null);
    }
  };

  if (error && !data) {
    return (
      <PageShell>
        <ErrorState error={error} onRetry={() => void refetch()} />
      </PageShell>
    );
  }

  const actionsFor = (quiz: AdminQuiz) => (
    <QuizActions
      quiz={quiz}
      busy={updating === quiz.id}
      onEdit={() => setEditing(quiz)}
      onDuplicate={() => void duplicate(quiz)}
      onStatus={(status) => void changeStatus(quiz, status)}
      onDelete={() => setConfirmDelete(quiz)}
    />
  );

  return (
    <PageShell>
      <PageHeader
        title="Quizzes"
        description="Every examination you have authored, with its security policy and assignment reach."
        actions={
          <Button asChild>
            <Link href="/admin/quizzes/new">
              <FilePlus2 />
              Create quiz
            </Link>
          </Button>
        }
      />

      <Tabs
        value={filter}
        onValueChange={(value) => setFilter(value as StatusFilter)}
        className="mt-6"
      >
        <TabsList aria-label="Filter quizzes by status">
          {(['ALL', 'PUBLISHED', 'DRAFT', 'ARCHIVED'] as StatusFilter[]).map((value) => (
            <TabsTrigger key={value} value={value}>
              {value === 'ALL' ? 'All' : value.charAt(0) + value.slice(1).toLowerCase()}
              {!initialLoading ? (
                <span className="tabular ml-1.5 text-xs text-muted-foreground">
                  {value === 'ALL'
                    ? quizzes.length
                    : quizzes.filter((quiz) => quiz.status === value).length}
                </span>
              ) : null}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {initialLoading ? (
        <SkeletonRows rows={5} className="mt-6" />
      ) : filtered.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            icon={BookOpen}
            title={filter === 'ALL' ? 'No quizzes yet' : `No ${filter.toLowerCase()} quizzes`}
            description={
              filter === 'ALL'
                ? 'Create your first examination. You can draft it now, assign students, and publish when you are ready.'
                : 'Nothing in this category. Try another filter.'
            }
            action={
              filter === 'ALL' ? (
                <Button asChild>
                  <Link href="/admin/quizzes/new">
                    <FilePlus2 />
                    Create quiz
                  </Link>
                </Button>
              ) : undefined
            }
          />
        </div>
      ) : (
        <>
          {/* Desktop: a ruled ledger. */}
          <div className="mt-6 hidden rounded-lg border border-border bg-card md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Quiz</TableHead>
                  <TableHead className="hidden xl:table-cell">Window</TableHead>
                  <TableHead className="hidden xl:table-cell">Security</TableHead>
                  <TableHead className="hidden text-right xl:table-cell">Assigned</TableHead>
                  <TableHead className="hidden text-right xl:table-cell">Attempts</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((quiz) => (
                  <TableRow key={quiz.id}>
                    <TableCell className="min-w-[14rem] max-w-sm">
                      <Link
                        href={`/admin/quizzes/${quiz.id}`}
                        className="line-clamp-2 break-words font-medium text-foreground underline-offset-4 hover:underline"
                      >
                        {quiz.title}
                      </Link>
                      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                        <SourceBadge mode={quiz.sourceMode} />
                        <span>
                          {quiz.subject} · <span className="tabular">{quiz.questionCount}</span>{' '}
                          questions · <span className="tabular">{quiz.durationMinutes}</span> min
                        </span>
                      </div>
                      <p className="tabular mt-1 text-xs text-muted-foreground xl:hidden">
                        {formatDateTime(quiz.startsAt)} to {formatDateTime(quiz.endsAt)} ·{' '}
                        {quiz.assignedCount} assigned · {quiz.attemptCount} attempt{quiz.attemptCount === 1 ? '' : 's'}
                      </p>
                    </TableCell>

                    <TableCell className="tabular hidden whitespace-nowrap text-xs text-muted-foreground xl:table-cell">
                      <p>{formatDateTime(quiz.startsAt)}</p>
                      <p className="mt-0.5">to {formatDateTime(quiz.endsAt)}</p>
                    </TableCell>

                    <TableCell className="hidden xl:table-cell">
                      <SecurityPills security={quiz.security} />
                    </TableCell>

                    <TableCell className="tabular hidden text-right xl:table-cell">{quiz.assignedCount}</TableCell>
                    <TableCell className="tabular hidden text-right xl:table-cell">{quiz.attemptCount}</TableCell>

                    <TableCell>
                      <StatusBadge quiz={quiz} />
                    </TableCell>

                    <TableCell className="text-right">{actionsFor(quiz)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Mobile: one entry per quiz, nothing to scroll sideways. */}
          <ul className="mt-6 divide-y divide-border rounded-lg border border-border bg-card md:hidden">
            {filtered.map((quiz) => (
              <li key={quiz.id} className="p-4">
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/admin/quizzes/${quiz.id}`}
                      className="line-clamp-2 break-words font-medium text-foreground underline-offset-4 hover:underline"
                    >
                      {quiz.title}
                    </Link>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {quiz.subject} · <span className="tabular">{quiz.questionCount}</span>{' '}
                      questions · <span className="tabular">{quiz.durationMinutes}</span> min
                    </p>
                  </div>
                  <StatusBadge quiz={quiz} />
                </div>

                <p className="tabular mt-2 text-xs text-muted-foreground">
                  {formatDateTime(quiz.startsAt)} to {formatDateTime(quiz.endsAt)}
                </p>

                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                  <SourceBadge mode={quiz.sourceMode} />
                  <SecurityPills security={quiz.security} />
                  <span className="tabular text-xs text-muted-foreground">
                    {quiz.assignedCount} assigned · {quiz.attemptCount} attempt{quiz.attemptCount === 1 ? '' : 's'}
                  </span>
                  <div className="ml-auto">{actionsFor(quiz)}</div>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      <QuizEditDialog
        quiz={editing}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
        onSaved={() => {
          setEditing(null);
          void refetch();
        }}
      />

      <AlertDialog
        open={confirmDelete !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="break-words">
              Delete “{confirmDelete?.title}”?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This removes the quiz, its assignments and any questions written for it. It cannot
              be undone. Nobody has attempted this quiz, so no examination record is affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              destructive
              disabled={updating === confirmDelete?.id}
              onClick={(event) => {
                event.preventDefault();
                if (confirmDelete) void remove(confirmDelete);
              }}
            >
              Delete quiz
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageShell>
  );
}

/** View link plus the overflow menu; shared by the table row and the mobile entry. */
function QuizActions({
  quiz,
  busy,
  onEdit,
  onDuplicate,
  onStatus,
  onDelete,
}: {
  quiz: AdminQuiz;
  busy: boolean;
  onEdit: () => void;
  onDuplicate: () => void;
  onStatus: (status: AdminQuiz['status']) => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex items-center justify-end gap-1">
      <Button asChild variant="ghost" size="sm">
        <Link href={`/admin/quizzes/${quiz.id}`}>
          <Eye />
          View
        </Link>
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            disabled={busy}
            aria-label={`More actions for ${quiz.title}`}
          >
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem onSelect={onEdit}>
            <Pencil />
            Edit details
          </DropdownMenuItem>

          <DropdownMenuItem onSelect={onDuplicate}>
            <Copy />
            Duplicate
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          {quiz.status === 'DRAFT' ? (
            <DropdownMenuItem onSelect={() => onStatus('PUBLISHED')}>
              <Send />
              Publish
            </DropdownMenuItem>
          ) : null}

          {quiz.status === 'PUBLISHED' ? (
            <>
              <DropdownMenuItem onSelect={() => onStatus('DRAFT')}>
                <Undo2 />
                Unpublish
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onStatus('ARCHIVED')}>
                <Archive />
                Archive
              </DropdownMenuItem>
            </>
          ) : null}

          {quiz.status === 'ARCHIVED' ? (
            <DropdownMenuItem onSelect={() => onStatus('DRAFT')}>
              <ArchiveRestore />
              Unarchive to draft
            </DropdownMenuItem>
          ) : null}

          <DropdownMenuSeparator />

          <DropdownMenuItem destructive disabled={quiz.attemptCount > 0} onSelect={onDelete}>
            <Trash2 />
            {quiz.attemptCount > 0 ? 'Delete (has attempts)' : 'Delete'}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/** Icon and word together, so status never rests on colour alone. */
function StatusBadge({ quiz }: { quiz: AdminQuiz }) {
  if (quiz.status === 'PUBLISHED') {
    const now = Date.now();
    if (now < new Date(quiz.startsAt).getTime()) {
      return (
        <Badge variant="default">
          <Clock3 aria-hidden />
          Scheduled
        </Badge>
      );
    }
    if (now <= new Date(quiz.endsAt).getTime()) {
      return (
        <Badge variant="success" className="gap-1.5">
          <span className="size-1.5 animate-pulse-ring rounded-full bg-success" aria-hidden />
          Live
        </Badge>
      );
    }
    return (
      <Badge variant="muted">
        <Lock aria-hidden />
        Closed
      </Badge>
    );
  }
  if (quiz.status === 'DRAFT') {
    return (
      <Badge variant="muted">
        <PenLine aria-hidden />
        Draft
      </Badge>
    );
  }
  return (
    <Badge variant="outline">
      <Archive aria-hidden />
      Archived
    </Badge>
  );
}

/**
 * Where the paper comes from. Worth showing in the list because it changes
 * what a quiz *is*: a fixed paper is one set of questions everybody sits, a
 * pooled one is a different draw per student.
 */
function SourceBadge({ mode }: { mode: 'POOL' | 'FIXED' }) {
  const fixed = mode === 'FIXED';
  return (
    <Badge
      variant="outline"
      className="gap-1 font-normal text-muted-foreground"
      title={
        fixed
          ? 'A fixed paper: every student sits the same questions.'
          : 'Drawn from the question bank: each student gets a different paper.'
      }
    >
      {fixed ? <PenLine className="size-3" aria-hidden /> : <Shuffle className="size-3" aria-hidden />}
      {fixed ? 'Written' : 'Random from pool'}
    </Badge>
  );
}

function SecurityPills({ security }: { security: AdminQuiz['security'] }) {
  return (
    <div className="flex items-center gap-1">
      <SecurityPill active={security.requireFullscreen} icon={Maximize} label="Fullscreen required" />
      <SecurityPill active={security.bindDeviceSession} icon={Smartphone} label="Device binding" />
      <SecurityPill active={security.blockCopyPaste} icon={ShieldCheck} label="Copy/paste blocked" />
      <SecurityPill active={security.cameraMonitoring} icon={Camera} label="Camera monitoring" />
    </div>
  );
}

/**
 * Icon with an accessible name. "On" is a solid tinted tile, "off" a dashed
 * outline, so the two read apart without relying on colour.
 */
function SecurityPill({
  active,
  icon: Icon,
  label,
}: {
  active: boolean;
  icon: typeof Maximize;
  label: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          role="img"
          aria-label={`${label}: ${active ? 'on' : 'off'}`}
          className={
            active
              ? 'flex size-6 items-center justify-center rounded-sm border border-transparent bg-accent text-accent-foreground'
              : 'flex size-6 items-center justify-center rounded-sm border border-dashed border-input text-muted-foreground'
          }
        >
          <Icon className="size-3.5" aria-hidden />
        </span>
      </TooltipTrigger>
      <TooltipContent>{`${label} — ${active ? 'on' : 'off'}`}</TooltipContent>
    </Tooltip>
  );
}
