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
