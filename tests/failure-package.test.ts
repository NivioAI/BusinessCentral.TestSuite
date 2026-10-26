import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { BriefContext } from "../src/main/agent-brief";
import { buildFailurePackage, isInside } from "../src/main/failure-package";
import { createFixture } from "./helpers/investigation-fixture";

function brief(directory: string): BriefContext {
  return {
    investigationNumber: 3,
    iterationNumber: 2,
    projectName: "Sales AL",
    testId: "BC-2",
    testName: "Post purchase invoice",
    environmentName: "Sandbox",
    packagePath: join(directory, "package"),
    agentPath: join(directory, "agent"),
    instructions: "Never push.",
    decisionNote: "Keep the default out of scope.",
    previousChange: "Branch fix/BC-2-1: Earlier fix",
  };
}

async function build(
  includeEvidence: boolean,
  prepare?: (fixture: Awaited<ReturnType<typeof createFixture>>) => Promise<void>,
) {
  const fixture = await createFixture();
  await prepare?.(fixture);
  const directory = join(fixture.directory, "package-out");
  await buildFailurePackage({
    directory,
    brief: brief(directory),
    run: fixture.store.snapshot().runs[0],
    test: fixture.test,
    environment: fixture.environment,
    project: fixture.project,
    inspection: {
      exists: true,
      isGitRepository: true,
      branch: "main",
      apps: [{ name: "Sales", version: "1.0.0.0", path: "app" }],
    },
    includeEvidence,
  });
  return { fixture, directory };
}

describe("failure package", () => {
  it("writes the documented files with secrets masked", async () => {
    const { directory } = await build(false);
    const read = (name: string) => readFile(join(directory, name), "utf8");

    const failure = JSON.parse(await read("failure.json"));
    expect(failure.failingStep).toMatchObject({ sequence: 3, description: "Post invoice" });
    expect(failure.run.parameters.password).toBe("••••••••");
    expect(failure.run.parameters.customer).toBe("10000");
    expect(failure.run.error).not.toContain("abc123");
    expect(failure.project).toEqual({ name: "Sales AL", branch: "main" });
    expect(failure.environment).not.toHaveProperty("baseUrl");

    expect(await read("test/page-script.yml")).not.toContain("hunter2");
    const log = await read("run/log.txt");
    expect(log).not.toContain("abc.def.ghi");
    expect(await read("run/failing-step.md")).toContain("Step 3: Post invoice");
    expect(await read("run/steps.md")).toContain("**← failed**");
    expect(await read("project/context.md")).toContain("Sales 1.0.0.0 (app)");
    const agentBrief = await read("AGENT-BRIEF.md");
    expect(agentBrief).toContain("Never push.");
    expect(agentBrief).toContain("Keep the default out of scope.");
    expect(agentBrief).toContain("Earlier fix");
    expect(agentBrief).toContain("fix/BC-2-2");
    expect((await readdir(join(directory, "evidence"))).length).toBe(0);
  });

  it("copies evidence from the run folder only when asked", async () => {
    const { directory } = await build(true, async (fixture) => {
      const screenshot = join(fixture.run.resultDirectory, "step-3.png");
      const video = join(fixture.run.resultDirectory, "video.webm");
      await writeFile(screenshot, "png");
      await writeFile(video, "webm");
      const run = fixture.store.snapshot().runs[0];
      run.steps[2].screenshotPath = screenshot;
      run.videoPath = video;
      await fixture.store.updateRun(run);
    });
    expect((await readdir(join(directory, "evidence"))).sort()).toEqual([
      "step-3.png",
      "video.webm",
    ]);
  });

  it("never copies evidence from outside the run folder", async () => {
    const { directory } = await build(true, async (fixture) => {
      const outside = join(fixture.directory, "secret.png");
      await writeFile(outside, "secret");
      const run = fixture.store.snapshot().runs[0];
      run.steps[2].screenshotPath = outside;
      await fixture.store.updateRun(run);
    });
    expect(await readdir(join(directory, "evidence"))).toEqual([]);
  });

  it("copes with missing evidence files and runs without steps", async () => {
    const { directory } = await build(true, async (fixture) => {
      const run = fixture.store.snapshot().runs[0];
      run.steps = [];
      run.videoPath = join(fixture.run.resultDirectory, "missing.webm");
      await fixture.store.updateRun(run);
    });
    expect(await readFile(join(directory, "run/failing-step.md"), "utf8")).toContain(
      "No failing step",
    );
    expect(await readFile(join(directory, "run/steps.md"), "utf8")).toContain("No replay steps");
  });

  it("truncates very long logs", async () => {
    const { directory } = await build(false, async (fixture) => {
      const run = fixture.store.snapshot().runs[0];
      run.log = Array.from({ length: 5000 }, (_, index) => `line ${index}`);
      await fixture.store.updateRun(run);
    });
    const lines = (await readFile(join(directory, "run/log.txt"), "utf8")).trim().split("\n");
    expect(lines).toHaveLength(2000);
    expect(lines.at(-1)).toBe("line 4999");
  });

  it("rebuilds a clean folder when the package already exists", async () => {
    const { directory, fixture } = await build(false);
    await mkdir(join(directory, "stale"), { recursive: true });
    await buildFailurePackage({
      directory,
      brief: brief(directory),
      run: fixture.store.snapshot().runs[0],
      test: fixture.test,
      environment: fixture.environment,
      project: fixture.project,
      includeEvidence: false,
    });
    expect((await readdir(directory)).includes("stale")).toBe(false);
    expect(await readFile(join(directory, "project/context.md"), "utf8")).toContain("No app.json");
  });
});

describe("isInside", () => {
  it("accepts children and rejects siblings, parents and the root itself", () => {
    expect(isInside("/a/b", "/a/b/c.png")).toBe(true);
    expect(isInside("/a/b", "/a/b")).toBe(false);
    expect(isInside("/a/b", "/a/c/c.png")).toBe(false);
    expect(isInside("/a/b", "/a/b/../c.png")).toBe(false);
  });
});
