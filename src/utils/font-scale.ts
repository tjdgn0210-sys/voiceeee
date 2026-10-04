/**
 * Font-size scaling (blueprint 10.2, README 6.4). Pure helpers: the screens read the scale from context.
 * Text uses the full scale; spacing and icons use half of it; touch targets never fall below 44.
 */

export const FONT_SCALE_MIN = 0.7;
export const FONT_SCALE_MAX = 2.0;
export const FONT_SCALE_DEFAULT = 1.0;
export const FONT_SCALE_STEP = 0.1;
export const MIN_TOUCH_TARGET = 44;

/** Snaps to the 10% grid (70, 80 ... 200%) and keeps the value inside the range. */
export function clampFontScale(value: number): number {
  if (!Number.isFinite(value)) return FONT_SCALE_DEFAULT;
  const steps = Math.round(value / FONT_SCALE_STEP);
  const snapped = Math.round(steps * FONT_SCALE_STEP * 10) / 10;
  return Math.min(FONT_SCALE_MAX, Math.max(FONT_SCALE_MIN, snapped));
}

/** The scale in effect: the system's when "follow system" is on (never multiplied with the app's), else the app's. */
export function effectiveFontScale(input: { fontScale: number; followSystemFont: boolean; systemScale: number }): number {
  return input.followSystemFont ? clampFontScale(input.systemScale) : clampFontScale(input.fontScale);
}

export function scaleFont(px: number, scale: number): number {
  return Math.round(px * scale);
}

/** Line height is 1.5 times the scaled font size. */
export function scaleLineHeight(px: number, scale: number): number {
  return Math.round(scaleFont(px, scale) * 1.5);
}

/** Spacing and icons move by half of the scale: 200% gives x1.5, 70% gives x0.85. */
export function scaleSpace(px: number, scale: number): number {
  return Math.round(px * (1 + (scale - 1) * 0.5));
}

export const scaleIcon = scaleSpace;

/** Touch targets are at least 44, and grow with the space scale. */
export function touchTarget(scale: number): number {
  return Math.max(MIN_TOUCH_TARGET, scaleSpace(MIN_TOUCH_TARGET, scale));
}

/** The 14 selectable values: 0.7, 0.8 ... 2.0. */
export function fontScaleSteps(): number[] {
  const steps: number[] = [];
  for (let value = FONT_SCALE_MIN; value <= FONT_SCALE_MAX + 1e-9; value += FONT_SCALE_STEP) steps.push(clampFontScale(value));
  return steps;
}

/** All helpers bound to one scale, so a style factory takes a single argument. */
export type Scaler = {
  scale: number;
  font(px: number): number;
  line(px: number): number;
  space(px: number): number;
  icon(px: number): number;
  /** Minimum touch target height: 44, or more when spacing grows. */
  touch: number;
};

export function createScaler(scale: number): Scaler {
  return {
    scale,
    font: px => scaleFont(px, scale),
    line: px => scaleLineHeight(px, scale),
    space: px => scaleSpace(px, scale),
    icon: px => scaleIcon(px, scale),
    touch: touchTarget(scale),
  };
}

export const DEFAULT_SCALER = createScaler(FONT_SCALE_DEFAULT);
