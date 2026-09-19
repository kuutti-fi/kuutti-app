/**
 * The accessibility baseline as constants (#12, CLAUDE.md Accessibility), so
 * components and their tests agree on one number.
 */

/** Minimum touch target edge in points. */
export const TOUCH_TARGET = 44;

/** Text follows the OS font size up to this factor; layouts must survive it. */
export const MAX_FONT_SCALE = 2;

/**
 * hitSlop that extends a control drawn smaller than the minimum target (a
 * switch, a close icon) to TOUCH_TARGET in both directions.
 */
export function hitSlopFor(width: number, height: number) {
  const horizontal = Math.max(0, Math.ceil((TOUCH_TARGET - width) / 2));
  const vertical = Math.max(0, Math.ceil((TOUCH_TARGET - height) / 2));
  return { top: vertical, bottom: vertical, left: horizontal, right: horizontal };
}
