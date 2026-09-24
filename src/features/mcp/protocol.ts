/**
 * Minimal MCP (Model Context Protocol) server, Streamable HTTP without
 * sessions: one JSON-RPC POST = one JSON reply. Consumed by the Hermes
 * `mahakan` agent (owner-only). Mirrors Tetra Ops `src/lib/ai/mcp.ts` so the
 * Hermes side needs no adjustment.
 *
 * Deliberately SDK-free and without `server-only`, so it is unit-testable.
 * Phase 1 is read-only: every tool is annotated `readOnlyHint: true`.
 *
 * ponytail: no sessions/SSE/batch — add when a client demands it. Write tools
 * (phase 2) follow Tetra's `<name>_usulan` → `<name>` + `konfirmasi: true`.
 */

import { createHash, timingSafeEqual } from "node:crypto";

const PROTOCOL_VERSION = "2025-06-18";

export type JsonSchema = {
  type: "object";
  properties?: Record<string, Record<string, unknown>>;
  required?: string[];
};

export type McpTool = {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  run: (args: Record<string, unknown>) => Promise<unknown>;
};

export type McpReply = { status: number; body?: unknown };

type JsonRpcId = string | number | null;
type JsonRpcRequest = {
  id?: JsonRpcId;
  method?: string;
  params?: Record<string, unknown>;
};

/** Thrown by tools for expected, user-facing failures (bad args, no data). */
export class ToolError extends Error {}

function sha256(s: string): Buffer {
  return createHash("sha256").update(s).digest();
}

/** Bearer check, timing-safe (hashing first makes both buffers equal length). */
export function isValidMcpKey(
  header: string | null,
  expected: string | undefined,
): boolean {
  if (!expected || !header?.startsWith("Bearer ")) return false;
  return timingSafeEqual(sha256(header.slice(7)), sha256(expected));
}

function ok(id: JsonRpcId, result: unknown): McpReply {
  return { status: 200, body: { jsonrpc: "2.0", id, result } };
}

function fail(id: JsonRpcId, code: number, message: string): McpReply {
  return { status: 200, body: { jsonrpc: "2.0", id, error: { code, message } } };
}

function toolResult(id: JsonRpcId, result: unknown, isError: boolean) {
  return ok(id, {
    content: [{ type: "text", text: JSON.stringify(result) }],
    isError,
  });
}

export function listMcpTools(tools: McpTool[]) {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
    annotations: { readOnlyHint: true },
  }));
}

export async function handleMcpRequest(
  raw: unknown,
  tools: McpTool[],
): Promise<McpReply> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return fail(null, -32600, "Invalid Request");
  }
  const req = raw as JsonRpcRequest;
  const id = req.id ?? null;
  const method = req.method ?? "";
  const params = req.params ?? {};

  // Notifications (no id) need no reply.
  if (method.startsWith("notifications/")) return { status: 202 };

  switch (method) {
    case "initialize":
      return ok(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: "mahakan-pos", version: "1.0.0" },
        instructions:
          "Data Mahakan Coffee & Space (satu outlet, Cisarua). Tanggal memakai kalender WIB (YYYY-MM-DD); " +
          "uang dalam Rupiah bulat. Semua tool hanya membaca.",
      });
    case "ping":
      return ok(id, {});
    case "tools/list":
      return ok(id, { tools: listMcpTools(tools) });
    case "tools/call": {
      const name = String(params.name ?? "");
      const args =
        params.arguments && typeof params.arguments === "object"
          ? (params.arguments as Record<string, unknown>)
          : {};
      const tool = tools.find((t) => t.name === name);
      if (!tool) return fail(id, -32602, `Unknown tool: ${name}`);
      try {
        return toolResult(id, await tool.run(args), false);
      } catch (e) {
        // Expected errors carry their own Indonesian message; anything else
        // is a bug — never leak the stack or SQL to the model.
        if (!(e instanceof ToolError)) console.error(`[mcp] ${name} failed`, e);
        const msg =
          e instanceof ToolError ? e.message : "Gagal membaca data, coba lagi nanti.";
        return toolResult(id, { error: msg }, true);
      }
    }
    default:
      return fail(id, -32601, `Method not found: ${method}`);
  }
}
