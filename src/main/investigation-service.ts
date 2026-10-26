import { constants, access, mkdir, readFile, readdir, stat } from "node:fs/promises";
import { extname, isAbsolute, join, relative } from "node:path";
import { AppError } from "../shared/app-error";
import { branchName } from "../shared/branch-name";
import { NEEDS_USER_STATUSES } from "../shared/investigation-status";
import type {
  AgentKind,
  Investigation,
  InvestigationChange,
  InvestigationChangeInput,
  InvestigationDecisionInput,
  InvestigationInput,
  InvestigationStatus,
  Project,
  ProjectInspection,
  TestRun,
} from "../shared/models";
import { type BriefContext, agentPrompt } from "./agent-brief";
import {
  type AgentRunRequest,
  type AgentStage,
  extractChangeJson,
  findAgentExecutable,
  isRunnableAgent,
  stageFor,
  stagePrompt,
} from "./agent-runner";
import { buildFailurePackage } from "./failure-package";
import {
  abandon,
  createInvestigation,
  currentIteration,
  decide,
  isTerminal,
  markHandedOff,
  parseChangeFile,
  parsePlanMarkdown,
  receivePlan,
  recordChange,
  recordRetest,
  startNextRound,
} from "./investigation";
import { inspectProjectFolder } from "./project-repository";
import type { JsonStore } from "./store";

/** What the service needs from the desktop shell, so it can be tested without Electron. */
export interface InvestigationShell {
  confirm(message: string, detail: string): Promise<boolean>;
  copyText(text: string): void;
  reveal(path: string): void;
}

const MAX_AGENT_PACKAGE_BYTES = 400_000;
const TEXT_EXTENSIONS = new Set([".md", ".json", ".yml", ".txt"]);

export interface AgentInvestigationSummary {
  id: string;
  number: number;
  status: InvestigationStatus;
  round: number;
  projectName: string;
  testId: string;
}

export interface AgentInvestigationDetail {
  id: string;
  number: number;
  status: InvestigationStatus;
  round: number;
  decision?: "approved" | "changes-requested";
  decisionNote?: string;
  packagePath: string;
  agentPath: string;
  files: Record<string, string>;
}

const BUILD_ERROR_STATUSES: TestRun["status"][] = ["FAILED", "ERROR"];

export class InvestigationService {
  constructor(
    private readonly store: JsonStore,
    private readonly dataDirectory: string,
    private readonly shell: InvestigationShell,
    private readonly onNeedsUser?: (investigation: Investigation, projectName: string) => void,
  ) {}

  /** Saves, and tells the shell when the investigation has just started to wait for the user. */
  private async save(investigation: Investigation): Promise<void> {
    const previous = this.store.findInvestigation(investigation.id)?.status;
    await this.store.updateInvestigation(investigation);
    if (previous !== investigation.status && NEEDS_USER_STATUSES.includes(investigation.status)) {
      const project = this.store.findProject(investigation.projectId);
      this.onNeedsUser?.(investigation, project?.name ?? "");
    }
  }

  private baseDirectory(investigation: Investigation): string {
    return (
      investigation.exportedPath ?? join(this.dataDirectory, "investigations", investigation.id)
    );
  }

  private required(id: string): Investigation {
    const found = this.store.findInvestigation(id);
    if (!found) throw new Error("The investigation no longer exists.");
    return structuredClone(found);
  }

  private context(investigation: Investigation, project: Project): BriefContext {
    const state = this.store.snapshot();
    const iteration = currentIteration(investigation);
    const run = state.runs.find((item) => item.id === iteration.runId);
    const test = this.store.findTest(investigation.testDefinitionId);
    const environment = this.store.findEnvironment(project.environmentId);
    const base = this.baseDirectory(investigation);
    const previous = investigation.iterations.at(-2)?.change;
    const changeRequested = [...investigation.iterations]
      .reverse()
      .find((item) => item.decision === "changes-requested" && item.number === iteration.number);
    return {
      investigationNumber: investigation.number,
      iterationNumber: iteration.number,
      projectName: project.name,
      testId: test?.testId ?? run?.testId ?? "unknown",
      testName: test?.name ?? run?.testName ?? "",
      environmentName: environment?.name ?? run?.environmentName ?? "",
      packagePath: join(base, "package"),
      agentPath: join(base, "agent"),
      instructions: project.instructions,
      decisionNote: changeRequested?.decisionNote,
      previousChange: previous
        ? `Branch ${previous.branch}${previous.commit ? ` at ${previous.commit}` : ""}: ${previous.summary}`
        : undefined,
    };
  }

