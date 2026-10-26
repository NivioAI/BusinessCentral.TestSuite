// @vitest-environment happy-dom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { RunPageHost } from "../../src/renderer/components/RunPage";
import { TestPlanHistorySheet, resumeRequest } from "../../src/renderer/features/PlansView";
import type { AppSnapshot, TestPlan, TestPlanRun } from "../../src/shared/models";
import { canStartWithoutReview, defaultPlanParameters } from "../../src/shared/plan-run";
import "./setup";

const param = (name: string, extra: object = {}) => ({
  name,
  type: "string",
  required: true,
  secret: false,
  ...extra,
});
const test = (id: string, extra: object = {}) => ({
  id,
  testId: id.toUpperCase(),
  name: `Test ${id}`,
  risk: "read-only",
  parameters: [],
  ...extra,
});

const plan = {
  id: "plan",
  name: "Nightly",
  customerId: "c",
  environmentId: "e",
  testDefinitionIds: ["a", "b", "c"],
} as TestPlan;

const run = (id: string, testDefinitionId: string, parameters: object = {}) => ({
  id,
  testDefinitionId,
  parameters,
  steps: [],
  status: "PASSED",
});

function makeSnapshot(overrides: Partial<Record<keyof AppSnapshot, unknown>> = {}) {
  return {
    customers: [{ id: "c", name: "Contoso" }],
    tests: [
      test("a", { parameters: [param("customer")] }),
      test("b", { parameters: [param("customer"), param("token", { secret: true })] }),
      test("c"),
    ],
    runs: [
      run("r-a", "a", { customer: "10000" }),
      run("r-b", "b", { customer: "20000", token: "••••" }),
    ],
    parameterProfiles: [],
    testPlanRuns: [] as TestPlanRun[],
    ...overrides,
  } as unknown as AppSnapshot;
}

const failedRun = (extra: Partial<TestPlanRun> = {}): TestPlanRun => ({
  id: "pr1",
  testPlanId: "plan",
  planName: "Nightly",
  customerId: "c",
  environmentId: "e",
  status: "FAILED",
  startedAt: "2026-10-18T02:00:00.000Z",
  finishedAt: "2026-10-18T02:02:00.000Z",
  items: [
    {
      sequence: 1,
      testDefinitionId: "a",
      testId: "A",
      testName: "Test a",
      runId: "r-a",
      status: "PASSED",
      startedAt: "x",
    },
    {
      sequence: 2,
      testDefinitionId: "b",
      testId: "B",
      testName: "Test b",
      runId: "r-b",
      status: "FAILED",
      startedAt: "x",
    },
  ],
  ...extra,
});

describe("resumeRequest", () => {
  it("restarts at the failed test and prefills the non-secret values it used", () => {
    const snapshot = makeSnapshot();
    const request = resumeRequest(snapshot, plan, failedRun());
    expect(request?.testDefinitionIds).toEqual(["b", "c"]);
    expect(request?.resumedFromId).toBe("pr1");
    expect(request?.title).toBe("Resume Nightly from B");
    expect(request?.initialParameters).toEqual({ b: { customer: "20000" } });
  });

  it("uses the stored list of an earlier resumed run", () => {
    const request = resumeRequest(
      makeSnapshot(),
      plan,
      failedRun({
        testDefinitionIds: ["b", "c"],
        items: [{ ...failedRun().items[1], sequence: 1 }],
      }),
    );
    expect(request?.testDefinitionIds).toEqual(["b", "c"]);
  });

  it("offers nothing for a passed or running execution", () => {
    expect(resumeRequest(makeSnapshot(), plan, failedRun({ status: "PASSED" }))).toBeUndefined();
    expect(resumeRequest(makeSnapshot(), plan, failedRun({ status: "RUNNING" }))).toBeUndefined();
  });

  it("restarts from the beginning when nothing completed", () => {
    expect(
      resumeRequest(makeSnapshot(), plan, failedRun({ items: [], status: "ABORTED" }))
        ?.testDefinitionIds,
    ).toEqual(["a", "b", "c"]);
  });
});

describe("plan run defaults", () => {
  it("fills defaults, keeps secrets empty and applies a saved profile", () => {
    const snapshot = makeSnapshot({
      tests: [
        test("a", { parameters: [param("customer", { defaultValue: "10000" })] }),
        test("b", { parameters: [param("token", { secret: true, defaultValue: "x" })] }),
      ],
      parameterProfiles: [{ id: "p", values: { customer: "30000" } }],
    });
    const withProfile = {
      ...plan,
      testDefinitionIds: ["a", "b"],
      parameterProfileIds: { a: "p" },
    } as TestPlan;
    expect(defaultPlanParameters(snapshot, withProfile)).toEqual({
      a: { customer: "30000" },
      b: { token: "" },
    });
  });

  it("starts without review only for read-only tests with every required value known", () => {
    const ready = makeSnapshot({
      tests: [test("a", { parameters: [param("customer", { defaultValue: "1" })] }), test("c")],
    });
    const small = { ...plan, testDefinitionIds: ["a", "c"] } as TestPlan;
    expect(canStartWithoutReview(ready, small)).toBe(true);

    const missing = makeSnapshot({
      tests: [test("a", { parameters: [param("customer")] }), test("c")],
    });
    expect(canStartWithoutReview(missing, small)).toBe(false);

    const writes = makeSnapshot({ tests: [test("a", { risk: "reversible" }), test("c")] });
    expect(canStartWithoutReview(writes, small)).toBe(false);

    const secretRequired = makeSnapshot({
      tests: [test("a", { parameters: [param("token", { secret: true })] }), test("c")],
    });
    expect(canStartWithoutReview(secretRequired, small)).toBe(false);

    expect(
      canStartWithoutReview(ready, { ...small, testDefinitionIds: ["a", "gone"] } as TestPlan),
    ).toBe(false);
    expect(canStartWithoutReview(ready, { ...small, testDefinitionIds: [] } as TestPlan)).toBe(
      false,
    );
  });
});

function renderHistory(snapshot: AppSnapshot, activeRun = false) {
  const host = document.createElement("div");
  document.body.append(host);
  const onResume = vi.fn();
  render(
    <RunPageHost.Provider value={host}>
      <TestPlanHistorySheet
        plan={plan}
        snapshot={snapshot}
        activeRun={activeRun}
        onClose={() => undefined}
        onOpenRun={() => undefined}
        onResume={onResume}
      />
    </RunPageHost.Provider>,
  );
  return onResume;
}

describe("plan history", () => {
  it("offers Resume on the latest failed execution and passes the request on", async () => {
    const onResume = renderHistory(makeSnapshot({ testPlanRuns: [failedRun()] }));
    await userEvent.click(screen.getByRole("button", { name: /resume from b/i }));
    expect(onResume).toHaveBeenCalledWith(
      expect.objectContaining({ testDefinitionIds: ["b", "c"], resumedFromId: "pr1" }),
    );
  });

  it("does not offer Resume again once it was resumed, or while a run is active", () => {
    const resumed = failedRun({ id: "pr2", status: "PASSED", resumedFromId: "pr1", items: [] });
    renderHistory(makeSnapshot({ testPlanRuns: [resumed, failedRun()] }));
    expect(screen.queryByRole("button", { name: /resume from/i })).toBeNull();
    expect(screen.getByText(/resumed from/i)).toBeInTheDocument();
  });

  it("disables Resume while another run is active", () => {
    renderHistory(makeSnapshot({ testPlanRuns: [failedRun()] }), true);
    expect(screen.getByRole("button", { name: /resume from b/i })).toBeDisabled();
  });
});
