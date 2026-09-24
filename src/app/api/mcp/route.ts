import { NextResponse, type NextRequest } from "next/server";
import { handleMcpRequest, isValidMcpKey } from "@/features/mcp/protocol";
import { MCP_TOOLS } from "@/features/mcp/tools";
import {
  checkRateLimit,
  clearRateLimit,
  extractClientIp,
  recordFailedAttempt,
} from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/mcp — read-only MCP endpoint for the Hermes `mahakan` agent.
 *
 * Deliberately NOT under /api/v1: path mirrors Tetra Ops so the Hermes MCP
 * config is identical across businesses.
 *
 * Auth: `Authorization: Bearer ${MAHAKAN_MCP_API_KEY}`. The key is OWNER-
 * EQUIVALENT (HPP, profit, cash balances). Never hand it to anything facing
 * customers or staff. Unset env = every request refused (no dev bypass).
 *
 * Only POST exists: GET → 405 from Next, which is what Hermes' Streamable
 * HTTP probe expects.
 */
const AUTH_LIMIT = { maxAttempts: 10, windowMs: 15 * 60_000 };

export async function POST(req: NextRequest) {
  const rlKey = `mcp:${extractClientIp(req)}`;
  if (checkRateLimit(rlKey, AUTH_LIMIT).locked) {
    return NextResponse.json({ error: "Terlalu banyak percobaan" }, { status: 429 });
  }
  if (!isValidMcpKey(req.headers.get("authorization"), process.env.MAHAKAN_MCP_API_KEY)) {
    recordFailedAttempt(rlKey, AUTH_LIMIT);
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  clearRateLimit(rlKey);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } },
      { status: 400 },
    );
  }

  const reply = await handleMcpRequest(body, MCP_TOOLS);
  if (reply.body === undefined) return new Response(null, { status: reply.status });
  return NextResponse.json(reply.body, { status: reply.status });
}
