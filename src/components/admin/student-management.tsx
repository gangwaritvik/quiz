'use client';

import {
  Ban,
  CheckCircle2,
  Clock3,
  History,
  MoreHorizontal,
  Search,
  Smartphone,
  UserPlus,
  UserX,
  Users,
  Upload,
} from 'lucide-react';
import * as React from 'react';
import { toast } from 'sonner';

import { CsvImportDialog } from '@/components/admin/csv-import-dialog';
import { StudentDetailDialog } from '@/components/admin/student-detail-dialog';
import { StudentFormDialog } from '@/components/admin/student-form-dialog';
import { ErrorState } from '@/components/shared/error-state';
import { PageHeader, PageShell } from '@/components/shared/page-header';
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SkeletonRows } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useApi } from '@/hooks/use-api';
import { ApiClientError, apiFetch } from '@/lib/client/api';

export interface StudentRow {
  id: string;
  userId: string;
  name: string;
  email: string;
  rollNumber: string;
  department: string;
  section: string;
  semester: number;
  status: 'ACTIVE' | 'DISABLED' | 'PENDING';
  lastLoginAt: string | null;
  attemptCount: number;
  registeredDevices: number;
}

interface StudentsResponse {
  total: number;
  page: number;
  pageCount: number;
  students: StudentRow[];
}

const ALL = 'ALL';

