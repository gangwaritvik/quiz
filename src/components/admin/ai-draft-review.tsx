'use client';

import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckCheck,
  CheckCircle2,
  FileText,
  ClipboardList,
  Loader2,
  Pencil,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { toast } from 'sonner';

import { type AnswerCheck, type QuoteStatus, isFlagged } from '@/lib/ai/verification';
import { QuestionEditor, type QuestionRecord } from '@/components/admin/question-editor';
import { ErrorState } from '@/components/shared/error-state';
import { MathText } from '@/components/shared/math-text';
import { PageHeader, PageShell } from '@/components/shared/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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
import { sendUnlessRepeat } from '@/lib/client/confirm-similar';
import { BLOOM_LABEL, type BloomValue, QUESTION_TYPE_LABEL, type QuestionTypeValue } from '@/lib/question-types';
import { cn } from '@/lib/utils';

interface DraftPayload {
  text: string;
  type: QuestionTypeValue;
  difficulty: 'EASY' | 'MEDIUM' | 'HARD';
  bloom?: BloomValue | null;
  marks: number;
  negativeMarks: number;
  explanation?: string;
  topicId?: string;
  assertionText?: string;
  reasonText?: string;
  acceptedAnswers?: string[];
  options: Array<{ text: string; isCorrect: boolean }>;
}

interface Draft {
  id: string;
  status: 'PENDING' | 'ACCEPTED' | 'DISCARDED';
  payload: DraftPayload;
  source: { materialId?: string; page?: number; excerpt?: string; quote?: QuoteStatus; check?: AnswerCheck; suggestedAnswer?: string } | null;
  questionId: string | null;
  /** For an accepted draft: false when it joined a quiz only, not the bank. */
  question?: { adHoc: boolean } | null;
}

interface JobResponse {
  id: string;
  status: 'QUEUED' | 'RUNNING' | 'DONE' | 'FAILED';
  params: { count: number };
  stats: { asked?: number; created?: number; dropped?: number } | null;
  error: string | null;
  subject: { id: string; name: string; code: string; topics: Array<{ id: string; name: string }> };
  materials: Array<{ id: string; title: string }>;
  drafts: Draft[];
}

/**
 * Accepts a draft into the bank. If the bank already has a question of the same
 * meaning the server says so, and the teacher decides whether to add it anyway.
 */
async function acceptIntoBank(draftId: string, question?: unknown): Promise<boolean> {
  return sendUnlessRepeat((allowSimilar) =>
    apiFetch(`/api/admin/ai/drafts/${draftId}/accept`, { method: 'POST', body: { question, allowSimilar } }),
  );
}

/**
 * The review list for one AI batch. Nothing here is in the bank until the
 * teacher accepts it; each draft shows its answer key and the passage it came
 * from, so it can be checked against the material rather than trusted.
 */
