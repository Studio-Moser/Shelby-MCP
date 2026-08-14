# Security

> **DRAFT** — not yet published guidance. Blocks on Shelby-MacOS#269, Shelby-MacOS#275, Shelby-MCP#43; publish once those land.

This document states what ShelbyMCP actually enforces, with the code path that enforces it, and what it does not. Claims without a citation don't belong here. Where the npm server's defaults are weaker than the Shelby Mac app's, that is called out explicitly.

## Reporting a vulnerability

**Do not open a public issue.** Email <!-- TODO(Tim): replace placeholder with real address --> security@studiomoser.example with a description, reproduction steps, and impact. We acknowledge within 48 hours, give a status assessment within 7 days, and aim to fix critical issues within 14 days of triage. Coordinated disclosure: please give us the chance to ship a fix before publishing.

## What is enforced (and where)

**Stdio is the default transport, and it has no network surface.** Without `--transport http` (or `SHELBY_TRANSPORT=http`), the server speaks stdio to its parent process only (`src/index.ts:66-72`, `src/config.ts:72`). The OS process boundary is the access control.

**Bearer-token verification is constant-time.** When HTTP auth is on, tokens are checked with `crypto.timingSafeEqual` against the API key or its derived access token (`src/mcp/oauth.ts:41-52`), enforced on every `/mcp` request (`src/mcp/http-transport.ts:130-141`).

**OAuth token issuance requires PKCE and validates redirect URIs.** The authorize flow rejects unregistered clients and mismatched redirect URIs (`src/mcp/oauth.ts:278-288,319-323`), the token exchange verifies the S256 PKCE challenge and expires codes after 10 minutes (`oauth.ts:339-345,379-390`), and failed key attempts are rate-limited to 5 per 15 minutes per IP (`oauth.ts:160-173,303-308`).

**Input length caps limit memory-poisoning amplification.** Enforced at the Zod schema layer on `capture_thought`, bulk capture, and `update_thought` (`src/mcp/server.ts:162-198,366-374`): content ≤ 50,000 chars, summary ≤ 200, topics/people ≤ 20 entries of ≤ 100 chars, bulk arrays ≤ 50 thoughts (constants at `src/tools/helpers.ts:7-13`). A single call cannot flood the store.

**Non-trusted memories never reach `get_brief`.** The brief policy drops any candidate whose `trust_level` is not `trusted` (`src/tools/brief-policy.ts:155`), along with wrong-project, consolidated, refuted, and non-`normal`-sensitivity candidates (`brief-policy.ts:147-163`). Surviving summaries pass a regex gate for injection markers, secrets, and PII, then get Markdown-escaped (`brief-policy.ts:75-99`). The regex gate is a heuristic filter, not a security boundary — the load-bearing defense is that untrusted content is excluded from the brief entirely.

## What is not guaranteed

Stated plainly so nobody builds on a guarantee that isn't there. Several of these are weaker than the Shelby Mac app's equivalents — the Mac app fail-closes its HTTP auth, binds loopback-only, and stamps external ingest as `external`; this server does none of those by default.

**HTTP auth is opt-in, and off by default.** Without `SHELBY_API_KEY`, the HTTP transport serves `/mcp` to anyone who can reach the socket — no auth at all, just a startup warning (`src/mcp/http-transport.ts:130-141,184`). The Mac app's server denies everything when its token is unresolvable; this one allows everything when the key is unset.

**HTTP mode binds `0.0.0.0` by default.** If you pass `--transport http` without an explicit `HOST` or `--host`, the server listens on all interfaces — a container-friendly default that is network-exposed on a bare machine (`src/config.ts:111-114`). Combined with the point above, `shelbymcp --transport http` with no further flags is an unauthenticated network service. Bind `127.0.0.1` and set `SHELBY_API_KEY` unless you are inside a container boundary you trust. The Mac app hard-pins its listener to `127.0.0.1`.

**No DNS-rebinding guard.** The HTTP transport does not check `Host` or `Origin` headers. A malicious website resolving to your loopback could reach an unauthenticated local instance from your browser. The Mac app rejects non-loopback `Host`/`Origin` on every route; this server does not.

**Captured thoughts default to `trusted`.** `capture_thought` stamps `trust_level: "trusted"` unless the caller says otherwise (`src/db/thoughts.ts:190`, schema default documented at `src/mcp/server.ts:170`). Every MCP client on the machine is trusted equally — a compromised or prompt-injected agent can write `trusted` memories that flow into every other agent's brief. The Mac app's external-ingest path defaults to `external`; here the discipline is left to the caller.

**Memory reads return non-trusted content unfenced.** `get_thought` and `search_thoughts` return full raw content regardless of trust level, with no fencing or annotation (`src/tools/get.ts`, `src/tools/search.ts` — neither consults `trust_level`). An agent that fetches an `external` thought gets its content verbatim, injection strings included. Fencing is tracked in Shelby-MCP#43.

**OAuth tokens are static and never expire.** Access and refresh tokens are deterministic HMACs of the API key (`src/mcp/oauth.ts:28-34`). There is one access token per key, it never rotates, and revocation means changing `SHELBY_API_KEY` for every client at once. Client registration is open — anyone who can reach `/register` can register a client (`oauth.ts:233-267`); the API key prompt at `/authorize` is the actual gate.

**Database file permissions are not enforced.** The server creates `~/.shelbymcp/` and the SQLite file with your process umask (`src/db/database.ts:11`) — typically world-readable. If other local users matter in your threat model, `chmod 600` it yourself.

**No semantic content filtering.** The server makes no attempt to detect or strip prompt-injection strings from stored content. That would require inference — which the "smart agent, dumb server" architecture deliberately avoids — and would false-positive on legitimate content. The trust-level system controls where content flows, not what it says.

**No per-caller authorization on stdio.** All local callers are trusted equally. This is a single-user, local server; if multi-agent trust boundaries become load-bearing, per-caller identity would need to exist first.

## Known vulnerabilities

### CVE-2026-0621 — ReDoS in MCP TypeScript SDK UriTemplate regex

| Field | Detail |
|-------|--------|
| **CVE** | CVE-2026-0621 |
| **Severity** | High (ReDoS — remote denial of service) |
| **Affected package** | `@modelcontextprotocol/sdk` < v2.0.0-alpha.2 |
| **Current ShelbyMCP version** | `@modelcontextprotocol/sdk` ^1.26.0 (`package.json:28`, noted at `src/mcp/http-transport.ts:5-6`) |
| **Fix** | Available in v2.0.0-alpha.2 (alpha — not yet stable) |
| **Reported** | 2026-04-07 |

Maliciously crafted URI template strings can cause catastrophic backtracking in the SDK's UriTemplate parser, blocking the Node.js event loop. ShelbyMCP does not parse untrusted URI templates from incoming requests, and the default stdio transport has no network surface, so practical risk is low — but the vulnerable code is in the dependency tree. Remediation: upgrade to SDK v2 once stable. Do not publish ShelbyMCP to npm while still on the v1 SDK. Tracking: strategy-tracker #32.
