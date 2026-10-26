// @vitest-environment happy-dom
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../src/renderer/App";
import { RunPageHost } from "../../src/renderer/components/RunPage";
import { Dashboard } from "../../src/renderer/features/DashboardView";
import { TestPlanModal } from "../../src/renderer/features/PlansView";
import type { AppSnapshot, RunnerEvent, TestPlan } from "../../src/shared/models";
import "./setup";

const ids = { customer: "c1", environment: "e1", test: "t1", plan: "p1" };

function snapshot(
  extra: Partial<Record<keyof AppSnapshot, unknown>> = {},
  authentication = "Windows",
) {
  return {
    schemaVersion: 8,
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
    customers: [{ id: ids.customer, code: "C", name: "Contoso", active: true }],
    testGroups: [{ id: "g", name: "General", system: true }],
    environments: [
      {
        id: ids.environment,
        customerId: ids.customer,
        name: "Sandbox",
        company: "CRONUS",
        type: "sandbox",
        authentication,
        hasCredential: true,
        active: true,
      },
    ],
    tests: [
      {
        id: ids.test,
        testId: "BC-1",
        name: "Smoke",
        risk: "read-only",
        groupId: "g",
        allowedEnvironmentTypes: ["sandbox"],
        parameters: [],
        projectIds: [],
        tags: [],
      },
    ],
    testPlans: [],
    testPlanRuns: [],
    projects: [],
    investigations: [],
    runs: [],
    parameterProfiles: [],
    mcpApprovals: [],
    diagnostics: {
      appVersion: "0.1.0",
      powershellAvailable: true,
      powershellExecutable: "/usr/bin/pwsh",
      replayAvailable: true,
      runtimeCompatibility: "compatible",
      runtimeSource: "bundled",
    },
    ...extra,
  } as unknown as AppSnapshot;
}

const plan = (extra: Partial<TestPlan> = {}) =>
  ({
    id: ids.plan,
    name: "Nightly smoke",
    customerId: ids.customer,
    environmentId: ids.environment,
    testDefinitionIds: [ids.test],
    ...extra,
  }) as TestPlan;

