'use client';

import * as React from 'react';
import { toast } from 'sonner';

import type { StudentRow } from '@/components/admin/student-management';
import { InlineError } from '@/components/shared/error-state';
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
import { cn } from '@/lib/utils';

interface StudentFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  student: StudentRow | null;
  onSaved: () => void;
}

export function StudentFormDialog({
  open,
  onOpenChange,
  student,
  onSaved,
}: StudentFormDialogProps) {
  const [name, setName] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [rollNumber, setRollNumber] = React.useState('');
  const [department, setDepartment] = React.useState('');
  const [section, setSection] = React.useState('');
  const [semester, setSemester] = React.useState('1');

  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string[]>>({});

  React.useEffect(() => {
    if (!open) return;
    setName(student?.name ?? '');
    setEmail(student?.email ?? '');
    setRollNumber(student?.rollNumber ?? '');
    setDepartment(student?.department ?? '');
    setSection(student?.section ?? '');
    setSemester(String(student?.semester ?? 1));
    setError(null);
    setFieldErrors({});
  }, [open, student]);

  const save = async () => {
    setError(null);
    setFieldErrors({});
    setSaving(true);

    const body = {
      name: name.trim(),
      email: email.trim(),
      rollNumber: rollNumber.trim().toUpperCase(),
      department: department.trim(),
      section: section.trim(),
      semester: Number.parseInt(semester, 10) || 1,
    };

    try {
      if (student) {
        await apiFetch(`/api/admin/students/${student.id}`, { method: 'PATCH', body });
        toast.success('Student details updated.');
      } else {
        await apiFetch('/api/admin/students', { method: 'POST', body });
        toast.success('Student added to the roster.');
      }
      onSaved();
      onOpenChange(false);
    } catch (caught) {
      if (caught instanceof ApiClientError) {
        setError(caught.message);
        setFieldErrors(caught.details ?? {});
      } else {
        setError('We could not save this student.');
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={saving ? undefined : onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{student ? 'Edit student' : 'Add student'}</DialogTitle>
          <DialogDescription>
            Students sign in with a one-time code sent to this email address — there is no password
            to set.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-x-4 gap-y-5 sm:grid-cols-2">
          <FormField
            className="sm:col-span-2"
            id="student-name"
            label="Full name"
            required
            error={fieldErrors.name?.[0]}
          >
            <Input
              id="student-name"
              invalid={Boolean(fieldErrors.name?.[0])}
              aria-describedby={fieldErrors.name?.[0] ? 'student-name-error' : undefined}
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoComplete="off"
            />
          </FormField>

          <FormField
            className="sm:col-span-2"
            id="student-email"
            label="College email"
            required
            error={fieldErrors.email?.[0]}
          >
            <Input
              id="student-email"
              invalid={Boolean(fieldErrors.email?.[0])}
              aria-describedby={fieldErrors.email?.[0] ? 'student-email-error' : undefined}
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="off"
            />
          </FormField>

          <FormField
            id="student-roll"
            label="Student ID"
            required
            error={fieldErrors.rollNumber?.[0]}
          >
            <Input
              id="student-roll"
              invalid={Boolean(fieldErrors.rollNumber?.[0])}
              aria-describedby={fieldErrors.rollNumber?.[0] ? 'student-roll-error' : undefined}
              value={rollNumber}
              onChange={(event) => setRollNumber(event.target.value)}
              placeholder="23CSE041"
              className="font-mono"
            />
          </FormField>

          <FormField id="student-semester" label="Semester">
            <Input
              id="student-semester"
              type="number"
              min={1}
              max={12}
              value={semester}
              onChange={(event) => setSemester(event.target.value)}
            />
          </FormField>

          <FormField
            id="student-department"
            label="Department"
            required
            error={fieldErrors.department?.[0]}
          >
            <Input
              id="student-department"
              invalid={Boolean(fieldErrors.department?.[0])}
              aria-describedby={fieldErrors.department?.[0] ? 'student-department-error' : undefined}
              value={department}
              onChange={(event) => setDepartment(event.target.value)}
              placeholder="Computer Science"
            />
          </FormField>

          <FormField id="student-section" label="Section" required error={fieldErrors.section?.[0]}>
            <Input
              id="student-section"
              invalid={Boolean(fieldErrors.section?.[0])}
              aria-describedby={fieldErrors.section?.[0] ? 'student-section-error' : undefined}
              value={section}
              onChange={(event) => setSection(event.target.value)}
              placeholder="A"
            />
          </FormField>
        </div>

        {error ? <InlineError message={error} /> : null}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void save()} loading={saving}>
            {student ? 'Save changes' : 'Add student'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FormField({
  id,
  label,
  required,
  error,
  children,
  className,
}: {
  id: string;
  label: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <Label htmlFor={id} required={required}>
        {label}
      </Label>
      {children}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