  private async write(investigation: Investigation): Promise<void> {
    const project = this.store.findProject(investigation.projectId);
    if (!project) throw new Error("The project no longer exists.");
    const iteration = currentIteration(investigation);
    const run = this.store.snapshot().runs.find((item) => item.id === iteration.runId);
    const test = this.store.findTest(investigation.testDefinitionId);
    const environment = this.store.findEnvironment(project.environmentId);
    if (!run || !test || !environment) {
      throw new Error("The run, test or environment of this investigation no longer exists.");
    }
    const inspection = await this.inspect(project);
    const base = this.baseDirectory(investigation);
    await mkdir(join(base, "agent"), { recursive: true });
    await buildFailurePackage({
      directory: join(base, "package"),
      brief: this.context(investigation, project),
      run,
      test,
      environment,
      project,
      inspection,
      includeEvidence: investigation.includeEvidence,
    });
  }

  private async inspect(project: Project): Promise<ProjectInspection | undefined> {
    return project.codePath
      ? inspectProjectFolder(project.codePath).catch(() => undefined)
      : undefined;
  }

  async inspectProject(projectId: string): Promise<ProjectInspection> {
    const project = this.store.findProject(projectId);
    if (!project) throw new Error("The project no longer exists.");
    if (!project.codePath) return { exists: false, isGitRepository: false, apps: [] };
    return inspectProjectFolder(project.codePath);
  }

  async create(input: InvestigationInput): Promise<void> {
    const run = this.store.snapshot().runs.find((item) => item.id === input.runId);
    if (!run) throw new Error("The run no longer exists.");
    if (!BUILD_ERROR_STATUSES.includes(run.status)) {
      throw new Error("An investigation can only be created for a failed run.");
    }
    const project = this.store.findProject(input.projectId);
    if (!project || project.archivedAt) throw new Error("Choose an active project.");
    const environment = this.store.findEnvironment(run.environmentId);
    if (!environment || environment.type === "production") {
      throw new Error("No investigation can be created for this environment.");
    }
    if (project.environmentId !== run.environmentId) {
      throw new Error("The project does not belong to this run's environment.");
    }
    if (
      this.store
        .openInvestigationsFor(project.id)
        .some((item) => item.testDefinitionId === run.testDefinitionId)
    ) {
      throw new Error("There is already an open investigation for this test in this project.");
    }
    const investigation = createInvestigation({
      number: this.store.nextInvestigationNumber(),
      run,
      projectId: project.id,
      agent: project.agent,
      includeEvidence: input.includeEvidence,
    });
    await this.write(investigation);
    await this.store.addInvestigation(investigation);
  }

  prompt(id: string, agent: AgentKind): string {
    const investigation = this.required(id);
    const project = this.store.findProject(investigation.projectId);
    if (!project) throw new Error("The project no longer exists.");
    return agentPrompt(this.context(investigation, project), agent);
  }

  async copyPrompt(id: string, agent: AgentKind): Promise<void> {
    const text = this.prompt(id, agent);
    const investigation = this.required(id);
    this.shell.copyText(text);
    if (investigation.status !== "PLAN_RECEIVED" && investigation.status !== "APPROVED") {
      markHandedOff(investigation, agent);
      await this.save(investigation);
    }
  }

  async exportPackage(id: string): Promise<void> {
    const investigation = this.required(id);
    const project = this.store.findProject(investigation.projectId);
    if (!project?.codePath)
      throw new AppError("CODE_FOLDER_MISSING", "This project has no code folder.");
    const inspection = await inspectProjectFolder(project.codePath);
    if (!inspection.exists)
      throw new AppError(
        "CODE_FOLDER_MISSING",
        "The code folder of this project no longer exists.",
      );
    const destination = join(project.codePath, ".nivio", "investigations", investigation.id);
    const approved = await this.shell.confirm(
      "Copy the package into the project?",
      `The package and an agent folder are copied to ${destination}. Add .nivio/ to .gitignore so it is not committed.`,
    );
    if (!approved) return;
    investigation.exportedPath = destination;
    await this.write(investigation);
    await this.save(investigation);
  }

