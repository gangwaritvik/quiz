/** How a department and section are shown together ("Computer Science · A"). */
export const sectionLabel = (section: { department: string; section: string }) =>
  `${section.department} · ${section.section}`;

/** Reverses `sectionLabel`. The section is the part after the last separator. */
export function parseSectionLabel(label: string): { department: string; section: string } | null {
  const at = label.lastIndexOf(' · ');
  if (at <= 0) return null;
  return { department: label.slice(0, at), section: label.slice(at + 3) };
}
