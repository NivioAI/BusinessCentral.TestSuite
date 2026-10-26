import {
  INVESTIGATION_STATUS_LABELS,
  NEEDS_USER_STATUSES,
} from "../../shared/investigation-status";
import type { InvestigationStatus } from "../../shared/models";

export function InvestigationStatusPill({ status }: { status: InvestigationStatus }) {
  const tone =
    status === "VERIFIED"
      ? "pill-ok"
      : status === "RETEST_FAILED"
        ? "pill-err"
        : NEEDS_USER_STATUSES.includes(status)
          ? "pill-warn"
          : status === "ABANDONED"
            ? "pill-neutral"
            : "pill-info";
  return <span className={`pill ${tone}`}>{INVESTIGATION_STATUS_LABELS[status]}</span>;
}
