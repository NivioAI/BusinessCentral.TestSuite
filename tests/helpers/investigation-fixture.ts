import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonStore } from "../../src/main/store";
import type { BcEnvironment, Project, TestDefinition, TestRun } from "../../src/shared/models";

export interface Fixture {
  directory: string;
  store: JsonStore;
  environment: BcEnvironment;
  project: Project;
  test: TestDefinition;
  run: TestRun;
  codePath: string;
}

export async function createFixture(
  options: { runStatus?: TestRun["status"]; environmentType?: "sandbox" | "production" } = {},
): Promise<Fixture> {
  const directory = await mkdtemp(join(tmpdir(), "bcft-investigation-"));
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
    type: options.environmentType ?? "sandbox",
    baseUrl: "http://localhost:8080/bc",
    authentication: "Windows",
  });
  const environment = store.snapshot().environments[0];

  const codePath = join(directory, "repo");
  await mkdir(join(codePath, ".git"), { recursive: true });
  await writeFile(join(codePath, ".git", "HEAD"), "ref: refs/heads/main\n");
  await mkdir(join(codePath, "app"));
  await writeFile(
    join(codePath, "app", "app.json"),
    JSON.stringify({ name: "Sales", version: "1.0.0.0" }),
  );

  const recordingPath = join(directory, "test.yml");
  await writeFile(recordingPath, "name: Post invoice\npassword: hunter2\nsteps: []\n");
  const group = store.snapshot().testGroups.find((item) => item.system);
  if (!group) throw new Error("Expected the General group");
  const test: TestDefinition = {
    id: "00000000-0000-4000-8000-000000000001",
    testId: "BC-2",
    name: "Post purchase invoice",
    customerId: customer.id,
    groupId: group.id,
    recordingPath,
    risk: "reversible",
    forbiddenActions: [],
    tags: [],
    allowedEnvironmentTypes: ["sandbox"],
    parameters: [],
    versionHash: "v1",
    importedAt: new Date(0).toISOString(),
  };
  await store.addTest(test);

  const resultDirectory = join(directory, "results", "run-1");
  await mkdir(resultDirectory, { recursive: true });
  const run: TestRun = {
    id: "run-1",
    testId: test.testId,
    testDefinitionId: test.id,
    testName: test.name,
    environmentId: environment.id,
    environmentName: environment.name,
    customerCode: customer.code,
    status: options.runStatus ?? "FAILED",
    startedAt: new Date(Date.now() - 120_000).toISOString(),
    finishedAt: new Date(Date.now() - 60_000).toISOString(),
    durationMs: 60_000,
    parameters: { customer: "10000", password: "hunter2" },
    versionHash: "v1",
    resultDirectory,
    error: "Timeout waiting for dialog. token=abc123",
    log: ["start", "Authorization: Bearer abc.def.ghi", "failed"],
    progress: [],
    steps: [
      { sequence: 1, status: "PASSED", description: "Open purchase invoices" },
      { sequence: 2, status: "PASSED", description: "Fill vendor" },
      { sequence: 3, status: "FAILED", description: "Post invoice", durationMs: 30_000 },
    ],
  };
  await store.addRun(run);

  await store.saveProject({
    environmentId: environment.id,
    name: "Sales AL",
    codePath,
    agent: "claude-code",
    instructions: "Never push.",
  });
  return {
    directory,
    store,
    environment,
    project: store.snapshot().projects[0],
    test,
    run,
    codePath,
  };
}
