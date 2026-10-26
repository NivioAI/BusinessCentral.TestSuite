import {
  Ban,
  Check,
  ChevronRight,
  ClipboardCopy,
  ClipboardList,
  ExternalLink,
  Eye,
  FolderInput,
  FolderOpen,
  MessageSquareWarning,
  Play,
  RefreshCw,
  Search,
  SearchCheck,
  Square,
  UserCheck,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { branchName } from "../../shared/branch-name";
import {
  CLOSED_STATUSES,
  INVESTIGATION_STEPS_DONE,
  INVESTIGATION_STEP_NAMES,
  NEEDS_USER_STATUSES,
} from "../../shared/investigation-status";
import type {
  AgentKind,
  AppSnapshot,
  Investigation,
  TestDefinition,
  TestRun,
} from "../../shared/models";
import { EditPage } from "../components/EditPage";
import { EmptyState, Field, InlineError } from "../components/Field";
import { InvestigationStatusPill } from "../components/InvestigationStatusPill";
import { MarkdownText } from "../components/MarkdownText";
import { DetailSection, RunPage } from "../components/RunPage";
import { Select } from "../components/Select";
import { StatusPill } from "../components/StatusPill";
import { Tile } from "../components/Tile";
import { ViewSwitch, useViewMode } from "../components/ViewSwitch";
import { formatDate, messageOf, relativeTime } from "../lib/format";
import { agentLabel } from "./ProjectsView";

const AGENTS: AgentKind[] = ["claude-code", "codex", "other"];

function describe(snapshot: AppSnapshot, investigation: Investigation) {
  const test = snapshot.tests.find((item) => item.id === investigation.testDefinitionId);
  const run = snapshot.runs.find((item) => item.id === investigation.runId);
  const project = snapshot.projects.find((item) => item.id === investigation.projectId);
  return {
    title: `${test?.testId ?? run?.testId ?? "Test"} · ${test?.name ?? run?.testName ?? "removed"}`,
    projectName: project?.name ?? "Removed project",
    round: investigation.iterations.at(-1)?.number ?? 1,
  };
}

export function InvestigationsView({
  snapshot,
  onOpen,
}: {
  snapshot: AppSnapshot;
  onOpen(investigation: Investigation): void;
}) {
  const [query, setQuery] = useState("");
  const [needsMe, setNeedsMe] = useState(false);
  const [showClosed, setShowClosed] = useState(false);
  const [viewMode, setViewMode] = useViewMode("investigations");
  const items = snapshot.investigations.filter((investigation) => {
    if (needsMe && !NEEDS_USER_STATUSES.includes(investigation.status)) return false;
    if (!showClosed && CLOSED_STATUSES.includes(investigation.status)) return false;
    const info = describe(snapshot, investigation);
    return `${info.title} ${info.projectName} INV-${investigation.number}`
      .toLowerCase()
      .includes(query.toLowerCase());
  });
  return (
    <>
      <div className="filter-bar">
        <div className="search-box">
          <Search size={17} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search investigations…"
          />
        </div>
        <button
          type="button"
          className="icon-button icon-toggle"
          aria-pressed={needsMe}
          onClick={() => setNeedsMe((current) => !current)}
          aria-label="Needs me"
        >
          <UserCheck size={16} />
        </button>
        <button
          type="button"
          className="icon-button icon-toggle"
          aria-pressed={showClosed}
          onClick={() => setShowClosed((current) => !current)}
          aria-label={showClosed ? "Hide closed" : "Show closed"}
        >
          <Eye size={16} />
        </button>
        <span className="filter-spacer" />
        <ViewSwitch mode={viewMode} onChange={setViewMode} />
      </div>
      {items.length ? (
        viewMode === "list" ? (
          <table className="plain-table">
            <thead>
              <tr>
                <th scope="col">Investigation</th>
                <th scope="col">Project</th>
                <th scope="col">Status</th>
                <th scope="col" className="numeric">
                  Round
                </th>
                <th scope="col">Updated</th>
              </tr>
            </thead>
            <tbody>
              {items.map((investigation) => {
                const info = describe(snapshot, investigation);
                return (
                  <tr key={investigation.id}>
                    <td className="primary-cell">
                      <span className="cell-with-chip">
                        <span className="logo-chip logo-chip-small" aria-hidden="true">
                          <SearchCheck size={15} />
                        </span>
                        <span>
                          <button
                            type="button"
                            className="cell-link"
                            onClick={() => onOpen(investigation)}
                          >
                            {info.title}
                          </button>
                          <small className="cell-sub">INV-{investigation.number}</small>
                        </span>
                      </span>
                    </td>
                    <td>{info.projectName}</td>
                    <td>
                      <InvestigationStatusPill status={investigation.status} />
                    </td>
                    <td className="numeric">{info.round}</td>
                    <td>{relativeTime(investigation.updatedAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <div className="tile-grid">
            {items.map((investigation) => {
              const info = describe(snapshot, investigation);
              return (
                <Tile
                  key={investigation.id}
                  logo={<SearchCheck size={22} />}
                  title={info.title}
                  line1={`INV-${investigation.number} · ${info.projectName}`}
                  line2={`Round ${info.round} · ${relativeTime(investigation.updatedAt)}`}
                  status={<InvestigationStatusPill status={investigation.status} />}
                  actions={
                    <button
                      type="button"
                      className="icon-button"
                      onClick={() => onOpen(investigation)}
                      aria-label="Open investigation"
                    >
                      <ChevronRight size={16} />
                    </button>
                  }
                />
              );
            })}
          </div>
        )
      ) : (
        <EmptyState
          icon={SearchCheck}
          title="No investigations"
          text="When a test fails, open the run and choose Create investigation to hand it to a coding agent."
        />
      )}
    </>
  );
}

export function CreateInvestigationModal({
  snapshot,
  run,
  onClose,
  onCreated,
}: {
  snapshot: AppSnapshot;
  run: TestRun;
  onClose(): void;
  onCreated(snapshot: AppSnapshot): void;
}) {
  const test = snapshot.tests.find((item) => item.id === run.testDefinitionId);
  const candidates = snapshot.projects.filter(
    (project) => !project.archivedAt && project.environmentId === run.environmentId,
  );
  const linked = candidates.filter((project) => test?.projectIds?.includes(project.id));
  const options = linked.length ? linked : candidates;
  const [projectId, setProjectId] = useState(options[0]?.id ?? "");
  const [includeEvidence, setIncludeEvidence] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  return (
    <EditPage
      title="Create investigation"
      eyebrow={`${run.testId} · ${run.testName}`}
      onClose={onClose}
      busy={busy}
      action="Create investigation"
      disabled={!projectId || !options.length}
      error={error}
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setError(undefined);
        try {
          onCreated(
            await window.bcFlow.createInvestigation({
              runId: run.id,
              projectId,
              includeEvidence,
            }),
          );
        } catch (cause) {
          setError(messageOf(cause));
        } finally {
          setBusy(false);
        }
      }}
    >
      <DetailSection
        title="Project"
        description="The AL code to investigate. A package is built from this failed run."
      >
        {options.length ? (
          <Field
            label="Project"
            hint={
              linked.length
                ? `${test?.testId} is linked to ${linked.length} project${linked.length === 1 ? "" : "s"}.`
                : "This test is not linked to a project yet; any project of the environment works."
            }
          >
            <Select
              value={projectId}
              onChange={(event) => setProjectId(event.target.value)}
              required
            >
              {options.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : (
          <InlineError text="Add a project for this environment first (Configuration → Projects)." />
        )}
      </DetailSection>
      <DetailSection
        title="Evidence"
        description="Nothing leaves Test Suite until you hand the package to an agent."
      >
        <label className="risk-confirm">
          <input
            type="checkbox"
            checked={includeEvidence}
            onChange={(event) => setIncludeEvidence(event.target.checked)}
          />
          <span>
            <strong>Include screenshots and video</strong>
            <small>They can show customer data. Turn this off to share steps and logs only.</small>
          </span>
        </label>
      </DetailSection>
    </EditPage>
  );
}

export function InvestigationPage({
  snapshot,
  investigation,
  onClose,
  onSnapshot,
  onOpenRun,
  onRetest,
  onRegression,
  onRunRegression,
}: {
  snapshot: AppSnapshot;
  investigation: Investigation;
  onClose(): void;
  onSnapshot(snapshot: AppSnapshot): void;
  onOpenRun(run: TestRun): void;
  onRetest(test: TestDefinition): void;
  onRegression(testIds: string[], environmentId: string): void;
  onRunRegression(investigation: Investigation): void;
}) {
  const iteration = investigation.iterations.at(-1);
  const info = describe(snapshot, investigation);
  const test = snapshot.tests.find((item) => item.id === investigation.testDefinitionId);
  const project = snapshot.projects.find((item) => item.id === investigation.projectId);
  const run = snapshot.runs.find((item) => item.id === iteration?.runId);
  const regressionEnvironment = snapshot.environments.find(
    (item) => item.id === project?.environmentId,
  );
  const regressionTests = regressionEnvironment
    ? snapshot.tests.filter(
        (item) =>
          item.id !== investigation.testDefinitionId &&
          !item.archivedAt &&
          item.projectIds?.includes(investigation.projectId) &&
          item.allowedEnvironmentTypes.includes(regressionEnvironment.type),
      )
    : [];
  const regressionRun = snapshot.testPlanRuns.find(
    (item) => item.testPlanId === `regression:${investigation.id}`,
  );
  const [agent, setAgent] = useState<AgentKind>(
    iteration?.agent ?? project?.agent ?? "claude-code",
  );
  const [prompt, setPrompt] = useState("");
  const [agentRunning, setAgentRunning] = useState(false);
  const [agentLog, setAgentLog] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const [change, setChange] = useState({
    summary: "",
    branch: branchName(test?.testId ?? "test", iteration?.number ?? 1),
    commit: "",
    files: "",
  });

  const loadPrompt = useCallback(() => {
    window.bcFlow
      .getInvestigationPrompt(investigation.id, agent)
      .then(setPrompt)
      .catch(() => setPrompt(""));
  }, [investigation.id, agent]);
  useEffect(() => loadPrompt(), [loadPrompt]);
  useEffect(
    () =>
      window.bcFlow.onRunnerEvent((event) => {
        if (!("investigationId" in event) || event.investigationId !== investigation.id) return;
        if (event.type === "agent-log") setAgentLog((lines) => [...lines.slice(-300), event.line]);
        if (event.type === "agent-finished") {
          setAgentRunning(false);
          setAgentLog((lines) => [...lines, event.message]);
        }
      }),
    [investigation.id],
  );

  if (!iteration) return null;
  const status = investigation.status;
  const closed = CLOSED_STATUSES.includes(status);
  const stepsDone = INVESTIGATION_STEPS_DONE[status];
  const canHandOff = ["PACKAGE_READY", "HANDED_OFF", "CHANGES_REQUESTED"].includes(status);
  const canRunAgent =
    (canHandOff || status === "APPROVED") &&
    Boolean(project?.codePath) &&
    (agent !== "other" || Boolean(snapshot.settings.customAgent));

  const act = async (action: () => Promise<AppSnapshot>, done?: string) => {
    setBusy(true);
    setError(undefined);
    setMessage(undefined);
    try {
      const next = await action();
      onSnapshot(next);
      loadPrompt();
      if (done) setMessage(done);
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <RunPage
      title={info.title}
      subtitle={`INV-${investigation.number} · ${info.projectName} · Round ${iteration.number}`}
      status={<InvestigationStatusPill status={status} />}
      actions={
        <>
          {!closed && (
            <button
              type="button"
              className="icon-button"
              disabled={busy}
              onClick={() => void act(() => window.bcFlow.abandonInvestigation(investigation.id))}
              aria-label="Abandon investigation"
            >
              <Ban size={16} />
            </button>
          )}
          {status === "CHANGE_APPLIED" && test && (
            <button type="button" className="button button-primary" onClick={() => onRetest(test)}>
              <Play size={16} /> Run retest
            </button>
          )}
        </>
      }
      onBack={onClose}
    >
      {!closed && (
        <ol className="stepper" aria-label="Progress">
          {INVESTIGATION_STEP_NAMES.map((name, index) => (
            <li
              key={name}
              className={index < stepsDone ? "done" : index === stepsDone ? "now" : undefined}
            >
              <i>{index < stepsDone ? "✓" : index + 1}</i>
              <span>{name}</span>
            </li>
          ))}
        </ol>
      )}
      {error && <InlineError text={error} />}
      {message && <output className="connection-result ok">{message}</output>}

      <DetailSection title="Failure" description="The evidence in the package.">
        <div className="notice-box warn">
          <span>
            <strong>
              {run
                ? `${run.status === "ERROR" ? "Technical error" : "Test failed"}.`
                : "Run removed."}
            </strong>{" "}
            {run?.error ?? "Open the run to see the failing step."}
          </span>
          {run && (
            <button
              type="button"
              className="icon-button"
              onClick={() => onOpenRun(run)}
              aria-label="View run"
            >
              <ExternalLink size={16} />
            </button>
          )}
        </div>
      </DetailSection>

      {canHandOff && (
        <DetailSection
          title="Hand-off"
          description="Which agent works on this, and how it gets the package."
        >
          <fieldset className="choice-chips" aria-label="Coding agent">
            {AGENTS.map((item) => (
              <button
                type="button"
                key={item}
                aria-pressed={agent === item}
                onClick={() => setAgent(item)}
              >
                {agentLabel(item)}
              </button>
            ))}
          </fieldset>
          <pre className="prompt-preview">{prompt}</pre>
          <div className="button-row">
            <button
              type="button"
              className="icon-button"
              disabled={busy}
              onClick={() =>
                void act(
                  () => window.bcFlow.copyInvestigationPrompt(investigation.id, agent),
                  "Prompt copied. Paste it into your agent in the project folder.",
                )
              }
              aria-label="Copy prompt"
            >
              <ClipboardCopy size={16} />
            </button>
            {project?.codePath && (
              <button
                type="button"
                className="icon-button"
                disabled={busy}
                onClick={() =>
                  void act(() => window.bcFlow.exportInvestigationPackage(investigation.id))
                }
                aria-label="Export package into project"
              >
                <FolderInput size={16} />
              </button>
            )}
            <button
              type="button"
              className="icon-button"
              onClick={() => void window.bcFlow.revealInvestigation(investigation.id)}
              aria-label="Reveal package"
            >
              <FolderOpen size={16} />
            </button>
            <button
              type="button"
              className="icon-button"
              disabled={busy}
              onClick={() =>
                void act(
                  () => window.bcFlow.importAgentOutput(investigation.id),
                  "Plan imported from the agent folder.",
                )
              }
              aria-label="Check for the agent's plan"
            >
              <RefreshCw size={16} />
            </button>
          </div>
          <small className="field-hint">
            The agent writes <code>plan.md</code> into the agent folder
            {investigation.exportedPath ? " inside your project" : " next to the package"}. This
            screen imports it when you choose Check for the agent's plan.
          </small>
        </DetailSection>
      )}

      {canRunAgent && (
        <DetailSection
          title="Run from Test Suite"
          description={
            agent === "other"
              ? "Runs your own agent in the project folder. Test Suite cannot limit it; you confirm every start."
              : status === "APPROVED"
                ? "Runs the agent in the project folder to apply the approved plan. It can commit locally and cannot push."
                : "Runs the agent read-only in the project folder. It reads the code and returns a plan; it cannot edit anything."
          }
        >
          <div className="button-row">
            <button
              type="button"
              className="button button-secondary"
              disabled={busy || agentRunning}
              onClick={() => {
                setAgentLog([]);
                setError(undefined);
                setAgentRunning(true);
                window.bcFlow
                  .startInvestigationAgent(investigation.id)
                  .then((started) => {
                    if (!started) setAgentRunning(false);
                  })
                  .catch((cause) => {
                    setAgentRunning(false);
                    setError(messageOf(cause));
                  });
              }}
            >
              <Play size={16} /> {status === "APPROVED" ? "Apply plan with" : "Analyze with"}{" "}
              {agentLabel(agent)}
            </button>
            {agentRunning && (
              <button
                type="button"
                className="icon-button danger"
                onClick={() => void window.bcFlow.stopInvestigationAgent()}
                aria-label="Stop agent"
              >
                <Square size={16} />
              </button>
            )}
          </div>
          {agentLog.length > 0 && <pre className="prompt-preview">{agentLog.join("\n")}</pre>}
          <small className="field-hint">
            The agent is your own installation and may send the package to its provider. Test Suite
            sends nothing itself.
          </small>
        </DetailSection>
      )}

      {iteration.planMarkdown && (
        <DetailSection
          title="Plan from the agent"
          description="Review before any code changes. Nothing is edited until you approve."
        >
          <div className="plan-text">
            <MarkdownText source={iteration.planMarkdown} />
          </div>
          {status === "PLAN_RECEIVED" ? (
            <>
              <Field label="Your note to the agent (optional)">
                <textarea
                  rows={3}
                  maxLength={2000}
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="For example: keep the default invoice number out of scope."
                />
              </Field>
              <div className="button-row">
                <button
                  type="button"
                  className="button button-primary"
                  disabled={busy}
                  onClick={() =>
                    void act(() =>
                      window.bcFlow.decideInvestigation({
                        id: investigation.id,
                        decision: "approved",
                        note: note || undefined,
                      }),
                    )
                  }
                >
                  <Check size={16} /> Approve plan
                </button>
                <button
                  type="button"
                  className="icon-button"
                  disabled={busy || !note.trim()}
                  title={note.trim() ? undefined : "Explain what should change"}
                  onClick={() =>
                    void act(() =>
                      window.bcFlow.decideInvestigation({
                        id: investigation.id,
                        decision: "changes-requested",
                        note,
                      }),
                    )
                  }
                  aria-label="Request changes"
                >
                  <MessageSquareWarning size={16} />
                </button>
              </div>
            </>
          ) : (
            iteration.decision && (
              <p className="field-hint">
                {iteration.decision === "approved" ? "Approved" : "Changes requested"}
                {iteration.decidedAt ? ` on ${formatDate(iteration.decidedAt)}` : ""}
                {iteration.decisionNote ? `: ${iteration.decisionNote}` : "."}
              </p>
            )
          )}
        </DetailSection>
      )}

      {status === "APPROVED" && (
        <DetailSection
          title="Change"
          description="After approval the agent changes the code on a branch and reports it."
        >
          <div className="button-row">
            <button
              type="button"
              className="icon-button"
              disabled={busy}
              onClick={() =>
                void act(
                  () => window.bcFlow.importAgentOutput(investigation.id),
                  "Change report imported from the agent folder.",
                )
              }
              aria-label="Check for the agent's change report"
            >
              <RefreshCw size={16} />
            </button>
          </div>
          <small className="field-hint">
            Or record the change yourself. The agent never pushes; review the branch with git.
          </small>
          <form
            className="change-form"
            onSubmit={(event) => {
              event.preventDefault();
              void act(() =>
                window.bcFlow.recordInvestigationChange({
                  id: investigation.id,
                  summary: change.summary,
                  branch: change.branch,
                  commit: change.commit || undefined,
                  files: change.files
                    .split(",")
                    .map((file) => file.trim())
                    .filter(Boolean),
                }),
              );
            }}
          >
            <Field label="What changed">
              <input
                value={change.summary}
                onChange={(event) => setChange({ ...change, summary: event.target.value })}
                required
              />
            </Field>
            <div className="form-grid">
              <Field label="Branch">
                <input
                  value={change.branch}
                  onChange={(event) => setChange({ ...change, branch: event.target.value })}
                  required
                />
              </Field>
              <Field label="Commit (optional)">
                <input
                  value={change.commit}
                  onChange={(event) => setChange({ ...change, commit: event.target.value })}
                />
              </Field>
            </div>
            <Field label="Files (comma-separated)">
              <input
                value={change.files}
                onChange={(event) => setChange({ ...change, files: event.target.value })}
              />
            </Field>
            <div className="button-row">
              <button type="submit" className="button button-secondary" disabled={busy}>
                Record change
              </button>
            </div>
          </form>
        </DetailSection>
      )}

      {iteration.change && (
        <DetailSection
          title="Change"
          description="Reported for this round. Review it with git before you publish."
        >
          <table className="plain-table">
            <tbody>
              <tr>
                <td className="primary-cell">Summary</td>
                <td>{iteration.change.summary}</td>
              </tr>
              <tr>
                <td className="primary-cell">Branch</td>
                <td className="mono-cell">{iteration.change.branch}</td>
              </tr>
              {iteration.change.commit && (
                <tr>
                  <td className="primary-cell">Commit</td>
                  <td className="mono-cell">{iteration.change.commit}</td>
                </tr>
              )}
              {iteration.change.files.length > 0 && (
                <tr>
                  <td className="primary-cell">Files</td>
                  <td className="mono-cell">{iteration.change.files.join(" · ")}</td>
                </tr>
              )}
            </tbody>
          </table>
        </DetailSection>
      )}

      {(status === "CHANGE_APPLIED" || status === "RETEST_FAILED" || status === "VERIFIED") && (
        <DetailSection
          title="Retest"
          description="You publish to the sandbox and start the test. Test Suite never publishes to an environment."
        >
          {status === "CHANGE_APPLIED" && (
            <div className="notice-box">
              <span>
                <strong>What you do next:</strong> publish branch{" "}
                <code>{iteration.change?.branch}</code> to {info.projectName}'s environment, then
                run the retest.
              </span>
              {test && (
                <button
                  type="button"
                  className="button button-primary"
                  onClick={() => onRetest(test)}
                >
                  <Play size={16} /> Run retest
                </button>
              )}
            </div>
          )}
          {status === "RETEST_FAILED" && (
            <div className="notice-box warn">
              <span>
                <strong>The retest failed.</strong> Start a new round: the package is rebuilt with
                the new evidence and your agent gets the previous change as context.
              </span>
              <button
                type="button"
                className="button button-primary"
                disabled={busy}
                onClick={() =>
                  void act(() => window.bcFlow.startNextInvestigationRound(investigation.id))
                }
              >
                Start next round
              </button>
            </div>
          )}
          {status === "VERIFIED" && (
            <div className="notice-box">
              <span>
                <strong>Verified.</strong> The retest passed.
              </span>
            </div>
          )}
          {(status === "CHANGE_APPLIED" || status === "VERIFIED" || regressionRun) &&
            regressionEnvironment &&
            (regressionTests.length > 0 || regressionRun) && (
              <>
                <div className="notice-box">
                  <span>
                    <strong>Regression check (optional).</strong> Run the other{" "}
                    {regressionTests.length} test{regressionTests.length === 1 ? "" : "s"} of{" "}
                    {info.projectName} in order to see that the change broke nothing else. It stops
                    at the first failure.
                  </span>
                  <span className="button-row">
                    <button
                      type="button"
                      className="button button-secondary"
                      disabled={
                        regressionTests.length === 0 ||
                        regressionRun?.status === "RUNNING" ||
                        Boolean(snapshot.activeRunId)
                      }
                      onClick={() => onRunRegression(investigation)}
                    >
                      <Play size={16} /> Run regression
                    </button>
                    {regressionTests.length > 0 && (
                      <button
                        type="button"
                        className="icon-button"
                        onClick={() =>
                          onRegression(
                            regressionTests.map((item) => item.id),
                            regressionEnvironment.id,
                          )
                        }
                        aria-label="Create a test plan from these tests"
                      >
                        <ClipboardList size={16} />
                      </button>
                    )}
                  </span>
                </div>
                {regressionRun && (
                  <div className="regression-run">
                    <table className="plain-table">
                      <tbody>
                        {(regressionRun.testDefinitionIds ?? []).map((testId, index) => {
                          const item = regressionRun.items.find(
                            (candidate) => candidate.testDefinitionId === testId,
                          );
                          const test = snapshot.tests.find((candidate) => candidate.id === testId);
                          const next = index === regressionRun.items.length;
                          const running = !item && next && regressionRun.status === "RUNNING";
                          return (
                            <tr key={testId}>
                              <td className="primary-cell">
                                {test ? `${test.testId} · ${test.name}` : testId}
                              </td>
                              <td>
                                {item ? (
                                  <StatusPill status={item.status} />
                                ) : running ? (
                                  <StatusPill status="RUNNING" />
                                ) : regressionRun.status === "RUNNING" ? (
                                  <StatusPill status="QUEUED" />
                                ) : (
                                  <span className="pill">Not run</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    <div className="regression-foot">
                      <span>
                        {regressionRun.items.length} of{" "}
                        {(regressionRun.testDefinitionIds ?? []).length} done ·{" "}
                        {regressionRun.status === "RUNNING"
                          ? "running"
                          : regressionRun.status.toLowerCase()}
                      </span>
                      {regressionRun.status === "RUNNING" && (
                        <button
                          type="button"
                          className="icon-button danger"
                          onClick={() => void window.bcFlow.stopRun()}
                          aria-label="Stop regression"
                        >
                          <Square size={16} />
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </>
            )}
          {iteration.retestRunIds.map((id) => {
            const retest = snapshot.runs.find((item) => item.id === id);
            return retest ? (
              <div className="notice-line" key={id}>
                <StatusPill status={retest.status} />
                <button type="button" className="cell-link" onClick={() => onOpenRun(retest)}>
                  Retest of {formatDate(retest.startedAt)}
                </button>
              </div>
            ) : null;
          })}
        </DetailSection>
      )}

      {investigation.iterations.length > 1 && (
        <DetailSection title="Rounds" description="Each failed retest starts a new round.">
          <table className="plain-table">
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">Decision</th>
                <th scope="col">Change</th>
                <th scope="col">Retest</th>
              </tr>
            </thead>
            <tbody>
              {[...investigation.iterations].reverse().map((item) => (
                <tr key={item.number}>
                  <td className="primary-cell">{item.number}</td>
                  <td>{item.decision ?? "—"}</td>
                  <td className="mono-cell">{item.change?.commit ?? item.change?.branch ?? "—"}</td>
                  <td>{item.result ? item.result.toLowerCase() : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </DetailSection>
      )}
    </RunPage>
  );
}
