'use client';

import { Check, ChevronDown } from 'lucide-react';
import * as React from 'react';
import {
  Button as AriaButton,
  Header,
  ListBox,
  ListBoxItem,
  ListBoxSection,
  Popover,
  Select as AriaSelect,
  SelectValue as AriaSelectValue,
  Separator,
} from 'react-aria-components';

import { textOf } from '@/components/ui/slot';
import { cn } from '@/lib/utils';

/*
 * Radix-shaped select on React Aria's Select / ListBox.
 *
 * Values are strings (`value` / `onValueChange`), and `""` means "nothing
 * selected" so the placeholder shows. The trigger is named from its own
 * `aria-label`, or — when it has an `id` — from the <Label htmlFor={id}> that
 * points at it (see label.tsx), followed by the selected value.
 */

interface SelectProps {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  disabled?: boolean;
  required?: boolean;
  name?: string;
  children?: React.ReactNode;
}

interface TriggerNaming {
  id?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
}

function Select({
  value,
  defaultValue,
  onValueChange,
  open,
  defaultOpen,
  onOpenChange,
  disabled,
  required,
  name,
  children,
}: SelectProps) {
  // The trigger is always a direct child; read how it should be named.
  const trigger = React.Children.toArray(children).find(
    (child): child is React.ReactElement<TriggerNaming> =>
      React.isValidElement(child) && child.type === SelectTrigger,
  )?.props;

  const ariaLabel = trigger?.['aria-label'];
  const ariaLabelledby =
    trigger?.['aria-labelledby'] ?? (!ariaLabel && trigger?.id ? `${trigger.id}-label` : undefined);

  return (
    <AriaSelect
      value={value === undefined ? undefined : value || null}
      defaultValue={defaultValue || undefined}
      onChange={(key) => {
        if (key != null) onValueChange?.(String(key));
      }}
      isOpen={open}
      defaultOpen={defaultOpen}
      onOpenChange={onOpenChange}
      isDisabled={disabled}
      isRequired={required}
      name={name}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledby}
      // `contents`: like Radix, the root adds no box, so the trigger sits in the
      // caller's layout directly.
      className="group/select contents"
    >
      {children}
    </AriaSelect>
  );
}

type SelectTriggerProps = TriggerNaming & {
  className?: string;
  children?: React.ReactNode;
};

const SelectTrigger = React.forwardRef<HTMLButtonElement, SelectTriggerProps>(
  ({ className, children, id }, ref) => (
    <AriaButton
      ref={ref}
      id={id}
      className={cn(
        'flex h-10 w-full [@media(pointer:coarse)]:min-h-11 items-center justify-between gap-2 rounded-md border border-input bg-card px-3 py-2 text-left text-sm text-foreground',
        'transition-colors duration-fast ease-standard hover:border-foreground/40',
        'data-[focus-visible]:border-primary data-[pressed]:border-primary',
        'data-[disabled]:cursor-not-allowed data-[disabled]:bg-muted data-[disabled]:opacity-70',
        'group-data-[invalid]/select:border-danger',
        className,
      )}
    >
      {children}
      <ChevronDown
        className="size-4 shrink-0 text-muted-foreground transition-transform duration-fast group-data-[open]/select:rotate-180"
        aria-hidden
      />
    </AriaButton>
  ),
);
SelectTrigger.displayName = 'SelectTrigger';

function SelectValue({ placeholder, className }: { placeholder?: string; className?: string }) {
  return (
    <AriaSelectValue
      className={cn('line-clamp-1 flex-1 data-[placeholder]:text-muted-foreground', className)}
    >
      {({ isPlaceholder, selectedText }) => (isPlaceholder ? (placeholder ?? '') : selectedText)}
    </AriaSelectValue>
  );
}

const SelectContent = ({ className, children }: { className?: string; children?: React.ReactNode }) => (
  <Popover
    offset={4}
    className={cn(
      'z-50 flex min-w-[var(--trigger-width)] flex-col rounded-lg border border-border bg-popover text-popover-foreground shadow-overlay outline-none',
      'data-[entering]:animate-in data-[entering]:fade-in-0 data-[entering]:duration-fast data-[entering]:ease-standard',
      'data-[exiting]:animate-out data-[exiting]:fade-out-0 data-[exiting]:duration-fast data-[exiting]:ease-standard',
      className,
    )}
  >
    {/* RAC scrolls the ListBox (its scrollRef); it fills the height the popover is given. */}
    <ListBox className="min-h-0 flex-1 overflow-y-auto p-1 outline-none">{children}</ListBox>
  </Popover>
);

interface SelectItemProps {
  value: string;
  children?: React.ReactNode;
  className?: string;
  disabled?: boolean;
  textValue?: string;
}

const SelectItem = React.forwardRef<HTMLDivElement, SelectItemProps>(
  ({ value, children, className, disabled, textValue }, ref) => (
    <ListBoxItem
      ref={ref}
      id={value}
      isDisabled={disabled}
      textValue={textValue ?? textOf(children).trim()}
      className={cn(
        'relative flex w-full cursor-default select-none items-center rounded-md py-1.5 pl-8 pr-2 text-sm text-foreground outline-none',
        'transition-colors duration-fast ease-standard',
        'data-[focused]:bg-accent data-[focused]:text-accent-foreground',
        'data-[selected]:font-medium data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        className,
      )}
    >
      {({ isSelected }) => (
        <>
          <span className="absolute left-2 flex size-4 items-center justify-center text-primary">
            {isSelected ? <Check className="size-4" aria-hidden /> : null}
          </span>
          {children}
        </>
      )}
    </ListBoxItem>
  ),
);
SelectItem.displayName = 'SelectItem';

const SelectGroup = ({ children, className }: { children?: React.ReactNode; className?: string }) => (
  <ListBoxSection className={className}>{children}</ListBoxSection>
);

const SelectLabel = ({ children, className }: { children?: React.ReactNode; className?: string }) => (
  <Header className={cn('type-eyebrow px-2 py-1.5', className)}>{children}</Header>
);

const SelectSeparator = ({ className }: { className?: string }) => (
  <Separator className={cn('-mx-1 my-1 h-px border-0 bg-border', className)} />
);

export {
  Select,
  SelectGroup,
  SelectValue,
  SelectTrigger,
  SelectContent,
  SelectLabel,
  SelectItem,
  SelectSeparator,
};
