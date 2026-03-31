import { createHmac, createHash, timingSafeEqual } from "node:crypto";
import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { ThoughtDatabase } from "../db/database.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AuthCode {
  clientId: string;
  codeChallenge: string;
  redirectUri: string;
  state: string;
  expiresAt: number;
}

interface OAuthClient {
  client_id: string;
  client_name: string | null;
  redirect_uris: string[];
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const authCodes = new Map<string, AuthCode>();
const rateLimiter = new Map<string, { attempts: number; resetAt: number }>();

// ---------------------------------------------------------------------------
// Pure functions (exported for testing)
// ---------------------------------------------------------------------------

export function deriveAccessToken(apiKey: string): string {
  return createHmac("sha256", apiKey).update("access").digest("hex");
}

export function deriveRefreshToken(apiKey: string): string {
  return createHmac("sha256", apiKey).update("refresh").digest("hex");
}

export function verifyPkce(codeVerifier: string, codeChallenge: string): boolean {
  const computed = createHash("sha256").update(codeVerifier).digest("base64url");
  return computed === codeChallenge;
}

export function verifyBearerToken(token: string, apiKey: string): boolean {
  return safeEqual(token, apiKey) || safeEqual(token, deriveAccessToken(apiKey));
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Placeholder for handlers (implemented in Task 3)
// ---------------------------------------------------------------------------

export function createOAuthHandlers(
  _db: ThoughtDatabase,
  _apiKey: string,
): {
  handleMetadata: (req: IncomingMessage, res: ServerResponse) => void;
  handleRegister: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
  handleAuthorize: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
  handleToken: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
} {
  throw new Error("Not yet implemented");
}
