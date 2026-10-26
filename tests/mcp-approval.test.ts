import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AppController } from "../src/main/controller";
import type { JsonStore } from "../src/main/store";
import type { TestDefinition, TestRun } from "../src/shared/models";

describe("MCP approval flow", () => {
  it("does not create a test until the user approves the request", async () => {
    const created: TestDefinition[] = [];
    const group = {
      id: "22222222-2222-4222-8222-222222222222",
      name: "General",
      system: true,
    };
    const store = {
      findTestGroup: (id: string) => (id === group.id ? group : undefined),
      snapshot: () => ({ tests: created }),
      addTest: async (test: TestDefinition) => {
        created.push(test);
      },
      saveMcpApprovals: async () => undefined,
    } as unknown as JsonStore;
    const directory = await mkdtemp(join(tmpdir(), "bcft-mcp-approval-"));
    const controller = new AppController(store, directory, directory, () => undefined);
    const request = controller.requestMcpCreateTest({
      groupId: group.id,
      testId: "BC-AI-001",
      name: "AI generated smoke test",
      yaml: "name: AI generated smoke test\nsteps:\n  - type: navigate\n",
      risk: "read-only",
      forbiddenActions: [],
      tags: ["ai"],
      allowedEnvironmentTypes: ["sandbox"],
    });

    expect(request.status).toBe("PENDING");
    expect(created).toHaveLength(0);

    (controller as unknown as { snapshot(): object }).snapshot = () => ({});
    await controller.resolveMcpApproval(request.id, true);

    expect(created).toHaveLength(1);
    expect(created[0].testId).toBe("BC-AI-001");
  });

  it("marks an approved MCP run as initiated by the AI agent", async () => {
    const directory = await mkdtemp(join(tmpdir(), "bcft-mcp-origin-"));
    const test = {
      id: "test-1",
      testId: "BC-AI-002",
      name: "AI smoke",
      kind: "business-central",
      risk: "read-only",
    };
    const environment = { id: "environment-1", name: "Sandbox" };
    const store = {
      findTest: () => test,
      findEnvironment: () => environment,
      saveMcpApprovals: async () => undefined,
    } as unknown as JsonStore;
    const controller = new AppController(store, directory, directory, () => undefined);
    let initiatedBy: TestRun["initiatedBy"];
    controller.startRun = async (_input, source) => {
      initiatedBy = source;
      return { id: "run-1" } as TestRun;
    };
    (controller as unknown as { snapshot(): object }).snapshot = () => ({});

    const request = controller.requestMcpStartTest({
      testDefinitionId: test.id,
      environmentId: environment.id,
      parameters: {},
      confirmRisk: true,
      manualMfa: false,
      rememberSession: false,
    });
    await controller.resolveMcpApproval(request.id, true);

    expect(initiatedBy).toBe("ai-agent");
  });
});
