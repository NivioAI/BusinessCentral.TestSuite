import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { is } from "@electron-toolkit/utils";
import { net, BrowserWindow, Menu, app, ipcMain, protocol, screen, shell } from "electron";
import { IPC } from "../shared/channels";
import type {
  AgentKind,
  AppSettingsInput,
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
import { buildMenuTemplate } from "./app-menu";
import { AppController } from "./controller";
import { McpBridge } from "./mcp-bridge";
import { JsonStore, storePaths } from "./store";

// The name users see. The data folder keeps the name it always had, so nothing is lost: a
// packaged build used to be called NIVIO Test Studio, and its data lives under that name.
const APP_NAME = "NIVIO Test Suite";
const LEGACY_DATA_FOLDER = "NIVIO Test Studio";
const dataFolder = app.isPackaged
  ? join(app.getPath("appData"), LEGACY_DATA_FOLDER)
  : app.getPath("userData");
app.setName(APP_NAME);
app.setPath("userData", dataFolder);

let mainWindow: BrowserWindow | undefined;
let controller: AppController | undefined;
let mcpBridge: McpBridge | undefined;

protocol.registerSchemesAsPrivileged([
  {
    scheme: "bcft-artifact",
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
]);

function createWindow(): void {
  const developmentIcon = app.isPackaged ? undefined : join(app.getAppPath(), "build", "icon.png");
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 760,
    minHeight: 720,
    show: false,
    backgroundColor: "#fefdf6",
    icon: developmentIcon,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    trafficLightPosition: process.platform === "darwin" ? { x: 18, y: 18 } : undefined,
    maximizable: true,
    fullscreenable: true,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow?.maximize();
    mainWindow?.show();
  });
  if (is.dev) {
    mainWindow.webContents.on("console-message", (_event, level, message) => {
      console.log(`[renderer:${level}] ${message}`);
    });
    mainWindow.webContents.on("did-fail-load", (_event, code, description) => {
      console.error(`Renderer failed to load (${code}): ${description}`);
    });
  }
  const screenshotPath = process.env.BCFT_SCREENSHOT_PATH;
  if (is.dev && screenshotPath) {
    mainWindow.webContents.once("did-finish-load", () => {
      setTimeout(() => {
        void mainWindow?.webContents
          .capturePage()
          .then((image) => writeFile(screenshotPath, image.toPNG()));
        void mainWindow?.webContents
          .executeJavaScript("document.body.innerText")
          .then((text) => console.log(`[smoke] ${String(text).slice(0, 500)}`));
      }, 750);
    });
  }
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://") || url.startsWith("http://")) void shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    const current = mainWindow?.webContents.getURL();
    if (current && url !== current) event.preventDefault();
  });

  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

