# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in ShelbyMCP, please report it responsibly.

**Do not open a public issue.** Instead, email security@studiomoser.com with:

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

We will acknowledge receipt within 48 hours and aim to release a fix within 7 days for critical issues.

## Known Vulnerabilities

### CVE-2026-0621 — ReDoS in MCP TypeScript SDK UriTemplate regex

| Field | Detail |
|-------|--------|
| **CVE** | CVE-2026-0621 |
| **Severity** | High (ReDoS — remote denial of service) |
| **Affected package** | `@modelcontextprotocol/sdk` < v2.0.0-alpha.2 |
| **Current ShelbyMCP version** | `@modelcontextprotocol/sdk` ^1.26.0 |
| **Fix** | Available in v2.0.0-alpha.2 (alpha — not yet stable) |
| **Reported** | 2026-04-07 |

**Description**: A Regular Expression Denial of Service (ReDoS) vulnerability exists in the UriTemplate regex parser of the MCP TypeScript SDK. Maliciously crafted URI template strings can cause catastrophic backtracking, blocking the Node.js event loop.

**Attack surface assessment for ShelbyMCP**:
- The HTTP transport (`--transport http`) exposes a network surface, but ShelbyMCP does not parse untrusted URI templates from incoming requests. The vulnerable code path is only triggered when the SDK itself parses URI templates during request routing — which ShelbyMCP does not exercise with user-supplied template strings.
- The default stdio transport has no network attack surface.
- Risk is **low** in practice, but the vulnerability exists in the dependency tree.

**Remediation plan**: Upgrade to `@modelcontextprotocol/sdk` v2 once a stable release is available. SDK v2 introduces a multi-package architecture and breaking changes; the upgrade will be tracked as part of Shelby-MCP's public npm release milestone. Do NOT publish ShelbyMCP to npm while still on the v1 SDK.

**Tracking**: strategy-tracker #32

---

## Scope

ShelbyMCP stores user thoughts and memories in a local SQLite database. Security considerations include:

- **File permissions**: The database file should be readable/writable only by the user (0600)
- **MCP protocol**: ShelbyMCP communicates via stdio, not network sockets. No network attack surface by default.
- **Forage skill**: Runs on the user's AI subscription. The skill has access to the same tools as any MCP client.
- **No secrets in memory**: ShelbyMCP does not store API keys, tokens, or credentials. If an AI tool captures a thought containing secrets, that's the tool's responsibility to filter.
