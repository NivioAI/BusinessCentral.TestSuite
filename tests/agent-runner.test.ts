import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AgentRunner,
  extractChangeJson,
  findAgentExecutable,
  isRunnableAgent,
  launchArguments,
  stageFor,
  stagePrompt,
} from "../src/main/agent-runner";
import { InvestigationService } from "../src/main/investigation-service";
import { createFixture } from "./helpers/investigation-fixture";

describe("agent launch arguments", () => {
  it("keeps the plan stage read-only for both agents", () => {
    const claude = launchArguments("claude-code", "plan", "/repo");
    expect(claude).toContain("Read,Grep,Glob");
    expect(claude.join(" ")).not.toMatch(/Edit|Write|Bash/);
    expect(launchArguments("codex", "plan", "/repo")).toEqual([
      "exec",
      "--sandbox",
      "read-only",
      "--cd",
      "/repo",
      "-",
    ]);
  });

  it("lets the plan stage read the investigation package, and only read it", () => {
    const plan = launchArguments("claude-code", "plan", "/repo", ["/data/inv/package"]);
    expect(plan).toEqual([
      "-p",
      "--permission-mode",
      "dontAsk",
      "--add-dir",
      "/data/inv/package",
      "--tools",
      "Read,Grep,Glob",
    ]);
    expect(launchArguments("claude-code", "plan", "/repo")).not.toContain("--add-dir");
    // The change stage can write, so it never gets extra folders.
    expect(launchArguments("claude-code", "change", "/repo", ["/data/inv/package"])).not.toContain(
      "--add-dir",
    );
  });

  it("never allows git push in the change stage", () => {
    const claude = launchArguments("claude-code", "change", "/repo").join(" ");
    expect(claude).toContain("Bash(git commit *)");
    expect(claude).not.toContain("push");
    expect(claude).toContain("dontAsk");
    expect(launchArguments("codex", "change", "/repo")).toContain("workspace-write");
  });

  it("only runs known agents and maps statuses to stages", () => {
    expect(isRunnableAgent("other")).toBe(false);
    expect(isRunnableAgent("codex")).toBe(true);
    expect(stageFor("PACKAGE_READY")).toBe("plan");
    expect(stageFor("CHANGES_REQUESTED")).toBe("plan");
    expect(stageFor("APPROVED")).toBe("change");
    for (const status of ["PLAN_RECEIVED", "CHANGE_APPLIED", "VERIFIED", "ABANDONED"] as const) {
      expect(stageFor(status)).toBeUndefined();
    }
  });
});

describe("agent output", () => {
  it("extracts the last fenced JSON object, or a trailing object", () => {
    const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
    expect(text(extractChangeJson('a\n```json\n{"x":1}\n```\nb\n```json\n{"y":2}\n```'))).toBe(
      '{"y":2}',
    );
    expect(text(extractChangeJson('done {"z":3}'))).toBe('{"z":3}');
  });

  it("puts the approved plan and branch in the change prompt", () => {
    const prompt = stagePrompt("change", "BASE", "THE PLAN", "fix/bc-1-1");
    expect(prompt).toContain("THE PLAN");
    expect(prompt).toContain("fix/bc-1-1");
    expect(prompt).toContain("Never push");
    expect(stagePrompt("plan", "BASE", undefined, "b")).toContain("read-only");
  });
});

