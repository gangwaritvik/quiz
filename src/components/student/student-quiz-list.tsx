'use client';

import { BookOpenCheck } from 'lucide-react';
import * as React from 'react';

import { ErrorState } from '@/components/shared/error-state';
import { PageHeader, PageShell } from '@/components/shared/page-header';
import { QuizCard, type QuizState, type StudentQuizSummary } from '@/components/student/quiz-card';
import { EmptyState } from '@/components/ui/empty-state';
import { SkeletonCard } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useApi } from '@/hooks/use-api';

interface QuizListData {
  quizzes: StudentQuizSummary[];
}

type Filter = 'active' | 'completed' | 'missed' | 'all';

const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: 'active', label: 'Active' },
  { value: 'completed', label: 'Completed' },
  { value: 'missed', label: 'Missed' },
  { value: 'all', label: 'All' },
];

function inFilter(filter: Filter, state: QuizState) {
  if (filter === 'all') return true;
  if (filter === 'completed') return state === 'COMPLETED';
  if (filter === 'missed') return state === 'CLOSED';
  return state === 'AVAILABLE' || state === 'SCHEDULED' || state === 'IN_PROGRESS';
}

export function StudentQuizList() {
  const { data, error, initialLoading, refetch } = useApi<QuizListData>('/api/student/quizzes');
  const [picked, setPicked] = React.useState<Filter | null>(null);

  const quizzes = data?.quizzes ?? [];
  // Open on a tab with content: Active only when something is active.
  const filter: Filter =
    picked ?? (quizzes.some((quiz) => inFilter('active', quiz.state)) ? 'active' : 'all');

  const filtered = React.useMemo(
    () => quizzes.filter((quiz) => inFilter(filter, quiz.state)),
    [quizzes, filter],
  );

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
        title="My Quizzes"
        description="Everything your faculty has assigned to you. Open a quiz to read its rules and security requirements before you begin."
      />

      <Tabs value={filter} onValueChange={(value) => setPicked(value as Filter)} className="mt-8">
        <TabsList aria-label="Filter quizzes">
          {FILTERS.map((entry) => (
            <TabsTrigger key={entry.value} value={entry.value} className="min-h-10">
              {entry.label}
              {!initialLoading ? (
                <span className="tabular rounded-sm bg-muted px-1.5 text-xs text-muted-foreground">
                  {quizzes.filter((quiz) => inFilter(entry.value, quiz.state)).length}
                </span>
              ) : null}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value={filter} className="mt-6">
          {initialLoading ? (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <SkeletonCard className="h-60" />
              <SkeletonCard className="h-60" />
              <SkeletonCard className="hidden h-60 xl:block" />
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={BookOpenCheck}
              title={
                filter === 'completed'
                  ? 'No completed quizzes yet'
                  : filter === 'missed'
                    ? 'No missed quizzes'
                    : 'No quizzes in this view'
              }
              description={
                filter === 'completed'
                  ? 'Once you submit an examination it will appear here alongside your result.'
                  : filter === 'missed'
                    ? 'Quizzes whose window closed before you attempted them will appear here.'
                    : 'Your faculty has not assigned anything in this category. Check back closer to your exam dates.'
              }
            />
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {filtered.map((quiz, index) => (
                <QuizCard key={quiz.id} quiz={quiz} index={index} />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </PageShell>
  );
}
