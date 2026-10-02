'use client';

import { X } from 'lucide-react';
import * as React from 'react';
import {
  Button as AriaButton,
  Dialog as AriaDialog,
  type DialogProps as AriaDialogProps,
  Heading,
  Modal,
  ModalOverlay,
} from 'react-aria-components';

import { Slot } from '@/components/ui/slot';
import { cn } from '@/lib/utils';

/*
 * Radix-shaped API on React Aria. <Dialog open onOpenChange> owns the state;
 * <DialogContent> renders RAC's ModalOverlay > Modal > Dialog, which provides
 * the focus trap, Escape / outside-click dismissal, scroll lock, inert
 * background and focus return. Leaving `onOpenChange` undefined while `open`
 * is set makes the dialog impossible to dismiss — call sites use that while
 * saving, exactly as with Radix.
 */

interface DialogState {
  open: boolean;
  setOpen: (open: boolean) => void;
}

const DialogStateContext = React.createContext<DialogState | null>(null);

function useDialogState(component: string) {
  const state = React.useContext(DialogStateContext);
  if (!state) throw new Error(`<${component}> must be used inside <Dialog> or <AlertDialog>.`);
  return state;
}

interface DialogProps {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  children?: React.ReactNode;
}

function Dialog({ open, defaultOpen = false, onOpenChange, children }: DialogProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(defaultOpen);
  const controlled = open !== undefined;

  const setOpen = React.useCallback(
    (next: boolean) => {
      if (!controlled) setUncontrolledOpen(next);
      onOpenChange?.(next);
    },
    [controlled, onOpenChange],
  );

  const value = React.useMemo(
    () => ({ open: controlled ? open : uncontrolledOpen, setOpen }),
    [controlled, open, uncontrolledOpen, setOpen],
  );

  return <DialogStateContext.Provider value={value}>{children}</DialogStateContext.Provider>;
}

type TriggerProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { asChild?: boolean };

const DialogTrigger = React.forwardRef<HTMLButtonElement, TriggerProps>(
  ({ asChild, onClick, ...props }, ref) => {
    const { open, setOpen } = useDialogState('DialogTrigger');
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        ref={ref}
        type={asChild ? undefined : 'button'}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={(event: React.MouseEvent<HTMLButtonElement>) => {
          onClick?.(event);
          if (!event.defaultPrevented) setOpen(true);
        }}
        {...props}
      />
    );
  },
);
DialogTrigger.displayName = 'DialogTrigger';

const DialogClose = React.forwardRef<HTMLButtonElement, TriggerProps>(
  ({ asChild, onClick, ...props }, ref) => {
    const { setOpen } = useDialogState('DialogClose');
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        ref={ref}
        type={asChild ? undefined : 'button'}
        onClick={(event: React.MouseEvent<HTMLButtonElement>) => {
          onClick?.(event);
          if (!event.defaultPrevented) setOpen(false);
        }}
        {...props}
      />
    );
  },
);
DialogClose.displayName = 'DialogClose';

/** Shared overlay + panel styling; AlertDialog uses the same surface. */
const overlayBase =
  'group/overlay fixed inset-0 z-50 flex min-h-full items-center justify-center overflow-y-auto bg-navy-950/40 p-4 backdrop-blur-[2px]';
const overlayClasses = cn(
  overlayBase,
  'data-[entering]:animate-in data-[entering]:fade-in-0 data-[entering]:duration-base data-[entering]:ease-standard',
  'data-[exiting]:animate-out data-[exiting]:fade-out-0 data-[exiting]:duration-fast data-[exiting]:ease-standard',
);

// `contents`: the Modal adds no box, so the panel is the only thing that
// counts as "inside" — a click anywhere on the backdrop dismisses.
const modalClasses = 'contents';

// A flex column, not a grid: a sticky footer cannot move inside a grid item's
// own row, so with a grid the Save button scrolled away with the content.
// The panel scrolls itself once it reaches the screen height.
const panelBase =
  'relative flex max-h-[calc(100dvh-2rem)] w-full max-w-xl flex-col gap-5 overflow-y-auto rounded-lg border border-border bg-card p-6 text-card-foreground shadow-overlay outline-none sm:p-7';
