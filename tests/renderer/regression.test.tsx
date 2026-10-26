// @vitest-environment happy-dom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RunPageHost } from "../../src/renderer/components/RunPage";
import { InvestigationPage } from "../../src/renderer/features/InvestigationsView";
import type { AppSnapshot, Investigation, TestPlanRun } from "../../src/shared/models";
import "./setup";

const stopRun = vi.fn();

beforeEach(() => {
  stopRun.mockReset();
  (window as unknown as { bcFlow: unknown }).bcFlow = {
    getInvestigationPrompt: async () => "prompt",
    onRunnerEvent: () => () => undefined,
    stopRun,
  };
});

const test = (id: string, testId: string, projectIds: string[] = ["p"]) => ({
  id,
  testId,
  name: `Test ${testId}`,
  risk: "read-only",
  projectIds,
  allowedEnvironmentTypes: ["sandbox"],
  parameters: [],
});

const investigation = {
  id: "inv",
  number: 4,
  runId: "run",
  testDefinitionId: "t1",
  projectId: "p",
  status: "CHANGE_APPLIED",
  includeEvidence: true,
  createdAt: "x",
  updatedAt: "x",
  iterations: [
    {
      number: 1,
      agent: "claude-code",
      runId: "run",
      retestRunIds: [],
      change: { summary: "s", branch: "fix/bc-1", files: [], reportedAt: "x" },
    },
  ],
} as unknown as Investigation;

const regression = (extra: Partial<TestPlanRun> = {}): TestPlanRun => ({
  id: "reg",
  testPlanId: "regression:inv",
  planName: "Regression · INV-4",
  customerId: "c",
  environmentId: "e",
  status: "RUNNING",
  startedAt: "2026-10-19T09:00:00.000Z",
  items: [
    {
      sequence: 1,
      testDefinitionId: "t2",
      testId: "BC-2",
      testName: "Test BC-2",
      runId: "r2",
      status: "PASSED",
      startedAt: "x",
    },
  ],
  testDefinitionIds: ["t2", "t3", "t4"],
  adHoc: true,
  ...extra,
});

function snapshot(runs: TestPlanRun[] = [], activeRunId?: string) {
  return {
    tests: [
      test("t1", "BC-1"),
      test("t2", "BC-2"),
      test("t3", "BC-3"),
      test("t4", "BC-4"),
      test("x", "BC-9", []),
    ],
    projects: [
      { id: "p", environmentId: "e", name: "Warehouse AL", agent: "claude-code", codePath: "/r" },
    ],
    environments: [{ id: "e", type: "sandbox", customerId: "c", name: "Sandbox" }],
    runs: [{ id: "run", testDefinitionId: "t1", status: "FAILED", steps: [] }],
    investigations: [investigation],
    testPlanRuns: runs,
    activeRunId,
    customers: [],
  } as unknown as AppSnapshot;
}

function renderPage(snap: AppSnapshot) {
  const host = document.createElement("div");
  document.body.append(host);
  const onRunRegression = vi.fn();
  render(
    <RunPageHost.Provider value={host}>
      <InvestigationPage
        snapshot={snap}
        investigation={investigation}
        onClose={() => undefined}
        onSnapshot={() => undefined}
        onOpenRun={() => undefined}
        onRetest={() => undefined}
        onRegression={() => undefined}
        onRunRegression={onRunRegression}
      />
    </RunPageHost.Provider>,
  );
  return onRunRegression;
}

describe("regression check in an investigation", () => {
  it("offers Run regression for the other tests of the project and starts it on click", async () => {
    const onRun = renderPage(snapshot());
    const button = screen.getByRole("button", { name: /run regression/i });
    expect(button).toBeEnabled();
    expect(screen.getByText(/the other 3 tests of warehouse al/i)).toBeInTheDocument();
    await userEvent.click(button);
    expect(onRun).toHaveBeenCalledWith(investigation);
  });

  it("shows each test's state while it runs and can stop it", async () => {
    renderPage(snapshot([regression()]));
    const row = (name: string) => screen.getByText(name).closest("tr") as HTMLElement;
    expect(within(row("BC-2 · Test BC-2")).getByText("Passed")).toBeInTheDocument();
    expect(within(row("BC-3 · Test BC-3")).getByText("Running")).toBeInTheDocument();
    expect(within(row("BC-4 · Test BC-4")).getByText("Queued")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /run regression/i })).toBeDisabled();
    expect(screen.getByText(/1 of 3 done/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /stop regression/i }));
    expect(stopRun).toHaveBeenCalledTimes(1);
  });

  it("shows tests that did not run after a failure as not run", () => {
    renderPage(
      snapshot([
        regression({
          status: "FAILED",
          items: [
            {
              sequence: 1,
              testDefinitionId: "t2",
              testId: "BC-2",
              testName: "Test BC-2",
              runId: "r2",
              status: "FAILED",
              startedAt: "x",
            },
          ],
        }),
      ]),
    );
    expect(screen.getAllByText("Not run")).toHaveLength(2);
    expect(screen.getByRole("button", { name: /run regression/i })).toBeEnabled();
    expect(screen.queryByRole("button", { name: /stop regression/i })).toBeNull();
  });

  it("disables Run regression while another run is active", () => {
    renderPage(snapshot([], "other-run"));
    expect(screen.getByRole("button", { name: /run regression/i })).toBeDisabled();
  });
});