export function StudentManagement() {
  const [search, setSearch] = React.useState('');
  const [debouncedSearch, setDebouncedSearch] = React.useState('');
  const [status, setStatus] = React.useState(ALL);
  const [page, setPage] = React.useState(1);

  const [formOpen, setFormOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<StudentRow | null>(null);
  const [importOpen, setImportOpen] = React.useState(false);
  const [detailId, setDetailId] = React.useState<string | null>(null);
  const [resetTarget, setResetTarget] = React.useState<StudentRow | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  const query = React.useMemo(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: '20' });
    if (debouncedSearch) params.set('search', debouncedSearch);
    if (status !== ALL) params.set('status', status);
    return `/api/admin/students?${params.toString()}`;
  }, [page, debouncedSearch, status]);

  const { data, error, initialLoading, loading, refetch } = useApi<StudentsResponse>(query);
  const students = data?.students ?? [];

  const setStudentStatus = async (student: StudentRow, next: StudentRow['status']) => {
    setBusy(true);
    try {
      await apiFetch(`/api/admin/students/${student.id}`, {
        method: 'PATCH',
        body: { status: next },
      });
      toast.success(
        next === 'DISABLED'
          ? `${student.name} has been disabled and signed out everywhere.`
          : `${student.name} is active again.`,
      );
      await refetch();
    } catch (caught) {
      toast.error(
        caught instanceof ApiClientError ? caught.message : 'We could not update that student.',
      );
    } finally {
      setBusy(false);
    }
  };

  const resetDevices = async (student: StudentRow) => {
    setBusy(true);
    try {
      const result = await apiFetch<{ revokedSessions: number }>(
        `/api/admin/students/${student.id}/devices`,
        { method: 'DELETE' },
      );
      toast.success(
        `Device registration reset — ${result.revokedSessions} session${
          result.revokedSessions === 1 ? '' : 's'
        } signed out.`,
      );
      await refetch();
    } catch (caught) {
      toast.error(
        caught instanceof ApiClientError
          ? caught.message
          : 'We could not reset that device registration.',
      );
    } finally {
      setBusy(false);
      setResetTarget(null);
    }
  };

  if (error && !data) {
    return (
      <PageShell>
        <ErrorState error={error} onRetry={() => void refetch()} />
      </PageShell>
    );
  }

  const actionsFor = (student: StudentRow) => (
    <StudentActions
      student={student}
      busy={busy}
      onHistory={() => setDetailId(student.id)}
      onEdit={() => {
        setEditing(student);
        setFormOpen(true);
      }}
      onResetDevices={() => setResetTarget(student)}
      onSetStatus={(next) => void setStudentStatus(student, next)}
    />
  );

  return (
    <PageShell>
      <PageHeader
        title="Students"
        description="The roster quizzes are assigned from. Disabling a student immediately ends their sessions."
        actions={
          <>
            <Button variant="outline" onClick={() => setImportOpen(true)}>
              <Upload />
              Import CSV
            </Button>
            <Button
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            >
              <UserPlus />
              Add student
            </Button>
          </>
        }
      />

      <div className="mt-6 grid gap-3 sm:grid-cols-[minmax(0,26rem)_12rem] sm:items-end">
        <div className="space-y-1.5">
          <Label htmlFor="student-search">Search</Label>
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              id="student-search"
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Name, student ID or email"
              className="pl-9"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="student-status">Status</Label>
          <Select
            value={status}
            onValueChange={(value) => {
              setStatus(value);
              setPage(1);
            }}
          >
            <SelectTrigger id="student-status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All statuses</SelectItem>
              <SelectItem value="ACTIVE">Active</SelectItem>
              <SelectItem value="DISABLED">Disabled</SelectItem>
              <SelectItem value="PENDING">Pending</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {initialLoading ? (
        <SkeletonRows rows={6} className="mt-6" />
      ) : students.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            icon={Users}
            title={debouncedSearch ? 'No matching students' : 'No students on the roster'}
            description={
              debouncedSearch
                ? 'Nobody matches your search. Try a different name or student ID.'
                : 'Add students one at a time, or import your section roster from a CSV export.'
            }
            action={
              <Button variant="outline" onClick={() => setImportOpen(true)}>
                <Upload />
                Import CSV
              </Button>
            }
          />
        </div>
      ) : (
        <>
          {/* Wide screens: a ruled table. */}
          <div className="mt-6 hidden rounded-lg border border-border bg-card md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Student ID</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead className="hidden xl:table-cell">Email</TableHead>
                  <TableHead>Department</TableHead>
                  <TableHead>Section</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {students.map((student) => (
                  <TableRow key={student.id}>
                    <TableCell className="tabular whitespace-nowrap font-mono text-sm">
                      {student.rollNumber}
                    </TableCell>
                    <TableCell>
                      <button
                        type="button"
                        onClick={() => setDetailId(student.id)}
                        className="rounded-sm text-left font-medium text-foreground underline-offset-4 hover:text-primary hover:underline"
                      >
                        {student.name}
                      </button>
                      <p className="text-xs text-muted-foreground">
                        {student.attemptCount} attempt{student.attemptCount === 1 ? '' : 's'} ·{' '}
                        {student.registeredDevices} device
                        {student.registeredDevices === 1 ? '' : 's'}
                      </p>
                    </TableCell>
                    <TableCell className="hidden max-w-[16rem] truncate text-sm text-muted-foreground xl:table-cell">
                      {student.email}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm">{student.department}</TableCell>
                    <TableCell className="text-sm">{student.section}</TableCell>
                    <TableCell>
                      <StudentStatusBadge status={student.status} />
                    </TableCell>
                    <TableCell className="text-right">{actionsFor(student)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Phones: the same roster as a list, one student per row. */}
          <ul className="mt-6 divide-y divide-border rounded-lg border border-border bg-card md:hidden">
            {students.map((student) => (
              <li key={student.id} className="flex items-start gap-3 px-4 py-3.5">
                <div className="min-w-0 flex-1">
                  <button
                    type="button"
                    onClick={() => setDetailId(student.id)}
                    className="max-w-full truncate rounded-sm text-left font-medium text-foreground underline-offset-4 hover:underline"
                  >
                    {student.name}
                  </button>
                  <p className="truncate text-xs text-muted-foreground">
                    <span className="font-mono">{student.rollNumber}</span> · {student.department} ·
                    Section {student.section}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">{student.email}</p>
                  <div className="mt-2">
                    <StudentStatusBadge status={student.status} />
                  </div>
                </div>
                {actionsFor(student)}
              </li>
            ))}
          </ul>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              Showing {students.length} of {data?.total ?? 0} students
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                disabled={page <= 1 || loading}
                onClick={() => setPage((value) => Math.max(1, value - 1))}
              >
                Previous
              </Button>
              <span className="tabular px-1 text-sm text-muted-foreground">
                Page {data?.page ?? 1} of {data?.pageCount ?? 1}
              </span>
              <Button
                variant="outline"
                disabled={page >= (data?.pageCount ?? 1) || loading}
                onClick={() => setPage((value) => value + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        </>
      )}

      <StudentFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        student={editing}
        onSaved={() => void refetch()}
      />

      <StudentDetailDialog
        studentId={detailId}
        onOpenChange={(open) => !open && setDetailId(null)}
      />

      <CsvImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        title="Import students"
        description="Existing student IDs and emails are skipped, so a roster can be re-imported safely."
        columns="name, email, rollNumber, department, section, semester"
        sample="Rahul Verma,rahul.verma@college.edu,23CSE041,Computer Science,A,5"
        endpoint="/api/admin/students/import"
        onImported={() => void refetch()}
      />

      <AlertDialog
        open={resetTarget !== null}
        onOpenChange={(open) => !open && setResetTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset device registration?</AlertDialogTitle>
            <AlertDialogDescription>
              {resetTarget?.name} will be signed out of every device and can register a new one at
              their next sign-in. Use this when a student legitimately changes laptop. It cannot be
              done while they have an examination in progress.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => resetTarget && void resetDevices(resetTarget)}>
              Reset devices
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageShell>
  );
}

const STATUS_BADGE = {
  ACTIVE: { label: 'Active', icon: CheckCircle2, variant: 'success' },
  PENDING: { label: 'Pending', icon: Clock3, variant: 'warning' },
  DISABLED: { label: 'Disabled', icon: Ban, variant: 'danger' },
} as const;

function StudentStatusBadge({ status }: { status: StudentRow['status'] }) {
  const { label, icon: Icon, variant } = STATUS_BADGE[status];
  return (
    <Badge variant={variant}>
      <Icon aria-hidden />
      {label}
    </Badge>
  );
}

/** The per-student menu, shared by the table and the phone list. */
function StudentActions({
  student,
  busy,
  onHistory,
  onEdit,
  onResetDevices,
  onSetStatus,
}: {
  student: StudentRow;
  busy: boolean;
  onHistory: () => void;
  onEdit: () => void;
  onResetDevices: () => void;
  onSetStatus: (next: StudentRow['status']) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={`Actions for ${student.name}`}>
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56" aria-label={`Actions for ${student.name}`}>
        <DropdownMenuItem onSelect={onHistory}>
          <History />
          Examination history
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onEdit} textValue="Edit details and section">
          <UserPlus />
          Edit details &amp; section
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onResetDevices}>
          <Smartphone />
          Reset device registration
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {student.status === 'ACTIVE' ? (
          <DropdownMenuItem destructive disabled={busy} onSelect={() => onSetStatus('DISABLED')}>
            <UserX />
            Disable student
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem disabled={busy} onSelect={() => onSetStatus('ACTIVE')}>
            <UserPlus />
            Re-enable student
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
