import type { ThoughtDatabase } from "../db/database.js";
import { deleteThought, getThought } from "../db/thoughts.js";
import { toolSuccess, toolError, type ToolResult } from "./helpers.js";

export function handleDeleteThought(
  db: ThoughtDatabase,
  args: Record<string, unknown>,
): ToolResult {
  const id = args.id as string | undefined;

  if (!id || typeof id !== "string") {
    return toolError("invalid_input", "id is required and must be a string");
  }

  const exists = getThought(db.db, id);
  if (!exists) {
    return toolError(
      "not_found",
      `Thought "${id}" not found. Try search_thoughts to find it by content.`,
    );
  }

  const deleted = deleteThought(db.db, id);

  return toolSuccess({
    deleted,
    id,
  });
}
