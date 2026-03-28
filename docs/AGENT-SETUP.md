# Agent Setup

Connect ShelbyMCP to your AI tools. Each tool needs one config entry pointing to the ShelbyMCP binary.

---

## Claude Code

Add to `~/.claude/mcp.json`:

```json
{
  "mcpServers": {
    "memory": {
      "command": "shelbymcp",
      "args": ["--db", "~/.shelbymcp/memory.db"]
    }
  }
}
```

### With Forage Skill

Copy the scheduled skill to enable daily memory enrichment:

```bash
cp -r skills/shelby-forage ~/.claude/scheduled-tasks/shelby-forage
```

---

## Cursor

Add to `.cursor/mcp.json` in your project or global config:

```json
{
  "mcpServers": {
    "memory": {
      "command": "shelbymcp",
      "args": ["--db", "~/.shelbymcp/memory.db"]
    }
  }
}
```

---

## Codex

Add to your Codex MCP configuration:

```json
{
  "mcpServers": {
    "memory": {
      "command": "shelbymcp",
      "args": ["--db", "~/.shelbymcp/memory.db"]
    }
  }
}
```

---

## Windsurf

Add to your Windsurf MCP settings:

```json
{
  "mcpServers": {
    "memory": {
      "command": "shelbymcp",
      "args": ["--db", "~/.shelbymcp/memory.db"]
    }
  }
}
```

---

## Gemini CLI

Add to your Gemini CLI MCP configuration:

```json
{
  "mcpServers": {
    "memory": {
      "command": "shelbymcp",
      "args": ["--db", "~/.shelbymcp/memory.db"]
    }
  }
}
```

---

## OpenCode

Add to your OpenCode config:

```json
{
  "mcpServers": {
    "memory": {
      "command": "shelbymcp",
      "args": ["--db", "~/.shelbymcp/memory.db"]
    }
  }
}
```

---

## Any MCP-Compatible Client

ShelbyMCP uses standard MCP stdio transport. Any client that supports MCP can connect:

```json
{
  "command": "shelbymcp",
  "args": ["--db", "/path/to/memory.db"]
}
```

---

## CLI Flags

| Flag | Default | Description |
|---|---|---|
| `--db` | `~/.shelbymcp/memory.db` | Path to the SQLite database file |
| `--verbose` | `false` | Enable verbose logging to stderr |
| `--version` | — | Print version and exit |

---

## Verifying the Connection

Once configured, ask your AI tool:

> "What memory tools do you have available?"

It should list the ShelbyMCP tools (capture_thought, search_thoughts, etc.). Then try:

> "Remember that I prefer dark mode in all my apps."

And later:

> "What do you know about my preferences?"

If it recalls the dark mode preference, ShelbyMCP is working.

---

## Surfacing Forage Flags

The Forage skill runs in the background and tags items that need user attention with the topic `"needs-attention"` (contradictions it found, tasks that look forgotten, etc.). Since Forage runs unattended, it can't ask the user directly — it leaves these flags for the conversational agent to pick up.

To surface them, add something like this to your agent's system prompt or CLAUDE.md:

```
When starting a conversation, check ShelbyMCP for items that need attention:
use `list_thoughts` with `topic: "needs-attention"` and `limit: 5`.
If there are any, briefly mention them to the user (e.g., "Forage flagged
a couple things — a possible contradiction about your database choice,
and a task from two weeks ago that might have slipped. Want to look at them?").
If the user resolves one, delete the needs-attention thought — it's served its purpose.
```

This keeps Forage focused on analysis and the conversational agent focused on communication.
