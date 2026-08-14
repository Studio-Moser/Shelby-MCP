import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import { v4 as uuidv4 } from "uuid";

export type SearchMode = "fts" | "vector" | "hybrid";

export function isRediscovery(
	currentTopIds: string[],
	previousTopIds: string[],
): boolean {
	const previous = new Set(previousTopIds);
	if (previous.size === 0) return false;
	const overlap = new Set(currentTopIds.filter((id) => previous.has(id))).size;
	return overlap / previous.size > 0.5;
}

function parseTopIds(raw: string | undefined): string[] {
	if (!raw) return [];
	try {
		const value: unknown = JSON.parse(raw);
		return Array.isArray(value)
			? value.filter((id): id is string => typeof id === "string")
			: [];
	} catch {
		return [];
	}
}

export function recordSearchTelemetry(
	db: Database.Database,
	input: {
		query: string;
		mode: SearchMode;
		resultCount: number;
		topIds: string[];
		projectIdentifier: string | null;
	},
): void {
	const previous = db.prepare(
		"SELECT top_ids FROM search_telemetry ORDER BY created_at DESC, rowid DESC LIMIT 1",
	).get() as { top_ids: string } | undefined;
	const rediscovery = isRediscovery(input.topIds, parseTopIds(previous?.top_ids));
	db.prepare(
		`INSERT INTO search_telemetry
		 (id, created_at, query_hash, mode, result_count, top_ids, rediscovery, project_identifier)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
	).run(
		uuidv4(),
		new Date().toISOString(),
		createHash("sha256").update(input.query).digest("hex"),
		input.mode,
		input.resultCount,
		JSON.stringify(input.topIds),
		rediscovery ? 1 : 0,
		input.projectIdentifier,
	);
}
