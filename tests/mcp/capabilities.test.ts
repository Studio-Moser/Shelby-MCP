import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { LoggingMessageNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { createServer } from "../../src/mcp/server.js";
import type { ThoughtDatabase } from "../../src/db/database.js";

describe("MCP Capabilities", () => {
  let client: Client;
  let db: ThoughtDatabase;

  beforeEach(async () => {
    const created = createServer({ dbPath: ":memory:", verbose: false, logFile: null });
    db = created.db;
    const server = created.server;

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await server.connect(serverTransport);
    client = new Client({ name: "test-client", version: "1.0.0" });
    await client.connect(clientTransport);
  });

  afterEach(() => {
    db?.close();
  });

  // ---- Capabilities ----

  it("advertises all expected capabilities", () => {
    const caps = client.getServerCapabilities();
    expect(caps?.tools).toBeDefined();
    expect(caps?.resources).toBeDefined();
    expect(caps?.prompts).toBeDefined();
    expect(caps?.completions).toBeDefined();
    expect(caps?.logging).toBeDefined();
  });

  // ---- Resources ----

  describe("resources", () => {
    it("lists the status resource", async () => {
      const { resources } = await client.listResources();
      expect(resources).toHaveLength(1);
      expect(resources[0].uri).toBe("shelbymcp://status");
    });

    it("reads the status resource", async () => {
      const { contents } = await client.readResource({ uri: "shelbymcp://status" });
      expect(contents).toHaveLength(1);
      const parsed = JSON.parse((contents[0] as { text: string }).text);
      expect(parsed.status).toBe("ok");
    });
  });

  // ---- Prompts ----

  describe("prompts", () => {
    it("lists all three prompts", async () => {
      const { prompts } = await client.listPrompts();
      const names = prompts.map((p) => p.name).sort();
      expect(names).toEqual(["memory-protocol", "save-guide", "tool-guide"]);
    });

    it("gets the memory-protocol prompt", async () => {
      const result = await client.getPrompt({ name: "memory-protocol" });
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].role).toBe("user");
      const content = result.messages[0].content as { type: string; text: string };
      expect(content.text).toContain("Memory Protocol");
      expect(content.text).toContain("capture_thought");
    });

    it("gets the save-guide prompt", async () => {
      const result = await client.getPrompt({ name: "save-guide" });
      expect(result.messages).toHaveLength(1);
      const content = result.messages[0].content as { type: string; text: string };
      expect(content.text).toContain("Summary first");
    });

    it("gets the tool-guide prompt", async () => {
      const result = await client.getPrompt({ name: "tool-guide" });
      expect(result.messages).toHaveLength(1);
      const content = result.messages[0].content as { type: string; text: string };
      expect(content.text).toContain("capture_thought");
      expect(content.text).toContain("search_thoughts");
      expect(content.text).toContain("manage_edges");
    });
  });

  // ---- Completion ----

  describe("completion", () => {
    beforeEach(async () => {
      // Seed data for completion
      await client.callTool({
        name: "capture_thought",
        arguments: {
          content: "Auth architecture",
          topics: ["auth", "api-design", "architecture"],
          people: ["Alice", "Bob"],
          project: "shelby",
          source: "claude-code",
          type: "decision",
        },
      });
      await client.callTool({
        name: "capture_thought",
        arguments: {
          content: "MCP integration",
          topics: ["mcp", "api-design"],
          people: ["Charlie"],
          project: "shelby-app",
          source: "cursor",
          type: "note",
        },
      });
    });

    it("completes topic names", async () => {
      const result = await client.complete({
        ref: { type: "ref/prompt", name: "memory-protocol" },
        argument: { name: "topic", value: "a" },
      });
      expect(result.completion.values.sort()).toEqual(["api-design", "architecture", "auth"]);
    });

    it("completes people names", async () => {
      const result = await client.complete({
        ref: { type: "ref/prompt", name: "memory-protocol" },
        argument: { name: "people", value: "" },
      });
      expect(result.completion.values.sort()).toEqual(["Alice", "Bob", "Charlie"]);
    });

    it("completes project names", async () => {
      const result = await client.complete({
        ref: { type: "ref/prompt", name: "memory-protocol" },
        argument: { name: "project", value: "shelby" },
      });
      expect(result.completion.values.sort()).toEqual(["shelby", "shelby-app"]);
    });

    it("completes type from static list", async () => {
      const result = await client.complete({
        ref: { type: "ref/prompt", name: "memory-protocol" },
        argument: { name: "type", value: "d" },
      });
      expect(result.completion.values).toEqual(["decision"]);
    });

    it("completes source names", async () => {
      const result = await client.complete({
        ref: { type: "ref/prompt", name: "memory-protocol" },
        argument: { name: "source", value: "c" },
      });
      expect(result.completion.values.sort()).toEqual(["claude-code", "cursor"]);
    });

    it("completes edge_type from static list", async () => {
      const result = await client.complete({
        ref: { type: "ref/prompt", name: "memory-protocol" },
        argument: { name: "edge_type", value: "re" },
      });
      expect(result.completion.values.sort()).toEqual(["refines", "refuted_by", "related"]);
    });

    it("returns empty for unknown argument name", async () => {
      const result = await client.complete({
        ref: { type: "ref/prompt", name: "memory-protocol" },
        argument: { name: "nonexistent", value: "" },
      });
      expect(result.completion.values).toEqual([]);
    });

    it("returns empty for no-match prefix", async () => {
      const result = await client.complete({
        ref: { type: "ref/prompt", name: "memory-protocol" },
        argument: { name: "topic", value: "zzz" },
      });
      expect(result.completion.values).toEqual([]);
    });
  });

  // ---- Logging ----

  describe("logging", () => {
    it("emits log notifications on tool calls", async () => {
      const logs: Array<{ level: string; logger: string; data: unknown }> = [];

      client.setNotificationHandler(
        LoggingMessageNotificationSchema,
        (notification) => {
          logs.push(notification.params);
        },
      );

      // Set log level to debug to see all messages
      await client.setLoggingLevel("debug");

      await client.callTool({
        name: "thought_stats",
        arguments: {},
      });

      // Give async log notifications time to arrive
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Should have at least an invoked and completed log
      const statsLogs = logs.filter((l) => l.logger === "thought_stats");
      expect(statsLogs.length).toBeGreaterThanOrEqual(1);
    });
  });
});
