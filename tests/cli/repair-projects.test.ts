import { describe, it, expect } from "vitest";
import { formatRepairReport } from "../../src/cli/repair-projects.js";

describe("formatRepairReport", () => {
  const report = {
    scanned: 5,
    highConfidence: [
      { id: "a", suggestedSlug: "shelby", confidence: "high" as const, reason: "distinctive topic → shelby" },
      { id: "b", suggestedSlug: "kuow-games", confidence: "high" as const, reason: "distinctive topic → kuow-games" },
    ],
    flagged: [{ id: "c", suggestedSlug: null, confidence: "low" as const, reason: "no distinctive signal" }],
    applied: 0,
  };
  it("dry-run summary names counts + per-slug breakdown and says nothing was written", () => {
    const out = formatRepairReport(report, false);
    expect(out).toContain("DRY RUN");
    expect(out).toContain("2 high-confidence");
    expect(out).toContain("1 flagged");
    expect(out).toContain("shelby");
    expect(out).toContain("kuow-games");
    expect(out).toMatch(/--apply/);
  });
  it("apply summary reports what was written", () => {
    const out = formatRepairReport({ ...report, applied: 2 }, true);
    expect(out).toContain("APPLIED");
    expect(out).toContain("2");
    expect(out).toContain("1 flagged for review");
  });
});
