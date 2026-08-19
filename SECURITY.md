# Security

This document describes the security controls ShelbyMCP currently enforces and the limits callers must account for.

## Reporting a vulnerability

**Do not open a public issue.** Email security@studiomoser.com with a description, reproduction steps, and impact. We acknowledge reports within 48 hours, provide a status assessment within 7 days, and aim to fix critical issues within 14 days of triage. Please give us a chance to ship a fix before publishing details.

## What is enforced

**Stdio is the default transport and exposes no network listener.** Without `--transport http` or `SHELBY_TRANSPORT=http`, the server connects only to its parent process over stdio (`src/index.ts:64-72`, `src/config.ts:67-75`).

**Bearer-token verification is constant-time.** When HTTP auth is enabled, `/mcp` accepts the configured API key or its derived access token and compares it with `crypto.timingSafeEqual` (`src/mcp/oauth.ts:28-52`, `src/mcp/http-transport.ts:129-141`).

**OAuth authorization validates registered redirect URIs and token exchange requires PKCE.** The authorization flow rejects unknown clients and redirect URI mismatches (`src/mcp/oauth.ts:278-288,318-323`). Authorization codes expire after 10 minutes, are single-use, and require an S256 verifier (`src/mcp/oauth.ts:339-345,373-399`). The authorization form accepts at most five POST submissions per 15 minutes per source IP; successful and failed submissions both count (`src/mcp/oauth.ts:160-173,302-308`).

**Specific memory fields have size limits.** Capture and update schemas cap content at 50,000 characters, summaries at 200, topics and people at 20 entries of 100 characters each, and bulk capture at 50 thoughts (`src/tools/helpers.ts:7-13`, `src/mcp/server.ts:161-199,366-374`). These are field limits, not a whole-request or storage quota. Fields such as metadata, source, project identifiers, and relationship arrays are not covered by a total input budget.

**Non-trusted memories never reach `get_brief`.** The brief policy omits every candidate whose `trust_level` is not `trusted`, as well as wrong-project, consolidated, refuted, and non-normal-sensitivity candidates (`src/tools/brief-policy.ts:149-165`). Eligible summaries pass a heuristic gate for injection markers, secrets, personal data, and Markdown controls before rendering (`src/tools/brief-policy.ts:76-99`).

**Non-trusted memory reads are fenced as data.** Full content and summaries from `get_thought`, graph reads, and selected context are wrapped in an `untrusted_memory` block with a caution preamble; list and search summaries receive the same treatment (`src/tools/trust-boundary.ts:4-45`, `src/tools/get.ts:29-38`, `src/tools/graph.ts:150-172`, `src/tools/context.ts:203-226`, `src/tools/list.ts:53-56`, `src/tools/search.ts:255-268`). Delimiter characters in untrusted text are escaped before the wrapper is constructed (`src/tools/trust-boundary.ts:19-38`).

## What is not guaranteed

**HTTP auth is opt-in and off by default.** Without `SHELBY_API_KEY`, `/mcp` accepts requests without authentication and emits only a startup warning (`src/mcp/http-transport.ts:129-141,178-185`).

**HTTP mode binds `0.0.0.0` by default.** Starting HTTP transport without `HOST` or `--host` listens on all interfaces (`src/config.ts:100-114`). On a bare machine, bind `127.0.0.1` and set `SHELBY_API_KEY`.

**There is no DNS-rebinding guard.** The HTTP transport does not validate `Host` or `Origin` before routing requests (`src/mcp/http-transport.ts:110-176`).

**Captured thoughts default to `trusted`.** When a caller omits `trust_level`, the database write path stores `trusted` (`src/mcp/server.ts:168-176`, `src/db/thoughts.ts:187-205`). A compromised or prompt-injected client can therefore create memories eligible for future briefs unless it explicitly marks them `unverified` or `external`.

**OAuth tokens are static and do not expire.** Access and refresh tokens are deterministic HMACs of the API key (`src/mcp/oauth.ts:28-34`). Revocation requires changing `SHELBY_API_KEY`. Dynamic client registration is open to callers that can reach `/register`; the API key entered at `/authorize` remains the authorization gate (`src/mcp/oauth.ts:232-267,302-353`).

**Database file permissions are not explicitly restricted.** The server creates the database directory and SQLite file using the process umask (`src/db/database.ts:10-18`). Set restrictive filesystem permissions if other local users are in your threat model.

**There is no semantic filtering on capture.** Stored content is not classified or rewritten for prompt injection. Trust levels control where content flows, not what the content says.

**Stdio has no per-caller authorization.** All processes able to launch and communicate with the local stdio server have the same access.
