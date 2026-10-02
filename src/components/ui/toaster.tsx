'use client';

import { Toaster as SonnerToaster } from 'sonner';

/**
 * Toast host. Colours map to the same semantic palette as the rest of the app:
 * green confirms, amber warns, red alerts — shown as a left rule and icon
 * colour on a white sheet, never a full colour fill.
 */
export function Toaster() {
  return (
    <SonnerToaster
      position="top-right"
      closeButton
      richColors={false}
      toastOptions={{
        classNames: {
          toast:
            'group !rounded-lg !border !border-border !bg-popover !text-popover-foreground !shadow-overlay !font-sans text-sm',
          title: '!font-medium !text-foreground',
          description: '!text-muted-foreground text-[0.8125rem] leading-relaxed',
          actionButton: '!bg-primary !text-primary-foreground !rounded-md !text-xs !px-2.5 !py-1',
          cancelButton: '!bg-muted !text-muted-foreground !rounded-md !text-xs !px-2.5 !py-1',
          closeButton: '!border-border !bg-popover !text-muted-foreground hover:!text-foreground',
          success: '!border-l-[3px] !border-l-success [&_[data-icon]]:text-success',
          warning: '!border-l-[3px] !border-l-warning [&_[data-icon]]:text-warning',
          error: '!border-l-[3px] !border-l-danger [&_[data-icon]]:text-danger',
          info: '!border-l-[3px] !border-l-primary [&_[data-icon]]:text-primary',
        },
      }}
    />
  );
}
