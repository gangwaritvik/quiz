/**
 * Human-readable names for exam events.
 *
 * Kept in its own module — free of `server-only` and of Prisma imports — so the
 * admin charts and timelines can render the same wording the server uses.
 *
 * The phrasing is deliberately descriptive rather than accusatory: "Switched
 * browser tab", not "Cheating attempt". What the event means is for a teacher
 * to decide with context this system does not have.
 */
export const EVENT_LABELS_CLIENT: Record<string, string> = {
  ATTEMPT_STARTED: 'Exam started',
  TAB_SWITCH: 'Switched browser tab',
  WINDOW_BLUR: 'Window lost focus',
  WINDOW_FOCUS: 'Window regained focus',
  FULLSCREEN_ENTER: 'Entered fullscreen',
  FULLSCREEN_EXIT: 'Exited fullscreen',
  COPY_ATTEMPT: 'Copy attempt blocked',
  PASTE_ATTEMPT: 'Paste attempt blocked',
  CUT_ATTEMPT: 'Cut attempt blocked',
  CONTEXT_MENU: 'Right-click menu blocked',
  PRINT_ATTEMPT: 'Print attempt blocked',
  SHORTCUT_BLOCKED: 'Restricted shortcut blocked',
  NETWORK_OFFLINE: 'Network disconnected',
  NETWORK_ONLINE: 'Network reconnected',
  MULTIPLE_SESSION: 'Second active session detected',
  DEVICE_MISMATCH: 'Device or session changed',
  CAMERA_PERMISSION_LOST: 'Camera permission lost',
  CAMERA_STREAM_STOPPED: 'Camera stream stopped',
  FACE_NOT_DETECTED: 'Face not detected in frame',
  MULTIPLE_FACES: 'More than one face in frame',
  MICROPHONE_LOST: 'Microphone unavailable',
  RESIZE_SUSPICIOUS: 'Unusual window resize',
  IDLE_TIMEOUT: 'Extended inactivity',
  ANSWER_SAVED: 'Answer saved',
  HEARTBEAT_MISSED: 'Connection heartbeat missed',
  ATTEMPT_SUBMITTED: 'Exam submitted',
  AUTO_SUBMITTED: 'Exam auto-submitted (time expired)',
  ATTACHMENT_UPLOADED: 'Attached an image to an answer',
  ANSWER_GRADED: 'Answer marked by faculty',
  MULTIPLE_DISPLAYS_DETECTED: 'Multiple displays detected',
  SCREEN_SHARE_STOPPED: 'Screen sharing stopped mid-exam',
  SCREEN_SHARE_PERMISSION_LOST: 'Screen share permission lost or refused',
};

export type EventSeverity = 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH';

export const SEVERITY_STYLES: Record<
  EventSeverity,
  { dot: string; text: string; label: string }
> = {
  INFO: { dot: 'bg-muted-foreground', text: 'text-muted-foreground', label: 'Informational' },
  LOW: { dot: 'bg-primary', text: 'text-primary', label: 'Low' },
  MEDIUM: { dot: 'bg-warning', text: 'text-warning', label: 'Medium' },
  HIGH: { dot: 'bg-danger', text: 'text-danger', label: 'High' },
};
