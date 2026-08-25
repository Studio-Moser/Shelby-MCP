# Security Policy

## Report a vulnerability

Do not open a public issue. Email security@studiomoser.com with the affected version, reproduction steps, impact, and any suggested mitigation. We aim to acknowledge reports within 48 hours.

## Security boundaries

ShelbyMCP is a local, single-user memory service by default. Its SQLite database contains user-provided text and is not encrypted by ShelbyMCP; protect the database with operating-system account and disk-encryption controls.

- Stdio is the default transport and has no listening socket.
- Streamable HTTP may be exposed deliberately. Set `SHELBY_API_KEY`, bind to the narrowest interface, and terminate TLS at a trusted proxy for remote use.
- With `SHELBY_API_KEY` set, `/mcp` requires a bearer token and the OAuth 2.1 flow uses authorization code with PKCE, dynamic client registration, HMAC-derived tokens, and refresh-token rotation.
- Without `SHELBY_API_KEY`, HTTP is unauthenticated and OAuth endpoints return `503`.
- The server performs no inference and stores no model-provider credentials.
- npm launches the native binary without a shell. Client fallback installers preserve unrelated configuration and refuse to overwrite malformed JSON.

## Memory poisoning

Multiple agents can write to the same database. A compromised client or prompt-injected workflow could capture adversarial text, modify memories, or delete data. ShelbyMCP mitigates amplification with bounded inputs, trust levels, explicit data-only fences around untrusted retrievals, scoped project access, pagination, and destructive tool annotations.

Semantic classification is intentionally not performed in the server. Agents must treat `unverified` and `external` content as data, and users should review destructive operations and backups. Per-caller authorization is outside the local single-user threat model; hosted operators must isolate databases and credentials per tenant.

## Supported versions

Security fixes are provided for the latest published release and the current `main` branch.
