import * as React from 'react';

import { cn } from '@/lib/utils';

type AnyProps = Record<string, unknown>;

function mergeRefs<T>(...refs: Array<React.Ref<T> | undefined>): React.RefCallback<T> {
  return (node) => {
    for (const ref of refs) {
      if (typeof ref === 'function') ref(node);
      else if (ref) (ref as React.MutableRefObject<T | null>).current = node;
    }
  };
}

/**
 * Renders its only child with the slot's props merged in — the `asChild`
 * pattern. Child props win, except: `className` is joined, `style` is merged,
 * and event handlers run child-first then slot (the slot's handler is skipped
 * if the child called `preventDefault`).
 */
export const Slot = React.forwardRef<HTMLElement, AnyProps & { children?: React.ReactNode }>(
  ({ children, ...slotProps }, ref) => {
    if (!React.isValidElement<AnyProps>(children)) return null;
    const childProps = children.props;
    const merged: AnyProps = { ...slotProps, ...childProps };

    for (const key of Object.keys(slotProps)) {
      const slotValue = slotProps[key];
      const childValue = childProps[key];
      if (/^on[A-Z]/.test(key) && typeof slotValue === 'function' && typeof childValue === 'function') {
        merged[key] = (...args: unknown[]) => {
          childValue(...args);
          const event = args[0] as { defaultPrevented?: boolean } | undefined;
          if (!event?.defaultPrevented) slotValue(...args);
        };
      } else if (key === 'className') {
        merged.className = cn(slotValue as string, childValue as string);
      } else if (key === 'style') {
        merged.style = { ...(slotValue as object), ...(childValue as object) };
      }
    }

    // Only attach a ref when one exists: in a Server Component a function ref on
    // a client child (e.g. next/link) cannot be serialised and crashes the render.
    const childRef = childProps.ref as React.Ref<HTMLElement> | undefined;
    if (ref && childRef) merged.ref = mergeRefs(ref, childRef);
    else if (ref || childRef) merged.ref = ref ?? childRef;
    return React.cloneElement(children, merged);
  },
);
Slot.displayName = 'Slot';

/** Plain text of a React node — used as `textValue` for type-ahead in menus and lists. */
export function textOf(node: React.ReactNode): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (React.isValidElement<{ children?: React.ReactNode }>(node)) return textOf(node.props.children);
  return '';
}
