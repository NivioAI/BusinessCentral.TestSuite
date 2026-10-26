import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AppController } from "../src/main/controller";
import { McpBridge } from "../src/main/mcp-bridge";

const bridges: McpBridge[] = [];

afterEach(async () => {
  await Promise.all(bridges.splice(0).map((bridge) => bridge.close()));
});

describe("MCP loopback bridge", () => {
  it("requires its bearer token and exposes sanitized test metadata", async () => {
    const directory = await mkdtemp(join(tmpdir(), "bcft-mcp-"));
    const connectionFile = join(directory, "connection.json");
    const controller = {
      snapshot: () => ({
        tests: [
          {
            id: "11111111-1111-4111-8111-111111111111",
            testId: "BC-SMOKE-001",
            name: "Smoke",
            groupId: "22222222-2222-4222-8222-222222222222",
            recordingPath: "/private/test.yml",
            risk: "read-only",
            forbiddenActions: [],
            tags: ["smoke"],
            allowedEnvironmentTypes: ["sandbox"],
            parameters: [
              {
                name: "Password",
                type: "string",
                defaultValue: "do-not-return",
                required: true,
                secret: true,
              },
            ],
            versionHash: "version",
            importedAt: new Date(0).toISOString(),
            kind: "business-central",
          },
        ],
        environments: [],
        runs: [],
      }),
    } as unknown as AppController;
    const bridge = new McpBridge(controller, connectionFile);
    bridges.push(bridge);
    await bridge.start();
    const connection = JSON.parse(await readFile(connectionFile, "utf8")) as {
      url: string;
      token: string;
    };

    const unauthorized = await fetch(connection.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ method: "list_tests" }),
    });
    expect(unauthorized.status).toBe(401);

    const authorized = await fetch(connection.url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${connection.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ method: "list_tests" }),
    });
    const payload = (await authorized.json()) as { result: unknown };
    expect(JSON.stringify(payload.result)).not.toContain("do-not-return");
    expect(JSON.stringify(payload.result)).not.toContain("/private/test.yml");
    expect((await stat(connectionFile)).mode & 0o077).toBe(0);
  });

  it("rejects browser origins even with a valid token", async () => {
    const directory = await mkdtemp(join(tmpdir(), "bcft-mcp-"));
    const connectionFile = join(directory, "connection.json");
    const controller = {
      snapshot: () => ({ tests: [], environments: [], runs: [] }),
    } as unknown as AppController;
    const bridge = new McpBridge(controller, connectionFile);
    bridges.push(bridge);
    await bridge.start();
    const connection = JSON.parse(await readFile(connectionFile, "utf8")) as {
      url: string;
      token: string;
    };
    const response = await fetch(connection.url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${connection.token}`,
        "content-type": "application/json",
        origin: "https://evil.example",
      },
      body: JSON.stringify({ method: "list_tests" }),
    });
    expect(response.status).toBe(403);
  });

  it("routes investigation tools to the controller and surfaces refused transitions", async () => {
    const directory = await mkdtemp(join(tmpdir(), "bcft-mcp-"));
    const connectionFile = join(directory, "connection.json");
    const calls: string[] = [];
    const controller = {
      snapshot: () => ({ tests: [], environments: [], runs: [] }),
      listAgentInvestigations: () => [{ id: "i1", status: "PACKAGE_READY" }],
      submitAgentPlan: async (id: string, plan: string) => {
        calls.push(`plan:${id}:${plan}`);
      },
      reportAgentChange: async () => {
        throw new Error("Not possible in status PLAN_RECEIVED.");
      },
    } as unknown as AppController;
    const bridge = new McpBridge(controller, connectionFile);
    bridges.push(bridge);
    await bridge.start();
    const connection = JSON.parse(await readFile(connectionFile, "utf8")) as {
      url: string;
      token: string;
    };
    const call = (method: string, params?: unknown) =>
      fetch(connection.url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${connection.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ method, params }),
      });
    expect(await (await call("list_investigations")).json()).toMatchObject({
      result: [{ id: "i1" }],
    });
    const submitted = await call("submit_plan", { id: "i1", plan: "## Plan" });
    expect(await submitted.json()).toMatchObject({ result: { status: "PLAN_RECEIVED" } });
    expect(calls).toEqual(["plan:i1:## Plan"]);
    const refused = await call("report_change", { id: "i1", summary: "s", branch: "b" });
    expect(refused.status).toBe(400);
    expect(await refused.json()).toMatchObject({ error: expect.stringContaining("PLAN_RECEIVED") });
  });
});
