'use client';

import { ImagePlus, Loader2, X } from 'lucide-react';
import * as React from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { ApiClientError, apiUpload } from '@/lib/client/api';
import { compressImage } from '@/lib/client/compress-image';
import { cn } from '@/lib/utils';

interface UploadResult {
  id: string;
  url: string;
  originalName: string;
}

interface ImageUploadFieldProps {
  /** Current asset id, or null when nothing is attached. */
  assetId: string | null;
  onChange: (assetId: string | null) => void;
  kind: 'QUESTION_IMAGE' | 'OPTION_IMAGE';
  label: string;
  /** Compact variant for the per-option control. */
  compact?: boolean;
  className?: string;
}

/**
 * Attaches a diagram to a question or an option.
 *
 * The asset is uploaded immediately and the returned id is held in the form;
 * it is only bound to the question when the author saves. An upload the author
 * then abandons is unreachable — assets are served through the question
 * relationship, never by possession of an id.
 */
export function ImageUploadField({
  assetId,
  onChange,
  kind,
  label,
  compact = false,
  className,
}: ImageUploadFieldProps) {
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = React.useState(false);

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', await compressImage(file, { maxSide: 2000, quality: 0.9 }));
      form.append('kind', kind);
      const result = await apiUpload<UploadResult>('/api/admin/media', form);
      onChange(result.id);
    } catch (caught) {
      toast.error(
        caught instanceof ApiClientError ? caught.message : 'We could not upload that image.',
      );
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className={cn('space-y-2', className)}>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void upload(file);
        }}
      />

      {assetId ? (
        <div className="flex items-start gap-3 rounded-md border border-border bg-muted/40 p-2">
          {/* eslint-disable-next-line @next/next/no-img-element -- authorised
              route, so Next's image optimiser cannot fetch it. */}
          <img
            src={`/api/media/${assetId}`}
            alt={label}
            // A white mat on purpose: diagrams are drawn dark-on-transparent
            // and must stay legible in the dark theme too.
            className={cn(
              'min-w-0 max-w-full rounded-sm border border-border bg-white object-contain',
              compact ? 'max-h-16' : 'max-h-40',
            )}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="ml-auto shrink-0"
            aria-label={`Remove ${label.toLowerCase()}`}
            onClick={() => onChange(null)}
          >
            <X />
          </Button>
        </div>
      ) : (
        <Button
          type="button"
          variant="outline"
          size={compact ? 'sm' : 'default'}
          disabled={uploading}
          aria-busy={uploading || undefined}
          onClick={() => inputRef.current?.click()}
          className={compact ? 'min-h-10 sm:min-h-0' : undefined}
        >
          {uploading ? <Loader2 className="animate-spin" aria-hidden /> : <ImagePlus aria-hidden />}
          {uploading ? 'Uploading…' : label}
        </Button>
      )}
    </div>
  );
}
