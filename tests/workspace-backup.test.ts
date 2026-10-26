import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { createWorkspaceArchive, readWorkspaceArchive } from "../src/main/workspace-backup";
import type { AppState } from "../src/shared/models";

describe("workspace backups", () => {
  it("round-trips configuration and recording files without runs", async () => {
    const directory = await mkdtemp(join(tmpdir(), "bcft-workspace-"));
    const recordingPath = join(directory, "test.yml");
    await writeFile(recordingPath, "name: Smoke\nsteps: []\n");
    const state = fixtureState(recordingPath);

    const archive = await createWorkspaceArchive(state);
    const parsed = readWorkspaceArchive(archive);

    expect(parsed.manifest.state.tests[0].recordingPath).toBe("library/test/test.yml");
    expect(parsed.files.has("library/test/test.yml")).toBe(true);
    expect(parsed.manifest.state.parameterProfiles[0].values).toEqual({ company: "CRONUS" });
    expect(parsed.manifest.state.testPlans[0].parameterProfileIds).toEqual({ test: "profile" });
    expect("runs" in parsed.manifest.state).toBe(false);
    expect(parsed.manifest.state.projects).toEqual([
      { id: "project", environmentId: "environment", name: "Sales AL", agent: "claude-code" },
    ]);
    expect(parsed.manifest.state.tests[0].projectIds).toEqual(["project"]);
    expect(JSON.stringify(parsed.manifest)).not.toContain("/Users/someone");
  });

  it("keeps the environment of a parameter profile and rejects an unknown one", async () => {
    const directory = await mkdtemp(join(tmpdir(), "bcft-workspace-"));
    const recordingPath = join(directory, "test.yml");
    await writeFile(recordingPath, "name: Smoke\nsteps: []\n");
    const state = fixtureState(recordingPath);
    state.parameterProfiles[0].environmentId = "environment";
    const parsed = readWorkspaceArchive(await createWorkspaceArchive(state));
    expect(parsed.manifest.state.parameterProfiles[0].environmentId).toBe("environment");

    state.parameterProfiles[0].environmentId = "gone";
    expect(() => readWorkspaceArchive(zipFor(parsed.manifest, state))).toThrow(
      "unknown environment",
    );
  });

  it("rejects a test that links to an unknown project", () => {
    const state = fixtureState("library/test/test.yml");
    const manifest = {
      version: 1,
      exportedAt: new Date().toISOString(),
      state: {
        settings: state.settings,
        customers: state.customers,
        testGroups: state.testGroups,
        environments: state.environments,
        projects: [],
        tests: state.tests,
        testPlans: [],
      },
    };
    const archive = zipSync({
      "manifest.json": strToU8(JSON.stringify(manifest)),
      "library/test/test.yml": strToU8("name: Smoke\nsteps: []\n"),
    });
    expect(() => readWorkspaceArchive(archive)).toThrow("unknown project");
  });

  it("rejects a project without a valid environment", () => {
    const state = fixtureState("library/test/test.yml");
    const manifest = {
      version: 1,
      exportedAt: new Date().toISOString(),
      state: {
        settings: state.settings,
        customers: state.customers,
        testGroups: state.testGroups,
        environments: state.environments,
        projects: [{ id: "project", environmentId: "gone", name: "X", agent: "codex" }],
        tests: [],
        testPlans: [],
      },
    };
    const archive = zipSync({ "manifest.json": strToU8(JSON.stringify(manifest)) });
    expect(() => readWorkspaceArchive(archive)).toThrow("without a valid environment");
  });

  it("drops desktop testing data from backups made before it was removed", async () => {
    const directory = await mkdtemp(join(tmpdir(), "bcft-workspace-"));
    const recordingPath = join(directory, "test.yml");
    await writeFile(recordingPath, "name: Smoke\nsteps: []\n");
    const state = fixtureState(recordingPath);
    const legacyTest = {
      ...state.tests[0],
      id: "desktop",
      kind: "desktop",
      desktopApplicationId: "app",
    };
    const manifest = {
      version: 1,
      exportedAt: new Date().toISOString(),
      state: {
        settings: { ...state.settings, desktopTestingEnabled: true },
        customers: state.customers,
        testGroups: state.testGroups,
        environments: state.environments,
        desktopApplications: [
          {
            id: "app",
            customerId: "customer",
            name: "ERP client",
            platform: "darwin",
            launchMode: "attach",
            launchArguments: [],
            windowTitle: "ERP",
            active: true,
          },
        ],
        tests: [
          { ...state.tests[0], projectIds: [], recordingPath: "library/test/test.yml" },
          { ...legacyTest, projectIds: [], recordingPath: "library/desktop/test.yaml" },
        ],
        testPlans: [
          {
            id: "plan",
            name: "BC",
            customerId: "customer",
            environmentId: "environment",
            testDefinitionIds: ["test"],
          },
          {
            id: "desktop-plan",
            name: "Desktop",
            customerId: "customer",
            desktopApplicationId: "app",
            testDefinitionIds: ["desktop"],
          },
        ],
        parameterProfiles: [
          {
            id: "profile",
            testDefinitionId: "desktop",
            name: "Old",
            values: {},
            updatedAt: new Date().toISOString(),
          },
        ],
      },
    };
    const archive = zipSync({
      "manifest.json": strToU8(JSON.stringify(manifest)),
      "library/test/test.yml": strToU8("name: Smoke\nsteps: []\n"),
    });

    const parsed = readWorkspaceArchive(archive);

    expect(parsed.manifest.state.tests.map((test) => test.id)).toEqual(["test"]);
    expect(parsed.manifest.state.testPlans.map((plan) => plan.id)).toEqual(["plan"]);
    expect(parsed.manifest.state.parameterProfiles).toEqual([]);
    expect("desktopApplications" in parsed.manifest.state).toBe(false);
  });

  it("rejects unsafe archive paths", () => {
    const archive = zipSync({ "../state.json": strToU8("{}") });
    expect(() => readWorkspaceArchive(archive)).toThrow("unsafe file path");
  });

  it("rejects manifests with missing recording files", () => {
    const state = fixtureState("library/test/test.yml");
    const manifest = {
      version: 1,
      exportedAt: new Date().toISOString(),
      state: {
        settings: state.settings,
        customers: state.customers,
        testGroups: state.testGroups,
        environments: [],
        tests: state.tests.map((test) => ({ ...test, projectIds: [] })),
        testPlans: [],
      },
    };
    const archive = zipSync({ "manifest.json": strToU8(JSON.stringify(manifest)) });
    expect(() => readWorkspaceArchive(archive)).toThrow("without a recording file");
  });
});

