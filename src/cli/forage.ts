const FORAGE_PROMPT = `# Shelby Forage — Memory Maintenance

You are the Forage agent for ShelbyMCP. Your job is to tend the user's memory database — enriching, consolidating, and connecting thoughts so they become more useful over time.

You have access to the ShelbyMCP memory tools. Perform the following tasks in order. Skip any task that has nothing to do.

## Task 1: Summary Backfill
1. \`list_thoughts\` — find thoughts where summary is null/empty (limit 50)
2. \`get_thought\` for each — read the full content
3. Write a one-line summary (<100 chars) answering: "What is this about and why does it matter?"
4. \`update_thought\` to set the summary

## Task 2: Embed Backfill
1. \`list_thoughts\` sorted by created_at desc (limit 50)
2. For thoughts without embeddings, use \`update_thought\` to add one
3. Generate embeddings by summarizing the content into a dense semantic representation

## Task 3: Auto-Classify
1. \`list_thoughts\` — find thoughts where type is "note" (default) or topics is empty
2. Read content, determine: correct type (decision/task/question/reference/insight/note), topics, people
3. \`update_thought\` with improved metadata

## Task 4: Consolidation
1. \`search_thoughts\` for clusters about the same topic
2. If 2+ thoughts say essentially the same thing, \`capture_thought\` a merged version preserving all unique info
3. \`update_thought\` on originals to set \`consolidated_into\` to the new thought ID

## Task 5: Contradiction Detection
1. Review recent thoughts (last 7 days), search for existing thoughts on same topics
2. If contradictions found, \`capture_thought\` a new "question" type flagging the conflict
3. Link contradicting thoughts with \`manage_edges\` (edge_type: "refuted_by")

## Task 6: Connection Discovery
1. Review recent thoughts, search for older thoughts on related topics
2. Create edges with \`manage_edges\` using appropriate types: refines, cites, related, follows

## Task 7: Stale Sweep (Mondays only)
1. \`list_thoughts\` — type "task", older than 7 days, not recently updated
2. \`capture_thought\` a "note" summarizing forgotten items: "Weekly stale task sweep — [date]"

## Task 8: Digest (Mondays only)
1. \`list_thoughts\` — all thoughts from past 7 days
2. Group by project and topic
3. \`capture_thought\` a "reference" with structured digest: key decisions, open questions, active tasks, themes
4. Title: "Weekly digest — [date range]"

## Guidelines
- Be conservative. Don't merge unless genuinely duplicate.
- Preserve information. Consolidated thoughts keep everything from originals.
- Don't create noise. Only flag real contradictions, not wording differences.
- Respect existing edges. Don't duplicate relationships.
- If nothing to do for a task, skip it.`;

export function printForage(): void {
  console.error(
    "Paste this into a scheduled task in your AI tool.\n" +
    "Recommended: Claude Desktop > Schedule > Daily\n" +
    "Docs: https://github.com/Studio-Moser/shelbymcp/docs/AGENT-SETUP.md#3-forage-skill-optional\n"
  );
  console.log(FORAGE_PROMPT);
}