export function AiDraftReview({ jobId }: { jobId: string }) {
  const [running, setRunning] = React.useState(true);
  const { data, error, initialLoading, refetch } = useApi<JobResponse>(`/api/admin/ai/jobs/${jobId}`, {
    refreshInterval: running ? 2500 : undefined,
  });
  const [editing, setEditing] = React.useState<Draft | null>(null);
  const [acceptingAll, setAcceptingAll] = React.useState(false);
  const [quizOpen, setQuizOpen] = React.useState(false);

  React.useEffect(() => {
    if (data) setRunning(data.status === 'QUEUED' || data.status === 'RUNNING');
  }, [data]);

  const subjects = React.useMemo(
    () => (data ? [{ id: data.subject.id, name: data.subject.name, topics: data.subject.topics }] : []),
    [data],
  );

  if (error && !data) {
    return (
      <PageShell>
        <ErrorState error={error} onRetry={() => void refetch()} />
      </PageShell>
    );
  }
  if (initialLoading || !data) {
    return (
      <PageShell>
        <SkeletonRows rows={5} />
      </PageShell>
    );
  }

  const pending = data.drafts.filter((draft) => draft.status === 'PENDING');
  const accepted = data.drafts.filter((draft) => draft.status === 'ACCEPTED').length;
  const held = pending.filter((draft) => isFlagged(draft.source)).length;
  const usable = pending.length - held + data.drafts.filter((draft) => draft.status === 'ACCEPTED' && !draft.question?.adHoc).length;
  const visible = data.drafts.filter((draft) => draft.status !== 'DISCARDED');
  const topicName = (id?: string) => data.subject.topics.find((topic) => topic.id === id)?.name;
  const materialTitle = (id?: string) => data.materials.find((material) => material.id === id)?.title;

  const acceptAll = async () => {
    setAcceptingAll(true);
    try {
      const result = await apiFetch<{ accepted: number; skipped: number; held: number }>(`/api/admin/ai/jobs/${jobId}/accept-all`, {
        method: 'POST',
      });
      toast.success(
        `${result.accepted} question${result.accepted === 1 ? '' : 's'} added to the bank` +
          (result.skipped > 0 ? `; ${result.skipped} skipped (invalid, or the bank already has them)` : '') +
          (result.held > 0 ? `; ${result.held} flagged for a closer look, left for you to review` : '') +
          '.',
      );
      await refetch();
    } catch (caught) {
      toast.error(caught instanceof ApiClientError ? caught.message : 'We could not accept them.');
    } finally {
      setAcceptingAll(false);
    }
  };

  const editingRecord: QuestionRecord | null = editing
    ? {
        id: editing.id,
        text: editing.payload.text,
        type: editing.payload.type,
        difficulty: editing.payload.difficulty,
        bloom: editing.payload.bloom ?? null,
        marks: editing.payload.marks,
        negativeMarks: editing.payload.negativeMarks,
        explanation: editing.payload.explanation ?? null,
        subjectId: data.subject.id,
        topicId: editing.payload.topicId || null,
        assertionText: editing.payload.assertionText ?? null,
        reasonText: editing.payload.reasonText ?? null,
        acceptedAnswers: editing.payload.acceptedAnswers ?? [],
        options: editing.payload.options.map((option, index) => ({ id: String(index), ...option })),
      }
    : null;

  return (
    <PageShell>
      <Button asChild variant="ghost" size="sm" className="-ml-2 mb-3">
        <Link href={`/admin/questions?subject=${encodeURIComponent(data.subject.id)}`}>
          <ArrowLeft />
          {data.subject.name} question bank
        </Link>
      </Button>

      <PageHeader
        title="AI drafts"
        description={`${data.subject.name} · from ${data.materials.map((material) => material.title).join(', ') || 'your material'}. Check each question against the material before accepting it.`}
        actions={
          !running && usable > 0 ? (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => setQuizOpen(true)}>
                <ClipboardList />
                Create quiz
              </Button>
              {pending.length - held > 0 ? (
                <Button loading={acceptingAll} onClick={() => void acceptAll()}>
                  <CheckCheck />
                  Add {pending.length - held} to the bank
                </Button>
              ) : null}
            </div>
          ) : null
        }
      />

      <div className="mt-6" aria-live="polite">
        {running ? (
          <p className="flex items-center gap-2 text-sm text-foreground">
            <Loader2 className="size-4 animate-spin text-primary" aria-hidden />
            Writing questions… {data.stats?.created ?? 0} of {data.params.count} so far. You can leave this
            page; the batch keeps going.
          </p>
        ) : data.status === 'FAILED' ? (
          <p className="text-sm text-destructive">{data.error ?? 'Generation failed.'}</p>
        ) : (
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{data.stats?.created ?? data.drafts.length} drafts</span>
            {data.stats?.dropped ? ` · ${data.stats.dropped} dropped by the checks (invalid or repeated)` : ''}
            {accepted > 0 ? ` · ${accepted} accepted` : ''}
            {held > 0 ? ` · ${held} flagged, check ${held === 1 ? 'it' : 'them'} first` : ''}
            {data.error ? ` · ${data.error}` : ''}
          </p>
        )}
      </div>

      {visible.length === 0 && !running ? (
        <div className="mt-6">
          <EmptyState
            icon={FileText}
            title="No drafts to review"
            description="Try a broader focus, another material, or fewer constraints."
            action={
              <Button asChild variant="outline">
                <Link href={`/admin/questions?subject=${encodeURIComponent(data.subject.id)}`}>Back to the bank</Link>
              </Button>
            }
          />
        </div>
      ) : (
        <ol className="mt-6 space-y-4">
          {visible.map((draft, index) => (
            <DraftCard
              key={draft.id}
              index={index}
              draft={draft}
              topicName={topicName(draft.payload.topicId)}
              materialTitle={materialTitle(draft.source?.materialId)}
              onChanged={() => void refetch()}
              onEdit={() => setEditing(draft)}
            />
          ))}
        </ol>
      )}

      <QuestionEditor
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        question={editingRecord}
        subjects={subjects}
        title="Edit and accept"
        submitLabel="Accept into the bank"
        onSubmit={async (body) => {
          if (!(await acceptIntoBank(editing!.id, body))) {
            throw new ApiClientError('CONFLICT', 'Not added to the bank.', 409);
          }
          toast.success('Question added to the bank.');
        }}
        onSaved={() => void refetch()}
      />

      <QuizFromDraftsDialog
        open={quizOpen}
        onOpenChange={setQuizOpen}
        jobId={jobId}
        subjectName={data.subject.name}
        count={usable}
        held={held}
      />
    </PageShell>
  );
}

