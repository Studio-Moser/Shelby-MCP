# Agent Setup

ShelbyMCP works with any MCP-compatible AI tool. Setup has three parts:

1. **Connect the server** — register ShelbyMCP with your agent
2. **Add the Memory Protocol** — tell your agent when and how to use memory
3. **(Optional) Set up Forage** — scheduled enrichment that makes memories smarter over time

## The Fast Way

The CLI handles everything — MCP registration, Memory Protocol instructions, and Forage skill installation:

```bash
shelbymcp setup <agent> --forage
```

Supported agents: `claude-code`, `claude-desktop`, `cursor`, `codex`, `windsurf`, `gemini`

Drop `--forage` if you only want the MCP server. To remove: `shelbymcp uninstall <agent>`.

---

## 1. Connect the MCP Server

Each agent has its own config system. The CLI handles most of this automatically, but manual setup is documented below for reference.

> **Important:** Claude Code CLI and Claude Desktop are **separate apps** with **separate configs**. Adding a server to one does NOT make it available in the other.

### Claude Code CLI

```bash
shelbymcp setup claude-code --forage
```

This runs `claude mcp add -s user -t stdio memory -- npx shelbymcp` to register the server at user scope (available across all projects), prints where to paste the Memory Protocol, and copies the Forage skill to `~/.claude/scheduled-tasks/shelby-forage/`.

<details>
<summary>Manual setup</summary>

```bash
claude mcp add -s user -t stdio memory -- npx shelbymcp
```

**Scopes:**
- `user` — available in all projects (recommended)
- `project` — stored in `.mcp.json` at project root, shared via version control
- `local` — (default) private to you, only in the current project

**Verify:** Run `claude mcp list` or type `/mcp` inside a session.
</details>

**Memory Protocol:** `shelbymcp protocol >> ~/.claude/CLAUDE.md`

### Claude Desktop

```bash
shelbymcp setup claude-desktop --forage
```

The CLI prints the JSON config to paste and where to add the Memory Protocol. Claude Desktop requires a manual config edit and restart.

<details>
<summary>Manual setup</summary>

1. Open Claude Desktop
2. Go to **Settings > Developer > Edit Config**
3. Add the `memory` entry to the `mcpServers` object:

```json
{
  "mcpServers": {
    "memory": {
      "command": "npx",
      "args": ["shelbymcp"]
    }
  }
}
```

