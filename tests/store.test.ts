import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { JsonStore } from "../src/main/store";
import type { TestRun } from "../src/shared/models";
import { createFixture } from "./helpers/investigation-fixture";

describe("JsonStore", () => {
  it("recovers an unreadable state file from the last backup", async () => {
    const directory = await mkdtemp(join(tmpdir(), "bcft-store-"));
    const statePath = join(directory, "state.json");
    await writeFile(statePath, "not-json");
    await writeFile(
      `${statePath}.bak`,
      JSON.stringify({
        settings: { stepDelayMs: 500, textSize: "medium" },
        customers: [{ id: "customer", code: "DEMO", name: "Demo", active: true }],
        environments: [],
        tests: [],
        runs: [],
      }),
    );
    const store = new JsonStore(statePath, join(directory, "secrets.json"));

    await store.initialize();

    expect(store.recoveredFromBackup).toBe(true);
    expect(store.snapshot().customers[0].code).toBe("DEMO");
  });

  it("serializes concurrent state writes", async () => {
    const directory = await mkdtemp(join(tmpdir(), "bcft-store-"));
    const statePath = join(directory, "state.json");
    const store = new JsonStore(statePath, join(directory, "secrets.json"));
    await store.initialize();

    const runs = Array.from({ length: 20 }, (_, index) => createRun(String(index)));
    await expect(Promise.all(runs.map((run) => store.addRun(run)))).resolves.toHaveLength(20);

    const persisted = JSON.parse(await readFile(statePath, "utf8")) as {
      runs: TestRun[];
    };
    expect(persisted.runs.map((run) => run.id)).toEqual(runs.map((run) => run.id).reverse());
  });

  it("deletes completed standalone runs but protects active runs", async () => {
    const directory = await mkdtemp(join(tmpdir(), "bcft-store-"));
    const store = new JsonStore(join(directory, "state.json"), join(directory, "secrets.json"));
    await store.initialize();
    await store.addRun(createRun("active"));
    await expect(store.deleteRun("active")).rejects.toThrow("active test run");
    await store.updateRun({ ...createRun("active"), status: "PASSED" });

    await store.deleteRun("active");

    expect(store.snapshot().runs).toHaveLength(0);
  });

  it("prunes expired standalone runs while preserving plan evidence", async () => {
    const directory = await mkdtemp(join(tmpdir(), "bcft-store-"));
    const store = new JsonStore(join(directory, "state.json"), join(directory, "secrets.json"));
    await store.initialize();
    const expired = {
      ...createRun("expired"),
      status: "PASSED" as const,
      startedAt: new Date("2020-01-01").toISOString(),
    };
    await store.addRun(expired);

    const removed = await store.pruneRuns(30);

    expect(removed.map((run) => run.id)).toEqual(["expired"]);
    expect(store.snapshot().runs).toHaveLength(0);
  });

  it("migrates and persists the global step delay setting", async () => {
    const directory = await mkdtemp(join(tmpdir(), "bcft-store-"));
    const statePath = join(directory, "state.json");
    await writeFile(
      statePath,
      JSON.stringify({ customers: [], environments: [], tests: [], runs: [] }),
    );
    const store = new JsonStore(statePath, join(directory, "secrets.json"));

    await store.initialize();
    expect(store.snapshot().settings.stepDelayMs).toBe(500);
    expect(store.snapshot().settings.textSize).toBe("medium");

    await store.saveSettings({
      stepDelayMs: 1000,
      textSize: "large",
      runRetentionDays: 30,
      notifications: {
        runFinished: false,
        investigationNeedsMe: true,
        agentApproval: true,
        scheduledPlans: true,
      },
    });
    const persisted = JSON.parse(await readFile(statePath, "utf8")) as {
      settings: { stepDelayMs: number; textSize: string };
    };
    expect(persisted.settings.stepDelayMs).toBe(1000);
    expect(persisted.settings.textSize).toBe("large");
  });

  it("persists reusable parameter profiles and rejects secret values", async () => {
    const directory = await mkdtemp(join(tmpdir(), "bcft-store-"));
    const store = new JsonStore(join(directory, "state.json"), join(directory, "secrets.json"));
    await store.initialize();
    const test = {
      ...createTest("test-definition", "group", "customer"),
      parameters: [
        { name: "company", type: "string" as const, required: true, secret: false },
        { name: "password", type: "string" as const, required: true, secret: true },
      ],
    };
    await store.addTest(test);

    await store.saveParameterProfile({
      testDefinitionId: test.id,
      name: "Sandbox",
      values: { company: "CRONUS" },
    });
    await expect(
      store.saveParameterProfile({
        testDefinitionId: test.id,
        name: "Unsafe",
        values: { password: "secret" },
      }),
    ).rejects.toThrow("Secret parameters");

    expect(store.snapshot().parameterProfiles).toHaveLength(1);
    expect(store.snapshot().parameterProfiles[0].values).toEqual({ company: "CRONUS" });
  });

  it("creates General and migrates existing customer tests into a customer group", async () => {
    const directory = await mkdtemp(join(tmpdir(), "bcft-store-"));
    const statePath = join(directory, "state.json");
    await writeFile(
      statePath,
      JSON.stringify({
        customers: [{ id: "customer", code: "DEMO", name: "Demo", active: true }],
        environments: [],
        tests: [{ id: "test", testId: "BC-001", customerId: "customer" }],
        runs: [],
      }),
    );
    const store = new JsonStore(statePath, join(directory, "secrets.json"));

    await store.initialize();

    const snapshot = store.snapshot();
    expect(snapshot.testGroups.find((group) => group.system)?.name).toBe("General");
    const migratedGroup = snapshot.testGroups.find((group) => group.customerId === "customer");
    expect(migratedGroup?.name).toBe("Customizations");
    expect(snapshot.tests[0].groupId).toBe(migratedGroup?.id);
  });

  it("rejects duplicate customer groups without changing state", async () => {
    const directory = await mkdtemp(join(tmpdir(), "bcft-store-"));
    const store = new JsonStore(join(directory, "state.json"), join(directory, "secrets.json"));
    await store.initialize();
    await store.saveCustomer({ code: "DEMO", name: "Demo" });
    const customerId = store.snapshot().customers[0].id;
    await store.saveTestGroup({ customerId, name: "Warehouse" });

    await expect(store.saveTestGroup({ customerId, name: "warehouse" })).rejects.toThrow(
      "This group already exists",
    );
    expect(store.snapshot().testGroups.filter((group) => !group.system)).toHaveLength(1);
  });

  it("updates customers and keeps grouped tests aligned when a group moves", async () => {
    const directory = await mkdtemp(join(tmpdir(), "bcft-store-"));
    const store = new JsonStore(join(directory, "state.json"), join(directory, "secrets.json"));
    await store.initialize();
    await store.saveCustomer({ code: "ONE", name: "Customer One" });
    await store.saveCustomer({ code: "TWO", name: "Customer Two" });
    const [first, second] = store.snapshot().customers;
    await store.addRun(createRun("customer-run", "historic-test", "ONE"));
    await store.saveCustomer({
      id: first.id,
      code: "ONE-UPDATED",
      name: "Customer One Updated",
    });
    await store.saveTestGroup({ customerId: first.id, name: "Warehouse" });
    const group = store.snapshot().testGroups.find((item) => !item.system);
    expect(group).toBeDefined();
    if (!group) throw new Error("Expected customer group");
    await store.addTest(createTest("test", group.id, first.id));

    await store.saveTestGroup({ id: group.id, customerId: second.id, name: "Warehouse Pro" });

    const snapshot = store.snapshot();
    expect(snapshot.customers[0].name).toBe("Customer One Updated");
    expect(snapshot.runs[0].customerCode).toBe("ONE-UPDATED");
    expect(snapshot.testGroups.find((item) => item.id === group.id)).toMatchObject({
      customerId: second.id,
      name: "Warehouse Pro",
    });
    expect(snapshot.tests[0].customerId).toBe(second.id);
  });

  it("blocks deletion while dependent data exists", async () => {
    const directory = await mkdtemp(join(tmpdir(), "bcft-store-"));
    const store = new JsonStore(join(directory, "state.json"), join(directory, "secrets.json"));
    await store.initialize();
    await store.saveCustomer({ code: "DEMO", name: "Demo" });
    const customerId = store.snapshot().customers[0].id;
    await store.saveTestGroup({ customerId, name: "Warehouse" });
    const group = store.snapshot().testGroups.find((item) => !item.system);
    expect(group).toBeDefined();
    if (!group) throw new Error("Expected customer group");
    await store.addTest(createTest("test", group.id, customerId));

    await expect(store.deleteCustomer(customerId)).rejects.toThrow("test groups");
    await expect(store.deleteTestGroup(group.id)).rejects.toThrow("tests in this group");
    await store.addRun(createRun("run", "test"));
    await expect(store.deleteTest("test")).rejects.toThrow("run history");
  });

  it("archives and restores tests outside active plans", async () => {
    const directory = await mkdtemp(join(tmpdir(), "bcft-store-"));
    const store = new JsonStore(join(directory, "state.json"), join(directory, "secrets.json"));
    await store.initialize();
    const group = store.snapshot().testGroups.find((item) => item.system);
    expect(group).toBeDefined();
    if (!group) throw new Error("Expected General group");
    await store.addTest(createTest("archive", group.id, undefined));

    await store.setTestArchived("archive", true);
    expect(store.snapshot().tests[0].archivedAt).toBeTypeOf("string");
    await store.setTestArchived("archive", false);
    expect(store.snapshot().tests[0].archivedAt).toBeUndefined();
  });

  it("archives and restores customers and their configuration objects", async () => {
    const directory = await mkdtemp(join(tmpdir(), "bcft-store-"));
    const store = new JsonStore(join(directory, "state.json"), join(directory, "secrets.json"));
    await store.initialize();
    await store.saveCustomer({ code: "ARCHIVE", name: "Archive customer" });
    const customer = store.snapshot().customers[0];
    await store.saveTestGroup({ customerId: customer.id, name: "Archived group" });
    const group = store.snapshot().testGroups.find((item) => !item.system);
    expect(group).toBeDefined();
    if (!group) throw new Error("Expected customer group");

    await store.setEntityArchived("test-group", group.id, true);
    await store.setEntityArchived("customer", customer.id, true);

    expect(store.snapshot().testGroups.find((item) => item.id === group.id)?.archivedAt).toBeTypeOf(
      "string",
    );
    expect(store.snapshot().customers[0]).toMatchObject({ active: false });
    await store.setEntityArchived("customer", customer.id, false);
    expect(store.snapshot().customers[0]).toMatchObject({ active: true, archivedAt: undefined });
  });

  it("persists ordered test plans and protects their dependencies", async () => {
    const directory = await mkdtemp(join(tmpdir(), "bcft-store-"));
    const store = new JsonStore(join(directory, "state.json"), join(directory, "secrets.json"));
    await store.initialize();
    await store.saveCustomer({ code: "DEMO", name: "Demo" });
    const customerId = store.snapshot().customers[0].id;
    await store.saveEnvironment({
      customerId,
      customerCode: "DEMO",
      customerName: "Demo",
      tenantId: "tenant",
      name: "Sandbox",
      company: "CRONUS",
      type: "sandbox",
      baseUrl: "http://localhost:8080/bc",
      authentication: "Windows",
    });
    const environmentId = store.snapshot().environments[0].id;
    const generalGroup = store.snapshot().testGroups.find((group) => group.system);
    expect(generalGroup).toBeDefined();
    if (!generalGroup) throw new Error("Expected General group");
    await store.addTest(createTest("first", generalGroup.id, undefined));
    await store.addTest(createTest("second", generalGroup.id, undefined));

    await store.saveTestPlan({
      name: "Regression",
      customerId,
      environmentId,
      testDefinitionIds: ["second", "first"],
    });

    expect(store.snapshot().testPlans[0].testDefinitionIds).toEqual(["second", "first"]);
    await expect(store.deleteEnvironment(environmentId)).rejects.toThrow("test plan");
    await expect(store.deleteTest("first")).rejects.toThrow("test plan");
  });

  it("updates a test plan created with an explicit undefined id", async () => {
    const directory = await mkdtemp(join(tmpdir(), "bcft-store-"));
    const store = new JsonStore(join(directory, "state.json"), join(directory, "secrets.json"));
    await store.initialize();
    await store.saveCustomer({ id: undefined, code: "DEMO", name: "Demo" });
    const customer = store.snapshot().customers[0];
    await store.saveEnvironment({
      customerId: customer.id,
      customerCode: customer.code,
      customerName: customer.name,
      tenantId: "tenant",
      name: "Sandbox",
      company: "CRONUS",
      type: "sandbox",
      baseUrl: "http://localhost:8080/bc",
      authentication: "Windows",
    });
    const snapshot = store.snapshot();
    const generalGroup = snapshot.testGroups.find((group) => group.system);
    expect(generalGroup).toBeDefined();
    if (!generalGroup) throw new Error("Expected General group");
    await store.addTest(createTest("first", generalGroup.id, undefined));
    await store.saveTestPlan({
      id: undefined,
      name: "Original plan",
      customerId: customer.id,
      environmentId: snapshot.environments[0].id,
      testDefinitionIds: ["first"],
    });
    const createdPlan = store.snapshot().testPlans[0];
    expect(createdPlan.id).toBeTypeOf("string");

    await store.saveTestPlan({ ...createdPlan, name: "Updated plan" });

    expect(store.snapshot().testPlans).toHaveLength(1);
    expect(store.snapshot().testPlans[0].name).toBe("Updated plan");
  });

  it("tracks ordered plan execution and stops the plan on the first failed run", async () => {
    const directory = await mkdtemp(join(tmpdir(), "bcft-store-"));
    const store = new JsonStore(join(directory, "state.json"), join(directory, "secrets.json"));
    await store.initialize();
    await store.saveCustomer({ code: "DEMO", name: "Demo" });
    const customer = store.snapshot().customers[0];
    await store.saveEnvironment({
      customerId: customer.id,
      customerCode: customer.code,
      customerName: customer.name,
      tenantId: "tenant",
      name: "Sandbox",
      company: "CRONUS",
      type: "sandbox",
      baseUrl: "http://localhost:8080/bc",
      authentication: "Windows",
    });
    const snapshot = store.snapshot();
    const environmentId = snapshot.environments[0].id;
    const generalGroup = snapshot.testGroups.find((group) => group.system);
    expect(generalGroup).toBeDefined();
    if (!generalGroup) throw new Error("Expected General group");
    await store.addTest(createTest("first", generalGroup.id, undefined));
    await store.addTest(createTest("second", generalGroup.id, undefined));
    await store.saveTestPlan({
      name: "Regression",
      customerId: customer.id,
      environmentId,
      testDefinitionIds: ["first", "second"],
    });
    const plan = store.snapshot().testPlans[0];
    const planRunId = await store.beginTestPlanRun({ planId: plan.id });
    const firstRun = {
      ...createRun("first-run", "first"),
      environmentId,
      status: "PASSED" as const,
    };
    await store.addRun(firstRun);
    await store.recordTestPlanRunResult(planRunId, firstRun.id);
    expect(store.snapshot().testPlanRuns[0].status).toBe("RUNNING");
    const secondRun = {
      ...createRun("second-run", "second"),
      environmentId,
      status: "FAILED" as const,
    };
    await store.addRun(secondRun);

    await store.recordTestPlanRunResult(planRunId, secondRun.id);

    const planRun = store.snapshot().testPlanRuns[0];
    expect(planRun.status).toBe("FAILED");
    expect(planRun.items.map((item) => item.testDefinitionId)).toEqual(["first", "second"]);
    await store.deleteTestPlan(plan.id);
    expect(store.snapshot().testPlans).toHaveLength(0);
    expect(store.snapshot().testPlanRuns).toHaveLength(0);
  });

  it("stores a parameter profile per test plan item and rejects mismatched profiles", async () => {
    const directory = await mkdtemp(join(tmpdir(), "bcft-store-"));
    const store = new JsonStore(join(directory, "state.json"), join(directory, "secrets.json"));
    await store.initialize();
    await store.saveCustomer({ code: "DEMO", name: "Demo" });
    const customer = store.snapshot().customers[0];
    await store.saveEnvironment({
      customerId: customer.id,
      customerCode: customer.code,
      customerName: customer.name,
      tenantId: "tenant",
      name: "Sandbox",
      company: "CRONUS",
      type: "sandbox",
      baseUrl: "http://localhost:8080/bc",
      authentication: "Windows",
    });
    const generalGroup = store.snapshot().testGroups.find((group) => group.system);
    expect(generalGroup).toBeDefined();
    if (!generalGroup) throw new Error("Expected General group");
    await store.addTest({
      ...createTest("profiled", generalGroup.id, undefined),
      parameters: [{ name: "company", type: "string" as const, required: true, secret: false }],
    });
    await store.addTest(createTest("other", generalGroup.id, undefined));
    await store.saveParameterProfile({
      testDefinitionId: "profiled",
      name: "Sandbox",
      values: { company: "CRONUS" },
    });
    const profile = store.snapshot().parameterProfiles[0];
    const environment = store.snapshot().environments[0];

    await store.saveTestPlan({
      name: "Regression",
      customerId: customer.id,
      environmentId: environment.id,
      testDefinitionIds: ["profiled"],
      parameterProfileIds: { profiled: profile.id },
    });
    await expect(
      store.saveTestPlan({
        name: "Invalid regression",
        customerId: customer.id,
        environmentId: environment.id,
        testDefinitionIds: ["other"],
        parameterProfileIds: { other: profile.id },
      }),
    ).rejects.toThrow("parameter profile");

    expect(store.snapshot().testPlans[0].parameterProfileIds).toEqual({ profiled: profile.id });
  });

  it("updates an active recording while retaining run history and cleaning profiles", async () => {
    const directory = await mkdtemp(join(tmpdir(), "bcft-store-"));
    const store = new JsonStore(join(directory, "state.json"), join(directory, "secrets.json"));
    await store.initialize();
    const generalGroup = store.snapshot().testGroups.find((group) => group.system);
    expect(generalGroup).toBeDefined();
    if (!generalGroup) throw new Error("Expected General group");
    await store.addTest({
      ...createTest("updated", generalGroup.id, undefined),
      parameters: [
        { name: "company", type: "string" as const, required: true, secret: false },
        { name: "document", type: "string" as const, required: false, secret: false },
      ],
    });
    await expect(
      store.addTest({
        ...createTest("duplicate", generalGroup.id, undefined),
        testId: "BC-updated",
      }),
    ).rejects.toThrow("already exists");
    await store.saveParameterProfile({
      testDefinitionId: "updated",
      name: "Default",
      values: { company: "CRONUS", document: "SO-1" },
    });
    await store.addRun({
      ...createRun("historic", "updated"),
      status: "PASSED",
      versionHash: "version",
    });

    await store.updateTestRecording("updated", {
      recordingPath: "/tmp/new.yml",
      parameters: [{ name: "company", type: "string", required: true, secret: false }],
      versionHash: "new-version",
      importedAt: new Date(1).toISOString(),
    });

    const snapshot = store.snapshot();
    expect(snapshot.tests[0]).toMatchObject({
      recordingPath: "/tmp/new.yml",
      versionHash: "new-version",
    });
    expect(snapshot.parameterProfiles[0].values).toEqual({ company: "CRONUS" });
    expect(snapshot.runs[0].versionHash).toBe("version");
  });
});

