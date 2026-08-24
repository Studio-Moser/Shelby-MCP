//! The three MCP prompts that teach agents how to use the server (verbatim from the TS server).
pub struct PromptDef {
    pub name: &'static str,
    pub title: &'static str,
    pub description: &'static str,
    pub text: &'static str,
}

pub const PROMPTS: [PromptDef; 3] = [
    PromptDef {
        name: "memory-protocol",
        title: "Memory Protocol",
        description: "Core rules for when and how to use ShelbyMCP. Read this at the start of every session.",
        text: r#"# ShelbyMCP — Memory Protocol

You have persistent memory via ShelbyMCP tools. Memory survives across sessions and is shared across all AI tools the user works with. You MUST use it — do not rely on conversation context alone.

## When to SAVE (mandatory)

Call `capture_thought` after any of these events:

- **Decisions**: Architecture choices, library selections, tradeoffs
- **Preferences**: User likes/dislikes, workflow habits, coding style
- **People & roles**: Who does what
- **Project context**: Goals, deadlines, constraints, scope changes
- **Bugs & fixes**: Root cause discoveries, workarounds
- **Architecture & patterns**: System design, data flow, conventions
- **Insights**: Non-obvious learnings, things that surprised you

Always include: a `summary` (one-line, <100 chars), a `type`, relevant `topics`, and link to `related_to` thoughts when applicable.

## When to SEARCH (mandatory)

Call `search_thoughts` or `list_thoughts` before:

- Starting work on any task
- Making a decision — check for prior decisions on the same topic
- When something feels familiar — it probably is
- After context compaction — immediately search to recover session context
- When the user says "remember", "recall", "what do we know about", "what did we decide"

## What NOT to save

- Ephemeral debugging output (stack traces, log lines)
- Code content already in git — save the *decision*, not the code
- Transient conversation — save the conclusion, not the process
- Duplicates — search first, use `update_thought` instead of creating new ones"#,
    },
    PromptDef {
        name: "save-guide",
        title: "How to Save Thoughts Well",
        description: "Best practices for creating high-quality, searchable memories. Read when saving important information.",
        text: r#"# How to Save Thoughts Well

1. **Summary first.** Search results only show summaries. A thought without a summary is invisible to future searches. Keep summaries under 100 characters.

2. **Type accurately.** Use `decision`, `task`, `question`, `reference`, `insight`, or `note`. Don't default everything to `note`.

3. **Tag topics and people.** These are the primary filters for `list_thoughts`. Use consistent topic names across thoughts (e.g., always "auth" not sometimes "authentication").

4. **Link related thoughts.** Use `manage_edges` to connect decisions to the tasks they affect, references to the insights they support. Edge types: `refines`, `cites`, `refuted_by`, `tags`, `related`, `follows`.

5. **Update, don't duplicate.** If a thought exists but is outdated, use `update_thought`. Don't create a new one.

6. **Be specific.** "We discussed the API" is useless. "Chose REST over GraphQL for the public API because most consumers are mobile apps with bandwidth constraints" is searchable and actionable.

7. **Capture the why.** Facts change; reasoning persists. "Using SQLite" is a fact you can see in the code. "Chose SQLite over Postgres because all 4 machines need offline access without a central server" is the decision worth saving."#,
    },
    PromptDef {
        name: "tool-guide",
        title: "ShelbyMCP Tool Guide",
        description: "Quick reference for all available tools and when to use each one.",
        text: r#"# ShelbyMCP Tool Guide

## Capture & Update
- `capture_thought` — Save a new thought. Supports bulk capture via the `thoughts` array parameter.
- `update_thought` — Modify an existing thought. Supports bulk update via `ids` array. Use this instead of deleting and recreating.
- `delete_thought` — Remove a thought and all its edges. Use sparingly — prefer updating.

## Search & Browse
- `search_thoughts` — Full-text search. Returns summaries only. Use `get_thought` to read full content of interesting results.
- `list_thoughts` — Filter by type, topic, person, project, date range, or summary presence. Good for browsing a category.
- `get_thought` — Fetch a single thought by ID with full content. Use after search/list to drill into details.

## Graph
- `manage_edges` — Create or remove typed relationships between thoughts. Actions: `link`, `unlink`, `expire`. Types: `refines`, `cites`, `refuted_by`, `tags`, `related`, `follows`.
- `explore_graph` — Traverse relationships from a starting thought. Set `max_depth` (1-5) and optionally filter by `edge_types`.

## Orientation & Context
- `get_brief` — Generate a trusted, scoped, privacy-filtered project brief. Use for session orientation; use search for targeted follow-up.
- `select_context` — Compose a targeted context payload by filtering thoughts by type, topic, person, or date. Use when you need a narrow slice rather than a full overview.

## Stats
- `thought_stats` — Aggregate counts by type, top topics, recent activity. Good for understanding what's in memory."#,
    },
];
