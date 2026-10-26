import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AgentRunner, stagePrompt } from "../src/main/agent-runner";
import { AppController } from "../src/main/controller";
import { InvestigationService } from "../src/main/investigation-service";
import { createWorkspaceArchive, readWorkspaceArchive } from "../src/main/workspace-backup";
import { appSettingsInputSchema } from "../src/shared/schemas";
import { createFixture } from "./helpers/investigation-fixture";

const shell = { confirm: async () => true, copyText: () => undefined, reveal: () => undefined };
const baseSettings = {
  stepDelayMs: 500,
  textSize: "medium" as const,
  runRetentionDays: 90 as const,
  notifications: {
    runFinished: true,
    investigationNeedsMe: true,
    agentApproval: false,
    scheduledPlans: true,
  },
};

async function script(body: string) {
  const directory = await mkdtemp(join(tmpdir(), "bcft-custom-agent-"));
  const path = join(directory, "my-agent");
  await writeFile(path, `#!/bin/sh\n${body}\n`);
  await chmod(path, 0o755);
  return path;
}

describe("settings validation", () => {
  it("accepts a program with fixed arguments and rejects unsafe ones", () => {
    const ok = appSettingsInputSchema.safeParse({
      ...baseSettings,
      customAgent: { executable: "/usr/local/bin/agent", args: ["--print", "--no-color"] },
    });
    expect(ok.success).toBe(true);
    for (const args of [
      ["a\nb"],
      ["a\0b"],
      Array.from({ length: 21 }, () => "x"),
      ["x".repeat(201)],
    ]) {
      expect(
        appSettingsInputSchema.safeParse({
          ...baseSettings,
          customAgent: { executable: "/x", args },
        }).success,
      ).toBe(false);
    }
    expect(
      appSettingsInputSchema.safeParse({
        ...baseSettings,
        customAgent: { executable: " ", args: [] },
      }).success,
    ).toBe(false);
  });
});

describe("saving the custom agent", () => {
  async function controller() {
    const saved: unknown[] = [];
    const store = {
      saveSettings: async (value: unknown) => {
        saved.push(value);
      },
      pruneRuns: async () => [],
    };
    const directory = await mkdtemp(join(tmpdir(), "bcft-ctrl-"));
    const instance = new AppController(store as never, directory, directory, () => undefined);
    (instance as unknown as { snapshot(): object }).snapshot = () => ({});
    return { instance, saved };
  }

  it("only takes a program that was chosen in the file picker", async () => {
    const { instance, saved } = await controller();
    const path = await script("cat");
    await expect(
      instance.saveSettings({ ...baseSettings, customAgent: { executable: path, args: [] } }),
    ).rejects.toThrow("file picker");
    expect(saved).toHaveLength(0);

    (instance as unknown as { approvedExecutables: Set<string> }).approvedExecutables.add(path);
    await instance.saveSettings({
      ...baseSettings,
      customAgent: { executable: path, args: ["-x"] },
    });
    expect(saved).toHaveLength(1);
  });

  // Windows has no execute permission bit, so every existing file counts as runnable there.
  it.skipIf(process.platform === "win32")(
    "rejects a chosen file that is not runnable, and clears the agent without one",
    async () => {
      const { instance, saved } = await controller();
      const directory = await mkdtemp(join(tmpdir(), "bcft-plain-"));
      const plain = join(directory, "notes.txt");
      await writeFile(plain, "hello");
      (instance as unknown as { approvedExecutables: Set<string> }).approvedExecutables.add(plain);
      await expect(
        instance.saveSettings({ ...baseSettings, customAgent: { executable: plain, args: [] } }),
      ).rejects.toMatchObject({ code: "AGENT_NOT_FOUND" });
      await instance.saveSettings(baseSettings);
      expect(saved).toHaveLength(1);
    },
  );
});

describe("starting your own agent", () => {
  async function setup(customAgent?: { executable: string; args: string[] }) {
    const fixture = await createFixture();
    await fixture.store.saveSettings({ ...baseSettings, customAgent });
    await fixture.store.saveProject({
      id: fixture.project.id,
      environmentId: fixture.project.environmentId,
      name: fixture.project.name,
      codePath: fixture.codePath,
      agent: "other",
    });
    const service = new InvestigationService(fixture.store, fixture.directory, shell);
    await service.create({
      runId: fixture.run.id,
      projectId: fixture.project.id,
      includeEvidence: false,
    });
    return { fixture, service, id: fixture.store.snapshot().investigations[0].id };
  }

  it("prepares a run with the configured program and arguments, and an unrestricted prompt", async () => {
    const path = await script("cat");
    const { service, id, fixture } = await setup({ executable: path, args: ["--print", "-q"] });
    const request = await service.prepareAgentRun(id);
    expect(request).toMatchObject({
      agent: "other",
      executable: path,
      args: ["--print", "-q"],
      cwd: fixture.codePath,
      stage: "plan",
      readableDirectories: [join(fixture.directory, "investigations", id, "package")],
    });
    expect(request.stdin).toContain("Do not change, create or delete any file");
    expect(request.stdin).not.toContain("Test Suite runs you read-only");
  });

  it("refuses without a configured agent and when the program has gone", async () => {
    const none = await setup();
    await expect(none.service.prepareAgentRun(none.id)).rejects.toThrow("Set up your own agent");
    const gone = await setup({ executable: "/definitely/not/here", args: [] });
    await expect(gone.service.prepareAgentRun(gone.id)).rejects.toMatchObject({
      code: "AGENT_NOT_FOUND",
    });
  });

  it("asks the unrestricted way for your own agent and keeps the read-only wording for built-ins", () => {
    expect(stagePrompt("plan", "BASE", undefined, "b", false)).toContain("Never push");
    expect(stagePrompt("plan", "BASE", undefined, "b")).toContain("runs you read-only");
  });
});

describe.skipIf(process.platform === "win32")("running your own agent", () => {
  it("passes exactly the configured arguments, never the built-in ones, and the prompt on stdin", async () => {
    const path = await script('echo "args:$*"; cat');
    const runner = new AgentRunner();
    const result = await new Promise<{ output: string; code: number | null }>((resolve) => {
      runner.start(
        {
          investigationId: "i1",
          agent: "other",
          args: ["--one", "two words"],
          stage: "plan",
          executable: path,
          cwd: tmpdir(),
          stdin: "the prompt",
        },
        { onLog: () => undefined, onExit: (output, code) => resolve({ output, code }) },
      );
    });
    expect(result.code).toBe(0);
    expect(result.output).toContain("args:--one two words");
    expect(result.output).toContain("the prompt");
    expect(result.output).not.toContain("dontAsk");
  });
});

describe("custom agent stays on this device", () => {
  it("is left out of a backup and survives restoring one", async () => {
    const fixture = await createFixture();
    const executable = "/Users/someone/bin/my-agent";
    await fixture.store.saveSettings({
      ...baseSettings,
      customAgent: { executable, args: ["-a"] },
    });

    const archive = await createWorkspaceArchive(fixture.store.snapshot());
    const parsed = readWorkspaceArchive(archive);
    expect(JSON.stringify(parsed.manifest)).not.toContain(executable);

    await fixture.store.importWorkspace(parsed.manifest.state, "replace");
    expect(fixture.store.snapshot().settings.customAgent).toEqual({ executable, args: ["-a"] });
  });
});
