# Agent Setup

ShelbyMCP works with any MCP-compatible AI tool. Setup has four parts:

1. **Connect the server** — register ShelbyMCP with your agent
2. **Add the Memory Protocol** — tell your agent when and how to use memory
3. **(Optional) Set up Forage** — scheduled enrichment that makes memories smarter over time
4. **(Recommended) Seed your memory** — run the onboarding interview or import from another AI

## The Fast Way

The CLI handles everything — MCP registration, Memory Protocol instructions, and Forage skill installation:

```bash
shelbymcp setup <agent> --forage
```

Supported agents: `claude-code`, `claude-desktop`, `cursor`, `codex`, `windsurf`, `gemini`, `antigravity`

Drop `--forage` if you only want the MCP server. To remove: `shelbymcp uninstall <agent>`.

---

## 1. Connect the MCP Server

Each agent has its own config system. The CLI handles most of this automatically, but manual setup is documented below for reference.

> **Important:** Claude Code CLI and Claude Desktop are **separate apps** with **separate configs**. Adding a server to one does NOT make it available in the other.

### Claude Code CLI

```bash
shelbymcp setup claude-code --forage
```

This runs `claude mcp add -s user -t stdio shelbymcp -- npx shelbymcp` to register the server at user scope (available across all projects), appends the Memory Protocol to `~/.claude/CLAUDE.md`, and copies the Forage skill to `~/.claude/scheduled-tasks/shelby-forage/`.

<details>
<summary>Manual setup</summary>

```bash
claude mcp add -s user -t stdio shelbymcp -- npx shelbymcp
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
3. Add the `shelbymcp` entry to the `mcpServers` object:

```json
{
  "mcpServers": {
    "shelbymcp": {
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

**Memory Protocol:** Go to **Settings > General** and paste the Memory Protocol (see Section 2) into the "What personal preferences should Claude consider in responses?" field. This applies to all conversations and syncs across devices.

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
    "shelbymcp": {
      "type": "stdio",
      "command": "npx",
      "args": ["shelbymcp"]
    }
  }
}
```
</details>

Also supports project-level config at `.cursor/mcp.json` in your project root.

**Memory Protocol:** Go to **Cursor Settings > Rules > User Rules** and paste the Memory Protocol (see Section 2). This applies globally across all projects.

### Codex (OpenAI)

```bash
shelbymcp setup codex --forage
```

The CLI runs `codex mcp add shelbymcp -- npx shelbymcp` if the Codex CLI is installed, or prints TOML config to paste manually.

<details>
<summary>Manual setup</summary>

**Via CLI:**

```bash
codex mcp add shelbymcp -- npx shelbymcp
```

**Via config file** (`~/.codex/config.toml` — note: **TOML**, not JSON):

```toml
[mcp_servers.shelbymcp]
command = "npx"
args = ["shelbymcp"]
```

Also supports project-level config at `.codex/config.toml` (trusted projects only).
</details>

**Memory Protocol:** The CLI auto-appends to `~/.codex/AGENTS.md`. To do it manually: `shelbymcp protocol >> ~/.codex/AGENTS.md`

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
    "shelbymcp": {
      "command": "npx",
      "args": ["shelbymcp"]
    }
  }
}
```
</details>

**Gotcha:** Windsurf has a hard cap of 100 total tools across all MCP servers.

**Memory Protocol:** The CLI auto-appends to `~/.codeium/windsurf/memories/global_rules.md`. To do it manually: `shelbymcp protocol >> ~/.codeium/windsurf/memories/global_rules.md`

### Gemini CLI

```bash
shelbymcp setup gemini --forage
```

The CLI uses `gemini mcp add shelbymcp npx --scope user -- shelbymcp` when the Gemini CLI is installed. If not, it falls back to writing `~/.gemini/settings.json` directly. The Memory Protocol is appended to `~/.gemini/GEMINI.md`.

<details>
<summary>Manual setup</summary>

**Via CLI:**

```bash
gemini mcp add shelbymcp npx --scope user -- shelbymcp
```

**Via config file** (`~/.gemini/settings.json`):

```json
{
  "mcpServers": {
    "shelbymcp": {
      "command": "npx",
      "args": ["shelbymcp"]
    }
  }
}
```
</details>

**Memory Protocol:** The CLI auto-appends to `~/.gemini/GEMINI.md`. To do it manually: `shelbymcp protocol >> ~/.gemini/GEMINI.md`

### Antigravity (Google)

```bash
shelbymcp setup antigravity --forage
```

The CLI merges the MCP server entry into `~/.gemini/antigravity/mcp_config.json` and appends the Memory Protocol to `~/.gemini/GEMINI.md` (shared with Gemini CLI).

<details>
<summary>Manual setup</summary>

Edit `~/.gemini/antigravity/mcp_config.json`:

```json
{
  "mcpServers": {
    "shelbymcp": {
      "command": "npx",
      "args": ["shelbymcp"]
    }
  }
}
```
</details>

**Memory Protocol:** Shared with Gemini CLI at `~/.gemini/GEMINI.md`. The CLI auto-appends it if not already present.

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
| Claude Code CLI | `~/.claude/CLAUDE.md` | Auto-added by setup CLI. Survives context compaction. |
| Claude Desktop | Settings > General > "What personal preferences should Claude consider in responses?" | Account-level, syncs across devices, applies to all conversations |
| Cursor | **Settings > Rules > User Rules** | Global across all projects |
| Codex | `~/.codex/AGENTS.md` | Auto-added by setup CLI |
| Windsurf | `~/.codeium/windsurf/memories/global_rules.md` | Auto-added by setup CLI |
| Gemini CLI | `~/.gemini/GEMINI.md` | Auto-added by setup CLI |
| Antigravity | `~/.gemini/GEMINI.md` (shared with Gemini CLI) | Auto-added by setup CLI |

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

> **For Cursor:** Go to **Settings > Rules > User Rules** and paste the protocol text directly. This applies globally across all projects without needing `.mdc` files.

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
| **Antigravity** | None | Manual only | No scheduler. Paste the Forage prompt into a conversation when you want to run it. | — |

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

## 4. Seed Your Memory (Recommended)

After setup, your memory database is empty. To get immediate value, seed it with foundational context about yourself and your work.

### Option A: Onboard Interview (5 minutes)

Run the onboarding prompt in your primary agent. It asks a few rounds of conversational questions and saves 15-30 memories covering your identity, projects, team, preferences, and anti-patterns.

```bash
shelbymcp onboard
```

Paste the output into a conversation with your ShelbyMCP-connected agent and follow along. Memories are captured after each round — you'll see confirmations as they're saved.

If you already have some memories (from prior use or a migration), the onboard skill checks `thought_stats` first and fills gaps instead of starting from scratch.

### Option B: Import from Another AI

If you've been using ChatGPT, Claude, Gemini, or another AI that already knows about you, export that context:

```bash
shelbymcp migrate
```

This prints a prompt to paste into your other AI tool. That tool will output everything it knows about you in a structured format. Copy the response and paste it into your ShelbyMCP-connected agent — either during the onboard interview (it has a migration import step) or in any conversation with a request like "import these memories into ShelbyMCP."

### Option C: Just Start Working

Memories accumulate naturally as you work. The Memory Protocol tells your agent to save decisions, preferences, and context as they come up. The onboard and migrate options just accelerate the process.

---

## 5. Verify the Connection

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

