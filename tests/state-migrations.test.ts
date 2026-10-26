import { describe, expect, it } from "vitest";
import { CURRENT_STATE_VERSION, migrateState } from "../src/main/state-migrations";

describe("state migrations", () => {
  it("migrates legacy state and initializes new test metadata", () => {
    const migrated = migrateState({
      customers: [],
      environments: [],
      tests: [{ id: "test", testId: "BC-001" }],
      runs: [],
    });
    expect(migrated.changed).toBe(true);
    expect(migrated.state.schemaVersion).toBe(CURRENT_STATE_VERSION);
    expect(migrated.state.tests[0].forbiddenActions).toEqual([]);
    expect(migrated.state.settings.runRetentionDays).toBe(90);
    expect(migrated.state.parameterProfiles).toEqual([]);
    expect(migrated.state.testPlans).toEqual([]);
  });

  it("initializes parameter profile selections for legacy test plans", () => {
    const migrated = migrateState({
      schemaVersion: 5,
      testPlans: [
        {
          id: "plan",
          name: "Regression",
          customerId: "customer",
          environmentId: "environment",
          testDefinitionIds: ["test"],
        },
      ],
    });

    expect(migrated.state.testPlans[0].parameterProfileIds).toEqual({});
  });

  it("refuses state created by a newer application version", () => {
    expect(() => migrateState({ schemaVersion: CURRENT_STATE_VERSION + 1 })).toThrow(
      "Unsupported configuration version",
    );
  });

  it("retains the agent audit and fails approvals interrupted by a restart", () => {
    const migrated = migrateState({
      schemaVersion: 3,
      mcpApprovals: [
        {
          id: "approval-1",
          action: "start-test",
          title: "Run BC-001",
          detail: "Sandbox",
          status: "PENDING",
          requestedAt: "2026-07-20T10:00:00.000Z",
        },
      ],
    });
    expect(migrated.state.mcpApprovals[0].status).toBe("FAILED");
    expect(migrated.state.mcpApprovals[0].error).toContain("restarted");
  });

  it("removes desktop testing data when migrating from version 6", () => {
    const migrated = migrateState({
      schemaVersion: 6,
      settings: {
        stepDelayMs: 500,
        textSize: "medium",
        runRetentionDays: 90,
        desktopTestingEnabled: true,
      },
      desktopApplications: [{ id: "app", customerId: "customer", name: "ERP client" }],
      tests: [
        { id: "bc", testId: "BC-001", kind: "business-central" },
        { id: "desktop", testId: "DT-001", kind: "desktop", desktopApplicationId: "app" },
      ],
      testPlans: [
        { id: "bc-plan", name: "BC", customerId: "customer", environmentId: "env" },
        {
          id: "desktop-plan",
          name: "Desktop",
          customerId: "customer",
          desktopApplicationId: "app",
        },
      ],
      testPlanRuns: [
        { id: "bc-plan-run", testPlanId: "bc-plan" },
        { id: "desktop-plan-run", testPlanId: "desktop-plan" },
      ],
      runs: [
        { id: "bc-run", testDefinitionId: "bc" },
        { id: "desktop-run", testDefinitionId: "desktop" },
      ],
    });

    const state = migrated.state as unknown as Record<string, unknown>;
    expect(state.desktopApplications).toBeUndefined();
    expect(migrated.state.settings).not.toHaveProperty("desktopTestingEnabled");
    expect(migrated.state.tests.map((test) => test.id)).toEqual(["bc"]);
    expect(migrated.state.tests[0]).not.toHaveProperty("kind");
    expect(migrated.state.testPlans.map((plan) => plan.id)).toEqual(["bc-plan"]);
    expect(migrated.state.testPlanRuns.map((run) => run.id)).toEqual(["bc-plan-run"]);
    expect(migrated.state.runs.map((run) => run.id)).toEqual(["bc-run"]);
    expect(migrated.changed).toBe(true);
  });

  it("adds projects, investigations and test project links from version 7", () => {
    const migrated = migrateState({
      schemaVersion: 7,
      tests: [{ id: "test", testId: "BC-001" }],
    });
    expect(migrated.state.projects).toEqual([]);
    expect(migrated.state.investigations).toEqual([]);
    expect(migrated.state.tests[0].projectIds).toEqual([]);
    expect(migrated.state.schemaVersion).toBe(CURRENT_STATE_VERSION);
  });

  it("gives old settings the default notification switches and keeps chosen ones", () => {
    const old = migrateState({
      settings: { stepDelayMs: 500, textSize: "medium", runRetentionDays: 90 },
    });
    expect(old.state.settings.notifications).toEqual({
      runFinished: true,
      investigationNeedsMe: true,
      agentApproval: false,
      scheduledPlans: true,
    });
    const partial = migrateState({
      settings: {
        stepDelayMs: 500,
        textSize: "medium",
        runRetentionDays: 90,
        notifications: { runFinished: false },
      },
    });
    expect(partial.state.settings.notifications.runFinished).toBe(false);
    expect(partial.state.settings.notifications.investigationNeedsMe).toBe(true);
  });
});
