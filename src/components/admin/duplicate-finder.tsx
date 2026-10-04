'use client';

import { Copy, Trash2 } from 'lucide-react';
import * as React from 'react';
import { toast } from 'sonner';

import { ErrorState } from '@/components/shared/error-state';
import { MathText } from '@/components/shared/math-text';
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
import { SkeletonRows } from '@/components/ui/skeleton';
import { useApi } from '@/hooks/use-api';
import { ApiClientError, apiFetch } from '@/lib/client/api';
import { QUESTION_TYPE_LABEL, type QuestionTypeValue } from '@/lib/question-types';
import { formatDateTime } from '@/lib/utils';

interface DuplicateQuestion {
  id: string;
  text: string;
  assertionText: string | null;
  type: QuestionTypeValue;
  difficulty: 'EASY' | 'MEDIUM' | 'HARD';
  marks: number;
  aiGenerated: boolean;
  topic: string | null;
  onQuizzes: number;
  createdAt: string;
  mine: boolean;
}

interface DuplicatesResponse {
  enabled: boolean;
  scanned: number;
  groups: DuplicateQuestion[][];
}

/**
 * Finds questions in a subject's bank that mean the same as one another. The
 * teacher keeps one of each group and retires the rest; retiring is the bank's
 * ordinary soft delete, so exams already taken keep their record.
 */
export function DuplicateFinder({
  open,
  onOpenChange,
  subjectId,
  subjectName,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subjectId: string;
  subjectName: string;
  onChanged: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Repeated questions in {subjectName}</DialogTitle>
          <DialogDescription>
            Compared by meaning, not wording. Keep one question from each group and retire the others.
          </DialogDescription>
        </DialogHeader>
        {/* Mounted only while open, so the scan runs when the teacher asks for it. */}
        {open ? <DuplicateList subjectId={subjectId} onChanged={onChanged} /> : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DuplicateList({ subjectId, onChanged }: { subjectId: string; onChanged: () => void }) {
  const { data, error, initialLoading, refetch } = useApi<DuplicatesResponse>(
    `/api/admin/subjects/${subjectId}/duplicates`,
  );
  const [retiring, setRetiring] = React.useState<string | null>(null);

  if (error && !data) return <ErrorState error={error} onRetry={() => void refetch()} />;
  if (initialLoading || !data) {
    return (
      <div aria-live="polite">
        <p className="mb-3 text-sm text-muted-foreground">Comparing the questions by meaning. The first scan can take a little while.</p>
        <SkeletonRows rows={3} />
      </div>
    );
  }
  if (!data.enabled) {
    return (
      <EmptyState
        icon={Copy}
        title="Needs the AI key"
        description="Comparing by meaning uses Google's embedding model. Add GEMINI_API_KEY to the server to turn it on."
      />
    );
  }
  if (data.groups.length === 0) {
    return (
      <EmptyState
        icon={Copy}
        title="No repeats found"
        description={`Compared ${data.scanned} question${data.scanned === 1 ? '' : 's'}. None of them mean the same as another.`}
      />
    );
  }

  const retire = async (question: DuplicateQuestion) => {
    if (!window.confirm('Retire this question? It leaves the bank and no new quiz will pick it. Exams already taken keep their record.')) return;
    setRetiring(question.id);
    try {
      await apiFetch(`/api/admin/questions/${question.id}`, { method: 'DELETE' });
      toast.success('Question retired.');
      await refetch();
      onChanged();
    } catch (caught) {
      toast.error(caught instanceof ApiClientError ? caught.message : 'We could not retire it.');
    } finally {
      setRetiring(null);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground" aria-live="polite">
        <span className="font-medium text-foreground">
          {data.groups.length} group{data.groups.length === 1 ? '' : 's'}
        </span>{' '}
        of repeated questions among {data.scanned}.
      </p>
      <ol className="space-y-4">
        {data.groups.map((group) => {
          // Keep the one quizzes already use; among equals, the oldest.
          const keepId = group.reduce((best, question) => (question.onQuizzes > best.onQuizzes ? question : best)).id;
          return (
            <li key={group.map((question) => question.id).join('-')} className="rounded-lg border border-border bg-card">
              <p className="border-b border-border px-4 py-2 text-xs font-medium text-muted-foreground">
                {group.length} questions that mean the same
              </p>
              <ul className="divide-y divide-border">
                {group.map((question) => (
                  <li key={question.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline">{QUESTION_TYPE_LABEL[question.type]}</Badge>
                        <Badge variant="muted">{question.difficulty.charAt(0) + question.difficulty.slice(1).toLowerCase()}</Badge>
                        {question.topic ? <Badge variant="muted">{question.topic}</Badge> : null}
                        {question.aiGenerated ? <Badge variant="muted">AI-drafted</Badge> : null}
                        {question.onQuizzes > 0 ? (
                          <Badge variant="muted">
                            On {question.onQuizzes} quiz{question.onQuizzes === 1 ? '' : 'zes'}
                          </Badge>
                        ) : null}
                        {question.id === keepId ? <Badge variant="success">Suggested to keep</Badge> : null}
                        <span className="text-xs text-muted-foreground">Added {formatDateTime(question.createdAt)}</span>
                      </div>
                      <MathText as="p" text={question.text} className="mt-2 break-words text-sm" />
                      {question.assertionText ? (
                        <MathText as="p" text={`Assertion: ${question.assertionText}`} className="mt-1 break-words text-xs text-muted-foreground" />
                      ) : null}
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="shrink-0"
                      disabled={!question.mine || retiring !== null}
                      loading={retiring === question.id}
                      title={question.mine ? undefined : 'Only the teacher who wrote this question can retire it.'}
                      onClick={() => void retire(question)}
                    >
                      <Trash2 />
                      Retire
                    </Button>
                  </li>
                ))}
              </ul>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
