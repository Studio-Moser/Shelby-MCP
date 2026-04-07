/**
 * OWASP ASI06 — Memory Poisoning: input length limit tests
 *
 * Verifies that capture_thought and update_thought enforce maximum length caps
 * on content, summary, topics, and people fields to prevent large-payload
 * memory injection attacks from a compromised or malicious AI tool.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ThoughtDatabase } from "../../src/db/database.js";
import { handleCaptureThought } from "../../src/tools/capture.js";
import { handleUpdateThought } from "../../src/tools/update.js";
import {
  MAX_CONTENT_LENGTH,
  MAX_SUMMARY_LENGTH,
  MAX_TOPICS_COUNT,
  MAX_TOPIC_LENGTH,
  MAX_PEOPLE_COUNT,
  MAX_PERSON_LENGTH,
  MAX_BULK_THOUGHTS,
} from "../../src/tools/helpers.js";

let db: ThoughtDatabase;

beforeEach(() => {
  db = new ThoughtDatabase(":memory:");
});

afterEach(() => {
  db.close();
});

function isError(result: object): boolean {
  return (result as { isError?: boolean }).isError === true;
}

function errorMessage(result: object): string {
  const r = result as { content: Array<{ text: string }> };
  return JSON.parse(r.content[0].text).message as string;
}

function captureId(content: string): string {
  const result = handleCaptureThought(db, { content });
  const r = result as { content: Array<{ text: string }> };
  return (JSON.parse(r.content[0].text) as { id: string }).id;
}

// ---------------------------------------------------------------------------
// capture_thought
// ---------------------------------------------------------------------------

describe("capture_thought — input length limits", () => {
  it("accepts content at exactly the max length", () => {
    const content = "x".repeat(MAX_CONTENT_LENGTH);
    const result = handleCaptureThought(db, { content });
    expect(isError(result)).toBe(false);
  });

  it("rejects content exceeding max length", () => {
    const content = "x".repeat(MAX_CONTENT_LENGTH + 1);
    const result = handleCaptureThought(db, { content });
    expect(isError(result)).toBe(true);
    expect(errorMessage(result)).toContain("content exceeds maximum length");
  });

  it("accepts summary at exactly the max length", () => {
    const result = handleCaptureThought(db, {
      content: "Valid content",
      summary: "s".repeat(MAX_SUMMARY_LENGTH),
    });
    expect(isError(result)).toBe(false);
  });

  it("rejects summary exceeding max length", () => {
    const result = handleCaptureThought(db, {
      content: "Valid content",
      summary: "s".repeat(MAX_SUMMARY_LENGTH + 1),
    });
    expect(isError(result)).toBe(true);
    expect(errorMessage(result)).toContain("summary exceeds maximum length");
  });

  it("rejects topics array exceeding max count", () => {
    const topics = Array.from({ length: MAX_TOPICS_COUNT + 1 }, (_, i) => `topic${i}`);
    const result = handleCaptureThought(db, { content: "Valid content", topics });
    expect(isError(result)).toBe(true);
    expect(errorMessage(result)).toContain("topics array exceeds maximum");
  });

  it("rejects a topic string exceeding max length", () => {
    const topics = ["t".repeat(MAX_TOPIC_LENGTH + 1)];
    const result = handleCaptureThought(db, { content: "Valid content", topics });
    expect(isError(result)).toBe(true);
    expect(errorMessage(result)).toContain("exceeds maximum length");
  });

  it("rejects people array exceeding max count", () => {
    const people = Array.from({ length: MAX_PEOPLE_COUNT + 1 }, (_, i) => `person${i}`);
    const result = handleCaptureThought(db, { content: "Valid content", people });
    expect(isError(result)).toBe(true);
    expect(errorMessage(result)).toContain("people array exceeds maximum");
  });

  it("rejects a person string exceeding max length", () => {
    const people = ["p".repeat(MAX_PERSON_LENGTH + 1)];
    const result = handleCaptureThought(db, { content: "Valid content", people });
    expect(isError(result)).toBe(true);
    expect(errorMessage(result)).toContain("exceeds maximum length");
  });
});

// ---------------------------------------------------------------------------
// capture_thought — bulk mode
// ---------------------------------------------------------------------------

describe("capture_thought (bulk) — input length limits", () => {
  it("rejects bulk array exceeding max count", () => {
    const thoughts = Array.from({ length: MAX_BULK_THOUGHTS + 1 }, (_, i) => ({
      content: `thought ${i}`,
    }));
    const result = handleCaptureThought(db, { thoughts });
    expect(isError(result)).toBe(true);
    expect(errorMessage(result)).toContain("bulk capture exceeds maximum");
  });

  it("rejects a bulk thought with oversized content", () => {
    const thoughts = [{ content: "x".repeat(MAX_CONTENT_LENGTH + 1) }];
    const result = handleCaptureThought(db, { thoughts });
    expect(isError(result)).toBe(true);
    expect(errorMessage(result)).toContain("content exceeds maximum length");
  });

  it("rejects a bulk thought with oversized summary", () => {
    const thoughts = [{ content: "Valid", summary: "s".repeat(MAX_SUMMARY_LENGTH + 1) }];
    const result = handleCaptureThought(db, { thoughts });
    expect(isError(result)).toBe(true);
    expect(errorMessage(result)).toContain("summary exceeds maximum length");
  });

  it("accepts bulk array at exactly max count", () => {
    const thoughts = Array.from({ length: MAX_BULK_THOUGHTS }, (_, i) => ({
      content: `thought ${i}`,
    }));
    const result = handleCaptureThought(db, { thoughts });
    expect(isError(result)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// update_thought
// ---------------------------------------------------------------------------

describe("update_thought — input length limits", () => {
  it("rejects update with content exceeding max length", () => {
    const id = captureId("Original");
    const result = handleUpdateThought(db, {
      id,
      content: "x".repeat(MAX_CONTENT_LENGTH + 1),
    });
    expect(isError(result)).toBe(true);
    expect(errorMessage(result)).toContain("content exceeds maximum length");
  });

  it("rejects update with summary exceeding max length", () => {
    const id = captureId("Original");
    const result = handleUpdateThought(db, {
      id,
      summary: "s".repeat(MAX_SUMMARY_LENGTH + 1),
    });
    expect(isError(result)).toBe(true);
    expect(errorMessage(result)).toContain("summary exceeds maximum length");
  });

  it("rejects update with topics array exceeding max count", () => {
    const id = captureId("Original");
    const topics = Array.from({ length: MAX_TOPICS_COUNT + 1 }, (_, i) => `topic${i}`);
    const result = handleUpdateThought(db, { id, topics });
    expect(isError(result)).toBe(true);
    expect(errorMessage(result)).toContain("topics array exceeds maximum");
  });

  it("rejects update with a topic string exceeding max length", () => {
    const id = captureId("Original");
    const result = handleUpdateThought(db, {
      id,
      topics: ["t".repeat(MAX_TOPIC_LENGTH + 1)],
    });
    expect(isError(result)).toBe(true);
    expect(errorMessage(result)).toContain("exceeds maximum length");
  });

  it("rejects update with people array exceeding max count", () => {
    const id = captureId("Original");
    const people = Array.from({ length: MAX_PEOPLE_COUNT + 1 }, (_, i) => `person${i}`);
    const result = handleUpdateThought(db, { id, people });
    expect(isError(result)).toBe(true);
    expect(errorMessage(result)).toContain("people array exceeds maximum");
  });

  it("rejects update with a person string exceeding max length", () => {
    const id = captureId("Original");
    const result = handleUpdateThought(db, {
      id,
      people: ["p".repeat(MAX_PERSON_LENGTH + 1)],
    });
    expect(isError(result)).toBe(true);
    expect(errorMessage(result)).toContain("exceeds maximum length");
  });

  it("accepts update with content at exactly max length", () => {
    const id = captureId("Original");
    const result = handleUpdateThought(db, {
      id,
      content: "x".repeat(MAX_CONTENT_LENGTH),
    });
    expect(isError(result)).toBe(false);
  });
});
