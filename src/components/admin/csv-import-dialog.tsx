'use client';

import { AlertTriangle, CheckCircle2, FileUp, Upload } from 'lucide-react';
import * as React from 'react';
import { toast } from 'sonner';

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
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/input';
import { ApiClientError, apiFetch } from '@/lib/client/api';

interface ImportResult {
  imported: number;
  rejected: number;
  skipped?: number;
  issues: Array<{ row: number; message: string }>;
  /** Rows that were imported but look like questions the subject already has. */
  repeats?: Array<{ row: number; message: string }>;
}

interface CsvImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  /** Column order the importer expects, shown to the user verbatim. */
  columns: string;
  sample: string;
  endpoint: string;
  /** Extra body fields, e.g. the subject a question import belongs to. */
  extraBody?: Record<string, unknown>;
  onImported: () => void;
  /** Rendered above the file field, e.g. a subject picker. */
  children?: React.ReactNode;
  disabled?: boolean;
}

export function CsvImportDialog({
  open,
  onOpenChange,
  title,
  description,
  columns,
  sample,
  endpoint,
  extraBody,
  onImported,
  children,
  disabled,
}: CsvImportDialogProps) {
  const [csv, setCsv] = React.useState('');
  const [fileName, setFileName] = React.useState<string | null>(null);
  const [importing, setImporting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<ImportResult | null>(null);

  React.useEffect(() => {
    if (open) {
      setCsv('');
      setFileName(null);
      setError(null);
      setResult(null);
    }
  }, [open]);

  const readFile = async (file: File) => {
    if (file.size > 2_000_000) {
      setError('That file is larger than 2 MB. Split it into smaller batches.');
      return;
    }
    setFileName(file.name);
    setCsv(await file.text());
    setError(null);
  };

  const submit = async () => {
    if (csv.trim().length < 10) {
      setError('Paste some CSV data or choose a file first.');
      return;
    }

    setImporting(true);
    setError(null);
    try {
      const response = await apiFetch<ImportResult>(endpoint, {
        method: 'POST',
        body: { csv, ...extraBody },
      });
      setResult(response);
      onImported();

      if (response.imported > 0) {
        toast.success(`Imported ${response.imported} row${response.imported === 1 ? '' : 's'}.`);
      } else {
        toast.warning('Nothing was imported. Check the reported rows.');
      }
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : 'The import failed.');
    } finally {
      setImporting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={importing ? undefined : onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="space-y-5">
            <div
              role="status"
              className={
                result.imported > 0
                  ? 'flex items-start gap-3 rounded-md border border-success/20 bg-success-subtle px-4 py-3'
                  : 'flex items-start gap-3 rounded-md border border-warning/20 bg-warning-subtle px-4 py-3'
              }
            >
              {result.imported > 0 ? (
                <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" aria-hidden />
              ) : (
                <AlertTriangle className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden />
              )}
              <div>
                <p
                  className={
                    result.imported > 0
                      ? 'tabular text-sm font-semibold text-success'
                      : 'tabular text-sm font-semibold text-warning'
                  }
                >
                  {result.imported} row{result.imported === 1 ? '' : 's'} imported
                </p>
                <p className="tabular mt-0.5 text-xs text-foreground/80">
                  {result.skipped !== undefined ? `${result.skipped} skipped as duplicates · ` : ''}
                  {result.rejected} rejected
                </p>
              </div>
            </div>

            {result.issues.length > 0 ? (
              <section aria-labelledby="csv-issues-heading">
                <h3 id="csv-issues-heading" className="text-sm font-semibold">
                  Rows that could not be imported
                </h3>
                <ul className="scrollbar-slim mt-2 max-h-48 divide-y divide-border overflow-y-auto rounded-md border border-border text-xs">
                  {result.issues.map((issue) => (
                    <li key={issue.row} className="flex gap-3 px-3 py-2">
                      <span className="tabular w-14 shrink-0 font-medium text-muted-foreground">
                        Row {issue.row}
                      </span>
                      <span className="min-w-0 break-words text-destructive">{issue.message}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-muted-foreground">
                  Valid rows were imported. Fix these rows and import them again.
                </p>
              </section>
            ) : null}

            {result.repeats && result.repeats.length > 0 ? (
              <section aria-labelledby="csv-repeats-heading">
                <h3 id="csv-repeats-heading" className="text-sm font-semibold">
                  Imported, but they look like repeats
                </h3>
                <ul className="scrollbar-slim mt-2 max-h-48 divide-y divide-border overflow-y-auto rounded-md border border-border text-xs">
                  {result.repeats.map((repeat) => (
                    <li key={repeat.row} className="flex gap-3 px-3 py-2">
                      <span className="tabular w-14 shrink-0 font-medium text-muted-foreground">Row {repeat.row}</span>
                      <span className="min-w-0 break-words text-warning">{repeat.message}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-muted-foreground">
                  They are in the bank now. Use Find repeats to keep one of each and retire the others.
                </p>
              </section>
            ) : null}
          </div>
        ) : (
          <div className="space-y-5">
            {children}

            <dl className="space-y-3 rounded-md border border-border bg-muted/40 p-4">
              <div>
                <dt className="type-eyebrow">Expected columns</dt>
                <dd className="mt-1.5 break-words font-mono text-2xs leading-relaxed text-foreground/80">
                  {columns}
                </dd>
              </div>
              <div className="border-t border-border pt-3">
                <dt className="type-eyebrow">Example row</dt>
                <dd className="scrollbar-slim mt-1.5 overflow-x-auto whitespace-pre font-mono text-2xs leading-relaxed text-foreground/80">
                  {sample}
                </dd>
              </div>
            </dl>

            <div className="space-y-2">
              <Label htmlFor="csv-file">Choose a CSV file</Label>
              <input
                id="csv-file"
                type="file"
                accept=".csv,text/csv"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void readFile(file);
                }}
                className="block min-h-10 w-full min-w-0 cursor-pointer rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground file:mr-3 file:rounded-sm file:border-0 file:bg-secondary file:px-2.5 file:py-1 file:text-xs file:font-medium file:text-secondary-foreground hover:border-foreground/40"
              />
              {fileName ? (
                <p className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                  <FileUp className="size-3.5 shrink-0" aria-hidden />
                  <span className="truncate">{fileName} loaded</span>
                </p>
              ) : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="csv-text">…or paste CSV directly</Label>
              <Textarea
                id="csv-text"
                value={csv}
                onChange={(event) => {
                  setCsv(event.target.value);
                  setFileName(null);
                }}
                rows={6}
                className="font-mono text-xs"
                placeholder={sample}
              />
            </div>

            {error ? <InlineError message={error} /> : null}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={importing}>
            {result ? 'Close' : 'Cancel'}
          </Button>
          {result ? null : (
            <Button onClick={() => void submit()} loading={importing} disabled={disabled}>
              <Upload aria-hidden />
              Import
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
