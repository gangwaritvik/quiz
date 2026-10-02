'use client';

import { AlertTriangle, Check } from 'lucide-react';
import * as React from 'react';
import { toast } from 'sonner';

import { SecuritySettings, type QuizSecurity } from '@/components/admin/security-settings';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input, Textarea } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiClientError, apiFetch } from '@/lib/client/api';
import { cn } from '@/lib/utils';

/** The list row this dialog edits. */
export interface EditableQuiz {
  id: string;
  title: string;
  description: string | null;
  durationMinutes: number;
  difficultyMix: { easy: number; medium: number; hard: number };
  startsAt: string;
  endsAt: string;
  attemptCount: number;
  security: Record<string, boolean>;
}

/** `datetime-local` wants local wall-clock time with no zone suffix. */
function toLocalInput(iso: string): string {
  const date = new Date(iso);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function fromLocalInput(value: string): string {
  return new Date(value).toISOString();
}

/**
 * Edits a quiz's details — not its questions, which have their own route and
 * their own freeze rule. Settings stay editable after students have sat the
 * paper (renaming a finished exam is harmless); the server refuses only while
 * an attempt is actually in progress.
 */
export function QuizEditDialog({
  quiz,
  onOpenChange,
  onSaved,
}: {
  quiz: EditableQuiz | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [durationMinutes, setDurationMinutes] = React.useState('30');
  const [easyPct, setEasyPct] = React.useState(30);
  const [mediumPct, setMediumPct] = React.useState(50);
  const [hardPct, setHardPct] = React.useState(20);
  const [startsAt, setStartsAt] = React.useState('');
  const [endsAt, setEndsAt] = React.useState('');
  const [security, setSecurity] = React.useState<QuizSecurity | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [errors, setErrors] = React.useState<Record<string, string[]>>({});

  // Re-seed the form each time a different quiz is opened.
  React.useEffect(() => {
    if (!quiz) return;
    setTitle(quiz.title);
    setDescription(quiz.description ?? '');
    setDurationMinutes(String(quiz.durationMinutes));
    setEasyPct(quiz.difficultyMix.easy);
    setMediumPct(quiz.difficultyMix.medium);
    setHardPct(quiz.difficultyMix.hard);
    setStartsAt(toLocalInput(quiz.startsAt));
    setEndsAt(toLocalInput(quiz.endsAt));
    setSecurity(quiz.security as unknown as QuizSecurity);
    setErrors({});
  }, [quiz]);

  const save = async () => {
    if (!quiz) return;

    const next: Record<string, string[]> = {};
    if (title.trim().length < 3) next.title = ['Enter a name of at least 3 characters'];
    if ((Number.parseInt(durationMinutes, 10) || 0) < 1) {
      next.durationMinutes = ['Enter a duration in minutes'];
    }
    if (new Date(endsAt) <= new Date(startsAt)) {
      next.endsAt = ['The end of the window must be after its start'];
    }
    if (easyPct + mediumPct + hardPct !== 100) {
      next.mediumPct = ['Difficulty distribution must total 100%'];
    }
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setSaving(true);
    try {
      await apiFetch(`/api/admin/quizzes/${quiz.id}`, {
        method: 'PATCH',
        body: {
          title: title.trim(),
          description: description.trim(),
          durationMinutes: Number.parseInt(durationMinutes, 10),
          easyPct,
          mediumPct,
          hardPct,
          startsAt: fromLocalInput(startsAt),
          endsAt: fromLocalInput(endsAt),
          security,
        },
      });
      toast.success('Quiz updated.');
      onSaved();
    } catch (caught) {
      toast.error(
        caught instanceof ApiClientError ? caught.message : 'We could not save those changes.',
      );
    } finally {
      setSaving(false);
    }
  };

  const pctTotal = easyPct + mediumPct + hardPct;

  return (
    <Dialog open={quiz !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit quiz details</DialogTitle>
          <DialogDescription>
            Changes the name, window and rules. To change what the quiz asks, open it and use the
            Questions tab.
          </DialogDescription>
        </DialogHeader>

        {quiz && quiz.attemptCount > 0 ? (
          <div className="flex items-start gap-2.5 rounded-md border border-warning/20 bg-warning-subtle px-3.5 py-3 text-sm text-warning">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            <p className="leading-relaxed">
              {quiz.attemptCount} student{quiz.attemptCount === 1 ? ' has' : 's have'} already sat
              this quiz. Changing the window or rules now will not alter what they were asked, or
              their results.
            </p>
          </div>
        ) : null}

        <div className="space-y-7">
          <DialogSection title="Details">
            <div className="space-y-2">
              <Label htmlFor="edit-title" required>
                Quiz name
              </Label>
              <Input
                id="edit-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                invalid={Boolean(errors.title)}
              />
              {errors.title ? (
                <p className="text-xs text-destructive">{errors.title[0]}</p>
              ) : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-description">Description</Label>
              <Textarea
                id="edit-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                rows={2}
              />
            </div>
          </DialogSection>

          <DialogSection title="Timing">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="edit-duration" required>
                  Duration (minutes)
                </Label>
                <Input
                  id="edit-duration"
                  type="number"
                  min={1}
                  max={360}
                  value={durationMinutes}
                  onChange={(event) => setDurationMinutes(event.target.value)}
                  invalid={Boolean(errors.durationMinutes)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-starts" required>
                  Opens
                </Label>
                <Input
                  id="edit-starts"
                  type="datetime-local"
                  value={startsAt}
                  onChange={(event) => setStartsAt(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-ends" required>
                  Closes
                </Label>
                <Input
                  id="edit-ends"
                  type="datetime-local"
                  value={endsAt}
                  onChange={(event) => setEndsAt(event.target.value)}
                  invalid={Boolean(errors.endsAt)}
                />
              </div>
            </div>
            {errors.endsAt ? <p className="text-xs text-destructive">{errors.endsAt[0]}</p> : null}
          </DialogSection>

          <DialogSection
            title="Difficulty mix"
            description="Used when this quiz draws questions from the pool. The total must equal 100%."
          >
            <div className="grid grid-cols-3 gap-3">
              <DifficultyInput label="Easy" value={easyPct} onChange={setEasyPct} />
              <DifficultyInput label="Medium" value={mediumPct} onChange={setMediumPct} />
              <DifficultyInput label="Hard" value={hardPct} onChange={setHardPct} />
            </div>
            <p
              className={cn(
                'tabular flex items-center gap-1.5 text-xs font-medium',
                pctTotal === 100 ? 'text-success' : 'text-destructive',
              )}
            >
              {pctTotal === 100 ? (
                <Check className="size-3.5" aria-hidden />
              ) : (
                <AlertTriangle className="size-3.5" aria-hidden />
              )}
              Total: {pctTotal}%{pctTotal === 100 ? '' : ' — must equal 100%'}
            </p>
            {errors.mediumPct ? <p className="text-xs text-destructive">{errors.mediumPct[0]}</p> : null}
          </DialogSection>

          {security ? (
            <DialogSection title="Rules">
              <SecuritySettings value={security} onChange={setSecurity} />
            </DialogSection>
          ) : null}
        </div>

        {/* Pinned to the bottom of the scrolling dialog so Save is always in reach. */}
        <DialogFooter className="sticky bottom-0 z-10 -mx-6 -mb-6 border-t border-border bg-card px-6 py-4 sm:-mx-7 sm:-mb-7 sm:px-7">
          <Button variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button loading={saving} onClick={() => void save()}>
            Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DialogSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-4 border-t border-border pt-6 first:border-t-0 first:pt-0">
      <div>
        <h3 className="type-subheading">{title}</h3>
        {description ? (
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function DifficultyInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  const id = `edit-difficulty-${label.toLowerCase()}`;
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          type="number"
          min={0}
          max={100}
          value={value}
          onChange={(event) => onChange(Math.max(0, Math.min(100, Number(event.target.value) || 0)))}
          className="tabular pr-8"
        />
        <span
          className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground"
          aria-hidden
        >
          %
        </span>
      </div>
    </div>
  );
}
