'use client';

import * as React from 'react';

import { describeEnvironment, isSupportedBrowser, isTouchPrimary } from '@/lib/client/device';

export type CheckState = 'pending' | 'pass' | 'warn' | 'fail';

export interface SecurityCheck {
  id: string;
  label: string;
  state: CheckState;
  detail: string;
  /** A failing required check blocks the exam from starting. */
  required: boolean;
}

/** Measured on the student's own connection. Exams need little speed but a steady link. */
const SLOW_DELAY_MS = 1500;
const SLOW_SPEED_KBPS = 256;
const PROBE_TIMEOUT_MS = 8000;

interface LinkQuality {
  state: CheckState;
  detail: string;
}

const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;

async function probe(size: number): Promise<{ ms: number; bytes: number }> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const started = performance.now();
    const response = await fetch(`/api/net-check?size=${size}`, {
      cache: 'no-store',
      credentials: 'same-origin',
      signal: controller.signal,
    });
    if (!response.ok) throw new Error('probe failed');
    const bytes = (await response.arrayBuffer()).byteLength;
    return { ms: performance.now() - started, bytes };
  } finally {
    window.clearTimeout(timer);
  }
}

/**
 * Three tiny round trips for the delay, one 128 KB download for the speed. It
 * only ever warns: a slow link can still sit an exam, the student should simply
 * know before the clock starts.
 */
async function measureLink(): Promise<LinkQuality> {
  try {
    const delays: number[] = [];
    for (let i = 0; i < 3; i += 1) delays.push((await probe(0)).ms);
    const delay = median(delays);
    const download = await probe(128 * 1024);
    const kbps = (download.bytes * 8) / 1000 / Math.max(download.ms / 1000, 0.001);
    const summary = `${Math.round(delay)} ms delay · ${kbps >= 1000 ? `${(kbps / 1000).toFixed(1)} Mbps` : `${Math.round(kbps)} kbps`}`;
    if (delay > SLOW_DELAY_MS || kbps < SLOW_SPEED_KBPS) {
      return {
        state: 'warn',
        detail: `Slow connection (${summary}). Answers may take longer to save. Move closer to the router or use a cable if you can.`,
      };
    }
    return { state: 'pass', detail: `Connection looks good (${summary})` };
  } catch {
    return { state: 'warn', detail: 'Could not test your connection speed. If saving feels slow during the exam, check your Wi-Fi.' };
  }
}

interface UseSecurityChecksOptions {
  requireFullscreen: boolean;
  cameraMonitoring: boolean;
  microphoneMonitoring: boolean;
  blockMultipleDisplays?: boolean;
  requireScreenShare?: boolean;
}

/**
 * Runs the browser-side readiness checks shown before an exam.
 *
 * These are a *usability* gate, not a security boundary — they exist so a
 * student discovers a missing camera permission now rather than ten minutes
 * into a timed paper. The server independently refuses to start an exam whose
 * requirements cannot be met.
 */
