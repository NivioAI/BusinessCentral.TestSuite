import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  FolderOpen,
  Import,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { useState } from "react";
import { DATA_CATEGORIES, type DataCategory, withDependencies } from "../../shared/data-categories";
import type { AppSnapshot, CustomAgentSettings } from "../../shared/models";
import type { NotificationSettings } from "../../shared/notifications";
import { Field, InlineError } from "../components/Field";
import { DetailSection } from "../components/RunPage";
import { Select } from "../components/Select";
import { formatDate, messageOf, relativeTime } from "../lib/format";
import { RuntimeManagement } from "./RuntimeManagement";

export const DATA_CATEGORY_INFO: Record<
  DataCategory,
  { label: string; hint: string; count(snapshot: AppSnapshot): number | undefined }
> = {
  runs: {
    label: "Run history and evidence",
    hint: "All runs with screenshots, video and reports, and test plan history.",
    count: (snapshot) => snapshot.runs.length,
  },
  investigations: {
    label: "Investigations",
    hint: "Failure investigations and their packages. Agent changes in your repositories stay.",
    count: (snapshot) => snapshot.investigations.length,
  },
  plans: {
    label: "Test plans",
    hint: "Plans and their run history. Tests stay.",
    count: (snapshot) => snapshot.testPlans.length,
  },
  tests: {
    label: "Test library",
    hint: "All tests, recordings and parameter profiles.",
    count: (snapshot) => snapshot.tests.length,
  },
  projects: {
    label: "Projects",
    hint: "Project definitions and code folder links. Your repositories are not touched.",
    count: (snapshot) => snapshot.projects.length,
  },
  credentials: {
    label: "Saved passwords and sessions",
    hint: "Credentials and remembered sign-in sessions for all environments.",
    count: (snapshot) =>
      snapshot.environments.filter((item) => item.hasCredential || item.hasRememberedSession)
        .length,
  },
  approvals: {
    label: "AI agent requests",
    hint: "The log of requests made through the local MCP connection.",
    count: (snapshot) => snapshot.mcpApprovals.length,
  },
};

export function DataDeletionSection({
  snapshot,
  onDeleted,
}: {
  snapshot: AppSnapshot;
  onDeleted(snapshot: AppSnapshot): void;
}) {
  const [selected, setSelected] = useState<DataCategory[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [done, setDone] = useState<string>();
  const effective = withDependencies(selected);
  const forced = new Set(effective.filter((category) => !selected.includes(category)));
  const toggle = (category: DataCategory, checked: boolean) =>
    setSelected((current) =>
      checked ? [...current, category] : current.filter((item) => item !== category),
    );
  return (
    <DetailSection
      title="Delete data"
      description="Choose exactly what to remove from this device. Customers, environments, test groups and settings stay."
    >
      <fieldset className="choice-list">
        <legend className="visually-hidden">Data to delete</legend>
        {DATA_CATEGORIES.map((category) => {
          const info = DATA_CATEGORY_INFO[category];
          const count = info.count(snapshot);
          return (
            <label key={category} className="check-row">
              <input
                type="checkbox"
                checked={effective.includes(category)}
                disabled={forced.has(category) || busy}
                onChange={(event) => toggle(category, event.target.checked)}
              />
              <span>
                <strong>
                  {info.label}
                  {count !== undefined ? ` (${count})` : ""}
                </strong>
                <small>
                  {info.hint}
                  {forced.has(category) ? " Included because the selection depends on it." : ""}
                </small>
              </span>
            </label>
          );
        })}
      </fieldset>
      {error && <InlineError text={error} />}
      {done && <output className="connection-result ok">{done}</output>}
      {confirming ? (
        <div className="notice-box warn confirm-inline">
          <p className="confirmation-copy">
            <strong>This permanently deletes from this device:</strong>
          </p>
          <ul className="delete-summary">
            {effective.map((category) => {
              const count = DATA_CATEGORY_INFO[category].count(snapshot);
              return (
                <li key={category}>
                  <span>{DATA_CATEGORY_INFO[category].label}</span>
                  {count !== undefined && <span className="numeric">{count}</span>}
                </li>
              );
            })}
          </ul>
          <p className="confirmation-copy">
            Export a workspace backup first if you may need the definitions again. This cannot be
            undone.
          </p>
          <div className="button-row">
            <button
              className="button button-secondary"
              type="button"
              disabled={busy}
              onClick={() => setConfirming(false)}
            >
              Cancel
            </button>
            <button
              className="button button-danger-primary"
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError(undefined);
                try {
                  const { snapshot: next, result } = await window.bcFlow.deleteData(effective);
                  onDeleted(next);
                  setSelected([]);
                  setDone(
                    `Deleted ${result.runs} runs, ${result.investigations} investigations, ${result.plans} plans, ${result.tests} tests and ${result.projects} projects.`,
                  );
                } catch (cause) {
                  setError(messageOf(cause));
                } finally {
                  setBusy(false);
                  setConfirming(false);
                }
              }}
            >
              {busy ? "Deleting…" : "Delete permanently"}
            </button>
          </div>
        </div>
      ) : (
        <div className="button-row">
          <button
            type="button"
            className="button button-danger-primary"
            disabled={effective.length === 0 || busy}
            onClick={() => {
              setDone(undefined);
              setConfirming(true);
            }}
          >
            Delete selected data…
          </button>
        </div>
      )}
    </DetailSection>
  );
}

