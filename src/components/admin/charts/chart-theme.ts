/**
 * Chart palette and chrome, tuned to the "Quiet Authority" system.
 *
 * Every mark colour clears 3:1 against the white chart surface (`--card`,
 * #ffffff) as WCAG 1.4.11 requires for graphics, and every text colour clears
 * 4.5:1. Colour-vision checks used Machado (2009) simulation at full severity
 * and CIE76 ΔE; do not substitute hues by eye — re-validate first.
 *
 * Roles, not decoration:
 *  - `series` is the single-series hue used wherever one measure is plotted.
 *  - `ordinal` is a one-hue light→dark ramp for ordered categories (difficulty).
 *  - `accent` is the second categorical slot, reserved for a genuine second
 *    series. It is never used to brighten a chart.
 */
// Values live in globals.css (`--chart-*`, light and dark); light-mode ratios
// below are against the white card.
export const CHART = {
  /** Oxford ink, a step brighter than the primary so bars read as data. 6.9:1. */
  series: 'var(--chart-series)',
  /** Burnt orange — blue/orange survives every CVD type (ΔE ≥ 80). 4.7:1. */
  accent: 'var(--chart-accent)',
  /**
   * Reserved status red, used only where a value genuinely means "bad" — the
   * failing grade band, and nothing else. Emphasis pair against `series`:
   * ΔE 64 protanopia, 84 deuteranopia, 102 tritanopia. 6.5:1. It is never a
   * second series.
   */
  critical: 'var(--chart-critical)',
  /**
   * Easy → Medium → Hard. Monotone lightness, single hue; adjacent steps
   * ΔE ≥ 20 under every CVD simulation. 3.3:1, 7.0:1, 13.7:1.
   */
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
