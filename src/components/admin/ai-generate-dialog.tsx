'use client';

import { Sparkles } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';

import { InlineError } from '@/components/shared/error-state';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ApiClientError, apiFetch } from '@/lib/client/api';
import { cn } from '@/lib/utils';

export interface GenerateMaterial {
  id: string;
  title: string;
  mimeType: string;
  pageCount: number | null;
}

const TYPES = [
  ['MCQ_SINGLE', 'Multiple choice'],
  ['MCQ_MULTI', 'Multiple answers'],
  ['TRUE_FALSE', 'True / false'],
  ['ASSERTION_REASON', 'Assertion–reason'],
  ['SHORT_ANSWER', 'Short answer'],
] as const;

const BLOOM = [
  ['REMEMBER', 'Remember', 'recall facts'],
  ['UNDERSTAND', 'Understand', 'explain ideas'],
  ['APPLY', 'Apply', 'use on new cases'],
  ['ANALYSE', 'Analyse', 'compare, find causes'],
] as const;

type Focus = 'whole' | 'topic' | 'pages';

/** A row of toggle chips for a multi-choice setting. */
function ChipGroup<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: ReadonlyArray<readonly [T, string, string?]>;
  value: T[];
  onChange: (next: T[]) => void;
}) {
  return (
    <fieldset className="min-w-0 space-y-2">
      <legend className="text-sm font-medium">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map(([key, name, hint]) => {
          const on = value.includes(key);
          return (
            <button
              key={key}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(on ? value.filter((entry) => entry !== key) : [...value, key])}
              className={cn(
                'inline-flex min-h-9 items-center gap-1.5 rounded-md border px-3 py-1.5 text-left text-sm transition-colors duration-fast ease-standard',
                on
                  ? 'border-primary bg-accent font-medium text-accent-foreground'
                  : 'border-border bg-card text-muted-foreground hover:border-foreground/30 hover:text-foreground',
              )}
            >
              {name}
              {hint ? <span className="text-xs opacity-70">· {hint}</span> : null}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

/**
 * Settings for one AI batch. Everything the server would refuse is caught
 * here first, so starting a batch only fails for reasons outside our control.
 */
export function AiGenerateDialog({
  open,
  onOpenChange,
  subject,
  topics,
  materials,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subject: { id: string; name: string };
  topics: Array<{ id: string; name: string }>;
  materials: GenerateMaterial[];
}) {
  const router = useRouter();
  const [materialIds, setMaterialIds] = React.useState<string[]>([]);
  const [focus, setFocus] = React.useState<Focus>('whole');
  const [query, setQuery] = React.useState('');
  const [from, setFrom] = React.useState('1');
  const [to, setTo] = React.useState('10');
  const [count, setCount] = React.useState('10');
  const [mix, setMix] = React.useState({ EASY: 30, MEDIUM: 50, HARD: 20 });
  const [types, setTypes] = React.useState<string[]>(['MCQ_SINGLE', 'TRUE_FALSE']);
  const [bloom, setBloom] = React.useState<string[]>(['REMEMBER', 'UNDERSTAND', 'APPLY']);
  const [marks, setMarks] = React.useState('1');
  const [negativeMarks, setNegativeMarks] = React.useState('0');
  const [topicId, setTopicId] = React.useState('AUTO');
  const [busy, setBusy] = React.useState(false);
  const [problem, setProblem] = React.useState<string | null>(null);

  // Fresh each time it opens, with every ready material chosen.
  React.useEffect(() => {
    if (!open) return;
    setMaterialIds(materials.map((material) => material.id));
    setProblem(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const chosen = materials.filter((material) => materialIds.includes(material.id));
  const singlePdf = chosen.length === 1 && chosen[0]!.mimeType === 'application/pdf' ? chosen[0]! : null;
  const total = mix.EASY + mix.MEDIUM + mix.HARD;

  const start = async () => {
    setProblem(null);
    const n = Number.parseInt(count, 10);
    if (chosen.length === 0) return setProblem('Choose at least one material.');
    if (!Number.isFinite(n) || n < 1 || n > 30) return setProblem('Ask for between 1 and 30 questions.');
    if (total !== 100) return setProblem(`The difficulty mix adds up to ${total}%, not 100%.`);
    if (types.length === 0) return setProblem('Choose at least one question type.');
    if (bloom.length === 0) return setProblem("Choose at least one Bloom's level.");
    if (focus === 'topic' && query.trim().length < 2) return setProblem('Say which topic or keywords to focus on.');
    if (focus === 'pages') {
      if (!singlePdf) return setProblem('Page ranges work with exactly one PDF chosen.');
      const a = Number.parseInt(from, 10);
      const b = Number.parseInt(to, 10);
      if (!(a >= 1 && b >= a)) return setProblem('Enter a page range like 3 to 9.');
      if (singlePdf.pageCount && b > singlePdf.pageCount) return setProblem(`This PDF has ${singlePdf.pageCount} pages.`);
    }

    setBusy(true);
    try {
      const { id } = await apiFetch<{ id: string }>('/api/admin/ai/jobs', {
        method: 'POST',
        body: {
          subjectId: subject.id,
          materialIds,
          params: {
            count: n,
            mix,
            types,
            bloom,
            marks: Number.parseInt(marks, 10) || 1,
            negativeMarks: Number.parseFloat(negativeMarks) || 0,
            focus:
              focus === 'topic'
                ? { mode: 'topic', query: query.trim() }
                : focus === 'pages'
                  ? { mode: 'pages', from: Number(from), to: Number(to) }
                  : { mode: 'whole' },
            topicId: topicId === 'AUTO' ? null : topicId,
          },
        },
      });
      onOpenChange(false);
      router.push(`/admin/questions/ai/${id}`);
    } catch (caught) {
      setProblem(caught instanceof ApiClientError ? caught.message : 'We could not start generating.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={busy ? undefined : onOpenChange}>
      <DialogContent hideClose={busy} className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Generate {subject.name} questions</DialogTitle>
          <DialogDescription>
            The AI writes drafts from your material. You review every one before it joins the bank.
          </DialogDescription>
        </DialogHeader>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">From</legend>
          <ul className="divide-y divide-border rounded-md border border-border">
            {materials.map((material) => {
              const id = `gen-material-${material.id}`;
              return (
                <li key={material.id} className="flex items-center gap-3 px-3">
                  <Checkbox
                    id={id}
                    checked={materialIds.includes(material.id)}
                    onCheckedChange={(on) =>
                      setMaterialIds((current) =>
                        on === true ? [...current, material.id] : current.filter((entry) => entry !== material.id),
                      )
                    }
                  />
                  <label htmlFor={id} className="flex min-h-10 flex-1 cursor-pointer items-center justify-between gap-3 text-sm">
                    <span className="truncate">{material.title}</span>
                    {material.pageCount ? (
                      <span className="tabular shrink-0 text-xs text-muted-foreground">{material.pageCount} pages</span>
                    ) : null}
                  </label>
                </li>
              );
            })}
          </ul>
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Focus</legend>
          <div className="flex flex-wrap gap-2">
            {(
              [
                ['whole', 'Whole material'],
                ['topic', 'A topic or keywords'],
                ['pages', 'Pages (one PDF)'],
              ] as const
            ).map(([key, name]) => (
              <button
                key={key}
                type="button"
                aria-pressed={focus === key}
                onClick={() => setFocus(key)}
                className={cn(
                  'inline-flex min-h-9 items-center rounded-md border px-3 py-1.5 text-sm transition-colors duration-fast',
                  focus === key
                    ? 'border-primary bg-accent font-medium text-accent-foreground'
                    : 'border-border bg-card text-muted-foreground hover:text-foreground',
                )}
              >
                {name}
              </button>
            ))}
          </div>
          {focus === 'topic' ? (
            <Input
              aria-label="Topic or keywords"
              value={query}
              maxLength={200}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="e.g. TCP congestion control, sliding window"
            />
          ) : null}
          {focus === 'pages' ? (
            singlePdf ? (
              <div className="flex items-center gap-2 text-sm">
                <Label htmlFor="gen-from">Pages</Label>
                <Input id="gen-from" type="number" min={1} value={from} onChange={(e) => setFrom(e.target.value)} className="w-20" />
                <span className="text-muted-foreground">to</span>
                <Input aria-label="Last page" type="number" min={1} value={to} onChange={(e) => setTo(e.target.value)} className="w-20" />
                {singlePdf.pageCount ? <span className="text-xs text-muted-foreground">of {singlePdf.pageCount}</span> : null}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Choose exactly one PDF above to pick pages.</p>
            )
          ) : null}
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-[8rem_minmax(0,1fr)]">
          <div className="space-y-2">
            <Label htmlFor="gen-count">How many</Label>
            <Input id="gen-count" type="number" min={1} max={30} value={count} onChange={(e) => setCount(e.target.value)} />
          </div>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">
              Difficulty mix{' '}
              <span className={cn('tabular font-normal', total === 100 ? 'text-muted-foreground' : 'text-destructive')}>
                ({total}%)
              </span>
            </legend>
            <div className="grid grid-cols-3 gap-2">
              {(['EASY', 'MEDIUM', 'HARD'] as const).map((level) => (
                <label key={level} className="flex items-center gap-2 text-sm">
                  <span className="w-14 text-muted-foreground">{level.charAt(0) + level.slice(1).toLowerCase()}</span>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    step={10}
                    value={mix[level]}
                    onChange={(e) => setMix((current) => ({ ...current, [level]: Number.parseInt(e.target.value, 10) || 0 }))}
                    aria-label={`${level.toLowerCase()} percent`}
                  />
                </label>
              ))}
            </div>
          </fieldset>
        </div>

        <ChipGroup label="Question types" options={TYPES} value={types} onChange={setTypes} />
        <ChipGroup label="Bloom's levels" options={BLOOM} value={bloom} onChange={setBloom} />

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="gen-marks">Marks each</Label>
            <Input id="gen-marks" type="number" min={1} max={20} value={marks} onChange={(e) => setMarks(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="gen-negative">Negative marks</Label>
            <Input id="gen-negative" type="number" min={0} max={10} step={0.25} value={negativeMarks} onChange={(e) => setNegativeMarks(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="gen-topic">File under topic</Label>
            <Select value={topicId} onValueChange={setTopicId}>
              <SelectTrigger id="gen-topic">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="AUTO">Let the AI choose</SelectItem>
                {topics.map((topic) => (
                  <SelectItem key={topic.id} value={topic.id}>
                    {topic.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {problem ? <InlineError message={problem} /> : null}

        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button loading={busy} onClick={() => void start()}>
            <Sparkles />
            Generate drafts
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
