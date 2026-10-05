'use client';

import { Check, Plus, Trash2 } from 'lucide-react';
import * as React from 'react';
import { toast } from 'sonner';

import { ImageUploadField } from '@/components/admin/image-upload-field';
import { MathText } from '@/components/shared/math-text';
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
import { Input, Textarea } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ApiClientError, apiFetch } from '@/lib/client/api';
import { sendUnlessRepeat } from '@/lib/client/confirm-similar';
import { hasMath } from '@/lib/math';
import {
  BLOOM_LABEL,
  BLOOM_ORDER,
  type BloomValue,
  QUESTION_TYPE_HINT,
  QUESTION_TYPE_LABEL,
  QUESTION_TYPE_ORDER,
  isManuallyMarked,
  isOptionBased,
  type QuestionTypeValue,
} from '@/lib/question-types';
import { ASSERTION_REASON_OPTIONS, TRUE_FALSE_OPTIONS } from '@/lib/grading';
import { cn } from '@/lib/utils';

export interface QuestionRecord {
  id: string;
  text: string;
  type: QuestionTypeValue;
  difficulty: 'EASY' | 'MEDIUM' | 'HARD';
  bloom?: BloomValue | null;
  marks: number;
  negativeMarks: number;
  explanation: string | null;
  subjectId: string;
  topicId: string | null;
  imageAssetId?: string | null;
  assertionText?: string | null;
  reasonText?: string | null;
  partialCredit?: boolean;
  acceptedAnswers?: string[];
  caseSensitive?: boolean;
  numericTolerance?: number | null;
  maxWords?: number | null;
  maxAttachments?: number;
  modelAnswer?: string | null;
  options: Array<{
    id: string;
    text: string;
    isCorrect: boolean;
    imageAssetId?: string | null;
  }>;
}

interface Subject {
  id: string;
  name: string;
  topics: Array<{ id: string; name: string }>;
}

interface QuestionEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  question: QuestionRecord | null;
  subjects: Subject[];
  onSaved: () => void;
  /**
   * Replaces the save: the editor validates and builds the body, the caller
   * decides where it goes (e.g. accepting an AI draft). Throw to show an error.
   */
  onSubmit?: (body: Record<string, unknown>) => Promise<void>;
  /** Overrides the dialog title. */
  title?: string;
  /** Overrides the save button's label. */
  submitLabel?: string;
}

interface DraftOption {
  text: string;
  isCorrect: boolean;
  imageAssetId: string | null;
}

const blankOptions = (): DraftOption[] => [
  { text: '', isCorrect: true, imageAssetId: null },
  { text: '', isCorrect: false, imageAssetId: null },
  { text: '', isCorrect: false, imageAssetId: null },
  { text: '', isCorrect: false, imageAssetId: null },
];

const fixedOptions = (texts: readonly string[]): DraftOption[] =>
  texts.map((text, index) => ({ text, isCorrect: index === 0, imageAssetId: null }));

/** Types whose option list is prescribed and must not be edited freely. */
function optionsForType(type: QuestionTypeValue): DraftOption[] {
  if (type === 'TRUE_FALSE') return fixedOptions(TRUE_FALSE_OPTIONS);
  if (type === 'ASSERTION_REASON') return fixedOptions(ASSERTION_REASON_OPTIONS);
  if (isOptionBased(type)) return blankOptions();
  return [];
}

