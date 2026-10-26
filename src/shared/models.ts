export type EnvironmentType = "sandbox" | "uat" | "docker" | "production";
export type AuthenticationMode = "Windows" | "AAD" | "UserPassword";
export type RiskLevel = "read-only" | "reversible" | "destructive";
export type RunStatus =
  | "QUEUED"
  | "RUNNING"
  | "PASSED"
  | "FAILED"
  | "BLOCKED"
  | "ABORTED"
  | "ERROR";

export interface Customer {
  id: string;
  code: string;
  name: string;
  active: boolean;
  archivedAt?: string;
}

export interface TestGroup {
  id: string;
  name: string;
  customerId?: string;
  system: boolean;
  archivedAt?: string;
}

import type { DataCategory, DataDeletionResult } from "./data-categories";
import type { McpStatus } from "./mcp-tools";
import type { NotificationSettings } from "./notifications";
import type { PlanSchedule } from "./schedule";

export type AgentKind = "claude-code" | "codex" | "other";

/** The AL code behind one environment. `codePath` is local to this device. */
export interface Project {
  id: string;
  environmentId: string;
  name: string;
  description?: string;
  codePath?: string;
  agent: AgentKind;
  instructions?: string;
  archivedAt?: string;
}

export interface ProjectInput {
  id?: string;
  environmentId: string;
  name: string;
  description?: string;
  codePath?: string;
  agent: AgentKind;
  instructions?: string;
}

export interface ProjectInspection {
  exists: boolean;
  isGitRepository: boolean;
  /** The repository root, when the chosen folder is inside a repository rather than at its top. */
  gitRoot?: string;
  branch?: string;
  apps: Array<{ name: string; version: string; path: string }>;
}

export type InvestigationStatus =
  | "PACKAGE_READY"
  | "HANDED_OFF"
  | "PLAN_RECEIVED"
  | "CHANGES_REQUESTED"
  | "APPROVED"
  | "CHANGE_APPLIED"
  | "RETEST_FAILED"
  | "VERIFIED"
  | "ABANDONED";

export interface InvestigationChange {
  summary: string;
  branch: string;
  commit?: string;
  files: string[];
  reportedAt: string;
}

export interface InvestigationIteration {
  number: number;
  agent: AgentKind;
  runId: string;
  handedOffAt?: string;
  planMarkdown?: string;
  planReceivedAt?: string;
  decision?: "approved" | "changes-requested";
  decisionNote?: string;
  decidedAt?: string;
  change?: InvestigationChange;
  retestRunIds: string[];
  result?: "PASSED" | "FAILED";
}

export interface Investigation {
  id: string;
  number: number;
  runId: string;
  testDefinitionId: string;
  projectId: string;
  status: InvestigationStatus;
  includeEvidence: boolean;
  exportedPath?: string;
  createdAt: string;
  updatedAt: string;
  iterations: InvestigationIteration[];
}

export interface InvestigationInput {
  runId: string;
  projectId: string;
  includeEvidence: boolean;
}

export interface InvestigationDecisionInput {
  id: string;
  decision: "approved" | "changes-requested";
  note?: string;
}

export interface InvestigationChangeInput {
  id: string;
  summary: string;
  branch: string;
  commit?: string;
  files: string[];
}

export interface TestPlan {
  id: string;
  name: string;
  customerId: string;
  environmentId: string;
  testDefinitionIds: string[];
  parameterProfileIds?: Record<string, string>;
  archivedAt?: string;
  /** Run this plan by itself, while Test Suite is open. Absent means manual only. */
  schedule?: PlanSchedule;
  /** The last scheduled moment that was started, skipped or turned into a reminder. */
  scheduleHandledAt?: string;
  /** A scheduled moment that waits for the user: review it, or it was missed. */
  schedulePending?: { occurrence: string; reason: "review" | "missed"; detail?: string };
}

export type TestPlanRunStatus = "RUNNING" | "PASSED" | "FAILED" | "ABORTED";

export interface TestPlanRunItem {
  sequence: number;
  testDefinitionId: string;
  testId: string;
  testName: string;
  runId: string;
  status: RunStatus;
  startedAt: string;
  finishedAt?: string;
}

