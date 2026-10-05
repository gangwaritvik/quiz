'use client';

import { ChevronDown, Mic, MicOff, ScreenShare, Video, VideoOff } from 'lucide-react';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import type { SecurityEventType } from '@/hooks/use-exam-security';
import { cn } from '@/lib/utils';

/** A microphone muted for longer than this counts as lost; a blip (Bluetooth switching, a cough button) does not. */
const MUTE_GRACE_MS = 5000;

interface CameraMonitorProps {
  enabled: boolean;
  microphoneEnabled?: boolean;
  screenShareEnabled?: boolean;
  screenShareActive?: boolean;
  screenShareStream?: MediaStream | null;
  onEvent: (type: SecurityEventType, options?: { metadata?: Record<string, string | number | boolean> }) => void;
  onStatusChange: (active: boolean) => void;
  onMicrophoneStatusChange?: (active: boolean) => void;
  onRequestScreenShare?: () => void;
}

/**
 * In-exam camera watch.
 *
 * Scope is deliberately narrow: it verifies that the stream the student granted
 * is still live, and reports if it stops or permission is withdrawn. It does
 * *not* run face detection — a browser-side model would produce a stream of
 * false positives (a student looking down at scratch paper, poor lighting, a
 * sibling walking past) that would land in someone's integrity report as if it
 * meant something. Where a college needs face presence, it belongs in a
 * reviewed, consented pipeline, not in an unaudited heuristic here.
 */
