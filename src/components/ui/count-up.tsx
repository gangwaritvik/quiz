'use client';

import { animate, useReducedMotion } from 'framer-motion';
import * as React from 'react';

const NUMBER = /^(-?\d+(?:\.\d+)?)(.*)$/s;

/**
 * Counts a figure up to its value, once on arrival and again when it changes.
 * Text that does not start with a number ("—", "N/A") is shown as is. Screen
 * readers get the final figure at once, never the frames in between.
 */
export function CountUp({ value, duration = 0.8 }: { value: number | string; duration?: number }) {
  const text = String(value);
  const match = NUMBER.exec(text);
  const target = match ? Number(match[1]) : 0;
  const decimals = match?.[1].split('.')[1]?.length ?? 0;
  const suffix = match?.[2] ?? '';

  const reduceMotion = useReducedMotion();
  const [shown, setShown] = React.useState(0);
  const from = React.useRef(0);

  React.useEffect(() => {
    if (!match) return;
    if (reduceMotion) {
      from.current = target;
      setShown(target);
      return;
    }
    const controls = animate(from.current, target, {
      duration,
      ease: [0.2, 0, 0, 1],
      onUpdate: (latest) => {
        from.current = latest;
        setShown(latest);
      },
    });
    return () => controls.stop();
    // `match` is derived from `target`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, reduceMotion, duration]);

  if (!match) return <>{text}</>;

  return (
    <>
      <span className="sr-only">{text}</span>
      <span aria-hidden>
        {shown.toFixed(decimals)}
        {suffix}
      </span>
    </>
  );
}