export function QuestionEditor({
  open,
  onOpenChange,
  question,
  subjects,
  onSaved,
  onSubmit,
  title,
  submitLabel,
}: QuestionEditorProps) {
  const [text, setText] = React.useState('');
  const [type, setType] = React.useState<QuestionTypeValue>('MCQ_SINGLE');
  const [difficulty, setDifficulty] = React.useState<'EASY' | 'MEDIUM' | 'HARD'>('MEDIUM');
  const [bloom, setBloom] = React.useState<BloomValue | 'NONE'>('NONE');
  const [marks, setMarks] = React.useState('1');
  const [negativeMarks, setNegativeMarks] = React.useState('0');
  const [explanation, setExplanation] = React.useState('');
  const [subjectId, setSubjectId] = React.useState('');
  const [topicId, setTopicId] = React.useState('');
  const [options, setOptions] = React.useState<DraftOption[]>(blankOptions);
  const [imageAssetId, setImageAssetId] = React.useState<string | null>(null);

  const [assertionText, setAssertionText] = React.useState('');
  const [reasonText, setReasonText] = React.useState('');
  const [partialCredit, setPartialCredit] = React.useState(true);
  const [acceptedAnswers, setAcceptedAnswers] = React.useState<string[]>(['']);
  const [caseSensitive, setCaseSensitive] = React.useState(false);
  const [numericTolerance, setNumericTolerance] = React.useState('');
  const [maxWords, setMaxWords] = React.useState('');
  const [maxAttachments, setMaxAttachments] = React.useState('3');
  const [modelAnswer, setModelAnswer] = React.useState('');

  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Reset the draft whenever the dialog opens, so an edit never leaks into a
  // subsequent "add new".
  React.useEffect(() => {
    if (!open) return;

    if (question) {
      setText(question.text);
      setType(question.type);
      setDifficulty(question.difficulty);
      setBloom(question.bloom ?? 'NONE');
      setMarks(String(question.marks));
      setNegativeMarks(String(question.negativeMarks));
      setExplanation(question.explanation ?? '');
      setSubjectId(question.subjectId);
      setTopicId(question.topicId ?? '');
      setImageAssetId(question.imageAssetId ?? null);
      setOptions(
        question.options.length > 0
          ? question.options.map((o) => ({
              text: o.text,
              isCorrect: o.isCorrect,
              imageAssetId: o.imageAssetId ?? null,
            }))
          : optionsForType(question.type),
      );
      setAssertionText(question.assertionText ?? '');
      setReasonText(question.reasonText ?? '');
      setPartialCredit(question.partialCredit ?? true);
      setAcceptedAnswers(
        question.acceptedAnswers && question.acceptedAnswers.length > 0
          ? question.acceptedAnswers
          : [''],
      );
      setCaseSensitive(question.caseSensitive ?? false);
      setNumericTolerance(
        question.numericTolerance === null || question.numericTolerance === undefined
          ? ''
          : String(question.numericTolerance),
      );
      setMaxWords(question.maxWords ? String(question.maxWords) : '');
      setMaxAttachments(String(question.maxAttachments ?? 3));
      setModelAnswer(question.modelAnswer ?? '');
    } else {
      setText('');
      setType('MCQ_SINGLE');
      setDifficulty('MEDIUM');
      setBloom('NONE');
      setMarks('1');
      setNegativeMarks('0');
      setExplanation('');
      setSubjectId(subjects[0]?.id ?? '');
      setTopicId('');
      setImageAssetId(null);
      setOptions(blankOptions());
      setAssertionText('');
      setReasonText('');
      setPartialCredit(true);
      setAcceptedAnswers(['']);
      setCaseSensitive(false);
      setNumericTolerance('');
      setMaxWords('');
      setMaxAttachments('3');
      setModelAnswer('');
    }
    setError(null);
  }, [open, question, subjects]);

  const subject = subjects.find((entry) => entry.id === subjectId);
  const optionBased = isOptionBased(type);
  const manual = isManuallyMarked(type);
  const fixedOptionSet = type === 'TRUE_FALSE' || type === 'ASSERTION_REASON';
  const multi = type === 'MCQ_MULTI';

  const changeType = (next: QuestionTypeValue) => {
    setType(next);
    setOptions(optionsForType(next));
  };

  const setSingleCorrect = (index: number) =>
    setOptions((current) => current.map((option, i) => ({ ...option, isCorrect: i === index })));

  const toggleCorrect = (index: number) =>
    setOptions((current) =>
      current.map((option, i) => (i === index ? { ...option, isCorrect: !option.isCorrect } : option)),
    );

  const updateOption = (index: number, patch: Partial<DraftOption>) =>
    setOptions((current) => current.map((option, i) => (i === index ? { ...option, ...patch } : option)));

  const save = async () => {
    setError(null);

    if (text.trim().length < 5) {
      setError('Enter the question text.');
      return;
    }
    if (!subjectId) {
      setError('Select a subject.');
      return;
    }

    const filled = optionBased
      ? options.filter((option) => option.text.trim().length > 0 || option.imageAssetId)
      : [];

    if (optionBased) {
      if (filled.length < 2) {
        setError('Provide at least two answer options.');
        return;
      }
      const correctCount = filled.filter((option) => option.isCorrect).length;
      if (multi && correctCount < 2) {
        setError('Mark at least two options correct, or use single-choice instead.');
        return;
      }
      if (!multi && correctCount !== 1) {
        setError('Mark exactly one option as the correct answer.');
        return;
      }
    }

    if (type === 'ASSERTION_REASON' && (!assertionText.trim() || !reasonText.trim())) {
      setError('Enter both the assertion and the reason.');
      return;
    }

    const answers = acceptedAnswers.map((value) => value.trim()).filter(Boolean);
    if (type === 'SHORT_ANSWER' && answers.length === 0) {
      setError('List at least one accepted answer so this can be marked automatically.');
      return;
    }

    setSaving(true);
    try {
      const body = {
        text: text.trim(),
        type,
        difficulty,
        bloom: bloom === 'NONE' ? null : bloom,
        marks: Number.parseInt(marks, 10) || 1,
        negativeMarks: Number.parseFloat(negativeMarks) || 0,
        explanation: explanation.trim(),
        subjectId,
        topicId: topicId || '',
        imageAssetId,
        assertionText: assertionText.trim(),
        reasonText: reasonText.trim(),
        partialCredit,
        acceptedAnswers: answers,
        caseSensitive,
        numericTolerance: numericTolerance.trim() ? Number.parseFloat(numericTolerance) : null,
        maxWords: maxWords.trim() ? Number.parseInt(maxWords, 10) : null,
        maxAttachments: Number.parseInt(maxAttachments, 10) || 3,
        modelAnswer: modelAnswer.trim(),
        options: filled.map((option) => ({
          text: option.text.trim(),
          isCorrect: option.isCorrect,
          imageAssetId: option.imageAssetId,
        })),
      };

      if (onSubmit) {
        await onSubmit(body);
      } else {
        const saved = await sendUnlessRepeat((allowSimilar) =>
          question
            ? apiFetch(`/api/admin/questions/${question.id}`, { method: 'PATCH', body: { ...body, allowSimilar } })
            : apiFetch('/api/admin/questions', { method: 'POST', body: { ...body, allowSimilar } }),
        );
        if (!saved) return; // the teacher chose not to add a repeat
        toast.success(question ? 'Question updated.' : 'Question added to the bank.');
      }

      onSaved();
      onOpenChange(false);
    } catch (caught) {
      setError(
        caught instanceof ApiClientError ? caught.message : 'We could not save this question.',
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={saving ? undefined : onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>{title ?? (question ? 'Edit question' : 'Add question')}</DialogTitle>
          <DialogDescription>
            The correct answer is stored server-side and is never sent to a student&apos;s browser.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-7">
          <EditorSection title="Question">
            <div className="space-y-2">
              <Label htmlFor="question-type">Type</Label>
              <Select value={type} onValueChange={(value) => changeType(value as QuestionTypeValue)}>
                <SelectTrigger id="question-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {QUESTION_TYPE_ORDER.map((value) => (
                    <SelectItem key={value} value={value}>
                      {QUESTION_TYPE_LABEL[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{QUESTION_TYPE_HINT[type]}</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="question-text" required>
                Question text
              </Label>
              <Textarea
                id="question-text"
                value={text}
                onChange={(event) => setText(event.target.value)}
                rows={3}
                placeholder="Which protocol is responsible for reliable, ordered delivery of a byte stream?"
              />
              <MathHint value={text} />
            </div>

            <div className="space-y-2">
              <Label>Question image</Label>
              <ImageUploadField
                assetId={imageAssetId}
                onChange={setImageAssetId}
                kind="QUESTION_IMAGE"
                label="Add a diagram"
              />
              <p className="text-xs text-muted-foreground">
                Optional. Shown above the answer area, and only to students served this question.
              </p>
            </div>
          </EditorSection>

          <EditorSection title="Answer">
            {type === 'ASSERTION_REASON' ? (
              <>
                <div className="space-y-2">
                  <Label htmlFor="assertion-text" required>
                    Assertion (A)
                  </Label>
                  <Textarea
                    id="assertion-text"
                    value={assertionText}
                    onChange={(event) => setAssertionText(event.target.value)}
                    rows={2}
                    placeholder="Water boils at a lower temperature at higher altitudes."
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="reason-text" required>
                    Reason (R)
                  </Label>
                  <Textarea
                    id="reason-text"
                    value={reasonText}
                    onChange={(event) => setReasonText(event.target.value)}
                    rows={2}
                    placeholder="Atmospheric pressure decreases with altitude."
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  The five standard options are added for you and cannot be edited, so every
                  assertion–reason question is answered the same way.
                </p>
              </>
            ) : null}

            {optionBased ? (
              <fieldset className="min-w-0">
                <legend className="text-sm font-medium">
                  Answer options
                  <span className="ml-1.5 font-normal text-muted-foreground">
                    {multi ? '— tick every correct option' : '— select the correct one'}
                  </span>
                </legend>

                <OptionList
                  options={options}
                  multi={multi}
                  readOnlyText={fixedOptionSet}
                  allowImages={!fixedOptionSet}
                  onToggleCorrect={multi ? toggleCorrect : setSingleCorrect}
                  onUpdate={updateOption}
                  onRemove={
                    fixedOptionSet || options.length <= 2
                      ? undefined
                      : (index) =>
                          setOptions((current) => {
                            const next = current.filter((_, i) => i !== index);
                            // Never leave the question without a correct answer.
                            if (!next.some((entry) => entry.isCorrect) && next[0]) {
                              next[0] = { ...next[0], isCorrect: true };
                            }
                            return next;
                          })
                  }
                />

                {!fixedOptionSet && options.length < 6 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="mt-2 text-primary"
                    onClick={() =>
                      setOptions((current) => [
                        ...current,
                        { text: '', isCorrect: false, imageAssetId: null },
                      ])
                    }
                  >
                    <Plus />
                    Add option
                  </Button>
                ) : null}

                {multi ? (
                  <div className="mt-4 flex items-start gap-3">
                    <Checkbox
                      id="partial-credit"
                      checked={partialCredit}
                      onCheckedChange={(value) => setPartialCredit(value === true)}
                      aria-describedby="partial-credit-hint"
                      className="mt-0.5"
                    />
                    <div className="min-w-0">
                      <Label htmlFor="partial-credit" className="cursor-pointer leading-snug">
                        Award partial credit
                      </Label>
                      <p id="partial-credit-hint" className="mt-1 text-xs text-muted-foreground">
                        A student who selects some correct options and no incorrect ones scores
                        proportionally. Selecting any incorrect option always scores the negative
                        mark.
                      </p>
                    </div>
                  </div>
                ) : null}
              </fieldset>
            ) : null}

            {type === 'SHORT_ANSWER' ? (
              <fieldset className="min-w-0">
                <legend className="text-sm font-medium">Accepted answers</legend>
                <p className="mt-1 text-xs text-muted-foreground">
                  Any one of these scores full marks. Leading and trailing spaces are ignored and
                  repeated spaces collapsed.
                </p>

                <div className="mt-3 space-y-2">
                  {acceptedAnswers.map((answer, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <Input
                        value={answer}
                        onChange={(event) =>
                          setAcceptedAnswers((current) =>
                            current.map((entry, i) => (i === index ? event.target.value : entry)),
                          )
                        }
                        placeholder={index === 0 ? 'Transmission Control Protocol' : 'Another accepted spelling'}
                        aria-label={`Accepted answer ${index + 1}`}
                      />
                      {acceptedAnswers.length > 1 ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="shrink-0 text-muted-foreground hover:text-destructive"
                          aria-label={`Remove accepted answer ${index + 1}`}
                          onClick={() =>
                            setAcceptedAnswers((current) => current.filter((_, i) => i !== index))
                          }
                        >
                          <Trash2 />
                        </Button>
                      ) : null}
                    </div>
                  ))}
                </div>

                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="mt-2 text-primary"
                  onClick={() => setAcceptedAnswers((current) => [...current, ''])}
                >
                  <Plus />
                  Add accepted answer
                </Button>

                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <div className="flex items-start gap-3">
                    <Checkbox
                      id="case-sensitive"
                      checked={caseSensitive}
                      onCheckedChange={(value) => setCaseSensitive(value === true)}
                      aria-describedby="case-sensitive-hint"
                      className="mt-0.5"
                    />
                    <div className="min-w-0">
                      <Label htmlFor="case-sensitive" className="cursor-pointer leading-snug">
                        Case sensitive
                      </Label>
                      <p id="case-sensitive-hint" className="mt-1 text-xs text-muted-foreground">
                        Off by default, so &quot;tcp&quot; matches &quot;TCP&quot;.
                      </p>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="numeric-tolerance">Numeric tolerance</Label>
                    <Input
                      id="numeric-tolerance"
                      type="number"
                      min={0}
                      step="any"
                      value={numericTolerance}
                      onChange={(event) => setNumericTolerance(event.target.value)}
                      placeholder="Exact match"
                    />
                    <p className="text-xs text-muted-foreground">
                      Set for numeric answers — 0.01 accepts anything within ±0.01.
                    </p>
                  </div>
                </div>
              </fieldset>
            ) : null}

            {manual ? (
              <div className="space-y-2">
                <Label htmlFor="model-answer">Model answer / rubric</Label>
                <Textarea
                  id="model-answer"
                  value={modelAnswer}
                  onChange={(event) => setModelAnswer(event.target.value)}
                  rows={3}
                  placeholder="What a full-mark answer must cover."
                />
                <p className="text-xs text-muted-foreground">
                  Shown to whoever marks this answer. Never sent to students, even when answers are
                  released.
                </p>
              </div>
            ) : null}
          </EditorSection>

          <EditorSection title="Placement and marks">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="question-subject" required>
                  Subject
                </Label>
                <Select
                  value={subjectId}
                  onValueChange={(value) => {
                    setSubjectId(value);
                    setTopicId('');
                  }}
                >
                  <SelectTrigger id="question-subject">
                    <SelectValue placeholder="Select subject" />
                  </SelectTrigger>
                  <SelectContent>
                    {subjects.map((entry) => (
                      <SelectItem key={entry.id} value={entry.id}>
                        {entry.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="question-topic">Topic</Label>
                <Select
                  value={topicId || 'none'}
                  onValueChange={(value) => setTopicId(value === 'none' ? '' : value)}
                >
                  <SelectTrigger id="question-topic">
                    <SelectValue placeholder="No topic" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No topic</SelectItem>
                    {(subject?.topics ?? []).map((topic) => (
                      <SelectItem key={topic.id} value={topic.id}>
                        {topic.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="question-difficulty">Difficulty</Label>
                <Select
                  value={difficulty}
                  onValueChange={(value) => setDifficulty(value as typeof difficulty)}
                >
                  <SelectTrigger id="question-difficulty">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="EASY">Easy</SelectItem>
                    <SelectItem value="MEDIUM">Medium</SelectItem>
                    <SelectItem value="HARD">Hard</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="question-bloom">Thinking level</Label>
                <Select value={bloom} onValueChange={(value) => setBloom(value as BloomValue | 'NONE')}>
                  <SelectTrigger id="question-bloom">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NONE">Not set</SelectItem>
                    {BLOOM_ORDER.map((level) => (
                      <SelectItem key={level} value={level}>
                        {BLOOM_LABEL[level]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="question-marks">Marks</Label>
                <Input
                  id="question-marks"
                  type="number"
                  min={1}
                  max={20}
                  value={marks}
                  onChange={(event) => setMarks(event.target.value)}
                  className="tabular"
                />
              </div>

              {manual ? null : (
                <div className="space-y-2">
                  <Label htmlFor="question-negative">Negative marks</Label>
                  <Input
                    id="question-negative"
                    type="number"
                    min={0}
                    max={10}
                    step={0.25}
                    value={negativeMarks}
                    onChange={(event) => setNegativeMarks(event.target.value)}
                    className="tabular"
                  />
                </div>
              )}

              {type === 'IMAGE_ANSWER' ? (
                <div className="space-y-2">
                  <Label htmlFor="max-attachments">Maximum images</Label>
                  <Input
                    id="max-attachments"
                    type="number"
                    min={1}
                    max={10}
                    value={maxAttachments}
                    onChange={(event) => setMaxAttachments(event.target.value)}
                    className="tabular"
                  />
                </div>
              ) : null}

              {type === 'LONG_ANSWER' ? (
                <div className="space-y-2">
                  <Label htmlFor="max-words">Suggested word limit</Label>
                  <Input
                    id="max-words"
                    type="number"
                    min={10}
                    max={5000}
                    value={maxWords}
                    onChange={(event) => setMaxWords(event.target.value)}
                    placeholder="No limit"
                    className="tabular"
                  />
                </div>
              ) : null}
            </div>
          </EditorSection>

          <EditorSection title="Feedback">
            <div className="space-y-2">
              <Label htmlFor="question-explanation">Explanation</Label>
              <Textarea
                id="question-explanation"
                value={explanation}
                onChange={(event) => setExplanation(event.target.value)}
                rows={2}
                placeholder="Shown to students only if you release answers for a quiz."
              />
            </div>
          </EditorSection>

          {error ? <InlineError message={error} /> : null}
        </div>

        {/* Pinned to the bottom of the scrolling dialog so Save is always in reach. */}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void save()} loading={saving}>
            {submitLabel ?? (question ? 'Save changes' : 'Add question')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** A titled group inside the editor, separated from the next by a border. */
function EditorSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4 border-t border-border pt-6 first:border-t-0 first:pt-0">
      <h3 className="type-eyebrow">{title}</h3>
      {children}
    </section>
  );
}

/** Live preview, shown only once the author has actually written an expression. */
function MathHint({ value }: { value: string }) {
  const showsMath = React.useMemo(() => hasMath(value), [value]);

  if (!showsMath) {
    return (
      <p className="text-xs text-muted-foreground">
        Wrap mathematics in <code className="rounded-sm bg-muted px-1 font-mono">$…$</code> for
        inline, or <code className="rounded-sm bg-muted px-1 font-mono">$$…$$</code> to centre it
        on its own line.
      </p>
    );
  }

  return (
    <div className="rounded-md border border-border bg-muted/40 p-3">
      <p className="type-eyebrow">Preview</p>
      <MathText text={value} className="mt-1.5 block break-words text-sm leading-relaxed" />
    </div>
  );
}

function OptionList({
  options,
  multi,
  readOnlyText,
  allowImages,
  onToggleCorrect,
  onUpdate,
  onRemove,
}: {
  options: DraftOption[];
  multi: boolean;
  readOnlyText: boolean;
  allowImages: boolean;
  onToggleCorrect: (index: number) => void;
  onUpdate: (index: number, patch: Partial<DraftOption>) => void;
  onRemove?: (index: number) => void;
}) {
  const rows = options.map((option, index) => (
    <div
      key={index}
      className={cn(
        'rounded-md px-2 py-2 transition-colors duration-fast ease-standard',
        option.isCorrect && 'bg-success-subtle/60',
      )}
    >
      <div className="flex items-center gap-3">
        <span className="flex size-6 shrink-0 items-center justify-center">
          {multi ? (
            <Checkbox
              checked={option.isCorrect}
              onCheckedChange={() => onToggleCorrect(index)}
              aria-label={`Mark option ${index + 1} as correct`}
            />
          ) : (
            <RadioGroupItem
              value={String(index)}
              id={`option-correct-${index}`}
              aria-label={`Mark option ${index + 1} as correct`}
            />
          )}
        </span>
        <Input
          value={option.text}
          readOnly={readOnlyText}
          onChange={(event) => onUpdate(index, { text: event.target.value })}
          placeholder={`Option ${String.fromCharCode(65 + index)}`}
          aria-label={`Option ${index + 1} text`}
          className={cn('min-w-0 flex-1', readOnlyText && 'bg-muted/60')}
        />
        {option.isCorrect ? (
          <span className="hidden shrink-0 items-center gap-1 text-xs font-medium text-success sm:inline-flex">
            <Check className="size-3.5" aria-hidden />
            Correct
          </span>
        ) : null}
        {onRemove ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="shrink-0 text-muted-foreground hover:text-destructive"
            aria-label={`Remove option ${index + 1}`}
            onClick={() => onRemove(index)}
          >
            <Trash2 />
          </Button>
        ) : null}
      </div>

      {allowImages ? (
        <ImageUploadField
          className="mt-2 pl-9"
          assetId={option.imageAssetId}
          onChange={(assetId) => onUpdate(index, { imageAssetId: assetId })}
          kind="OPTION_IMAGE"
          label="Add image"
          compact
        />
      ) : null}
    </div>
  ));

  // Radio semantics need a group; checkboxes are independent controls.
  if (multi) return <div className="mt-3 flex flex-col gap-1.5">{rows}</div>;

  return (
    <RadioGroup
      value={String(options.findIndex((option) => option.isCorrect))}
      onValueChange={(value) => onToggleCorrect(Number(value))}
      className="mt-3 gap-1.5"
    >
      {rows}
    </RadioGroup>
  );
}
