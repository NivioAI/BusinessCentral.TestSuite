import { describe, expect, it, vi } from "vitest";
import { Scheduler, type SchedulerDeps } from "../src/main/scheduler";
import type { TestPlan } from "../src/shared/models";

// Monday 19 October 2026, local time.
const at = (hours: number, minutes = 0) => new Date(2026, 9, 19, hours, minutes);

const plan = (extra: Partial<TestPlan> = {}) =>
  ({
    id: "plan",
    name: "Nightly smoke",
    customerId: "c",
    environmentId: "e",
    testDefinitionIds: ["a"],
    schedule: { days: "every-day", time: "02:00" },
    scheduleHandledAt: new Date(2026, 9, 18, 2, 0).toISOString(),
    ...extra,
  }) as TestPlan;

function setup(options: {
  plans?: TestPlan[];
  now?: Date;
  busy?: boolean;
  risk?: string;
  authentication?: string;
}) {
  const calls = {
    emitted: [] as Array<[string, string]>,
    handled: [] as Array<[string, string, unknown]>,
    notified: [] as Array<[string, string]>,
  };
  const deps: SchedulerDeps = {
    plans: () => options.plans ?? [plan()],
    context: () =>
      ({
        tests: [{ id: "a", risk: options.risk ?? "read-only", parameters: [] }],
        parameterProfiles: [],
        environments: [
          { id: "e", type: "sandbox", authentication: options.authentication ?? "Windows" },
        ],
      }) as never,
    busy: () => options.busy ?? false,
    now: () => options.now ?? at(2, 1),
    emitDue: (item, occurrence) => calls.emitted.push([item.id, occurrence]),
    handle: async (planId, occurrence, pending) => {
      calls.handled.push([planId, occurrence, pending]);
    },
    notify: (title, body) => calls.notified.push([title, body]),
  };
  return { scheduler: new Scheduler(deps), calls };
}

describe("Scheduler", () => {
  it("asks the window to start a plan that is due and safe to run alone", async () => {
    const { scheduler, calls } = setup({});
    await scheduler.tick();
    expect(calls.emitted).toEqual([["plan", at(2).toISOString()]]);
    expect(calls.handled).toEqual([]);
    expect(calls.notified).toEqual([]);
  });

  it("does nothing before the time, after it was handled, or without a schedule", async () => {
    for (const options of [
      { now: at(1, 59) },
      { plans: [plan({ scheduleHandledAt: at(2).toISOString() })] },
      { plans: [plan({ schedule: undefined })] },
      { plans: [plan({ archivedAt: "2026-01-01T00:00:00.000Z" })] },
    ]) {
      const { scheduler, calls } = setup(options);
      await scheduler.tick();
      expect(calls.emitted).toEqual([]);
      expect(calls.handled).toEqual([]);
    }
  });

  it("never starts a plan that changes data: it leaves a reminder and notifies", async () => {
    const { scheduler, calls } = setup({ risk: "reversible" });
    await scheduler.tick();
    expect(calls.emitted).toEqual([]);
    expect(calls.handled).toEqual([
      [
        "plan",
        at(2).toISOString(),
        { reason: "review", detail: "It contains tests that change data." },
      ],
    ]);
    expect(calls.notified[0][0]).toBe("Nightly smoke is due");
  });

  it("asks you when the environment needs a Microsoft sign-in with no remembered session", async () => {
    const { scheduler, calls } = setup({ authentication: "AAD" });
    await scheduler.tick();
    expect(calls.emitted).toEqual([]);
    expect(calls.handled[0][2]).toMatchObject({ reason: "review" });
    expect(String((calls.handled[0][2] as { detail: string }).detail)).toMatch(/MFA/);
  });

  it("turns a moment that was missed while closed into a reminder", async () => {
    const { scheduler, calls } = setup({ now: at(9, 30) });
    await scheduler.tick();
    expect(calls.emitted).toEqual([]);
    expect(calls.handled).toEqual([["plan", at(2).toISOString(), { reason: "missed" }]]);
    expect(calls.notified[0][0]).toBe("Nightly smoke missed its run");
    expect(calls.notified[0][1]).toContain("Every day at 02:00");
  });

  it("waits while something else is running and still starts it within the window", async () => {
    const busy = setup({ busy: true });
    await busy.scheduler.tick();
    expect(busy.calls.emitted).toEqual([]);
    expect(busy.calls.handled).toEqual([]);
  });

  it("becomes a missed reminder when it stayed busy past the window", async () => {
    const { scheduler, calls } = setup({ busy: true, now: at(2, 10) });
    await scheduler.tick();
    expect(calls.handled[0][2]).toEqual({ reason: "missed" });
  });

  it("ignores a tick that overlaps with one in progress", async () => {
    const handle = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    const scheduler = new Scheduler({
      plans: () => [plan()],
      context: () => ({ tests: [], parameterProfiles: [], environments: [] }),
      busy: () => false,
      now: () => at(9),
      emitDue: () => undefined,
      handle,
      notify: () => undefined,
    });
    await Promise.all([scheduler.tick(), scheduler.tick()]);
    expect(handle).toHaveBeenCalledTimes(1);
  });

  it("can be started and stopped, and checks right away when started", async () => {
    vi.useFakeTimers();
    try {
      const { scheduler, calls } = setup({});
      scheduler.start();
      scheduler.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(calls.emitted).toHaveLength(1);
      scheduler.stop();
      await vi.advanceTimersByTimeAsync(120_000);
      expect(calls.emitted).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
