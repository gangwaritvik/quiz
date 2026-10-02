'use client';

import { Ban, CheckCircle2, Hourglass, Laptop, LogOut } from 'lucide-react';
import * as React from 'react';
import { toast } from 'sonner';

import { ErrorState } from '@/components/shared/error-state';
import type { IntegrityStatus } from '@/components/shared/integrity-badge';
import { PageHeader, PageShell } from '@/components/shared/page-header';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { useApi } from '@/hooks/use-api';
import { ApiClientError, apiFetch } from '@/lib/client/api';
import { cn, formatDateTime, initials } from '@/lib/utils';

interface ProfileData {
  profile: {
    name: string;
    email: string;
    rollNumber: string | null;
    department: string | null;
    section: string | null;
    semester: number | null;
    enrollmentYear: number | null;
    status: string;
    lastLoginAt: string | null;
  };
  devices: Array<{
    id: string;
    label: string;
    trusted: boolean;
    current: boolean;
    lastSeenAt: string;
    createdAt: string;
  }>;
  integrity: { average: number; status: IntegrityStatus; attempts: number };
}

export function StudentProfile() {
  const { data, error, initialLoading, refetch } = useApi<ProfileData>('/api/student/profile');
  const [revoking, setRevoking] = React.useState<string | null>(null);

  const revokeDevice = async (sessionId: string) => {
    setRevoking(sessionId);
    try {
      await apiFetch(`/api/student/devices/${sessionId}`, { method: 'DELETE' });
      toast.success('That device has been signed out.');
      await refetch();
    } catch (caught) {
      toast.error(
        caught instanceof ApiClientError ? caught.message : 'We could not sign that device out.',
      );
    } finally {
      setRevoking(null);
    }
  };

  if (error && !data) {
    return (
      <PageShell>
        <ErrorState error={error} onRetry={() => void refetch()} />
      </PageShell>
    );
  }

  if (initialLoading || !data) {
    return (
      <PageShell>
        <PageHeader title="Profile" description="Your account and devices." />
        <div className="mt-8 max-w-3xl space-y-10">
          <div className="flex items-center gap-4">
            <Skeleton className="size-14 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-5 w-48" />
              <Skeleton className="h-4 w-64 max-w-full" />
            </div>
          </div>
          <Skeleton className="h-32 rounded-lg" />
          <Skeleton className="h-40 rounded-lg" />
        </div>
      </PageShell>
    );
  }

  const { profile, devices, integrity } = data;
  const active = profile.status === 'ACTIVE';

  return (
    <PageShell>
      <PageHeader title="Profile" description="Your account and devices." />

      <div className="mt-8 max-w-3xl space-y-12">
        <section aria-labelledby="account-heading">
          <div className="flex flex-wrap items-center gap-4">
            <Avatar className="size-14">
              <AvatarFallback className="text-base">{initials(profile.name)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <h2 id="account-heading" className="type-heading break-words">
                {profile.name}
              </h2>
              <p className="truncate text-sm text-muted-foreground" title={profile.email}>
                {profile.email}
              </p>
            </div>
            <Badge variant={active ? 'success' : 'danger'}>
              {active ? <CheckCircle2 aria-hidden /> : <Ban aria-hidden />}
              {active ? 'Active' : 'Disabled'}
            </Badge>
          </div>

          <dl className="mt-6 grid grid-cols-2 gap-x-8 gap-y-5 border-t border-border pt-6 sm:grid-cols-3">
            <Field label="Student ID" value={profile.rollNumber} mono />
            <Field label="Department" value={profile.department} />
            <Field label="Section" value={profile.section} />
            <Field label="Semester" value={profile.semester ? `Semester ${profile.semester}` : null} />
            <Field label="Enrolment year" value={profile.enrollmentYear?.toString() ?? null} />
            <Field
              label="Last sign-in"
              value={profile.lastLoginAt ? formatDateTime(profile.lastLoginAt) : 'This session'}
            />
          </dl>

          <p className="mt-6 text-xs leading-relaxed text-muted-foreground">
            Your enrolment details are maintained by your department. Contact the examination office
            if anything here is incorrect.
          </p>
        </section>

        <section aria-labelledby="devices-heading" className="border-t border-border pt-8">
          <h2 id="devices-heading" className="type-heading">
            Signed-in devices
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Sign out any device you do not recognise. Examinations are bound to the device they were
            started on.
          </p>

          {devices.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">No devices are signed in.</p>
          ) : (
            <ul className="mt-5 divide-y divide-border rounded-lg border border-border bg-card">
              {devices.map((device) => (
                <li
                  key={device.id}
                  className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:px-5"
                >
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                    <Laptop className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                        <span className="break-words">{device.label}</span>
                        {device.current ? <Badge variant="default">This device</Badge> : null}
                        {device.trusted ? <Badge variant="outline">Remembered</Badge> : null}
                      </p>
                      <p className="tabular mt-0.5 text-xs text-muted-foreground">
                        Last active {formatDateTime(device.lastSeenAt)}
                      </p>
                    </div>
                  </div>

                  {device.current ? null : (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="outline"
                          className="self-start sm:self-auto"
                          disabled={revoking === device.id}
                        >
                          <LogOut />
                          Sign out
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Sign out this device?</AlertDialogTitle>
                          <AlertDialogDescription>
                            {device.label} will be signed out immediately and will need a new
                            one-time code to sign back in.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={() => void revokeDevice(device.id)}>
                            Sign out device
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="integrity-heading" className="border-t border-border pt-8">
          <h2 id="integrity-heading" className="type-heading">
            Exam monitoring
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            During an exam, SecureQuiz records technical events such as leaving the window or going
            full screen, along with their timing. Your faculty may review these alongside your
            answers; they are evidence to look at, not a verdict.
          </p>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            If a result is marked &ldquo;Under review by your faculty&rdquo;, you don&apos;t need to
            do anything. If you have questions about an attempt, contact your faculty member.
          </p>
          {integrity.status !== 'NORMAL' ? (
            <Badge variant="muted" className="mt-4">
              <Hourglass aria-hidden />
              Under review by your faculty
            </Badge>
          ) : null}
        </section>
      </div>
    </PageShell>
  );
}

function Field({
  label,
  value,
  mono,
}: {
  label: string;
  value: string | null;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="type-eyebrow">{label}</dt>
      <dd className={cn('mt-1 break-words text-sm font-medium text-foreground', mono && 'font-mono')}>
        {value ?? '—'}
      </dd>
    </div>
  );
}