export interface TestPlanRun {
  id: string;
  testPlanId: string;
  planName: string;
  customerId: string;
  environmentId: string;
  status: TestPlanRunStatus;
  startedAt: string;
  finishedAt?: string;
  items: TestPlanRunItem[];
  /** The exact tests of this run, in order. Absent on runs made before resuming existed. */
  testDefinitionIds?: string[];
  /** The plan run this one continues after a failure. */
  resumedFromId?: string;
  /** A run without a saved plan, such as the regression check of an investigation. */
  adHoc?: boolean;
  /** Started by the plan's schedule rather than by hand. */
  scheduled?: boolean;
}

export interface BeginTestPlanRunInput {
  /** A plan id, or "regression:<investigation id>" for a run without a saved plan. */
  planId: string;
  testDefinitionIds?: string[];
  resumedFromId?: string;
  /** Used for runs without a saved plan. */
  name?: string;
  environmentId?: string;
  /** The scheduled moment this run answers, when the schedule started it. */
  scheduledFor?: string;
}

export interface BcEnvironment {
  id: string;
  customerId: string;
  tenantId: string;
  name: string;
  company: string;
  type: EnvironmentType;
  baseUrl: string;
  authentication: AuthenticationMode;
  username?: string;
  hasCredential: boolean;
  hasRememberedSession?: boolean;
  active: boolean;
  archivedAt?: string;
}

export interface TestParameter {
  name: string;
  type: "string" | "number" | "boolean";
  description?: string;
  defaultValue?: string | number | boolean;
  required: boolean;
  secret: boolean;
}

export interface TestDefinition {
  id: string;
  testId: string;
  name: string;
  description?: string;
  customerId?: string;
  groupId: string;
  recordingPath: string;
  risk: RiskLevel;
  forbiddenActions: string[];
  tags: string[];
  allowedEnvironmentTypes: EnvironmentType[];
  parameters: TestParameter[];
  versionHash: string;
  importedAt: string;
  projectIds?: string[];
  archivedAt?: string;
}

export interface StepResult {
  sequence: number;
  status: RunStatus;
  description: string;
  durationMs?: number;
  screenshotPath?: string;
}

export interface TestRun {
  id: string;
  testId: string;
  testDefinitionId: string;
  testName: string;
  environmentId: string;
  environmentName: string;
  customerCode: string;
  initiatedBy?: "user" | "ai-agent";
  status: RunStatus;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  parameters: Record<string, string | number | boolean>;
  versionHash: string;
  resultDirectory: string;
  reportPath?: string;
  videoPath?: string;
  error?: string;
  log: string[];
  progress: RunProgressEvent[];
  steps: StepResult[];
}

export type RunProgressKind =
  | "runner-started"
  | "target-selected"
  | "browser-ready"
  | "authentication-required"
  | "authentication-complete"
  | "replay-started"
  | "step-started"
  | "warning"
  | "error"
  | "completed"
  | "update";

export interface RunProgressEvent {
  kind: RunProgressKind;
  title: string;
  detail: string;
  tone: "neutral" | "success" | "warning" | "error";
  occurredAt: string;
}

export interface ParameterProfile {
  id: string;
  testDefinitionId: string;
  /** A profile for one environment. Without one it applies everywhere (older profiles). */
  environmentId?: string;
  name: string;
  values: Record<string, string | number | boolean>;
  updatedAt: string;
}

export interface ParameterProfileInput {
  testDefinitionId: string;
  environmentId?: string;
  name: string;
  values: Record<string, string | number | boolean>;
}

export interface RuntimeDiagnostics {
  appVersion: string;
  platform: NodeJS.Platform;
  nodeVersion: string;
  replayExecutable: string;
  replayAvailable: boolean;
  powershellAvailable: boolean;
  powershellExecutable?: string;
  dataDirectory: string;
  workspaceDirectory: string;
  storageRecoveredFromBackup: boolean;
  replayVersion?: string;
  bundledReplayVersion?: string;
  runtimeSource: "bundled" | "managed";
  runtimeCompatibility: "compatible" | "unverified" | "incompatible";
  runtimeCompatibilityMessage: string;
  runtimeRollbackAvailable: boolean;
  windowsAuthoritative: boolean;
}

