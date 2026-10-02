'use client';

import { Check } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * Pick any number of sections to narrow a student list. Nothing picked means
 * every section is shown.
 */
export function SectionChips({
  sections,
  value,
  onChange,
}: {
  /** Section labels with how many students each holds. */
  sections: Array<{ label: string; count: number }>;
  value: string[];
  onChange: (next: string[]) => void;
}) {
  return (
    <div role="group" aria-label="Filter by section" className="flex flex-wrap gap-2">
      <Chip selected={value.length === 0} onClick={() => onChange([])}>
        All sections
      </Chip>
      {sections.map(({ label, count }) => {
        const selected = value.includes(label);
        return (
          <Chip
            key={label}
            selected={selected}
            onClick={() =>
              onChange(selected ? value.filter((entry) => entry !== label) : [...value, label])
            }
          >
            {label} <span className="tabular text-xs opacity-70">{count}</span>
          </Chip>
        );
      })}
    </div>
  );
}

function Chip({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        'inline-flex min-h-10 items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors duration-fast ease-standard sm:min-h-9',
        selected
          ? 'border-primary bg-accent text-accent-foreground'
          : 'border-border bg-card text-muted-foreground hover:border-foreground/30 hover:text-foreground',
      )}
    >
      {selected ? <Check className="size-3.5" aria-hidden /> : null}
      {children}
    </button>
  );
}
