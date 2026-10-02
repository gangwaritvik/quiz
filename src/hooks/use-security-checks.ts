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

  const requestMedia = React.useCallback(async () => {
    if (!cameraMonitoring && !microphoneMonitoring) return;

    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      if (cameraMonitoring) {
        setCameraState('fail');
        setCameraDetail('This browser cannot provide camera access');
      }
      if (microphoneMonitoring) {
        setMicState('fail');
        setMicDetail('This browser cannot provide microphone access');
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
        : 'Browser does not support screen sharing',
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
