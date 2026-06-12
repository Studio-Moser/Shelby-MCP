import { describe, it, expect } from "vitest";
import { pickResolutionDir } from "../../src/mcp/resolve-dir.js";

describe("pickResolutionDir", () => {
  it("prefers the first file:// client root over the fallback cwd", () => {
    expect(pickResolutionDir([{ uri: "file:///Users/tim/Projects/Shelby" }], "/")).toBe("/Users/tim/Projects/Shelby");
  });
  it("falls back to cwd when there are no roots", () => {
    expect(pickResolutionDir([], "/fallback")).toBe("/fallback");
    expect(pickResolutionDir(undefined, "/fallback")).toBe("/fallback");
  });
  it("ignores non-file roots", () => {
    expect(pickResolutionDir([{ uri: "https://example.com" }], "/fallback")).toBe("/fallback");
  });
});
