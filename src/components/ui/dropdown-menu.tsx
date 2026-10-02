'use client';

import * as React from 'react';
import {
  Button as AriaButton,
  type ButtonProps as AriaButtonProps,
  Dialog as AriaDialog,
  Header,
  Menu,
  MenuContext,
  MenuItem,
  MenuSection,
  MenuTrigger,
  OverlayTriggerStateContext,
  type Placement,
  Popover,
  Pressable,
  Separator,
  useSlottedContext,
} from 'react-aria-components';

import { Slot, textOf } from '@/components/ui/slot';
import { cn } from '@/lib/utils';

/*
 * Radix-shaped dropdown on React Aria's MenuTrigger / Popover / Menu.
 *
 * - <DropdownMenuItem onSelect> maps to RAC `onAction`; `asChild` around a
 *   <Link href> becomes a RAC link item (client navigation via RouterProvider).
 * - <DropdownMenuContent> renders a real `role="menu"` when its children are
 *   all menu parts (items, labels, separators, groups). If it contains
 *   anything else (a status panel, a list of links, an empty-state message) it
 *   renders a non-modal popover dialog instead, so arbitrary content still
 *   works and stays keyboard reachable.
 */

interface DropdownMenuProps {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  children?: React.ReactNode;
}

function DropdownMenu({ open, defaultOpen, onOpenChange, children }: DropdownMenuProps) {
  return (
    <MenuTrigger isOpen={open} defaultOpen={defaultOpen} onOpenChange={onOpenChange}>
      {children}
    </MenuTrigger>
  );
}

type DropdownMenuTriggerProps = Omit<AriaButtonProps, 'className' | 'children'> & {
  className?: string;
  children?: React.ReactNode;
  /** Use the child (e.g. a <Button>) as the trigger. It must forward its ref and spread props. */
  asChild?: boolean;
};

const DropdownMenuTrigger = React.forwardRef<HTMLButtonElement, DropdownMenuTriggerProps>(
  ({ asChild, className, children, ...props }, ref) => {
    if (asChild && React.isValidElement(children)) {
      return (
        <Pressable>{children as React.ReactElement<React.DOMAttributes<Element>, string>}</Pressable>
      );
    }
    return (
      <AriaButton ref={ref} className={className} {...props}>
        {children}
      </AriaButton>
    );
  },
);
DropdownMenuTrigger.displayName = 'DropdownMenuTrigger';

/** True inside a DropdownMenuContent that fell back to a popover dialog. */
const PanelContext = React.createContext(false);

interface DropdownMenuContentProps {
  className?: string;
  children?: React.ReactNode;
  align?: 'start' | 'center' | 'end';
  side?: 'top' | 'bottom' | 'left' | 'right';
  sideOffset?: number;
  'aria-label'?: string;
}

function DropdownMenuContent({
  className,
  children,
  align = 'start',
  side = 'bottom',
  sideOffset = 6,
  'aria-label': ariaLabel,
}: DropdownMenuContentProps) {
  const triggerLabel = useSlottedContext(MenuContext)?.['aria-labelledby'];
  const placement = (align === 'center' ? side : `${side} ${align}`) as Placement;

  return (
    <Popover
      placement={placement}
      offset={sideOffset}
      className={cn(
        'z-50 flex min-w-[11rem] flex-col rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-overlay outline-none',
        // Enter only: a menu that closes instantly hands focus straight back to
        // its trigger, which an item's onSelect relies on (see below).
        'data-[entering]:animate-in data-[entering]:fade-in-0 data-[entering]:zoom-in-[0.98] data-[entering]:duration-fast data-[entering]:ease-standard',
        'data-[placement=bottom]:slide-in-from-top-1 data-[placement=top]:slide-in-from-bottom-1',
        className,
      )}
    >
      {isMenuContent(children) ? (
        <Menu aria-label={ariaLabel} className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden outline-none">
          {children}
        </Menu>
      ) : (
        <PanelContext.Provider value={true}>
          <AriaDialog
            aria-label={ariaLabel}
            aria-labelledby={ariaLabel ? undefined : triggerLabel}
            className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden outline-none"
          >
            {children}
          </AriaDialog>
        </PanelContext.Provider>
      )}
    </Popover>
  );
}

/**
 * Runs `fn` once the menu has closed and React Aria has restored focus to the
 * trigger (it does so in a requestAnimationFrame after unmount). A dialog
 * opened from `onSelect` then records the trigger as its focus-return target,
 * as it did with Radix, instead of the vanished menu item.
 */
