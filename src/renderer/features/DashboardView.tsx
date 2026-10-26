import { Activity, Bot, ChevronRight, Play, X } from "lucide-react";
import { useState } from "react";
import type { AppSnapshot, Investigation, TestDefinition, TestRun } from "../../shared/models";
import { PageActions } from "../components/PageActions";
import { StatusPill } from "../components/StatusPill";
import { formatDuration, messageOf, relativeTime } from "../lib/format";
import { PanelHeader } from "../lib/ui";
import type { View } from "../navigation";
import { GetStarted } from "./GetStarted";
import { testStability } from "./LibraryView";
import type { PlanRunRequest } from "./PlansView";

export function AgentApprovalPanel({
  snapshot,
  onRefresh,
}: {
  snapshot: AppSnapshot;
  onRefresh(): void;
}) {
  const [error, setError] = useState<string>();
  const requests = snapshot.mcpApprovals.filter((request) => request.status === "PENDING");
  if (!requests.length) return null;

  const resolve = (id: string, approved: boolean) => {
    setError(undefined);
    void window.bcFlow
      .resolveMcpApproval(id, approved)
      .then(onRefresh)
      .catch((cause) => setError(messageOf(cause)));
  };

  return (
    <section className="panel agent-approval-panel" aria-labelledby="agent-approval-title">
      <PanelHeader
        title="AI agent requests"
        subtitle={`${requests.length} request${requests.length === 1 ? "" : "s"} waiting for your decision`}
      />
      {error && <div className="banner-warning">{error}</div>}
      <div className="diagnostic-list">
        {requests.map((request) => (
          <div key={request.id}>
            <span className="agent-request-icon">
              <Bot size={17} />
            </span>
            <span>
              <strong>{request.title}</strong>
              <small>{request.detail}</small>
            </span>
            <span className="row-actions">
              <button
                type="button"
                className="button button-secondary button-compact"
                onClick={() => resolve(request.id, false)}
              >
                Reject
              </button>
              <button
                type="button"
                className="button button-primary button-compact"
                onClick={() => resolve(request.id, true)}
              >
                Approve
              </button>
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

export function Dashboard({
  snapshot,
  onRun,
  onOpenRun,
  onNavigate,
  onRunPlan,
  onRefresh,
}: {
  snapshot: AppSnapshot;
  onRunPlan(request: PlanRunRequest): void;
  onRun(test: TestDefinition): void;
  onOpenRun(run: TestRun): void;
  onNavigate(view: View): void;
  onRefresh(): void;
}) {
  const passed = snapshot.runs.filter((run) => run.status === "PASSED").length;
  const finished = snapshot.runs.filter((run) =>
    ["PASSED", "FAILED", "BLOCKED", "ERROR"].includes(run.status),
  ).length;
  const passRate = finished ? Math.round((passed / finished) * 100) : 0;
  const availableTests = snapshot.tests.filter((test) => !test.archivedAt);
  const latestTests = availableTests.slice(0, 4);
  const recentRuns = snapshot.runs.slice(0, 5);
  const attentionRuns = snapshot.runs.filter((run) =>
    ["FAILED", "BLOCKED", "ERROR"].includes(run.status),
  );
  const recentAttentionRuns = attentionRuns.slice(0, 5);
  const configurationIssues = [!snapshot.diagnostics.powershellAvailable].filter(Boolean).length;
  const neverRunCount = availableTests.filter(
    (test) => !snapshot.runs.some((run) => run.testDefinitionId === test.id),
  ).length;
  const updatedNotRunCount = availableTests.filter((test) => {
    const latest = snapshot.runs.find((run) => run.testDefinitionId === test.id);
    return latest && latest.versionHash !== test.versionHash;
  }).length;
  const flakyCount = availableTests.filter((test) =>
    testStability(test.id, snapshot.runs).includes("flaky"),
  ).length;
  const invalidPlanCount = snapshot.testPlans.filter((plan) =>
    plan.testDefinitionIds.some(
      (id) => !snapshot.tests.some((test) => test.id === id && !test.archivedAt),
    ),
  ).length;
  const missingCredentialCount = snapshot.environments.filter(
    (environment) =>
      !environment.archivedAt &&
      environment.authentication !== "Windows" &&
      !environment.hasCredential,
  ).length;
  const maintenanceItems = (
    [
      { label: "Tests never run", count: neverRunCount, view: "tests" },
      { label: "Updated tests not verified", count: updatedNotRunCount, view: "tests" },
      { label: "Possibly flaky tests", count: flakyCount, view: "tests" },
      { label: "Plans with unavailable tests", count: invalidPlanCount, view: "plans" },
      {
        label: "Environments missing credentials",
        count: missingCredentialCount,
        view: "environments",
      },
    ] satisfies Array<{ label: string; count: number; view: View }>
  ).filter((item) => item.count > 0);

  const trend = Array.from({ length: 14 }, (_, index) => {
    const day = new Date();
    day.setHours(0, 0, 0, 0);
    day.setDate(day.getDate() - (13 - index));
    const next = new Date(day);
    next.setDate(next.getDate() + 1);
    const dayRuns = snapshot.runs.filter((run) => {
      const startedAt = new Date(run.startedAt);
      return (
        ["PASSED", "FAILED", "BLOCKED", "ERROR"].includes(run.status) &&
        startedAt >= day &&
        startedAt < next
      );
    });
    const dayPassed = dayRuns.filter((run) => run.status === "PASSED").length;
    return {
      day,
      finished: dayRuns.length,
      rate: dayRuns.length ? Math.round((dayPassed / dayRuns.length) * 100) : 0,
    };
  });
  const peak = trend.reduce(
    (best, entry, index) =>
      entry.finished > 0 && (best < 0 || entry.rate >= trend[best].rate) ? index : best,
    -1,
  );
  const dayLabel = (day: Date) =>
    day.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  const failedCount = attentionRuns.filter((run) => run.status === "FAILED").length;
  const countStatus = (status: Investigation["status"]) =>
    snapshot.investigations.filter((item) => item.status === status).length;
  const investigationBanners = [
    {
      key: "plans",
      count: countStatus("PLAN_RECEIVED"),
      title: "plan waiting for your approval.",
      detail: "A coding agent proposed a fix. Review it before any code changes.",
    },
    {
      key: "changes",
      count: countStatus("CHANGE_APPLIED"),
      title: "change ready to retest.",
      detail: "Publish it to the sandbox, then run the retest.",
    },
    {
      key: "failed",
      count: countStatus("RETEST_FAILED"),
      title: "retest failed.",
      detail: "Start the next round with the new evidence.",
    },
  ]
    .filter((item) => item.count > 0)
    .map((item) => ({
      ...item,
      title: `${item.count} ${item.title
        .replace("plan ", item.count === 1 ? "plan " : "plans ")
        .replace("change ready", item.count === 1 ? "change ready" : "changes ready")
        .replace("retest failed", item.count === 1 ? "retest failed" : "retests failed")}`,
    }));

  return (
    <>
      <PageActions>
        <button type="button" className="button button-primary" onClick={() => onNavigate("tests")}>
          <Play size={16} /> Run a test
        </button>
      </PageActions>
      <AgentApprovalPanel snapshot={snapshot} onRefresh={onRefresh} />
      {investigationBanners.map((banner) => (
        <div className="notice-box dashboard-notice" key={banner.key}>
          <span>
            <strong>{banner.title}</strong> {banner.detail}
          </span>
          <button
            type="button"
            className="icon-button"
            onClick={() => onNavigate("investigations")}
            aria-label="Open investigations"
          >
            <Activity size={16} />
          </button>
        </div>
      ))}
      {snapshot.testPlans
        .filter((plan) => plan.schedulePending && !plan.archivedAt)
        .map((plan) => {
          const pending = plan.schedulePending;
          if (!pending) return null;
          return (
            <div className="notice-box dashboard-notice" key={plan.id}>
              <span>
                <strong>
                  {plan.name}{" "}
                  {pending.reason === "missed"
                    ? `missed its ${plan.schedule?.time ?? ""} run.`
                    : "is due."}
                </strong>{" "}
                {pending.reason === "review"
                  ? (pending.detail ?? "It needs you.")
                  : "Test Suite was closed or busy. Run it now, or skip this one."}
              </span>
              <span className="button-row">
                <button
                  type="button"
                  className="button button-secondary"
                  onClick={() => onRunPlan({ plan, scheduledFor: pending.occurrence })}
                >
                  <Play size={16} /> Review and run
                </button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Skip this run"
                  onClick={() =>
                    void window.bcFlow
                      .dismissSchedulePending(plan.id)
                      .then(onRefresh)
                      .catch((cause) => console.error(cause))
                  }
                >
                  <X size={16} />
                </button>
              </span>
            </div>
          );
        })}
      <GetStarted snapshot={snapshot} onNavigate={onNavigate} onRun={onRun} />
      <div className="kpis">
        <Metric label="Pass rate" value={`${passRate}%`} note={`${finished} completed runs`} />
        <Metric label="Runs" value={snapshot.runs.length} note="Stored locally" />
        <Metric
          label="Needs attention"
          value={attentionRuns.length}
          note={`${failedCount} failed · ${configurationIssues} configuration`}
          warn={attentionRuns.length + configurationIssues > 0}
        />
        <Metric
          label="Environments"
          value={snapshot.environments.length}
          note={
            missingCredentialCount > 0
              ? `${missingCredentialCount} credential missing`
              : `${availableTests.length} tests ready`
          }
          warn={missingCredentialCount > 0}
        />
      </div>

      <div className="dashboard-columns">
        <section className="dash-section">
          <h3>
            Pass rate <span>last 14 days</span>
          </h3>
          {finished > 0 ? (
            <>
              <div
                className="trend-chart"
                role="img"
                aria-label={`Pass rate per day for the last 14 days, latest ${trend[13].rate}%`}
              >
                {trend.map((entry, index) => (
                  <i
                    key={entry.day.toISOString()}
                    className={index === peak ? "trend-peak" : undefined}
                    style={{ height: `${Math.max(entry.rate, 3)}%` }}
                    title={`${dayLabel(entry.day)}: ${entry.finished ? `${entry.rate}% of ${entry.finished} runs` : "no runs"}`}
                  />
                ))}
              </div>
              <div className="trend-axis">
                <span>{dayLabel(trend[0].day)}</span>
                <span>{dayLabel(trend[7].day)}</span>
                <span>today</span>
              </div>
            </>
          ) : (
            <p className="section-empty">Run a test to start building the pass-rate trend.</p>
          )}
        </section>
        <section className="dash-section">
          <h3>
            Needs attention
            <button type="button" className="section-link" onClick={() => onNavigate("runs")}>
              All runs <ChevronRight size={14} />
            </button>
          </h3>
          {recentAttentionRuns.length > 0 ? (
            <div className="attention-list">
              {recentAttentionRuns.map((run) => (
                <button type="button" key={run.id} onClick={() => onOpenRun(run)}>
                  <span>
                    <strong>
                      {run.testId} · {run.testName}
                    </strong>
                    <small>{run.error ?? `${run.customerCode} · ${run.environmentName}`}</small>
                  </span>
                  <StatusPill status={run.status} />
                </button>
              ))}
            </div>
          ) : (
            <p className="section-empty">Nothing needs attention.</p>
          )}
        </section>
      </div>

      <section className="dash-section">
        <h3>
          Recent runs
          <button type="button" className="section-link" onClick={() => onNavigate("runs")}>
            All runs <ChevronRight size={14} />
          </button>
        </h3>
        {recentRuns.length ? (
          <table className="plain-table">
            <thead>
              <tr>
                <th scope="col">Test</th>
                <th scope="col">Environment</th>
                <th scope="col">Started</th>
                <th scope="col" className="numeric">
                  Duration
                </th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {recentRuns.map((run) => (
                <tr key={run.id}>
                  <td className="primary-cell">
                    <button type="button" className="cell-link" onClick={() => onOpenRun(run)}>
                      {run.testId} · {run.testName}
                    </button>
                  </td>
                  <td>
                    {run.customerCode} · {run.environmentName}
                  </td>
                  <td>{relativeTime(run.startedAt)}</td>
                  <td className="numeric">{formatDuration(run.durationMs)}</td>
                  <td>
                    <StatusPill status={run.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="section-empty">Your replay history and evidence will appear here.</p>
        )}
      </section>

      <section className="dash-section">
        <h3>Workspace maintenance</h3>
        {maintenanceItems.length > 0 ? (
          <div className="maintenance-list">
            {maintenanceItems.map((item) => (
              <button type="button" key={item.label} onClick={() => onNavigate(item.view)}>
                <span>{item.label}</span>
                <strong>{item.count}</strong>
                <ChevronRight size={16} />
              </button>
            ))}
          </div>
        ) : (
          <p className="section-empty">No maintenance issues detected.</p>
        )}
      </section>
    </>
  );
}

export function Metric({
  label,
  value,
  note,
  warn,
}: { label: string; value: string | number; note: string; warn?: boolean }) {
  return (
    <div className="kpi">
      <span className="kpi-label">{label}</span>
      <strong className="kpi-value">{value}</strong>
      <small className={warn ? "kpi-note kpi-note-warn" : "kpi-note"}>{note}</small>
    </div>
  );
}
