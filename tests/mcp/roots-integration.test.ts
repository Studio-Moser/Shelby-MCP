import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ListRootsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ThoughtDatabase } from "../../src/db/database.js";
import { upsertProject } from "../../src/db/projects.js";
import { createServerWithDb } from "../../src/mcp/server.js";

let db: ThoughtDatabase | undefined;
afterEach(() => db?.close());

describe("initial MCP roots", () => {
  it("awaits a delayed roots response before the first scoped tool call", async () => {
    const root = mkdtempSync(join(tmpdir(), "roots-race-"));
    mkdirSync(join(root, ".git"));
    writeFileSync(join(root, ".git", "config"), '[remote "origin"]\n\turl = https://github.com/acme/scoped.git\n');

    db = new ThoughtDatabase(":memory:");
    upsertProject(db.db, { slug: "scoped", displayName: "Scoped", memberRepos: ["github.com/acme/scoped"], memberPaths: [], provisional: false });
    const server = createServerWithDb(db);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);

    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const client = new Client({ name: "roots-client", version: "1.0.0" }, { capabilities: { roots: { listChanged: true } } });
    let rootsRequests = 0;
    client.setRequestHandler(ListRootsRequestSchema, async () => {
      rootsRequests += 1;
      await gate;
      return { roots: [{ uri: pathToFileURL(root).href, name: "scoped" }] };
    });
    await client.connect(clientTransport);

    let settled = false;
    const call = client.callTool({ name: "list_thoughts", arguments: {} }).then((result) => {
      settled = true;
      return result;
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(settled).toBe(false);

    release();
    const result = await call;
    expect(result.isError).not.toBe(true);
    expect(rootsRequests).toBe(1);

    await client.sendRootsListChanged();
    await client.callTool({ name: "list_thoughts", arguments: {} });
    expect(rootsRequests).toBe(2);
  });
});
