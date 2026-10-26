import { describe, expect, it } from "vitest";
import type { TestRun } from "../src/shared/models";
import { createFixture } from "./helpers/investigation-fixture";

const ID = (n: number) => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const REGRESSION = `regression:${ID(90)}`;

async function setup() {
  const fixture = await createFixture();
  const { store, test, environment } = fixture;
  const ids = [test.id, ID(2), ID(3)];
  await store.addTest({ ...test, id: ids[1], testId: "BC-3" });
  await store.addTest({ ...test, id: ids[2], testId: "BC-4" });
  await store.saveTestPlan({
    name: "Nightly",
    customerId: environment.customerId,
    environmentId: environment.id,
    testDefinitionIds: ids,
  });
  const plan = store.snapshot().testPlans[0];
  const finished = async (testDefinitionId: string, status: TestRun["status"], n: number) => {
    const run: TestRun = {
      ...fixture.run,
      id: `plan-run-${n}`,
      testDefinitionId,
      status,
      resultDirectory: fixture.run.resultDirectory,
    };
    await store.addRun(run);
    return run;
  };
  return { ...fixture, plan, ids, finished };
}

describe("resuming a plan run", () => {
  it("continues from the failed test, linked to the earlier execution", async () => {
    const { store, plan, ids, finished } = await setup();
    const first = await store.beginTestPlanRun({ planId: plan.id });
    await store.recordTestPlanRunResult(first, (await finished(ids[0], "PASSED", 1)).id);
    await store.recordTestPlanRunResult(first, (await finished(ids[1], "FAILED", 2)).id);
    expect(store.snapshot().testPlanRuns[0]).toMatchObject({ status: "FAILED" });

    const resumed = await store.beginTestPlanRun({
      planId: plan.id,
      testDefinitionIds: [ids[1], ids[2]],
      resumedFromId: first,
    });
    const record = store.snapshot().testPlanRuns.find((item) => item.id === resumed);
    expect(record).toMatchObject({ resumedFromId: first, testDefinitionIds: [ids[1], ids[2]] });

    await store.recordTestPlanRunResult(resumed, (await finished(ids[1], "PASSED", 3)).id);
    expect(store.snapshot().testPlanRuns.find((item) => item.id === resumed)?.status).toBe(
      "RUNNING",
    );
    await store.recordTestPlanRunResult(resumed, (await finished(ids[2], "PASSED", 4)).id);
    expect(store.snapshot().testPlanRuns.find((item) => item.id === resumed)?.status).toBe(
      "PASSED",
    );
  });

  it("rejects tests that are not in the plan, out of order, or an unknown execution", async () => {
    const { store, plan, ids } = await setup();
    await expect(
      store.beginTestPlanRun({ planId: plan.id, testDefinitionIds: [ID(77)] }),
    ).rejects.toThrow("plan's order");
    await expect(
      store.beginTestPlanRun({ planId: plan.id, testDefinitionIds: [ids[2], ids[1]] }),
    ).rejects.toThrow("plan's order");
    await expect(
      store.beginTestPlanRun({ planId: plan.id, resumedFromId: ID(55) }),
    ).rejects.toThrow("no longer exists");
  });

  it("still runs the whole plan when nothing is specified, and only one at a time", async () => {
    const { store, plan, ids } = await setup();
    const id = await store.beginTestPlanRun({ planId: plan.id });
    expect(store.snapshot().testPlanRuns[0].testDefinitionIds).toEqual(ids);
    await expect(store.beginTestPlanRun({ planId: plan.id })).rejects.toThrow("already running");
    expect(id).toBeTruthy();
  });

  it("keeps working for plan runs saved before the test list was stored", async () => {
    const { store, plan, ids, finished } = await setup();
    const id = await store.beginTestPlanRun({ planId: plan.id });
    const record = store.snapshot().testPlanRuns.find((item) => item.id === id);
    if (record) record.testDefinitionIds = undefined;
    await store.recordTestPlanRunResult(id, (await finished(ids[0], "PASSED", 1)).id);
    await expect(
      store.recordTestPlanRunResult(id, (await finished(ids[2], "PASSED", 2)).id),
    ).rejects.toThrow("expected position");
  });
});

describe("a run without a saved plan (regression)", () => {
  it("runs the chosen tests on the environment and records them like a plan run", async () => {
    const { store, environment, ids, finished } = await setup();
    const id = await store.beginTestPlanRun({
      planId: REGRESSION,
      name: "Regression · INV-1",
      environmentId: environment.id,
      testDefinitionIds: [ids[1], ids[2]],
    });
    const record = store.snapshot().testPlanRuns.find((item) => item.id === id);
    expect(record).toMatchObject({
      adHoc: true,
      planName: "Regression · INV-1",
      environmentId: environment.id,
      customerId: environment.customerId,
    });
    await store.recordTestPlanRunResult(id, (await finished(ids[1], "PASSED", 1)).id);
    await store.recordTestPlanRunResult(id, (await finished(ids[2], "FAILED", 2)).id);
    expect(store.snapshot().testPlanRuns.find((item) => item.id === id)?.status).toBe("FAILED");
  });

  it("refuses production, a missing environment, no tests, and tests that do not fit", async () => {
    const { store, environment, ids } = await setup();
    await expect(
      store.beginTestPlanRun({ planId: REGRESSION, testDefinitionIds: [ids[1]] }),
    ).rejects.toThrow("valid environment");
    await expect(
      store.beginTestPlanRun({ planId: REGRESSION, environmentId: environment.id }),
    ).rejects.toThrow("at least one test");
    await expect(
      store.beginTestPlanRun({
        planId: REGRESSION,
        environmentId: environment.id,
        testDefinitionIds: [ID(77)],
      }),
    ).rejects.toThrow("cannot run on this environment");
    await store.saveEnvironment({
      customerId: environment.customerId,
      customerCode: "DEMO",
      customerName: "Demo",
      tenantId: "tenant",
      name: "Production",
      company: "CRONUS",
      type: "production",
      baseUrl: "http://localhost:8080/bc",
      authentication: "Windows",
    });
    const production = store.snapshot().environments.find((item) => item.type === "production");
    await expect(
      store.beginTestPlanRun({
        planId: REGRESSION,
        environmentId: production?.id,
        testDefinitionIds: [ids[1]],
      }),
    ).rejects.toThrow("valid environment");
  });

  it("does not accept an unknown plan id that is not a regression", async () => {
    const { store } = await setup();
    await expect(store.beginTestPlanRun({ planId: ID(66) })).rejects.toThrow("no longer exists");
  });
});
