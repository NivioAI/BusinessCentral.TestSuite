import { describe, expect, it } from "vitest";
import type { TestPlan } from "../src/shared/models";
import { reviewBlocker, unattendedBlocker } from "../src/shared/plan-run";
import {
  ON_TIME_WINDOW_MS,
  dueState,
  isValidTime,
  latestOccurrence,
  scheduleLabel,
} from "../src/shared/schedule";

// Monday 19 October 2026, local time.
const at = (day: number, hours: number, minutes = 0) => new Date(2026, 9, day, hours, minutes);
const everyDay = { days: "every-day", time: "02:00" } as const;
const weekdays = { days: "weekdays", time: "02:00" } as const;

describe("schedule logic", () => {
  it("starts from a Monday", () => {
    expect(at(19, 12).getDay()).toBe(1);
  });

  it("finds the latest occurrence before or at now", () => {
    expect(latestOccurrence(everyDay, at(19, 3))).toEqual(at(19, 2));
    expect(latestOccurrence(everyDay, at(19, 2))).toEqual(at(19, 2));
    expect(latestOccurrence(everyDay, at(19, 1, 59))).toEqual(at(18, 2));
  });

  it("skips the weekend for weekday schedules", () => {
    expect(latestOccurrence(weekdays, at(19, 1))).toEqual(at(16, 2)); // Monday morning → Friday
    expect(latestOccurrence(weekdays, at(17, 12))).toEqual(at(16, 2)); // Saturday → Friday
    expect(latestOccurrence(weekdays, at(18, 12))).toEqual(at(16, 2)); // Sunday → Friday
    expect(latestOccurrence(weekdays, at(20, 3))).toEqual(at(20, 2)); // Tuesday after the time
  });

  it("is on time shortly after the moment, missed later, and nothing once handled", () => {
    const now = at(19, 2, 3);
    expect(dueState(everyDay, undefined, now).state).toBe("on-time");
    expect(dueState(everyDay, at(18, 2).toISOString(), now).state).toBe("on-time");
    expect(dueState(everyDay, at(19, 2).toISOString(), now).state).toBe("none");
    expect(dueState(everyDay, undefined, at(19, 2, 5)).state).toBe("on-time");
    expect(dueState(everyDay, undefined, at(19, 2, 6)).state).toBe("missed");
    expect(dueState(everyDay, undefined, at(19, 9)).state).toBe("missed");
    expect(ON_TIME_WINDOW_MS).toBe(5 * 60_000);
  });

  it("reports the moment it is about", () => {
    expect(dueState(everyDay, undefined, at(19, 2, 1)).occurrence).toEqual(at(19, 2));
  });

  it("validates and describes times", () => {
    expect(isValidTime("02:00")).toBe(true);
    expect(isValidTime("23:59")).toBe(true);
    for (const bad of ["24:00", "2:00", "02:60", "ab:cd", ""]) expect(isValidTime(bad)).toBe(false);
    expect(scheduleLabel(weekdays)).toBe("Weekdays at 02:00");
    expect(scheduleLabel(everyDay)).toBe("Every day at 02:00");
  });
});

const test = (id: string, extra: object = {}) => ({
  id,
  risk: "read-only",
  parameters: [],
  ...extra,
});
const plan = {
  id: "p",
  name: "Nightly",
  customerId: "c",
  environmentId: "e",
  testDefinitionIds: ["a", "b"],
} as TestPlan;
const environment = (extra: object = {}) => ({
  id: "e",
  type: "sandbox",
  authentication: "Windows",
  ...extra,
});
const context = (tests: object[], envs: object[] = [environment()]) =>
  ({ tests, parameterProfiles: [], environments: envs }) as never;

describe("what may run without anyone present", () => {
  it("allows read-only tests on a Windows-authenticated environment", () => {
    const ready = context([test("a"), test("b")]);
    expect(reviewBlocker(ready, plan)).toBeUndefined();
    expect(unattendedBlocker(ready, plan)).toBeUndefined();
  });

  it("blocks tests that change data, missing tests and missing required values", () => {
    expect(reviewBlocker(context([test("a"), test("b", { risk: "reversible" })]), plan)).toMatch(
      /change data/,
    );
    expect(reviewBlocker(context([test("a")]), plan)).toMatch(/no longer exists/);
    expect(
      reviewBlocker(
        context([
          test("a", { parameters: [{ name: "n", required: true, secret: false }] }),
          test("b"),
        ]),
        plan,
      ),
    ).toMatch(/values/);
  });

  it("needs a remembered session for Microsoft sign-in, and refuses production and unknown environments", () => {
    const tests = [test("a"), test("b")];
    expect(
      unattendedBlocker(context(tests, [environment({ authentication: "AAD" })]), plan),
    ).toMatch(/MFA/);
    expect(
      unattendedBlocker(
        context(tests, [environment({ authentication: "AAD", hasRememberedSession: true })]),
        plan,
      ),
    ).toBeUndefined();
    expect(unattendedBlocker(context(tests, [environment({ type: "production" })]), plan)).toMatch(
      /Production/,
    );
    expect(unattendedBlocker(context(tests, []), plan)).toMatch(/environment/);
    expect(unattendedBlocker(context(tests, [environment({ archivedAt: "x" })]), plan)).toMatch(
      /environment/,
    );
  });
});
