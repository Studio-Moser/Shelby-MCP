import { describe, it, expect, vi, afterEach } from "vitest";
import { getEmbeddingConfig, generateEmbedding } from "../../src/db/embedding.js";

describe("getEmbeddingConfig (#37)", () => {
  const origEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...origEnv };
  });

  it("defaults to 'none' provider when env var is not set", () => {
    delete process.env.SHELBY_EMBEDDING_PROVIDER;
    const config = getEmbeddingConfig();
    expect(config.provider).toBe("none");
  });

  it("returns 'gemini' provider when SHELBY_EMBEDDING_PROVIDER=gemini", () => {
    process.env.SHELBY_EMBEDDING_PROVIDER = "gemini";
    const config = getEmbeddingConfig();
    expect(config.provider).toBe("gemini");
  });

  it("falls back to 'none' for unknown provider values", () => {
    process.env.SHELBY_EMBEDDING_PROVIDER = "openai";
    const config = getEmbeddingConfig();
    expect(config.provider).toBe("none");
  });

  it("reads GOOGLE_API_KEY", () => {
    process.env.SHELBY_EMBEDDING_PROVIDER = "gemini";
    process.env.GOOGLE_API_KEY = "test-api-key";
    const config = getEmbeddingConfig();
    expect(config.googleApiKey).toBe("test-api-key");
  });

  it("googleApiKey is null when GOOGLE_API_KEY is not set", () => {
    delete process.env.GOOGLE_API_KEY;
    const config = getEmbeddingConfig();
    expect(config.googleApiKey).toBeNull();
  });

  it("defaults dimensions to 1536", () => {
    const config = getEmbeddingConfig();
    expect(config.dimensions).toBe(1536);
  });
});

describe("generateEmbedding (#37)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns null when provider is 'none'", async () => {
    const result = await generateEmbedding("test text", {
      provider: "none",
      googleApiKey: null,
      dimensions: 1536,
    });
    expect(result).toBeNull();
  });

  it("returns null when provider is 'gemini' but no API key", async () => {
    const result = await generateEmbedding("test text", {
      provider: "gemini",
      googleApiKey: null,
      dimensions: 1536,
    });
    expect(result).toBeNull();
  });

  it("returns embedding array when Gemini API succeeds", async () => {
    const mockVector = Array.from({ length: 1536 }, (_, i) => i * 0.001);

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ embedding: { values: mockVector } }),
    }));

    const result = await generateEmbedding("hello world", {
      provider: "gemini",
      googleApiKey: "test-key",
      dimensions: 1536,
    });

    expect(result).not.toBeNull();
    expect(result).toHaveLength(1536);
    expect(result![0]).toBeCloseTo(0);
    expect(result![1]).toBeCloseTo(0.001);
  });

  it("returns null and logs warning when Gemini API fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => "Unauthorized",
    }));

    const result = await generateEmbedding("test text", {
      provider: "gemini",
      googleApiKey: "bad-key",
      dimensions: 1536,
    });

    expect(result).toBeNull();
  });

  it("returns null when fetch throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network error")));

    const result = await generateEmbedding("test text", {
      provider: "gemini",
      googleApiKey: "test-key",
      dimensions: 1536,
    });

    expect(result).toBeNull();
  });

  it("sends output_dimensionality in the request body", async () => {
    let capturedBody: Record<string, unknown> = {};
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (_url: string, opts: { body: string }) => {
      capturedBody = JSON.parse(opts.body) as Record<string, unknown>;
      return {
        ok: true,
        json: async () => ({ embedding: { values: [0.1, 0.2, 0.3] } }),
      };
    }));

    await generateEmbedding("test", {
      provider: "gemini",
      googleApiKey: "test-key",
      dimensions: 1536,
    });

    expect(capturedBody.output_dimensionality).toBe(1536);
  });
});