describe("plan page: schedule", () => {
  const saveTestPlan = vi.fn();
  beforeEach(() => {
    saveTestPlan.mockReset();
    saveTestPlan.mockResolvedValue(snapshot());
    (window as unknown as { bcFlow: unknown }).bcFlow = { saveTestPlan };
  });

  function renderModal(snap: AppSnapshot, existing?: TestPlan) {
    const host = document.createElement("div");
    document.body.append(host);
    render(
      <RunPageHost.Provider value={host}>
        <TestPlanModal
          snapshot={snap}
          plan={existing}
          initialTestIds={[ids.test]}
          onClose={() => undefined}
          onSaved={() => undefined}
        />
      </RunPageHost.Provider>,
    );
  }

  it("is off by default and shows the choices", () => {
    renderModal(snapshot());
    expect(screen.getByRole("button", { name: "Off" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByLabelText(/^time/i)).toBeNull();
  });

  it("saves the chosen days and time", async () => {
    renderModal(snapshot(), plan());
    await userEvent.type(screen.getByLabelText(/plan name/i), "{End}");
    await userEvent.click(screen.getByRole("button", { name: "Weekdays" }));
    const time = screen.getByLabelText(/^time/i);
    expect(time).toHaveValue("02:00");
    expect(screen.getByText(/this plan runs on its own/i)).toBeInTheDocument();
    await userEvent.clear(time);
    await userEvent.type(time, "03:30");
    await userEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(saveTestPlan).toHaveBeenCalled());
    expect(saveTestPlan.mock.calls[0][0].schedule).toEqual({ days: "weekdays", time: "03:30" });
  });

  it("leaves the schedule out when turned off again", async () => {
    renderModal(snapshot(), plan({ schedule: { days: "every-day", time: "04:15" } }));
    expect(screen.getByRole("button", { name: "Every day" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByLabelText(/^time/i)).toHaveValue("04:15");
    await userEvent.click(screen.getByRole("button", { name: "Off" }));
    await userEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(saveTestPlan).toHaveBeenCalled());
    expect(saveTestPlan.mock.calls[0][0].schedule).toBeUndefined();
  });

  it("warns that a plan which needs a sign-in will ask instead of running alone", async () => {
    renderModal(snapshot({}, "AAD"), plan({ schedule: { days: "every-day", time: "02:00" } }));
    expect(screen.getByText(/this plan will ask you when it is due/i)).toBeInTheDocument();
    expect(screen.getByText(/mfa/i)).toBeInTheDocument();
  });
});

describe("dashboard reminders for scheduled plans", () => {
  const dismissSchedulePending = vi.fn();
  beforeEach(() => {
    dismissSchedulePending.mockReset();
    dismissSchedulePending.mockResolvedValue(snapshot());
    (window as unknown as { bcFlow: unknown }).bcFlow = { dismissSchedulePending };
  });

  function renderDashboard(reminder: TestPlan["schedulePending"]) {
    const host = document.createElement("div");
    document.body.append(host);
    const actions = { onRunPlan: vi.fn(), onRefresh: vi.fn() };
    const withReminder = plan({
      schedule: { days: "every-day", time: "02:00" },
      schedulePending: reminder,
    });
    render(
      <RunPageHost.Provider value={host}>
        <Dashboard
          snapshot={snapshot({ testPlans: [withReminder] })}
          onRun={() => undefined}
          onOpenRun={() => undefined}
          onNavigate={() => undefined}
          {...actions}
        />
      </RunPageHost.Provider>,
    );
    return { actions, withReminder };
  }

  it("says why a due plan waits and opens the review page for it", async () => {
    const { actions } = renderDashboard({
      occurrence: "2026-10-19T00:00:00.000Z",
      reason: "review",
      detail: "It contains tests that change data.",
    });
    expect(screen.getByText(/nightly smoke is due/i)).toBeInTheDocument();
    expect(screen.getByText(/tests that change data/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /review and run/i }));
    expect(actions.onRunPlan).toHaveBeenCalledWith(
      expect.objectContaining({ scheduledFor: "2026-10-19T00:00:00.000Z" }),
    );
  });

  it("explains a missed moment and lets you skip it", async () => {
    const { actions, withReminder } = renderDashboard({
      occurrence: "2026-10-19T00:00:00.000Z",
      reason: "missed",
    });
    expect(screen.getByText(/missed its 02:00 run/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /skip this run/i }));
    expect(dismissSchedulePending).toHaveBeenCalledWith(withReminder.id);
    await waitFor(() => expect(actions.onRefresh).toHaveBeenCalled());
  });
});

describe("a scheduled moment reaching the window", () => {
  const calls: unknown[] = [];
  let emit: (event: RunnerEvent) => void = () => undefined;

  function mount(snap: AppSnapshot) {
    calls.length = 0;
    (window as unknown as { bcFlow: unknown }).bcFlow = new Proxy(
      {},
      {
        get: (_target, key) => {
          if (key === "onRunnerEvent") {
            return (callback: (event: RunnerEvent) => void) => {
              emit = callback;
              return () => undefined;
            };
          }
          if (key === "beginTestPlanRun") {
            return async (input: unknown) => {
              calls.push(input);
              return { snapshot: snap, planRunId: "run-1" };
            };
          }
          if (key === "startRun") return async () => snap;
          return async () => snap;
        },
      },
    );
    render(<App />);
  }

  it("starts the plan with its default values and tells the store which moment it answers", async () => {
    const snap = snapshot({
      testPlans: [plan({ schedule: { days: "every-day", time: "02:00" } })],
    });
    mount(snap);
    await screen.findByRole("heading", { name: "Dashboard" });
    act(() =>
      emit({ type: "schedule-due", planId: ids.plan, occurrence: "2026-10-19T00:00:00.000Z" }),
    );
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({
      planId: ids.plan,
      scheduledFor: "2026-10-19T00:00:00.000Z",
    });
  });

  it("does nothing for an unknown plan or while a run is active", async () => {
    mount(snapshot({ testPlans: [plan()], activeRunId: "busy" }));
    await screen.findByRole("heading", { name: "Dashboard" });
    act(() =>
      emit({ type: "schedule-due", planId: ids.plan, occurrence: "2026-10-19T00:00:00.000Z" }),
    );
    act(() =>
      emit({ type: "schedule-due", planId: "other", occurrence: "2026-10-19T00:00:00.000Z" }),
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(calls).toHaveLength(0);
  });
});
