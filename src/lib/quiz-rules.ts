/**
 * The rules a student is held to for one quiz, derived from its security
 * settings. Pure (no icons, no React) so the selection can be unit-tested; the
 * start page maps `key` to an icon.
 */

export type ExamRuleKey =
  | 'window'
  | 'tabs'
  | 'clipboard'
  | 'confidentiality'
  | 'connection'
  | 'battery'
  | 'fullscreen'
  | 'camera'
  | 'microphone'
  | 'screenShare'
  | 'singleDisplay';

export interface ExamRule {
  key: ExamRuleKey;
  text: string;
}

export interface RuleSettings {
  requireFullscreen: boolean;
  detectTabSwitch: boolean;
  blockCopyPaste: boolean;
  cameraMonitoring: boolean;
  microphoneMonitoring: boolean;
  maxFullscreenExits: number;
  blockMultipleDisplays?: boolean;
  requireScreenShare?: boolean;
}

/** The short list shown up front; everything else sits behind "Read all exam rules". */
export const MAX_HIGHLIGHTS = 5;

const TABS: ExamRule = { key: 'tabs', text: 'Do not switch to other applications or browser tabs' };
const CLIPBOARD: ExamRule = {
  key: 'clipboard',
  text: 'Do not use copy, paste or cut during the exam',
};

/** Apply to every exam, whatever its settings. */
const BASE_RULES: ExamRule[] = [
  { key: 'window', text: 'Stay inside the examination window until you submit' },
  TABS,
  CLIPBOARD,
  { key: 'confidentiality', text: 'Do not share, photograph or redistribute the questions' },
  { key: 'connection', text: 'Maintain a stable internet connection throughout' },
  { key: 'battery', text: 'Ensure your device has sufficient battery or is plugged in' },
];

export function buildExamRules(settings: RuleSettings): {
  /** At most {@link MAX_HIGHLIGHTS} rules this particular quiz turns on, most specific first. */
  highlights: ExamRule[];
  /** Every rule, so nothing is lost behind the summary. */
  all: ExamRule[];
} {
  const exits = settings.maxFullscreenExits;
  const specific: ExamRule[] = [];

  if (settings.requireFullscreen) {
    specific.push({
      key: 'fullscreen',
      text:
        exits > 0
          ? `Fullscreen is required. ${exits} or more exits from fullscreen are flagged for your faculty`
          : 'Fullscreen is required for this exam',
    });
  }
  if (settings.cameraMonitoring) {
    specific.push({
      key: 'camera',
      text: 'Keep your camera on and available throughout the exam',
    });
  }
  if (settings.microphoneMonitoring) {
    specific.push({
      key: 'microphone',
      text: 'Keep your microphone on and available throughout the exam',
    });
  }
  if (settings.requireScreenShare) {
    specific.push({
      key: 'screenShare',
      text: 'Share your entire screen and keep sharing until you submit',
    });
  }
  if (settings.blockMultipleDisplays) {
    specific.push({
      key: 'singleDisplay',
      text: 'Use a single display; disconnect external monitors',
    });
  }

  const highlights = [
    ...specific,
    ...(settings.detectTabSwitch ? [TABS] : []),
    ...(settings.blockCopyPaste ? [CLIPBOARD] : []),
  ].slice(0, MAX_HIGHLIGHTS);

  return { highlights, all: [...BASE_RULES, ...specific] };
}
