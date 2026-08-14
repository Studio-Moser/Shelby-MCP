import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import { v4 as uuidv4 } from "uuid";
import { parseJsonArray } from "./thoughts.js";

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

interface TelemetryStatements {
	loadPrevious: Database.Statement;
	insert: Database.Statement;
	previousTopIds?: string[];
}

const statementCache = new WeakMap<Database.Database, TelemetryStatements>();

function statementsFor(db: Database.Database): TelemetryStatements {
	const cached = statementCache.get(db);
	if (cached) return cached;
	const statements = {
		loadPrevious: db.prepare(
			"SELECT top_ids FROM search_telemetry ORDER BY created_at DESC, rowid DESC LIMIT 1",
		),
		insert: db.prepare(
			`INSERT INTO search_telemetry
			 (id, created_at, query_hash, mode, result_count, top_ids, rediscovery, project_identifier)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		),
	};
	statementCache.set(db, statements);
	return statements;
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
	const statements = statementsFor(db);
	if (statements.previousTopIds === undefined) {
		const previous = statements.loadPrevious.get() as
			| { top_ids: string | null }
			| undefined;
		statements.previousTopIds = parseJsonArray(previous?.top_ids ?? null);
	}
	const rediscovery = isRediscovery(input.topIds, statements.previousTopIds);
	statements.insert.run(
		uuidv4(),
		new Date().toISOString(),
		createHash("sha256").update(input.query).digest("hex"),
		input.mode,
		input.resultCount,
		JSON.stringify(input.topIds),
		rediscovery ? 1 : 0,
		input.projectIdentifier,
	);
	statements.previousTopIds = [...input.topIds];
}
