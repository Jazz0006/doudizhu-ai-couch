export const COACH_STYLES = ["direct", "warm", "analytical"] as const;

export type CoachStyle = (typeof COACH_STYLES)[number];

export const DEFAULT_COACH_STYLE: CoachStyle = "direct";

export function parseCoachStyle(value: unknown): CoachStyle | null {
  return typeof value === "string" &&
    (COACH_STYLES as readonly string[]).includes(value)
    ? (value as CoachStyle)
    : null;
}
