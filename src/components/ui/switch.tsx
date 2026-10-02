'use client';

import * as React from 'react';
import { Switch as AriaSwitch } from 'react-aria-components';

import { cn } from '@/lib/utils';

/*
 * React Aria switch over a hidden native checkbox (role="switch"); `id` and
 * aria-* land on the input, so <Label htmlFor={id}> names and toggles it.
 * Keeps Radix's `checked` / `onCheckedChange` contract.
 */

interface SwitchProps {
  id?: string;
  name?: string;
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
}

const Switch = React.forwardRef<HTMLLabelElement, SwitchProps>(
  ({ checked, defaultChecked, onCheckedChange, disabled, className, ...props }, ref) => (
    <AriaSwitch
      ref={ref}
      isSelected={checked}
      defaultSelected={defaultChecked}
      onChange={onCheckedChange}
      isDisabled={disabled}
      className={cn(
        'group/switch inline-flex h-[22px] w-[38px] shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent bg-input',
        'transition-colors duration-fast ease-standard',
        'data-[selected]:bg-primary',
        'data-[focus-visible]:outline data-[focus-visible]:outline-2 data-[focus-visible]:outline-offset-2 data-[focus-visible]:outline-ring',
        'data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50',
        className,
      )}
      {...props}
    >
      <span
        aria-hidden
        className="pointer-events-none block size-[18px] rounded-full bg-white shadow-sm transition-transform duration-base ease-standard group-data-[selected]/switch:translate-x-4"
      />
    </AriaSwitch>
  ),
);
Switch.displayName = 'Switch';

export { Switch };
