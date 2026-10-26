import { createHash, randomUUID } from "node:crypto";
import { cp, mkdir, readFile, readdir, rm, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative } from "node:path";
import { BrowserWindow, Notification, app, clipboard, dialog, shell } from "electron";
import { stringify } from "yaml";
import { AppError } from "../shared/app-error";
import { isAllowedBusinessCentralUrl } from "../shared/business-central-url";
import { type DataDeletionResult, withDependencies } from "../shared/data-categories";
import { type McpStatus, emptyMcpStatus } from "../shared/mcp-tools";
import type {
  AgentKind,
  AppSettingsInput,
  AppSnapshot,
  CustomerInput,
  EnvironmentInput,
  ImportedTestInput,
  Investigation,
  InvestigationChangeInput,
  InvestigationDecisionInput,
  InvestigationInput,
  McpApprovalAction,
  McpApprovalRequest,
  McpCreateTestInput,
  ParameterProfileInput,
  ProjectInput,
  ProjectInspection,
  RunnerEvent,
  RuntimeDiagnostics,
  StartRunInput,
  TestDefinition,
  TestDefinitionInput,
  TestGroupInput,
  TestPlanInput,
  TestRun,
} from "../shared/models";
import {
  agentKindSchema,
  appSettingsInputSchema,
  beginTestPlanRunInputSchema,
  customerInputSchema,
  deleteDataInputSchema,
  environmentInputSchema,
  importedTestInputSchema,
  investigationChangeInputSchema,
  investigationDecisionInputSchema,
  investigationIdSchema,
  investigationInputSchema,
  mcpCreateTestInputSchema,
  parameterProfileInputSchema,
  projectIdSchema,
  projectInputSchema,
  startRunInputSchema,
  testDefinitionInputSchema,
  testGroupInputSchema,
  testPlanInputSchema,
  testRecordingUpdateInputSchema,
} from "../shared/schemas";
import { AgentRunner, type AgentStage } from "./agent-runner";
import { parseChangeFile } from "./investigation";
import { customExecutable } from "./investigation-service";
import { InvestigationService } from "./investigation-service";
import { Notifier } from "./notifier";
import { copyPageScriptBundle, parsePageScriptContents, parsePageScriptFile } from "./page-script";
import { inspectProjectFolder } from "./project-repository";
import { collectRunArtifacts } from "./run-artifacts";
import {
  runExportJson,
  runExportMarkdown,
  sanitizeText,
  sanitizeTextArtifacts,
} from "./run-export";
import { parseRunProgressLine } from "./run-progress";
import { ReplayRunner, pathExists } from "./runner";
import { resolvePowerShellExecutable } from "./runtime";
import { RuntimeManager } from "./runtime-manager";
import { Scheduler } from "./scheduler";
import { validateStorageState } from "./storage-state";
import type { JsonStore } from "./store";
import { createWorkspaceArchive, readWorkspaceArchive } from "./workspace-backup";

export class AppController {
  private activeRun?: TestRun;
  private replayRunner: ReplayRunner;
  private diagnostics!: RuntimeDiagnostics;
  private rememberedSessionRuns = new Set<string>();
  private mcpApprovals: McpApprovalRequest[] = [];
  private mcpApprovalExecutors = new Map<string, () => Promise<McpApprovalRequest["result"]>>();
  private runtimeManager?: RuntimeManager;
  private investigations!: InvestigationService;
  private approvedFolders = new Set<string>();
  /** Programs the user chose in the file dialog; only these may become the custom agent. */
  private approvedExecutables = new Set<string>();
  private agentRunner = new AgentRunner();
  private notifier?: Notifier;
  private scheduler?: Scheduler;

  constructor(
    private readonly store: JsonStore,
    private readonly dataDirectory: string,
    private readonly workspaceDirectory: string,
    private readonly emit: (event: RunnerEvent) => void,
  ) {
    this.replayRunner = new ReplayRunner({
      powershellExecutable: "pwsh",
      replayScript: "",
      workingDirectory: workspaceDirectory,
    });
  }

  async initialize(): Promise<void> {
    await this.store.initialize();
    this.notifier = new Notifier(
      {
        supported: () => Notification.isSupported(),
        windowFocused: () => BrowserWindow.getAllWindows().some((window) => window.isFocused()),
        show: (title, body) => {
          const notification = new Notification({ title, body });
          notification.on("click", () => {
            const window = BrowserWindow.getAllWindows()[0];
            if (!window) return;
            if (window.isMinimized()) window.restore();
            window.show();
            window.focus();
          });
          notification.show();
        },
      },
      () => this.store.snapshot().settings.notifications,
    );
    this.investigations = new InvestigationService(
      this.store,
      this.dataDirectory,
      {
        confirm: async (message, detail) =>
          (
            await dialog.showMessageBox({
              type: "question",
              message,
              detail,
              buttons: ["Copy package", "Cancel"],
              defaultId: 0,
              cancelId: 1,
            })
          ).response === 0,
        copyText: (text) => clipboard.writeText(text),
        reveal: (path) => shell.showItemInFolder(path),
      },
      (investigation, projectName) => {
        const title = {
          PLAN_RECEIVED: "A plan is waiting for your approval",
          CHANGE_APPLIED: "A change is ready to retest",
          RETEST_FAILED: "The retest failed",
        }[investigation.status as "PLAN_RECEIVED" | "CHANGE_APPLIED" | "RETEST_FAILED"];
        this.notifier?.notify(
          "investigationNeedsMe",
          title,
          `INV-${investigation.number}${projectName ? ` · ${projectName}` : ""}`,
        );
      },
    );
    for (const project of this.store.snapshot().projects) {
      if (project.codePath) this.approvedFolders.add(project.codePath);
    }
    const savedAgent = this.store.snapshot().settings.customAgent;
    if (savedAgent) this.approvedExecutables.add(savedAgent.executable);
    this.runtimeManager = new RuntimeManager(
      this.dataDirectory,
      app.getVersion(),
      process.platform,
    );
    this.mcpApprovals = structuredClone(this.store.snapshot().mcpApprovals);
    const runnerPaths = await this.refreshRuntime();
    const powershellExecutable = this.diagnostics.powershellExecutable;
    this.replayRunner = new ReplayRunner({
      powershellExecutable: powershellExecutable ?? "pwsh",
      ...runnerPaths,
    });
    for (const run of this.store.snapshot().runs) {
      const evidenceComplete =
        run.steps.length > 0 &&
        run.videoPath &&
        (run.status === "PASSED" ||
          run.steps.some((step) => step.status !== "PASSED" && step.screenshotPath));
      if (run.status === "RUNNING" || evidenceComplete) continue;
      const artifacts = await collectRunArtifacts(
        run.resultDirectory,
        run.status !== "PASSED",
      ).catch(() => undefined);
      if (!artifacts) continue;
      run.steps = artifacts.steps;
      run.videoPath = artifacts.videoPath;
      await this.store.updateRun(run);
    }
  }