describe("agent executable and process", () => {
  it("finds an executable on PATH and returns undefined when absent", async () => {
    const directory = await mkdtemp(join(tmpdir(), "bcft-agent-"));
    const file = join(directory, "codex");
    await writeFile(file, "#!/bin/sh\n");
    await chmod(file, 0o755);
    expect(await findAgentExecutable("codex", { PATH: directory }, "linux")).toBe(file);
    const empty = await mkdtemp(join(tmpdir(), "bcft-agent-"));
    const found = await findAgentExecutable("claude-code", { PATH: empty }, "linux");
    expect(found === undefined || found.endsWith("claude")).toBe(true);
  });

  it.skipIf(process.platform === "win32")(
    "feeds the prompt on stdin, captures output, masks secrets and refuses a second run",
    async () => {
      const directory = await mkdtemp(join(tmpdir(), "bcft-agent-"));
      const script = join(directory, "fake-agent");
      await writeFile(script, "#!/bin/sh\ncat\necho 'password=hunter2' >&2\n");
      await chmod(script, 0o755);
      const runner = new AgentRunner();
      const logs: string[] = [];
      const result = await new Promise<{ output: string; code: number | null }>((resolve) => {
        runner.start(
          {
            investigationId: "i1",
            agent: "codex",
            stage: "plan",
            executable: script,
            cwd: directory,
            stdin: "hello plan",
          },
          {
            onLog: (line) => logs.push(line),
            onExit: (output, code) => resolve({ output, code }),
          },
        );
        expect(runner.active).toBe("i1");
        expect(() =>
          runner.start(
            {
              investigationId: "i2",
              agent: "codex",
              stage: "plan",
              executable: script,
              cwd: directory,
              stdin: "",
            },
            { onLog: () => undefined, onExit: () => undefined },
          ),
        ).toThrow(/already running/);
      });
      expect(result).toEqual({ output: "hello plan", code: 0 });
      expect(logs.join("\n")).not.toContain("hunter2");
      expect(runner.active).toBeUndefined();
    },
  );

  it.skipIf(process.platform === "win32")("stops the whole process group", async () => {
    const directory = await mkdtemp(join(tmpdir(), "bcft-agent-"));
    const script = join(directory, "slow-agent");
    await writeFile(script, "#!/bin/sh\nsleep 30\n");
    await chmod(script, 0o755);
    const runner = new AgentRunner();
    const exited = new Promise<number | null>((resolve) => {
      runner.start(
        {
          investigationId: "i1",
          agent: "codex",
          stage: "plan",
          executable: script,
          cwd: directory,
          stdin: "",
        },
        { onLog: () => undefined, onExit: (_output, code) => resolve(code) },
      );
    });
    await runner.stop();
    expect(await exited).not.toBe(0);
  });
});

describe("InvestigationService agent run", () => {
  const shell = { confirm: async () => true, copyText: () => undefined, reveal: () => undefined };

  it("refuses runs without a runnable agent or code folder, and applies a plan then a change", async () => {
    const fixture = await createFixture();
    const service = new InvestigationService(fixture.store, fixture.directory, shell);
    await service.create({
      runId: fixture.run.id,
      projectId: fixture.project.id,
      includeEvidence: false,
    });
    const id = fixture.store.snapshot().investigations[0].id;

    await service.finishAgentRun(id, "plan", "## Analysis\nMissing field.");
    expect(fixture.store.snapshot().investigations[0].status).toBe("PLAN_RECEIVED");
    await expect(service.finishAgentRun(id, "plan", "again")).rejects.toThrow(
      /changed in the meantime/,
    );
    await expect(service.prepareAgentRun(id)).rejects.toThrow(/no agent step/);

    await service.decide({ id, decision: "approved" });
    await expect(service.finishAgentRun(id, "change", "no json here")).rejects.toThrow();
    await service.finishAgentRun(
      id,
      "change",
      'Done.\n```json\n{"summary":"Add field","branch":"fix/bc-2-1","files":["a.al"]}\n```',
    );
    expect(fixture.store.snapshot().investigations[0].status).toBe("CHANGE_APPLIED");
  });

  it("rejects an empty plan from the agent", async () => {
    const fixture = await createFixture();
    const service = new InvestigationService(fixture.store, fixture.directory, shell);
    await service.create({
      runId: fixture.run.id,
      projectId: fixture.project.id,
      includeEvidence: false,
    });
    const id = fixture.store.snapshot().investigations[0].id;
    await expect(service.finishAgentRun(id, "plan", "  ")).rejects.toThrow();
    expect(fixture.store.snapshot().investigations[0].status).toBe("PACKAGE_READY");
  });

  it("says whether the code folder is gone or just not in a git repository", async () => {
    const fixture = await createFixture();
    const service = new InvestigationService(fixture.store, fixture.directory, {
      confirm: async () => true,
      copyText: () => undefined,
      reveal: () => undefined,
    });
    await service.create({
      runId: fixture.run.id,
      projectId: fixture.project.id,
      includeEvidence: false,
    });
    const id = fixture.store.snapshot().investigations[0].id;
    const withFolder = async (codePath: string) => {
      await fixture.store.saveProject({
        id: fixture.project.id,
        environmentId: fixture.project.environmentId,
        name: fixture.project.name,
        codePath,
        agent: "claude-code",
      });
      return service.prepareAgentRun(id);
    };

    const plain = await mkdtemp(join(tmpdir(), "bcft-plain-"));
    await expect(withFolder(plain)).rejects.toMatchObject({
      code: "CODE_FOLDER_MISSING",
      message: expect.stringContaining("not inside a git repository"),
    });
    await expect(withFolder(join(plain, "gone"))).rejects.toMatchObject({
      code: "CODE_FOLDER_MISSING",
      message: expect.stringContaining("no longer exists"),
    });
  });
});
