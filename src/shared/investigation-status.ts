import type { InvestigationStatus } from "./models";

export const INVESTIGATION_STATUS_LABELS: Record<InvestigationStatus, string> = {
  PACKAGE_READY: "Package ready",
  HANDED_OFF: "Handed off",
  PLAN_RECEIVED: "Plan received",
  CHANGES_REQUESTED: "Changes requested",
  APPROVED: "Plan approved",
  CHANGE_APPLIED: "Change applied",
  RETEST_FAILED: "Retest failed",
  VERIFIED: "Verified",
  ABANDONED: "Abandoned",
};

/** Statuses that wait for the user: used for badges and the dashboard. */
export const NEEDS_USER_STATUSES: InvestigationStatus[] = [
  "PLAN_RECEIVED",
  "CHANGE_APPLIED",
  "RETEST_FAILED",
];

export const CLOSED_STATUSES: InvestigationStatus[] = ["VERIFIED", "ABANDONED"];

/** How many of the six progress steps are done for a status. */
export const INVESTIGATION_STEPS_DONE: Record<InvestigationStatus, number> = {
  PACKAGE_READY: 1,
  HANDED_OFF: 2,
  CHANGES_REQUESTED: 2,
  PLAN_RECEIVED: 3,
  APPROVED: 4,
  CHANGE_APPLIED: 5,
  RETEST_FAILED: 5,
  VERIFIED: 6,
  ABANDONED: 0,
};

export const INVESTIGATION_STEP_NAMES = [
  "Failure captured",
  "Handed to agent",
  "Plan received",
  "Plan approved",
  "Change applied",
  "Verified",
];
