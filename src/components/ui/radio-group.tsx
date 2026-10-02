'use client';

import * as React from 'react';
import { Radio as AriaRadio, RadioGroup as AriaRadioGroup } from 'react-aria-components';

import { cn } from '@/lib/utils';

/*
 * React Aria radio group over native radio inputs: Tab enters the group at
 * the selected option, arrow keys move and select. `value=""` means nothing
 * selected. Each item's `id`/aria-* land on its hidden <input>, so an outer
 * <label htmlFor={id}> (the exam's option cards) selects it.
 */

interface RadioGroupProps {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  name?: string;
  disabled?: boolean;
  required?: boolean;
  orientation?: 'horizontal' | 'vertical';
  className?: string;
  children?: React.ReactNode;
  id?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
}

const RadioGroup = React.forwardRef<HTMLDivElement, RadioGroupProps>(
  ({ value, defaultValue, onValueChange, disabled, required, className, ...props }, ref) => (
    <AriaRadioGroup
      ref={ref}
      value={value === undefined ? undefined : value || null}
      defaultValue={defaultValue || undefined}
      onChange={(next) => onValueChange?.(next)}
      isDisabled={disabled}
      isRequired={required}
      className={cn('grid gap-2.5', className)}
      {...props}
    />
  ),
);
RadioGroup.displayName = 'RadioGroup';

interface RadioGroupItemProps {
  value: string;
  id?: string;
  disabled?: boolean;
  className?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
}

const RadioGroupItem = React.forwardRef<HTMLLabelElement, RadioGroupItemProps>(
  ({ className, disabled, ...props }, ref) => (
    <AriaRadio
      ref={ref}
      isDisabled={disabled}
      className={cn(
        'group/radio inline-flex size-[18px] shrink-0 cursor-pointer items-center justify-center rounded-full border border-input bg-card',
        'transition-colors duration-fast ease-standard',
        'data-[hovered]:border-foreground/60',
        'data-[selected]:border-primary',
        'data-[focus-visible]:outline data-[focus-visible]:outline-2 data-[focus-visible]:outline-offset-2 data-[focus-visible]:outline-ring',
        'data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50',
        className,
      )}
      {...props}
    >
      <span
        aria-hidden
        className="size-2.5 scale-0 rounded-full bg-primary transition-transform duration-fast ease-standard group-data-[selected]/radio:scale-100"
      />
    </AriaRadio>
  ),
);
RadioGroupItem.displayName = 'RadioGroupItem';

export { RadioGroup, RadioGroupItem };
