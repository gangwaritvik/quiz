'use client';

import { Users } from 'lucide-react';
import * as React from 'react';
import { toast } from 'sonner';

import { InlineError } from '@/components/shared/error-state';
import { Badge } from '@/components/ui/badge';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiClientError, apiFetch } from '@/lib/client/api';
import { cn } from '@/lib/utils';

interface RosterStudent {
  id: string;
  name: string;
  rollNumber: string;
  department: string;
  section: string;
  status: string;
}

interface RosterPage {
  pageCount: number;
  students: RosterStudent[];
}

const sectionKey = (student: RosterStudent) => `${student.department} · ${student.section}`;

/** The directory caps a page at 100, so a large roster is read page by page. */
async function loadRoster(): Promise<RosterStudent[]> {
  const students: RosterStudent[] = [];
  for (let page = 1; ; page += 1) {
    const result = await apiFetch<RosterPage>(`/api/admin/students?pageSize=100&page=${page}`);
    students.push(...result.students);
    if (page >= result.pageCount) return students;
  }
}

/**
 * Changes who a quiz is assigned to: tick students one by one, or add a whole
 * section at once. Students who have already attempted the quiz stay assigned
 * (their results depend on it), and are marked as such.
 */
export function AssignStudentsDialog({
  open,
  onOpenChange,
  quizId,
  assignedIds,
  startedIds,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  quizId: string;
  /** Student ids assigned right now. */
  assignedIds: string[];
  /** Student ids with an attempt, which cannot be removed. */
  startedIds: string[];
  onSaved: () => void;
}) {
  const [roster, setRoster] = React.useState<RosterStudent[] | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [section, setSection] = React.useState('ALL');
  const [query, setQuery] = React.useState('');
  const [saving, setSaving] = React.useState(false);

  const started = React.useMemo(() => new Set(startedIds), [startedIds]);

  // Fresh roster and selection each time the dialog opens.
  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setSelected(new Set(assignedIds));
    setSection('ALL');
    setQuery('');
    setRoster(null);
    setLoadError(null);
    loadRoster().then(
      (students) => !cancelled && setRoster(students),
      (caught) =>
        !cancelled &&
        setLoadError(caught instanceof ApiClientError ? caught.message : 'We could not load students.'),
    );
    return () => {
      cancelled = true;
    };
    // `assignedIds` is read once per opening on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const sections = React.useMemo(
    () => [...new Set((roster ?? []).map(sectionKey))].sort(),
    [roster],
  );

  const needle = query.trim().toLowerCase();
  const visible = (roster ?? []).filter(
    (student) =>
      (section === 'ALL' || sectionKey(student) === section) &&
      (needle === '' ||
        student.name.toLowerCase().includes(needle) ||
        student.rollNumber.toLowerCase().includes(needle)),
  );
  const selectable = visible.filter((student) => student.status === 'ACTIVE');
  const allVisibleSelected =
    selectable.length > 0 && selectable.every((student) => selected.has(student.id));

  const toggle = (id: string, on: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const toggleVisible = () =>
    setSelected((current) => {
      const next = new Set(current);
      for (const student of selectable) {
        if (allVisibleSelected) {
          // Students who already attempted stay put.
          if (!started.has(student.id)) next.delete(student.id);
        } else {
          next.add(student.id);
        }
      }
      return next;
    });

  const added = [...selected].filter((id) => !assignedIds.includes(id)).length;
  const removed = assignedIds.filter((id) => !selected.has(id)).length;

  const save = async () => {
    setSaving(true);
    try {
      await apiFetch(`/api/admin/quizzes/${quizId}/assign`, {
        method: 'POST',
        body: { studentIds: [...selected] },
      });
      toast.success('Assigned students updated.');
      onSaved();
      onOpenChange(false);
    } catch (caught) {
      toast.error(
        caught instanceof ApiClientError ? caught.message : 'We could not save the assignment.',
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={saving ? undefined : onOpenChange}>
      <DialogContent hideClose={saving} className="max-h-[90dvh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Assigned students</DialogTitle>
          <DialogDescription>
            Tick the students who can see this quiz. Use a section to add everyone in it at once.
          </DialogDescription>
        </DialogHeader>

        {loadError ? (
          <InlineError message={loadError} />
        ) : roster === null ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full rounded-md" />
            <Skeleton className="h-64 w-full rounded-lg" />
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="w-full sm:w-56">
                <Select value={section} onValueChange={setSection}>
                  <SelectTrigger aria-label="Filter by section">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">All sections</SelectItem>
                    {sections.map((entry) => (
                      <SelectItem key={entry} value={entry}>
                        {entry}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search name or roll number"
                aria-label="Search students"
                className="sm:flex-1"
              />
            </div>

            <div className="flex items-center justify-between gap-3">
              <Badge variant={selected.size > 0 ? 'default' : 'muted'}>
                <Users aria-hidden />
                <span className="tabular">{selected.size}</span> assigned
              </Badge>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-primary"
                disabled={selectable.length === 0}
                onClick={toggleVisible}
              >
                {allVisibleSelected
                  ? section === 'ALL' && needle === ''
                    ? 'Clear all'
                    : 'Clear shown'
                  : section === 'ALL' && needle === ''
                    ? 'Select all'
                    : section === 'ALL'
                      ? 'Select shown'
                      : `Add all in ${section}`}
              </Button>
            </div>

            <ul className="scrollbar-slim max-h-[22rem] divide-y divide-border overflow-y-auto rounded-lg border border-border bg-card">
              {visible.length === 0 ? (
                <li className="px-4 py-8 text-center text-sm text-muted-foreground">
                  No students match.
                </li>
              ) : (
                visible.map((student) => {
                  const inactive = student.status !== 'ACTIVE';
                  const locked = started.has(student.id);
                  const id = `assign-dialog-${student.id}`;
                  return (
                    <li
                      key={student.id}
                      className={cn(
                        'flex items-center gap-3 px-3 transition-colors duration-fast hover:bg-accent/50',
                        inactive && 'opacity-60',
                      )}
                    >
                      <Checkbox
                        id={id}
                        checked={selected.has(student.id)}
                        disabled={inactive || locked}
                        onCheckedChange={(value) => toggle(student.id, value === true)}
                      />
                      <label
                        htmlFor={id}
                        className={cn(
                          'flex min-h-11 min-w-0 flex-1 items-center justify-between gap-3 py-2',
                          inactive || locked ? 'cursor-not-allowed' : 'cursor-pointer',
                        )}
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm text-foreground">
                            {student.name}
                          </span>
                          <span className="block truncate font-mono text-2xs text-muted-foreground">
                            {student.rollNumber} · {student.section}
                          </span>
                        </span>
                        {locked ? (
                          <Badge variant="muted" className="shrink-0">
                            Attempted, kept
                          </Badge>
                        ) : inactive ? (
                          <Badge variant="muted" className="shrink-0">
                            Inactive
                          </Badge>
                        ) : null}
                      </label>
                    </li>
                  );
                })
              )}
            </ul>
          </>
        )}

        <DialogFooter>
          <p className="mr-auto self-center text-sm text-muted-foreground" aria-live="polite">
            {added === 0 && removed === 0
              ? 'No changes yet.'
              : `${added} to add, ${removed} to remove.`}
          </p>
          <Button variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            loading={saving}
            disabled={roster === null || (added === 0 && removed === 0)}
            onClick={() => void save()}
          >
            Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
