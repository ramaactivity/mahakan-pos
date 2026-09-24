import { beforeEach, describe, expect, it, vi } from "vitest";
import { __resetRateLimitForTests } from "@/lib/rate-limit";

vi.mock("@/features/mcp/tools", () => ({ MCP_TOOLS: [] }));
const { POST } = await import("@/app/api/mcp/route");

const req = (auth?: string, ip = "1.2.3.4") =>
  new Request("http://x/api/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip, ...(auth ? { authorization: auth } : {}) },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  }) as Parameters<typeof POST>[0];

beforeEach(() => {
  __resetRateLimitForTests();
  vi.stubEnv("MAHAKAN_MCP_API_KEY", "rahasia");
});

describe("POST /api/mcp", () => {
  it("401 without key or with a wrong key, 200 with the right one", async () => {
    expect((await POST(req())).status).toBe(401);
    expect((await POST(req("Bearer salah"))).status).toBe(401);
    const ok = await POST(req("Bearer rahasia"));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ result: { tools: [] } });
  });

  it("401 when the env key is not configured", async () => {
    vi.stubEnv("MAHAKAN_MCP_API_KEY", "");
    expect((await POST(req("Bearer "))).status).toBe(401);
  });

  it("locks an IP out after 10 failures", async () => {
    for (let i = 0; i < 10; i++) await POST(req("Bearer salah", "9.9.9.9"));
    expect((await POST(req("Bearer rahasia", "9.9.9.9"))).status).toBe(429);
    expect((await POST(req("Bearer rahasia", "5.5.5.5"))).status).toBe(200);
  });
});
