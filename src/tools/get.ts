import type { ThoughtDatabase } from "../db/database.js";
import { getThought, incrementReinforcement } from "../db/thoughts.js";
import { toolSuccess, toolError, type ToolResult } from "./helpers.js";

export function handleGetThought(
  db: ThoughtDatabase,
  args: Record<string, unknown>,
): ToolResult {
  const id = args.id as string | undefined;

  if (!id || typeof id !== "string") {
    return toolError("invalid_input", "id is required and must be a string");
  }

	let thought = getThought(db.db, id);
  if (!thought) {
    return toolError("not_found", `Thought "${id}" not found`);
  }

	try {
		if (incrementReinforcement(db.db, id, 1, false)) {
			thought = getThought(db.db, id) ?? thought;
		}
	} catch {
		// Reinforcement is best-effort and must never prevent a successful read.
	}

  // Strip embedding buffer from response (binary data isn't useful in JSON)
  const { embedding, ...rest } = thought;
  return toolSuccess({
    ...rest,
    has_embedding: embedding !== null,
  });
}
