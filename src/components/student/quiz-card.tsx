'use client';

import { motion } from 'framer-motion';
import {
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  CircleDot,
  Clock,
  Hourglass,
  ListChecks,
  Lock,
  type LucideIcon,
  PlayCircle,
  Video,
} from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn, formatRelativeDay, pluralize } from '@/lib/utils';

export type QuizState = 'AVAILABLE' | 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED' | 'CLOSED';

export interface StudentQuizSummary {
  id: string;
  title: string;
  subject: string;
  subjectCode?: string;
  questionCount: number;
  durationMinutes: number;
  startsAt: string;
  endsAt: string;
  state: QuizState;
  activeAttemptId?: string | null;
  resultAttemptId?: string | null;
  percentage?: number | null;
  cameraMonitoring?: boolean;
}

/** Icon + wording for every state, so the badge never relies on colour alone. */
const STATE_BADGE: Record<
  QuizState,
  { label: string; icon: LucideIcon; variant: 'success' | 'warning' | 'muted' | 'default' }
> = {
  AVAILABLE: { label: 'Open now', icon: CircleDot, variant: 'success' },
  SCHEDULED: { label: 'Scheduled', icon: CalendarClock, variant: 'default' },
  IN_PROGRESS: { label: 'In progress', icon: Hourglass, variant: 'warning' },
  COMPLETED: { label: 'Completed', icon: CheckCircle2, variant: 'muted' },
  // CLOSED = window ended with no submission, i.e. missed.
  CLOSED: { label: 'Missed', icon: Lock, variant: 'muted' },
};

export function QuizCard({ quiz, index = 0 }: { quiz: StudentQuizSummary; index?: number }) {
  const badge = STATE_BADGE[quiz.state];
  const BadgeIcon = badge.icon;
  // The time the student needs to act on is the one set in ink.
  const opensMatters = quiz.state === 'SCHEDULED';
  const closesMatters = quiz.state === 'AVAILABLE' || quiz.state === 'IN_PROGRESS';

  return (
    <motion.article
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, delay: Math.min(index, 6) * 0.03, ease: [0.2, 0, 0, 1] }}
      className="flex h-full min-w-0 flex-col rounded-lg border border-border bg-card"
    >
      <div className="flex flex-1 flex-col p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="type-eyebrow min-w-0 truncate">
            {quiz.subject}
            {quiz.subjectCode ? ` · ${quiz.subjectCode}` : ''}
          </p>
          <Badge variant={badge.variant}>
            <BadgeIcon aria-hidden />
            {badge.label}
          </Badge>
        </div>

        <h3 className="mt-2 line-clamp-2 break-words text-base font-semibold leading-snug" title={quiz.title}>
          {quiz.title}
        </h3>

        <dl className="mb-4 mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <div>
            <dt className="sr-only">Questions</dt>
            <dd className="flex items-center gap-1.5">
              <ListChecks className="size-4 shrink-0" aria-hidden />
              {pluralize(quiz.questionCount, 'question')}
            </dd>
          </div>
          <div>
            <dt className="sr-only">Duration</dt>
            <dd className="flex items-center gap-1.5">
              <Clock className="size-4 shrink-0" aria-hidden />
              {quiz.durationMinutes} min
            </dd>
          </div>
          {quiz.cameraMonitoring ? (
            <div>
              <dt className="sr-only">Monitoring</dt>
              <dd className="flex items-center gap-1.5">
                <Video className="size-4 shrink-0" aria-hidden />
                Camera on
              </dd>
            </div>
          ) : null}
        </dl>

        <dl className="mt-auto grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 border-t border-border pt-3 text-sm">
          <dt className="text-muted-foreground">{opensMatters ? 'Opens' : 'Opened'}</dt>
          <dd className={cn('tabular truncate', opensMatters ? 'font-medium text-foreground' : 'text-muted-foreground')}>
            {formatRelativeDay(quiz.startsAt)}
          </dd>
          <dt className="text-muted-foreground">{quiz.state === 'CLOSED' || new Date(quiz.endsAt) < new Date() ? 'Closed' : 'Closes'}</dt>
          <dd className={cn('tabular truncate', closesMatters ? 'font-medium text-foreground' : 'text-muted-foreground')}>
            {formatRelativeDay(quiz.endsAt)}
          </dd>
        </dl>
      </div>

      <div className="border-t border-border p-4">
        <QuizAction quiz={quiz} />
      </div>
    </motion.article>
  );
}

function QuizAction({ quiz }: { quiz: StudentQuizSummary }) {
  if (quiz.state === 'IN_PROGRESS' && quiz.activeAttemptId) {
    return (
      <Button asChild className="w-full" variant="default">
        <Link href={`/exam/${quiz.activeAttemptId}`}>
          <PlayCircle aria-hidden />
          Resume exam
        </Link>
      </Button>
    );
  }

  if (quiz.state === 'COMPLETED') {
    return quiz.resultAttemptId ? (
      <Button asChild variant="outline" className="w-full">
        <Link href={`/results/${quiz.resultAttemptId}`}>
          <CheckCircle2 aria-hidden />
          View result
          {typeof quiz.percentage === 'number' ? (
            <span className="tabular ml-auto font-semibold">{quiz.percentage}%</span>
          ) : null}
        </Link>
      </Button>
    ) : (
      <p className="flex min-h-10 w-full items-center justify-center gap-1.5 text-sm text-muted-foreground">
        <Lock className="size-3.5 shrink-0" aria-hidden />
        Results not released yet
      </p>
    );
  }

  if (quiz.state === 'CLOSED') {
    return (
      <p className="flex min-h-10 w-full items-center justify-center gap-1.5 text-sm text-muted-foreground">
        <Lock className="size-3.5 shrink-0" aria-hidden />
        You did not attempt this quiz
      </p>
    );
  }

  return (
    <Button
      asChild
      className="w-full"
      variant={quiz.state === 'AVAILABLE' ? 'default' : 'outline'}
    >
      <Link href={`/quizzes/${quiz.id}`}>
        View quiz
        <ArrowRight aria-hidden />
      </Link>
    </Button>
  );
}
