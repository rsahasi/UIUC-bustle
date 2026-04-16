import type { CrowdingLevel, CrowdingInfo } from "@/src/api/types";

export const CROWDING_COLORS: Record<CrowdingLevel, string> = {
  1: "#4CAF50",
  2: "#FF9800",
  3: "#FF5722",
  4: "#F44336",
};
export const CROWDING_ESTIMATED_COLOR = "#9E9E9E";

export const CROWDING_LABELS: Record<CrowdingLevel, string> = {
  1: "Empty",
  2: "Some seats",
  3: "Standing",
  4: "Full",
};

export const CROWDING_ICONS: Record<CrowdingLevel, string> = {
  1: "🟢",
  2: "🟡",
  3: "🟠",
  4: "🔴",
};

export function crowdingColor(info: CrowdingInfo | null | undefined): string {
  if (!info) return CROWDING_ESTIMATED_COLOR;
  if (info.source === "estimated") return CROWDING_ESTIMATED_COLOR;
  return CROWDING_COLORS[info.level] ?? CROWDING_ESTIMATED_COLOR;
}

export function crowdingLabel(info: CrowdingInfo | null | undefined): string {
  if (!info) return "No data";
  return CROWDING_LABELS[info.level] ?? "Unknown";
}

export function crowdingSourceLabel(info: CrowdingInfo): string {
  if (info.source === "crowdsourced") {
    return `Based on ${info.report_count} recent report${info.report_count === 1 ? "" : "s"}`;
  }
  return "Estimated based on schedule";
}