const panelClasses = cn(
  panelBase,
  // Rides the overlay's enter animation: a small rise while the backdrop fades in.
  'group-data-[entering]/overlay:animate-in group-data-[entering]/overlay:zoom-in-[0.98] group-data-[entering]/overlay:slide-in-from-bottom-2',
  'group-data-[entering]/overlay:duration-base group-data-[entering]/overlay:ease-standard',
);

type PanelProps = Omit<AriaDialogProps, 'role' | 'children'> & { children?: React.ReactNode };

interface DialogContentProps extends PanelProps {
  /** Hides the corner close button (e.g. while a submission is in flight). */
  hideClose?: boolean;
  /** No enter/exit animation — the exam surface must stay still. */
  still?: boolean;
}

interface ContentShellProps extends PanelProps {
  role: 'dialog' | 'alertdialog';
  dismissable: boolean;
  closeButton: boolean;
  still?: boolean;
}

/** Lets <DialogDescription> announce itself so the panel can point aria-describedby at it. */
const DescriptionContext = React.createContext<{
  id: string;
  setPresent: (present: boolean) => void;
} | null>(null);

const ContentShell = React.forwardRef<HTMLElement, ContentShellProps>(
  ({ className, children, role, dismissable, closeButton, still, ...props }, ref) => {
    const { open, setOpen } = useDialogState('DialogContent');
    const descriptionId = React.useId();
    const [described, setDescribed] = React.useState(false);
    const description = React.useMemo(() => ({ id: descriptionId, setPresent: setDescribed }), [descriptionId]);
    return (
      <ModalOverlay
        isOpen={open}
        onOpenChange={setOpen}
        isDismissable={dismissable}
        className={still ? overlayBase : overlayClasses}
      >
        <Modal className={modalClasses}>
          <AriaDialog
            ref={ref}
            role={role}
            aria-describedby={described ? descriptionId : undefined}
            className={cn(still ? panelBase : panelClasses, className)}
            {...props}
          >
            <DescriptionContext.Provider value={description}>{children}</DescriptionContext.Provider>
            {closeButton ? (
              <AriaButton
                slot="close"
                aria-label="Close"
                className="absolute right-3 top-3 inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors duration-fast hover:bg-muted hover:text-foreground"
              >
                <X className="size-4" aria-hidden />
              </AriaButton>
            ) : null}
          </AriaDialog>
        </Modal>
      </ModalOverlay>
    );
  },
);
ContentShell.displayName = 'ContentShell';

const DialogContent = React.forwardRef<HTMLElement, DialogContentProps>(
  ({ hideClose, ...props }, ref) => (
    <ContentShell ref={ref} role="dialog" dismissable closeButton={!hideClose} {...props} />
  ),
);
DialogContent.displayName = 'DialogContent';

const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('flex flex-col gap-1.5 pr-8 text-left', className)} {...props} />
);
DialogHeader.displayName = 'DialogHeader';

const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  // Pinned to the bottom edge of the panel, so the actions stay in reach however
  // long the content is. Negative margins undo the panel's padding.
  <div
    className={cn(
      'sticky -bottom-6 z-10 sm:-bottom-7 -mx-6 -mb-6 flex flex-col-reverse gap-2 border-t border-border bg-card px-6 py-4 sm:-mx-7 sm:-mb-7 sm:flex-row sm:justify-end sm:px-7',
      className,
    )}
    {...props}
  />
);
DialogFooter.displayName = 'DialogFooter';

/** Names the dialog (RAC wires aria-labelledby through the `title` slot). */
const DialogTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <Heading
      ref={ref}
      slot="title"
      className={cn('font-serif text-xl font-semibold leading-snug text-foreground', className)}
      {...props}
    />
  ),
);
DialogTitle.displayName = 'DialogTitle';

/** Describes the dialog: the panel's aria-describedby points here while it is mounted. */
const DialogDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => {
  const description = React.useContext(DescriptionContext);
  React.useEffect(() => {
    description?.setPresent(true);
    return () => description?.setPresent(false);
  }, [description]);
  return (
    <p
      ref={ref}
      id={description?.id}
      className={cn('text-sm leading-relaxed text-muted-foreground', className)}
      {...props}
    />
  );
});
DialogDescription.displayName = 'DialogDescription';

export {
  Dialog,
  DialogClose,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
  // Internal building blocks shared with alert-dialog.tsx.
  ContentShell as DialogContentShell,
  useDialogState,
};
