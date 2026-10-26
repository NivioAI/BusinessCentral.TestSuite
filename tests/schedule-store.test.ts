import { describe, expect, it } from "vitest";
import { createWorkspaceArchive, readWorkspaceArchive } from "../src/main/workspace-backup";
import { latestOccurrence } from "../src/shared/schedule";
import { createFixture } from "./helpers/investigation-fixture";

const weekdays = { days: "weekdays", time: "02:00" } as const;

async function setup() {
  const fixture = await createFixture();
  const { store, test, environment } = fixture;
  const base = {
    name: "Nightly",
    customerId: environment.customerId,
    environmentId: environment.id,
    testDefinitionIds: [test.id],
  };
  return { ...fixture, base };
}

describe("saving a schedule", () => {
  it("starts from the latest moment so nothing in the past fires", async () => {
    const { store, base } = await setup();
    const before = Date.now();
    await store.saveTestPlan({ ...base, schedule: weekdays });
    const plan = store.snapshot().testPlans[0];
    expect(plan.schedule).toEqual(weekdays);
    expect(new Date(plan.scheduleHandledAt ?? "").getTime()).toBe(
      latestOccurrence(weekdays, new Date(before)).getTime(),
    );
    expect(plan.schedulePending).toBeUndefined();
  });

  it("restarts when the time changes, keeps history when it does not, and clears when turned off", async () => {
    const { store, base } = await setup();
    await store.saveTestPlan({ ...base, schedule: weekdays });
    const id = store.snapshot().testPlans[0].id;
    await store.handleScheduledMoment(id, "2099-01-01T02:00:00.000Z", { reason: "review" });
    const marked = store.snapshot().testPlans[0];
    expect(marked.scheduleHandledAt).toBe("2099-01-01T02:00:00.000Z");
    expect(marked.schedulePending?.reason).toBe("review");

    await store.saveTestPlan({ ...base, id, schedule: weekdays, name: "Renamed" });
    expect(store.snapshot().testPlans[0].scheduleHandledAt).toBe("2099-01-01T02:00:00.000Z");
    expect(store.snapshot().testPlans[0].schedulePending?.reason).toBe("review");

    await store.saveTestPlan({ ...base, id, schedule: { days: "every-day", time: "03:30" } });
    const changed = store.snapshot().testPlans[0];
    expect(changed.schedule).toEqual({ days: "every-day", time: "03:30" });
    expect(changed.scheduleHandledAt).not.toBe("2099-01-01T02:00:00.000Z");
    expect(changed.schedulePending).toBeUndefined();

    await store.saveTestPlan({ ...base, id });
    const off = store.snapshot().testPlans[0];
    expect(off.schedule).toBeUndefined();
    expect(off.scheduleHandledAt).toBeUndefined();
    expect(off.schedulePending).toBeUndefined();
  });
});

describe("handling scheduled moments", () => {
  it("dismisses a reminder without touching a plan that has none", async () => {
    const { store, base } = await setup();
    await store.saveTestPlan({ ...base, schedule: weekdays });
    const id = store.snapshot().testPlans[0].id;
    await store.handleScheduledMoment(id, "2099-01-02T02:00:00.000Z", {
      reason: "missed",
      detail: "closed",
    });
    expect(store.snapshot().testPlans[0].schedulePending).toMatchObject({ reason: "missed" });
    await store.dismissSchedulePending(id);
    expect(store.snapshot().testPlans[0].schedulePending).toBeUndefined();
    await store.dismissSchedulePending(id);
    await store.handleScheduledMoment("00000000-0000-4000-8000-000000000001", "x");
  });

  it("starting a run for a moment marks it handled and clears the reminder", async () => {
    const { store, base } = await setup();
    await store.saveTestPlan({ ...base, schedule: weekdays });
    const id = store.snapshot().testPlans[0].id;
    const occurrence = new Date(Date.now() + 86_400_000).toISOString();
    await store.handleScheduledMoment(id, "2099-01-03T02:00:00.000Z", { reason: "review" });
    const planRunId = await store.beginTestPlanRun({ planId: id, scheduledFor: occurrence });
    const plan = store.snapshot().testPlans[0];
    expect(plan.scheduleHandledAt).toBe(occurrence);
    expect(plan.schedulePending).toBeUndefined();
    expect(store.snapshot().testPlanRuns.find((run) => run.id === planRunId)?.scheduled).toBe(true);
  });

  it("a manual run does not touch the schedule", async () => {
    const { store, base } = await setup();
    await store.saveTestPlan({ ...base, schedule: weekdays });
    const id = store.snapshot().testPlans[0].id;
    const handled = store.snapshot().testPlans[0].scheduleHandledAt;
    const run = await store.beginTestPlanRun({ planId: id });
    expect(store.snapshot().testPlans[0].scheduleHandledAt).toBe(handled);
    expect(
      store.snapshot().testPlanRuns.find((item) => item.id === run)?.scheduled,
    ).toBeUndefined();
  });
});

describe("backups and schedules", () => {
  it("keeps the schedule but not the local state, and a restore does not fire at once", async () => {
    const { store, base } = await setup();
    await store.saveTestPlan({ ...base, schedule: weekdays });
    const id = store.snapshot().testPlans[0].id;
    await store.handleScheduledMoment(id, "2099-01-04T02:00:00.000Z", { reason: "review" });

    const archive = await createWorkspaceArchive(store.snapshot());
    const parsed = readWorkspaceArchive(archive);
    const portable = parsed.manifest.state.testPlans[0] as Record<string, unknown>;
    expect(portable.schedule).toEqual(weekdays);
    expect(portable.scheduleHandledAt).toBeUndefined();
    expect(portable.schedulePending).toBeUndefined();

    await store.importWorkspace(parsed.manifest.state, "replace");
    const restored = store.snapshot().testPlans[0];
    expect(restored.schedule).toEqual(weekdays);
    expect(restored.scheduleHandledAt).toBe("2099-01-04T02:00:00.000Z");
    expect(restored.schedulePending?.reason).toBe("review");
  });

  it("starts an imported schedule from now on a fresh device", async () => {
    const { store, base } = await setup();
    await store.saveTestPlan({ ...base, schedule: weekdays });
    const archive = await createWorkspaceArchive(store.snapshot());
    const parsed = readWorkspaceArchive(archive);
    const other = await createFixture();
    await other.store.importWorkspace(parsed.manifest.state, "replace");
    const plan = other.store.snapshot().testPlans[0];
    expect(plan.scheduleHandledAt).toBeTruthy();
    expect(new Date(plan.scheduleHandledAt ?? "").getTime()).toBeLessThanOrEqual(Date.now());
  });
});
