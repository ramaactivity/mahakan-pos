import { describe, expect, it } from "vitest";
import { handleMcpRequest, isValidMcpKey, ToolError, type McpTool } from "./protocol";

const echo: McpTool = {
  name: "echo",
  description: "kembalikan argumen",
  inputSchema: { type: "object", properties: { teks: { type: "string" } } },
  async run(args) {
    if (args.teks === "salah") throw new ToolError("Tanggal tidak valid");
    if (args.teks === "boom") throw new Error("SELECT * FROM secret failed");
    return { teks: args.teks };
  },
};

const call = (name: string, args: Record<string, unknown> = {}) =>
  handleMcpRequest(
    { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } },
    [echo],
  );

const text = (r: { body?: unknown }) =>
  JSON.parse((r.body as { result: { content: [{ text: string }] } }).result.content[0].text);

describe("mcp auth", () => {
  it("rejects missing, wrong and unconfigured keys; accepts the right one", () => {
    expect(isValidMcpKey(null, "k")).toBe(false);
    expect(isValidMcpKey("Bearer x", "k")).toBe(false);
    expect(isValidMcpKey("k", "k")).toBe(false);
    expect(isValidMcpKey("Bearer k", undefined)).toBe(false);
    expect(isValidMcpKey("Bearer ", "")).toBe(false);
    expect(isValidMcpKey("Bearer k", "k")).toBe(true);
  });
});

describe("mcp protocol", () => {
  it("initialize + tools/list mark every tool read-only", async () => {
    const init = await handleMcpRequest({ id: 1, method: "initialize" }, [echo]);
    expect(init.status).toBe(200);
    const list = await handleMcpRequest({ id: 2, method: "tools/list" }, [echo]);
    const tools = (list.body as { result: { tools: Array<Record<string, unknown>> } }).result.tools;
    expect(tools[0]).toMatchObject({ name: "echo", annotations: { readOnlyHint: true } });
  });

  it("tools/call: success, expected error, hidden internal error, unknown tool", async () => {
    expect(text(await call("echo", { teks: "hai" }))).toEqual({ teks: "hai" });
    expect(text(await call("echo", { teks: "salah" }))).toEqual({ error: "Tanggal tidak valid" });
    const boom = text(await call("echo", { teks: "boom" }));
    expect(JSON.stringify(boom)).not.toContain("SELECT");
    const unknown = await call("nope");
    expect((unknown.body as { error: { code: number } }).error.code).toBe(-32602);
  });

  it("notifications get 202 without body; bad payload is Invalid Request", async () => {
    expect(await handleMcpRequest({ method: "notifications/initialized" }, [echo])).toEqual({
      status: 202,
    });
    const bad = await handleMcpRequest([], [echo]);
    expect((bad.body as { error: { code: number } }).error.code).toBe(-32600);
  });
});
