/** Walking speed mode label and speed in m/s. */
export const WALKING_MODES = [
  { id: "walk", label: "Walk", mps: 1.2 },
  { id: "brisk", label: "Brisk", mps: 1.5 },
  { id: "speedwalk", label: "Speed-walk", mps: 1.9 },
  { id: "jog", label: "Jog", mps: 2.7 },
] as const;

export type WalkingModeId = (typeof WALKING_MODES)[number]["id"];

export function getMpsForMode(id: WalkingModeId): number {
  const mode = WALKING_MODES.find((m) => m.id === id);
  return mode?.mps ?? 1.2;
}
