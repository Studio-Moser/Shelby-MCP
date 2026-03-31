import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { ThoughtDatabase } from "../db/database.js";
import { createServerWithDb } from "./server.js";

const MCP_PATH = "/mcp";
const HEALTH_PATH = "/health";

export async function startHttpTransport(
  db: ThoughtDatabase,
  host: string,
  port: number,
  apiKey: string | null,
): Promise<void> {
  const httpServer = createHttpServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);

    // Health check — always unauthenticated
    if (url.pathname === HEALTH_PATH && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }

    if (url.pathname !== MCP_PATH) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
      return;
    }

    // Bearer token auth
    if (apiKey && !verifyAuth(req, apiKey)) {
      res.writeHead(401, {
        "Content-Type": "application/json",
        "WWW-Authenticate": "Bearer",
      });
      res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32001, message: "Unauthorized" }, id: null }));
      return;
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
          transport.close();
          server.close();
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

  httpServer.listen(port, host, () => {
    console.error(`[INFO] ShelbyMCP running on http://${host}:${port}${MCP_PATH}`);
    if (apiKey) {
      console.error("[INFO] Bearer token auth enabled");
    } else {
      console.error("[WARN] No SHELBY_API_KEY set — running without auth");
    }
  });

  const shutdown = () => {
    console.error("[INFO] Shutting down HTTP server...");
    httpServer.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

function verifyAuth(req: IncomingMessage, apiKey: string): boolean {
  const header = req.headers.authorization;
  if (!header) return false;
  const [scheme, token] = header.split(" ", 2);
  return scheme === "Bearer" && token === apiKey;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString()));
    req.on("error", reject);
  });
}
