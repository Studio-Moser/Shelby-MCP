/**
 * Server-side embedding generation module.
 *
 * Configured via SHELBY_EMBEDDING_PROVIDER env var:
 *   - "gemini"  → Google Gemini Embedding 2 (text-embedding-004, 1536-dim via MRL)
 *   - "none"    → Disabled (default; embeddings must be provided by the calling agent)
 *
 * When enabled (SHELBY_EMBEDDING_PROVIDER=gemini), the server will automatically
 * generate and store embeddings for new thoughts captured via capture_thought.
 * The GOOGLE_API_KEY env var is required.
 *
 * Dimensions: 1536 (matches the existing schema; Gemini text-embedding-004
 * supports MRL output_dimensionality parameter).
 */

export type EmbeddingProvider = "gemini" | "none";

export interface EmbeddingConfig {
  provider: EmbeddingProvider;
  googleApiKey: string | null;
  /** Output dimensionality (default 1536, matches existing schema) */
  dimensions: number;
}

const GEMINI_EMBEDDING_MODEL = "text-embedding-004";
const DEFAULT_DIMENSIONS = 1536;

export function getEmbeddingConfig(): EmbeddingConfig {
  const raw = (process.env.SHELBY_EMBEDDING_PROVIDER ?? "none").toLowerCase();
  const provider: EmbeddingProvider = raw === "gemini" ? "gemini" : "none";
  return {
    provider,
    googleApiKey: process.env.GOOGLE_API_KEY ?? null,
    dimensions: DEFAULT_DIMENSIONS,
  };
}

/**
 * Generate an embedding vector for the given text using the configured provider.
 * Returns null if the provider is "none" or if generation fails.
 */
export async function generateEmbedding(
  text: string,
  config: EmbeddingConfig,
): Promise<number[] | null> {
  if (config.provider === "none") return null;
  if (config.provider === "gemini") {
    return generateGeminiEmbedding(text, config);
  }
  return null;
}

async function generateGeminiEmbedding(
  text: string,
  config: EmbeddingConfig,
): Promise<number[] | null> {
  if (!config.googleApiKey) {
    console.error("[WARN] Gemini embedding provider enabled but GOOGLE_API_KEY is not set");
    return null;
  }

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_EMBEDDING_MODEL}:embedContent?key=${config.googleApiKey}`;

    const body = {
      model: `models/${GEMINI_EMBEDDING_MODEL}`,
      content: { parts: [{ text }] },
      output_dimensionality: config.dimensions,
    };

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`[WARN] Gemini embedding request failed (${response.status}): ${errText}`);
      return null;
    }

    const data = (await response.json()) as {
      embedding?: { values?: number[] };
    };

    const values = data.embedding?.values;
    if (!Array.isArray(values) || values.length === 0) {
      console.error("[WARN] Gemini embedding response missing values");
      return null;
    }

    return values;
  } catch (err) {
    console.error(`[WARN] Gemini embedding generation error: ${String(err)}`);
    return null;
  }
}