  reveal(id: string): void {
    const investigation = this.required(id);
    this.shell.reveal(join(this.baseDirectory(investigation), "package"));
  }

  async importAgentOutput(id: string): Promise<void> {
    const investigation = this.required(id);
    const agentDirectory = join(this.baseDirectory(investigation), "agent");
    const iteration = currentIteration(investigation);
    const since = new Date(iteration.decidedAt ?? iteration.handedOffAt ?? investigation.createdAt);
    if (["PACKAGE_READY", "HANDED_OFF", "CHANGES_REQUESTED"].includes(investigation.status)) {
      const file = await readIfNewer(join(agentDirectory, "plan.md"), since);
      if (!file) throw new Error("The agent has not written plan.md yet.");
      receivePlan(investigation, parsePlanMarkdown(file));
    } else if (investigation.status === "APPROVED") {
      const file = await readIfNewer(join(agentDirectory, "change.json"), since);
      if (!file) throw new Error("The agent has not written change.json yet.");
      recordChange(investigation, parseChangeFile(file));
    } else {
      throw new Error("There is no agent result to import right now.");
    }
    await this.save(investigation);
  }

  async decide(input: InvestigationDecisionInput): Promise<void> {
    const investigation = this.required(input.id);
    decide(investigation, input.decision, input.note);
    await this.save(investigation);
  }

  async recordChange(input: InvestigationChangeInput): Promise<void> {
    const investigation = this.required(input.id);
    recordChange(investigation, {
      summary: input.summary,
      branch: input.branch,
      commit: input.commit || undefined,
      files: input.files,
    });
    await this.save(investigation);
  }

  async nextRound(id: string): Promise<void> {
    const investigation = this.required(id);
    startNextRound(investigation);
    await this.write(investigation);
    await this.save(investigation);
  }

  async abandon(id: string): Promise<void> {
    const investigation = this.required(id);
    abandon(investigation);
    await this.save(investigation);
  }

  /** Called when a run finishes: a passing or failing retest moves the investigation on. */
  async onRunFinished(run: TestRun): Promise<void> {
    for (const existing of this.store.snapshot().investigations) {
      const investigation = structuredClone(existing);
      if (recordRetest(investigation, run)) await this.save(investigation);
    }
  }

  /** Open investigations as the agent sees them: no paths outside the package, no secrets. */
  listForAgent(): AgentInvestigationSummary[] {
    const state = this.store.snapshot();
    return state.investigations
      .filter((item) => !isTerminal(item.status))
      .map((item) => ({
        id: item.id,
        number: item.number,
        status: item.status,
        round: currentIteration(item).number,
        projectName: state.projects.find((project) => project.id === item.projectId)?.name ?? "",
        testId: state.tests.find((test) => test.id === item.testDefinitionId)?.testId ?? "",
      }));
  }

  /** The package text files plus what the user decided, for a connected agent. */
  async getForAgent(id: string): Promise<AgentInvestigationDetail> {
    const investigation = this.required(id);
    const iteration = currentIteration(investigation);
    const directory = join(this.baseDirectory(investigation), "package");
    const files: Record<string, string> = {};
    let budget = MAX_AGENT_PACKAGE_BYTES;
    for (const path of await listTextFiles(directory)) {
      const text = await readFile(path, "utf8");
      if (text.length > budget) continue;
      budget -= text.length;
      files[relative(directory, path)] = text;
    }
    return {
      id: investigation.id,
      number: investigation.number,
      status: investigation.status,
      round: iteration.number,
      decision: iteration.decision,
      decisionNote: iteration.decisionNote,
      packagePath: directory,
      agentPath: join(this.baseDirectory(investigation), "agent"),
      files,
    };
  }

  async submitPlan(id: string, markdown: string): Promise<void> {
    const investigation = this.required(id);
    receivePlan(investigation, parsePlanMarkdown(new TextEncoder().encode(markdown)));
    await this.save(investigation);
  }

  decisionForAgent(id: string): { status: InvestigationStatus; decision?: string; note?: string } {
    const investigation = this.required(id);
    const iteration = currentIteration(investigation);
    return {
      status: investigation.status,
      decision: iteration.decision,
      note: iteration.decisionNote,
    };
  }

