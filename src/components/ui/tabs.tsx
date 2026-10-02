'use client';

import * as React from 'react';
import {
  Tab as AriaTab,
  TabList as AriaTabList,
  TabPanel as AriaTabPanel,
  Tabs as AriaTabs,
} from 'react-aria-components';

import { cn } from '@/lib/utils';

/*
 * Radix-shaped tabs on React Aria. `value` / `defaultValue` / `onValueChange`
 * map to RAC's selected key. Arrow keys move and select (automatic
 * activation). Tabs may be used without any <TabsContent> as a filter control.
 *
 * Look: an underline rail — the selected tab carries a 2px primary rule, not
 * a raised pill.
 */

interface TabsProps {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  orientation?: 'horizontal' | 'vertical';
  className?: string;
  children?: React.ReactNode;
}

function Tabs({ value, defaultValue, onValueChange, orientation, className, children }: TabsProps) {
  return (
    <AriaTabs
      selectedKey={value}
      defaultSelectedKey={defaultValue}
      onSelectionChange={(key) => onValueChange?.(String(key))}
      orientation={orientation}
      className={className}
    >
      {children}
    </AriaTabs>
  );
}

const TabsList = React.forwardRef<
  HTMLDivElement,
  { className?: string; children?: React.ReactNode; 'aria-label'?: string }
>(({ className, children, ...props }, ref) => (
  <AriaTabList
    ref={ref}
    className={cn(
      // Inset hairline rather than a border, so the selected tab's 2px rule can
      // sit on it without a negative margin (which would force a scrollbar).
      'scrollbar-slim flex max-w-full items-end gap-1 overflow-x-auto shadow-[inset_0_-1px_0_0_hsl(var(--border))]',
      className,
    )}
    {...props}
  >
    {children}
  </AriaTabList>
));
TabsList.displayName = 'TabsList';

interface TabsTriggerProps {
  value: string;
  className?: string;
  children?: React.ReactNode;
  disabled?: boolean;
}

const TabsTrigger = React.forwardRef<HTMLDivElement, TabsTriggerProps>(
  ({ value, className, children, disabled }, ref) => (
    <AriaTab
      ref={ref}
      id={value}
      isDisabled={disabled}
      className={cn(
        'relative inline-flex cursor-default select-none items-center gap-2 whitespace-nowrap border-b-2 border-transparent px-3 pb-2.5 pt-2 text-sm font-medium text-muted-foreground',
        'rounded-t-md outline-offset-[-2px] transition-colors duration-fast ease-standard',
        'data-[hovered]:text-foreground',
        'data-[selected]:border-primary data-[selected]:text-foreground',
        'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        className,
      )}
    >
      {children}
    </AriaTab>
  ),
);
TabsTrigger.displayName = 'TabsTrigger';

const TabsContent = React.forwardRef<
  HTMLDivElement,
  { value: string; className?: string; children?: React.ReactNode }
>(({ value, className, children }, ref) => (
  <AriaTabPanel ref={ref} id={value} className={cn('mt-5 outline-offset-4', 'animate-in fade-in-0 duration-base', className)}>
    {children}
  </AriaTabPanel>
));
TabsContent.displayName = 'TabsContent';

export { Tabs, TabsList, TabsTrigger, TabsContent };
