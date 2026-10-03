'use client';

import {
  ArrowLeft,
  Check,
  CheckCheck,
  CheckCircle2,
  FileText,
  Loader2,
  Pencil,
  RefreshCw,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';
import { toast } from 'sonner';

import { QuestionEditor, type QuestionRecord } from '@/components/admin/question-editor';
import { ErrorState } from '@/components/shared/error-state';
import { MathText } from '@/components/shared/math-text';
import { PageHeader, PageShell } from '@/components/shared/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { SkeletonRows } from '@/components/ui/skeleton';
import { useApi } from '@/hooks/use-api';
import { ApiClientError, apiFetch } from '@/lib/client/api';
import { QUESTION_TYPE_LABEL, type QuestionTypeValue } from '@/lib/question-types';
import { cn } from '@/lib/utils';

interface DraftPayload {
  text: string;
  type: QuestionTypeValue;
  difficulty: 'EASY' | 'MEDIUM' | 'HARD';
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
  source: { materialId?: string; page?: number; excerpt?: string } | null;
  questionId: string | null;
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
  const visible = data.drafts.filter((draft) => draft.status !== 'DISCARDED');
  const topicName = (id?: string) => data.subject.topics.find((topic) => topic.id === id)?.name;
  const materialTitle = (id?: string) => data.materials.find((material) => material.id === id)?.title;

  const acceptAll = async () => {
    setAcceptingAll(true);
    try {
      const result = await apiFetch<{ accepted: number; skipped: number }>(`/api/admin/ai/jobs/${jobId}/accept-all`, {
        method: 'POST',
      });
      toast.success(
        `${result.accepted} question${result.accepted === 1 ? '' : 's'} added to the bank` +
          (result.skipped > 0 ? `; ${result.skipped} need a fix first.` : '.'),
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
          pending.length > 0 ? (
            <Button loading={acceptingAll} onClick={() => void acceptAll()}>
              <CheckCheck />
              Accept all {pending.length}
            </Button>
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
            {data.error ? ` · ${data.error}` : ''}
          </p>
        )}
      </div>

      {visible.length === 0 && !running ? (
        <div className="mt-6">
          <EmptyState
            icon={Sparkles}
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
        <ol className="stagger mt-6 space-y-4">
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
          await apiFetch(`/api/admin/ai/drafts/${editing!.id}/accept`, { method: 'POST', body: { question: body } });
          toast.success('Question added to the bank.');
        }}
        onSaved={() => void refetch()}
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
      else await apiFetch(`/api/admin/ai/drafts/${draft.id}/${kind}`, { method: 'POST' });
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
        <Badge variant="muted">
          {payload.marks} mark{payload.marks === 1 ? '' : 's'}
          {payload.negativeMarks > 0 ? ` · −${payload.negativeMarks}` : ''}
        </Badge>
        {topicName ? <Badge variant="muted">{topicName}</Badge> : <Badge variant="warning">No topic</Badge>}
        {done ? (
          <Badge variant="success" className="ml-auto">
            <CheckCircle2 aria-hidden />
            In the bank
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
