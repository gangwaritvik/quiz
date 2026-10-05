'use client';

import { Lock, RefreshCw, Video, VideoOff } from 'lucide-react';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface CameraCheckProps {
  stream: MediaStream | null;
  state: 'pending' | 'pass' | 'warn' | 'fail';
  detail: string;
  onRetry: () => void;
  /** False until the student asks for the check; nothing is requested before then. */
  started: boolean;
  onStart: () => void;
}

/**
 * Pre-exam camera preview with the privacy notice the student is entitled to.
 * Sits inside the "Your device" card, so its heading is one level below it.
 */
export function CameraCheck({
  stream,
  state,
  detail,
  onRetry,
  started,
  onStart,
}: CameraCheckProps) {
  const videoRef = React.useRef<HTMLVideoElement>(null);

  React.useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.srcObject = stream;
    if (stream) void video.play().catch(() => undefined);
  }, [stream]);

  return (
    <section aria-labelledby="camera-check-heading">
      <h3 id="camera-check-heading" className="type-subheading">
        Camera check
      </h3>
      <p className="mt-1 text-sm text-muted-foreground">Position your face inside the frame.</p>

      {/* The frame stays dark in both themes: it stands in for the camera. */}
      <div
        className={cn(
          'relative mt-4 aspect-[4/3] w-full max-w-md overflow-hidden rounded-lg border bg-gray-950',
          state === 'fail' ? 'border-danger' : 'border-transparent',
        )}
      >
        {stream ? (
          <>
            <video
              ref={videoRef}
              muted
              playsInline
              autoPlay
              className="size-full scale-x-[-1] object-cover"
              aria-label="Camera preview"
            />
            {/* Face-position guide. Purely advisory — nothing is measured here. */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 flex items-center justify-center"
            >
              <div className="h-[68%] w-[46%] rounded-[46%] border-2 border-dashed border-white/50" />
            </div>
          </>
        ) : !started ? (
          <div className="flex size-full flex-col items-center justify-center gap-3 px-6 text-center">
            <Video className="size-7 text-white/50" aria-hidden />
            <p className="text-sm text-white/80">
              Your browser asks for camera access only when you choose to check.
            </p>
            <Button variant="outline" onClick={onStart}>
              Check my camera
            </Button>
          </div>
        ) : (
          <div className="flex size-full flex-col items-center justify-center gap-3 px-6 text-center">
            <VideoOff className="size-7 text-white/50" aria-hidden />
            <p className="text-sm text-white/80">{detail}</p>
            {state === 'fail' ? (
              <Button variant="outline" onClick={onRetry}>
                <RefreshCw />
                Retry camera access
              </Button>
            ) : null}
          </div>
        )}
      </div>

      <p className="mt-3 flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
        <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        <span>
          Video stays on your device and is never uploaded or stored. Only whether the camera stayed
          available is recorded.
        </span>
      </p>
    </section>
  );
}
