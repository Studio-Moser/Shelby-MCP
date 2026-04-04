import { createServer as createHttpServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { ThoughtDatabase } from "../db/database.js";
import { createServerWithDb } from "./server.js";
import { createOAuthHandlers, verifyBearerToken } from "./oauth.js";

const MCP_PATH = "/mcp";
const HEALTH_PATH = "/health";
const MCP_METADATA_PATH = "/.well-known/mcp.json";
const OAUTH_METADATA_PATH = "/.well-known/oauth-authorization-server";
const REGISTER_PATH = "/register";
const AUTHORIZE_PATH = "/authorize";
const TOKEN_PATH = "/token";

export async function startHttpTransport(
  db: ThoughtDatabase,
  host: string,
  port: number,
  apiKey: string | null,
): Promise<Server> {
  const oauthHandlers = apiKey ? createOAuthHandlers(db, apiKey) : null;

  const httpServer = createHttpServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    const path = url.pathname;

    // --- Health check ---
    if (path === HEALTH_PATH && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }

    // --- MCP metadata for registry/crawler discovery ---
    if (path === MCP_METADATA_PATH && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        name: "shelbymcp",
        version: "0.2.6",
        description: "Knowledge-graph memory server for AI tools",
        transport: "streamable-http",
        endpoint: "/mcp",
        capabilities: {
          tools: 9,
          prompts: 3,
          resources: 1,
          logging: true,
          completions: true,
        },
      }));
      return;
    }

    // --- OAuth endpoints (503 if apiKey not configured) ---
    if (path === OAUTH_METADATA_PATH && req.method === "GET") {
      if (!oauthHandlers) { return sendOAuthNotConfigured(res); }
      oauthHandlers.handleMetadata(req, res);
      return;
    }

    if (path === REGISTER_PATH && req.method === "POST") {
      if (!oauthHandlers) { return sendOAuthNotConfigured(res); }
      await oauthHandlers.handleRegister(req, res);
      return;
    }

    if (path === AUTHORIZE_PATH && (req.method === "GET" || req.method === "POST")) {
      if (!oauthHandlers) { return sendOAuthNotConfigured(res); }
      await oauthHandlers.handleAuthorize(req, res);
      return;
    }

    if (path === TOKEN_PATH && req.method === "POST") {
      if (!oauthHandlers) { return sendOAuthNotConfigured(res); }
      await oauthHandlers.handleToken(req, res);
      return;
    }

    // --- MCP endpoint ---
    if (path !== MCP_PATH) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
      return;
    }

    // Bearer token auth for MCP
    if (apiKey) {
      const header = req.headers.authorization ?? "";
      const token = header.startsWith("Bearer ") ? header.slice(7) : "";
      if (!verifyBearerToken(token, apiKey)) {
        res.writeHead(401, {
          "Content-Type": "application/json",
          "WWW-Authenticate": "Bearer",
        });
        res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32001, message: "Unauthorized" }, id: null }));
        return;
      }
    }

    if (req.method === "POST") {
      const server = createServerWithDb(db);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined, // stateless mode
      });

      try {
        await server.connect(transport);
        const body = await readBody(req);
        const parsed = JSON.parse(body);
        await transport.handleRequest(req, res, parsed);
      } catch {
        if (!res.headersSent) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null }));
        }
      } finally {
        res.on("close", () => {
          void transport.close();
          void server.close();
        });
      }
      return;
    }

    if (req.method === "GET" || req.method === "DELETE") {
      res.writeHead(405, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null }));
      return;
    }

    res.writeHead(405, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Method not allowed" }));
  });

  await new Promise<void>((resolve) => {
    httpServer.listen(port, host, () => {
      console.error(`[INFO] ShelbyMCP running on http://${host}:${port}${MCP_PATH}`);
      if (apiKey) {
        console.error("[INFO] Bearer token auth enabled (OAuth + legacy Bearer)");
      } else {
        console.error("[WARN] No SHELBY_API_KEY set — running without auth");
      }
      resolve();
    });
  });

  const shutdown = () => {
    console.error("[INFO] Shutting down HTTP server...");
    httpServer.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  return httpServer;
}

function sendOAuthNotConfigured(res: ServerResponse): void {
  res.writeHead(503, { "Content-Type": "application/json" });
  res.end(JSON.stringify({
    error: "oauth_not_configured",
    error_description: "Set SHELBY_API_KEY to enable OAuth",
  }));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString()));
    req.on("error", reject);
  });
}