  snapshot(): AppSnapshot {
    return {
      ...this.store.snapshot(),
      diagnostics: this.diagnostics,
      activeRunId: this.activeRun?.id,
      mcpApprovals: structuredClone(this.mcpApprovals),
      mcpStatus: this.mcpStatusProvider?.() ?? emptyMcpStatus(),
    };
  }

  private mcpStatusProvider?: () => McpStatus;

  setMcpStatusProvider(provider: () => McpStatus): void {
    this.mcpStatusProvider = provider;
  }

  /** The MCP bridge calls this after each tool call so the Settings screen stays current. */
  notifyMcpCall(): void {
    this.emit({ type: "mcp-approvals-updated" });
  }

  requestMcpCreateTest(raw: McpCreateTestInput): McpApprovalRequest {
    const input = mcpCreateTestInputSchema.parse(raw);
    const parsed = parsePageScriptContents(input.yaml, input.name);
    if (parsed.includedFiles.length) {
      throw new Error("MCP can currently only create standalone Page Script YAML.");
    }
    const group = this.store.findTestGroup(input.groupId);
    if (!group) throw new Error("The test group no longer exists.");
    if (
      this.store
        .snapshot()
        .tests.some(
          (test) =>
            test.groupId === input.groupId &&
            test.testId.toLowerCase() === input.testId.toLowerCase(),
        )
    ) {
      throw new Error("A test with this ID already exists in the selected group.");
    }
    return this.queueMcpApproval(
      "create-test",
      `Create ${input.testId}`,
      `${input.name} in ${group.name} · ${input.risk} · ${parsed.raw.steps?.length ?? 0} steps`,
      async () => {
        const id = randomUUID();
        const targetDirectory = join(this.dataDirectory, "recordings", input.groupId, id);
        await mkdir(targetDirectory, { recursive: true });
        const recordingPath = join(targetDirectory, `${input.testId}.yml`);
        await writeFile(recordingPath, input.yaml, { encoding: "utf8", mode: 0o600 });
        await this.store.addTest({
          id,
          testId: input.testId,
          name: input.name,
          description: input.description ?? parsed.description,
          customerId: group.customerId,
          groupId: input.groupId,
          recordingPath,
          risk: input.risk,
          forbiddenActions: input.forbiddenActions,
          tags: input.tags,
          allowedEnvironmentTypes: input.allowedEnvironmentTypes,
          parameters: parsed.parameters,
          versionHash: parsed.versionHash,
          importedAt: new Date().toISOString(),
        });
        return { testDefinitionId: id };
      },
    );
  }

  requestMcpStartTest(raw: StartRunInput): McpApprovalRequest {
    const input = startRunInputSchema.parse(raw);
    const test = this.store.findTest(input.testDefinitionId);
    const environment = input.environmentId
      ? this.store.findEnvironment(input.environmentId)
      : undefined;
    if (!test) throw new Error("Select a valid Business Central test.");
    if (!environment) throw new Error("Select a valid Business Central environment.");
    return this.queueMcpApproval(
      "start-test",
      `Run ${test.testId}`,
      `${test.name} on ${environment.name} · ${test.risk} · ${Object.keys(input.parameters).length} parameters`,
      async () => ({ runId: (await this.startRun(input, "ai-agent")).id }),
    );
  }

  requestMcpStopTest(): McpApprovalRequest {
    if (!this.activeRun) throw new Error("There is no active test.");
    return this.queueMcpApproval(
      "stop-test",
      `Stop ${this.activeRun.testId}`,
      `Abort the active run on ${this.activeRun.environmentName}.`,
      async () => {
        const runId = this.activeRun?.id;
        await this.stopRun();
        return { runId };
      },
    );
  }

  findMcpApproval(id: string): McpApprovalRequest | undefined {
    return structuredClone(this.mcpApprovals.find((request) => request.id === id));
  }

  async resolveMcpApproval(id: string, approved: boolean): Promise<AppSnapshot> {
    const request = this.mcpApprovals.find((item) => item.id === id);
    if (!request || request.status !== "PENDING")
      throw new Error("The MCP request is no longer active.");
    request.resolvedAt = new Date().toISOString();
    if (!approved) {
      request.status = "REJECTED";
      this.mcpApprovalExecutors.delete(id);
      await this.store.saveMcpApprovals(this.mcpApprovals);
      this.emit({ type: "mcp-approvals-updated" });
      return this.snapshot();
    }
    request.status = "APPROVED";
    const execute = this.mcpApprovalExecutors.get(id);
    this.mcpApprovalExecutors.delete(id);
    try {
      request.result = await execute?.();
      request.status = "COMPLETED";
    } catch (error) {
      request.status = "FAILED";
      request.error = sanitizeText(error instanceof Error ? error.message : String(error));
    }
    await this.store.saveMcpApprovals(this.mcpApprovals);
    this.emit({ type: "mcp-approvals-updated" });
    return this.snapshot();
  }

