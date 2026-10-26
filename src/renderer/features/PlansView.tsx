import {
  Activity,
  Archive,
  ArchiveRestore,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Download,
  ExternalLink,
  Pencil,
  Play,
  Plus,
  Search,
  Trash2,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import type {
  AppSnapshot,
  TestDefinition,
  TestPlan,
  TestPlanInput,
  TestPlanRun,
  TestRun,
} from "../../shared/models";
import {
  type PlanParameterValues,
  defaultPlanParameters,
  unattendedBlocker,
} from "../../shared/plan-run";
import { scheduleLabel } from "../../shared/schedule";
import { EditPage } from "../components/EditPage";
import { EmptyState, Field } from "../components/Field";
import { PageActions } from "../components/PageActions";
import { RowMenu, type RowMenuItem } from "../components/RowMenu";
import { DetailSection, RunPage } from "../components/RunPage";
import { Select } from "../components/Select";
import { StatusPill } from "../components/StatusPill";
import { Tile } from "../components/Tile";
import { ViewSwitch, useViewMode } from "../components/ViewSwitch";
import { formatDate, formatDuration, messageOf } from "../lib/format";

export function TestPlansView({
  snapshot,
  contextCustomerId,
  contextEnvironmentId,
  execution,
  activeRun,
  onAdd,
  onEdit,
  onArchive,
  onRun,
  onResume,
  onDelete,
  onOpenRun,
}: {
  snapshot: AppSnapshot;
  contextCustomerId: string;
  contextEnvironmentId: string;
  execution?: PlanExecution;
  activeRun: boolean;
  onAdd(): void;
  onEdit(plan: TestPlan): void;
  onArchive(plan: TestPlan): void;
  onRun(plan: TestPlan): void;
  onResume(request: PlanRunRequest): void;
  onDelete(plan: TestPlan): void;
  onOpenRun(run: TestRun): void;
}) {
  const [showArchived, setShowArchived] = useState(false);
  const [query, setQuery] = useState("");
  const [viewMode, setViewMode] = useViewMode("plans");
  const [historyPlanId, setHistoryPlanId] = useState<string>();
  const plans = snapshot.testPlans.filter(
    (plan) =>
      Boolean(plan.archivedAt) === showArchived &&
      (contextCustomerId === "all" || plan.customerId === contextCustomerId) &&
      (contextEnvironmentId === "all" || plan.environmentId === contextEnvironmentId) &&
      plan.name.toLowerCase().includes(query.toLowerCase()),
  );
  const historyPlan = snapshot.testPlans.find((plan) => plan.id === historyPlanId);
  if (historyPlan) {
    return (
      <TestPlanHistorySheet
        plan={historyPlan}
        snapshot={snapshot}
        activeRun={activeRun}
        onClose={() => setHistoryPlanId(undefined)}
        onOpenRun={onOpenRun}
        onResume={onResume}
      />
    );
  }
  const describe = (plan: TestPlan) => {
    const customer = snapshot.customers.find((item) => item.id === plan.customerId);
    const environment = snapshot.environments.find((item) => item.id === plan.environmentId);
    const history = snapshot.testPlanRuns.filter((run) => run.testPlanId === plan.id);
    const latest = history[0];
    return {
      target: `${customer?.name ?? "Unknown customer"} · ${environment?.name ?? "No target"}`,
      sequence: plan.testDefinitionIds
        .map((id) => snapshot.tests.find((test) => test.id === id)?.testId)
        .filter(Boolean)
        .join(" → "),
      history,
      schedule: plan.schedule ? scheduleLabel(plan.schedule) : undefined,
      status: latest ? (
        <StatusPill status={latest.status} />
      ) : (
        <span className="pill-neutral">Never run</span>
      ),
      running: execution?.planId === plan.id ? execution : undefined,
    };
  };
  const menuItems = (plan: TestPlan, hasHistory: boolean): RowMenuItem[] => [
    ...(hasHistory
      ? [{ label: "Execution history", icon: Activity, onSelect: () => setHistoryPlanId(plan.id) }]
      : []),
    { label: "Edit", icon: Pencil, onSelect: () => onEdit(plan) },
    {
      label: plan.archivedAt ? "Restore" : "Archive",
      icon: plan.archivedAt ? ArchiveRestore : Archive,
      onSelect: () => onArchive(plan),
    },
    { label: "Delete", icon: Trash2, danger: true, onSelect: () => onDelete(plan) },
  ];
  const runButton = (plan: TestPlan, running: PlanExecution | undefined) =>
    !plan.archivedAt && (
      <button
        type="button"
        className="icon-button"
        onClick={() => onRun(plan)}
        disabled={activeRun || running?.status === "running"}
        aria-label="Run plan"
      >
        <Play size={14} />
      </button>
    );
  return (
    <>
      <PageActions>
        <button type="button" className="button button-primary" onClick={onAdd}>
          <Plus size={16} /> New test plan
        </button>
      </PageActions>
      <div className="filter-bar">
        <div className="search-box">
          <Search size={17} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search plans…"
          />
        </div>
        <button
          type="button"
          className="icon-button icon-toggle"
          aria-pressed={showArchived}
          onClick={() => setShowArchived((current) => !current)}
          aria-label={showArchived ? "Active plans" : "Archived plans"}
        >
          <ArchiveRestore size={16} />
        </button>
        <span className="filter-spacer" />
        <ViewSwitch mode={viewMode} onChange={setViewMode} />
      </div>
      {plans.length ? (
        viewMode === "list" ? (
          <table className="plain-table">
            <thead>
              <tr>
                <th scope="col">Plan</th>
                <th scope="col">Target</th>
                <th scope="col">Sequence</th>
                <th scope="col">Last run</th>
                <th scope="col">
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {plans.map((plan) => {
                const info = describe(plan);
                return (
                  <tr key={plan.id}>
                    <td className="primary-cell">
                      <span className="cell-with-chip">
                        <span className="logo-chip logo-chip-small" aria-hidden="true">
                          <ClipboardList size={15} />
                        </span>
                        <span>
                          {plan.name}
                          {info.schedule && <small className="cell-sub">{info.schedule}</small>}
                        </span>
                      </span>
                    </td>
                    <td>{info.target}</td>
                    <td className="mono-cell">{info.sequence}</td>
                    <td>{info.status}</td>
                    <td className="numeric">
                      <span className="row-actions-inline">
                        {runButton(plan, info.running)}
                        <RowMenu
                          label={`Actions for ${plan.name}`}
                          items={menuItems(plan, info.history.length > 0)}
                        />
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <div className="tile-grid">
            {plans.map((plan) => {
              const info = describe(plan);
              return (
                <Tile
                  key={plan.id}
                  logo={<ClipboardList size={22} />}
                  title={plan.name}
                  line1={info.target}
                  line2={info.schedule ? `${info.sequence} · ${info.schedule}` : info.sequence}
                  status={info.status}
                  actions={
                    <>
                      {runButton(plan, info.running)}
                      <RowMenu
                        label={`Actions for ${plan.name}`}
                        items={menuItems(plan, info.history.length > 0)}
                      />
                    </>
                  }
                />
              );
            })}
          </div>
        )
      ) : (
        <EmptyState
          icon={ClipboardList}
          title="No test plans yet"
          text="Create a reusable ordered flow for a customer environment."
          action="New test plan"
          onAction={onAdd}
        />
      )}
    </>
  );
}

/** What is left to run after a failed execution, from the failed test onwards. */
export function resumeRequest(
  snapshot: AppSnapshot,
  plan: TestPlan,
  planRun: TestPlanRun,
): PlanRunRequest | undefined {
  if (planRun.status === "PASSED" || planRun.status === "RUNNING") return undefined;
  const list = planRun.testDefinitionIds ?? plan.testDefinitionIds;
  const remaining = list.slice(Math.max(0, planRun.items.length - 1));
  if (!remaining.length) return undefined;
  const initialParameters: PlanParameterValues = {};
  for (const id of remaining) {
    const test = snapshot.tests.find((item) => item.id === id);
    const item = planRun.items.find((candidate) => candidate.testDefinitionId === id);
    const earlier = item && snapshot.runs.find((run) => run.id === item.runId);
    if (!test || !earlier) continue;
    initialParameters[id] = Object.fromEntries(
      test.parameters
        .filter((parameter) => !parameter.secret && parameter.name in earlier.parameters)
        .map((parameter) => [parameter.name, earlier.parameters[parameter.name]]),
    );
  }
  const first = snapshot.tests.find((test) => test.id === remaining[0]);
  return {
    plan,
    testDefinitionIds: remaining,
    resumedFromId: planRun.id,
    initialParameters,
    title: `Resume ${plan.name}${first ? ` from ${first.testId}` : ""}`,
  };
}

export function TestPlanHistorySheet({
  plan,
  snapshot,
  activeRun,
  onClose,
  onOpenRun,
  onResume,
}: {
  plan: TestPlan;
  snapshot: AppSnapshot;
  activeRun: boolean;
  onClose(): void;
  onOpenRun(run: TestRun): void;
  onResume(request: PlanRunRequest): void;
}) {
  const [expandedRunId, setExpandedRunId] = useState<string>();
  const history = snapshot.testPlanRuns.filter((run) => run.testPlanId === plan.id);
  const customer = snapshot.customers.find((item) => item.id === plan.customerId);
  return (
    <RunPage
      inline
      title={plan.name}
      subtitle={`${customer?.name ?? "Customer"} · ${history.length} execution${history.length === 1 ? "" : "s"}`}
      onBack={onClose}
    >
      <div className="sheet-history-list">
        {history.map((planRun, index) => (
          <details className="sheet-history-run" key={planRun.id} open={index === 0}>
            <summary>
              <span>
                <strong>{formatDate(planRun.startedAt)}</strong>
                <small>
                  {planRun.items.length}/
                  {(planRun.testDefinitionIds ?? plan.testDefinitionIds).length} tests
                  {planRun.scheduled && " · scheduled"}
                  {planRun.resumedFromId &&
                    (() => {
                      const earlier = history.find((item) => item.id === planRun.resumedFromId);
                      return earlier
                        ? ` · resumed from ${formatDate(earlier.startedAt)}`
                        : " · resumed";
                    })()}
                </small>
              </span>
              <span className="plan-history-duration">
                {planRun.finishedAt
                  ? formatDuration(
                      new Date(planRun.finishedAt).getTime() -
                        new Date(planRun.startedAt).getTime(),
                    )
                  : "In progress"}
              </span>
              <StatusPill status={planRun.status} />
            </summary>
            <div className="sheet-history-actions">
              {index === 0 &&
                !history.some((item) => item.resumedFromId === planRun.id) &&
                (() => {
                  const request = resumeRequest(snapshot, plan, planRun);
                  return request ? (
                    <button
                      type="button"
                      className="button button-primary"
                      disabled={activeRun}
                      onClick={() => onResume(request)}
                    >
                      <Play size={16} /> Resume from{" "}
                      {snapshot.tests.find((test) => test.id === request.testDefinitionIds?.[0])
                        ?.testId ?? "failed test"}
                    </button>
                  ) : null;
                })()}
              <button
                type="button"
                className="icon-button"
                onClick={() => void window.bcFlow.exportTestPlanRun(planRun.id, "markdown")}
                aria-label="Export Markdown"
              >
                <Download size={14} />
              </button>
              <button
                type="button"
                className="icon-button"
                onClick={() => void window.bcFlow.exportTestPlanRun(planRun.id, "json")}
                aria-label="Export JSON"
              >
                <Download size={14} />
              </button>
            </div>
            {planRun.items.length ? (
              <ol>
                {planRun.items.map((item) => {
                  const run = snapshot.runs.find((candidate) => candidate.id === item.runId);
                  return (
                    <li className="sheet-history-test" key={item.runId}>
                      <span className="plan-history-sequence">{item.sequence}</span>
                      <span>
                        <strong>{item.testId}</strong>
                        <small>{item.testName}</small>
                      </span>
                      <StatusPill status={item.status} />
                      {run && (
                        <button
                          type="button"
                          className="icon-button"
                          onClick={() =>
                            setExpandedRunId((current) => (current === run.id ? undefined : run.id))
                          }
                          aria-expanded={expandedRunId === run.id}
                          aria-label={`Show steps for ${item.testId}`}
                          title="Show test steps"
                        >
                          <ChevronRight size={15} />
                        </button>
                      )}
                      {run && expandedRunId === run.id && (
                        <div className="sheet-run-details">
                          {run.error && <div className="banner-warning">{run.error}</div>}
                          {run.steps.length ? (
                            <ol>
                              {run.steps.map((step) => (
                                <li key={step.sequence}>
                                  <span className="plan-history-sequence">{step.sequence}</span>
                                  <span>
                                    <strong>{step.description}</strong>
                                    <small>{formatDuration(step.durationMs)}</small>
                                  </span>
                                  <StatusPill status={step.status} />
                                  {step.screenshotPath && (
                                    <button
                                      type="button"
                                      className="icon-button"
                                      onClick={() => {
                                        if (step.screenshotPath) {
                                          void window.bcFlow.openArtifact(step.screenshotPath);
                                        }
                                      }}
                                      aria-label={`Open evidence for step ${step.sequence}`}
                                      title="Open screenshot"
                                    >
                                      <ExternalLink size={14} />
                                    </button>
                                  )}
                                </li>
                              ))}
                            </ol>
                          ) : (
                            <div className="plan-history-empty">No step details recorded.</div>
                          )}
                          <div className="sheet-run-detail-actions">
                            <button
                              type="button"
                              className="icon-button"
                              onClick={() => onOpenRun(run)}
                              aria-label="Open full run details"
                            >
                              <ExternalLink size={14} />
                            </button>
                          </div>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ol>
            ) : (
              <div className="plan-history-empty">No tests completed.</div>
            )}
          </details>
        ))}
      </div>
    </RunPage>
  );
}

const SCHEDULE_CHOICES: Array<{ label: string; days: "off" | "every-day" | "weekdays" }> = [
  { label: "Off", days: "off" },
  { label: "Every day", days: "every-day" },
  { label: "Weekdays", days: "weekdays" },
];

export function TestPlanModal({
  snapshot,
  plan,
  initialTestIds,
  initialCustomerId: requestedCustomerId,
  initialEnvironmentId,
  onClose,
  onSaved,
}: {
  snapshot: AppSnapshot;
  plan?: TestPlan;
  initialTestIds: string[];
  initialCustomerId?: string;
  initialEnvironmentId?: string;
  onClose(): void;
  onSaved(snapshot: AppSnapshot): void;
}) {
  const selectedInitialTest = snapshot.tests.find((test) => initialTestIds.includes(test.id));
  const initialCustomerId =
    plan?.customerId ??
    snapshot.environments.find((item) => item.id === initialEnvironmentId)?.customerId ??
    requestedCustomerId ??
    selectedInitialTest?.customerId ??
    snapshot.customers[0]?.id ??
    "";
  const initialEnvironments = snapshot.environments.filter(
    (item) => item.customerId === initialCustomerId,
  );
  const [form, setForm] = useState<TestPlanInput>({
    id: plan?.id,
    name: plan?.name ?? "",
    customerId: initialCustomerId,
    environmentId: plan?.environmentId ?? initialEnvironmentId ?? initialEnvironments[0]?.id ?? "",
    testDefinitionIds: plan?.testDefinitionIds ?? initialTestIds,
    parameterProfileIds: plan?.parameterProfileIds ?? {},
    schedule: plan?.schedule,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const environments = snapshot.environments.filter((item) => item.customerId === form.customerId);
  const environment = environments.find((item) => item.id === form.environmentId);
  const unattended = form.schedule
    ? unattendedBlocker(snapshot, {
        ...form,
        id: plan?.id ?? "new",
        schedule: form.schedule,
      } as TestPlan)
    : undefined;
  const tests = snapshot.tests.filter(
    (test) =>
      !test.archivedAt &&
      (!test.customerId || test.customerId === form.customerId) &&
      Boolean(environment && test.allowedEnvironmentTypes.includes(environment.type)),
  );
  const toggleTest = (id: string) =>
    setForm((current) => ({
      ...current,
      testDefinitionIds: current.testDefinitionIds.includes(id)
        ? current.testDefinitionIds.filter((item) => item !== id)
        : [...current.testDefinitionIds, id],
      parameterProfileIds: current.testDefinitionIds.includes(id)
        ? Object.fromEntries(
            Object.entries(current.parameterProfileIds ?? {}).filter(([testId]) => testId !== id),
          )
        : current.parameterProfileIds,
    }));
  const moveTest = (index: number, offset: -1 | 1) =>
    setForm((current) => {
      const next = [...current.testDefinitionIds];
      const target = index + offset;
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target], next[index]];
      return { ...current, testDefinitionIds: next };
    });
  return (
    <EditPage
      title={plan ? "Edit test plan" : "New test plan"}
      eyebrow="Sequential execution"
      onClose={onClose}
      busy={busy}
      action={plan ? "Save changes" : "Save test plan"}
      error={error}
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setError(undefined);
        try {
          onSaved(await window.bcFlow.saveTestPlan(form));
        } catch (cause) {
          setError(messageOf(cause));
        } finally {
          setBusy(false);
        }
      }}
    >
      <DetailSection title="Plan" description="Name and the environment it runs against.">
        <Field label="Plan name">
          <input
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
            placeholder="Contoso sandbox regression"
            required
          />
        </Field>
        <div className="form-grid">
          <Field label="Customer">
            <Select
              value={form.customerId}
              onChange={(event) => {
                const customerId = event.target.value;
                const environmentId =
                  snapshot.environments.find((item) => item.customerId === customerId)?.id ?? "";
                setForm({
                  ...form,
                  customerId,
                  environmentId,
                  testDefinitionIds: [],
                  parameterProfileIds: {},
                });
              }}
              required
            >
              {snapshot.customers.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Environment">
          <Select
            value={form.environmentId ?? ""}
            onChange={(event) =>
              setForm({
                ...form,
                environmentId: event.target.value,
                testDefinitionIds: [],
                parameterProfileIds: {},
              })
            }
            required
          >
            {environments.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} · {item.company}
              </option>
            ))}
          </Select>
        </Field>
      </DetailSection>
      <DetailSection
        title="Schedule"
        description="Run this plan by itself while Test Suite is open, and get a notification with the result."
      >
        <fieldset className="choice-chips" aria-label="Schedule">
          {SCHEDULE_CHOICES.map((choice) => (
            <button
              type="button"
              key={choice.label}
              aria-pressed={(form.schedule?.days ?? "off") === choice.days}
              onClick={() =>
                setForm({
                  ...form,
                  schedule:
                    choice.days === "off"
                      ? undefined
                      : { days: choice.days, time: form.schedule?.time ?? "02:00" },
                })
              }
            >
              {choice.label}
            </button>
          ))}
        </fieldset>
        {form.schedule && (
          <>
            <Field label="Time" hint="Your local time.">
              <input
                type="time"
                required
                value={form.schedule.time}
                onChange={(event) =>
                  form.schedule &&
                  setForm({ ...form, schedule: { ...form.schedule, time: event.target.value } })
                }
              />
            </Field>
            {unattended ? (
              <div className="notice-box warn">
                <span>
                  <strong>This plan will ask you when it is due.</strong> {unattended}
                </span>
              </div>
            ) : (
              <div className="notice-box">
                <span>
                  <strong>This plan runs on its own.</strong> It only reads, and every value it
                  needs is known.
                </span>
              </div>
            )}
            <small className="field-hint">
              Only runs while Test Suite is open. If it is closed at that time, you are asked when
              you open it again.
            </small>
          </>
        )}
      </DetailSection>
      <DetailSection
        title="Tests"
        description="Choose the tests and their order. The plan stops at the first failure."
      >
        <div className="plan-test-picker">
          <strong>Tests in execution order</strong>
          {tests.map((test) => {
            const selectedIndex = form.testDefinitionIds.indexOf(test.id);
            return (
              <div
                className={`plan-test-row ${selectedIndex >= 0 ? "selected" : ""}`}
                key={test.id}
              >
                <input
                  type="checkbox"
                  aria-label={`Include ${test.testId} in the plan`}
                  checked={selectedIndex >= 0}
                  onChange={() => toggleTest(test.id)}
                />
                <span>
                  <strong>{test.testId}</strong>
                  <small>{test.name}</small>
                </span>
                {selectedIndex >= 0 && <span className="plan-order">{selectedIndex + 1}</span>}
                {selectedIndex >= 0 && test.parameters.length > 0 && (
                  <Select
                    className="plan-profile-select"
                    aria-label={`Parameter profile for ${test.testId}`}
                    value={form.parameterProfileIds?.[test.id] ?? ""}
                    onChange={(event) => {
                      const profileId = event.target.value;
                      setForm((current) => ({
                        ...current,
                        parameterProfileIds: profileId
                          ? { ...(current.parameterProfileIds ?? {}), [test.id]: profileId }
                          : Object.fromEntries(
                              Object.entries(current.parameterProfileIds ?? {}).filter(
                                ([testId]) => testId !== test.id,
                              ),
                            ),
                      }));
                    }}
                  >
                    <option value="">Defaults / ask before run</option>
                    {snapshot.parameterProfiles
                      .filter(
                        (profile) =>
                          profile.testDefinitionId === test.id &&
                          (!profile.environmentId || profile.environmentId === form.environmentId),
                      )
                      .map((profile) => (
                        <option key={profile.id} value={profile.id}>
                          {profile.name}
                        </option>
                      ))}
                  </Select>
                )}
                {selectedIndex >= 0 && (
                  <span className="row-actions">
                    <button
                      type="button"
                      className="inline-icon-button"
                      onClick={(event) => {
                        event.preventDefault();
                        moveTest(selectedIndex, -1);
                      }}
                      disabled={selectedIndex === 0}
                      aria-label={`Move ${test.testId} up`}
                    >
                      <ArrowUp size={13} />
                    </button>
                    <button
                      type="button"
                      className="inline-icon-button"
                      onClick={(event) => {
                        event.preventDefault();
                        moveTest(selectedIndex, 1);
                      }}
                      disabled={selectedIndex === form.testDefinitionIds.length - 1}
                      aria-label={`Move ${test.testId} down`}
                    >
                      <ArrowDown size={13} />
                    </button>
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </DetailSection>
    </EditPage>
  );
}

export function RunPlanConfirmationModal({
  snapshot,
  plan,
  testDefinitionIds = plan.testDefinitionIds,
  initialParameters,
  title,
  onClose,
  onRun,
}: {
  snapshot: AppSnapshot;
  plan: TestPlan;
  testDefinitionIds?: string[];
  initialParameters?: PlanParameterValues;
  title?: string;
  onClose(): void;
  onRun(parametersByTestId: PlanParameterValues): void;
}) {
  const tests = testsOf(snapshot, testDefinitionIds);
  const needsConfirmation = tests.some((test) => test.risk !== "read-only");
  const environment = snapshot.environments.find((item) => item.id === plan.environmentId);
  const missingTests = testDefinitionIds.length - tests.length;
  const [parametersByTestId, setParametersByTestId] = useState<PlanParameterValues>(() => {
    const defaults = defaultPlanParameters(snapshot, plan, testDefinitionIds);
    for (const [testId, values] of Object.entries(initialParameters ?? {})) {
      defaults[testId] = { ...defaults[testId], ...values };
    }
    return defaults;
  });
  const missingRequiredParameters = tests.flatMap((test) =>
    test.parameters.filter((parameter) => {
      const value = parametersByTestId[test.id]?.[parameter.name];
      return parameter.required && (value === undefined || value === "");
    }),
  ).length;
  const preflightChecks = [
    { label: "All tests available", ok: missingTests === 0 },
    { label: "Execution target available", ok: Boolean(environment) },
    { label: "Production blocked", ok: environment?.type !== "production" },
    {
      label: "Credential available",
      ok: Boolean(
        !environment || environment.authentication === "Windows" || environment.hasCredential,
      ),
    },
    { label: "Required parameters complete", ok: missingRequiredParameters === 0 },
  ];
  const ready = preflightChecks.every((check) => check.ok);
  const [confirmed, setConfirmed] = useState(!needsConfirmation);
  return (
    <EditPage
      title={title ?? `Run ${plan.name}`}
      eyebrow="Sequential test plan"
      onClose={onClose}
      busy={false}
      action="Run plan"
      icon={<Play size={15} />}
      disabled={!confirmed || !ready}
      onSubmit={(event) => {
        event.preventDefault();
        onRun(parametersByTestId);
      }}
    >
      <DetailSection
        title="Tests"
        description="Run in this order. Execution stops immediately when a test does not pass."
      >
        <ol className="plan-run-list">
          {tests.map((test) => (
            <li key={test.id}>
              <span>{test.testId}</span>
              <small>{test.name}</small>
            </li>
          ))}
        </ol>
      </DetailSection>
      <DetailSection
        title="Preflight"
        description="Everything below must pass before the plan can start."
      >
        <div className="plan-preflight" aria-label="Test plan preflight">
          {preflightChecks.map((check) => (
            <div key={check.label} className={check.ok ? "preflight-passed" : "preflight-failed"}>
              {check.ok ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
              <span>{check.label}</span>
            </div>
          ))}
        </div>
      </DetailSection>
      <DetailSection
        title="Parameters"
        description="Review saved profiles and complete missing values before execution."
      >
        {tests.some((test) => test.parameters.length > 0) && (
          <div className="plan-parameter-sections">
            <div className="run-section-heading">
              <div>
                <strong>Plan parameters</strong>
                <small>Review saved profiles and complete missing values before execution.</small>
              </div>
            </div>
            {tests
              .filter((test) => test.parameters.length > 0)
              .map((test) => (
                <section className="plan-parameter-section" key={test.id}>
                  <div>
                    <strong>{test.testId}</strong>
                    <small>{test.name}</small>
                  </div>
                  <div className="form-grid">
                    {test.parameters.map((parameter) => {
                      const value = parametersByTestId[test.id]?.[parameter.name] ?? "";
                      return (
                        <Field
                          key={parameter.name}
                          label={parameter.name}
                          hint={
                            parameter.secret
                              ? "Secret; never saved in the plan."
                              : parameter.description
                          }
                        >
                          {parameter.type === "boolean" ? (
                            <Select
                              value={value === "" ? "" : String(value)}
                              required={parameter.required}
                              onChange={(event) =>
                                setParametersByTestId((current) => ({
                                  ...current,
                                  [test.id]: {
                                    ...current[test.id],
                                    [parameter.name]:
                                      event.target.value === ""
                                        ? ""
                                        : event.target.value === "true",
                                  },
                                }))
                              }
                            >
                              <option value="">Select…</option>
                              <option value="true">Yes</option>
                              <option value="false">No</option>
                            </Select>
                          ) : (
                            <input
                              type={
                                parameter.secret
                                  ? "password"
                                  : parameter.type === "number"
                                    ? "number"
                                    : "text"
                              }
                              value={String(value)}
                              required={parameter.required}
                              onChange={(event) => {
                                const nextValue =
                                  parameter.type === "number" && event.target.value !== ""
                                    ? Number(event.target.value)
                                    : event.target.value;
                                setParametersByTestId((current) => ({
                                  ...current,
                                  [test.id]: {
                                    ...current[test.id],
                                    [parameter.name]: nextValue,
                                  },
                                }));
                              }}
                            />
                          )}
                        </Field>
                      );
                    })}
                  </div>
                </section>
              ))}
          </div>
        )}
      </DetailSection>
      <DetailSection
        title="Confirmation"
        description="Write-capable plans need your explicit go-ahead."
      >
        {needsConfirmation && (
          <label className="risk-confirm">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            <span>
              <strong>Confirm write-capable tests</strong>
              <small>This plan may modify data in the selected environment.</small>
            </span>
          </label>
        )}
      </DetailSection>
    </EditPage>
  );
}

export type PlanExecution = {
  planId: string;
  total: number;
  completed: number;
  status: "running" | "passed" | "failed";
  currentTestId?: string;
};

export type { PlanParameterValues };

/** A request to run a plan, or part of one, after the user has reviewed it. */
export type PlanRunRequest = {
  plan: TestPlan;
  /** A subset of the plan's tests, in the plan's order. All of them when absent. */
  testDefinitionIds?: string[];
  resumedFromId?: string;
  initialParameters?: PlanParameterValues;
  title?: string;
  /** The scheduled moment this run answers, when it comes from a reminder or the schedule. */
  scheduledFor?: string;
};

const testsOf = (snapshot: AppSnapshot, ids: string[]) =>
  ids
    .map((id) => snapshot.tests.find((test) => test.id === id))
    .filter((test): test is TestDefinition => Boolean(test));