function zipFor(
  manifest: ReturnType<typeof readWorkspaceArchive>["manifest"],
  state: AppState,
): Uint8Array {
  return zipSync({
    "manifest.json": strToU8(
      JSON.stringify({
        ...manifest,
        state: { ...manifest.state, parameterProfiles: state.parameterProfiles },
      }),
    ),
    "library/test/test.yml": strToU8("name: Smoke\nsteps: []\n"),
  });
}

function fixtureState(recordingPath: string): AppState {
  return {
    settings: {
      stepDelayMs: 500,
      textSize: "medium",
      runRetentionDays: 90,
      notifications: {
        runFinished: true,
        investigationNeedsMe: true,
        agentApproval: false,
        scheduledPlans: true,
      },
    },
    customers: [{ id: "customer", code: "DEMO", name: "Demo", active: true }],
    testGroups: [{ id: "general", name: "General", system: true }],
    projects: [
      {
        id: "project",
        environmentId: "environment",
        name: "Sales AL",
        codePath: "/Users/someone/dev/sales-al",
        agent: "claude-code",
      },
    ],
    investigations: [],
    environments: [
      {
        id: "environment",
        customerId: "customer",
        tenantId: "tenant",
        name: "Sandbox",
        company: "CRONUS",
        type: "sandbox",
        baseUrl: "http://localhost:8080/bc",
        authentication: "Windows",
        hasCredential: false,
        active: true,
      },
    ],
    tests: [
      {
        id: "test",
        testId: "BC-SMOKE",
        name: "Smoke",
        groupId: "general",
        recordingPath,
        risk: "read-only",
        forbiddenActions: [],
        tags: [],
        allowedEnvironmentTypes: ["sandbox"],
        parameters: [{ name: "company", type: "string", required: true, secret: false }],
        versionHash: "version",
        importedAt: new Date().toISOString(),
        projectIds: ["project"],
      },
    ],
    testPlans: [
      {
        id: "plan",
        name: "Regression",
        customerId: "customer",
        environmentId: "environment",
        testDefinitionIds: ["test"],
        parameterProfileIds: { test: "profile" },
      },
    ],
    testPlanRuns: [],
    runs: [],
    parameterProfiles: [
      {
        id: "profile",
        testDefinitionId: "test",
        name: "Sandbox",
        values: { company: "CRONUS" },
        updatedAt: new Date().toISOString(),
      },
    ],
    mcpApprovals: [],
  };
}
