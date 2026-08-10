/**
 * Toast display policy:
 * - Result notifications keep the default (current) duration.
 * - Messages that need user intervention stay twice as long so they are not
 *   missed while the user is working elsewhere.
 */

export const TOAST_RESULT_DURATION_MS = 4_000
export const TOAST_INTERVENTION_DURATION_MS = 8_000
