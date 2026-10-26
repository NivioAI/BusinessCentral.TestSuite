import type { AppState } from "../shared/models";
import { DEFAULT_NOTIFICATIONS, withNotificationDefaults } from "../shared/notifications";

export const CURRENT_STATE_VERSION = 8;

export function migrateState(value: unknown): { state: AppState; changed: boolean } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid configuration file.");
  }
  const state = structuredClone(value) as Partial<AppState> & { schemaVersion?: number };
  const version = state.schemaVersion ?? 0;
  if (!Number.isInteger(version) || version < 0 || version > CURRENT_STATE_VERSION) {
    throw new Error(`Unsupported configuration version: ${String(version)}.`);
  }

  state.settings ??= {
    stepDelayMs: 500,
    textSize: "medium",
    runRetentionDays: 90,
    notifications: { ...DEFAULT_NOTIFICATIONS },
  };
  state.settings.textSize ??= "medium";
  state.settings.runRetentionDays ??= 90;
  state.settings.notifications = withNotificationDefaults(state.settings.notifications);
  state.customers ??= [];
  state.testGroups ??= [];
  state.testPlans ??= [];
  for (const plan of state.testPlans) plan.parameterProfileIds ??= {};
  state.testPlanRuns ??= [];
  state.environments ??= [];
  state.projects ??= [];
  state.investigations ??= [];
  state.tests ??= [];
  state.runs ??= [];
  state.parameterProfiles ??= [];
  for (const run of state.runs) run.progress ??= [];
  state.mcpApprovals ??= [];
  for (const request of state.mcpApprovals) {
    if (request.status !== "PENDING" && request.status !== "APPROVED") continue;
    request.status = "FAILED";
    request.resolvedAt ??= new Date().toISOString();
    request.error = "Application restarted before this request completed.";
  }
  for (const test of state.tests) {
    test.forbiddenActions ??= [];
    test.projectIds ??= [];
  }
  removeDesktopTesting(state);
  state.schemaVersion = CURRENT_STATE_VERSION;
  return { state: state as AppState, changed: version !== CURRENT_STATE_VERSION };
}

/** Desktop testing was removed in state version 7: drop its applications, tests, plans and runs. */
function removeDesktopTesting(state: Partial<AppState>): void {
  Reflect.deleteProperty(state, "desktopApplications");
  if (state.settings) Reflect.deleteProperty(state.settings, "desktopTestingEnabled");
  const removedTestIds = new Set(
    (state.tests ?? [])
      .filter((test) => (test as { kind?: string }).kind === "desktop")
      .map((test) => test.id),
  );
  const removedPlanIds = new Set(
    (state.testPlans ?? [])
      .filter(
        (plan) =>
          Boolean((plan as { desktopApplicationId?: string }).desktopApplicationId) ||
          !plan.environmentId,
      )
      .map((plan) => plan.id),
  );
  state.tests = (state.tests ?? []).filter((test) => !removedTestIds.has(test.id));
  state.testPlans = (state.testPlans ?? []).filter((plan) => !removedPlanIds.has(plan.id));
  state.testPlanRuns = (state.testPlanRuns ?? []).filter(
    (run) => !removedPlanIds.has(run.testPlanId),
  );
  state.runs = (state.runs ?? []).filter((run) => !removedTestIds.has(run.testDefinitionId));
  for (const test of state.tests) {
    Reflect.deleteProperty(test, "kind");
    Reflect.deleteProperty(test, "desktopApplicationId");
  }
}
