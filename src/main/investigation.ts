import { randomUUID } from "node:crypto";
import * as z from "zod/v3";
import { CLOSED_STATUSES } from "../shared/investigation-status";
import type {
  AgentKind,
  Investigation,
  InvestigationChange,
  InvestigationIteration,
  InvestigationStatus,
  TestRun,
} from "../shared/models";

const MAX_PLAN_BYTES = 100_000;
const FINISHED_STATUSES: TestRun["status"][] = ["PASSED", "FAILED", "ERROR", "BLOCKED"];

export const TERMINAL_STATUSES: InvestigationStatus[] = CLOSED_STATUSES;

export function isTerminal(status: InvestigationStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export function createInvestigation(input: {
  number: number;
  run: TestRun;
  projectId: string;
  agent: AgentKind;
  includeEvidence: boolean;
}): Investigation {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    number: input.number,
    runId: input.run.id,
    testDefinitionId: input.run.testDefinitionId,
    projectId: input.projectId,
    status: "PACKAGE_READY",
    includeEvidence: input.includeEvidence,
    createdAt: now,
    updatedAt: now,
    iterations: [newIteration(1, input.agent, input.run.id)],
  };
}

function newIteration(number: number, agent: AgentKind, runId: string): InvestigationIteration {
  return { number, agent, runId, retestRunIds: [] };
}

export function currentIteration(investigation: Investigation): InvestigationIteration {
  const iteration = investigation.iterations.at(-1);
  if (!iteration) throw new Error("The investigation has no round.");
  return iteration;
}

function requireStatus(investigation: Investigation, allowed: InvestigationStatus[]): void {
  if (!allowed.includes(investigation.status)) {
    throw new Error(`This is not possible in status ${investigation.status}.`);
  }
}

export function markHandedOff(investigation: Investigation, agent: AgentKind): void {
  requireStatus(investigation, ["PACKAGE_READY", "HANDED_OFF", "CHANGES_REQUESTED"]);
  const iteration = currentIteration(investigation);
  iteration.agent = agent;
  iteration.handedOffAt = new Date().toISOString();
  investigation.status = "HANDED_OFF";
}

export function receivePlan(investigation: Investigation, markdown: string): void {
  requireStatus(investigation, ["PACKAGE_READY", "HANDED_OFF", "CHANGES_REQUESTED"]);
  const iteration = currentIteration(investigation);
  iteration.handedOffAt ??= new Date().toISOString();
  iteration.planMarkdown = markdown;
  iteration.planReceivedAt = new Date().toISOString();
  iteration.decision = undefined;
  iteration.decisionNote = undefined;
  iteration.decidedAt = undefined;
  investigation.status = "PLAN_RECEIVED";
}

export function decide(
  investigation: Investigation,
  decision: "approved" | "changes-requested",
  note?: string,
): void {
  requireStatus(investigation, ["PLAN_RECEIVED"]);
  const iteration = currentIteration(investigation);
  iteration.decision = decision;
  iteration.decisionNote = note || undefined;
  iteration.decidedAt = new Date().toISOString();
  investigation.status = decision === "approved" ? "APPROVED" : "CHANGES_REQUESTED";
}

export function recordChange(
  investigation: Investigation,
  change: Omit<InvestigationChange, "reportedAt">,
): void {
  requireStatus(investigation, ["APPROVED"]);
  currentIteration(investigation).change = { ...change, reportedAt: new Date().toISOString() };
  investigation.status = "CHANGE_APPLIED";
}

/** Called when a run finishes. Returns true when the investigation changed. */
export function recordRetest(investigation: Investigation, run: TestRun): boolean {
  if (investigation.status !== "CHANGE_APPLIED") return false;
  if (run.testDefinitionId !== investigation.testDefinitionId) return false;
  if (!FINISHED_STATUSES.includes(run.status) || run.status === "BLOCKED") return false;
  const iteration = currentIteration(investigation);
  const reportedAt = iteration.change?.reportedAt;
  if (!reportedAt || new Date(run.startedAt) < new Date(reportedAt)) return false;
  if (iteration.retestRunIds.includes(run.id)) return false;
  iteration.retestRunIds.push(run.id);
  iteration.result = run.status === "PASSED" ? "PASSED" : "FAILED";
  investigation.status = run.status === "PASSED" ? "VERIFIED" : "RETEST_FAILED";
  return true;
}

export function startNextRound(investigation: Investigation): void {
  requireStatus(investigation, ["RETEST_FAILED"]);
  const iteration = currentIteration(investigation);
  const failingRunId = iteration.retestRunIds.at(-1);
  if (!failingRunId) throw new Error("There is no failed retest.");
  investigation.iterations.push(newIteration(iteration.number + 1, iteration.agent, failingRunId));
  investigation.status = "PACKAGE_READY";
}

export function abandon(investigation: Investigation): void {
  if (isTerminal(investigation.status)) throw new Error("This investigation is already closed.");
  investigation.status = "ABANDONED";
}

/** Text written by the agent is untrusted: plain text only, bounded in size. */
export function parsePlanMarkdown(contents: Uint8Array): string {
  if (contents.byteLength === 0) throw new Error("plan.md is empty.");
  if (contents.byteLength > MAX_PLAN_BYTES) throw new Error("plan.md is too large (max. 100 kB).");
  if (contents.includes(0)) throw new Error("plan.md is not text.");
  const text = new TextDecoder().decode(contents).replace(/\r\n/g, "\n").trim();
  if (!text) throw new Error("plan.md is empty.");
  return text;
}

const changeFileSchema = z.object({
  summary: z.string().trim().min(1).max(2000),
  branch: z.string().trim().min(1).max(200),
  commit: z.string().trim().max(80).optional(),
  files: z.array(z.string().trim().min(1).max(500)).max(200).default([]),
});

export function parseChangeFile(contents: Uint8Array): Omit<InvestigationChange, "reportedAt"> {
  if (contents.byteLength > MAX_PLAN_BYTES) throw new Error("change.json is too large.");
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(contents));
  } catch {
    throw new Error("change.json is not valid JSON.");
  }
  const parsed = changeFileSchema.safeParse(raw);
  if (!parsed.success) throw new Error("change.json is missing a summary or branch.");
  return parsed.data;
}
