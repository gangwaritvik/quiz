'use client';

import { Search } from 'lucide-react';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

/**
 * The pieces of a filter bar. A bar is one wrapping row: a search box that
 * takes the spare width, then compact dropdowns and toggles. The dropdowns
 * name themselves by their "All …" choice, so no labels are needed on screen.
 */
export function FilterBar({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      role="search"
      aria-label={label}
      className={cn('mt-6 flex flex-wrap items-center gap-2', className)}
    >
      {children}
    </div>
  );
}

export function FilterSearch({
  id,
  label,
  value,
  onChange,
  placeholder,
  maxLength,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  maxLength?: number;
}) {
  return (
    <div className="relative min-w-[14rem] flex-1 basis-64">
      <Label htmlFor={id} className="sr-only">
        {label}
      </Label>
      <Search
        className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <Input
        id={id}
        type="search"
        value={value}
        maxLength={maxLength}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="h-9 pl-9"
      />
    </div>
  );
}

/**
 * A dropdown for a filter bar. `compact` drops the visible label (it stays for
 * screen readers) and the extra height, for use inside a `FilterBar`.
 */
export function FilterSelect({
  id,
  label,
  value,
  onChange,
  options,
  disabled,
  hint,
  compact,
  className,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  disabled?: boolean;
  hint?: string;
  compact?: boolean;
  className?: string;
}) {
  if (compact) {
    return (
      <div className={cn('w-full min-w-0 sm:w-44', className)}>
        <Select value={value} onValueChange={onChange} disabled={disabled}>
          <SelectTrigger id={id} aria-label={label} className="h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  }

  return (
    <div className="min-w-0 space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger id={id}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/** A pressed / not-pressed chip for an on-off filter. */
export function FilterToggle({
  pressed,
  onPressedChange,
  icon,
  children,
}: {
  pressed: boolean;
  onPressedChange: (pressed: boolean) => void;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={() => onPressedChange(!pressed)}
      className={cn(
        'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border px-3 text-sm font-medium transition-colors duration-fast ease-standard [&_svg]:size-4 [@media(pointer:coarse)]:min-h-11',
        pressed
          ? 'border-primary bg-accent text-accent-foreground'
          : 'border-input bg-card text-muted-foreground hover:border-foreground/40 hover:text-foreground',
      )}
    >
      {icon}
      {children}
    </button>
  );
}