function afterFocusReturns(fn: () => void) {
  requestAnimationFrame(() => requestAnimationFrame(fn));
}

function itemClasses(destructive?: boolean) {
  return cn(
    'relative flex w-full cursor-default select-none items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-foreground no-underline outline-none',
    'transition-colors duration-fast ease-standard',
    'data-[focused]:bg-accent data-[focused]:text-accent-foreground data-[hovered]:bg-accent',
    'data-[disabled]:pointer-events-none data-[disabled]:opacity-50 disabled:pointer-events-none disabled:opacity-50',
    '[&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground',
    destructive &&
      'text-danger data-[focused]:bg-danger-subtle data-[focused]:text-danger data-[hovered]:bg-danger-subtle [&_svg]:text-danger',
  );
}

interface DropdownMenuItemProps {
  className?: string;
  children?: React.ReactNode;
  /** Render the child (a <Link>) as the item; its href and children are used. */
  asChild?: boolean;
  destructive?: boolean;
  disabled?: boolean;
  /** Fires on click, Enter or Space. The menu then closes. */
  onSelect?: () => void;
  /** Type-ahead text; derived from the children when omitted. */
  textValue?: string;
}

const DropdownMenuItem = React.forwardRef<HTMLDivElement, DropdownMenuItemProps>(
  ({ className, children, asChild, destructive, disabled, onSelect, textValue }, ref) => {
    const inPanel = React.useContext(PanelContext);
    const overlay = React.useContext(OverlayTriggerStateContext);

    if (inPanel) {
      // Not inside a role="menu" — behave as a plain button or link.
      const Comp = asChild ? Slot : 'button';
      return (
        <Comp
          className={cn(itemClasses(destructive), 'hover:bg-accent', className)}
          disabled={disabled}
          onClick={() => {
            overlay?.close();
            if (onSelect) afterFocusReturns(onSelect);
          }}
        >
          {children}
        </Comp>
      );
    }

    let content = children;
    let href: string | undefined;
    let childClassName: string | undefined;
    if (asChild && React.isValidElement<{ href?: unknown; className?: string; children?: React.ReactNode }>(children)) {
      href = typeof children.props.href === 'string' ? children.props.href : undefined;
      childClassName = children.props.className;
      content = children.props.children;
    }

    return (
      <MenuItem
        ref={ref}
        href={href}
        isDisabled={disabled}
        onAction={onSelect ? () => afterFocusReturns(onSelect) : undefined}
        textValue={textValue ?? textOf(content).trim()}
        className={cn(itemClasses(destructive), childClassName, className)}
      >
        {content}
      </MenuItem>
    );
  },
);
DropdownMenuItem.displayName = 'DropdownMenuItem';

const DropdownMenuLabel = React.forwardRef<HTMLElement, React.HTMLAttributes<HTMLElement>>(
  ({ className, ...props }, ref) => (
    <Header
      ref={ref}
      // A bare <header> outside sectioning content would be a banner landmark.
      role="presentation"
      className={cn('px-2 py-1.5 text-sm font-semibold text-foreground', className)}
      {...props}
    />
  ),
);
DropdownMenuLabel.displayName = 'DropdownMenuLabel';

const DropdownMenuSeparator = ({ className }: { className?: string }) => (
  <Separator className={cn('-mx-1 my-1 h-px border-0 bg-border', className)} />
);
DropdownMenuSeparator.displayName = 'DropdownMenuSeparator';

/** Groups related items; pass `aria-label` when the group has no visible label. */
const DropdownMenuGroup = ({
  className,
  children,
  'aria-label': ariaLabel,
}: {
  className?: string;
  children?: React.ReactNode;
  'aria-label'?: string;
}) => (
  <MenuSection aria-label={ariaLabel} className={className}>
    {children}
  </MenuSection>
);
DropdownMenuGroup.displayName = 'DropdownMenuGroup';

const DropdownMenuShortcut = ({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) => (
  <span
    className={cn('ml-auto text-xs tracking-widest text-muted-foreground', className)}
    {...props}
  />
);
DropdownMenuShortcut.displayName = 'DropdownMenuShortcut';

const MENU_PARTS = new Set<unknown>([
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuGroup,
]);

function isMenuContent(children: React.ReactNode): boolean {
  return React.Children.toArray(children).every(
    (child) =>
      React.isValidElement<{ children?: React.ReactNode }>(child) &&
      (child.type === React.Fragment ? isMenuContent(child.props.children) : MENU_PARTS.has(child.type)),
  );
}

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuGroup,
};
