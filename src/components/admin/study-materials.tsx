'use client';

import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  FileImage,
  FileText,
  Loader2,
  Presentation,
  RotateCcw,
  ScanText,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';
import { toast } from 'sonner';

import { AiGenerateDialog, type GenerateMaterial } from '@/components/admin/ai-generate-dialog';
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { useApi } from '@/hooks/use-api';
import { ApiClientError, apiFetch, apiUpload } from '@/lib/client/api';
import { formatDateTime } from '@/lib/utils';

interface Material {
  id: string;
  title: string;
  mimeType: string;
  byteSize: number;
  pageCount: number | null;
  scannedPages: number;
  progress: { done: number; total: number } | null;
  status: 'OCR' | 'PROCESSING' | 'READY' | 'FAILED';
  error: string | null;
  createdAt: string;
}

interface Job {
  id: string;
  status: 'QUEUED' | 'RUNNING' | 'DONE' | 'FAILED';
  stats: { created?: number } | null;
  error: string | null;
  pending: number;
  createdAt: string;
}

interface MaterialsResponse {
  enabled: boolean;
  provider?: 'gemini' | 'fake' | 'ollama' | null;
  materials: Material[];
  jobs: Job[];
}

const ACCEPT =
  '.pdf,.docx,.pptx,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.presentationml.presentation';

const kindOf = (mimeType: string) =>
  mimeType === 'application/pdf'
    ? { label: 'PDF', icon: FileText }
    : mimeType.includes('presentation')
      ? { label: 'PowerPoint', icon: Presentation }
      : mimeType.includes('wordprocessing')
        ? { label: 'Word', icon: FileText }
        : { label: 'Image', icon: FileImage };

/**
 * A subject's study material and the way into AI question generation. Files
 * are private to the teacher who uploaded them. While anything is being read
 * or indexed the list refreshes itself.
 */
export function StudyMaterials({
  subject,
  topics,
}: {
  subject: { id: string; name: string };
  topics: Array<{ id: string; name: string }>;
}) {
  const [busy, setBusy] = React.useState(false);
  const { data, initialLoading, refetch } = useApi<MaterialsResponse>(
    `/api/admin/subjects/${subject.id}/materials`,
    { refreshInterval: busy ? 3000 : undefined },
  );
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = React.useState(false);
  const [generateOpen, setGenerateOpen] = React.useState(false);
  const [viewing, setViewing] = React.useState<Material | null>(null);
  const [deleting, setDeleting] = React.useState<Material | null>(null);

  const materials = data?.materials ?? [];
  const jobs = data?.jobs ?? [];
  const ready = materials.filter((material) => material.status === 'READY');

  // Poll only while something is still moving.
  React.useEffect(() => {
    if (!data) return;
    setBusy(
      data.materials.some((material) => material.status === 'OCR' || material.status === 'PROCESSING') ||
        data.jobs.some((job) => job.status === 'QUEUED' || job.status === 'RUNNING'),
    );
  }, [data]);

  if (initialLoading) return <Skeleton className="mt-6 h-28 w-full rounded-lg" />;
  if (!data) return null;

  if (!data.enabled) {
    return (
      <p className="mt-6 rounded-lg border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
        AI question generation is switched off. Add a free GEMINI_API_KEY to the server&apos;s
        .env, or set AI_PROVIDER=ollama to use a model on your own machine.
      </p>
    );
  }

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      await apiUpload('/api/admin/subjects/' + subject.id + '/materials', form);
      toast.success('Uploaded. Reading it now; this can take a minute.');
      await refetch();
    } catch (caught) {
      toast.error(caught instanceof ApiClientError ? caught.message : 'We could not upload that file.');
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const retry = async (material: Material) => {
    try {
      await apiFetch(`/api/admin/materials/${material.id}`, { method: 'POST' });
      await refetch();
    } catch (caught) {
      toast.error(caught instanceof ApiClientError ? caught.message : 'We could not retry it.');
    }
  };

  const remove = async (material: Material) => {
    try {
      await apiFetch(`/api/admin/materials/${material.id}`, { method: 'DELETE' });
      toast.success('Study material removed.');
      await refetch();
    } catch (caught) {
      toast.error(caught instanceof ApiClientError ? caught.message : 'We could not remove it.');
    } finally {
      setDeleting(null);
    }
  };

  return (
    <section
      aria-labelledby="materials-heading"
      className="mt-6 rounded-lg border border-border bg-card"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
        <div className="min-w-0">
          <h2 id="materials-heading" className="text-base font-semibold text-foreground">
            Generate questions from study material
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            PDF, Word, PowerPoint or photos of notes. Scanned pages are read automatically. Every
            question is a draft until you accept it.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void upload(file);
            }}
          />
          <Button variant="outline" size="sm" loading={uploading} onClick={() => inputRef.current?.click()}>
            <Upload />
            Upload material
          </Button>
          <Button size="sm" disabled={ready.length === 0} onClick={() => setGenerateOpen(true)}>
            <Sparkles />
            Generate with AI
          </Button>
        </div>
      </div>

      {materials.length === 0 ? (
        <p className="px-5 py-4 text-sm text-muted-foreground">
          No material yet. Upload a chapter, notes or slides for {subject.name} to start.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {materials.map((material) => {
            const kind = kindOf(material.mimeType);
            const Icon = kind.icon;
            return (
              <li key={material.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3">
                <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">{material.title}</p>
                  <p className="tabular text-xs text-muted-foreground">
                    {kind.label}
                    {material.pageCount ? ` · ${material.pageCount} pages` : ''}
                    {material.scannedPages > 0 ? ` · ${material.scannedPages} read by OCR` : ''}
                    {` · ${(material.byteSize / (1024 * 1024)).toFixed(1)} MB`}
                  </p>
                  {material.status === 'OCR' && material.progress ? (
                    <Progress
                      value={(material.progress.done / Math.max(1, material.progress.total)) * 100}
                      aria-label="Reading scanned pages"
                      className="mt-2 h-1 max-w-xs"
                    />
                  ) : null}
                  {material.status === 'FAILED' && material.error ? (
                    <p className="mt-1 text-xs text-destructive">{material.error}</p>
                  ) : null}
                </div>
                <MaterialStatus material={material} />
                <div className="flex gap-1">
                  {material.status === 'FAILED' ? (
                    <Button variant="ghost" size="sm" onClick={() => void retry(material)}>
                      <RotateCcw />
                      Try again
                    </Button>
                  ) : null}
                  {material.scannedPages > 0 ? (
                    <Button variant="ghost" size="sm" onClick={() => setViewing(material)}>
                      <ScanText />
                      View text
                    </Button>
                  ) : null}
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove ${material.title}`}
                    className="hover:bg-danger-subtle hover:text-destructive"
                    disabled={material.status === 'OCR' || material.status === 'PROCESSING'}
                    onClick={() => setDeleting(material)}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {jobs.length > 0 ? (
        <div className="border-t border-border px-5 py-3">
          <p className="type-eyebrow">Recent AI batches</p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {jobs.map((job) => (
              <li key={job.id}>
                <Link
                  href={`/admin/questions/ai/${job.id}`}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs text-foreground transition-colors duration-fast hover:bg-accent"
                >
                  {job.status === 'QUEUED' || job.status === 'RUNNING' ? (
                    <Loader2 className="size-3.5 animate-spin" aria-hidden />
                  ) : job.status === 'FAILED' ? (
                    <AlertTriangle className="size-3.5 text-warning" aria-hidden />
                  ) : (
                    <CheckCircle2 className="size-3.5 text-success" aria-hidden />
                  )}
                  {formatDateTime(job.createdAt)}
                  {job.status === 'DONE' || job.status === 'RUNNING'
                    ? ` · ${job.stats?.created ?? 0} drafts`
                    : job.status === 'FAILED'
                      ? ' · failed'
                      : ''}
                  {job.pending > 0 ? <Badge className="tabular ml-1">{job.pending} to review</Badge> : null}
                  <ChevronRight className="size-3.5 text-muted-foreground" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <p className="border-t border-border px-5 py-2.5 text-xs text-muted-foreground">
        {data.provider === 'ollama'
          ? 'Uploaded files are processed by the AI model running on your own server. Nothing is sent to an outside service.'
          : 'Uploaded files are processed by Google Gemini. On the free tier Google may use them to improve its products, so upload course material, not private student data.'}
      </p>

      <AiGenerateDialog
        open={generateOpen}
        onOpenChange={setGenerateOpen}
        subject={subject}
        topics={topics}
        materials={ready as GenerateMaterial[]}
      />

      <Dialog open={viewing !== null} onOpenChange={(open) => !open && setViewing(null)}>
        <DialogContent className="max-w-4xl">
          {viewing ? <OcrText material={viewing} /> : null}
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this material?</AlertDialogTitle>
            <AlertDialogDescription>
              It is removed from the AI&apos;s index and from the server. Questions already in the
              bank stay.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleting && void remove(deleting)}>Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

function MaterialStatus({ material }: { material: Material }) {
  if (material.status === 'READY') {
    return (
      <Badge variant="success">
        <CheckCircle2 aria-hidden />
        Ready
      </Badge>
    );
  }
  if (material.status === 'FAILED') {
    return (
      <Badge variant="danger">
        <AlertTriangle aria-hidden />
        Failed
      </Badge>
    );
  }
  return (
    <Badge variant="muted">
      <Loader2 className="animate-spin" aria-hidden />
      {material.status === 'OCR'
        ? `Reading scanned pages${material.progress ? ` ${material.progress.done}/${material.progress.total}` : ''}`
        : 'Indexing'}
    </Badge>
  );
}

function OcrText({ material }: { material: Material }) {
  const { data, error } = useApi<{ ocrText: string | null }>(`/api/admin/materials/${material.id}`);
  return (
    <>
      <DialogHeader>
        <DialogTitle>What the AI reads: {material.title}</DialogTitle>
        <DialogDescription>
          {material.scannedPages} scanned page{material.scannedPages === 1 ? ' was' : 's were'} read by
          OCR. Check it before generating; poor scans give poor questions.
        </DialogDescription>
      </DialogHeader>
      {error ? (
        <p className="text-sm text-destructive">{error.message}</p>
      ) : !data ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <pre className="max-h-[60dvh] overflow-auto whitespace-pre-wrap rounded-md border border-border bg-muted/40 p-4 font-mono text-xs leading-relaxed text-foreground">
          {data.ocrText ?? 'No OCR text.'}
        </pre>
      )}
    </>
  );
}