  copyMcpSetup(client: "codex" | "claude-desktop"): void {
    const bridgeFile = join(this.dataDirectory, "mcp-connection.json");
    const serverPath = app.isPackaged
      ? join(app.getAppPath(), "out", "mcp", "server.js")
      : join(this.workspaceDirectory, "src", "mcp", "server.ts");
    const command = app.isPackaged ? process.execPath : "bun";
    const environment = {
      BCFT_MCP_BRIDGE_FILE: bridgeFile,
      ...(app.isPackaged ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
    };
    const config =
      client === "codex"
        ? `[mcp_servers.nivio-test-suite]\ncommand = ${JSON.stringify(command)}\nargs = [${JSON.stringify(serverPath)}]\n[mcp_servers.nivio-test-suite.env]\n${Object.entries(
            environment,
          )
            .map(([key, value]) => `${key} = ${JSON.stringify(value)}`)
            .join("\n")}\n`
        : JSON.stringify(
            {
              mcpServers: {
                "nivio-test-suite": {
                  command,
                  args: [serverPath],
                  env: environment,
                },
              },
            },
            null,
            2,
          );
    clipboard.writeText(config);
  }

  private queueMcpApproval(
    action: McpApprovalAction,
    title: string,
    detail: string,
    execute: () => Promise<McpApprovalRequest["result"]>,
  ): McpApprovalRequest {
    const request: McpApprovalRequest = {
      id: randomUUID(),
      action,
      title,
      detail,
      status: "PENDING",
      requestedAt: new Date().toISOString(),
    };
    this.mcpApprovals.unshift(request);
    this.mcpApprovals = this.mcpApprovals.slice(0, 50);
    this.mcpApprovalExecutors.set(request.id, execute);
    void this.store.saveMcpApprovals(this.mcpApprovals);
    this.emit({ type: "mcp-approvals-updated" });
    this.notifier?.notify("agentApproval", "An AI agent asks for approval", title);
    return structuredClone(request);
  }

  async saveSettings(raw: AppSettingsInput): Promise<AppSnapshot> {
    const settings = appSettingsInputSchema.parse(raw);
    if (settings.customAgent) {
      const { executable } = settings.customAgent;
      if (!this.approvedExecutables.has(executable)) {
        throw new Error("Choose the agent program with the file picker.");
      }
      if (!(await customExecutable(executable))) {
        throw new AppError("AGENT_NOT_FOUND", "That file is not a runnable program.");
      }
    }
    await this.store.saveSettings(settings);
    const removedRuns = await this.store.pruneRuns(settings.runRetentionDays);
    await Promise.all(
      removedRuns.map((run) => rm(run.resultDirectory, { recursive: true, force: true })),
    );
    return this.snapshot();
  }

  async saveParameterProfile(raw: ParameterProfileInput): Promise<AppSnapshot> {
    const input = parameterProfileInputSchema.parse(raw);
    await this.store.saveParameterProfile(input);
    return this.snapshot();
  }

  async installRuntimeUpdate(): Promise<AppSnapshot> {
    this.assertRuntimeIdle();
    const result = await dialog.showOpenDialog({
      title: "Install approved NIVIO replay runtime",
      properties: ["openFile"],
      filters: [{ name: "NIVIO runtime", extensions: ["nivio-runtime"] }],
    });
    if (result.canceled || !result.filePaths[0]) return this.snapshot();
    await this.getRuntimeManager().install(await readFile(result.filePaths[0]));
    await this.refreshRuntime();
    return this.snapshot();
  }

  async rollbackRuntime(): Promise<AppSnapshot> {
    this.assertRuntimeIdle();
    await this.getRuntimeManager().rollback();
    await this.refreshRuntime();
    return this.snapshot();
  }

  async checkRuntimeCompatibility(): Promise<AppSnapshot> {
    this.assertRuntimeIdle();
    await this.refreshRuntime();
    return this.snapshot();
  }

  async checkEnvironment(
    id: string,
  ): Promise<{ ok: boolean; status?: number; latencyMs: number; message: string }> {
    const environment = this.store.findEnvironment(id);
    if (!environment) throw new Error("Environment does not exist.");
    if (!isAllowedBusinessCentralUrl(environment.baseUrl)) {
      throw new Error("Environment URL is not on the Business Central host allowlist.");
    }
    const started = Date.now();
    try {
      const response = await fetch(environment.baseUrl, {
        method: "HEAD",
        redirect: "manual",
        signal: AbortSignal.timeout(8_000),
      });
      return {
        ok: response.status < 500,
        status: response.status,
        latencyMs: Date.now() - started,
        message:
          response.status < 500
            ? "Business Central endpoint is reachable."
            : "Business Central returned a server error.",
      };
    } catch (error) {
      return {
        ok: false,
        latencyMs: Date.now() - started,
        message: sanitizeText(error instanceof Error ? error.message : String(error)),
      };
    }
  }

  async exportWorkspace(): Promise<void> {
    const result = await dialog.showSaveDialog({
      title: "Exporteer NIVIO workspace backup",
      defaultPath: `nivio-test-suite-${new Date().toISOString().slice(0, 10)}.nivio-workspace`,
      filters: [{ name: "NIVIO workspace", extensions: ["nivio-workspace"] }],
    });
    if (result.canceled || !result.filePath) return;
    const archive = await createWorkspaceArchive(this.store.snapshot());
    await writeFile(result.filePath, archive, { mode: 0o600 });
  }

  async importWorkspace(): Promise<AppSnapshot> {
    if (this.activeRun) {
      throw new Error("Stop the active run first.");
    }
    const selection = await dialog.showOpenDialog({
      title: "Importeer NIVIO workspace backup",
      properties: ["openFile"],
      filters: [{ name: "NIVIO workspace", extensions: ["nivio-workspace"] }],
    });
    if (selection.canceled || !selection.filePaths[0]) return this.snapshot();
    const parsed = readWorkspaceArchive(new Uint8Array(await readFile(selection.filePaths[0])));
    const confirmation = await dialog.showMessageBox({
      type: "warning",
      title: "Workspace importeren",
      message: `Found ${parsed.manifest.state.tests.length} tests and ${parsed.manifest.state.testPlans.length} test plans.`,
      detail:
        "Merge keeps local items and replaces conflicts with the same ID. Replace replaces the active configuration. Passwords, sessions and run history are never imported.",
      buttons: ["Merge", "Replace", "Cancel"],
      defaultId: 0,
      cancelId: 2,
    });
    if (confirmation.response === 2) return this.snapshot();
    const state = structuredClone(parsed.manifest.state);
    for (const test of state.tests) {
      const sourcePath = test.recordingPath;
      const prefix = `library/${test.id}/`;
      const targetDirectory = join(this.dataDirectory, "imported-tests", test.id);
      for (const [name, contents] of parsed.files) {
        if (!name.startsWith(prefix)) continue;
        const relativeName = name.slice(prefix.length);
        const target = join(targetDirectory, relativeName);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, contents, { mode: 0o600 });
      }
      test.recordingPath = join(targetDirectory, sourcePath.slice(prefix.length));
    }
    await this.store.importWorkspace(state, confirmation.response === 0 ? "merge" : "replace");
    return this.snapshot();
  }

  async setEntityArchived(
    kind: "customer" | "test-group" | "environment" | "test-plan" | "project",
    id: string,
    archived: boolean,
  ): Promise<AppSnapshot> {
    await this.store.setEntityArchived(kind, id, archived);
    return this.snapshot();
  }

  async saveProject(raw: ProjectInput): Promise<AppSnapshot> {
    const input = projectInputSchema.parse(raw);
    if (input.codePath) {
      // Only folders the user picked in this app may be linked, never a path from the renderer.
      if (!this.approvedFolders.has(input.codePath)) {
        throw new Error("Choose the code folder with the folder picker.");
      }
      const inspection = await inspectProjectFolder(input.codePath);
      if (!inspection.exists) throw new Error("The chosen code folder does not exist.");
    }
    await this.store.saveProject(input);
    return this.snapshot();
  }

