export const MEMORY_PROTOCOL = `## Memory (ShelbyMCP)

You have persistent memory via ShelbyMCP MCP tools. Memory survives across sessions and is shared across all AI tools the user works with. You MUST use it — do not rely on conversation context alone.

### When to SAVE (mandatory)

You MUST call \`capture_thought\` after any of these events:

- **Decisions**: Architecture choices, library selections, tradeoffs considered ("We chose CloudKit over Firebase because...")
- **Preferences**: User likes/dislikes, workflow habits, coding style ("User prefers functional components over class components")
- **People & roles**: Who does what ("Sarah owns the auth service, Mike handles DevOps")
- **Project context**: Goals, deadlines, constraints, scope changes ("Launch target is March 15, blocked on API approval")
- **Bugs & fixes**: Root cause discoveries, workarounds, things that broke ("Memory leak was caused by unclosed DB connections in the edge traversal loop")
- **Architecture & patterns**: System design, data flow, conventions ("All API responses use the envelope pattern: { data, error, meta }")
- **Insights**: Non-obvious learnings, things that surprised you ("FTS5 porter tokenizer handles plurals but not acronyms")

Always include: a \`summary\` (one-line, <100 chars), a \`type\`, relevant \`topics\`, and link to \`related_to\` thoughts when applicable.

### When to SEARCH (mandatory)

You MUST call \`search_thoughts\` or \`list_thoughts\` before:

- **Starting work on any task** — check what's already known about this area
- **Making a decision** — check for prior decisions on the same topic
- **When something feels familiar** — it probably is; search for it
- **After context compaction** — immediately search to recover session context
- **When the user says** "remember", "recall", "what do we know about", "what did we decide"

### What NOT to save

- Ephemeral debugging output (stack traces, log lines you're actively reading)
- Code content that's already in git (save the *decision* about code, not the code itself)
- Transient conversation ("let me think about this..." — save the conclusion, not the process)
- Duplicate information — search first, update existing thoughts instead of creating new ones

### How to save well

1. **Summary first.** Search results only show summaries. A thought without a summary is invisible to search.
2. **Type accurately.** Use \`decision\`, \`task\`, \`question\`, \`reference\`, \`insight\`, or \`note\`. Don't default everything to \`note\`.
3. **Tag topics and people.** These are the primary filters for \`list_thoughts\`.
4. **Link related thoughts.** Use \`manage_edges\` to connect decisions to the tasks they affect, references to the insights they support.
5. **Update, don't duplicate.** If a thought exists but is outdated, use \`update_thought\`. Don't create a new one.`;

export function printProtocol(): void {
  // Only show the hint when output is going to a terminal (not piped to a file)
  if (process.stdout.isTTY) {
    console.error(
      "Copy the output below and paste it into your agent's rules file.\n" +
      "Or pipe directly: shelbymcp protocol >> CLAUDE.md\n"
    );
  }
  console.log(MEMORY_PROTOCOL);
}