function registerIpc(): void {
  const getController = (): AppController => {
    if (!controller) throw new Error("The application is not initialized yet.");
    return controller;
  };
  ipcMain.handle(IPC.snapshot, () => getController().snapshot());
  ipcMain.handle(IPC.saveSettings, (_event, input: AppSettingsInput) =>
    getController().saveSettings(input),
  );
  ipcMain.handle(IPC.saveParameterProfile, (_event, input: ParameterProfileInput) =>
    getController().saveParameterProfile(input),
  );
  ipcMain.handle(IPC.exportWorkspace, () => getController().exportWorkspace());
  ipcMain.handle(IPC.importWorkspace, () => getController().importWorkspace());
  ipcMain.handle(
    IPC.archiveEntity,
    (
      _event,
      kind: "customer" | "test-group" | "environment" | "test-plan" | "project",
      id: string,
      archived: boolean,
    ) => getController().setEntityArchived(kind, id, archived),
  );
  ipcMain.handle(IPC.saveEnvironment, (_event, input: EnvironmentInput) =>
    getController().saveEnvironment(input),
  );
  ipcMain.handle(IPC.saveProject, (_event, input: ProjectInput) =>
    getController().saveProject(input),
  );
  ipcMain.handle(IPC.chooseProjectFolder, () => getController().chooseProjectFolder());
  ipcMain.handle(IPC.chooseAgentExecutable, () => getController().chooseAgentExecutable());
  ipcMain.handle(IPC.inspectProject, (_event, id: string) => getController().inspectProject(id));
  ipcMain.handle(IPC.createInvestigation, (_event, input: InvestigationInput) =>
    getController().createInvestigation(input),
  );
  ipcMain.handle(IPC.getInvestigationPrompt, (_event, id: string, agent: AgentKind) =>
    getController().getInvestigationPrompt(id, agent),
  );
  ipcMain.handle(IPC.copyInvestigationPrompt, (_event, id: string, agent: AgentKind) =>
    getController().copyInvestigationPrompt(id, agent),
  );
  ipcMain.handle(IPC.exportInvestigationPackage, (_event, id: string) =>
    getController().exportInvestigationPackage(id),
  );
  ipcMain.handle(IPC.revealInvestigation, (_event, id: string) =>
    getController().revealInvestigation(id),
  );
  ipcMain.handle(IPC.importAgentOutput, (_event, id: string) =>
    getController().importAgentOutput(id),
  );
  ipcMain.handle(IPC.decideInvestigation, (_event, input: InvestigationDecisionInput) =>
    getController().decideInvestigation(input),
  );
  ipcMain.handle(IPC.recordInvestigationChange, (_event, input: InvestigationChangeInput) =>
    getController().recordInvestigationChange(input),
  );
  ipcMain.handle(IPC.startNextInvestigationRound, (_event, id: string) =>
    getController().startNextInvestigationRound(id),
  );
  ipcMain.handle(IPC.abandonInvestigation, (_event, id: string) =>
    getController().abandonInvestigation(id),
  );
  ipcMain.handle(IPC.dismissSchedulePending, (_event, planId: string) =>
    getController().dismissSchedulePending(planId),
  );
  ipcMain.handle(IPC.startInvestigationAgent, (_event, id: string) =>
    getController().startInvestigationAgent(id),
  );
  ipcMain.handle(IPC.stopInvestigationAgent, () => getController().stopInvestigationAgent());
  ipcMain.handle(IPC.saveCustomer, (_event, input: CustomerInput) =>
    getController().saveCustomer(input),
  );
  ipcMain.handle(IPC.deleteCustomer, (_event, id: string) => getController().deleteCustomer(id));
  ipcMain.handle(IPC.saveTestGroup, (_event, input: TestGroupInput) =>
    getController().saveTestGroup(input),
  );
  ipcMain.handle(IPC.deleteTestGroup, (_event, id: string) => getController().deleteTestGroup(id));
  ipcMain.handle(IPC.deleteEnvironment, (_event, id: string) =>
    getController().deleteEnvironment(id),
  );
  ipcMain.handle(IPC.checkEnvironment, (_event, id: string) =>
    getController().checkEnvironment(id),
  );
  ipcMain.handle(IPC.forgetSession, (_event, environmentId: string) =>
    getController().forgetSession(environmentId),
  );
  ipcMain.handle(IPC.readArtifact, (_event, path: string) => getController().readArtifact(path));
  ipcMain.handle(IPC.importTest, (_event, input: ImportedTestInput) =>
    getController().selectAndImportTest(input),
  );
  ipcMain.handle(IPC.updateTestRecording, (_event, testId: string) =>
    getController().selectAndUpdateTest(testId),
  );
  ipcMain.handle(IPC.saveTest, (_event, input: TestDefinitionInput) =>
    getController().saveTest(input),
  );
  ipcMain.handle(IPC.deleteTest, (_event, id: string, withHistory?: boolean) =>
    getController().deleteTest(id, withHistory),
  );
  ipcMain.handle(IPC.deleteData, (_event, input: unknown) => getController().deleteData(input));
  ipcMain.handle(IPC.archiveTest, (_event, id: string, archived: boolean) =>
    getController().setTestArchived(id, archived),
  );
  ipcMain.handle(IPC.saveTestPlan, (_event, input: TestPlanInput) =>
    getController().saveTestPlan(input),
  );
  ipcMain.handle(IPC.deleteTestPlan, (_event, id: string) => getController().deleteTestPlan(id));
  ipcMain.handle(IPC.beginTestPlanRun, (_event, input: unknown) =>
    getController().beginTestPlanRun(input),
  );
  ipcMain.handle(IPC.recordTestPlanRunResult, (_event, planRunId: string, runId: string) =>
    getController().recordTestPlanRunResult(planRunId, runId),
  );
  ipcMain.handle(IPC.abortTestPlanRun, (_event, planRunId: string) =>
    getController().abortTestPlanRun(planRunId),
  );
  ipcMain.handle(IPC.exportTestPlanRun, (_event, planRunId: string, format: "markdown" | "json") =>
    getController().exportTestPlanRun(planRunId, format),
  );
  ipcMain.handle(IPC.startRun, (_event, input: StartRunInput) => getController().startRun(input));
  ipcMain.handle(IPC.stopRun, () => getController().stopRun());
  ipcMain.handle(IPC.deleteRun, (_event, id: string) => getController().deleteRun(id));
  ipcMain.handle(IPC.exportRun, (_event, id: string, format: "markdown" | "json") =>
    getController().exportRun(id, format),
  );
  ipcMain.handle(IPC.resolveMcpApproval, (_event, id: string, approved: boolean) =>
    getController().resolveMcpApproval(id, approved),
  );
  ipcMain.handle(IPC.copyMcpSetup, (_event, client: "codex" | "claude-desktop") =>
    getController().copyMcpSetup(client),
  );
  ipcMain.handle(IPC.installRuntimeUpdate, () => getController().installRuntimeUpdate());
  ipcMain.handle(IPC.rollbackRuntime, () => getController().rollbackRuntime());
  ipcMain.handle(IPC.checkRuntimeCompatibility, () => getController().checkRuntimeCompatibility());
  ipcMain.handle(IPC.openArtifact, (_event, path: string) => getController().openArtifact(path));
  ipcMain.handle(IPC.revealArtifact, (_event, path: string) =>
    getController().revealArtifact(path),
  );
}

