export function printHelp(): void {
  console.log(`ShelbyMCP — Knowledge-graph memory for AI tools

Usage:
  shelbymcp                    Start the MCP server (stdio)
  shelbymcp setup <agent>      Set up ShelbyMCP for an agent
  shelbymcp setup <agent> --forage  ...and install the Forage skill
  shelbymcp uninstall <agent>  Remove ShelbyMCP from an agent
  shelbymcp protocol           Print the Memory Protocol
  shelbymcp forage             Print the Forage skill prompt
  shelbymcp onboard            Print the onboarding interview prompt
  shelbymcp migrate            Print the migration prompt for other AI tools
  shelbymcp help               Show this help

Setup agents:
  claude-code       Claude Code CLI
  claude-desktop    Claude Desktop app
  cursor            Cursor IDE
  codex             OpenAI Codex
  windsurf          Windsurf (Codeium)
  gemini            Gemini CLI
  antigravity       Antigravity (Google)

Flags:
  --db <path>     Database path (default: ~/.shelbymcp/memory.db)
  --verbose       Enable verbose logging
  --version       Print version

Examples:
  shelbymcp setup claude-code --forage  Configure + install Forage skill
  shelbymcp setup claude-code          Auto-configure Claude Code CLI
  shelbymcp protocol >> CLAUDE.md      Append Memory Protocol to your rules
  shelbymcp forage > forage-task.md    Save Forage prompt for scheduling
  shelbymcp onboard                    Get started with the onboarding interview
  shelbymcp migrate                    Export memories from ChatGPT/Gemini/etc.

Docs: https://github.com/Studio-Moser/shelbymcp/docs/AGENT-SETUP.md`);
}
