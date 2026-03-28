# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in ShelbyMCP, please report it responsibly.

**Do not open a public issue.** Instead, email security@studiomoser.com with:

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

We will acknowledge receipt within 48 hours and aim to release a fix within 7 days for critical issues.

## Scope

ShelbyMCP stores user thoughts and memories in a local SQLite database. Security considerations include:

- **File permissions**: The database file should be readable/writable only by the user (0600)
- **MCP protocol**: ShelbyMCP communicates via stdio, not network sockets. No network attack surface by default.
- **Forage skill**: Runs on the user's AI subscription. The skill has access to the same tools as any MCP client.
- **No secrets in memory**: ShelbyMCP does not store API keys, tokens, or credentials. If an AI tool captures a thought containing secrets, that's the tool's responsibility to filter.
