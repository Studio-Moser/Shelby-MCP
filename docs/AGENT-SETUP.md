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