export function CameraMonitor({
  enabled,
  microphoneEnabled = false,
  screenShareEnabled = false,
  screenShareActive = false,
  screenShareStream = null,
  onEvent,
  onStatusChange,
  onMicrophoneStatusChange,
  onRequestScreenShare,
}: CameraMonitorProps) {
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const [stream, setStream] = React.useState<MediaStream | null>(null);
  const [active, setActive] = React.useState(false);
  const [microphoneActive, setMicrophoneActive] = React.useState(false);
  const [collapsed, setCollapsed] = React.useState(false);
  const [previewMode, setPreviewMode] = React.useState<'camera' | 'screen'>('camera');

  const onEventRef = React.useRef(onEvent);
  const onStatusChangeRef = React.useRef(onStatusChange);
  React.useEffect(() => {
    onEventRef.current = onEvent;
    onStatusChangeRef.current = onStatusChange;
  });

  React.useEffect(() => {
    if (!enabled && !microphoneEnabled) return;
    let cancelled = false;
    let media: MediaStream | null = null;
    let muteTimer: number | undefined;

    const start = async () => {
      try {
        media = await navigator.mediaDevices.getUserMedia({
          video: enabled ? { facingMode: 'user', width: 320, height: 240 } : false,
          audio: microphoneEnabled,
        });
        if (cancelled) {
          media.getTracks().forEach((track) => track.stop());
          return;
        }

        setStream(media);
        const hasCamera = media.getVideoTracks().length > 0;
        const hasMicrophone = media.getAudioTracks().length > 0;
        setActive(hasCamera);
        onStatusChangeRef.current(hasCamera);
        setMicrophoneActive(hasMicrophone);
        onMicrophoneStatusChange?.(hasMicrophone);

        // A track ending mid-exam means the camera was unplugged, taken by
        // another application, or the tab lost permission.
        media.getVideoTracks().forEach((track) => {
          track.addEventListener('ended', () => {
            setActive(false);
            onStatusChangeRef.current(false);
            onEventRef.current('CAMERA_STREAM_STOPPED');
          });
        });
        media.getAudioTracks().forEach((track) => {
          track.addEventListener('ended', () => {
            onMicrophoneStatusChange?.(false);
            setMicrophoneActive(false);
            onEventRef.current('MICROPHONE_LOST');
          });
          // A hardware or system mute leaves the track alive but silent, so
          // 'ended' never fires. Only a mute that lasts counts.
          track.addEventListener('mute', () => {
            window.clearTimeout(muteTimer);
            muteTimer = window.setTimeout(() => {
              muteTimer = undefined;
              setMicrophoneActive(false);
              onMicrophoneStatusChange?.(false);
              onEventRef.current('MICROPHONE_LOST', { metadata: { source: 'muted' } });
            }, MUTE_GRACE_MS);
          });
          track.addEventListener('unmute', () => {
            if (muteTimer !== undefined) {
              window.clearTimeout(muteTimer);
              muteTimer = undefined;
              return;
            }
            setMicrophoneActive(true);
            onMicrophoneStatusChange?.(true);
          });
        });
      } catch {
        if (cancelled) return;
        setActive(false);
        onStatusChangeRef.current(false);
        if (enabled) onEventRef.current('CAMERA_PERMISSION_LOST');
        if (microphoneEnabled) {
          setMicrophoneActive(false);
          onMicrophoneStatusChange?.(false);
        }
        if (microphoneEnabled && !enabled) onEventRef.current('MICROPHONE_LOST');
      }
    };

    void start();

    return () => {
      cancelled = true;
      window.clearTimeout(muteTimer);
      media?.getTracks().forEach((track) => track.stop());
    };
  }, [enabled, microphoneEnabled, onMicrophoneStatusChange]);

  // Watch the permission itself: a student can revoke it from the omnibox
  // without the track ending immediately.
  React.useEffect(() => {
    if ((!enabled && !microphoneEnabled) || typeof navigator === 'undefined' || !navigator.permissions) return;

    let permission: PermissionStatus | null = null;
    const handleChange = () => {
      if (permission?.state === 'denied') {
        setActive(false);
        onStatusChangeRef.current(false);
        onEventRef.current('CAMERA_PERMISSION_LOST', { metadata: { source: 'permission_api' } });
      }
      if (permission?.state === 'denied' && microphonePermission?.state === 'denied') {
        setMicrophoneActive(false);
        onMicrophoneStatusChange?.(false);
        onEventRef.current('MICROPHONE_LOST', { metadata: { source: 'permission_api' } });
      }
    };

    let microphonePermission: PermissionStatus | null = null;
    const cameraPermission = enabled
      ? navigator.permissions.query({ name: 'camera' as PermissionName })
      : Promise.resolve(null);
    const micPermission = microphoneEnabled
      ? navigator.permissions.query({ name: 'microphone' as PermissionName })
      : Promise.resolve(null);
    void Promise.allSettled([cameraPermission, micPermission]).then(([cameraResult, micResult]) => {
      permission = cameraResult.status === 'fulfilled' ? cameraResult.value : null;
      microphonePermission = micResult.status === 'fulfilled' ? micResult.value : null;
      permission?.addEventListener('change', handleChange);
      microphonePermission?.addEventListener('change', handleChange);
    });

    return () => {
      permission?.removeEventListener('change', handleChange);
      microphonePermission?.removeEventListener('change', handleChange);
    };
  }, [enabled, microphoneEnabled, onMicrophoneStatusChange]);

  const screenVideoRef = React.useRef<HTMLVideoElement>(null);

  React.useEffect(() => {
    if (previewMode === 'camera') {
      const video = videoRef.current;
      if (!video || !stream) return;
      video.srcObject = stream;
      void video.play().catch(() => undefined);
    } else {
      const video = screenVideoRef.current;
      if (!video || !screenShareStream) return;
      video.srcObject = screenShareStream;
      void video.play().catch(() => undefined);
    }
  }, [stream, screenShareStream, previewMode, collapsed]);

  if (!enabled && !microphoneEnabled && !screenShareEnabled) return null;

  const showCameraVideo = enabled && active;
  const showScreenVideo = screenShareEnabled && screenShareActive;

  const allClear =
    (enabled ? active : true) &&
    (!microphoneEnabled || microphoneActive) &&
    (!screenShareEnabled || screenShareActive);

  // The preview is a camera frame: dark in both themes, so its text is white
  // rather than a theme token.
  return (
    <div
      className={cn(
        'overflow-hidden rounded-lg border bg-card',
        allClear ? 'border-border' : 'border-danger/50',
      )}
    >
      <button
        type="button"
        onClick={() => setCollapsed((value) => !value)}
        className="flex min-h-10 w-full flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2 text-left text-xs font-medium hover:bg-accent"
        aria-expanded={!collapsed}
      >
        {enabled ? (
          active ? <Video className="size-3.5 text-success" aria-hidden /> : <VideoOff className="size-3.5 text-danger" aria-hidden />
        ) : null}
        <span className={enabled && !active ? 'text-danger' : 'text-muted-foreground'}>
          {enabled ? (active ? 'Camera active' : 'Camera unavailable') : 'Exam device monitoring'}
        </span>
        {microphoneEnabled ? (
          <span className={cn('flex items-center gap-1 border-l border-border pl-2', microphoneActive ? 'text-success' : 'text-danger')}>
            {microphoneActive ? <Mic className="size-3" aria-hidden /> : <MicOff className="size-3" aria-hidden />}
            Mic {microphoneActive ? 'active' : 'unavailable'}
          </span>
        ) : null}
        {screenShareEnabled ? (
          <span className={cn('flex items-center gap-1 border-l border-border pl-2', screenShareActive ? 'text-success' : 'text-danger')}>
            <ScreenShare className="size-3" aria-hidden />
            Screen {screenShareActive ? 'active' : 'required'}
          </span>
        ) : null}
        <span className="ml-auto flex items-center gap-0.5 text-muted-foreground">
          {collapsed ? 'Show' : 'Hide'}
          <ChevronDown className={cn('size-3.5', !collapsed && 'rotate-180')} aria-hidden />
        </span>
      </button>

      {!collapsed && (enabled || screenShareEnabled) ? (
        <div className="flex flex-col bg-gray-950">
          {enabled && screenShareEnabled && showCameraVideo && showScreenVideo ? (
            <div className="flex border-b border-white/10 text-xs font-medium">
              <button
                type="button"
                onClick={() => setPreviewMode('camera')}
                aria-pressed={previewMode === 'camera'}
                className={cn(
                  'flex-1 py-2 text-center',
                  previewMode === 'camera' ? 'bg-white/10 font-semibold text-white' : 'text-white/70 hover:text-white',
                )}
              >
                Webcam
              </button>
              <button
                type="button"
                onClick={() => setPreviewMode('screen')}
                aria-pressed={previewMode === 'screen'}
                className={cn(
                  'flex-1 py-2 text-center',
                  previewMode === 'screen' ? 'bg-white/10 font-semibold text-white' : 'text-white/70 hover:text-white',
                )}
              >
                Screen
              </button>
            </div>
          ) : null}

          <div className="aspect-[4/3] w-full">
            {previewMode === 'screen' || (!enabled && screenShareEnabled) ? (
              showScreenVideo ? (
                <video
                  ref={screenVideoRef}
                  muted
                  playsInline
                  autoPlay
                  className="size-full bg-black object-contain"
                  aria-label="Your screen share preview"
                />
              ) : (
                <div className="flex size-full flex-col items-center justify-center gap-3 p-4 text-center">
                  <p className="text-xs leading-relaxed text-white/70">Entire screen share is required for this examination.</p>
                  {onRequestScreenShare ? (
                    <Button type="button" size="sm" onClick={onRequestScreenShare}>
                      <ScreenShare aria-hidden />
                      Share entire screen
                    </Button>
                  ) : null}
                </div>
              )
            ) : showCameraVideo ? (
              <video
                ref={videoRef}
                muted
                playsInline
                autoPlay
                className="size-full scale-x-[-1] object-cover"
                aria-label="Your camera preview"
              />
            ) : (
              <div className="flex size-full items-center justify-center p-4 text-center">
                <p className="text-xs leading-relaxed text-white/70">
                  Re-enable camera access in your browser to restore monitoring.
                </p>
              </div>
            )}
          </div>
        </div>
      ) : null}

      <p className="border-t border-border px-3 py-2 text-2xs leading-relaxed text-muted-foreground">
        Your camera, microphone and screen are checked on this device only. Nothing is recorded or uploaded; only whether they are on is reported.
      </p>
    </div>
  );
}
