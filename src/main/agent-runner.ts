import { type ChildProcess, spawn } from "node:child_process";
import { constants, access } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import type { AgentKind, InvestigationStatus } from "../shared/models";
import { sanitizeText } from "./run-export";

/**
 * Starting an agent is a deliberate, narrow exception to "no arbitrary processes":
 * a fixed list of agents, fixed argument lists per stage, the prompt on stdin (never in a
 * shell string), a working directory that is the project's approved code folder, and an
 * allowlist of tools so the plan stage is read-only and the change stage can never push.
 */
export type AgentStage = "plan" | "change";
export type RunnableAgent = Extract<AgentKind, "claude-code" | "codex">;

const MAX_OUTPUT_BYTES = 1_000_000;

export function isRunnableAgent(agent: AgentKind): agent is RunnableAgent {
  return agent === "claude-code" || agent === "codex";
}

export function stageFor(status: InvestigationStatus): AgentStage | undefined {
  if (status === "PACKAGE_READY" || status === "HANDED_OFF" || status === "CHANGES_REQUESTED") {
    return "plan";
  }
  return status === "APPROVED" ? "change" : undefined;
}

/** Git commands the change stage may run. Push is deliberately absent. */
const CLAUDE_GIT_ALLOWLIST = [
  "Bash(git status*)",
  "Bash(git diff*)",
  "Bash(git log*)",
  "Bash(git rev-parse*)",
  "Bash(git switch -c *)",
  "Bash(git checkout -b *)",
  "Bash(git add *)",
  "Bash(git commit *)",
];

/**
 * `readableDirectories` are folders outside the repository the agent may read, such as the
 * investigation package. Only the plan stage gets them: it has read-only tools, so access can
 * not become write access.
 */
export function launchArguments(
  agent: RunnableAgent,
  stage: AgentStage,
  cwd: string,
  readableDirectories: string[] = [],
): string[] {
  if (agent === "claude-code") {
    return stage === "plan"
      ? [
          "-p",
          "--permission-mode",
          "dontAsk",
          ...readableDirectories.flatMap((directory) => ["--add-dir", directory]),
          "--tools",
          "Read,Grep,Glob",
        ]
      : [
          "-p",
          "--permission-mode",
          "dontAsk",
          "--tools",
          "Read,Grep,Glob,Edit,Write,Bash",
          "--allowedTools",
          "Read",
          "Grep",
          "Glob",
          "Edit",
          "Write",
          ...CLAUDE_GIT_ALLOWLIST,
        ];
  }
  return [
    "exec",
    "--sandbox",
    stage === "plan" ? "read-only" : "workspace-write",
    "--cd",
    cwd,
    "-",
  ];
}

export function stagePrompt(
  stage: AgentStage,
  basePrompt: string,
  plan: string | undefined,
  branch: string,
  /** False for your own agent: Test Suite cannot hold it to read-only, so the prompt asks. */
  restricted = true,
): string {
  if (stage === "plan") {
    return [
      basePrompt,
      "",
      restricted
        ? "Test Suite runs you read-only. Do not try to write files."
        : "Do not change, create or delete any file and do not run commands that change anything. Never push.",
      "Your final message is stored as the plan. Reply with markdown only and use the headings",
      "Analysis, Proposed changes, Risks and Tests to run.",
    ].join("\n");
  }
  return [
    basePrompt,
    "",
    "The user approved this plan:",
    "",
    plan ?? "",
    "",
    `Implement it now on branch ${branch}. Commit locally. Never push.`,
    "Your final message must end with one JSON object in a ```json fence:",
    '{"summary": "...", "branch": "...", "commit": "...", "files": ["..."]}',
  ].join("\n");
}

/** The agent reports its change as the last fenced JSON object of its final message. */
export function extractChangeJson(output: string): Uint8Array {
  const fences = [...output.matchAll(/```json\s*([\s\S]*?)```/g)];
  const last = fences.at(-1)?.[1] ?? output.slice(output.lastIndexOf("{"));
  return new TextEncoder().encode(last.trim());
}

export async function findAgentExecutable(
  agent: RunnableAgent,
  environment: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): Promise<string | undefined> {
  const name = agent === "claude-code" ? "claude" : "codex";
  const suffixes = platform === "win32" ? [".cmd", ".exe"] : [""];
  const directories = [
    ...(environment.PATH ?? "").split(delimiter),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    join(homedir(), ".local", "bin"),
    join(homedir(), ".claude", "local"),
    ...(environment.APPDATA ? [join(environment.APPDATA, "npm")] : []),
  ].filter(Boolean);
  for (const directory of directories) {
    for (const suffix of suffixes) {
      const candidate = join(directory, `${name}${suffix}`);
      const found = await access(candidate, constants.X_OK).then(
        () => true,
        () => false,
      );
      if (found) return candidate;
    }
  }
  return undefined;
}

export interface AgentRunRequest {
  investigationId: string;
  agent: RunnableAgent | "other";
  /** Only for "other": the fixed arguments from Settings. */
  args?: string[];
  /** Folders outside the repository that the plan stage may read (the investigation package). */
  readableDirectories?: string[];
  stage: AgentStage;
  executable: string;
  cwd: string;
  stdin: string;
}

export interface AgentRunCallbacks {
  onLog(line: string): void;
  onExit(output: string, exitCode: number | null, error?: Error): void;
}

export class AgentRunner {
  private child?: ChildProcess;
  private activeInvestigationId?: string;

  get active(): string | undefined {
    return this.activeInvestigationId;
  }

  start(request: AgentRunRequest, callbacks: AgentRunCallbacks): void {
    if (this.child) throw new Error("An agent is already running. Stop it first.");
    const args =
      request.agent === "other"
        ? (request.args ?? [])
        : launchArguments(request.agent, request.stage, request.cwd, request.readableDirectories);
    const child = spawn(request.executable, args, {
      cwd: request.cwd,
      detached: process.platform !== "win32",
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child = child;
    this.activeInvestigationId = request.investigationId;
    let output = "";
    const logLines = (chunk: Buffer): void => {
      for (const line of chunk.toString("utf8").split(/\r?\n/)) {
        if (line.trim()) callbacks.onLog(sanitizeText(line));
      }
    };
    child.stdout?.on("data", (chunk: Buffer) => {
      if (output.length < MAX_OUTPUT_BYTES) output += chunk.toString("utf8");
      logLines(chunk);
    });
    child.stderr?.on("data", logLines);
    let completed = false;
    const finish = (code: number | null, error?: Error): void => {
      if (completed) return;
      completed = true;
      this.child = undefined;
      this.activeInvestigationId = undefined;
      callbacks.onExit(output, code, error);
    };
    child.once("error", (error) => finish(null, error));
    child.once("exit", (code) => finish(code));
    child.stdin?.once("error", () => undefined);
    child.stdin?.end(request.stdin);
  }

  async stop(): Promise<void> {
    const child = this.child;
    if (!child?.pid || child.exitCode !== null) return;
    if (process.platform === "win32") {
      await new Promise<void>((resolve) => {
        const killer = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
          windowsHide: true,
        });
        killer.once("exit", () => resolve());
        killer.once("error", () => {
          child.kill("SIGTERM");
          resolve();
        });
      });
    } else {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        child.kill("SIGTERM");
      }
    }
  }
}
