'use client';

import { RotateCcw } from 'lucide-react';
import * as React from 'react';
import { toast } from 'sonner';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ApiClientError, apiFetch } from '@/lib/client/api';

/**
 * Offers one student another attempt at a single-attempt quiz, or takes back
 * an offer they have not used. The quiz itself is not changed: the student
 * simply gets one more start, inside the same window.
 */
export function RetakeButton({
  quizId,
  quizTitle,
  studentId,
  name,
  granted,
  sitting,
  onChanged,
}: {
  quizId: string;
  quizTitle: string;
  studentId: string;
  name: string;
  /** An extra attempt is waiting for the student to use. */
  granted: boolean;
  /** They are in the middle of an attempt right now. */
  sitting: boolean;
  onChanged: () => void;
}) {
  const [confirming, setConfirming] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const send = async (action: 'grant' | 'revoke') => {
    setBusy(true);
    try {
      await apiFetch(`/api/admin/quizzes/${quizId}/retakes`, {
        method: 'POST',
        body: { studentId, action },
      });
      toast.success(
        action === 'grant'
          ? `${name} can sit ${quizTitle} again.`
          : `${name}'s extra attempt was taken back.`,
      );
      setConfirming(false);
      onChanged();
    } catch (caught) {
      toast.error(
        caught instanceof ApiClientError ? caught.message : 'We could not change that attempt.',
      );
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  };

  if (granted) {
    return (
      <div className="flex items-center gap-1.5">
        <Badge variant="muted">Retake allowed</Badge>
        <Button
          variant="ghost"
          size="sm"
          loading={busy}
          onClick={() => void send('revoke')}
          aria-label={`Take back ${name}'s extra attempt`}
        >
          Take back
        </Button>
      </div>
    );
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        disabled={sitting}
        title={sitting ? 'They are sitting it right now' : 'Allow retake'}
        onClick={() => setConfirming(true)}
        aria-label={`Allow ${name} to retake`}
      >
        <RotateCcw />
        <span className="hidden 2xl:inline">Allow retake</span>
      </Button>

      <AlertDialog
        open={confirming}
        onOpenChange={(open) => {
          if (!open && !busy) setConfirming(false);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="break-words">
              Let {name} sit {quizTitle} again?
            </AlertDialogTitle>
            <AlertDialogDescription>
              They get one more attempt, which they can start right away from their dashboard, inside
              the quiz window. Their first result stays on record, and class averages count their
              best attempt. This is refused once the window has closed or answers are released.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(event) => {
                event.preventDefault();
                void send('grant');
              }}
            >
              Allow retake
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