  async chooseAgentExecutable(): Promise<string | undefined> {
    const result = await dialog.showOpenDialog({
      title: "Choose the program that starts your coding agent",
      properties: ["openFile"],
    });
    const path = result.filePaths[0];
    if (result.canceled || !path) return undefined;
    this.approvedExecutables.add(path);
    return path;
  }

  async chooseProjectFolder(): Promise<
    { path: string; inspection: ProjectInspection } | undefined
  > {
    const result = await dialog.showOpenDialog({
      title: "Choose the local AL code folder",
      properties: ["openDirectory"],
    });
    const path = result.filePaths[0];
    if (result.canceled || !path) return undefined;
    this.approvedFolders.add(path);
    return { path, inspection: await inspectProjectFolder(path) };
  }

  async inspectProject(rawId: string): Promise<ProjectInspection> {
    return this.investigations.inspectProject(projectIdSchema.parse(rawId));
  }

  async createInvestigation(raw: InvestigationInput): Promise<AppSnapshot> {
    await this.investigations.create(investigationInputSchema.parse(raw));
    return this.snapshot();
  }

  getInvestigationPrompt(rawId: string, rawAgent: AgentKind): string {
    return this.investigations.prompt(
      investigationIdSchema.parse(rawId),
      agentKindSchema.parse(rawAgent),
    );
  }

  async copyInvestigationPrompt(rawId: string, rawAgent: AgentKind): Promise<AppSnapshot> {
    await this.investigations.copyPrompt(
      investigationIdSchema.parse(rawId),
      agentKindSchema.parse(rawAgent),
    );
    return this.snapshot();
  }

  async exportInvestigationPackage(rawId: string): Promise<AppSnapshot> {
    await this.investigations.exportPackage(investigationIdSchema.parse(rawId));
    return this.snapshot();
  }

  revealInvestigation(rawId: string): void {
    this.investigations.reveal(investigationIdSchema.parse(rawId));
  }

  async importAgentOutput(rawId: string): Promise<AppSnapshot> {
    await this.investigations.importAgentOutput(investigationIdSchema.parse(rawId));
    return this.snapshot();
  }

  async decideInvestigation(raw: InvestigationDecisionInput): Promise<AppSnapshot> {
    await this.investigations.decide(investigationDecisionInputSchema.parse(raw));
    return this.snapshot();
  }

  async recordInvestigationChange(raw: InvestigationChangeInput): Promise<AppSnapshot> {
    await this.investigations.recordChange(investigationChangeInputSchema.parse(raw));
    return this.snapshot();
  }

  /** Returns false when the user declined to start the agent. */
  async startInvestigationAgent(rawId: string): Promise<boolean> {
    const id = investigationIdSchema.parse(rawId);
    const request = await this.investigations.prepareAgentRun(id);
    if (request.agent === "other") {
      // Test Suite cannot hold your own program to read-only or to no-push, so the user
      // sees exactly what will run, every time.
      const answer = await dialog.showMessageBox({
        type: "warning",
        message: "Run your own agent?",
        detail: [
          `Program: ${request.executable}`,
          `Arguments: ${(request.args ?? []).join(" ") || "(none)"}`,
          `Folder: ${request.cwd}`,
          "",
          "Test Suite cannot limit what this program does. It runs with your permissions and receives the investigation prompt on its input.",
        ].join("\n"),
        buttons: ["Run agent", "Cancel"],
        defaultId: 1,
        cancelId: 1,
      });
      if (answer.response !== 0) return false;
    }
    this.agentRunner.start(request, {
      onLog: (line) => this.emit({ type: "agent-log", investigationId: id, line }),
      onExit: (output, code, error) => {
        void this.finishAgent(id, request.stage, output, code, error);
      },
    });
    return true;
  }

  async stopInvestigationAgent(): Promise<void> {
    await this.agentRunner.stop();
  }

  private async finishAgent(
    id: string,
    stage: AgentStage,
    output: string,
    code: number | null,
    error?: Error,
  ): Promise<void> {
    let message =
      stage === "plan" ? "The plan is ready for your review." : "The change is reported.";
    let ok = true;
    try {
      if (error) throw error;
      if (code !== 0) throw new Error(`The agent stopped with code ${code ?? "unknown"}.`);
      await this.investigations.finishAgentRun(id, stage, output);
    } catch (cause) {
      ok = false;
      message = cause instanceof Error ? cause.message : String(cause);
    }
    this.emit({ type: "agent-finished", investigationId: id, ok, message });
    this.emitInvestigationsChanged();
  }

  private emitInvestigationsChanged(): void {
    this.emit({ type: "investigations-updated" });
  }

  listAgentInvestigations() {
    return this.investigations.listForAgent();
  }

  getAgentInvestigation(id: string) {
    return this.investigations.getForAgent(investigationIdSchema.parse(id));
  }

  async submitAgentPlan(id: string, markdown: string): Promise<void> {
    await this.investigations.submitPlan(investigationIdSchema.parse(id), markdown);
    this.emitInvestigationsChanged();
  }

  getAgentDecision(id: string) {
    return this.investigations.decisionForAgent(investigationIdSchema.parse(id));
  }

  async reportAgentChange(id: string, raw: unknown): Promise<void> {
    const change = parseChangeFile(new TextEncoder().encode(JSON.stringify(raw)));
    await this.investigations.reportChange(investigationIdSchema.parse(id), change);
    this.emitInvestigationsChanged();
  }

  async startNextInvestigationRound(rawId: string): Promise<AppSnapshot> {
    await this.investigations.nextRound(investigationIdSchema.parse(rawId));
    return this.snapshot();
  }

  async abandonInvestigation(rawId: string): Promise<AppSnapshot> {
    await this.investigations.abandon(investigationIdSchema.parse(rawId));
    return this.snapshot();
  }

  async saveEnvironment(raw: EnvironmentInput): Promise<AppSnapshot> {
    const input = environmentInputSchema.parse(raw);
    await this.store.saveEnvironment(input);
    return this.snapshot();
  }

  async saveCustomer(raw: CustomerInput): Promise<AppSnapshot> {
    await this.store.saveCustomer(customerInputSchema.parse(raw));
    return this.snapshot();
  }

  async deleteCustomer(id: string): Promise<AppSnapshot> {
    await this.store.deleteCustomer(id);
    return this.snapshot();
  }

  async saveTestGroup(raw: TestGroupInput): Promise<AppSnapshot> {
    await this.store.saveTestGroup(testGroupInputSchema.parse(raw));
    return this.snapshot();
  }