const NOTIFICATION_OPTIONS: Array<{
  key: keyof NotificationSettings;
  label: string;
  hint: string;
}> = [
  {
    key: "runFinished",
    label: "A run or plan has finished",
    hint: "One message per run, or one per plan when it ends.",
  },
  {
    key: "investigationNeedsMe",
    label: "An investigation needs you",
    hint: "A plan is waiting for approval, a change is ready to retest, or a retest failed.",
  },
  {
    key: "agentApproval",
    label: "An AI agent asks for approval",
    hint: "Create, start and stop requests that arrive over MCP.",
  },
  {
    key: "scheduledPlans",
    label: "A scheduled plan is due or failed",
    hint: "When a plan needs you at its time, missed its time, or failed on its own.",
  },
];

/** Program path and fixed arguments for the agent kind "other". The path comes from a file picker. */
function CustomAgentSection({
  saved,
  onChange,
}: {
  saved: CustomAgentSettings | undefined;
  onChange(agent: CustomAgentSettings | undefined): void;
}) {
  const [executable, setExecutable] = useState(saved?.executable ?? "");
  const [argsText, setArgsText] = useState((saved?.args ?? []).join("\n"));
  const [error, setError] = useState<string>();
  const args = argsText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const changed =
    executable !== (saved?.executable ?? "") || args.join("\n") !== (saved?.args ?? []).join("\n");
  return (
    <DetailSection
      title="Your own agent"
      description="Use another coding agent for failure investigations. The investigation prompt goes to its input."
    >
      <Field
        group
        label="Program"
        hint="Choose the file that starts your agent. It is never taken from a backup."
      >
        <div className="path-picker">
          <span className="mono-cell path-value">{executable || "Not set"}</span>
          <button
            type="button"
            className="button button-secondary"
            onClick={() =>
              void window.bcFlow
                .chooseAgentExecutable()
                .then((path) => path && setExecutable(path))
                .catch((cause) => setError(messageOf(cause)))
            }
          >
            <FolderOpen size={16} /> Choose…
          </button>
        </div>
      </Field>
      <Field
        label="Arguments"
        hint="One per line, passed exactly as written. No shell is used, so quotes and variables have no special meaning."
      >
        <textarea
          rows={3}
          value={argsText}
          spellCheck={false}
          onChange={(event) => setArgsText(event.target.value)}
          placeholder={"--print\n--no-color"}
        />
      </Field>
      <div className="notice-line">
        <ShieldCheck size={16} />
        <span>
          <strong>Test Suite cannot limit this program.</strong> Unlike Claude Code and Codex, it
          runs with your permissions. You confirm the exact command every time it starts.
        </span>
      </div>
      {error && <InlineError text={error} />}
      <div className="button-row">
        <button
          type="button"
          className="button button-secondary"
          disabled={!executable || !changed}
          onClick={() => {
            setError(undefined);
            onChange({ executable, args });
          }}
        >
          Save agent
        </button>
        {saved && (
          <button
            type="button"
            className="button button-secondary"
            onClick={() => {
              setExecutable("");
              setArgsText("");
              onChange(undefined);
            }}
          >
            Remove
          </button>
        )}
      </div>
    </DetailSection>
  );
}

