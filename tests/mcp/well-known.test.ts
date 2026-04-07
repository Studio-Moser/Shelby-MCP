import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { startHttpTransport } from "../../src/mcp/http-transport.js";
import { ThoughtDatabase } from "../../src/db/database.js";
import type { Server } from "node:http";

const pkg = JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf-8")) as { version: string };

describe(".well-known/mcp.json", () => {
  let server: Server;
  let db: ThoughtDatabase;
  const PORT = 9877;

  afterEach(() => {
    server?.close();
    db?.close();
  });

  it("returns MCP metadata with correct fields", async () => {
    db = new ThoughtDatabase(":memory:");
    server = await startHttpTransport(db, "127.0.0.1", PORT, null);

    const res = await fetch(`http://127.0.0.1:${PORT}/.well-known/mcp.json`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");

    const body = await res.json() as Record<string, unknown>;
    expect(body.name).toBe("shelbymcp");
    expect(body.version).toBe(pkg.version);
    expect(typeof body.version).toBe("string");
    expect(body.transport).toBe("streamable-http");
    expect(body.endpoint).toBe("/mcp");
    expect(body.capabilities).toBeDefined();
    const caps = body.capabilities as Record<string, unknown>;
    expect(caps.tools).toBe(9);
    expect(caps.prompts).toBe(3);
  });

  it("does not require authentication", async () => {
    db = new ThoughtDatabase(":memory:");
    server = await startHttpTransport(db, "127.0.0.1", PORT, "test-secret-key");

    const res = await fetch(`http://127.0.0.1:${PORT}/.well-known/mcp.json`);
    expect(res.status).toBe(200);
  });
});

describe(".well-known/mcp/server.json (MCP Registry v0.1)", () => {
  let server: Server;
  let db: ThoughtDatabase;
  const PORT = 9878;

  afterEach(() => {
    server?.close();
    db?.close();
  });

  it("returns server metadata at canonical auto-discovery path", async () => {
    db = new ThoughtDatabase(":memory:");
    server = await startHttpTransport(db, "127.0.0.1", PORT, null);

    const res = await fetch(`http://127.0.0.1:${PORT}/.well-known/mcp/server.json`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");

    const body = await res.json() as Record<string, unknown>;
    expect(body.name).toBe("shelbymcp");
    expect(body.version).toBe(pkg.version);
    expect(typeof body.version).toBe("string");
    expect(body.transport).toBe("streamable-http");
    expect(body.endpoint).toBe("/mcp");
    expect(body.capabilities).toBeDefined();
    const caps = body.capabilities as Record<string, unknown>;
    expect(caps.tools).toBe(9);
    expect(caps.prompts).toBe(3);
  });

  it("does not require authentication", async () => {
    db = new ThoughtDatabase(":memory:");
    server = await startHttpTransport(db, "127.0.0.1", PORT, "test-secret-key");

    const res = await fetch(`http://127.0.0.1:${PORT}/.well-known/mcp/server.json`);
    expect(res.status).toBe(200);
  });
});