  async deleteTestGroup(id: string): Promise<AppSnapshot> {
    await this.store.deleteTestGroup(id);
    return this.snapshot();
  }

  async saveTest(raw: TestDefinitionInput): Promise<AppSnapshot> {
    await this.store.saveTest(testDefinitionInputSchema.parse(raw));
    return this.snapshot();
  }

  async deleteTest(id: string, withHistory?: boolean): Promise<AppSnapshot> {
    const recordingPath = this.store.findTest(id)?.recordingPath;
    const removed = await this.store.deleteTest(id, withHistory === true);
    if (recordingPath) await unlink(recordingPath).catch(() => undefined);
    await this.removeRunFiles(removed.runs);
    await this.removeInvestigationFiles(removed.investigations);
    return this.snapshot();
  }

  async deleteData(raw: unknown): Promise<{ snapshot: AppSnapshot; result: DataDeletionResult }> {
    const { categories } = deleteDataInputSchema.parse(raw);
    if (this.agentRunner.active) throw new Error("Stop the active agent first.");
    const removed = await this.store.deleteData(withDependencies(categories));
    await this.removeRunFiles(removed.runs);
    await this.removeInvestigationFiles(removed.investigations);
    for (const test of removed.tests) await unlink(test.recordingPath).catch(() => undefined);
    return { snapshot: this.snapshot(), result: removed.result };
  }

