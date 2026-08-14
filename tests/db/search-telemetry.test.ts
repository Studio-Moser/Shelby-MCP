import { describe, expect, it } from "vitest";
import { isRediscovery } from "../../src/db/search-telemetry.js";

describe("isRediscovery", () => {
	it("requires more than half of the prior top ids to overlap", () => {
		expect(isRediscovery(["a", "b", "c"], ["a", "b", "x"])).toBe(true);
		expect(isRediscovery(["a", "b"], ["a", "x"])).toBe(false);
		expect(isRediscovery([], [])).toBe(false);
	});
});
