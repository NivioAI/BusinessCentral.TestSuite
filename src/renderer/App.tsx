import { Building2, CircleHelp, LoaderCircle, Server, Settings, XCircle } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AppErrorCode } from "../shared/app-error";
import { NEEDS_USER_STATUSES } from "../shared/investigation-status";
import { isMenuAction, screenOfAction } from "../shared/menu-actions";
import type {
  AppSnapshot,
  Customer,
  Investigation,
  RunnerEvent,
  TestDefinition,
  TestGroup,
  TestPlan,
  TestRun,
} from "../shared/models";
import {
  type PlanParameterValues,
  canStartWithoutReview,
  defaultPlanParameters,
} from "../shared/plan-run";
import nivioLogo from "./assets/nivio-logo.png";
import { goToKeys } from "./commands";
import { CommandPalette } from "./components/CommandPalette";
import { InlineError } from "./components/Field";
import { Modal } from "./components/Modal";
import { PageActionsHost } from "./components/PageActions";
import { RunPageHost } from "./components/RunPage";
import { Select } from "./components/Select";
import { TooltipLayer } from "./components/TooltipLayer";
import { CustomerModal, CustomersView, TestGroupModal } from "./features/CustomersView";
import { Dashboard } from "./features/DashboardView";
import { EnvironmentModal, Environments } from "./features/EnvironmentsView";
import { HelpView } from "./features/HelpView";
import {
  CreateInvestigationModal,
  InvestigationPage,
  InvestigationsView,
} from "./features/InvestigationsView";
import { ImportModal, TestDefinitionModal, TestLibrary } from "./features/LibraryView";
import {
  type PlanExecution,
  type PlanRunRequest,
  RunPlanConfirmationModal,
  TestPlanModal,
  TestPlansView,
} from "./features/PlansView";
import { ProjectPage, ProjectsView } from "./features/ProjectsView";
import { RunHistory } from "./features/RunHistoryView";
import { LiveRunBar, RunModal } from "./features/RunView";
import { SettingsView } from "./features/SettingsView";
import { buildCommands } from "./lib/build-commands";
import { ERROR_ACTIONS, errorCodeFor, messageOf } from "./lib/format";
import { runSafely } from "./lib/ui";
import { useShortcuts } from "./lib/useShortcuts";
import { type View, navigation, navigationGroups, pageSubtitles } from "./navigation";

type DeleteConfirmation = {
  title: string;
  description: string;
  perform(): Promise<AppSnapshot>;
};

const customerContextStorageKey = "nivio.bc-flow-tester.customer-context";

const environmentContextStorageKey = "nivio.bc-flow-tester.environment-context";

