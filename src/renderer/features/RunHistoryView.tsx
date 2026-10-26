import {
  Activity,
  Bot,
  ChevronRight,
  GitCompare,
  MonitorPlay,
  RotateCcw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { useState } from "react";
import type { AppSnapshot, TestRun } from "../../shared/models";
import { EmptyState } from "../components/Field";
import { RowMenu, type RowMenuItem } from "../components/RowMenu";
import { Select } from "../components/Select";
import { StatusPill } from "../components/StatusPill";
import { Tile } from "../components/Tile";
import { ViewSwitch, useViewMode } from "../components/ViewSwitch";
import { formatDate, formatDuration } from "../lib/format";

export function RunHistory({
  snapshot,
  contextCustomerId,
  contextEnvironmentId,
  onOpen,
  onDelete,
  onRerun,
}: {
  snapshot: AppSnapshot;
  contextCustomerId: string;
  contextEnvironmentId: string;
  onOpen(run: TestRun): void;
  onDelete(run: TestRun): void;
  onRerun(run: TestRun): void;
}) {
  const [viewMode, setViewMode] = useViewMode("runs");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [customer, setCustomer] = useState("all");
  const [source, setSource] = useState("all");
  const [period, setPeriod] = useState("all");
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [comparing, setComparing] = useState(false);
  const [comparisonNotice, setComparisonNotice] = useState<string>();
  const cutoff = period === "all" ? 0 : Date.now() - Number(period) * 86_400_000;
  const contextCustomerCode = snapshot.customers.find(
    (item) => item.id === contextCustomerId,
  )?.code;
  const runs = snapshot.runs.filter(
    (run) =>
      (!contextCustomerCode || run.customerCode === contextCustomerCode) &&
      (contextEnvironmentId === "all" || run.environmentId === contextEnvironmentId) &&
      (status === "all" || run.status === status) &&
      (customer === "all" || run.customerCode === customer) &&
      (source === "all" || (run.initiatedBy ?? "user") === source) &&
      (!cutoff || new Date(run.startedAt).getTime() >= cutoff) &&
      `${run.testId} ${run.testName} ${run.customerCode} ${run.environmentName} ${run.initiatedBy === "ai-agent" ? "AI agent" : "User"}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const selectForComparison = (run: TestRun) => {
    setComparisonNotice(undefined);
    setCompareIds((current) => {
      if (current.includes(run.id)) return current.filter((id) => id !== run.id);
      const selected = snapshot.runs.find((item) => item.id === current[0]);
      if (selected && selected.testDefinitionId !== run.testDefinitionId) {
        setComparisonNotice(
          "Run comparison was reset because only runs of the same test can be compared.",
        );
        return [run.id];
      }
      return current.length < 2 ? [...current, run.id] : [current[1], run.id];
    });
  };
  const runMenu = (run: TestRun): RowMenuItem[] => {
    const baseline = snapshot.runs.find(
      (candidate) =>
        candidate.id !== run.id &&
        candidate.testDefinitionId === run.testDefinitionId &&
        candidate.status === "PASSED",
    );
    const items: RowMenuItem[] = [
      { label: "Open run", icon: ChevronRight, onSelect: () => onOpen(run) },
      ...(run.status === "RUNNING"
        ? []
        : [{ label: "Run again", icon: RotateCcw, onSelect: () => onRerun(run) }]),
      ...(baseline
        ? [
            {
              label: "Compare with latest passed run",
              icon: Activity,
              onSelect: () => {
                setComparing(true);
                setCompareIds([baseline.id, run.id]);
              },
            },
          ]
        : []),
      { label: "Delete", icon: Trash2, danger: true, onSelect: () => onDelete(run) },
    ];
    return items;
  };
  return (
    <section className="runs-page">
      <div className="filter-bar">
        <div className="search-box">
          <Search size={17} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search test, customer or target…"
          />
        </div>
        <label className="compact-setting">
          <span className="visually-hidden">Run status</span>
          <Select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="all">All statuses</option>
            <option value="PASSED">Passed</option>
            <option value="FAILED">Failed</option>
            <option value="ABORTED">Aborted</option>
            <option value="BLOCKED">Blocked</option>
            <option value="ERROR">Error</option>
            <option value="RUNNING">Running</option>
            <option value="QUEUED">Queued</option>
          </Select>
        </label>
        <label className="compact-setting">
          <span className="visually-hidden">Customer</span>
          <Select value={customer} onChange={(event) => setCustomer(event.target.value)}>
            <option value="all">All customers</option>
            {[...new Set(snapshot.runs.map((run) => run.customerCode))].map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </Select>
        </label>
        <label className="compact-setting">
          <span className="visually-hidden">Source</span>
          <Select value={source} onChange={(event) => setSource(event.target.value)}>
            <option value="all">All sources</option>
            <option value="user">User</option>
            <option value="ai-agent">AI agent</option>
          </Select>
        </label>
        <label className="compact-setting">
          <span className="visually-hidden">Period</span>
          <Select value={period} onChange={(event) => setPeriod(event.target.value)}>
            <option value="all">All time</option>
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
          </Select>
        </label>
        <button
          type="button"
          className="icon-button icon-toggle"
          aria-pressed={comparing}
          onClick={() => {
            setComparing((current) => !current);
            setCompareIds([]);
            setComparisonNotice(undefined);
          }}
          aria-label={comparing ? "Done comparing" : "Compare runs"}
        >
          <GitCompare size={16} />
        </button>
        <span className="filter-spacer" />
        <ViewSwitch mode={viewMode} onChange={setViewMode} />
      </div>
      {compareIds.length > 0 && (
        <div className="run-comparison">
          <strong>Run comparison · select {2 - compareIds.length} more</strong>
          {compareIds.length === 2 && (
            <div className="run-comparison-grid">
              {compareIds.map((id) => {
                const run = snapshot.runs.find((item) => item.id === id);
                if (!run) return null;
                const other = snapshot.runs.find(
                  (item) => item.id === compareIds.find((candidate) => candidate !== id),
                );
                return (
                  <div key={id}>
                    <span>
                      {run.testId} · {formatDate(run.startedAt)}
                    </span>
                    <StatusPill status={run.status} />
                    <small>
                      {run.environmentName} · version {run.versionHash} ·{" "}
                      {formatDuration(run.durationMs)} · {run.steps.length} steps
                    </small>
                    {other && run.durationMs !== undefined && other.durationMs !== undefined && (
                      <small>
                        Duration difference: {run.durationMs - other.durationMs > 0 ? "+" : ""}
                        {formatDuration(run.durationMs - other.durationMs)}
                      </small>
                    )}
                    {other &&
                      JSON.stringify(run.parameters) !== JSON.stringify(other.parameters) && (
                        <small className="text-warning">
                          Run parameters differ from the comparison.
                        </small>
                      )}
                    {run.error && <small className="text-danger">{run.error}</small>}
                    <ol className="comparison-steps">
                      {run.steps.slice(0, 8).map((step, index) => {
                        const peer = other?.steps[index];
                        const changed =
                          !peer ||
                          peer.status !== step.status ||
                          peer.description !== step.description;
                        return (
                          <li
                            key={step.sequence}
                            className={changed ? "comparison-step-changed" : ""}
                          >
                            <span>
                              {step.sequence}. {step.description}
                            </span>
                            <small>
                              {step.status}
                              {changed ? " · Changed" : ""}
                            </small>
                          </li>
                        );
                      })}
                    </ol>
                  </div>
                );
              })}
            </div>
          )}
          <button
            type="button"
            className="icon-button"
            onClick={() => setCompareIds([])}
            aria-label="Clear selection"
          >
            <X size={16} />
          </button>
          {comparisonNotice && <small className="text-warning">{comparisonNotice}</small>}
        </div>
      )}
      {runs.length && viewMode === "tiles" ? (
        <div className="tile-grid">
          {runs.map((run) => (
            <Tile
              key={run.id}
              logo={<MonitorPlay size={22} />}
              title={`${run.testId} · ${run.testName}`}
              line1={`${run.customerCode} · ${run.environmentName}`}
              line2={`${formatDate(run.startedAt)} · ${formatDuration(run.durationMs)}${run.initiatedBy === "ai-agent" ? " · AI agent" : ""}`}
              status={<StatusPill status={run.status} />}
              actions={
                <>
                  {comparing && (
                    <input
                      type="checkbox"
                      checked={compareIds.includes(run.id)}
                      aria-label={`Select ${run.testId} for comparison`}
                      onChange={() => selectForComparison(run)}
                    />
                  )}
                  <button
                    type="button"
                    className="icon-button"
                    onClick={() => onOpen(run)}
                    aria-label="Open run"
                  >
                    <ChevronRight size={16} />
                  </button>
                  <RowMenu label={`Actions for ${run.testId}`} items={runMenu(run)} />
                </>
              }
            />
          ))}
        </div>
      ) : runs.length ? (
        <table className="plain-table">
          <thead>
            <tr>
              <th scope="col">Run</th>
              <th scope="col">Environment</th>
              <th scope="col">Started</th>
              <th scope="col" className="numeric">
                Duration
              </th>
              <th scope="col">Source</th>
              <th scope="col">Status</th>
              <th scope="col">
                <span className="visually-hidden">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => {
              const items = runMenu(run);
              return (
                <tr key={run.id}>
                  <td className="primary-cell">
                    <span className="cell-with-chip">
                      {comparing && (
                        <input
                          type="checkbox"
                          checked={compareIds.includes(run.id)}
                          aria-label={`Select ${run.testId} for comparison`}
                          onChange={() => selectForComparison(run)}
                        />
                      )}
                      <span className="logo-chip logo-chip-small" aria-hidden="true">
                        <MonitorPlay size={15} />
                      </span>
                      <button type="button" className="cell-link" onClick={() => onOpen(run)}>
                        {run.testId} · {run.testName}
                      </button>
                    </span>
                  </td>
                  <td>
                    {run.customerCode} · {run.environmentName}
                  </td>
                  <td>{formatDate(run.startedAt)}</td>
                  <td className="numeric">{formatDuration(run.durationMs)}</td>
                  <td>
                    {run.initiatedBy === "ai-agent" ? (
                      <span className="pill pill-info">
                        <Bot size={12} /> AI agent
                      </span>
                    ) : (
                      "User"
                    )}
                  </td>
                  <td>
                    <StatusPill status={run.status} />
                  </td>
                  <td className="numeric">
                    <RowMenu label={`Actions for ${run.testId}`} items={items} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <EmptyState
          icon={Activity}
          title={snapshot.runs.length ? "No matching runs" : "No runs recorded"}
          text={
            snapshot.runs.length
              ? "Adjust the search or status filter."
              : "Execute a test to create your first run report."
          }
        />
      )}
    </section>
  );
}
