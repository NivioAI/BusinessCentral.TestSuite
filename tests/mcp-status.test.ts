import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppController } from "../src/main/controller";
import { McpBridge } from "../src/main/mcp-bridge";
import { MCP_TOOLS, toolForBridgeMethod } from "../src/shared/mcp-tools";

const bridges: McpBridge[] = [];
afterEach(async () => {
  await Promise.all(bridges.splice(0).map((bridge) => bridge.close()));
});

describe("MCP tool list", () => {
  it("matches the tools the MCP server registers, so the status screen never drifts", async () => {
    const source = await readFile(join(__dirname, "..", "src", "mcp", "server.ts"), "utf8");
    const registered = [...source.matchAll(/registerTool\(\s*"([a-z_]+)"/g)].map((m) => m[1]);
    expect(registered.sort()).toEqual(MCP_TOOLS.map((tool) => tool.name).sort());
  });

  it("maps request_ methods to their tool names", () => {
    expect(toolForBridgeMethod("request_create_test")).toBe("create_test");
    expect(toolForBridgeMethod("list_tests")).toBe("list_tests");
  });
});

async function start(onCall = vi.fn()) {
  const directory = await mkdtemp(join(tmpdir(), "bcft-mcp-status-"));
  const connectionFile = join(directory, "connection.json");
  const controller = {
    snapshot: () => ({ tests: [], environments: [], runs: [], testGroups: [] }),
    listAgentInvestigations: () => [],
  } as unknown as AppController;
  const bridge = new McpBridge(controller, connectionFile, onCall);
  bridges.push(bridge);
  expect(bridge.status().listening).toBe(false);
  await bridge.start();
  const connection = JSON.parse(await readFile(connectionFile, "utf8")) as {
    url: string;
    token: string;
  };
  const call = (method: string, token = connection.token) =>
    fetch(connection.url, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ method }),
    });
  return { bridge, call, onCall };
}

describe("McpBridge status", () => {
  it("records when each tool was last called and tells the shell", async () => {
    const { bridge, call, onCall } = await start();
    expect(bridge.status().listening).toBe(true);
    expect(bridge.status().lastCallAt).toBeUndefined();

    await call("list_investigations");
    const status = bridge.status();
    expect(status.lastCallAt).toBeTruthy();
    expect(status.tools.find((tool) => tool.name === "list_investigations")?.lastCallAt).toBe(
      status.lastCallAt,
    );
    expect(status.tools.find((tool) => tool.name === "list_tests")?.lastCallAt).toBeUndefined();
    expect(onCall).toHaveBeenCalledTimes(1);
  });

  it("does not count rejected, unauthorized or unknown calls", async () => {
    const { bridge, call, onCall } = await start();
    expect((await call("list_tests", "wrong")).status).toBe(401);
    expect((await call("not_a_tool")).status).toBe(400);
    expect(bridge.status().lastCallAt).toBeUndefined();
    expect(onCall).not.toHaveBeenCalled();
  });

  it("reports not listening after it is closed", async () => {
    const { bridge } = await start();
    await bridge.close();
    expect(bridge.status().listening).toBe(false);
  });
});