app.whenReady().then(async () => {
  app.setAppUserModelId("ai.nivio.bcflowtester");
  app.setAboutPanelOptions({
    applicationName: APP_NAME,
    applicationVersion: app.getVersion(),
    copyright: "© NIVIO",
    credits: "Runs Business Central Page Scripts visibly and keeps the evidence on this device.",
  });
  if (!app.isPackaged && process.platform === "darwin") {
    app.dock.setIcon(join(app.getAppPath(), "build", "icon.png"));
  }
  const paths = storePaths(app.getPath("userData"));
  const store = new JsonStore(paths.statePath, paths.secretsPath);
  controller = new AppController(
    store,
    app.getPath("userData"),
    app.getAppPath(),
    (event: RunnerEvent) => {
      mainWindow?.webContents.send(IPC.runnerEvent, event);
    },
  );
  await controller.initialize();
  const menuController = controller;
  Menu.setApplicationMenu(
    Menu.buildFromTemplate(
      buildMenuTemplate({
        appName: APP_NAME,
        isMac: process.platform === "darwin",
        isDev: is.dev,
        send: (action) =>
          mainWindow?.webContents.send(IPC.runnerEvent, { type: "menu-action", action }),
        stopRun: () => void menuController.stopRun(),
        openDataFolder: () => void shell.openPath(app.getPath("userData")),
        showAbout: () => app.showAboutPanel(),
      }),
    ),
  );
  const bridge = new McpBridge(
    controller,
    join(app.getPath("userData"), "mcp-connection.json"),
    () => controller?.notifyMcpCall(),
  );
  mcpBridge = bridge;
  controller.startScheduler();
  controller.setMcpStatusProvider(() => bridge.status());
  await bridge.start();
  protocol.handle("bcft-artifact", (request) => {
    const artifactUrl = new URL(request.url);
    let path = decodeURIComponent(artifactUrl.pathname);
    if (process.platform === "win32" && /^\/[A-Za-z]:/.test(path)) path = path.slice(1);
    if (!controller?.isArtifactAllowed(path)) {
      return new Response("Artifact not found", { status: 404 });
    }
    return net.fetch(pathToFileURL(path).toString());
  });
  registerIpc();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  controller?.stopScheduler();
  void controller?.stopInvestigationAgent();
  void mcpBridge?.close();
});

app.on("before-quit", (event) => {
  if (!controller?.snapshot().activeRunId) return;
  event.preventDefault();
  void controller.stopRun().finally(() => app.exit());
});
