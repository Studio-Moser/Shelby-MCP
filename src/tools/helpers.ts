// ---------------------------------------------------------------------------
// Input length limits (OWASP ASI06 — memory poisoning mitigation)
// ---------------------------------------------------------------------------
// These caps prevent a malicious or compromised AI tool from flooding the
// memory store with arbitrarily large content that could be used for prompt
// injection at retrieval time or to exhaust storage.
export const MAX_CONTENT_LENGTH = 50_000; // ~50 KB
export const MAX_SUMMARY_LENGTH = 200;
export const MAX_TOPIC_LENGTH = 100;
export const MAX_TOPICS_COUNT = 20;
export const MAX_PEOPLE_COUNT = 20;
export const MAX_PERSON_LENGTH = 100;
export const MAX_BULK_THOUGHTS = 50;

export interface ToolResult {
  [key: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

export function toolSuccess(data: unknown): ToolResult {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

export function toolError(category: string, message: string): ToolResult {
  return {
    isError: true,
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({ error: category, message }),
      },
    ],
  };
}

export function clampLimit(limit: number | undefined, defaultVal = 20, max = 100): number {
  const val = limit ?? defaultVal;
  return Math.max(1, Math.min(val, max));
}