export function useSecurityChecks({
  requireFullscreen,
  cameraMonitoring,
  microphoneMonitoring,
  blockMultipleDisplays = false,
  requireScreenShare = false,
}: UseSecurityChecksOptions) {
  const [environment, setEnvironment] = React.useState(() => describeEnvironment());
  const [online, setOnline] = React.useState(true);
  const [cameraState, setCameraState] = React.useState<CheckState>('pending');
  const [cameraDetail, setCameraDetail] = React.useState('Waiting for permission');
  const [micState, setMicState] = React.useState<CheckState>('pending');
  const [micDetail, setMicDetail] = React.useState('Waiting for permission');
  const [stream, setStream] = React.useState<MediaStream | null>(null);
  const [link, setLink] = React.useState<LinkQuality>({ state: 'pending', detail: 'Testing your connection' });

  React.useEffect(() => {
    setEnvironment(describeEnvironment());
    setOnline(navigator.onLine);

    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  // Test the link on arrival and again whenever the connection comes back.
  React.useEffect(() => {
    if (!online) return;
    let cancelled = false;
    setLink({ state: 'pending', detail: 'Testing your connection' });
    void measureLink().then((result) => {
      if (!cancelled) setLink(result);
    });
    return () => {
      cancelled = true;
    };
  }, [online]);

  const requestMedia = React.useCallback(async () => {
    if (!cameraMonitoring && !microphoneMonitoring) return;

    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      // Browsers only offer camera and microphone on https (or localhost).
      const why = !window.isSecureContext
        ? 'needs a secure (https) connection. Ask your college to open the exam over https'
        : 'is not available in this browser';
      if (cameraMonitoring) {
        setCameraState('fail');
        setCameraDetail(`Camera access ${why}`);
      }
      if (microphoneMonitoring) {
        setMicState('fail');
        setMicDetail(`Microphone access ${why}`);
      }
      return;
    }

    try {
      const media = await navigator.mediaDevices.getUserMedia({
        video: cameraMonitoring ? { facingMode: 'user', width: 640, height: 480 } : false,
        audio: microphoneMonitoring,
      });

      setStream(media);

      if (cameraMonitoring) {
        const hasVideo = media.getVideoTracks().length > 0;
        setCameraState(hasVideo ? 'pass' : 'fail');
        setCameraDetail(hasVideo ? 'Camera ready' : 'No camera track available');
      }
      if (microphoneMonitoring) {
        const hasAudio = media.getAudioTracks().length > 0;
        setMicState(hasAudio ? 'pass' : 'fail');
        setMicDetail(hasAudio ? 'Microphone ready' : 'No microphone track available');
      }
    } catch (error) {
      const name = error instanceof DOMException ? error.name : 'Error';
      const detail =
        name === 'NotAllowedError'
          ? 'Permission denied — allow access in your browser and retry'
          : name === 'NotFoundError'
            ? 'No device found'
            : name === 'NotReadableError'
              ? 'Another app is using the camera or microphone. Close it (for example Zoom or Teams) and retry'
              : 'Could not access the device';

      if (cameraMonitoring) {
        setCameraState('fail');
        setCameraDetail(detail);
      }
      if (microphoneMonitoring) {
        setMicState('fail');
        setMicDetail(detail);
      }
    }
  }, [cameraMonitoring, microphoneMonitoring]);

  React.useEffect(() => {
    void requestMedia();
  }, [requestMedia]);

  // Release the preview stream when leaving the page; the exam page requests
  // its own so permission state is re-verified there.
  React.useEffect(() => {
    return () => {
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [stream]);

  const fullscreenSupported =
    typeof document !== 'undefined' &&
    (typeof document.documentElement.requestFullscreen === 'function' ||
      'webkitRequestFullscreen' in document.documentElement);

  const browserSupported = isSupportedBrowser();
  const touchPrimary = isTouchPrimary();

  const checks: SecurityCheck[] = [
    {
      id: 'device',
      label: 'Device',
      state: touchPrimary ? 'warn' : 'pass',
      detail: touchPrimary
        ? `${environment.os} · a laptop or desktop is strongly recommended`
        : `${environment.os} · ${environment.screen}`,
      required: false,
    },
    {
      id: 'browser',
      label: 'Browser',
      state: browserSupported ? 'pass' : 'fail',
      detail: browserSupported
        ? `${environment.browser} · supported`
        : `${environment.browser} · not supported for examinations`,
      required: true,
    },
    {
      id: 'network',
      label: 'Network',
      state: online ? 'pass' : 'fail',
      detail: online ? 'Connected' : 'No internet connection detected',
      required: true,
    },
    {
      id: 'connection',
      label: 'Connection quality',
      state: online ? link.state : 'warn',
      detail: online ? link.detail : 'Waiting for a connection',
      required: false,
    },
    {
      id: 'fullscreen',
      label: 'Fullscreen',
      state: fullscreenSupported ? 'pass' : requireFullscreen ? 'fail' : 'warn',
      detail: fullscreenSupported ? 'Available' : 'Not available in this browser',
      required: requireFullscreen,
    },
  ];

  if (cameraMonitoring) {
    checks.push({
      id: 'camera',
      label: 'Camera',
      state: cameraState,
      detail: cameraDetail,
      required: true,
    });
  }

  if (microphoneMonitoring) {
    checks.push({
      id: 'microphone',
      label: 'Microphone',
      state: micState,
      detail: micDetail,
      required: true,
    });
  }

  if (blockMultipleDisplays) {
    const isExtended = typeof window !== 'undefined' && Boolean(
      (window.screen as unknown as { isExtended?: boolean }).isExtended ||
      (window.screen.availWidth > window.screen.width * 1.5)
    );
    checks.push({
      id: 'displays',
      label: 'Single display check',
      state: isExtended ? 'fail' : 'pass',
      detail: isExtended
        ? 'Secondary screen detected — disconnect external monitors'
        : 'Single display verified',
      required: true,
    });
  }

  if (requireScreenShare) {
    const screenShareSupported = typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getDisplayMedia);
    checks.push({
      id: 'screenshare',
      label: 'Screen sharing capability',
      state: screenShareSupported ? 'pass' : 'fail',
      detail: screenShareSupported
        ? 'Entire-screen capture supported'
        : typeof window !== 'undefined' && !window.isSecureContext
          ? 'Screen sharing needs a secure (https) connection. Ask your college to open the exam over https'
          : 'Browser does not support screen sharing (phones usually cannot share their screen)',
      required: true,
    });
  }

  const blocking = checks.filter((check) => check.required && check.state !== 'pass');

  return {
    checks,
    stream,
    /** True once every required check has passed. */
    ready: blocking.length === 0,
    pending: checks.some((check) => check.state === 'pending'),
    blocking,
    retryMedia: requestMedia,
    fullscreenSupported,
  };
}
