import { contextBridge, ipcRenderer } from "electron";
import { IPC } from "../shared/channels";
import type { DataCategory } from "../shared/data-categories";
import type {
  AgentKind,
  AppSettingsInput,
  BcFlowApi,
  BeginTestPlanRunInput,
  CustomerInput,
  EnvironmentInput,
  ImportedTestInput,
  InvestigationChangeInput,
  InvestigationDecisionInput,
  InvestigationInput,
  ParameterProfileInput,
  ProjectInput,
  RunnerEvent,
  StartRunInput,
  TestDefinitionInput,
  TestGroupInput,
  TestPlanInput,
} from "../shared/models";

const api: BcFlowApi = {
  getSnapshot: () => ipcRenderer.invoke(IPC.snapshot),
  saveSettings: (input: AppSettingsInput) => ipcRenderer.invoke(IPC.saveSettings, input),
  saveParameterProfile: (input: ParameterProfileInput) =>
    ipcRenderer.invoke(IPC.saveParameterProfile, input),
  exportWorkspace: () => ipcRenderer.invoke(IPC.exportWorkspace),
  importWorkspace: () => ipcRenderer.invoke(IPC.importWorkspace),
  setEntityArchived: (kind, id, archived) =>
    ipcRenderer.invoke(IPC.archiveEntity, kind, id, archived),
  saveEnvironment: (input: EnvironmentInput) => ipcRenderer.invoke(IPC.saveEnvironment, input),
  saveCustomer: (input: CustomerInput) => ipcRenderer.invoke(IPC.saveCustomer, input),
  deleteCustomer: (id: string) => ipcRenderer.invoke(IPC.deleteCustomer, id),
  saveTestGroup: (input: TestGroupInput) => ipcRenderer.invoke(IPC.saveTestGroup, input),
  deleteTestGroup: (id: string) => ipcRenderer.invoke(IPC.deleteTestGroup, id),
  deleteEnvironment: (id: string) => ipcRenderer.invoke(IPC.deleteEnvironment, id),
  checkEnvironment: (id: string) => ipcRenderer.invoke(IPC.checkEnvironment, id),
  forgetSession: (environmentId: string) => ipcRenderer.invoke(IPC.forgetSession, environmentId),
  readArtifact: (path: string) => ipcRenderer.invoke(IPC.readArtifact, path),
  selectAndImportTest: (input: ImportedTestInput) => ipcRenderer.invoke(IPC.importTest, input),
  selectAndUpdateTest: (testId: string) => ipcRenderer.invoke(IPC.updateTestRecording, testId),
  saveProject: (input: ProjectInput) => ipcRenderer.invoke(IPC.saveProject, input),
  chooseProjectFolder: () => ipcRenderer.invoke(IPC.chooseProjectFolder),
  chooseAgentExecutable: () => ipcRenderer.invoke(IPC.chooseAgentExecutable),
  inspectProject: (projectId: string) => ipcRenderer.invoke(IPC.inspectProject, projectId),
  createInvestigation: (input: InvestigationInput) =>
    ipcRenderer.invoke(IPC.createInvestigation, input),
  getInvestigationPrompt: (id: string, agent: AgentKind) =>
    ipcRenderer.invoke(IPC.getInvestigationPrompt, id, agent),
  copyInvestigationPrompt: (id: string, agent: AgentKind) =>
    ipcRenderer.invoke(IPC.copyInvestigationPrompt, id, agent),
  exportInvestigationPackage: (id: string) =>
    ipcRenderer.invoke(IPC.exportInvestigationPackage, id),
  revealInvestigation: (id: string) => ipcRenderer.invoke(IPC.revealInvestigation, id),
  importAgentOutput: (id: string) => ipcRenderer.invoke(IPC.importAgentOutput, id),
  decideInvestigation: (input: InvestigationDecisionInput) =>
    ipcRenderer.invoke(IPC.decideInvestigation, input),
  recordInvestigationChange: (input: InvestigationChangeInput) =>
    ipcRenderer.invoke(IPC.recordInvestigationChange, input),
  startNextInvestigationRound: (id: string) =>
    ipcRenderer.invoke(IPC.startNextInvestigationRound, id),
  abandonInvestigation: (id: string) => ipcRenderer.invoke(IPC.abandonInvestigation, id),
  dismissSchedulePending: (planId: string) =>
    ipcRenderer.invoke(IPC.dismissSchedulePending, planId),
  startInvestigationAgent: (id: string) => ipcRenderer.invoke(IPC.startInvestigationAgent, id),
  stopInvestigationAgent: () => ipcRenderer.invoke(IPC.stopInvestigationAgent),
  saveTest: (input: TestDefinitionInput) => ipcRenderer.invoke(IPC.saveTest, input),
  deleteTest: (id: string, withHistory?: boolean) =>
    ipcRenderer.invoke(IPC.deleteTest, id, withHistory),
  deleteData: (categories: DataCategory[]) => ipcRenderer.invoke(IPC.deleteData, { categories }),
  setTestArchived: (id: string, archived: boolean) =>
    ipcRenderer.invoke(IPC.archiveTest, id, archived),
  saveTestPlan: (input: TestPlanInput) => ipcRenderer.invoke(IPC.saveTestPlan, input),
  deleteTestPlan: (id: string) => ipcRenderer.invoke(IPC.deleteTestPlan, id),
  beginTestPlanRun: (input: BeginTestPlanRunInput) =>
    ipcRenderer.invoke(IPC.beginTestPlanRun, input),
  recordTestPlanRunResult: (planRunId: string, runId: string) =>
    ipcRenderer.invoke(IPC.recordTestPlanRunResult, planRunId, runId),
  abortTestPlanRun: (planRunId: string) => ipcRenderer.invoke(IPC.abortTestPlanRun, planRunId),
  exportTestPlanRun: (planRunId: string, format: "markdown" | "json") =>
    ipcRenderer.invoke(IPC.exportTestPlanRun, planRunId, format),
  startRun: (input: StartRunInput) => ipcRenderer.invoke(IPC.startRun, input),
  stopRun: () => ipcRenderer.invoke(IPC.stopRun),
  deleteRun: (id: string) => ipcRenderer.invoke(IPC.deleteRun, id),
  exportRun: (id: string, format: "markdown" | "json") =>
    ipcRenderer.invoke(IPC.exportRun, id, format),
  resolveMcpApproval: (id: string, approved: boolean) =>
    ipcRenderer.invoke(IPC.resolveMcpApproval, id, approved),
  copyMcpSetup: (client: "codex" | "claude-desktop") =>
    ipcRenderer.invoke(IPC.copyMcpSetup, client),
  installRuntimeUpdate: () => ipcRenderer.invoke(IPC.installRuntimeUpdate),
  rollbackRuntime: () => ipcRenderer.invoke(IPC.rollbackRuntime),
  checkRuntimeCompatibility: () => ipcRenderer.invoke(IPC.checkRuntimeCompatibility),
  openArtifact: (path: string) => ipcRenderer.invoke(IPC.openArtifact, path),
  revealArtifact: (path: string) => ipcRenderer.invoke(IPC.revealArtifact, path),
  onRunnerEvent: (callback: (event: RunnerEvent) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: RunnerEvent): void =>
      callback(payload);
    ipcRenderer.on(IPC.runnerEvent, listener);
    return () => ipcRenderer.removeListener(IPC.runnerEvent, listener);
  },
};

contextBridge.exposeInMainWorld("bcFlow", api);