  async reportChange(id: string, change: Omit<InvestigationChange, "reportedAt">): Promise<void> {
    const investigation = this.required(id);
    recordChange(investigation, change);
    await this.save(investigation);
  }

  /** Validates everything an agent launch needs. The renderer only supplies the investigation id. */
  async prepareAgentRun(id: string): Promise<AgentRunRequest> {
    const investigation = this.required(id);
    const stage = stageFor(investigation.status);
    if (!stage) throw new Error(`There is no agent step in status ${investigation.status}.`);
    const project = this.store.findProject(investigation.projectId);
    if (!project) throw new Error("The project no longer exists.");
    const iteration = currentIteration(investigation);
    const agent = iteration.agent;
    const custom = this.store.snapshot().settings.customAgent;
    if (agent === "other" && !custom) {
      throw new Error("Set up your own agent in Settings first, or use the prompt.");
    }
    if (agent !== "other" && !isRunnableAgent(agent)) {
      throw new Error("This agent cannot be started from Test Suite. Use the prompt.");
    }
    if (!project.codePath)
      throw new AppError("CODE_FOLDER_MISSING", "This project has no code folder.");
    const inspection = await inspectProjectFolder(project.codePath);
    if (!inspection.exists) {
      throw new AppError(
        "CODE_FOLDER_MISSING",
        "The code folder of this project no longer exists.",
      );
    }
    if (!inspection.isGitRepository) {
      throw new AppError(
        "CODE_FOLDER_MISSING",
        "The code folder is not inside a git repository. Run git init in it, or choose a folder that is.",
      );
    }
    const executable =
      agent === "other"
        ? await customExecutable(custom?.executable)
        : await findAgentExecutable(agent);
    if (!executable) {
      throw new AppError(
        "AGENT_NOT_FOUND",
        agent === "other"
          ? "Your own agent was not found. Check its path in Settings."
          : `${agent === "codex" ? "Codex" : "Claude Code"} was not found on this computer.`,
      );
    }
    const context = this.context(investigation, project);
    const branch = this.suggestedBranch(context.testId, iteration.number);
    return {
      investigationId: id,
      agent,
      args: agent === "other" ? custom?.args : undefined,
      readableDirectories: [join(this.baseDirectory(investigation), "package")],
      stage,
      executable,
      cwd: project.codePath,
      stdin: stagePrompt(
        stage,
        agentPrompt(context, agent),
        iteration.planMarkdown,
        branch,
        agent !== "other",
      ),
    };
  }

  /** Turns the agent's final message into a plan or a change; refuses anything unusable. */
  async finishAgentRun(id: string, stage: AgentStage, output: string): Promise<void> {
    const investigation = this.required(id);
    if (stageFor(investigation.status) !== stage) {
      throw new Error("The investigation changed in the meantime; the agent result was ignored.");
    }
    if (stage === "plan") {
      markHandedOff(investigation, currentIteration(investigation).agent);
      receivePlan(investigation, parsePlanMarkdown(new TextEncoder().encode(output)));
    } else {
      recordChange(investigation, parseChangeFile(extractChangeJson(output)));
    }
    await this.save(investigation);
  }

  suggestedBranch(testId: string, round: number): string {
    return branchName(testId, round);
  }
}

async function readIfNewer(path: string, since: Date): Promise<Uint8Array | undefined> {
  const info = await stat(path).catch(() => undefined);
  if (!info?.isFile() || info.mtime < since) return undefined;
  return new Uint8Array(await readFile(path));
}

async function listTextFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await listTextFiles(path)));
    else if (entry.isFile() && TEXT_EXTENSIONS.has(extname(entry.name))) files.push(path);
  }
  return files.sort();
}

/** The configured program, only if it is still a runnable file. */
export async function customExecutable(path: string | undefined): Promise<string | undefined> {
  if (!path || !isAbsolute(path)) return undefined;
  const info = await stat(path).catch(() => undefined);
  if (!info?.isFile()) return undefined;
  if (process.platform !== "win32") {
    const runnable = await access(path, constants.X_OK).then(
      () => true,
      () => false,
    );
    if (!runnable) return undefined;
  }
  return path;
}
