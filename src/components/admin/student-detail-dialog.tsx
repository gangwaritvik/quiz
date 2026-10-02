'use client';

import { Ban, CheckCircle2, ChevronRight, Clock3, Laptop } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';

import { ErrorState } from '@/components/shared/error-state';
import { IntegrityBadge, type IntegrityStatus } from '@/components/shared/integrity-badge';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useApi } from '@/hooks/use-api';
import { formatDateTime } from '@/lib/utils';

interface StudentDetail {
  student: {
    id: string;
    name: string;
    email: string;
    rollNumber: string;
    department: string;
    section: string;
    semester: number;
    status: string;
    lastLoginAt: string | null;
  };
  attempts: Array<{
    id: string;
    quizTitle: string;
    status: string;
    score: number | null;
    maxScore: number | null;
    percentage: number | null;
    startedAt: string;
    submittedAt: string | null;
    integrityScore: number | null;
    integrityStatus: IntegrityStatus | null;
  }>;
  devices: Array<{
    id: string;
    label: string;
    trusted: boolean;
    lastSeenAt: string;
    active: boolean;
  }>;
}

export function StudentDetailDialog({
  studentId,
  onOpenChange,
}: {
  studentId: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { data, error, initialLoading, refetch } = useApi<StudentDetail>(
    studentId ? `/api/admin/students/${studentId}` : null,
    { enabled: Boolean(studentId) },
  );

  return (
    <Dialog open={studentId !== null} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[90dvh] max-w-3xl overflow-y-auto"
        aria-label={data ? undefined : 'Student details'}
      >
        {error && !data ? (
          <ErrorState error={error} onRetry={() => void refetch()} className="mt-6" />
        ) : initialLoading || !data ? (
          <div className="space-y-4">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-24 w-full rounded-md" />
            <Skeleton className="h-48 w-full rounded-md" />
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{data.student.name}</DialogTitle>
              <DialogDescription>
                <span className="font-mono">{data.student.rollNumber}</span> ·{' '}
                {data.student.department} · Section {data.student.section} · Semester{' '}
                {data.student.semester}
              </DialogDescription>
            </DialogHeader>

            <dl className="grid gap-x-6 gap-y-4 border-y border-border py-4 text-sm sm:grid-cols-3">
              <div className="min-w-0">
                <dt className="type-eyebrow">Email</dt>
                <dd className="mt-1 truncate font-medium" title={data.student.email}>
                  {data.student.email}
                </dd>
              </div>
              <div>
                <dt className="type-eyebrow">Status</dt>
                <dd className="mt-1">
                  <Badge
                    variant={
                      data.student.status === 'ACTIVE'
                        ? 'success'
                        : data.student.status === 'PENDING'
                          ? 'warning'
                          : 'danger'
                    }
                  >
                    {data.student.status === 'ACTIVE' ? (
                      <CheckCircle2 aria-hidden />
                    ) : data.student.status === 'PENDING' ? (
                      <Clock3 aria-hidden />
                    ) : (
                      <Ban aria-hidden />
                    )}
                    {data.student.status.charAt(0) + data.student.status.slice(1).toLowerCase()}
                  </Badge>
                </dd>
              </div>
              <div>
                <dt className="type-eyebrow">Last sign-in</dt>
                <dd className="mt-1 font-medium">
                  {data.student.lastLoginAt ? formatDateTime(data.student.lastLoginAt) : 'Never'}
                </dd>
              </div>
            </dl>

            <section>
              <h3 className="type-subheading">Examination history</h3>
              {data.attempts.length === 0 ? (
                <p className="mt-3 rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
                  This student has not attempted any examinations yet.
                </p>
              ) : (
                <div className="mt-3 rounded-md border border-border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Quiz</TableHead>
                        <TableHead>Started</TableHead>
                        <TableHead className="text-right">Score</TableHead>
                        <TableHead>Integrity</TableHead>
                        <TableHead />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.attempts.map((attempt) => (
                        <TableRow key={attempt.id}>
                          <TableCell className="min-w-[12rem] font-medium">{attempt.quizTitle}</TableCell>
                          <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                            {formatDateTime(attempt.startedAt)}
                          </TableCell>
                          <TableCell className="tabular whitespace-nowrap text-right text-sm">
                            {attempt.percentage === null
                              ? '—'
                              : `${attempt.percentage}% (${attempt.score}/${attempt.maxScore})`}
                          </TableCell>
                          <TableCell>
                            {attempt.integrityStatus ? (
                              <IntegrityBadge
                                status={attempt.integrityStatus}
                                score={attempt.integrityScore}
                              />
                            ) : (
                              <span className="text-sm text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            <Link
                              href={`/admin/integrity/${attempt.id}`}
                              className="inline-flex min-h-10 items-center gap-1 whitespace-nowrap text-sm font-medium text-primary underline-offset-4 hover:underline"
                              aria-label={`Integrity report for ${attempt.quizTitle}`}
                            >
                              Report
                              <ChevronRight className="size-3.5" aria-hidden />
                            </Link>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </section>

            <section>
              <h3 className="type-subheading flex items-center gap-1.5">
                <Laptop className="size-4 text-muted-foreground" aria-hidden />
                Registered devices
              </h3>
              {data.devices.length === 0 ? (
                <p className="mt-2 text-sm text-muted-foreground">
                  No devices have been registered for this student.
                </p>
              ) : (
                <ul className="mt-3 divide-y divide-border rounded-md border border-border">
                  {data.devices.map((device) => (
                    <li key={device.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm">
                      <span className="min-w-0 flex-1">{device.label}</span>
                      {device.trusted ? <Badge variant="outline">Remembered</Badge> : null}
                      <Badge variant={device.active ? 'success' : 'muted'}>
                        {device.active ? 'Active' : 'Signed out'}
                      </Badge>
                      <span className="hidden whitespace-nowrap text-xs text-muted-foreground sm:inline">
                        {formatDateTime(device.lastSeenAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