export interface AppState {
  schemaVersion?: number;
  settings: AppSettings;
  customers: Customer[];
  testGroups: TestGroup[];
  testPlans: TestPlan[];
  testPlanRuns: TestPlanRun[];
  environments: BcEnvironment[];
  projects: Project[];
  investigations: Investigation[];
  tests: TestDefinition[];
  runs: TestRun[];
  parameterProfiles: ParameterProfile[];
  mcpApprovals: McpApprovalRequest[];
}

export interface AppSettings {
  stepDelayMs: number;
  textSize: "extra-small" | "small" | "medium" | "large";
  runRetentionDays: number;
  notifications: NotificationSettings;
  /** Your own coding agent. Local to this device: never part of a workspace backup. */
  customAgent?: CustomAgentSettings;
}

export interface AppSettingsInput {
  stepDelayMs: number;
  textSize: "extra-small" | "small" | "medium" | "large";
  runRetentionDays: number;
  notifications: NotificationSettings;
  customAgent?: CustomAgentSettings;
}

/** The program and fixed arguments for the agent kind "other". The prompt goes on stdin. */
export interface CustomAgentSettings {
  executable: string;
  args: string[];
}

export interface AppSnapshot extends AppState {
  diagnostics: RuntimeDiagnostics;
  activeRunId?: string;
  mcpApprovals: McpApprovalRequest[];
  mcpStatus: McpStatus;
}

export type McpApprovalAction = "create-test" | "start-test" | "stop-test";
export type McpApprovalStatus = "PENDING" | "APPROVED" | "REJECTED" | "COMPLETED" | "FAILED";

export interface McpApprovalRequest {
  id: string;
  action: McpApprovalAction;
  title: string;
  detail: string;
  status: McpApprovalStatus;
  requestedAt: string;
  resolvedAt?: string;
  result?: { testDefinitionId?: string; runId?: string };
  error?: string;
}

export interface McpCreateTestInput {
  groupId: string;
  testId: string;
  name: string;
  description?: string;
  yaml: string;
  risk: RiskLevel;
  forbiddenActions: string[];
  tags: string[];
  allowedEnvironmentTypes: EnvironmentType[];
}

export interface EnvironmentInput {
  id?: string;
  customerId?: string;
  customerCode: string;
  customerName: string;
  tenantId: string;
  name: string;
  company: string;
  type: EnvironmentType;
  baseUrl: string;
  authentication: AuthenticationMode;
  username?: string;
  password?: string;
}

export interface ImportedTestInput {
  groupId: string;
  testId?: string;
  risk?: RiskLevel;
  tags?: string[];
  allowedEnvironmentTypes?: EnvironmentType[];
}

export interface CustomerInput {
  id?: string;
  code: string;
  name: string;
}

export interface TestGroupInput {
  id?: string;
  customerId: string;
  name: string;
}

export interface TestDefinitionInput {
  id: string;
  groupId: string;
  name: string;
  description?: string;
  risk: RiskLevel;
  forbiddenActions: string[];
  tags: string[];
  projectIds: string[];
}

export interface TestPlanInput {
  id?: string;
  name: string;
  customerId: string;
  environmentId: string;
  testDefinitionIds: string[];
  parameterProfileIds?: Record<string, string>;
  schedule?: PlanSchedule;
}

export interface StartRunInput {
  testDefinitionId: string;
  environmentId: string;
  parameters: Record<string, string | number | boolean>;
  confirmRisk: boolean;
  manualMfa: boolean;
  rememberSession: boolean;
}

export type RunnerEvent =
  | { type: "run-started"; run: TestRun }
  | { type: "run-updated"; run: TestRun }
  | { type: "run-log"; runId: string; line: string }
  | { type: "run-progress"; runId: string; event: RunProgressEvent }
  | { type: "run-finished"; run: TestRun }
  | { type: "mcp-approvals-updated" }
  | { type: "investigations-updated" }
  | { type: "schedule-due"; planId: string; occurrence: string }
  | { type: "menu-action"; action: string }
  | { type: "agent-log"; investigationId: string; line: string }
  | { type: "agent-finished"; investigationId: string; ok: boolean; message: string };

