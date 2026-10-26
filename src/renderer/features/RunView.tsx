import {
  Activity,
  CircleStop,
  Download,
  ExternalLink,
  FolderOpen,
  LoaderCircle,
  MonitorPlay,
  Play,
  SearchCheck,
  XCircle,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { AppSnapshot, StepResult, TestDefinition, TestRun } from "../../shared/models";
import { EditPage } from "../components/EditPage";
import { Field, InlineError } from "../components/Field";
import { DetailSection, RunPage } from "../components/RunPage";
import { Select } from "../components/Select";
import { StatusPill } from "../components/StatusPill";
import { formatDate, formatDuration, messageOf } from "../lib/format";
import type { PlanExecution } from "./PlansView";
import { RunProgressList, latestRunProgress } from "./RunProgress";
import { legacyParameterProfileKey, readLegacyParameterProfiles } from "./parameter-profiles";

export function RunModal({
  test,
  snapshot,
  preferredEnvironmentId,
  activeRun,
  initialRun,
  onClose,
  onStarted,
  onError,
  onInvestigate,
}: {
  test: TestDefinition;
  snapshot: AppSnapshot;
  preferredEnvironmentId: string;
  activeRun?: TestRun;
  initialRun?: TestRun;
  onClose(): void;
  onStarted(run: TestRun): void;
  onError(error: string): void;
  onInvestigate(run: TestRun): void;
}) {
  const environments = snapshot.environments.filter(
    (environment) =>
      (!test.customerId || environment.customerId === test.customerId) &&
      test.allowedEnvironmentTypes.includes(environment.type),
  );
  const [environmentId, setEnvironmentId] = useState(
    environments.some((item) => item.id === initialRun?.environmentId)
      ? (initialRun?.environmentId ?? "")
      : environments.some((item) => item.id === preferredEnvironmentId)
        ? preferredEnvironmentId
        : (environments[0]?.id ?? ""),
  );
  const [parameters, setParameters] = useState<Record<string, string | number | boolean>>(() =>
    Object.fromEntries(
      test.parameters.map((parameter) => [
        parameter.name,
        parameter.secret
          ? ""
          : (initialRun?.parameters[parameter.name] ?? parameter.defaultValue ?? ""),
      ]),
    ),
  );
  const [allProfiles, setProfiles] = useState<
    Array<{
      name: string;
      environmentId?: string;
      values: Record<string, string | number | boolean>;
    }>
  >(() => snapshot.parameterProfiles.filter((profile) => profile.testDefinitionId === test.id));
  // A profile belongs to one environment; older ones without an environment fit everywhere.
  const profiles = allProfiles.filter(
    (profile) => !profile.environmentId || profile.environmentId === environmentId,
  );
  const [profileName, setProfileName] = useState("");
  const [confirmRisk, setConfirmRisk] = useState(test.risk === "read-only");
  const [manualMfa, setManualMfa] = useState(true);
  const [rememberSession, setRememberSession] = useState(true);
  const [starting, setStarting] = useState(false);
  const [showOfficialReport, setShowOfficialReport] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const currentEnvironment = environments.find((environment) => environment.id === environmentId);
  const completed = activeRun && activeRun.status !== "RUNNING";
  const elapsedMs = useElapsedMs(activeRun?.startedAt, activeRun?.status === "RUNNING");
  const runEvents = activeRun?.progress ?? [];
  const failedScreenshotSteps =
    activeRun?.steps.filter(
      (step): step is StepResult & { screenshotPath: string } =>
        step.status !== "PASSED" && Boolean(step.screenshotPath),
    ) ?? [];
  useEffect(() => {
    if (activeRun?.status === "RUNNING") setActivityOpen(true);
  }, [activeRun?.status]);
  useEffect(() => {
    const secretNames = new Set(
      test.parameters.filter((parameter) => parameter.secret).map((parameter) => parameter.name),
    );
    const legacyProfiles = readLegacyParameterProfiles(test.id).map((profile) => ({
      ...profile,
      values: Object.fromEntries(
        Object.entries(profile.values).filter(([name]) => !secretNames.has(name)),
      ),
    }));
    if (!legacyProfiles.length) return;
    let active = true;
    void Promise.all(legacyProfiles.map((profile) => window.bcFlow.saveParameterProfile(profile)))
      .then((results) => {
        if (!active) return;
        const migrated = results
          .at(-1)
          ?.parameterProfiles.filter((profile) => profile.testDefinitionId === test.id);
        if (migrated) setProfiles(migrated);
        localStorage.removeItem(legacyParameterProfileKey(test.id));
      })
      .catch((cause) => active && onError(messageOf(cause)));
    return () => {
      active = false;
    };
  }, [onError, test.id, test.parameters]);
  if (activeRun) {
    const running = activeRun.status === "RUNNING";
    return (
      <RunPage
        title={test.name}
        subtitle={`${test.testId} · ${activeRun.environmentName} · ${formatDate(activeRun.startedAt)}`}
        status={<StatusPill status={activeRun.status} />}
        actions={
          running ? (
            <button
              type="button"
              className="icon-button danger"
              onClick={() => window.bcFlow.stopRun()}
              aria-label="Stop run"
            >
              <CircleStop size={16} />
            </button>
          ) : activeRun.status === "FAILED" || activeRun.status === "ERROR" ? (
            <button
              type="button"
              className="button button-primary"
              onClick={() => onInvestigate(activeRun)}
            >
              <SearchCheck size={16} />{" "}
              {snapshot.investigations.some((item) => item.runId === activeRun.id)
                ? "Open investigation"
                : "Create investigation"}
            </button>
          ) : undefined
        }
        onBack={onClose}
      >
        <DetailSection
          title="Result"
          description={running ? "Visible replay in progress." : "What happened in this run."}
        >
          <div className="stat-row">
            <span>
              <strong>{formatDuration(activeRun.durationMs ?? elapsedMs)}</strong>
              <small>Duration</small>
            </span>
            <span>
              <strong>
                {activeRun.steps.length
                  ? `${activeRun.steps.filter((step) => step.status === "PASSED").length} / ${activeRun.steps.length}`
                  : "—"}
              </strong>
              <small>Steps passed</small>
            </span>
            <span>
              <strong>{activeRun.initiatedBy === "ai-agent" ? "AI agent" : "User"}</strong>
              <small>Started by</small>
            </span>
          </div>
          {completed && activeRun.error && (
            <section className="banner-error run-primary-error" aria-label="Run error">
              <XCircle size={18} />
              <span>
                <strong>
                  {activeRun.status === "ERROR" ? "Technical execution error" : "Test failed"}
                </strong>
                <small>{activeRun.error}</small>
              </span>
            </section>
          )}
        </DetailSection>
        {completed && (
          <DetailSection title="Steps" description="Each recorded action with its result.">
            {activeRun.steps.length ? (
              <ol className="run-steps">
                {activeRun.steps.map((step) => (
                  <li key={step.sequence}>
                    <span className="step-number">{step.sequence}</span>
                    <div className="step-content">
                      <div className="step-title">
                        <strong>{step.description}</strong>
                        <span>
                          <StatusPill status={step.status} />
                          {formatDuration(step.durationMs)}
                        </span>
                      </div>
                      {step.status !== "PASSED" && step.screenshotPath && (
                        <small className="step-evidence-label">Failure screenshot available</small>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="section-empty">No replay steps were recorded.</p>
            )}
          </DetailSection>
        )}
        {completed && (
          <DetailSection title="Evidence" description="Stored on this device only.">
            {activeRun.videoPath && (
              <section className="run-evidence-section">
                <h3>Replay video</h3>
                <video controls preload="metadata" src={artifactUrl(activeRun.videoPath)}>
                  <track kind="captions" />
                </video>
              </section>
            )}
            {failedScreenshotSteps.length > 0 && (
              <section className="screenshot-gallery">
                <h3>Failure screenshots</h3>
                {failedScreenshotSteps.map((step) => (
                  <figure key={step.sequence}>
                    <ScreenshotPreview
                      path={step.screenshotPath}
                      alt={`Failure at step ${step.sequence}: ${step.description}`}
                    />
                    <figcaption>
                      Step {step.sequence} · {step.description}
                    </figcaption>
                  </figure>
                ))}
              </section>
            )}
            {activeRun.reportPath && (
              <section className="official-report-section">
                <div className="artifact-heading-row">
                  <h3>Playwright report</h3>
                  <button
                    type="button"
                    className="button button-secondary"
                    onClick={() => setShowOfficialReport((visible) => !visible)}
                  >
                    {showOfficialReport ? "Hide" : "Show"}
                  </button>
                </div>
                {showOfficialReport && (
                  <iframe
                    className="official-report-frame"
                    src={artifactUrl(activeRun.reportPath)}
                    title={`Playwright report for ${activeRun.testId}`}
                    sandbox="allow-scripts allow-same-origin"
                  />
                )}
              </section>
            )}
            <div className="button-row">
              <button
                type="button"
                className="icon-button"
                onClick={() => window.bcFlow.revealArtifact(activeRun.resultDirectory)}
                aria-label="Results folder"
              >
                <FolderOpen size={16} />
              </button>
              {activeRun.reportPath && (
                <button
                  type="button"
                  className="icon-button"
                  onClick={() =>
                    activeRun.reportPath && window.bcFlow.openArtifact(activeRun.reportPath)
                  }
                  aria-label="Open report"
                >
                  <ExternalLink size={16} />
                </button>
              )}
              <button
                type="button"
                className="icon-button"
                onClick={() =>
                  void window.bcFlow
                    .exportRun(activeRun.id, "markdown")
                    .catch((cause) => onError(messageOf(cause)))
                }
                aria-label="Export Markdown"
              >
                <Download size={16} />
              </button>
              <button
                type="button"
                className="icon-button"
                onClick={() =>
                  void window.bcFlow
                    .exportRun(activeRun.id, "json")
                    .catch((cause) => onError(messageOf(cause)))
                }
                aria-label="Export JSON"
              >
                <Download size={16} />
              </button>
            </div>
          </DetailSection>
        )}
        <DetailSection title="Activity" description="Runner updates with secrets masked.">
          <details
            className="run-activity"
            open={activityOpen}
            onToggle={(event) => setActivityOpen(event.currentTarget.open)}
          >
            <summary className="run-activity-summary">
              <span>
                <Activity size={15} /> Run activity
              </span>
              <span>{runEvents.length} updates</span>
            </summary>
            <RunProgressList events={runEvents} />
          </details>
        </DetailSection>
      </RunPage>
    );
  }

  return (
    <EditPage
      title={test.name}
      eyebrow={`${test.testId} · ${test.risk}`}
      onClose={onClose}
      busy={starting}
      action="Run visibly"
      icon={<Play size={16} />}
      disabled={!confirmRisk || !environmentId || !snapshot.diagnostics.powershellAvailable}
      onSubmit={async (event) => {
        event.preventDefault();
        setStarting(true);
        try {
          onStarted(
            await window.bcFlow.startRun({
              testDefinitionId: test.id,
              environmentId,
              parameters,
              confirmRisk,
              manualMfa: currentEnvironment?.authentication === "AAD" && manualMfa,
              rememberSession: currentEnvironment?.authentication === "AAD" && rememberSession,
            }),
          );
        } catch (cause) {
          onError(messageOf(cause));
        } finally {
          setStarting(false);
        }
      }}
    >
      <DetailSection
        title="Replay"
        description="A browser window opens and shows every recorded Business Central action."
      >
        <div className="run-intro">
          <div className="section-icon">
            <MonitorPlay size={22} />
          </div>
          <div>
            <strong>Visible headed replay</strong>
            <p>A browser window opens and shows every recorded Business Central action.</p>
          </div>
        </div>
        {test.forbiddenActions.length > 0 && (
          <section className="panel-warning" aria-label="Forbidden actions">
            <strong>This test must never perform:</strong> {test.forbiddenActions.join(", ")}.
          </section>
        )}
      </DetailSection>
      <DetailSection title="Target" description="The environment this run executes against.">
        <Field label="Target environment">
          <Select value={environmentId} onChange={(e) => setEnvironmentId(e.target.value)} required>
            <option value="">Select environment</option>
            {environments.map((environment) => (
              <option value={environment.id} key={environment.id}>
                {environment.name} · {environment.company}
              </option>
            ))}
          </Select>
        </Field>
        {currentEnvironment && (
          <div className="identity-strip">
            <span>
              <small>Customer</small>
              {
                snapshot.customers.find((customer) => customer.id === currentEnvironment.customerId)
                  ?.code
              }
            </span>
            <span>
              <small>Environment</small>
              {currentEnvironment.name}
            </span>
            <span>
              <small>Company</small>
              {currentEnvironment.company}
            </span>
            <span>
              <small>Auth</small>
              {currentEnvironment.authentication}
            </span>
          </div>
        )}
      </DetailSection>
      {currentEnvironment?.authentication === "AAD" && (
        <DetailSection title="Authentication" description="How the Microsoft sign-in is handled.">
          <label className="risk-confirm">
            <input
              type="checkbox"
              checked={manualMfa}
              onChange={(event) => setManualMfa(event.target.checked)}
            />
            <span>
              <strong>Wait for manual MFA</strong>
              <small>Approve the push notification or enter the code in the browser.</small>
            </span>
          </label>
          <label className="risk-confirm">
            <input
              type="checkbox"
              checked={rememberSession}
              onChange={(event) => setRememberSession(event.target.checked)}
            />
            <span>
              <strong>Remember Microsoft session</strong>
              <small>Store the authenticated session encrypted for this environment.</small>
            </span>
          </label>
        </DetailSection>
      )}
      {test.parameters.length > 0 && (
        <DetailSection
          title="Parameters"
          description="Values for this run. Secrets are never saved."
        >
          <div className="parameter-section">
            <div className="parameter-profile-bar">
              <Select
                aria-label="Parameter profile"
                value=""
                onChange={(event) => {
                  const profile =
                    profiles.find(
                      (item) => item.name === event.target.value && item.environmentId,
                    ) ?? profiles.find((item) => item.name === event.target.value);
                  if (profile) setParameters((current) => ({ ...current, ...profile.values }));
                }}
              >
                <option value="">Load profile…</option>
                {profiles.map((profile) => (
                  <option
                    key={`${profile.environmentId ?? "all"}:${profile.name}`}
                    value={profile.name}
                  >
                    {profile.name}
                  </option>
                ))}
              </Select>
              <input
                value={profileName}
                onChange={(event) => setProfileName(event.target.value)}
                placeholder="Profile name"
                aria-label="New parameter profile name"
              />
              <button
                type="button"
                className="button button-secondary button-compact"
                disabled={!profileName.trim()}
                onClick={() => {
                  const secretNames = new Set(
                    test.parameters
                      .filter((parameter) => parameter.secret)
                      .map((parameter) => parameter.name),
                  );
                  const values = Object.fromEntries(
                    Object.entries(parameters).filter(([name]) => !secretNames.has(name)),
                  );
                  void window.bcFlow
                    .saveParameterProfile({
                      testDefinitionId: test.id,
                      environmentId: environmentId || undefined,
                      name: profileName.trim(),
                      values,
                    })
                    .then((next) => {
                      setProfiles(
                        next.parameterProfiles.filter(
                          (profile) => profile.testDefinitionId === test.id,
                        ),
                      );
                      setProfileName("");
                    })
                    .catch((cause) => onError(messageOf(cause)));
                }}
              >
                Save profile
              </button>
            </div>
            <div className="form-grid">
              {test.parameters.map((parameter) => (
                <Field key={parameter.name} label={parameter.name} hint={parameter.description}>
                  <input
                    type={
                      parameter.secret
                        ? "password"
                        : parameter.type === "number"
                          ? "number"
                          : "text"
                    }
                    value={String(parameters[parameter.name] ?? "")}
                    onChange={(e) =>
                      setParameters((current) => ({
                        ...current,
                        [parameter.name]:
                          parameter.type === "number" ? Number(e.target.value) : e.target.value,
                      }))
                    }
                    required={parameter.required}
                  />
                </Field>
              ))}
            </div>
          </div>
        </DetailSection>
      )}
      <DetailSection title="Confirmation" description="Check before the browser starts.">
        {test.risk !== "read-only" && (
          <label className="risk-confirm">
            <input
              type="checkbox"
              checked={confirmRisk}
              onChange={(e) => setConfirmRisk(e.target.checked)}
            />
            <span>
              <strong>I understand this test can change Business Central data.</strong>
              <small>Review cleanup and test data before continuing.</small>
            </span>
          </label>
        )}
        {!snapshot.diagnostics.powershellAvailable && (
          <InlineError text="PowerShell 7 (pwsh or pwsh-preview) is not installed on this machine. The UI can be reviewed, but replay cannot start." />
        )}
      </DetailSection>
    </EditPage>
  );
}

export function LiveRunBar({
  run,
  execution,
  onView,
  onStop,
}: {
  run: TestRun;
  execution?: PlanExecution;
  onView(): void;
  onStop(): void;
}) {
  const elapsedMs = useElapsedMs(run.startedAt, true);
  const latestUpdate = latestRunProgress(run.progress);
  const currentPlan = execution?.status === "running" ? execution : undefined;

  return (
    <section className="live-run-bar" aria-label="Active test run" aria-live="polite">
      <span className="live-run-indicator">
        <LoaderCircle className="spin" size={17} /> Running
      </span>
      <span className="live-run-identity">
        <strong>{run.testId}</strong>
        <small>{run.environmentName}</small>
      </span>
      {currentPlan && (
        <span className="live-run-progress">
          Test {Math.min(currentPlan.completed + 1, currentPlan.total)} of {currentPlan.total}
        </span>
      )}
      <span className="live-run-update" title={latestUpdate?.detail}>
        {latestUpdate?.title ?? "Waiting for runner output…"}
      </span>
      <time>{formatDuration(elapsedMs)}</time>
      <button type="button" className="icon-button" onClick={onView} aria-label="View live run">
        <Activity size={16} />
      </button>
      <button type="button" className="icon-button danger" onClick={onStop} aria-label="Stop run">
        <CircleStop size={16} />
      </button>
    </section>
  );
}

export function ScreenshotPreview({ path, alt }: { path: string; alt: string }) {
  const [source, setSource] = useState<string>();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    setFailed(false);
    void window.bcFlow
      .readArtifact(path)
      .then((value) => {
        if (active) setSource(value);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [path]);

  if (failed) return <div className="step-no-screenshot">Screenshot unavailable</div>;
  if (!source) return <div className="step-screenshot-loading">Loading screenshot…</div>;
  return <img className="step-screenshot" src={source} alt={alt} />;
}

export function artifactUrl(path: string): string {
  return `bcft-artifact://local${encodeURI(path).replaceAll("#", "%23")}`;
}

export function useElapsedMs(startedAt?: string, running = false): number | undefined {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [running]);
  return startedAt ? Math.max(0, now - new Date(startedAt).getTime()) : undefined;
}