export function SettingsView({
  snapshot,
  onStepDelayChange,
  onTextSizeChange,
  onRunRetentionChange,
  onNotificationsChange,
  onCustomAgentChange,
  onRefresh,
  onDataDeleted,
}: {
  snapshot: AppSnapshot;
  onDataDeleted(snapshot: AppSnapshot): void;
  onStepDelayChange(stepDelayMs: number): void;
  onTextSizeChange(textSize: AppSnapshot["settings"]["textSize"]): void;
  onRunRetentionChange(runRetentionDays: number): void;
  onNotificationsChange(notifications: NotificationSettings): void;
  onCustomAgentChange(agent: CustomAgentSettings | undefined): void;
  onRefresh(): void;
}) {
  const [workspaceError, setWorkspaceError] = useState<string>();
  const [mcpSetupCopied, setMcpSetupCopied] = useState<string>();
  const checks = [
    {
      label: "Microsoft bc-replay",
      value: `${snapshot.diagnostics.replayVersion ?? "Unknown version"} · ${snapshot.diagnostics.runtimeSource}`,
      ok:
        snapshot.diagnostics.replayAvailable &&
        snapshot.diagnostics.runtimeCompatibility !== "incompatible",
    },
    {
      label: "PowerShell 7",
      value: snapshot.diagnostics.powershellExecutable ?? "Not found",
      ok: snapshot.diagnostics.powershellAvailable,
    },
    { label: "Node runtime", value: snapshot.diagnostics.nodeVersion, ok: true },
    { label: "Local data", value: snapshot.diagnostics.dataDirectory, ok: true },
  ];
  const select = (
    label: string,
    value: string | number,
    onChange: (value: string) => void,
    options: Array<[string | number, string]>,
  ) => (
    <Field label={label}>
      <Select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>
            {optionLabel}
          </option>
        ))}
      </Select>
    </Field>
  );
  return (
    <div className="detail-sections settings-sections">
      <h2 className="settings-group">General</h2>
      <DetailSection title="Display" description="Applies to the whole app.">
        {select(
          "Text size",
          snapshot.settings.textSize,
          (value) => onTextSizeChange(value as AppSnapshot["settings"]["textSize"]),
          [
            ["extra-small", "Extra small"],
            ["small", "Small"],
            ["medium", "Medium"],
            ["large", "Large"],
          ],
        )}
      </DetailSection>
      <DetailSection
        title="Notifications"
        description="System notifications on this device only. Nothing is sent elsewhere."
      >
        <fieldset className="choice-list">
          <legend className="visually-hidden">Notify me when</legend>
          {NOTIFICATION_OPTIONS.map((option) => (
            <label key={option.key} className="check-row">
              <input
                type="checkbox"
                checked={snapshot.settings.notifications[option.key]}
                onChange={(event) =>
                  onNotificationsChange({
                    ...snapshot.settings.notifications,
                    [option.key]: event.target.checked,
                  })
                }
              />
              <span>
                <strong>{option.label}</strong>
                <small>{option.hint}</small>
              </span>
            </label>
          ))}
        </fieldset>
        <small className="field-hint">
          Shown only while Test Suite is in the background. Your operating system may ask for
          permission the first time.
        </small>
      </DetailSection>
      <DetailSection title="Runs" description="Pacing and retention.">
        <div className="form-grid">
          {select(
            "Delay between steps",
            snapshot.settings.stepDelayMs,
            (value) => onStepDelayChange(Number(value)),
            [
              [0, "No delay"],
              [250, "250 ms"],
              [500, "500 ms"],
              [1000, "1 second"],
              [2000, "2 seconds"],
              [5000, "5 seconds"],
            ],
          )}
          {select(
            "Run retention",
            snapshot.settings.runRetentionDays,
            (value) => onRunRetentionChange(Number(value)),
            [
              [30, "30 days"],
              [90, "90 days"],
              [180, "180 days"],
              [0, "Keep indefinitely"],
            ],
          )}
        </div>
        <small className="field-hint">
          The delay slows down the generated run copy without changing the imported test. Retention
          removes old standalone runs and their local evidence.
        </small>
      </DetailSection>
      <h2 className="settings-group">Runtime and agents</h2>
      <DetailSection title="Runtime" description="Local prerequisites for visible replay.">
        {snapshot.diagnostics.storageRecoveredFromBackup && (
          <div className="banner-warning banner-flush">
            <AlertTriangle size={17} />
            <span>
              <strong>Configuration recovered from backup</strong>
              <small>
                The primary data file was unreadable. Review the configuration before running tests.
              </small>
            </span>
          </div>
        )}
        <table className="plain-table">
          <tbody>
            {checks.map((check) => (
              <tr key={check.label}>
                <td className="primary-cell">{check.label}</td>
                <td className="mono-cell">{check.value}</td>
                <td className="numeric">
                  <span className={`pill ${check.ok ? "pill-ok" : "pill-warn"}`}>
                    {check.ok ? "Ready" : "Action needed"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="button-row">
          <button type="button" className="button button-secondary" onClick={onRefresh}>
            <RefreshCw size={16} /> Refresh
          </button>
        </div>
        <RuntimeManagement
          diagnostics={snapshot.diagnostics}
          onRefresh={onRefresh}
          onError={setWorkspaceError}
        />
      </DetailSection>
      <DetailSection
        title="AI agent access"
        description="Local MCP access for Codex and Claude Desktop."
      >
        <div className="button-row">
          <button
            type="button"
            className="button button-secondary"
            onClick={() =>
              void window.bcFlow
                .copyMcpSetup("codex")
                .then(() => setMcpSetupCopied("Codex configuration copied."))
                .catch((cause) => setWorkspaceError(messageOf(cause)))
            }
          >
            <Copy size={16} /> Copy Codex config
          </button>
          <button
            type="button"
            className="button button-secondary"
            onClick={() =>
              void window.bcFlow
                .copyMcpSetup("claude-desktop")
                .then(() => setMcpSetupCopied("Claude Desktop configuration copied."))
                .catch((cause) => setWorkspaceError(messageOf(cause)))
            }
          >
            <Copy size={16} /> Copy Claude config
          </button>
        </div>
        {mcpSetupCopied && (
          <output className="mcp-copy-feedback">
            <CheckCircle2 size={16} />
            <span>{mcpSetupCopied}</span>
          </output>
        )}
        {snapshot.mcpStatus && (
          <div className="mcp-status">
            <div className="notice-line">
              <span
                className={`status-dot${snapshot.mcpStatus.listening ? "" : " status-dot-off"}`}
                aria-hidden="true"
              />
              <span>
                <strong>
                  {snapshot.mcpStatus.listening ? "Ready for connections" : "Not running"}
                </strong>
                <small className="mcp-status-sub">
                  {snapshot.mcpStatus.lastCallAt
                    ? `Last tool call ${relativeTime(snapshot.mcpStatus.lastCallAt)}`
                    : "No agent has called a tool yet"}
                </small>
              </span>
            </div>
            <table className="plain-table">
              <thead>
                <tr>
                  <th scope="col">Tool</th>
                  <th scope="col">Allowed to</th>
                  <th scope="col">Last call</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.mcpStatus.tools.map((tool) => (
                  <tr key={tool.name}>
                    <td className="primary-cell mono-cell">{tool.name}</td>
                    <td>{tool.kind}</td>
                    <td>{tool.lastCallAt ? relativeTime(tool.lastCallAt) : "Never"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="notice-line">
          <ShieldCheck size={16} />
          <span>
            <strong>Human approval remains required.</strong> Pending create, start and stop
            requests appear on the Dashboard.
          </span>
        </div>
        <div className="agent-audit-list">
          <strong>Recent agent decisions</strong>
          {snapshot.mcpApprovals
            .filter((request) => request.status !== "PENDING")
            .slice(0, 5)
            .map((request) => (
              <div key={request.id}>
                <span>
                  <strong>{request.title}</strong>
                  <small>{formatDate(request.requestedAt)}</small>
                </span>
                <span className="pill-neutral">{request.status}</span>
              </div>
            ))}
          {!snapshot.mcpApprovals.some((request) => request.status !== "PENDING") && (
            <small>No agent decisions recorded yet.</small>
          )}
        </div>
      </DetailSection>
      <CustomAgentSection saved={snapshot.settings.customAgent} onChange={onCustomAgentChange} />
      <h2 className="settings-group">Data and security</h2>
      <DetailSection
        title="Backup and restore"
        description="Backups never include credentials, sessions, run history or evidence."
      >
        <div className="button-row">
          <button
            type="button"
            className="button button-secondary"
            onClick={() =>
              void window.bcFlow
                .exportWorkspace()
                .catch((cause) => setWorkspaceError(messageOf(cause)))
            }
          >
            <FolderOpen size={16} /> Export workspace
          </button>
          <button
            type="button"
            className="button button-secondary"
            onClick={() =>
              void window.bcFlow
                .importWorkspace()
                .then(onRefresh)
                .catch((cause) => setWorkspaceError(messageOf(cause)))
            }
          >
            <Import size={16} /> Import workspace
          </button>
        </div>
        {workspaceError && <InlineError text={workspaceError} />}
      </DetailSection>
      <DetailSection
        title="Security defaults"
        description="Fixed by design. They cannot be changed here."
      >
        <ul className="plain-list">
          <li>Production runs are blocked.</li>
          <li>Credentials use Electron safeStorage and never enter YAML or run logs.</li>
          <li>Sandbox and UAT allowlist, with explicit confirmation for write tests.</li>
          <li>Separate runner process and secret parameter masking.</li>
        </ul>
      </DetailSection>
      <DataDeletionSection snapshot={snapshot} onDeleted={onDataDeleted} />
    </div>
  );
}
