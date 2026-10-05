/**
 * Chart colours. Values live in globals.css (`--chart-*`, light and dark); every
 * mark is at least 3:1 against the card.
 *  - `series`: the one hue used when a single measure is plotted.
 *  - `accent`: a second series only (blue/orange stays distinct for colour-blind readers).
 *  - `critical`: the failing grade band, nothing else.
 *  - `ordinal`: Easy → Medium → Hard, light to dark in one hue.
 */
export const CHART = {
  series: 'var(--chart-series)',
  accent: 'var(--chart-accent)',
  critical: 'var(--chart-critical)',
  ordinal: ['var(--chart-ordinal-1)', 'var(--chart-ordinal-2)', 'var(--chart-ordinal-3)'],
  grid: 'hsl(var(--border))',
  axis: 'hsl(var(--input))',
  /** Tick and legend text. */
  muted: 'hsl(var(--muted-foreground))',
  ink: 'hsl(var(--foreground))',
  surface: 'hsl(var(--card))',
} as const;

export const DIFFICULTY_COLOR: Record<string, string> = {
  EASY: CHART.ordinal[0],
  MEDIUM: CHART.ordinal[1],
  HARD: CHART.ordinal[2],
};

/** Shared axis styling so every chart in the console reads as one system. */
export const axisProps = {
  stroke: CHART.axis,
  tick: { fill: CHART.muted, fontSize: 11 },
  tickLine: false,
  axisLine: { stroke: CHART.axis },
} as const;

export const gridProps = {
  stroke: CHART.grid,
  strokeDasharray: '0',
  vertical: false,
} as const;
