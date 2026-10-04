'use client';

import { Dices, Wand2 } from 'lucide-react';
import * as React from 'react';

import { ChipGroup } from '@/components/admin/ai-generate-dialog';
import type { SavedQuestion } from '@/components/admin/instant-question-builder';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiClientError, apiFetch } from '@/lib/client/api';
import { BLOOM_LABEL, BLOOM_ORDER, type BloomValue } from '@/lib/question-types';
import { cn } from '@/lib/utils';

interface Proposed extends SavedQuestion {
  id: string;
  difficulty: 'EASY' | 'MEDIUM' | 'HARD';
  topic: string | null;
}

interface Proposal {
  questions: Proposed[];
  summary: {
    asked: number;
    picked: number;
    available: number;
    short: Record<'EASY' | 'MEDIUM' | 'HARD', number>;
    filledFromOther: number;
    repeatsSkipped: number;
  };
}

const LEVEL = { EASY: 'Easy', MEDIUM: 'Medium', HARD: 'Hard' } as const;

/** The plain-English line under a proposal: what was found, and what was not. */
function describe(summary: Proposal['summary']): string[] {
  const lines = [`Picked ${summary.picked} of ${summary.asked} from ${summary.available} questions in the bank.`];
  const short = (Object.keys(summary.short) as Array<keyof typeof summary.short>).filter((level) => summary.short[level] > 0);
  if (summary.filledFromOther > 0) {
    lines.push(
      `The bank is short of ${short.map((level) => LEVEL[level].toLowerCase()).join(' and ')} questions, so ${summary.filledFromOther} ${summary.filledFromOther === 1 ? 'place was' : 'places were'} filled with another difficulty.`,
    );
  } else if (short.length > 0) {
    lines.push(`Not enough ${short.map((level) => LEVEL[level].toLowerCase()).join(' or ')} questions to meet the mix.`);
  }
  if (summary.repeatsSkipped > 0) {
    lines.push(`${summary.repeatsSkipped} question${summary.repeatsSkipped === 1 ? '' : 's'} left out because they mean the same as one already chosen.`);
  }
  return lines;
}

/**
 * Proposes a paper from the question bank for the quiz form: the mix asked for,
 * spread over the topics, with no two questions that mean the same. Nothing is
 * saved until the teacher uses the proposal and creates the quiz.
 */
export function AssemblePaperDialog({
  open,
  onOpenChange,
  subjectId,
  subjectName,
  topics,
  avoidIds,
  onUse,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subjectId: string;
  subjectName: string;
  topics: Array<{ id: string; name: string }>;
  /** Bank questions already on the paper. */
  avoidIds: string[];
  onUse: (questions: SavedQuestion[], bankIds: string[]) => void;
}) {
  const [count, setCount] = React.useState('10');
  const [mix, setMix] = React.useState({ easy: 30, medium: 50, hard: 20 });
  const [topicIds, setTopicIds] = React.useState<string[]>([]);
  const [bloom, setBloom] = React.useState<BloomValue[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [proposal, setProposal] = React.useState<Proposal | null>(null);

  React.useEffect(() => {
    if (open) {
      setProposal(null);
      setError(null);
    }
  }, [open]);

  const total = mix.easy + mix.medium + mix.hard;
  const size = Number.parseInt(count, 10);
  const valid = total === 100 && Number.isInteger(size) && size >= 1 && size <= 100;

  const assemble = async () => {
    setBusy(true);
    setError(null);
    try {
      setProposal(
        await apiFetch<Proposal>('/api/admin/quizzes/assemble', {
          method: 'POST',
          body: { subjectId, count: size, easyPct: mix.easy, mediumPct: mix.medium, hardPct: mix.hard, topicIds, bloom, avoidIds },
        }),
      );
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : 'We could not build a paper.');
    } finally {
      setBusy(false);
    }
  };

  const mixInput = (key: keyof typeof mix, label: string) => (
    <div className="space-y-1.5">
      <Label htmlFor={`assemble-${key}`}>{label} %</Label>
      <Input
        id={`assemble-${key}`}
        type="number"
        min={0}
        max={100}
        value={mix[key]}
        onChange={(event) => setMix((current) => ({ ...current, [key]: Number(event.target.value) || 0 }))}
      />
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={busy ? undefined : onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Build the paper from {subjectName}</DialogTitle>
          <DialogDescription>
            Picks questions from the bank to match the mix, spread across topics, favouring ones used least, and never two that mean the same.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-4">
          <div className="space-y-1.5">
            <Label htmlFor="assemble-count">How many</Label>
            <Input id="assemble-count" type="number" min={1} max={100} value={count} onChange={(event) => setCount(event.target.value)} />
          </div>
          {mixInput('easy', 'Easy')}
          {mixInput('medium', 'Medium')}
          {mixInput('hard', 'Hard')}
        </div>
        {total !== 100 ? (
          <p role="alert" className="text-xs text-destructive">
            The mix adds up to {total}%. It must be 100%.
          </p>
        ) : null}

        {topics.length > 0 ? (
          <ChipGroup
            label="Topics (leave empty for all)"
            options={topics.map((topic) => [topic.id, topic.name] as const)}
            value={topicIds}
            onChange={setTopicIds}
          />
        ) : null}
        <ChipGroup
          label="Thinking level (leave empty for any)"
          options={BLOOM_ORDER.map((level) => [level, BLOOM_LABEL[level]] as const)}
          value={bloom}
          onChange={setBloom}
        />

        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}

        {proposal ? (
          <section aria-live="polite" className="space-y-3 rounded-lg border border-border bg-muted/30 p-4">
            <div className="space-y-1 text-sm">
              {describe(proposal.summary).map((line, i) => (
                <p key={line} className={cn(i === 0 ? 'font-medium text-foreground' : 'text-muted-foreground')}>
                  {line}
                </p>
              ))}
            </div>
            <ol className="scrollbar-slim max-h-56 space-y-2 overflow-y-auto pr-1">
              {proposal.questions.map((question, index) => (
                <li key={question.id} className="flex items-start gap-3 text-sm">
                  <span className="tabular w-6 shrink-0 text-muted-foreground">{index + 1}</span>
                  <MathText text={question.text} className="line-clamp-2 min-w-0 flex-1 break-words" />
                  <Badge variant="muted" className="shrink-0">
                    {LEVEL[question.difficulty]}
                  </Badge>
                  {question.topic ? (
                    <Badge variant="outline" className="hidden shrink-0 sm:inline-flex">
                      {question.topic}
                    </Badge>
                  ) : null}
                </li>
              ))}
            </ol>
          </section>
        ) : null}

        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant={proposal ? 'outline' : 'default'} loading={busy} disabled={!valid} onClick={() => void assemble()}>
            {proposal ? <Dices /> : <Wand2 />}
            {proposal ? 'Pick again' : 'Build a paper'}
          </Button>
          {proposal && proposal.questions.length > 0 ? (
            <Button
              onClick={() => {
                onUse(proposal.questions, proposal.questions.map((question) => question.id));
                onOpenChange(false);
              }}
            >
              Use these {proposal.questions.length}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
