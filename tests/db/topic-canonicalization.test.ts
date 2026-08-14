import { describe, expect, it } from "vitest";
import {
	canonicalizeTopic,
	canonicalizeTopics,
} from "../../src/db/topic-canonicalization.js";

describe("topic canonicalization", () => {
	it.each([
		[" Knowledge Graph ", "knowledge-graph"],
		["knowledge_graph", "knowledge-graph"],
		["knowledge---  __graph", "knowledge-graph"],
	])("canonicalizes %j to %j", (input, expected) => {
		expect(canonicalizeTopic(input)).toBe(expected);
	});

	it("deduplicates in first-seen order and removes empty topics", () => {
		expect(canonicalizeTopics([
			" Knowledge Graph ",
			"API Design",
			"knowledge_graph",
			"  ",
		])).toEqual(["knowledge-graph", "api-design"]);
	});
});