  private async removeRunFiles(runs: TestRun[]): Promise<void> {
    for (const run of runs) {
      await rm(run.resultDirectory, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async removeInvestigationFiles(investigations: Investigation[]): Promise<void> {
    for (const item of investigations) {
      await rm(join(this.dataDirectory, "investigations", item.id), {
        recursive: true,
        force: true,
      }).catch(() => undefined);
    }
  }

  async setTestArchived(id: string, archived: boolean): Promise<AppSnapshot> {
    await this.store.setTestArchived(id, archived);
    return this.snapshot();
  }

  async saveTestPlan(raw: TestPlanInput): Promise<AppSnapshot> {
    await this.store.saveTestPlan(testPlanInputSchema.parse(raw));
    return this.snapshot();
  }

  async deleteTestPlan(id: string): Promise<AppSnapshot> {
    await this.store.deleteTestPlan(id);
    return this.snapshot();
  }

  async dismissSchedulePending(planId: string): Promise<AppSnapshot> {
    await this.store.dismissSchedulePending(investigationIdSchema.parse(planId));
    return this.snapshot();
  }

  /** Watches the plan schedules for as long as Test Suite is open. */
  startScheduler(): void {
    this.scheduler ??= new Scheduler({
      plans: () => this.store.snapshot().testPlans,
      context: () => this.store.snapshot(),
      busy: () =>
        Boolean(this.activeRun) ||
        this.replayRunner.isRunning ||
        this.store.snapshot().testPlanRuns.some((planRun) => planRun.status === "RUNNING"),
      now: () => new Date(),
      emitDue: (plan, occurrence) =>
        this.emit({ type: "schedule-due", planId: plan.id, occurrence }),
      handle: async (planId, occurrence, pending) => {
        await this.store.handleScheduledMoment(planId, occurrence, pending);
        this.emitInvestigationsChanged();
      },
      notify: (title, body) => this.notifier?.notify("scheduledPlans", title, body),
    });
    this.scheduler.start();
  }

  stopScheduler(): void {
    this.scheduler?.stop();
  }

  async beginTestPlanRun(raw: unknown): Promise<{ snapshot: AppSnapshot; planRunId: string }> {
    const planRunId = await this.store.beginTestPlanRun(beginTestPlanRunInputSchema.parse(raw));
    return { snapshot: this.snapshot(), planRunId };
  }

  async recordTestPlanRunResult(planRunId: string, runId: string): Promise<AppSnapshot> {
    await this.store.recordTestPlanRunResult(planRunId, runId);
    const planRun = this.store.snapshot().testPlanRuns.find((item) => item.id === planRunId);
    if (planRun && planRun.status !== "RUNNING") {
      const word = { PASSED: "passed", FAILED: "failed", ABORTED: "was stopped" }[planRun.status];
      this.notifier?.notify(
        planRun.scheduled && planRun.status !== "PASSED" ? "scheduledPlans" : "runFinished",
        `Plan ${planRun.planName} ${word}`,
        `${planRun.items.length} test${planRun.items.length === 1 ? "" : "s"} run`,
      );
    }
    return this.snapshot();
  }

  async abortTestPlanRun(planRunId: string): Promise<AppSnapshot> {
    await this.store.abortTestPlanRun(planRunId);
    return this.snapshot();
  }

  async deleteEnvironment(id: string): Promise<AppSnapshot> {
    await this.store.deleteEnvironment(id);
    return this.snapshot();
  }

  async forgetSession(environmentId: string): Promise<AppSnapshot> {
    if (!this.store.findEnvironment(environmentId))
      throw new Error("The environment no longer exists.");
    await this.store.clearSessionState(environmentId);
    return this.snapshot();
  }

  async readArtifact(path: string): Promise<string> {
    const allowed = this.store
      .snapshot()
      .runs.some((run) => run.steps.some((step) => step.screenshotPath === path));
    if (!allowed) throw new Error("The artifact is not linked to a known run.");
    const contents = await readFile(path);
    if (contents.byteLength > 5_000_000) throw new Error("The screenshot is too large to show.");
    return `data:image/png;base64,${contents.toString("base64")}`;
  }

  isArtifactAllowed(path: string): boolean {
    return this.store.snapshot().runs.some((run) => {
      if (run.videoPath === path || run.steps.some((step) => step.screenshotPath === path)) {
        return true;
      }
      if (!run.reportPath) return false;
      if (run.reportPath === path) return true;
      const reportDirectory = dirname(run.reportPath);
      const relativePath = relative(reportDirectory, path);
      return relativePath !== "" && !relativePath.startsWith("..") && !isAbsolute(relativePath);
    });
  }

  async selectAndImportTest(raw: ImportedTestInput): Promise<AppSnapshot> {
    const input = importedTestInputSchema.parse(raw);
    const group = this.store.findTestGroup(input.groupId);
    if (!group) throw new Error("Select a valid test group.");
    const result = await dialog.showOpenDialog({
      title: "Importeer Business Central Page Script",
      properties: ["openFile"],
      filters: [{ name: "Page Script YAML", extensions: ["yml", "yaml"] }],
    });
    if (result.canceled || result.filePaths.length === 0) return this.snapshot();

    const sourcePath = result.filePaths[0];
    const parsed = await parsePageScriptFile(sourcePath);
    const testId =
      input.testId?.trim() ||
      slugify(basename(sourcePath).replace(/\.(ya?ml)$/i, "")).toUpperCase();
    if (
      this.store
        .snapshot()
        .tests.some(
          (test) => test.groupId === group.id && test.testId.toLowerCase() === testId.toLowerCase(),
        )
    ) {
      throw new Error(
        `Test ${testId} already exists in this group. Use Update recording on the existing test.`,
      );
    }
    const targetDirectory = join(
      this.dataDirectory,
      "recordings",
      group.id,
      `${testId}-${parsed.versionHash}`,
    );
    await mkdir(targetDirectory, { recursive: true });
    const targetPath = join(targetDirectory, basename(sourcePath));
    await copyPageScriptBundle(sourcePath, targetDirectory);

    const test: TestDefinition = {
      id: randomUUID(),
      testId,
      name: parsed.name,
      description: parsed.description,
      customerId: group.customerId,
      groupId: group.id,
      recordingPath: targetPath,
      risk: input.risk ?? "read-only",
      forbiddenActions: [],
      tags: input.tags ?? ["smoke"],
      allowedEnvironmentTypes: input.allowedEnvironmentTypes ?? ["sandbox", "uat", "docker"],
      parameters: parsed.parameters,
      versionHash: parsed.versionHash,
      importedAt: new Date().toISOString(),
    };
    await this.store.addTest(test);
    return this.snapshot();
  }

  async selectAndUpdateTest(rawTestId: string): Promise<AppSnapshot> {
    const { testId } = testRecordingUpdateInputSchema.parse({ testId: rawTestId });
    const test = this.store.findTest(testId);
    if (!test) {
      throw new Error("Select a valid Business Central test.");
    }
    const result = await dialog.showOpenDialog({
      title: `Update the recording of ${test.testId}`,
      properties: ["openFile"],
      filters: [{ name: "Page Script YAML", extensions: ["yml", "yaml"] }],
    });
    if (result.canceled || result.filePaths.length === 0) return this.snapshot();

    const sourcePath = result.filePaths[0];
    const [current, candidate] = await Promise.all([
      parsePageScriptFile(test.recordingPath),
      parsePageScriptFile(sourcePath),
    ]);
    if (candidate.versionHash === current.versionHash) {
      await dialog.showMessageBox({
        type: "info",
        title: "Recording is unchanged",
        message: `${test.testId} already uses this version.`,
      });
      return this.snapshot();
    }
    const currentParameters = new Set(current.parameters.map((parameter) => parameter.name));
    const candidateParameters = new Set(candidate.parameters.map((parameter) => parameter.name));
    const addedParameters = [...candidateParameters].filter((name) => !currentParameters.has(name));
    const removedParameters = [...currentParameters].filter(
      (name) => !candidateParameters.has(name),
    );
    const confirmation = await dialog.showMessageBox({
      type: "warning",
      title: `Update ${test.testId}?`,
      message: "The new recording is valid and ready to replace the active version.",
      detail: [
        `Version: ${current.versionHash} → ${candidate.versionHash}`,
        `Steps: ${current.raw.steps?.length ?? 0} → ${candidate.raw.steps?.length ?? 0}`,
        `Includes: ${current.includedFiles.length} → ${candidate.includedFiles.length}`,
        `Parameters added: ${addedParameters.join(", ") || "none"}`,
        `Parameters removed: ${removedParameters.join(", ") || "none"}`,
        "The previous recording stays stored locally and historical runs are unchanged.",
      ].join("\n"),
      buttons: ["Cancel", "Update recording"],
      defaultId: 0,
      cancelId: 0,
    });
    if (confirmation.response !== 1) return this.snapshot();

    const targetDirectory = join(
      this.dataDirectory,
      "recordings",
      test.groupId,
      `${test.testId}-${candidate.versionHash}`,
    );
    await mkdir(targetDirectory, { recursive: true });
    const targetPath = join(targetDirectory, basename(sourcePath));
    await copyPageScriptBundle(sourcePath, targetDirectory);
    await this.store.updateTestRecording(test.id, {
      recordingPath: targetPath,
      parameters: candidate.parameters,
      versionHash: candidate.versionHash,
      importedAt: new Date().toISOString(),
    });
    return this.snapshot();
  }

  async startRun(
    raw: StartRunInput,
    initiatedBy: NonNullable<TestRun["initiatedBy"]> = "user",
  ): Promise<TestRun> {
    const input = startRunInputSchema.parse(raw);
    if (this.activeRun || this.replayRunner.isRunning)
      throw new Error("A test is already running.");
    const test = this.store.findTest(input.testDefinitionId);
    if (!test) throw new Error("The test no longer exists.");
    if (!this.diagnostics.replayAvailable)
      throw new AppError(
        "RUNTIME_MISSING",
        "Microsoft bc-replay is not installed or was not found.",
      );
    if (!this.diagnostics.powershellAvailable)
      throw new AppError(
        "RUNTIME_MISSING",
        "PowerShell 7 (pwsh or pwsh-preview) is required to run bc-replay.",
      );

    const environment = input.environmentId
      ? this.store.findEnvironment(input.environmentId)
      : undefined;
    if (!environment) throw new Error("The test or environment no longer exists.");
    if (!test.allowedEnvironmentTypes.includes(environment.type)) {
      throw new Error(
        `Test ${test.testId} is not allowed on environment type ${environment.type}.`,
      );
    }
    if (environment.type === "production") throw new Error("Production runs are blocked.");
    if (input.manualMfa && environment.authentication !== "AAD") {
      throw new Error("Manual MFA is only available for Microsoft Entra ID.");
    }
    if (test.risk !== "read-only" && !input.confirmRisk) {
      throw new Error("Explicitly confirm that this test can change data.");
    }
    for (const parameter of test.parameters) {
      if (parameter.required && input.parameters[parameter.name] === undefined) {
        throw new Error(`Required parameter is missing: ${parameter.name}`);
      }
    }

    const customer = this.store.findCustomer(environment.customerId);
    if (!customer || (test.customerId && customer.id !== test.customerId))
      throw new Error("The test and environment do not belong to the same customer.");
    const startedAt = new Date();
    const runId = randomUUID();
    const resultDirectory = join(
      this.dataDirectory,
      "runs",
      `${timestamp(startedAt)}-${test.testId}-${runId.slice(0, 8)}`,
    );
    const run: TestRun = {
      id: runId,
      testId: test.testId,
      testDefinitionId: test.id,
      testName: test.name,
      environmentId: environment.id,
      environmentName: environment.name,
      customerCode: customer.code,
      initiatedBy,
      status: "RUNNING",
      startedAt: startedAt.toISOString(),
      parameters: maskSecretParameters(
        input.parameters,
        test.parameters.map((parameter) => (parameter.secret ? parameter.name : "")),
      ),
      versionHash: test.versionHash,
      resultDirectory,
      log: [
        `Runner started for ${test.testId} on ${environment.name}.`,
        `Target: ${environment.baseUrl}`,
        ...(input.manualMfa ? ["Manual MFA enabled."] : []),
      ],
      progress: [],
      steps: [],
    };
    run.progress = run.log.flatMap((line) => {
      const event = parseRunProgressLine(line, run.startedAt);
      return event ? [event] : [];
    });
    this.activeRun = run;
    if (input.rememberSession) this.rememberedSessionRuns.add(run.id);
    await this.store.addRun(run);
    this.emit({ type: "run-started", run: structuredClone(run) });

    const artifactSecrets = [
      this.store.getPassword(environment.id),
      ...test.parameters
        .filter((parameter) => parameter.secret)
        .map((parameter) => input.parameters[parameter.name])
        .filter((value): value is string | number | boolean => value !== undefined)
        .map(String),
    ].filter((value): value is string => Boolean(value));
    try {
      await this.replayRunner.start({
        run,
        test,
        environment,
        password: this.store.getPassword(environment.id),
        values: input.parameters,
        manualMfa: input.manualMfa,
        rememberSession: input.rememberSession,
        stepDelayMs: this.store.snapshot().settings.stepDelayMs,
        sessionState: input.rememberSession
          ? this.store.getSessionState(environment.id)
          : undefined,
        callbacks: {
          onLog: (line) => void this.appendLog(run, line),
          onComplete: (exitCode, error) =>
            void this.completeRun(run, exitCode, error, artifactSecrets),
        },
      });
    } catch (error) {
      await this.completeRun(
        run,
        null,
        error instanceof Error ? error : new Error(String(error)),
        artifactSecrets,
      );
      throw error;
    }
    return structuredClone(run);
  }

  async stopRun(): Promise<void> {
    if (!this.activeRun) return;
    const run = this.activeRun;
    await this.replayRunner.stop();
    await this.persistRememberedSession(run);
    run.status = "ABORTED";
    run.finishedAt = new Date().toISOString();
    run.durationMs = new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime();
    run.log.push("Run aborted manually.");
    await this.store.updateRun(run);
    this.activeRun = undefined;
    this.emit({ type: "run-finished", run: structuredClone(run) });
  }

  async deleteRun(id: string): Promise<AppSnapshot> {
    const run = await this.store.deleteRun(id);
    await rm(run.resultDirectory, { recursive: true, force: true });
    return this.snapshot();
  }

  async exportRun(id: string, format: "markdown" | "json"): Promise<void> {
    const run = this.store.snapshot().runs.find((item) => item.id === id);
    if (!run) throw new Error("The test run no longer exists.");
    const extension = format === "markdown" ? "md" : "json";
    const result = await dialog.showSaveDialog({
      title: "Exporteer veilig runrapport",
      defaultPath: `${slugify(run.testId)}-${run.startedAt.slice(0, 10)}.${extension}`,
      filters: [
        format === "markdown"
          ? { name: "Markdown report", extensions: ["md"] }
          : { name: "JSON report", extensions: ["json"] },
      ],
    });
    if (result.canceled || !result.filePath) return;
    const contents = format === "markdown" ? runExportMarkdown(run) : runExportJson(run);
    await writeFile(result.filePath, contents, { encoding: "utf8", mode: 0o600 });
  }

  async exportTestPlanRun(id: string, format: "markdown" | "json"): Promise<void> {
    const state = this.store.snapshot();
    const planRun = state.testPlanRuns.find((item) => item.id === id);
    if (!planRun) throw new Error("Test plan execution does not exist.");
    const runs = planRun.items
      .map((item) => state.runs.find((run) => run.id === item.runId))
      .filter((run): run is TestRun => Boolean(run))
      .map((run) => ({
        testId: run.testId,
        testName: run.testName,
        status: run.status,
        durationMs: run.durationMs,
        error: run.error ? sanitizeText(run.error) : undefined,
        steps: run.steps.map((step) => ({ ...step, screenshotPath: undefined })),
      }));
    const payload = { ...planRun, runs };
    const contents =
      format === "json"
        ? `${JSON.stringify(payload, null, 2)}\n`
        : [
            `# ${planRun.planName}`,
            "",
            `- Status: **${planRun.status}**`,
            `- Started: ${planRun.startedAt}`,
            `- Finished: ${planRun.finishedAt ?? "—"}`,
            "",
            "## Tests",
            "",
            ...runs.map(
              (run) =>
                `- **${run.testId} — ${run.testName}**: ${run.status} (${run.durationMs ?? 0} ms)${run.error ? ` — ${run.error}` : ""}`,
            ),
            "",
          ].join("\n");
    const result = await dialog.showSaveDialog({
      defaultPath: `${planRun.planName.replace(/[^a-z0-9_-]+/gi, "-")}.${format === "json" ? "json" : "md"}`,
      filters: [
        format === "json"
          ? { name: "JSON report", extensions: ["json"] }
          : { name: "Markdown report", extensions: ["md"] },
      ],
    });
    if (!result.canceled && result.filePath) {
      await writeFile(result.filePath, contents, { encoding: "utf8", mode: 0o600 });
    }
  }

  async openArtifact(path: string): Promise<void> {
    const error = await shell.openPath(path);
    if (error) throw new Error(error);
  }

  revealArtifact(path: string): void {
    shell.showItemInFolder(path);
  }

  private async appendLog(run: TestRun, line: string): Promise<void> {
    if (this.activeRun?.id !== run.id) return;
    const safeLine = sanitizeText(line);
    run.log.push(safeLine);
    if (run.log.length > 500) run.log.shift();
    const progressEvent = parseRunProgressLine(safeLine);
    if (progressEvent) {
      run.progress.push(progressEvent);
      if (run.progress.length > 200) run.progress.shift();
    }
    await this.store.updateRun(run);
    this.emit({ type: "run-log", runId: run.id, line: safeLine });
    if (progressEvent) this.emit({ type: "run-progress", runId: run.id, event: progressEvent });
  }

  private async completeRun(
    run: TestRun,
    exitCode: number | null,
    error?: Error,
    artifactSecrets: string[] = [],
  ): Promise<void> {
    if (run.status === "ABORTED") return;
    await this.persistRememberedSession(run);
    run.finishedAt = new Date().toISOString();
    run.durationMs = new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime();
    run.reportPath = join(run.resultDirectory, "playwright-report", "index.html");
    run.error = error ? sanitizeText(error.message, artifactSecrets) : undefined;
    run.status = error ? "ERROR" : exitCode === 0 ? "PASSED" : "FAILED";
    const artifacts = await collectRunArtifacts(run.resultDirectory, run.status !== "PASSED").catch(
      () => undefined,
    );
    run.steps = (artifacts?.steps ?? []).map((step) => ({
      ...step,
      description: sanitizeText(step.description, artifactSecrets),
    }));
    run.videoPath = artifacts?.videoPath;
    run.log.push(
      error
        ? `Runner error: ${sanitizeText(error.message, artifactSecrets)}`
        : `Runner finished with exitcode ${exitCode ?? "unknown"}.`,
    );
    await sanitizeTextArtifacts(run.resultDirectory, artifactSecrets);
    await this.store.updateRun(run);
    await this.investigations.onRunFinished(run).catch(() => undefined);
    this.notifyRunFinished(run);
    if (this.activeRun?.id === run.id) this.activeRun = undefined;
    this.emit({ type: "run-finished", run: structuredClone(run) });
  }

  /** One notification per run, except inside a plan run: the plan reports once, when it ends. */
  private notifyRunFinished(run: TestRun): void {
    if (this.store.snapshot().testPlanRuns.some((planRun) => planRun.status === "RUNNING")) return;
    const outcome = { PASSED: "passed", FAILED: "failed", ERROR: "ended with an error" }[
      run.status as "PASSED" | "FAILED" | "ERROR"
    ];
    if (!outcome) return;
    this.notifier?.notify(
      "runFinished",
      `${run.testId} ${outcome}`,
      `${run.testName} on ${run.environmentName}`,
    );
  }

  private async persistRememberedSession(run: TestRun): Promise<void> {
    const authStatePath = join(run.resultDirectory, "auth-state.json");
    try {
      if (!this.rememberedSessionRuns.has(run.id)) return;
      const sessionState = await readFile(authStatePath, "utf8");
      validateStorageState(sessionState);
      await this.store.setSessionState(run.environmentId, sessionState);
      run.log.push("Microsoft session saved securely.");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        run.log.push("The Microsoft session could not be saved securely.");
      }
    } finally {
      this.rememberedSessionRuns.delete(run.id);
      await unlink(authStatePath).catch(() => undefined);
    }
  }

  private async refreshRuntime(): Promise<{ replayScript: string; workingDirectory: string }> {
    const bundled = this.resolveBundledRunnerPaths();
    const bundledPackagePath = app.isPackaged
      ? join(process.resourcesPath, "runner", "package.json")
      : join(this.workspaceDirectory, "runner-runtime", "package.json");
    const bundledReplayVersion = await readReplayVersion(bundledPackagePath);
    const runtime = await this.getRuntimeManager().inspect(bundled, bundledReplayVersion);
    const powershellExecutable = await resolvePowerShellExecutable();
    const replayAvailable = await pathExists(runtime.replayScript);
    this.diagnostics = {
      appVersion: app.getVersion(),
      platform: process.platform,
      nodeVersion: process.versions.node,
      replayExecutable: runtime.replayScript,
      replayAvailable,
      powershellAvailable: Boolean(powershellExecutable),
      powershellExecutable,
      dataDirectory: this.dataDirectory,
      workspaceDirectory: this.workspaceDirectory,
      storageRecoveredFromBackup: this.store.recoveredFromBackup,
      replayVersion: runtime.replayVersion,
      bundledReplayVersion: runtime.bundledReplayVersion,
      runtimeSource: runtime.source,
      runtimeCompatibility:
        replayAvailable && powershellExecutable ? runtime.compatibility : "incompatible",
      runtimeCompatibilityMessage: !replayAvailable
        ? "The selected replay runtime is incomplete. Roll back or install an approved package."
        : !powershellExecutable
          ? "PowerShell 7 is required before the replay runtime can be smoke-tested."
          : runtime.message,
      runtimeRollbackAvailable: runtime.rollbackAvailable,
      windowsAuthoritative: process.platform !== "win32",
    };
    this.replayRunner = new ReplayRunner({
      powershellExecutable: powershellExecutable ?? "pwsh",
      replayScript: runtime.replayScript,
      workingDirectory: runtime.workingDirectory,
    });
    return runtime;
  }

  private assertRuntimeIdle(): void {
    if (this.activeRun) {
      throw new Error("Stop the active run before changing the runtime.");
    }
  }

  private getRuntimeManager(): RuntimeManager {
    if (!this.runtimeManager) throw new Error("Runtime manager is not initialized.");
    return this.runtimeManager;
  }

  private resolveBundledRunnerPaths(): { replayScript: string; workingDirectory: string } {
    if (app.isPackaged) {
      const workingDirectory = join(process.resourcesPath, "runner");
      return {
        workingDirectory,
        replayScript:
          process.platform === "darwin"
            ? join(workingDirectory, "Replay.mac.ps1")
            : join(workingDirectory, "node_modules", "@microsoft", "bc-replay", "Replay.ps1"),
      };
    }
    if (process.platform === "darwin") {
      return {
        workingDirectory: this.workspaceDirectory,
        replayScript: join(this.workspaceDirectory, "runner-runtime", "Replay.mac.ps1"),
      };
    }
    return {
      workingDirectory: this.workspaceDirectory,
      replayScript: join(
        this.workspaceDirectory,
        "node_modules",
        "@microsoft",
        "bc-replay",
        "Replay.ps1",
      ),
    };
  }
}

async function readReplayVersion(packagePath: string): Promise<string | undefined> {
  try {
    const parsed = JSON.parse(await readFile(packagePath, "utf8")) as {
      dependencies?: Record<string, unknown>;
    };
    const value = parsed.dependencies?.["@microsoft/bc-replay"];
    return typeof value === "string" ? value : undefined;
  } catch {
    return undefined;
  }
}

function slugify(value: string): string {
  return (
    value
      .normalize("NFKD")
      .replace(/[^A-Za-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || `TEST-${createHash("sha1").update(value).digest("hex").slice(0, 6)}`
  );
}

function timestamp(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

function maskSecretParameters(
  values: Record<string, string | number | boolean>,
  secretNames: string[],
): Record<string, string | number | boolean> {
  return Object.fromEntries(
    Object.entries(values).map(([name, value]) => [
      name,
      secretNames.includes(name) ? "••••••••" : value,
    ]),
  );
}
