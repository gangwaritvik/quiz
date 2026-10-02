'use client';

import * as React from 'react';

import { cn } from '@/lib/utils';

interface OtpInputProps {
  value: string;
  onChange: (value: string) => void;
  onComplete?: (value: string) => void;
  disabled?: boolean;
  invalid?: boolean;
  length?: number;
}

/**
 * Six single-character boxes that behave like one field.
 *
 * Accessibility notes: the group is labelled, each box announces its position,
 * arrow keys and backspace move between boxes, and a pasted code fills the row.
 */
export function OtpInput({
  value,
  onChange,
  onComplete,
  disabled,
  invalid,
  length = 6,
}: OtpInputProps) {
  const inputs = React.useRef<Array<HTMLInputElement | null>>([]);

  const focusBox = (index: number) => {
    const clamped = Math.max(0, Math.min(length - 1, index));
    inputs.current[clamped]?.focus();
    inputs.current[clamped]?.select();
  };

  const handleChange = (index: number, raw: string) => {
    const digits = raw.replace(/\D/g, '');
    if (!digits) return;

    // A paste (or fast typing) lands as several characters at once.
    if (digits.length > 1) {
      const filled = (value.slice(0, index) + digits).slice(0, length);
      onChange(filled);
      focusBox(filled.length);
      if (filled.length === length) onComplete?.(filled);
      return;
    }

    const chars = value.split('');
    chars[index] = digits;
    const filled = chars.join('').slice(0, length);
    onChange(filled);

    if (index < length - 1) focusBox(index + 1);
    // `filled` is a compacted string, so its length alone tells us every box
    // holds a digit. (A `.includes('')` guard here would always be true.)
    if (filled.length === length) onComplete?.(filled);
  };

  const handleKeyDown = (index: number, event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Backspace') {
      event.preventDefault();
      if (value[index]) {
        onChange(value.slice(0, index) + value.slice(index + 1));
      } else if (index > 0) {
        onChange(value.slice(0, index - 1) + value.slice(index));
        focusBox(index - 1);
      }
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      focusBox(index - 1);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      focusBox(index + 1);
    }
  };

  return (
    <div
      role="group"
      aria-label={`Enter the ${length}-digit code`}
      className="grid gap-2 sm:gap-3"
      style={{ gridTemplateColumns: `repeat(${length}, minmax(0, 1fr))` }}
    >
      {Array.from({ length }).map((_, index) => (
        <input
          key={index}
          ref={(element) => {
            inputs.current[index] = element;
          }}
          value={value[index] ?? ''}
          onChange={(event) => handleChange(index, event.target.value)}
          onKeyDown={(event) => handleKeyDown(index, event)}
          onFocus={(event) => event.target.select()}
          disabled={disabled}
          inputMode="numeric"
          autoComplete={index === 0 ? 'one-time-code' : 'off'}
          aria-label={`Digit ${index + 1} of ${length}`}
          aria-invalid={invalid || undefined}
          maxLength={length}
          className={cn(
            'tabular h-12 w-full min-w-0 rounded-md border border-input bg-card text-center font-mono text-xl font-medium text-foreground sm:h-14 sm:text-2xl',
            'transition-colors duration-fast ease-standard',
            'hover:border-foreground/40 focus-visible:border-primary focus-visible:outline-offset-1',
            'disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-70',
            invalid &&
              'border-danger text-danger hover:border-danger focus-visible:border-danger focus-visible:outline-danger',
          )}
        />
      ))}
    </div>
  );
}
