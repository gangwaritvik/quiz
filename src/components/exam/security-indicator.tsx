'use client';

import { AlertTriangle, Check, Minus, ShieldCheck } from 'lucide-react';
import * as React from 'react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { SecurityCounters } from '@/hooks/use-exam-security';
import { cn } from '@/lib/utils';

interface SecurityIndicatorProps {
  counters: SecurityCounters;
  fullscreenActive: boolean;
  fullscreenRequired: boolean;
  online: boolean;
  deviceVerified: boolean;
  cameraActive?: boolean | null;
  microphoneActive?: boolean | null;
  screenShareActive?: boolean | null;
  singleDisplayActive?: boolean | null;
}

/**
 * The "Exam Secure Mode" chip.
 *
 * Deliberately low-key: an icon and a word, and nothing that pulses. Nothing
 * here should make a student feel watched or anxious mid-paper, so there are
 * no red flashes and no running tally of "violations" in the header.
 */
export function SecurityIndicator({
  counters,
  fullscreenActive,
  fullscreenRequired,
  online,
  deviceVerified,
  cameraActive,
  microphoneActive,
  screenShareActive,
  singleDisplayActive,
}: SecurityIndicatorProps) {
  const issues =
    (fullscreenRequired && !fullscreenActive ? 1 : 0) +
    (online ? 0 : 1) +
    (cameraActive === false ? 1 : 0) +
    (microphoneActive === false ? 1 : 0) +
    (screenShareActive === false ? 1 : 0) +
    (singleDisplayActive === false ? 1 : 0);

  const rows = [
    { label: 'Secure session', ok: true, detail: 'Answers are saved on the server' },
    { label: 'Device verified', ok: deviceVerified, detail: 'Matches the device you started on' },
    { label: 'Network connected', ok: online, detail: online ? 'Online' : 'Reconnecting…' },
    ...(fullscreenRequired
      ? [
          {
            label: 'Fullscreen active',
            ok: fullscreenActive,
            detail: fullscreenActive ? 'Exam window is fullscreen' : 'Return to fullscreen',
          },
        ]
      : []),
    ...(typeof singleDisplayActive === 'boolean'
      ? [
          {
            label: 'Single display verified',
            ok: singleDisplayActive,
            detail: singleDisplayActive ? 'Single screen verified' : 'Multiple displays detected',
          },
        ]
      : []),
    ...(typeof screenShareActive === 'boolean'
      ? [
          {
            label: 'Screen sharing active',
            ok: screenShareActive,
            detail: screenShareActive ? 'Primary screen is monitored' : 'Screen sharing stopped',
          },
        ]
      : []),
    ...(typeof cameraActive === 'boolean'
      ? [
          {
            label: 'Camera available',
            ok: cameraActive,
            detail: cameraActive ? 'Streaming locally, nothing uploaded' : 'Camera unavailable',
          },
        ]
      : []),
    ...(typeof microphoneActive === 'boolean'
      ? [
          {
            label: 'Microphone available',
            ok: microphoneActive,
            detail: microphoneActive
              ? 'Microphone is available locally, nothing recorded'
              : 'Microphone unavailable',
          },
        ]
      : []),
    {
      label: 'No suspicious activity detected',
      ok:
        counters.tabSwitches === 0 &&
        counters.copyPasteAttempts === 0 &&
        counters.fullscreenExits === 0,
      detail: describeActivity(counters),
    },
  ];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          'inline-flex h-10 items-center gap-2 rounded-md border px-3 text-xs font-medium',
          issues > 0
            ? 'border-warning/50 bg-warning-subtle text-warning data-[hovered]:bg-warning-subtle/70'
            : 'border-border bg-card text-muted-foreground data-[hovered]:bg-accent data-[hovered]:text-accent-foreground',
        )}
        aria-label="Security status"
      >
        {/* Icon shape, not just colour, says whether anything needs attention. */}
        {issues > 0 ? (
          <AlertTriangle className="size-4 shrink-0" aria-hidden />
        ) : (
          <ShieldCheck className="size-4 shrink-0 text-success" aria-hidden />
        )}
        <span className="hidden sm:inline">Exam Secure Mode</span>
        <span className="sm:hidden">Secure</span>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-72 p-3">
        <div className="flex items-center gap-2 pb-2.5">
          <ShieldCheck className="size-4 text-primary" aria-hidden />
          <p className="text-sm font-semibold">Security status</p>
        </div>

        <ul className="space-y-2.5 border-t border-border pt-3">
          {rows.map((row) => (
            <li key={row.label} className="flex items-start gap-2.5">
              <span
                className={cn(
                  'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full',
                  row.ok ? 'bg-success-subtle text-success' : 'bg-warning-subtle text-warning',
                )}
              >
                {row.ok ? (
                  <Check className="size-2.5" strokeWidth={3.5} aria-hidden />
                ) : (
                  <AlertTriangle className="size-2.5" strokeWidth={3} aria-hidden />
                )}
              </span>
              <span className="min-w-0">
                <span className="block text-xs font-medium leading-snug text-foreground">
                  {row.label}
                </span>
                <span className="block text-2xs leading-snug text-muted-foreground">
                  {row.detail}
                </span>
              </span>
            </li>
          ))}
        </ul>

        <p className="mt-3 border-t border-border pt-3 text-2xs leading-relaxed text-muted-foreground">
          These signals are shared with your faculty as context for review. They are not treated as
          proof of misconduct.
        </p>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function describeActivity(counters: SecurityCounters) {
  const parts: string[] = [];
  if (counters.tabSwitches) parts.push(`${counters.tabSwitches} tab switch${counters.tabSwitches === 1 ? '' : 'es'}`);
  if (counters.fullscreenExits) parts.push(`${counters.fullscreenExits} fullscreen exit${counters.fullscreenExits === 1 ? '' : 's'}`);
  if (counters.copyPasteAttempts) parts.push(`${counters.copyPasteAttempts} clipboard attempt${counters.copyPasteAttempts === 1 ? '' : 's'}`);
  if (counters.blurEvents) parts.push(`${counters.blurEvents} focus change${counters.blurEvents === 1 ? '' : 's'}`);
  return parts.length === 0 ? 'Nothing recorded this session' : parts.join(' · ');
}

/** Small neutral marker used in the navigator legend. */
export function LegendDot({ className }: { className?: string }) {
  return <Minus className={cn('size-3', className)} aria-hidden />;
}
