import type { RunStatus } from "../../shared/models";

const labels: Record<RunStatus, string> = {
  QUEUED: "Queued",
  RUNNING: "Running",
  PASSED: "Passed",
  FAILED: "Failed",
  BLOCKED: "Blocked",
  ABORTED: "Aborted",
  ERROR: "Error",
};

export function StatusPill({ status }: { status: RunStatus }) {
  return <span className={`status status-${status.toLowerCase()}`}>{labels[status]}</span>;
}
