'use client';

import * as React from 'react';

import { buttonVariants } from '@/components/ui/button';
import {
  Dialog,
  DialogContentShell,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  useDialogState,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

/*
 * A confirmation dialog: role="alertdialog", no corner close, and clicking
 * outside does nothing — only Cancel, Escape or the action dismisses it.
 * Action/Cancel close the dialog after their onClick unless it calls
 * `event.preventDefault()` (used to keep it open while a request runs).
 */
const AlertDialog = Dialog;
const AlertDialogTrigger = DialogTrigger;
const AlertDialogHeader = DialogHeader;
const AlertDialogFooter = DialogFooter;
const AlertDialogTitle = DialogTitle;
const AlertDialogDescription = DialogDescription;

const AlertDialogContent = React.forwardRef<
  HTMLElement,
  Omit<React.ComponentProps<typeof DialogContentShell>, 'role' | 'dismissable' | 'closeButton'>
>(({ className, ...props }, ref) => (
  <DialogContentShell
    ref={ref}
    role="alertdialog"
    dismissable={false}
    closeButton={false}
    className={cn('max-w-md', className)}
    {...props}
  />
));
AlertDialogContent.displayName = 'AlertDialogContent';

function useCloseAfter(onClick: React.MouseEventHandler<HTMLButtonElement> | undefined) {
  const { setOpen } = useDialogState('AlertDialogAction');
  return (event: React.MouseEvent<HTMLButtonElement>) => {
    onClick?.(event);
    if (!event.defaultPrevented) setOpen(false);
  };
}

const AlertDialogAction = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { destructive?: boolean }
>(({ className, destructive, onClick, ...props }, ref) => (
  <button
    ref={ref}
    type="button"
    className={cn(buttonVariants({ variant: destructive ? 'destructive' : 'default' }), className)}
    onClick={useCloseAfter(onClick)}
    {...props}
  />
));
AlertDialogAction.displayName = 'AlertDialogAction';

const AlertDialogCancel = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement>
>(({ className, onClick, ...props }, ref) => (
  <button
    ref={ref}
    type="button"
    // The least destructive choice takes initial focus, as with Radix.
    autoFocus
    className={cn(buttonVariants({ variant: 'outline' }), className)}
    onClick={useCloseAfter(onClick)}
    {...props}
  />
));
AlertDialogCancel.displayName = 'AlertDialogCancel';

export {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
};