function createTest(id: string, groupId: string, customerId: string | undefined) {
  return {
    id,
    testId: `BC-${id}`,
    name: "Test",
    customerId,
    groupId,
    recordingPath: "/tmp/test.yml",
    risk: "read-only" as const,
    forbiddenActions: [],
    tags: [],
    allowedEnvironmentTypes: ["sandbox" as const],
    parameters: [],
    versionHash: "version",
    importedAt: new Date(0).toISOString(),
  };
}

function createRun(
  id: string,
  testDefinitionId = "test-definition",
  customerCode = "DEMO",
): TestRun {
  return {
    id,
    testDefinitionId,
    testId: "BC-TEST-01",
    testName: "Test",
    environmentId: "environment",
    environmentName: "Sandbox",
    customerCode,
    status: "RUNNING",
    startedAt: new Date(0).toISOString(),
    parameters: {},
    versionHash: "version",
    resultDirectory: `/tmp/${id}`,
    log: [],
    progress: [],
    steps: [],
  };
}

describe("projects", () => {
  it("stores a project per environment and keeps the code folder", async () => {
    const { store, environment, project } = await createFixture();
    expect(project).toMatchObject({
      environmentId: environment.id,
      name: "Sales AL",
      agent: "claude-code",
    });
    await store.saveProject({ ...project, name: "Sales AL 2", agent: "codex" });
    expect(store.snapshot().projects).toHaveLength(1);
    expect(store.snapshot().projects[0]).toMatchObject({ name: "Sales AL 2", agent: "codex" });
  });

  it("rejects unknown environments, unknown projects and production", async () => {
    const { store, environment } = await createFixture();
    await expect(
      store.saveProject({
        environmentId: "00000000-0000-4000-8000-000000000099",
        name: "X",
        agent: "codex",
      }),
    ).rejects.toThrow("valid environment");
    await expect(
      store.saveProject({
        id: "00000000-0000-4000-8000-000000000099",
        environmentId: environment.id,
        name: "X",
        agent: "codex",
      }),
    ).rejects.toThrow("project no longer exists");
    const production = await createFixture({ environmentType: "production" }).catch(
      (error: Error) => error,
    );
    expect(production).toBeInstanceOf(Error);
    expect((production as Error).message).toContain("Production environments");
  });

  it("links tests to projects of the same customer only", async () => {
    const { store, test, project, environment } = await createFixture();
    await store.saveTestGroup({ name: "Demo flows", customerId: environment.customerId });
    const group = store.snapshot().testGroups.find((item) => item.name === "Demo flows");
    const input = {
      id: test.id,
      groupId: group?.id ?? "",
      name: test.name,
      risk: test.risk,
      forbiddenActions: [],
      tags: [],
    };
    await store.saveTest({ ...input, projectIds: [project.id, project.id] });
    expect(store.findTest(test.id)?.projectIds).toEqual([project.id]);
    await expect(
      store.saveTest({ ...input, projectIds: ["00000000-0000-4000-8000-000000000099"] }),
    ).rejects.toThrow("no longer exists");

    await store.saveCustomer({ code: "OTHER", name: "Other" });
    const other = store.snapshot().customers.find((item) => item.code === "OTHER");
    await store.saveEnvironment({
      customerId: other?.id,
      customerCode: "OTHER",
      customerName: "Other",
      tenantId: "tenant",
      name: "Other sandbox",
      company: "CRONUS",
      type: "sandbox",
      baseUrl: "http://localhost:8080/other",
      authentication: "Windows",
    });
    const otherEnvironment = store
      .snapshot()
      .environments.find((item) => item.name === "Other sandbox");
    await store.saveProject({
      environmentId: otherEnvironment?.id ?? "",
      name: "Other AL",
      agent: "codex",
    });
    const otherProject = store.snapshot().projects.find((item) => item.name === "Other AL");
    await expect(
      store.saveTest({ ...input, projectIds: [otherProject?.id ?? ""] }),
    ).rejects.toThrow("same customer");
  });

  it("blocks deleting an environment that has projects and archives projects", async () => {
    const { store, environment, project } = await createFixture();
    await expect(store.deleteEnvironment(environment.id)).rejects.toThrow("projects");
    await store.setEntityArchived("project", project.id, true);
    expect(store.findProject(project.id)?.archivedAt).toBeDefined();
    await store.setEntityArchived("project", project.id, false);
    expect(store.findProject(project.id)?.archivedAt).toBeUndefined();
    await expect(store.setEntityArchived("project", "missing", true)).rejects.toThrow(
      "project no longer exists",
    );
  });

  it("refuses to archive a project with open investigations or to move it", async () => {
    const { store, project, environment, run } = await createFixture();
    const now = new Date().toISOString();
    await store.addInvestigation({
      id: "00000000-0000-4000-8000-0000000000aa",
      number: store.nextInvestigationNumber(),
      runId: run.id,
      testDefinitionId: run.testDefinitionId,
      projectId: project.id,
      status: "HANDED_OFF",
      includeEvidence: false,
      createdAt: now,
      updatedAt: now,
      iterations: [{ number: 1, agent: "codex", runId: run.id, retestRunIds: [] }],
    });
    await expect(store.setEntityArchived("project", project.id, true)).rejects.toThrow(
      "open investigations",
    );
    await expect(
      store.saveProject({ ...project, environmentId: "00000000-0000-4000-8000-000000000099" }),
    ).rejects.toThrow("valid environment");
    expect(store.nextInvestigationNumber()).toBe(2);
    expect(store.openInvestigationsFor(project.id)).toHaveLength(1);
    await expect(
      store.updateInvestigation({ ...store.snapshot().investigations[0], id: "missing" }),
    ).rejects.toThrow("no longer exists");
    expect(environment.id).toBe(project.environmentId);
  });
});