export function App() {
  const [snapshot, setSnapshot] = useState<AppSnapshot>();
  const [view, setView] = useState<View>("dashboard");
  const [actionsHost, setActionsHost] = useState<HTMLElement | null>(null);
  const [runPageHost, setRunPageHost] = useState<HTMLElement | null>(null);
  const [error, setError] = useState<string>();
  const [projectPage, setProjectPage] = useState<{ projectId?: string; environmentId?: string }>();
  const [investigationId, setInvestigationId] = useState<string>();
  const [investigationRun, setInvestigationRun] = useState<TestRun>();
  const [environmentModal, setEnvironmentModal] = useState(false);
  const [environmentTarget, setEnvironmentTarget] = useState<AppSnapshot["environments"][number]>();
  const [importModal, setImportModal] = useState(false);
  const [customerModal, setCustomerModal] = useState(false);
  const [customerTarget, setCustomerTarget] = useState<Customer>();
  const [testGroupModal, setTestGroupModal] = useState(false);
  const [testGroupTarget, setTestGroupTarget] = useState<TestGroup>();
  const [testTarget, setTestTarget] = useState<TestDefinition>();
  const [testPlanTarget, setTestPlanTarget] = useState<TestPlan>();
  const [testPlanInitialTestIds, setTestPlanInitialTestIds] = useState<string[]>([]);
  const [testPlanInitialEnvironmentId, setTestPlanInitialEnvironmentId] = useState<string>();
  const [testPlanModal, setTestPlanModal] = useState(false);
  const [planRunTarget, setPlanRunTarget] = useState<PlanRunRequest>();
  const [planExecution, setPlanExecution] = useState<PlanExecution>();
  const [deleteConfirmation, setDeleteConfirmation] = useState<DeleteConfirmation>();
  const [paletteMode, setPaletteMode] = useState<"search" | "shortcuts">();
  // Hooks must run before the loading screen returns, so the handlers that need loaded data
  // are filled in further down.
  const menuActionRef = useRef<(action: string) => void>(() => undefined);
  const shortcutActions = useRef<{ goTo(view: View): void; newItem(): void }>({
    goTo: () => undefined,
    newItem: () => undefined,
  });
  useShortcuts({
    enabled: !paletteMode && !deleteConfirmation,
    openPalette: () => setPaletteMode("search"),
    openShortcuts: () => setPaletteMode("shortcuts"),
    goTo: (next) => shortcutActions.current.goTo(next),
    newItem: () => shortcutActions.current.newItem(),
  });
  const [runTarget, setRunTarget] = useState<TestDefinition>();
  const [rerunSource, setRerunSource] = useState<TestRun>();
  const [activeRun, setActiveRun] = useState<TestRun>();
  const [workspaceCustomerId, setWorkspaceCustomerId] = useState(
    () => localStorage.getItem(customerContextStorageKey) ?? "all",
  );
  const [workspaceEnvironmentId, setWorkspaceEnvironmentId] = useState(
    () => localStorage.getItem(environmentContextStorageKey) ?? "all",
  );
  const snapshotRef = useRef(snapshot);
  const planQueueRef = useRef<
    | {
        planId: string;
        planRunId: string;
        environmentId: string;
        remaining: string[];
        total: number;
        completed: number;
        parametersByTestId: PlanParameterValues;
        currentTestId?: string;
      }
    | undefined
  >(undefined);
  snapshotRef.current = snapshot;

  const refresh = useCallback(async () => {
    try {
      setSnapshot(await window.bcFlow.getSnapshot());
    } catch (cause) {
      setError(messageOf(cause));
    }
  }, []);

  const runNextPlanTest = useCallback(async () => {
    const queue = planQueueRef.current;
    const currentSnapshot = snapshotRef.current;
    if (!queue || !currentSnapshot) return;
    const testId = queue.remaining.shift();
    if (!testId) {
      planQueueRef.current = undefined;
      setPlanExecution({
        planId: queue.planId,
        total: queue.total,
        completed: queue.completed,
        status: "passed",
      });
      return;
    }
    const test = currentSnapshot.tests.find((item) => item.id === testId);
    const environment = currentSnapshot.environments.find(
      (item) => item.id === queue.environmentId,
    );
    if (!test || !environment) {
      planQueueRef.current = undefined;
      void window.bcFlow.abortTestPlanRun(queue.planRunId).then(setSnapshot);
      setError("A test or target from the test plan no longer exists.");
      setPlanExecution({ ...queue, status: "failed" });
      return;
    }
    queue.currentTestId = test.id;
    setPlanExecution({
      planId: queue.planId,
      total: queue.total,
      completed: queue.completed,
      status: "running",
      currentTestId: test.id,
    });
    try {
      await window.bcFlow.startRun({
        testDefinitionId: test.id,
        environmentId: environment.id,
        parameters: queue.parametersByTestId[test.id] ?? {},
        confirmRisk: true,
        manualMfa: environment?.authentication === "AAD",
        rememberSession: environment?.authentication === "AAD",
      });
    } catch (cause) {
      planQueueRef.current = undefined;
      void window.bcFlow.abortTestPlanRun(queue.planRunId).then(setSnapshot);
      setError(messageOf(cause));
      setPlanExecution({
        planId: queue.planId,
        total: queue.total,
        completed: queue.completed,
        status: "failed",
        currentTestId: test.id,
      });
    }
  }, []);

  const startPlan = useCallback(
    async (request: PlanRunRequest, parametersByTestId: PlanParameterValues) => {
      const { plan } = request;
      const testIds = request.testDefinitionIds ?? plan.testDefinitionIds;
      try {
        const result = await window.bcFlow.beginTestPlanRun({
          planId: plan.id,
          testDefinitionIds: request.testDefinitionIds,
          resumedFromId: request.resumedFromId,
          scheduledFor: request.scheduledFor,
          name: plan.name,
          environmentId: plan.environmentId,
        });
        setSnapshot(result.snapshot);
        planQueueRef.current = {
          planId: plan.id,
          planRunId: result.planRunId,
          environmentId: plan.environmentId,
          remaining: [...testIds],
          total: testIds.length,
          completed: 0,
          parametersByTestId,
        };
        setPlanExecution({
          planId: plan.id,
          total: testIds.length,
          completed: 0,
          status: "running",
        });
        void runNextPlanTest();
      } catch (cause) {
        setError(messageOf(cause));
      }
    },
    [runNextPlanTest],
  );

  useEffect(() => {
    localStorage.setItem(customerContextStorageKey, workspaceCustomerId);
    localStorage.setItem(environmentContextStorageKey, workspaceEnvironmentId);
  }, [workspaceCustomerId, workspaceEnvironmentId]);

  useEffect(() => {
    if (!snapshot) return;
    if (
      workspaceCustomerId !== "all" &&
      !snapshot.customers.some(
        (customer) => customer.id === workspaceCustomerId && !customer.archivedAt,
      )
    ) {
      setWorkspaceCustomerId("all");
    }
    if (workspaceEnvironmentId !== "all") {
      const environment = snapshot.environments.find(
        (item) => item.id === workspaceEnvironmentId && !item.archivedAt,
      );
      if (
        !environment ||
        (workspaceCustomerId !== "all" && environment.customerId !== workspaceCustomerId)
      ) {
        setWorkspaceEnvironmentId("all");
      }
    }
  }, [snapshot, workspaceCustomerId, workspaceEnvironmentId]);

  useEffect(() => {
    if (snapshot) document.documentElement.dataset.textSize = snapshot.settings.textSize;
  }, [snapshot]);

  useEffect(() => {
    void refresh();
    const unsubscribeRunner = window.bcFlow.onRunnerEvent((event: RunnerEvent) => {
      if (event.type === "menu-action") menuActionRef.current(event.action);
      if (event.type === "schedule-due") {
        const current = snapshotRef.current;
        const plan = current?.testPlans.find((item) => item.id === event.planId);
        if (!current || !plan || planQueueRef.current || current.activeRunId) return;
        // Safe to run alone: the main process checked. The moment counts as handled once it starts.
        void startPlan(
          { plan, scheduledFor: event.occurrence },
          defaultPlanParameters(current, plan),
        );
      }
      if (event.type === "run-started") setActiveRun(event.run);
      if (event.type === "run-updated") setActiveRun(event.run);
      if (event.type === "run-log") {
        setActiveRun((current) =>
          current?.id === event.runId ? { ...current, log: [...current.log, event.line] } : current,
        );
      }
      if (event.type === "run-progress") {
        setActiveRun((current) =>
          current?.id === event.runId
            ? { ...current, progress: [...current.progress, event.event] }
            : current,
        );
      }
      if (event.type === "run-finished") {
        setActiveRun(event.run);
        void refresh();
        const queue = planQueueRef.current;
        if (queue?.currentTestId === event.run.testDefinitionId) {
          void window.bcFlow
            .recordTestPlanRunResult(queue.planRunId, event.run.id)
            .then((next) => {
              setSnapshot(next);
              if (event.run.status === "PASSED") {
                queue.completed += 1;
                queue.currentTestId = undefined;
                void runNextPlanTest();
              } else {
                planQueueRef.current = undefined;
                setPlanExecution({
                  planId: queue.planId,
                  total: queue.total,
                  completed: queue.completed,
                  status: "failed",
                  currentTestId: event.run.testDefinitionId,
                });
              }
            })
            .catch((cause) => {
              planQueueRef.current = undefined;
              setError(messageOf(cause));
            });
        }
      }
      if (event.type === "mcp-approvals-updated" || event.type === "investigations-updated")
        void refresh();
    });
    return () => {
      unsubscribeRunner();
    };
  }, [refresh, runNextPlanTest, startPlan]);

  if (!snapshot) {
    return (
      <main className="loading-screen">
        <img className="brand-logo" src={nivioLogo} alt="NIVIO" />
        <LoaderCircle className="spin" />
        <p>NIVIO Test Suite is starting…</p>
      </main>
    );
  }

  const selectedRun =
    activeRun ??
    (snapshot.activeRunId
      ? snapshot.runs.find((run) => run.id === snapshot.activeRunId)
      : undefined);
  const pendingAgentRequests = snapshot.mcpApprovals.filter(
    (request) => request.status === "PENDING",
  ).length;
  const isMacOs = navigator.userAgent.includes("Macintosh");
  const runPageShowing = Boolean(runTarget && selectedRun?.testDefinitionId === runTarget.id);
  const openInvestigation = snapshot.investigations.find((item) => item.id === investigationId);
  const editingPage =
    environmentModal ||
    Boolean(projectPage) ||
    customerModal ||
    testGroupModal ||
    testPlanModal ||
    importModal ||
    Boolean(testTarget) ||
    Boolean(planRunTarget) ||
    Boolean(investigationRun) ||
    Boolean(runTarget && !runPageShowing);
  const runPageActive = editingPage || Boolean(openInvestigation) || runPageShowing;
  const navigate = (next: View) => {
    if (editingPage) {
      setError("Save or cancel your changes before you open another menu.");
      return;
    }
    setInvestigationId(undefined);
    setView(next);
  };
  const guarded = (action: () => void) => {
    if (editingPage) {
      setError("Save or cancel your changes before you open another menu.");
      return;
    }
    action();
  };
  const commandActions = {
    goTo: navigate,
    runTest: (test: TestDefinition) => guarded(() => setRunTarget(test)),
    runPlan: (plan: TestPlan) => guarded(() => setPlanRunTarget({ plan })),
    openRun: (run: TestRun) =>
      guarded(() => {
        setActiveRun(run);
        setRunTarget(snapshot.tests.find((test) => test.id === run.testDefinitionId));
      }),
    openInvestigation: (investigation: Investigation) =>
      guarded(() => {
        setView("investigations");
        setInvestigationId(investigation.id);
      }),
    createInvestigation: (run: TestRun) => guarded(() => setInvestigationRun(run)),
    importTest: () =>
      guarded(() => {
        setView("tests");
        setImportModal(true);
      }),
    newPlan: () =>
      guarded(() => {
        setView("plans");
        setTestPlanTarget(undefined);
        setTestPlanInitialTestIds([]);
        setTestPlanInitialEnvironmentId(undefined);
        setTestPlanModal(true);
      }),
    newCustomer: () =>
      guarded(() => {
        setView("customers");
        setCustomerTarget(undefined);
        setCustomerModal(true);
      }),
    editCustomer: (customer: Customer) =>
      guarded(() => {
        setView("customers");
        setCustomerTarget(customer);
        setCustomerModal(true);
      }),
    addEnvironment: () =>
      guarded(() => {
        setView("environments");
        setEnvironmentTarget(undefined);
        setEnvironmentModal(true);
      }),
    editEnvironment: (environment: AppSnapshot["environments"][number]) =>
      guarded(() => {
        setView("environments");
        setEnvironmentTarget(environment);
        setEnvironmentModal(true);
      }),
    addProject: () =>
      guarded(() => {
        setView("projects");
        setProjectPage({});
      }),
    openProject: (project: AppSnapshot["projects"][number]) =>
      guarded(() => {
        setView("projects");
        setProjectPage({ projectId: project.id });
      }),
  };
  /** Runs the other tests of the investigation's project on its environment. */
  const runRegression = (investigation: Investigation) => {
    const project = snapshot.projects.find((item) => item.id === investigation.projectId);
    const environment = snapshot.environments.find((item) => item.id === project?.environmentId);
    if (!project || !environment) return;
    const testIds = snapshot.tests
      .filter(
        (item) =>
          item.id !== investigation.testDefinitionId &&
          !item.archivedAt &&
          item.projectIds?.includes(project.id) &&
          item.allowedEnvironmentTypes.includes(environment.type),
      )
      .map((item) => item.id);
    if (!testIds.length) return;
    const plan: TestPlan = {
      id: `regression:${investigation.id}`,
      name: `Regression · INV-${investigation.number}`,
      customerId: environment.customerId,
      environmentId: environment.id,
      testDefinitionIds: testIds,
    };
    // Read-only tests with every required value known start right away. Anything that changes
    // data, or needs a value, goes through the same review page as a plan.
    if (canStartWithoutReview(snapshot, plan)) {
      void startPlan({ plan }, defaultPlanParameters(snapshot, plan));
    } else {
      setPlanRunTarget({ plan, title: `Regression for INV-${investigation.number}` });
    }
  };
  const commands = buildCommands(snapshot, commandActions);
  menuActionRef.current = (raw) => {
    if (!isMenuAction(raw)) return;
    const screen = screenOfAction(raw);
    if (screen) return navigate(screen as View);
    const sizes = ["extra-small", "small", "medium", "large"] as const;
    const saveSize = (textSize: (typeof sizes)[number]) =>
      runSafely(setError, async () =>
        setSnapshot(await window.bcFlow.saveSettings({ ...snapshot.settings, textSize })),
      );
    const position = sizes.indexOf(snapshot.settings.textSize);
    switch (raw) {
      case "palette":
        return setPaletteMode("search");
      case "shortcuts":
        return setPaletteMode("shortcuts");
      case "new:import-test":
        return commandActions.importTest();
      case "new:plan":
        return commandActions.newPlan();
      case "new:customer":
        return commandActions.newCustomer();
      case "new:environment":
        return commandActions.addEnvironment();
      case "new:project":
        return commandActions.addProject();
      case "workspace:export":
        return void window.bcFlow.exportWorkspace().catch((cause) => setError(messageOf(cause)));
      case "workspace:import":
        return guarded(() => {
          void window.bcFlow
            .importWorkspace()
            .then(setSnapshot)
            .catch((cause) => setError(messageOf(cause)));
        });
      case "text-size:larger":
        return saveSize(sizes[Math.min(sizes.length - 1, position + 1)]);
      case "text-size:smaller":
        return saveSize(sizes[Math.max(0, position - 1)]);
      case "text-size:reset":
        return saveSize("medium");
    }
  };
  shortcutActions.current = {
    goTo: navigate,
    newItem: () => {
      const byView: Partial<Record<View, () => void>> = {
        tests: commandActions.importTest,
        plans: commandActions.newPlan,
        customers: commandActions.newCustomer,
        environments: commandActions.addEnvironment,
        projects: commandActions.addProject,
      };
      byView[view]?.();
    },
  };
  const investigationsNeedingMe = snapshot.investigations.filter((item) =>
    NEEDS_USER_STATUSES.includes(item.status),
  ).length;

  return (
    <RunPageHost.Provider value={runPageHost}>
      <TooltipLayer />
      <CommandPalette
        mode={paletteMode}
        commands={commands}
        onClose={() => setPaletteMode(undefined)}
      />
      <div className={`app-shell${isMacOs ? " app-shell-macos" : ""}`}>
        <aside className="sidebar">
          <div className="brand">
            <img className="brand-logo" src={nivioLogo} alt="NIVIO" />
            <span className="brand-product">Test Suite</span>
          </div>
          <nav aria-label="Main navigation">
            {navigationGroups.map((group) => (
              <div className="nav-group" key={group.label}>
                <span className="nav-group-label">{group.label}</span>
                {group.items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      type="button"
                      key={item.id}
                      className={view === item.id ? "nav-active" : ""}
                      data-tip={
                        goToKeys(item.id)
                          ? `${item.label} · ${goToKeys(item.id)?.join(" ")}`
                          : undefined
                      }
                      onClick={() => navigate(item.id)}
                    >
                      <Icon size={18} /> {item.label}
                      {item.id === "investigations" && investigationsNeedingMe > 0 && (
                        <span
                          className="nav-count"
                          aria-label={`${investigationsNeedingMe} need your attention`}
                        >
                          {investigationsNeedingMe}
                        </span>
                      )}
                      {item.id === "dashboard" && pendingAgentRequests > 0 && (
                        <span className="nav-count" aria-label={`${pendingAgentRequests} pending`}>
                          {pendingAgentRequests}
                        </span>
                      )}
                      {item.id === "runs" && selectedRun?.status === "RUNNING" && (
                        <span className="nav-dot" />
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
          </nav>
          <div className="sidebar-footer">
            <nav className="sidebar-settings" aria-label="Support and application settings">
              <span className="nav-group-label">Support</span>
              <button
                type="button"
                className={view === "help" ? "nav-active" : ""}
                onClick={() => navigate("help")}
              >
                <CircleHelp size={18} /> Help
              </button>
              <button
                type="button"
                className={view === "settings" ? "nav-active" : ""}
                onClick={() => navigate("settings")}
              >
                <Settings size={18} /> Settings
              </button>
            </nav>
            <button
              type="button"
              className={`sidebar-status ${snapshot.diagnostics.powershellAvailable ? "status-ok" : "status-warning"}`}
              onClick={() => navigate("settings")}
              aria-label="Runner status. Open Settings."
            >
              <span className="status-dot" aria-hidden="true" />
              <span className="status-text">
                <strong>
                  {snapshot.diagnostics.powershellAvailable ? "Runner ready" : "Runner incomplete"}
                </strong>
                <small>
                  {snapshot.diagnostics.powershellAvailable
                    ? (snapshot.diagnostics.powershellExecutable?.split(/[\\/]/).pop() ??
                      "PowerShell")
                    : "PowerShell 7 missing"}
                </small>
              </span>
              <span className="status-version">v{snapshot.diagnostics.appVersion}</span>
            </button>
          </div>
        </aside>

        <main className={`workspace${runPageActive ? " workspace-run-active" : ""}`}>
          <header className="topbar">
            <div className="topbar-title">
              <h1>{navigation.find((item) => item.id === view)?.label}</h1>
              <p className="subtitle">{pageSubtitles[view]}</p>
            </div>
            <div className="page-actions" ref={setActionsHost} />
            {view !== "settings" && view !== "help" && (
              <div className="workspace-context" aria-label="Working context">
                <label className="workspace-context-field">
                  <Building2 size={17} aria-hidden="true" />
                  <span className="workspace-context-copy">
                    <span>Customer</span>
                    <Select
                      value={workspaceCustomerId}
                      onChange={(event) => {
                        setWorkspaceCustomerId(event.target.value);
                        setWorkspaceEnvironmentId("all");
                      }}
                    >
                      <option value="all">All customers</option>
                      {snapshot.customers
                        .filter((customer) => !customer.archivedAt)
                        .map((customer) => (
                          <option key={customer.id} value={customer.id}>
                            {customer.name}
                          </option>
                        ))}
                    </Select>
                  </span>
                </label>
                <label className="workspace-context-field">
                  <Server size={17} aria-hidden="true" />
                  <span className="workspace-context-copy">
                    <span>Environment · company</span>
                    <Select
                      value={workspaceEnvironmentId}
                      onChange={(event) => setWorkspaceEnvironmentId(event.target.value)}
                    >
                      <option value="all">All environments</option>
                      {snapshot.environments
                        .filter(
                          (environment) =>
                            !environment.archivedAt &&
                            (workspaceCustomerId === "all" ||
                              environment.customerId === workspaceCustomerId),
                        )
                        .map((environment) => (
                          <option key={environment.id} value={environment.id}>
                            {environment.name} · {environment.company} · {environment.type}
                          </option>
                        ))}
                    </Select>
                  </span>
                </label>
              </div>
            )}
          </header>

          {selectedRun?.status === "RUNNING" && (
            <LiveRunBar
              run={selectedRun}
              execution={planExecution}
              onView={() => {
                const test = snapshot.tests.find(
                  (item) => item.id === selectedRun.testDefinitionId,
                );
                if (test) setRunTarget(test);
              }}
              onStop={() => void window.bcFlow.stopRun()}
            />
          )}

          <div className="run-page-host" ref={setRunPageHost} />
          <PageActionsHost.Provider value={actionsHost}>
            <section className="page-content">
              {view === "dashboard" && (
                <Dashboard
                  snapshot={snapshot}
                  onRun={setRunTarget}
                  onOpenRun={(run) => {
                    setActiveRun(run);
                    setRunTarget(snapshot.tests.find((test) => test.id === run.testDefinitionId));
                  }}
                  onNavigate={setView}
                  onRunPlan={setPlanRunTarget}
                  onRefresh={refresh}
                />
              )}
              {view === "tests" && (
                <TestLibrary
                  snapshot={snapshot}
                  contextCustomerId={workspaceCustomerId}
                  contextEnvironmentId={workspaceEnvironmentId}
                  onRun={setRunTarget}
                  onImport={() => setImportModal(true)}
                  onEdit={setTestTarget}
                  onUpdate={(test) =>
                    runSafely(setError, async () =>
                      setSnapshot(await window.bcFlow.selectAndUpdateTest(test.id)),
                    )
                  }
                  onCreatePlan={(testIds) => {
                    setTestPlanTarget(undefined);
                    setTestPlanInitialTestIds(testIds);
                    setTestPlanModal(true);
                  }}
                  onArchive={(test) =>
                    runSafely(setError, async () =>
                      setSnapshot(await window.bcFlow.setTestArchived(test.id, !test.archivedAt)),
                    )
                  }
                  onDelete={(test) => {
                    const runCount = snapshot.runs.filter(
                      (run) => run.testDefinitionId === test.id,
                    ).length;
                    const investigationCount = snapshot.investigations.filter(
                      (item) => item.testDefinitionId === test.id,
                    ).length;
                    setDeleteConfirmation({
                      title: `Delete ${test.testId}?`,
                      description: runCount
                        ? `The imported recording will no longer be available in the test library. This also permanently deletes its history: ${runCount} run${runCount === 1 ? "" : "s"} with screenshots, video and reports${investigationCount ? `, and ${investigationCount} investigation${investigationCount === 1 ? "" : "s"}` : ""}. This cannot be undone.`
                        : "The imported recording will no longer be available in the test library.",
                      perform: () => window.bcFlow.deleteTest(test.id, runCount > 0),
                    });
                  }}
                />
              )}
              {view === "plans" && (
                <TestPlansView
                  snapshot={snapshot}
                  contextCustomerId={workspaceCustomerId}
                  contextEnvironmentId={workspaceEnvironmentId}
                  execution={planExecution}
                  activeRun={selectedRun?.status === "RUNNING"}
                  onAdd={() => {
                    setTestPlanTarget(undefined);
                    setTestPlanInitialTestIds([]);
                    setTestPlanModal(true);
                  }}
                  onEdit={(plan) => {
                    setTestPlanTarget(plan);
                    setTestPlanModal(true);
                  }}
                  onRun={(plan) => setPlanRunTarget({ plan })}
                  onResume={setPlanRunTarget}
                  onOpenRun={(run) => {
                    setActiveRun(run);
                    setRunTarget(snapshot.tests.find((test) => test.id === run.testDefinitionId));
                  }}
                  onArchive={(plan) =>
                    runSafely(setError, async () =>
                      setSnapshot(
                        await window.bcFlow.setEntityArchived(
                          "test-plan",
                          plan.id,
                          !plan.archivedAt,
                        ),
                      ),
                    )
                  }
                  onDelete={(plan) =>
                    setDeleteConfirmation({
                      title: `Delete ${plan.name}?`,
                      description:
                        "The grouped execution history is removed. Individual runs remain available.",
                      perform: () => window.bcFlow.deleteTestPlan(plan.id),
                    })
                  }
                />
              )}
              {view === "customers" && (
                <CustomersView
                  snapshot={snapshot}
                  onAddCustomer={() => setCustomerModal(true)}
                  onAddGroup={() => setTestGroupModal(true)}
                  onEditCustomer={(customer) => {
                    setCustomerTarget(customer);
                    setCustomerModal(true);
                  }}
                  onDeleteCustomer={(customer) =>
                    setDeleteConfirmation({
                      title: `Delete ${customer.name}?`,
                      description:
                        "A customer can only be deleted when it has no environments, groups or run history.",
                      perform: () => window.bcFlow.deleteCustomer(customer.id),
                    })
                  }
                  onEditGroup={(group) => {
                    setTestGroupTarget(group);
                    setTestGroupModal(true);
                  }}
                  onDeleteGroup={(group) =>
                    setDeleteConfirmation({
                      title: `Delete ${group.name}?`,
                      description:
                        "A group can only be deleted after its tests have been moved or removed.",
                      perform: () => window.bcFlow.deleteTestGroup(group.id),
                    })
                  }
                  onArchiveCustomer={(customer) =>
                    runSafely(setError, async () =>
                      setSnapshot(
                        await window.bcFlow.setEntityArchived(
                          "customer",
                          customer.id,
                          !customer.archivedAt,
                        ),
                      ),
                    )
                  }
                  onArchiveGroup={(group) =>
                    runSafely(setError, async () =>
                      setSnapshot(
                        await window.bcFlow.setEntityArchived(
                          "test-group",
                          group.id,
                          !group.archivedAt,
                        ),
                      ),
                    )
                  }
                />
              )}
              {view === "environments" && (
                <Environments
                  snapshot={snapshot}
                  onAdd={() => {
                    setEnvironmentTarget(undefined);
                    setEnvironmentModal(true);
                  }}
                  onEdit={(environment) => {
                    setEnvironmentTarget(environment);
                    setEnvironmentModal(true);
                  }}
                  onDelete={(environment) =>
                    setDeleteConfirmation({
                      title: `Delete ${environment.name}?`,
                      description: "An environment with run history cannot be deleted.",
                      perform: () => window.bcFlow.deleteEnvironment(environment.id),
                    })
                  }
                  onForgetSession={async (id) =>
                    runSafely(setError, async () =>
                      setSnapshot(await window.bcFlow.forgetSession(id)),
                    )
                  }
                  onArchive={(environment) =>
                    runSafely(setError, async () =>
                      setSnapshot(
                        await window.bcFlow.setEntityArchived(
                          "environment",
                          environment.id,
                          !environment.archivedAt,
                        ),
                      ),
                    )
                  }
                />
              )}
              {view === "runs" && (
                <RunHistory
                  snapshot={snapshot}
                  contextCustomerId={workspaceCustomerId}
                  contextEnvironmentId={workspaceEnvironmentId}
                  onOpen={(run) => {
                    setActiveRun(run);
                    setRunTarget(snapshot.tests.find((test) => test.id === run.testDefinitionId));
                  }}
                  onDelete={(run) =>
                    setDeleteConfirmation({
                      title: `Delete run ${run.testId}?`,
                      description:
                        "The run log and local evidence files will be permanently removed.",
                      perform: () => window.bcFlow.deleteRun(run.id),
                    })
                  }
                  onRerun={(run) => {
                    const test = snapshot.tests.find((item) => item.id === run.testDefinitionId);
                    if (!test) return setError("The original test no longer exists.");
                    setRerunSource(run);
                    setRunTarget(test);
                  }}
                />
              )}
              {view === "help" && <HelpView />}
              {view === "projects" && (
                <ProjectsView
                  snapshot={snapshot}
                  onAdd={() => setProjectPage({})}
                  onOpen={(project) => setProjectPage({ projectId: project.id })}
                  onArchive={(project) =>
                    runSafely(setError, async () =>
                      setSnapshot(
                        await window.bcFlow.setEntityArchived(
                          "project",
                          project.id,
                          !project.archivedAt,
                        ),
                      ),
                    )
                  }
                />
              )}
              {view === "investigations" && (
                <InvestigationsView
                  snapshot={snapshot}
                  onOpen={(investigation) => setInvestigationId(investigation.id)}
                />
              )}
              {view === "settings" && (
                <SettingsView
                  snapshot={snapshot}
                  onDataDeleted={setSnapshot}
                  onStepDelayChange={(stepDelayMs) =>
                    runSafely(setError, async () =>
                      setSnapshot(
                        await window.bcFlow.saveSettings({ ...snapshot.settings, stepDelayMs }),
                      ),
                    )
                  }
                  onTextSizeChange={(textSize) =>
                    runSafely(setError, async () =>
                      setSnapshot(
                        await window.bcFlow.saveSettings({ ...snapshot.settings, textSize }),
                      ),
                    )
                  }
                  onRunRetentionChange={(runRetentionDays) =>
                    runSafely(setError, async () =>
                      setSnapshot(
                        await window.bcFlow.saveSettings({
                          ...snapshot.settings,
                          runRetentionDays,
                        }),
                      ),
                    )
                  }
                  onCustomAgentChange={(customAgent) =>
                    runSafely(setError, async () =>
                      setSnapshot(
                        await window.bcFlow.saveSettings({ ...snapshot.settings, customAgent }),
                      ),
                    )
                  }
                  onNotificationsChange={(notifications) =>
                    runSafely(setError, async () =>
                      setSnapshot(
                        await window.bcFlow.saveSettings({ ...snapshot.settings, notifications }),
                      ),
                    )
                  }
                  onRefresh={refresh}
                />
              )}
            </section>
          </PageActionsHost.Provider>
        </main>

        {environmentModal && (
          <EnvironmentModal
            snapshot={snapshot}
            environment={environmentTarget}
            onClose={() => {
              setEnvironmentModal(false);
              setEnvironmentTarget(undefined);
            }}
            onSaved={(next) => {
              setSnapshot(next);
              setEnvironmentModal(false);
              setEnvironmentTarget(undefined);
            }}
            onOpenProject={(target) => {
              setEnvironmentModal(false);
              setEnvironmentTarget(undefined);
              setProjectPage(target);
            }}
            onNewCustomer={() => {
              setEnvironmentModal(false);
              setEnvironmentTarget(undefined);
              setView("customers");
              setCustomerTarget(undefined);
              setCustomerModal(true);
            }}
          />
        )}
        {!runPageShowing && projectPage && (
          <ProjectPage
            key={projectPage.projectId ?? "new"}
            snapshot={snapshot}
            project={snapshot.projects.find((item) => item.id === projectPage.projectId)}
            defaultEnvironmentId={projectPage.environmentId}
            onClose={() => setProjectPage(undefined)}
            onSaved={setSnapshot}
          />
        )}
        {!runPageShowing && openInvestigation && (
          <InvestigationPage
            key={openInvestigation.id}
            snapshot={snapshot}
            investigation={openInvestigation}
            onClose={() => setInvestigationId(undefined)}
            onSnapshot={setSnapshot}
            onOpenRun={(run) => {
              setActiveRun(run);
              setRunTarget(snapshot.tests.find((test) => test.id === run.testDefinitionId));
            }}
            onRetest={setRunTarget}
            onRunRegression={runRegression}
            onRegression={(testIds, environmentId) => {
              setInvestigationId(undefined);
              setTestPlanTarget(undefined);
              setTestPlanInitialTestIds(testIds);
              setTestPlanInitialEnvironmentId(environmentId);
              setTestPlanModal(true);
            }}
          />
        )}
        {investigationRun && (
          <CreateInvestigationModal
            snapshot={snapshot}
            run={investigationRun}
            onClose={() => setInvestigationRun(undefined)}
            onCreated={(next) => {
              setSnapshot(next);
              setInvestigationRun(undefined);
              setRunTarget(undefined);
              setActiveRun(undefined);
              setView("investigations");
              setInvestigationId(next.investigations[0]?.id);
            }}
          />
        )}
        {importModal && (
          <ImportModal
            snapshot={snapshot}
            onClose={() => setImportModal(false)}
            onImported={(next) => {
              setSnapshot(next);
              setImportModal(false);
              setView("tests");
            }}
          />
        )}
        {customerModal && (
          <CustomerModal
            customer={customerTarget}
            onClose={() => {
              setCustomerModal(false);
              setCustomerTarget(undefined);
            }}
            onSaved={(next) => {
              setSnapshot(next);
              setCustomerModal(false);
              setCustomerTarget(undefined);
            }}
          />
        )}
        {testGroupModal && (
          <TestGroupModal
            snapshot={snapshot}
            group={testGroupTarget}
            onClose={() => {
              setTestGroupModal(false);
              setTestGroupTarget(undefined);
            }}
            onSaved={(next) => {
              setSnapshot(next);
              setTestGroupModal(false);
              setTestGroupTarget(undefined);
            }}
          />
        )}
        {testTarget && (
          <TestDefinitionModal
            snapshot={snapshot}
            test={testTarget}
            onClose={() => setTestTarget(undefined)}
            onSaved={(next) => {
              setSnapshot(next);
              setTestTarget(undefined);
            }}
          />
        )}
        {testPlanModal && (
          <TestPlanModal
            snapshot={snapshot}
            plan={testPlanTarget}
            initialTestIds={testPlanInitialTestIds}
            initialEnvironmentId={testPlanInitialEnvironmentId}
            initialCustomerId={workspaceCustomerId === "all" ? undefined : workspaceCustomerId}
            onClose={() => {
              setTestPlanModal(false);
              setTestPlanTarget(undefined);
              setTestPlanInitialTestIds([]);
              setTestPlanInitialEnvironmentId(undefined);
            }}
            onSaved={(next) => {
              setSnapshot(next);
              setTestPlanModal(false);
              setTestPlanTarget(undefined);
              setTestPlanInitialTestIds([]);
              setTestPlanInitialEnvironmentId(undefined);
            }}
          />
        )}
        {planRunTarget && (
          <RunPlanConfirmationModal
            snapshot={snapshot}
            plan={planRunTarget.plan}
            testDefinitionIds={planRunTarget.testDefinitionIds}
            initialParameters={planRunTarget.initialParameters}
            title={planRunTarget.title}
            onClose={() => setPlanRunTarget(undefined)}
            onRun={(parametersByTestId) => {
              const request = planRunTarget;
              setPlanRunTarget(undefined);
              void startPlan(request, parametersByTestId);
            }}
          />
        )}
        {deleteConfirmation && (
          <DeleteConfirmationModal
            confirmation={deleteConfirmation}
            onClose={() => setDeleteConfirmation(undefined)}
            onDeleted={(next) => {
              setSnapshot(next);
              setDeleteConfirmation(undefined);
            }}
          />
        )}
        {/* The investigation page replaces the run page while it is open; going back restores it. */}
        {runTarget && !investigationRun && (
          <RunModal
            test={runTarget}
            snapshot={snapshot}
            preferredEnvironmentId={workspaceEnvironmentId}
            activeRun={selectedRun?.testDefinitionId === runTarget.id ? selectedRun : undefined}
            initialRun={rerunSource}
            onClose={() => {
              setRunTarget(undefined);
              setRerunSource(undefined);
              if (selectedRun?.status !== "RUNNING") setActiveRun(undefined);
            }}
            onStarted={setActiveRun}
            onError={setError}
            onInvestigate={(run) => {
              const existing = snapshot.investigations.find((item) => item.runId === run.id);
              if (existing) {
                setRunTarget(undefined);
                setActiveRun(undefined);
                setView("investigations");
                setInvestigationId(existing.id);
              } else setInvestigationRun(run);
            }}
          />
        )}
        {error && (
          <div className="toast toast-error">
            <XCircle size={18} />
            <span>{error}</span>
            {errorCodeFor(error) && (
              <button
                type="button"
                className="toast-action"
                onClick={() => {
                  const code = errorCodeFor(error);
                  setError(undefined);
                  if (code) navigate(ERROR_ACTIONS[code].view as View);
                }}
              >
                {ERROR_ACTIONS[errorCodeFor(error) as AppErrorCode].label}
              </button>
            )}
            <button type="button" onClick={() => setError(undefined)} aria-label="Dismiss">
              ×
            </button>
          </div>
        )}
      </div>
    </RunPageHost.Provider>
  );
}

function DeleteConfirmationModal({
  confirmation,
  onClose,
  onDeleted,
}: {
  confirmation: DeleteConfirmation;
  onClose(): void;
  onDeleted(snapshot: AppSnapshot): void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  return (
    <Modal title={confirmation.title} eyebrow="Confirm deletion" onClose={onClose}>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError(undefined);
          try {
            onDeleted(await confirmation.perform());
          } catch (cause) {
            setError(messageOf(cause));
          } finally {
            setBusy(false);
          }
        }}
      >
        <p className="confirmation-copy">{confirmation.description}</p>
        {error && <InlineError text={error} />}
        <div className="modal-actions">
          <button className="button button-secondary" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="button button-danger-primary" type="submit" disabled={busy}>
            {busy ? "Deleting…" : "Delete"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