4. **Quit and restart Claude Desktop** (required — changes don't take effect until restart)

**Config path (macOS):** `~/Library/Application Support/Claude/claude_desktop_config.json`
**Config path (Windows):** `%APPDATA%\Claude\claude_desktop_config.json`
</details>

**Memory Protocol:** Go to Settings > Profile and paste the Memory Protocol (see Section 2) into the "What preferences should Claude consider?" field. This applies to all conversations and syncs across devices.

### Cursor

```bash
shelbymcp setup cursor --forage
```

The CLI merges the MCP server entry into `~/.cursor/mcp.json` and prints instructions for the Memory Protocol and Forage.

<details>
<summary>Manual setup</summary>

**Via UI:** Settings > Tools & MCP > New MCP Server

**Via config file** (global — `~/.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "memory": {
      "command": "npx",
      "args": ["shelbymcp"]
    }
  }
}
```
</details>

Also supports project-level config at `.cursor/mcp.json` in your project root.

**Memory Protocol:** Create `.cursor/rules/shelbymcp.mdc` in your project with `alwaysApply: true` frontmatter (see Section 2).

### Codex (OpenAI)

```bash
shelbymcp setup codex --forage
```

The CLI runs `codex mcp add memory -- npx shelbymcp` if the Codex CLI is installed, or prints TOML config to paste manually.

<details>
<summary>Manual setup</summary>

**Via CLI:**

```bash
codex mcp add memory -- npx shelbymcp
```

**Via config file** (`~/.codex/config.toml` — note: **TOML**, not JSON):

```toml
[mcp_servers.memory]
command = "npx"
args = ["shelbymcp"]
```

Also supports project-level config at `.codex/config.toml` (trusted projects only).
</details>

**Memory Protocol:** Paste into `AGENTS.md` in your project root.

### Windsurf

```bash
shelbymcp setup windsurf --forage
```

The CLI merges the MCP server entry into the Windsurf config file.

<details>
<summary>Manual setup</summary>

**Via UI:** Settings > Cascade > MCP Servers, or click the MCPs icon in the Cascade panel.

**Via config file** (`~/.codeium/windsurf/mcp_config.json` — global only, no project-level config):

```json
{
  "mcpServers": {
    "memory": {
      "command": "npx",
      "args": ["shelbymcp"]
    }
  }
}
```
</details>

**Gotcha:** Windsurf has a hard cap of 100 total tools across all MCP servers.

**Memory Protocol:** `shelbymcp protocol >> .windsurfrules`

### Gemini CLI

```bash
shelbymcp setup gemini --forage
```

The CLI merges the MCP server entry into `~/.gemini/settings.json`.

<details>
<summary>Manual setup</summary>

Edit `~/.gemini/settings.json` (or `.gemini/settings.json` in your project):

```json
{
  "mcpServers": {
    "shelby-memory": {
      "command": "npx",
      "args": ["shelbymcp"]
    }
  }
}
```

**Gotcha:** Do NOT use underscores in the server name — Gemini's policy parser breaks on them. Use `shelby-memory`, not `shelby_memory`.
</details>

**Memory Protocol:** Paste into `GEMINI.md` in your project root or `~/.gemini/system.md` (global).

### Custom Database Path

All agents default to `~/.shelbymcp/memory.db`. To use a custom path, add `"--db", "/path/to/memory.db"` to the args array (or `args = ["shelbymcp", "--db", "/path/to/memory.db"]` for TOML).

All agents share the same database file by default. A thought captured in Claude Code is immediately searchable in Cursor.

---

## 2. Memory Protocol

Connecting the server gives your agent memory tools, but **agents won't use them proactively** unless you tell them to. The Memory Protocol is a block of instructions you paste into your agent's rules file.

> **Quick setup:** Run `shelbymcp protocol` to print the protocol to your terminal. Pipe it directly: `shelbymcp protocol >> CLAUDE.md`

### Where to paste it

| Agent | Where to paste | Notes |
|---|---|---|
| Claude Code CLI | `~/.claude/CLAUDE.md` (global) or `CLAUDE.md` (project) | Survives context compaction |
| Claude Desktop | Settings > Profile > "What preferences should Claude consider?" | Account-level, syncs across devices, applies to all conversations |
| Cursor | `.cursor/rules/shelbymcp.mdc` | Must include `alwaysApply: true` frontmatter (see below) |
| Codex | `AGENTS.md` in project root | |
| Windsurf | `.windsurfrules` in project root | |
| Gemini CLI | `GEMINI.md` (project) or `~/.gemini/system.md` (global) | |

### The Protocol

Copy everything inside the fence:

````markdown
## Memory (ShelbyMCP)

You have persistent memory via ShelbyMCP MCP tools. Memory survives across sessions and is shared across all AI tools the user works with. You MUST use it — do not rely on conversation context alone.

### When to SAVE (mandatory)

You MUST call `capture_thought` after any of these events:

- **Decisions**: Architecture choices, library selections, tradeoffs considered ("We chose CloudKit over Firebase because...")
- **Preferences**: User likes/dislikes, workflow habits, coding style ("User prefers functional components over class components")
- **People & roles**: Who does what ("Sarah owns the auth service, Mike handles DevOps")
- **Project context**: Goals, deadlines, constraints, scope changes ("Launch target is March 15, blocked on API approval")
- **Bugs & fixes**: Root cause discoveries, workarounds, things that broke ("Memory leak was caused by unclosed DB connections in the edge traversal loop")
- **Architecture & patterns**: System design, data flow, conventions ("All API responses use the envelope pattern: { data, error, meta }")
- **Insights**: Non-obvious learnings, things that surprised you ("FTS5 porter tokenizer handles plurals but not acronyms")

Always include: a `summary` (one-line, <100 chars), a `type`, relevant `topics`, and link to `related_to` thoughts when applicable.

### When to SEARCH (mandatory)

You MUST call `search_thoughts` or `list_thoughts` before:

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
2. **Type accurately.** Use `decision`, `task`, `question`, `reference`, `insight`, or `note`. Don't default everything to `note`.
3. **Tag topics and people.** These are the primary filters for `list_thoughts`.
4. **Link related thoughts.** Use `manage_edges` to connect decisions to the tasks they affect, references to the insights they support.
5. **Update, don't duplicate.** If a thought exists but is outdated, use `update_thought`. Don't create a new one.
````

> **For Cursor:** Create `.cursor/rules/shelbymcp.mdc` and add this frontmatter before the protocol content:
> ```
> ---
> alwaysApply: true
> ---
> ```

---

## 3. Forage Skill (Optional)

The Forage skill is a scheduled task that runs on your AI subscription to continuously improve your memories. It backfills summaries, generates embeddings, merges duplicates, detects contradictions, discovers connections, and produces weekly digests.

> **Quick setup:** Run `shelbymcp forage` to print the Forage prompt to your terminal.

### What Forage Does

| Task | Frequency | What it does |
|---|---|---|
| Summary backfill | Daily | Generate one-liners for thoughts missing summaries |
| Auto-classify | Daily | Improve type/topics/people on poorly tagged thoughts |
| Consolidation | Daily | Find and merge duplicate thoughts |
| Contradiction detection | Daily | Flag conflicting memories (tagged `needs-attention`) |
| Connection discovery | Daily | Create edges between related thoughts |
| Stale sweep | Weekly (Mon) | Flag forgotten action items (tagged `needs-attention`) |
| Digest | Weekly (Mon) | Summary of the week's thinking by project/topic |
| Forage log | Every run | Audit trail of what was done, helps next run pick up where this one left off |

### Platform Compatibility

Not all agents support scheduled tasks equally.

| Platform | Scheduling | How to Run Forage | Gotchas | Docs |
|---|---|---|---|---|
| **Claude Desktop** | Local scheduled tasks | Schedule page > Daily | Must keep app open + computer awake. One catch-up for missed runs. Best option for most users. | [Docs](https://support.claude.com/en/articles/13854387-schedule-recurring-tasks-in-cowork) |
| **Claude Code CLI** | Session-scoped tasks | `CronCreate` or scheduled tasks | **7-day auto-expiry** on recurring tasks. Dies when session ends. Must re-create periodically. | [Docs](https://code.claude.com/docs/en/scheduled-tasks) |
| **Claude Remote Tasks** | Cloud tasks | claude.ai/code/scheduled | Runs when computer is off. **Cannot access local `~/.shelbymcp/memory.db`** unless DB is on a network path. | [Docs](https://code.claude.com/docs/en/scheduled-tasks) |
| **Cursor** | Automations | Cursor Automations settings | Cloud-based. MCP access to local servers may not work. | [Docs](https://docs.cursor.com/chat/automations) |
| **Codex** | Local automations | Codex automation config | Still evolving, limited documentation. | — |
| **Windsurf** | None | Manual only | No scheduler. Paste the Forage prompt into a conversation when you want to run it. | — |
| **Gemini CLI** | Scheduled actions | Gemini scheduled actions | Consumer-focused. Max 10 active actions. MCP tool access uncertain. | [Docs](https://support.google.com/gemini/answer/16316416) |

**Recommended:** Claude Desktop local tasks — persistent across restarts, full MCP access, catches up on missed runs.

### Setup: Claude Desktop (Recommended)

1. Open Claude Desktop
2. Go to the **Schedule** page
3. Create a new local task, set frequency to **Daily**
4. Paste the Forage prompt (run `shelbymcp forage` to get it)
5. Done — runs daily with access to your ShelbyMCP tools

### Setup: Claude Code CLI

```bash
cp -r node_modules/shelbymcp/skills/shelby-forage ~/.claude/scheduled-tasks/shelby-forage
```

Or create a scheduled task manually and paste the output of `shelbymcp forage`.

> **Note:** Claude Code CLI scheduled tasks auto-expire after 7 days. Use Claude Desktop for persistent scheduling.

### Setup: Any Other Agent

If your agent supports scheduled tasks or recurring prompts:

1. Create a scheduled task set to run **daily**
2. Paste the output of `shelbymcp forage` as the task content
3. Ensure the agent has access to the ShelbyMCP MCP tools

If your agent has no scheduler (Windsurf, older tools), paste the Forage prompt into a conversation whenever you want to run maintenance manually.

### The Forage Prompt

Run `shelbymcp forage` to print this to your terminal, or copy from below:

Run `shelbymcp forage` to get the full prompt, or see [skills/shelby-forage/SKILL.md](../skills/shelby-forage/SKILL.md) for the canonical version.

### Surfacing Forage Flags

Forage tags items that need user attention with the topic `"needs-attention"` (contradictions it found, tasks that look forgotten, etc.). Since Forage runs unattended, it can't ask the user directly — it leaves flags for the conversational agent to pick up.

To surface them, add something like this to your agent's system prompt alongside the Memory Protocol:

```
When starting a conversation, check ShelbyMCP for items that need attention:
use `list_thoughts` with `topic: "needs-attention"` and `limit: 5`.
If there are any, briefly mention them to the user (e.g., "Forage flagged
a couple things — a possible contradiction about your database choice,
and a task from two weeks ago that might have slipped. Want to look at them?").
If the user resolves one, delete the needs-attention thought — it's served its purpose.
```

This keeps Forage focused on analysis and the conversational agent focused on communication.

---

## 4. Verify the Connection

Ask your AI tool:

> "What memory tools do you have available?"

It should list: `capture_thought`, `search_thoughts`, `list_thoughts`, `get_thought`, `update_thought`, `delete_thought`, `manage_edges`, `explore_graph`, `thought_stats`.

Then test the full loop:

> "Remember that I prefer dark mode in all my apps."

Wait, then in a **different session or agent**:

> "What do you know about my preferences?"

If it recalls the dark mode preference, ShelbyMCP is working and memories are shared.

### Tools Quick Reference

| Tool | Type | What it does |
|---|---|---|
| `capture_thought` | Create | Store a thought with summary, metadata, topics, and relationships. Accepts an array for bulk capture. |
| `search_thoughts` | Read | Full-text search with knowledge graph expansion. Returns summaries, not full content. |
| `list_thoughts` | Read | Browse/filter by type, topic, person, project, date range. |
| `get_thought` | Read | Fetch full thought content by ID. |
| `update_thought` | Update | Update content or metadata. Accepts `ids` array for bulk updates. |
| `delete_thought` | Delete | Remove a thought and its edges. |
| `manage_edges` | Write | Create or remove typed relationships (refines, cites, refuted_by, tags, related, follows). |
| `explore_graph` | Read | Traverse the knowledge graph from a starting thought by depth. |
| `thought_stats` | Read | Aggregate statistics about your memory database. |

