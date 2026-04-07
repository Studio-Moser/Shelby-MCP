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

## Agentic AI Memory Poisoning (OWASP ASI06)

### Threat Model

ShelbyMCP is a shared memory store accessed by multiple AI tools (Claude Code, Codex, etc.). A compromised or malicious AI tool — or a prompt injection attack delivered through external content — could attempt to:

1. **Inject crafted content** via `capture_thought` containing prompt injection strings designed to manipulate other AI tools when they retrieve the memory.
2. **Overwrite legitimate memories** via `update_thought` with adversarial content.
3. **Sabotage memory** via `delete_thought` to remove correct context and force agents into a degraded state.

This is a local, single-user server (not multi-tenant), so per-caller authorization is not applicable. The primary concern is a tool calling the MCP server with maliciously large or crafted inputs.

### Mitigations in Place

**Input length caps** (enforced at both the Zod schema layer and the handler layer):

| Field      | Maximum          |
|------------|-----------------|
| `content`  | 50,000 characters (~50 KB) |
| `summary`  | 200 characters  |
| `topics`   | 20 entries, each ≤ 100 characters |
| `people`   | 20 entries, each ≤ 100 characters |
| Bulk `thoughts` array | 50 thoughts per call |

These limits prevent a single tool invocation from flooding the database with arbitrarily large content that could be used for large-scale prompt injection at retrieval time.

**What is NOT mitigated (out of scope for this release):**

- **Semantic content filtering**: No attempt is made to detect or strip prompt injection strings from content. This would require inference (which violates the "smart agent, dumb server" architecture principle) and would produce false positives on legitimate content.
- **Rate limiting**: Not implemented because this is a local stdio server; OS-level process isolation provides the primary rate limit.
- **Caller authentication/authorization**: Not applicable — all callers on the local machine are trusted equally. If multi-agent trust boundaries become relevant in a future version, per-caller signing should be considered.

### Microsoft Agent Governance Toolkit Alignment

This audit was conducted with reference to the Microsoft Agent Governance Toolkit and OWASP Agentic AI Top 10 (ASI06 — Memory Poisoning). The mitigations above address the data-layer amplification vector. The semantic injection vector remains a design-level risk acknowledged and accepted for the current single-user, local deployment model.
