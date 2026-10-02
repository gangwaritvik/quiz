'use client';

import * as React from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ApiClientError, apiFetch } from '@/lib/client/api';

const MAX_LENGTH = 500;

export interface BroadcastQuiz {
  id: string;
  title: string;
  /** Students sitting it right now. */
  active: number;
}

/**
 * Sends one short notice to everyone currently sitting a quiz. It reaches
 * students with their next heartbeat (about 20 seconds), as a quiet banner
 * they can dismiss; it never interrupts what they are typing.
 */
export function BroadcastDialog({
  open,
  onOpenChange,
  quizzes,
  defaultQuizId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  quizzes: BroadcastQuiz[];
  /** Pre-selected quiz, usually the live board's current filter. */
  defaultQuizId?: string;
}) {
  const sitting = quizzes.filter((quiz) => quiz.active > 0);
  const [quizId, setQuizId] = React.useState('');
  const [message, setMessage] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    const preferred = sitting.find((quiz) => quiz.id === defaultQuizId) ?? sitting[0];
    setQuizId(preferred?.id ?? '');
    setMessage('');
    // Re-seeded on each opening only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const target = sitting.find((quiz) => quiz.id === quizId);
  const trimmed = message.trim();

  const send = async () => {
    if (!target || trimmed.length === 0) return;
    setBusy(true);
    try {
      const result = await apiFetch<{ sitting: number }>(`/api/admin/quizzes/${target.id}/notices`, {
        method: 'POST',
        body: { message: trimmed },
      });
      toast.success(
        `Sent to ${result.sitting} ${result.sitting === 1 ? 'student' : 'students'} sitting ${target.title}.`,
      );
      onOpenChange(false);
    } catch (caught) {
      toast.error(
        caught instanceof ApiClientError ? caught.message : 'We could not send that message.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={busy ? undefined : onOpenChange}>
      <DialogContent hideClose={busy} className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Message students</DialogTitle>
          <DialogDescription>
            Shown to everyone sitting the quiz as a banner they can dismiss. It arrives within
            about 20 seconds, and there is no read receipt.
          </DialogDescription>
        </DialogHeader>

        {sitting.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nobody is sitting a quiz right now, so there is no one to message.
          </p>
        ) : (
          <div className="space-y-4">
            {sitting.length > 1 ? (
              <div className="space-y-2">
                <Label htmlFor="broadcast-quiz">Quiz</Label>
                <Select value={quizId} onValueChange={setQuizId}>
                  <SelectTrigger id="broadcast-quiz" aria-label="Quiz to message">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {sitting.map((quiz) => (
                      <SelectItem key={quiz.id} value={quiz.id}>
                        {quiz.title} ({quiz.active} sitting)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : target ? (
              <p className="text-sm">
                To <span className="font-medium">{target.title}</span>, {target.active}{' '}
                {target.active === 1 ? 'student' : 'students'} sitting.
              </p>
            ) : null}

            <div className="space-y-2">
              <Label htmlFor="broadcast-message">Message</Label>
              <Textarea
                id="broadcast-message"
                value={message}
                maxLength={MAX_LENGTH}
                rows={4}
                placeholder="For example: Question 4 should read “…”. Carry on as before."
                onChange={(event) => setMessage(event.target.value)}
              />
              <p className="tabular text-right text-xs text-muted-foreground">
                {message.length} / {MAX_LENGTH}
              </p>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            loading={busy}
            disabled={!target || trimmed.length === 0}
            onClick={() => void send()}
          >
            Send to {target ? target.active : 0}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
