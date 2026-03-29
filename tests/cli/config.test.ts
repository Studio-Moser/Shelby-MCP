import { describe, it, expect } from "vitest";
import { parseArgs } from "../../src/config.js";

describe("parseArgs", () => {
  describe("commands", () => {
    it("parses 'help' command", () => {
      expect(parseArgs(["help"])).toEqual({ command: "help" });
    });

    it("parses '--help' flag", () => {
      expect(parseArgs(["--help"])).toEqual({ command: "help" });
    });

    it("parses '-h' flag", () => {
      expect(parseArgs(["-h"])).toEqual({ command: "help" });
    });

    it("parses 'protocol' command", () => {
      expect(parseArgs(["protocol"])).toEqual({ command: "protocol" });
    });

    it("parses 'forage' command", () => {
      expect(parseArgs(["forage"])).toEqual({ command: "forage" });
    });

    it("parses 'setup' with agent", () => {
      expect(parseArgs(["setup", "claude-code"])).toEqual({
        command: "setup",
        agent: "claude-code",
        forage: false,
        onboard: false,
      });
    });

    it("parses 'setup' with agent and --forage", () => {
      expect(parseArgs(["setup", "cursor", "--forage"])).toEqual({
        command: "setup",
        agent: "cursor",
        forage: true,
        onboard: false,
      });
    });

    it("parses 'setup' with no agent", () => {
      expect(parseArgs(["setup"])).toEqual({
        command: "setup",
        agent: undefined,
        forage: false,
        onboard: false,
      });
    });

    it("parses 'setup' with only --forage (no agent)", () => {
      const result = parseArgs(["setup", "--forage"]);
      expect(result).toEqual({
        command: "setup",
        agent: undefined,
        forage: true,
        onboard: false,
      });
    });

    it("parses 'onboard' command", () => {
      expect(parseArgs(["onboard"])).toEqual({ command: "onboard" });
    });

    it("parses 'migrate' command", () => {
      expect(parseArgs(["migrate"])).toEqual({ command: "migrate" });
    });

    it("parses 'uninstall' with agent", () => {
      expect(parseArgs(["uninstall", "gemini"])).toEqual({
        command: "uninstall",
        agent: "gemini",
      });
    });

    it("parses 'uninstall' with no agent", () => {
      expect(parseArgs(["uninstall"])).toEqual({
        command: "uninstall",
        agent: undefined,
      });
    });

    it("parses '--version'", () => {
      expect(parseArgs(["--version"])).toBe("version");
    });
  });

  describe("server mode flags", () => {
    it("returns default config with no args", () => {
      const config = parseArgs([]);
      expect(config).toMatchObject({
        verbose: false,
        logFile: null,
      });
      expect((config as any).dbPath).toContain(".shelbymcp");
      expect((config as any).dbPath).toContain("memory.db");
    });

    it("parses --verbose", () => {
      const config = parseArgs(["--verbose"]);
      expect((config as any).verbose).toBe(true);
    });

    it("parses --db with custom path", () => {
      const config = parseArgs(["--db", "/tmp/test.db"]);
      expect((config as any).dbPath).toBe("/tmp/test.db");
    });

    it("parses --log-file", () => {
      const config = parseArgs(["--log-file", "/tmp/shelby.log"]);
      expect((config as any).logFile).toBe("/tmp/shelby.log");
    });

    it("parses combined flags", () => {
      const config = parseArgs(["--verbose", "--db", "/tmp/test.db"]);
      expect((config as any).verbose).toBe(true);
      expect((config as any).dbPath).toBe("/tmp/test.db");
    });
  });
});
