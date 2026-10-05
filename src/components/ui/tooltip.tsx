'use client';

import * as React from 'react';
import {
  Focusable,
  type Placement,
  Tooltip as AriaTooltip,
  TooltipTrigger as AriaTooltipTrigger,
} from 'react-aria-components';

import { cn } from '@/lib/utils';

/*
 * Radix-shaped tooltip on React Aria. Opens on hover after a delay and
 * immediately on keyboard focus; Escape closes. The trigger must be
 * focusable — an `asChild` child that is not (e.g. a <span>) is given
 * tabIndex=0 so keyboard users can reach the tooltip too. Give such a child an
 * accessible name and `role="img"` when it is an icon.
 */

const TooltipDelayContext = React.createContext(700);

/** Sets the default open delay (ms) for every tooltip below it. */
function TooltipProvider({
  delayDuration = 700,
  children,
}: {
  delayDuration?: number;
  children?: React.ReactNode;
}) {
  return <TooltipDelayContext.Provider value={delayDuration}>{children}</TooltipDelayContext.Provider>;
}

interface TooltipProps {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  delayDuration?: number;
  children?: React.ReactNode;
}

function Tooltip({ open, defaultOpen, onOpenChange, delayDuration, children }: TooltipProps) {
  const providerDelay = React.useContext(TooltipDelayContext);
  return (
    <AriaTooltipTrigger
      isOpen={open}
      defaultOpen={defaultOpen}
      onOpenChange={onOpenChange}
      delay={delayDuration ?? providerDelay}
      closeDelay={0}
    >
      {children}
    </AriaTooltipTrigger>
  );
}

const TooltipTrigger = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { asChild?: boolean }
>(({ asChild, children, ...props }, ref) => (
  <Focusable>
    {asChild && React.isValidElement(children) ? (
      (children as React.ReactElement<React.DOMAttributes<Element>, string>)
    ) : (
      <button ref={ref} type="button" {...props}>
        {children}
      </button>
    )}
  </Focusable>
));
TooltipTrigger.displayName = 'TooltipTrigger';

interface TooltipContentProps {
  className?: string;
  children?: React.ReactNode;
  side?: 'top' | 'bottom' | 'left' | 'right';
  sideOffset?: number;
}

function TooltipContent({ className, children, side = 'top', sideOffset = 6 }: TooltipContentProps) {
  return (
    <AriaTooltip
      placement={side as Placement}
      offset={sideOffset}
      className={cn(
        'z-50 max-w-xs rounded-md bg-gray-900 px-2.5 py-1.5 text-xs font-medium leading-snug text-white shadow-md',
        'data-[entering]:animate-in data-[entering]:fade-in-0 data-[entering]:duration-fast data-[entering]:ease-standard',
        'data-[exiting]:animate-out data-[exiting]:fade-out-0 data-[exiting]:duration-fast data-[exiting]:ease-standard',
        className,
      )}
    >
      {children}
    </AriaTooltip>
  );
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };
