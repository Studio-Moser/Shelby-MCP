import { describe, expect, it } from "vitest";
import { reconcile } from "../../src/db/reconciliation.js";

describe("reconcile", () => {
	it("applies the 0.9 noop, 0.8 edge, and 0.3 suggestion thresholds", () => {
		const candidates = [
			{ id: "noop", content: "alpha bravo charlie delta echo", type: "note" },
			{ id: "edge", content: "alpha bravo charlie delta foxtrot", type: "note" },
			{ id: "suggest", content: "alpha bravo charlie golf", type: "note" },
		];

		expect(reconcile("alpha bravo charlie delta echo", "note", candidates)).toEqual({
			action: "noop",
			existingId: "noop",
			suggestedEdges: [],
		});
		expect(reconcile("alpha bravo charlie delta", "note", candidates.slice(1))).toEqual({
			action: "add",
			suggestedEdges: [
				{ id: "edge", similarity: 0.8, autoApply: true },
				{ id: "suggest", similarity: 0.6, autoApply: false },
			],
		});
	});

	it("does not reconcile inputs or candidates with fewer than four tokens", () => {
		expect(reconcile("alpha bravo charlie", "note", [
			{ id: "short", content: "alpha bravo charlie", type: "note" },
		])).toEqual({ action: "add", suggestedEdges: [] });
	});

	it("suggests an edge for a cross-type match without treating it as a NOOP", () => {
		expect(reconcile("alpha bravo charlie delta", "note", [
			{ id: "decision", content: "alpha bravo charlie delta", type: "decision" },
		])).toEqual({
			action: "add",
			suggestedEdges: [
				{ id: "decision", similarity: 1, autoApply: true },
			],
		});
	});
});