function DraftCard({
  index,
  draft,
  topicName,
  materialTitle,
  onChanged,
  onEdit,
}: {
  index: number;
  draft: Draft;
  topicName?: string;
  materialTitle?: string;
  onChanged: () => void;
  onEdit: () => void;
}) {
  const [busy, setBusy] = React.useState<'accept' | 'regenerate' | 'discard' | null>(null);
  const { payload } = draft;
  const done = draft.status === 'ACCEPTED';

  const act = async (kind: 'accept' | 'regenerate' | 'discard') => {
    setBusy(kind);
    try {
      if (kind === 'discard') await apiFetch(`/api/admin/ai/drafts/${draft.id}`, { method: 'DELETE' });
      else if (kind === 'accept') {
        if (!(await acceptIntoBank(draft.id))) return;
      } else await apiFetch(`/api/admin/ai/drafts/${draft.id}/${kind}`, { method: 'POST' });
      if (kind === 'accept') toast.success('Added to the bank.');
      if (kind === 'regenerate') toast.success('Replaced with a new question.');
      onChanged();
    } catch (caught) {
      toast.error(caught instanceof ApiClientError ? caught.message : 'That did not work. Try again.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <li
      className={cn(
        'rounded-lg border bg-card p-5',
        done ? 'border-success/30' : 'border-border',
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="tabular text-sm font-semibold text-muted-foreground">Q{index + 1}</span>
        <Badge variant="outline">{QUESTION_TYPE_LABEL[payload.type]}</Badge>
        <Badge variant="muted">{payload.difficulty.charAt(0) + payload.difficulty.slice(1).toLowerCase()}</Badge>
        {payload.bloom ? <Badge variant="muted">{BLOOM_LABEL[payload.bloom]}</Badge> : null}
        <Badge variant="muted">
          {payload.marks} mark{payload.marks === 1 ? '' : 's'}
          {payload.negativeMarks > 0 ? ` · −${payload.negativeMarks}` : ''}
        </Badge>
        {topicName ? <Badge variant="muted">{topicName}</Badge> : <Badge variant="warning">No topic</Badge>}
        {done ? (
          <Badge variant="success" className="ml-auto">
            <CheckCircle2 aria-hidden />
            {draft.question?.adHoc ? 'In a quiz only' : 'In the bank'}
          </Badge>
        ) : null}
      </div>

      <MathText as="p" text={payload.text} className="mt-3 break-words text-foreground" />

      {payload.type === 'ASSERTION_REASON' ? (
        <div className="mt-2 space-y-1 text-sm">
          <p>
            <span className="font-medium">Assertion (A):</span> <MathText text={payload.assertionText ?? ''} />
          </p>
          <p>
            <span className="font-medium">Reason (R):</span> <MathText text={payload.reasonText ?? ''} />
          </p>
        </div>
      ) : null}

      {payload.options.length > 0 ? (
        <ul className="mt-3 space-y-1.5">
          {payload.options.map((option, i) => (
            <li
              key={i}
              className={cn(
                'flex items-start gap-2 rounded-md border px-3 py-2 text-sm',
                option.isCorrect ? 'border-success/40 bg-success-subtle/40' : 'border-border',
              )}
            >
              {option.isCorrect ? (
                <Check className="mt-0.5 size-4 shrink-0 text-success" aria-label="Correct" />
              ) : (
                <X className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-label="Incorrect" />
              )}
              <MathText text={option.text} />
            </li>
          ))}
        </ul>
      ) : null}

      {payload.acceptedAnswers && payload.acceptedAnswers.length > 0 ? (
        <p className="mt-3 text-sm">
          <span className="font-medium">Accepted answers:</span> {payload.acceptedAnswers.join(' · ')}
        </p>
      ) : null}

      {payload.explanation ? (
        <p className="mt-3 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">Why: </span>
          <MathText text={payload.explanation} />
        </p>
      ) : null}

      {draft.source && (draft.source.excerpt || draft.source.page) ? (
        <p className="mt-3 flex items-start gap-2 border-l-2 border-border pl-3 text-xs text-muted-foreground">
          <FileText className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>
            {materialTitle ?? 'Source'}
            {draft.source.page ? `, page ${draft.source.page}` : ''}
            {draft.source.excerpt ? (
              <>
                : “<MathText text={draft.source.excerpt} />”
              </>
            ) : null}
          </span>
        </p>
      ) : null}

      <DraftChecks draft={draft} onChanged={onChanged} />

      {!done ? (
        <div className="mt-4 flex flex-wrap gap-2">
          <Button size="sm" loading={busy === 'accept'} disabled={busy !== null} onClick={() => void act('accept')}>
            <Check />
            Accept
          </Button>
          <Button size="sm" variant="outline" disabled={busy !== null} onClick={onEdit}>
            <Pencil />
            Edit and accept
          </Button>
          <Button
            size="sm"
            variant="outline"
            loading={busy === 'regenerate'}
            disabled={busy !== null}
            onClick={() => void act('regenerate')}
          >
            <RefreshCw />
            Regenerate
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="hover:bg-danger-subtle hover:text-destructive"
            loading={busy === 'discard'}
            disabled={busy !== null}
            onClick={() => void act('discard')}
          >
            <Trash2 />
            Discard
          </Button>
        </div>
      ) : null}
    </li>
  );
}

/** `datetime-local` needs `YYYY-MM-DDTHH:mm` in local time. */
const localInput = (date: Date) => new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

/**
 * Builds a draft quiz straight from the batch. The teacher only names it and
 * sets the window; students, security and publishing are done on the quiz page.
 */
function QuizFromDraftsDialog({
  open,
  onOpenChange,
  jobId,
  subjectName,
  count,
  held,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobId: string;
  subjectName: string;
  count: number;
  held: number;
}) {
  const router = useRouter();
  const [title, setTitle] = React.useState(`${subjectName} quiz`);
  const [duration, setDuration] = React.useState(String(Math.max(10, Math.ceil(count * 1.5))));
  const [startsAt, setStartsAt] = React.useState('');
  const [endsAt, setEndsAt] = React.useState('');
  const [addToBank, setAddToBank] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    const start = new Date(Date.now() + 30 * 60_000);
    start.setSeconds(0, 0);
    setStartsAt(localInput(start));
    setEndsAt(localInput(new Date(start.getTime() + 2 * 60 * 60_000)));
    setTitle(`${subjectName} quiz`);
    setDuration(String(Math.max(10, Math.ceil(count * 1.5))));
    setError(null);
  }, [open, subjectName, count]);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await apiFetch<{ quizId: string; questions: number; toBank: number; repeats: number; skipped: number }>(
        `/api/admin/ai/jobs/${jobId}/quiz`,
        {
          method: 'POST',
          body: {
            title,
            durationMinutes: Number(duration),
            startsAt: new Date(startsAt).toISOString(),
            endsAt: new Date(endsAt).toISOString(),
            addToBank,
          },
        },
      );
      toast.success(
        `Quiz saved as a draft with ${result.questions} questions` +
          (addToBank ? `; ${result.toBank} added to the bank` : '') +
          (result.repeats > 0 ? `, ${result.repeats} kept out because the bank has them already` : '') +
          '.',
      );
      router.push(`/admin/quizzes/${result.quizId}`);
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : 'We could not create the quiz.');
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={busy ? undefined : onOpenChange}>
      <DialogContent hideClose={busy} className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Create a quiz from these {count} questions</DialogTitle>
          <DialogDescription>
            It is saved as a draft. Next you pick students and security settings, then publish.
            {held > 0
              ? ` ${held} flagged question${held === 1 ? ' is' : 's are'} left out until you review ${held === 1 ? 'it' : 'them'}.`
              : ''}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="ai-quiz-title" required>
              Quiz name
            </Label>
            <Input id="ai-quiz-title" value={title} onChange={(event) => setTitle(event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ai-quiz-duration" required>
              Minutes
            </Label>
            <Input
              id="ai-quiz-duration"
              type="number"
              min={1}
              max={360}
              value={duration}
              onChange={(event) => setDuration(event.target.value)}
            />
          </div>
          <div className="hidden sm:block" />
          <div className="space-y-2">
            <Label htmlFor="ai-quiz-start" required>
              Opens
            </Label>
            <Input id="ai-quiz-start" type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ai-quiz-end" required>
              Closes
            </Label>
            <Input id="ai-quiz-end" type="datetime-local" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} />
          </div>
        </div>

        <div className="flex items-start gap-3 rounded-md border border-border p-3">
          <Checkbox id="ai-quiz-bank" checked={addToBank} onCheckedChange={(on) => setAddToBank(on === true)} className="mt-0.5" />
          <label htmlFor="ai-quiz-bank" className="cursor-pointer text-sm">
            <span className="font-medium">Also add the questions to the {subjectName} bank</span>
            <span className="mt-0.5 block text-muted-foreground">
              {addToBank
                ? 'Questions the bank already has in other words stay on this quiz only.'
                : 'The questions belong to this quiz alone and never appear in the bank.'}
            </span>
          </label>
        </div>

        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}

        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button loading={busy} onClick={() => void create()}>
            <ClipboardList />
            Create quiz
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** What the checks found about a draft's source, so the teacher knows where to look first. */
function DraftChecks({ draft, onChanged }: { draft: Draft; onChanged: () => void }) {
  const { source, payload } = draft;
  const [adding, setAdding] = React.useState(false);
  if (!source) return null;

  const items: Array<{ ok: boolean | null; text: string }> = [];
  if (source.quote === 'exact') items.push({ ok: true, text: 'Quote found in the material' });
  else if (source.quote === 'close') items.push({ ok: true, text: 'Quote closely matches the material' });
  else if (source.quote === 'missing') items.push({ ok: false, text: 'Quote not found in the material' });
  else if (source.quote === 'unchecked') items.push({ ok: null, text: 'Quote could not be checked' });
  if (source.check === 'agrees') items.push({ ok: true, text: 'Answer re-derived from the page and matches' });
  else if (source.check === 'differs') items.push({ ok: false, text: 'A second reading gives a different answer: check the key' });

  const suggestion = draft.status === 'PENDING' && payload.type === 'SHORT_ANSWER' ? source.suggestedAnswer : undefined;
  const alsoAccept = async () => {
    setAdding(true);
    try {
      await apiFetch(`/api/admin/ai/drafts/${draft.id}`, {
        method: 'PATCH',
        body: { draft: { ...payload, acceptedAnswers: [...(payload.acceptedAnswers ?? []), suggestion] }, topicId: payload.topicId ?? '' },
      });
      onChanged();
    } catch (caught) {
      toast.error(caught instanceof ApiClientError ? caught.message : 'We could not update the answer key.');
    } finally {
      setAdding(false);
    }
  };

  if (items.length === 0 && !suggestion) return null;
  return (
    <div className="mt-3 space-y-2">
      {items.length > 0 ? (
        <ul className="flex flex-wrap gap-2" aria-label="Checks on this question">
          {items.map((item) => (
            <li key={item.text}>
              <Badge variant={item.ok === null ? 'muted' : item.ok ? 'success' : 'warning'}>
                {item.ok === false ? <AlertTriangle aria-hidden /> : item.ok ? <CheckCircle2 aria-hidden /> : null}
                {item.text}
              </Badge>
            </li>
          ))}
        </ul>
      ) : null}
      {suggestion ? (
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <Badge variant="warning">
            <AlertTriangle aria-hidden />
            Answer key may be too narrow
          </Badge>
          <span className="text-muted-foreground">
            It accepts only {(payload.acceptedAnswers ?? []).join(', ') || 'nothing'}; the material also words it as “{suggestion}”.
          </span>
          <Button size="sm" variant="outline" loading={adding} onClick={() => void alsoAccept()}>
            Also accept it
          </Button>
        </p>
      ) : null}
    </div>
  );
}
