import {
  crowdingColor,
  crowdingLabel,
  crowdingSourceLabel,
  CROWDING_COLORS,
  CROWDING_ESTIMATED_COLOR,
} from "@/src/utils/crowding";
import type { CrowdingInfo } from "@/src/api/types";

const crowdsourced = (level: number, report_count = 3): CrowdingInfo =>
  ({ level, source: "crowdsourced", report_count } as CrowdingInfo);

describe("crowdingColor", () => {
  it("uses the estimated color for null/estimated", () => {
    expect(crowdingColor(null)).toBe(CROWDING_ESTIMATED_COLOR);
    expect(crowdingColor({ level: 2, source: "estimated" } as CrowdingInfo)).toBe(
      CROWDING_ESTIMATED_COLOR
    );
  });

  it("maps crowdsourced levels to their color", () => {
    expect(crowdingColor(crowdsourced(1))).toBe(CROWDING_COLORS[1]);
    expect(crowdingColor(crowdsourced(4))).toBe(CROWDING_COLORS[4]);
  });
});

describe("crowdingLabel", () => {
  it("returns 'No data' when info is missing", () => {
    expect(crowdingLabel(null)).toBe("No data");
  });

  it("labels known levels", () => {
    expect(crowdingLabel(crowdsourced(1))).toBe("Empty");
    expect(crowdingLabel(crowdsourced(3))).toBe("Standing");
  });
});

describe("crowdingSourceLabel", () => {
  it("singularizes a single report", () => {
    expect(crowdingSourceLabel(crowdsourced(2, 1))).toBe("Based on 1 recent report");
  });

  it("pluralizes multiple reports", () => {
    expect(crowdingSourceLabel(crowdsourced(2, 5))).toBe("Based on 5 recent reports");
  });

  it("describes estimated source", () => {
    expect(crowdingSourceLabel({ level: 2, source: "estimated" } as CrowdingInfo)).toBe(
      "Estimated based on schedule"
    );
  });
});