export interface BcFlowApi {
  getSnapshot(): Promise<AppSnapshot>;
  saveSettings(input: AppSettingsInput): Promise<AppSnapshot>;
  saveParameterProfile(input: ParameterProfileInput): Promise<AppSnapshot>;
  exportWorkspace(): Promise<void>;
  importWorkspace(): Promise<AppSnapshot>;
  setEntityArchived(
    kind: "customer" | "test-group" | "environment" | "test-plan" | "project",
    id: string,
    archived: boolean,
  ): Promise<AppSnapshot>;
  saveEnvironment(input: EnvironmentInput): Promise<AppSnapshot>;
  saveProject(input: ProjectInput): Promise<AppSnapshot>;
  chooseProjectFolder(): Promise<{ path: string; inspection: ProjectInspection } | undefined>;
  chooseAgentExecutable(): Promise<string | undefined>;
  inspectProject(projectId: string): Promise<ProjectInspection>;
  createInvestigation(input: InvestigationInput): Promise<AppSnapshot>;
  getInvestigationPrompt(id: string, agent: AgentKind): Promise<string>;
  copyInvestigationPrompt(id: string, agent: AgentKind): Promise<AppSnapshot>;
  exportInvestigationPackage(id: string): Promise<AppSnapshot>;
  revealInvestigation(id: string): Promise<void>;
  importAgentOutput(id: string): Promise<AppSnapshot>;
  decideInvestigation(input: InvestigationDecisionInput): Promise<AppSnapshot>;
  recordInvestigationChange(input: InvestigationChangeInput): Promise<AppSnapshot>;
  startNextInvestigationRound(id: string): Promise<AppSnapshot>;
  abandonInvestigation(id: string): Promise<AppSnapshot>;
  startInvestigationAgent(id: string): Promise<boolean>;
  stopInvestigationAgent(): Promise<void>;
  saveCustomer(input: CustomerInput): Promise<AppSnapshot>;
  deleteCustomer(id: string): Promise<AppSnapshot>;
  saveTestGroup(input: TestGroupInput): Promise<AppSnapshot>;
  deleteTestGroup(id: string): Promise<AppSnapshot>;
  deleteEnvironment(id: string): Promise<AppSnapshot>;
  checkEnvironment(
    id: string,
  ): Promise<{ ok: boolean; status?: number; latencyMs: number; message: string }>;
  forgetSession(environmentId: string): Promise<AppSnapshot>;
  readArtifact(path: string): Promise<string>;
  selectAndImportTest(input: ImportedTestInput): Promise<AppSnapshot>;
  selectAndUpdateTest(testId: string): Promise<AppSnapshot>;
  saveTest(input: TestDefinitionInput): Promise<AppSnapshot>;
  deleteTest(id: string, withHistory?: boolean): Promise<AppSnapshot>;
  deleteData(
    categories: DataCategory[],
  ): Promise<{ snapshot: AppSnapshot; result: DataDeletionResult }>;
  setTestArchived(id: string, archived: boolean): Promise<AppSnapshot>;
  saveTestPlan(input: TestPlanInput): Promise<AppSnapshot>;
  deleteTestPlan(id: string): Promise<AppSnapshot>;
  beginTestPlanRun(
    input: BeginTestPlanRunInput,
  ): Promise<{ snapshot: AppSnapshot; planRunId: string }>;
  recordTestPlanRunResult(planRunId: string, runId: string): Promise<AppSnapshot>;
  abortTestPlanRun(planRunId: string): Promise<AppSnapshot>;
  dismissSchedulePending(planId: string): Promise<AppSnapshot>;
  exportTestPlanRun(planRunId: string, format: "markdown" | "json"): Promise<void>;
  startRun(input: StartRunInput): Promise<TestRun>;
  stopRun(): Promise<void>;
  deleteRun(id: string): Promise<AppSnapshot>;
  exportRun(id: string, format: "markdown" | "json"): Promise<void>;
  resolveMcpApproval(id: string, approved: boolean): Promise<AppSnapshot>;
  copyMcpSetup(client: "codex" | "claude-desktop"): Promise<void>;
  installRuntimeUpdate(): Promise<AppSnapshot>;
  rollbackRuntime(): Promise<AppSnapshot>;
  checkRuntimeCompatibility(): Promise<AppSnapshot>;
  openArtifact(path: string): Promise<void>;
  revealArtifact(path: string): Promise<void>;
  onRunnerEvent(callback: (event: RunnerEvent) => void): () => void;
}
