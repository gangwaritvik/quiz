'use client';

import { Check, Minus } from 'lucide-react';
import * as React from 'react';
import { Checkbox as AriaCheckbox } from 'react-aria-components';

import { cn } from '@/lib/utils';

/*
 * React Aria checkbox: a visually hidden native <input type="checkbox">
 * (which receives `id`, aria-* and focus) inside a <label> that draws the box.
 * `<label htmlFor={id}>` elsewhere, or a wrapping <label>, both toggle it.
 * Keeps Radix's `checked` / `onCheckedChange` contract.
 */

interface CheckboxProps {
  id?: string;
  name?: string;
  value?: string;
  checked?: boolean | 'indeterminate';
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
}

const Checkbox = React.forwardRef<HTMLLabelElement, CheckboxProps>(
  ({ checked, defaultChecked, onCheckedChange, disabled, required, className, ...props }, ref) => (
    <AriaCheckbox
      ref={ref}
      isSelected={checked === undefined ? undefined : checked === true}
      isIndeterminate={checked === 'indeterminate'}
      defaultSelected={defaultChecked}
      onChange={onCheckedChange}
      isDisabled={disabled}
      isRequired={required}
      className={cn(
        'group/checkbox inline-flex size-[18px] shrink-0 cursor-pointer items-center justify-center rounded-sm border border-input bg-card text-primary-foreground',
        'transition-colors duration-fast ease-standard',
        'data-[hovered]:border-foreground/60',
        'data-[selected]:border-primary data-[selected]:bg-primary data-[indeterminate]:border-primary data-[indeterminate]:bg-primary',
        'data-[focus-visible]:outline data-[focus-visible]:outline-2 data-[focus-visible]:outline-offset-2 data-[focus-visible]:outline-ring',
        'data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50',
        'data-[invalid]:border-danger',
        className,
      )}
      {...props}
    >
      {({ isSelected, isIndeterminate }) =>
        isIndeterminate ? (
          <Minus className="size-3.5" strokeWidth={3} aria-hidden />
        ) : isSelected ? (
          <Check className="size-3.5" strokeWidth={3} aria-hidden />
        ) : null
      }
    </AriaCheckbox>
  ),
);
Checkbox.displayName = 'Checkbox';

export { Checkbox };
