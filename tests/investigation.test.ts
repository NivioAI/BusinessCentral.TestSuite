import { describe, expect, it } from "vitest";
import {
  abandon,
  createInvestigation,
  currentIteration,
  decide,
  markHandedOff,
  parseChangeFile,
  parsePlanMarkdown,
  receivePlan,
  recordChange,
  recordRetest,
  startNextRound,
} from "../src/main/investigation";
import type { Investigation, TestRun } from "../src/shared/models";

const encode = (value: string) => new TextEncoder().encode(value);

function run(overrides: Partial<TestRun> = {}): TestRun {
  return {
    id: "run-1",
    testId: "BC-1",
    testDefinitionId: "test-1",
    testName: "Create order",
    environmentId: "env-1",
    environmentName: "Sandbox",
    customerCode: "DEMO",
    status: "FAILED",
    startedAt: new Date(Date.now() - 60_000).toISOString(),
    parameters: {},
    versionHash: "v1",
    resultDirectory: "/tmp/run",
    log: [],
    progress: [],
    steps: [],
    ...overrides,
  };
}

function created(): Investigation {
  return createInvestigation({
    number: 1,
    run: run(),
    projectId: "project-1",
    agent: "claude-code",
    includeEvidence: true,
  });
}

function applied(): Investigation {
  const investigation = created();
  markHandedOff(investigation, "codex");
  receivePlan(investigation, "# Plan");
  decide(investigation, "approved");
  recordChange(investigation, { summary: "Fix", branch: "fix/BC-1-1", files: ["a.al"] });
  return investigation;
}

describe("investigation state machine", () => {
  it("starts with a package ready and one iteration", () => {
    const investigation = created();
    expect(investigation.status).toBe("PACKAGE_READY");
    expect(investigation.iterations).toHaveLength(1);
    expect(currentIteration(investigation).runId).toBe("run-1");
  });

  it("walks the happy path to verified", () => {
    const investigation = applied();
    expect(investigation.status).toBe("CHANGE_APPLIED");
    const retest = run({ id: "run-2", status: "PASSED", startedAt: new Date().toISOString() });
    expect(recordRetest(investigation, retest)).toBe(true);
    expect(investigation.status).toBe("VERIFIED");
    expect(currentIteration(investigation).result).toBe("PASSED");
  });

  it("returns to waiting for a plan after changes are requested", () => {
    const investigation = created();
    receivePlan(investigation, "# Plan");
    decide(investigation, "changes-requested", "Leave the default alone");
    expect(investigation.status).toBe("CHANGES_REQUESTED");
    markHandedOff(investigation, "claude-code");
    expect(investigation.status).toBe("HANDED_OFF");
    receivePlan(investigation, "# Plan 2");
    expect(investigation.status).toBe("PLAN_RECEIVED");
    expect(currentIteration(investigation).decision).toBeUndefined();
  });

  it("rejects transitions that are not allowed", () => {
    const investigation = created();
    expect(() => decide(investigation, "approved")).toThrow("PACKAGE_READY");
    expect(() => recordChange(investigation, { summary: "x", branch: "b", files: [] })).toThrow();
    expect(() => startNextRound(investigation)).toThrow();
    receivePlan(investigation, "# Plan");
    expect(() => receivePlan(investigation, "# Again")).toThrow("PLAN_RECEIVED");
    expect(() => markHandedOff(investigation, "codex")).toThrow();
  });

  it("starts a new round when the retest fails", () => {
    const investigation = applied();
    const retest = run({ id: "run-2", status: "FAILED", startedAt: new Date().toISOString() });
    expect(recordRetest(investigation, retest)).toBe(true);
    expect(investigation.status).toBe("RETEST_FAILED");
    startNextRound(investigation);
    expect(investigation.status).toBe("PACKAGE_READY");
    expect(investigation.iterations).toHaveLength(2);
    expect(currentIteration(investigation)).toMatchObject({ number: 2, runId: "run-2" });
  });

  it("ignores runs that are not a retest of this change", () => {
    const investigation = applied();
    const now = new Date().toISOString();
    expect(
      recordRetest(investigation, run({ id: "r", testDefinitionId: "other", startedAt: now })),
    ).toBe(false);
    expect(recordRetest(investigation, run({ id: "r", status: "RUNNING", startedAt: now }))).toBe(
      false,
    );
    expect(recordRetest(investigation, run({ id: "r", status: "BLOCKED", startedAt: now }))).toBe(
      false,
    );
    const before = new Date(Date.now() - 3_600_000).toISOString();
    expect(recordRetest(investigation, run({ id: "r", status: "PASSED", startedAt: before }))).toBe(
      false,
    );
    expect(investigation.status).toBe("CHANGE_APPLIED");
    expect(recordRetest(created(), run({ status: "PASSED" }))).toBe(false);
  });

  it("does not record the same retest twice", () => {
    const investigation = applied();
    const retest = run({ id: "run-2", status: "FAILED", startedAt: new Date().toISOString() });
    expect(recordRetest(investigation, retest)).toBe(true);
    expect(recordRetest(investigation, retest)).toBe(false);
  });

  it("abandons open investigations and refuses to reopen closed ones", () => {
    const investigation = created();
    abandon(investigation);
    expect(investigation.status).toBe("ABANDONED");
    expect(() => abandon(investigation)).toThrow("already closed");
  });
});

describe("agent output parsing", () => {
  it("accepts a plan as plain text", () => {
    expect(parsePlanMarkdown(encode("# Plan\r\nStep"))).toBe("# Plan\nStep");
  });

  it("rejects empty, oversized and binary plans", () => {
    expect(() => parsePlanMarkdown(new Uint8Array())).toThrow("empty");
    expect(() => parsePlanMarkdown(new Uint8Array(100_001).fill(97))).toThrow("too large");
    expect(() => parsePlanMarkdown(new Uint8Array([97, 0, 98]))).toThrow("not text");
  });

  it("parses a change report and rejects invalid ones", () => {
    expect(
      parseChangeFile(
        encode(JSON.stringify({ summary: "Fix", branch: "fix/BC-1-1", files: ["a.al"] })),
      ),
    ).toEqual({ summary: "Fix", branch: "fix/BC-1-1", files: ["a.al"] });
    expect(() => parseChangeFile(encode("{not json"))).toThrow("valid JSON");
    expect(() => parseChangeFile(encode(JSON.stringify({ summary: "Fix" })))).toThrow("branch");
    expect(() => parseChangeFile(new Uint8Array(100_001))).toThrow("too large");
  });
});
