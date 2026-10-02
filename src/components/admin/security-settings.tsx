'use client';

import {
  AlertTriangle,
  Camera,
  ClipboardX,
  Eye,
  LockKeyhole,
  Maximize,
  Mic,
  MonitorX,
  Repeat,
  ScreenShare,
  Shuffle,
  Smartphone,
  Trophy,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import * as React from 'react';

import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

export interface QuizSecurity {
  randomizeQuestions: boolean;
  randomizeOptions: boolean;
  singleAttempt: boolean;
  requireFullscreen: boolean;
  detectTabSwitch: boolean;
  blockCopyPaste: boolean;
  bindDeviceSession: boolean;
  cameraMonitoring: boolean;
  microphoneMonitoring: boolean;
  lockQuestionNavigation: boolean;
  blockMultipleDisplays: boolean;
  requireScreenShare: boolean;
  releaseResults: boolean;
  releaseAnswers: boolean;
}

export const DEFAULT_SECURITY: QuizSecurity = {
  randomizeQuestions: true,
  randomizeOptions: true,
  singleAttempt: true,
  requireFullscreen: true,
  detectTabSwitch: true,
  blockCopyPaste: true,
  bindDeviceSession: true,
  cameraMonitoring: false,
  microphoneMonitoring: false,
  lockQuestionNavigation: false,
  blockMultipleDisplays: false,
  requireScreenShare: false,
  releaseResults: true,
  releaseAnswers: false,
};

interface Setting {
  key: keyof QuizSecurity;
  label: string;
  description: string;
  icon: LucideIcon;
  /** Shown when the option carries a privacy or fairness cost. */
  caution?: string;
}

const PAPER_SETTINGS: Setting[] = [
  {
    key: 'randomizeQuestions',
    label: 'Randomize questions',
    description: 'Each student receives a different question order drawn from the pool.',
    icon: Shuffle,
  },
  {
    key: 'randomizeOptions',
    label: 'Randomize options',
    description: 'Answer options are shuffled per student, so option position carries no signal.',
    icon: Shuffle,
  },
  {
    key: 'singleAttempt',
    label: 'One attempt only',
    description: 'A student may sit this examination once.',
    icon: Repeat,
  },
];

const MONITORING_SETTINGS: Setting[] = [
  {
    key: 'requireFullscreen',
    label: 'Fullscreen required',
    description: 'The paper is hidden until the exam window is fullscreen.',
    icon: Maximize,
  },
  {
    key: 'detectTabSwitch',
    label: 'Detect tab switching',
    description: 'Records when the exam tab is hidden or loses focus.',
    icon: Eye,
  },
  {
    key: 'blockCopyPaste',
    label: 'Disable copy and paste',
    description: 'Blocks clipboard actions inside the exam and records the attempt.',
    icon: ClipboardX,
  },
  {
    key: 'bindDeviceSession',
    label: 'Device and session binding',
    description: 'The exam continues only on the device and session it started on.',
    icon: Smartphone,
  },
  {
    key: 'lockQuestionNavigation',
    label: 'Lock question order',
    description:
      'Students must answer questions in order. They cannot jump ahead or return to a previous question.',
    icon: LockKeyhole,
    caution:
      'Students who accidentally skip a question cannot go back. Only enable this when strict linear progression is required.',
  },
  {
    key: 'blockMultipleDisplays',
    label: 'Single display required',
    description: 'Refuses to load the examination if a secondary screen or display extension is detected.',
    icon: MonitorX,
    caution: 'Students using multi-monitor setups or external displays will be blocked until secondary monitors are disconnected.',
  },
  {
    key: 'requireScreenShare',
    label: 'Screen share proctoring',
    description: 'Requires the student to share their full screen continuously for the duration of the exam.',
    icon: ScreenShare,
    caution: 'Students must grant browser permission to share their entire display. Stopping screen share mid-exam locks the paper.',
  },
  {
    key: 'cameraMonitoring',
    label: 'Camera monitoring',
    description: 'Requires camera permission and records if the camera becomes unavailable.',
    icon: Camera,
    caution:
      'No video is recorded or uploaded — only availability. Tell students in advance; some will need a private space to sit the exam.',
  },
  {
    key: 'microphoneMonitoring',
    label: 'Microphone monitoring',
    description: 'Requires microphone permission and records if it becomes unavailable.',
    icon: Mic,
    caution: 'No audio is recorded or uploaded — only availability.',
  },
];

const RELEASE_SETTINGS: Setting[] = [
  {
    key: 'releaseResults',
    label: 'Release results to students',
    description: 'Students can see their score and topic breakdown after submitting.',
    icon: Trophy,
  },
  {
    key: 'releaseAnswers',
    label: 'Release correct answers',
    description: 'Students can also see the correct option and explanation for each question.',
    icon: Eye,
    caution:
      'Only enable once every student has sat the paper — released answers can be shared with those still to attempt it.',
  },
];

interface SecuritySettingsProps {
  value: QuizSecurity;
  onChange: (value: QuizSecurity) => void;
  disabled?: boolean;
}

/**
 * Each control is independent, as the brief requires. Grouping is presentational
 * only — nothing here silently switches something else on.
 */
export function SecuritySettings({ value, onChange, disabled }: SecuritySettingsProps) {
  const toggle = (key: keyof QuizSecurity, next: boolean) =>
    onChange({ ...value, [key]: next });

  return (
    <div className="space-y-8">
      <Group title="Paper generation" settings={PAPER_SETTINGS} value={value} onToggle={toggle} disabled={disabled} />
      <Group title="Monitoring" settings={MONITORING_SETTINGS} value={value} onToggle={toggle} disabled={disabled} />
      <Group title="Result release" settings={RELEASE_SETTINGS} value={value} onToggle={toggle} disabled={disabled} />
    </div>
  );
}

function Group({
  title,
  settings,
  value,
  onToggle,
  disabled,
}: {
  title: string;
  settings: Setting[];
  value: QuizSecurity;
  onToggle: (key: keyof QuizSecurity, next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset disabled={disabled} className="min-w-0">
      <legend className="type-eyebrow">{title}</legend>

      <ul className="mt-3 divide-y divide-border rounded-lg border border-border bg-card">
        {settings.map((setting) => {
          const checked = value[setting.key];
          const id = `security-${setting.key}`;

          return (
            <li key={setting.key} className="flex items-start gap-3 px-4 py-3.5">
              <setting.icon
                className={cn(
                  'mt-0.5 size-4 shrink-0',
                  checked ? 'text-primary' : 'text-muted-foreground',
                )}
                aria-hidden
              />

              <div className="min-w-0 flex-1">
                <label htmlFor={id} className="cursor-pointer text-sm font-medium text-foreground">
                  {setting.label}
                </label>
                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                  {setting.description}
                </p>
                {setting.caution && checked ? (
                  <p className="mt-2 flex items-start gap-1.5 rounded-md border border-warning/20 bg-warning-subtle px-2.5 py-2 text-xs leading-relaxed text-warning">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                    <span>{setting.caution}</span>
                  </p>
                ) : null}
              </div>

              <Switch
                id={id}
                checked={checked}
                onCheckedChange={(next) => onToggle(setting.key, next)}
                aria-describedby={`${id}-description`}
                className="mt-0.5"
              />
              <span id={`${id}-description`} className="sr-only">
                {setting.description}
              </span>
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}
