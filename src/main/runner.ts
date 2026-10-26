import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { access, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { AppError } from "../shared/app-error";
import type { BcEnvironment, TestDefinition, TestRun } from "../shared/models";
import { copyPageScriptIncludes, materializePageScript } from "./page-script";
import { buildRunnerEnvironment } from "./runtime";

export interface RunnerCallbacks {
  onLog(line: string): void;
  onComplete(exitCode: number | null, error?: Error): void;
}

export interface RunnerStartOptions {
  run: TestRun;
  test: TestDefinition;
  environment: BcEnvironment;
  password?: string;
  values: Record<string, string | number | boolean>;
  manualMfa: boolean;
  rememberSession: boolean;
  stepDelayMs: number;
  sessionState?: string;
  callbacks: RunnerCallbacks;
}

export interface RunnerPaths {
  powershellExecutable: string;
  replayScript: string;
  workingDirectory: string;
}

export class ReplayRunner {
  private child?: ChildProcessWithoutNullStreams;

  constructor(private readonly paths: RunnerPaths) {}

  get isRunning(): boolean {
    return Boolean(this.child && this.child.exitCode === null);
  }

  async start(options: RunnerStartOptions): Promise<void> {
    if (this.isRunning) throw new Error("A test is already running.");

    const {
      run,
      test,
      environment,
      password,
      values,
      manualMfa,
      rememberSession,
      stepDelayMs,
      sessionState,
      callbacks,
    } = options;
    await mkdir(run.resultDirectory, { recursive: true });
    const materializedScript = join(run.resultDirectory, `${test.testId}.run.yml`);
    await copyPageScriptIncludes(test.recordingPath, run.resultDirectory);
    await materializePageScript(test.recordingPath, materializedScript, values, stepDelayMs);
    const authStatePath = join(run.resultDirectory, "auth-state.json");
    if (sessionState)
      await writeFile(authStatePath, sessionState, { encoding: "utf8", mode: 0o600 });

    const args = [
      "-NoProfile",
      "-NonInteractive",
      "-File",
      this.paths.replayScript,
      materializedScript,
      "-StartAddress",
      environment.baseUrl,
      "-Headed",
      "-ResultDir",
      run.resultDirectory,
      "-Authentication",
      environment.authentication,
    ];

    const childEnvironment: NodeJS.ProcessEnv = {
      ...buildRunnerEnvironment(this.paths.powershellExecutable),
      BCFT_RUN_ID: run.id,
      BCFT_NODE_EXECUTABLE: process.execPath,
    };
    if (manualMfa || sessionState) childEnvironment.BCFT_MANUAL_MFA = "1";
    if (rememberSession) childEnvironment.BCFT_AUTH_STATE_PATH = authStatePath;
    if (sessionState) childEnvironment.BCFT_AUTH_STATE_EXISTS = "1";
    if (environment.authentication !== "Windows") {
      if (!environment.username || !password) {
        throw new AppError(
          "CREDENTIAL_MISSING",
          "AAD/UserPassword requires a username and a securely stored credential.",
        );
      }
      childEnvironment.BCFT_REPLAY_USERNAME = environment.username;
      childEnvironment.BCFT_REPLAY_PASSWORD = password;
      args.push("-UserNameKey", "BCFT_REPLAY_USERNAME", "-PasswordKey", "BCFT_REPLAY_PASSWORD");
    }

    this.child = spawn(this.paths.powershellExecutable, args, {
      cwd: this.paths.workingDirectory,
      env: childEnvironment,
      windowsHide: false,
      stdio: "pipe",
    });

    const emitLines = (chunk: Buffer): void => {
      for (const line of chunk.toString("utf8").split(/\r?\n/)) {
        const clean = stripAnsi(line).trim();
        if (clean) callbacks.onLog(redactSecrets(clean, [password]));
      }
    };
    let completed = false;
    const completeOnce = (exitCode: number | null, error?: Error): void => {
      if (completed) return;
      completed = true;
      callbacks.onComplete(exitCode, error);
    };
    this.child.stdout.on("data", emitLines);
    this.child.stderr.on("data", emitLines);
    this.child.once("error", (error) => completeOnce(null, error));
    this.child.once("exit", (code) => {
      this.child = undefined;
      completeOnce(code);
    });
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
      child.kill("SIGTERM");
    }
    this.child = undefined;
  }
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export function redactSecrets(value: string, secrets: Array<string | undefined>): string {
  return secrets.reduce<string>(
    (output, secret) => (secret ? output.split(secret).join("••••••••") : output),
    value,
  );
}

export function stripAnsi(value: string): string {
  const escapeCharacter = String.fromCharCode(27);
  return value.replace(new RegExp(`${escapeCharacter}\\[[0-?]*[ -/]*[@-~]`, "g"), "");
}
