import { readFile, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { InvestigationService, type InvestigationShell } from "../src/main/investigation-service";
import { type Fixture, createFixture } from "./helpers/investigation-fixture";

function shell(confirm = true) {
  const calls = { copied: [] as string[], revealed: [] as string[], confirms: 0 };
  const value: InvestigationShell = {
    confirm: async () => {
      calls.confirms += 1;
      return confirm;
    },
    copyText: (text) => calls.copied.push(text),
    reveal: (path) => calls.revealed.push(path),
  };
  return { value, calls };
}

async function setup(options?: Parameters<typeof createFixture>[0], confirm = true) {
  const fixture = await createFixture(options);
  const fake = shell(confirm);
  const needsUser: Array<{ number: number; status: string; project: string }> = [];
  const service = new InvestigationService(
    fixture.store,
    fixture.directory,
    fake.value,
    (investigation, project) =>
      needsUser.push({ number: investigation.number, status: investigation.status, project }),
  );
  return { fixture, service, fake, needsUser };
}

async function create(fixture: Fixture, service: InvestigationService, includeEvidence = false) {
  await service.create({ runId: fixture.run.id, projectId: fixture.project.id, includeEvidence });
  return fixture.store.snapshot().investigations[0];
}

const later = async (path: string) => {
  const future = new Date(Date.now() + 5000);
  await utimes(path, future, future);
};

describe("InvestigationService", () => {
  it("creates an investigation with a package for a failed run", async () => {
    const { fixture, service } = await setup();
    const investigation = await create(fixture, service);
    expect(investigation).toMatchObject({
      number: 1,
      status: "PACKAGE_READY",
      projectId: fixture.project.id,
    });
    const failure = JSON.parse(
      await readFile(
        join(fixture.directory, "investigations", investigation.id, "package", "failure.json"),
        "utf8",
      ),
    );
    expect(failure.test.id).toBe("BC-2");
  });

  it("also accepts a run that ended in a technical error", async () => {
    const { fixture, service } = await setup({ runStatus: "ERROR" });
    expect((await create(fixture, service)).status).toBe("PACKAGE_READY");
  });

  it("refuses runs that did not fail, missing runs and projects", async () => {
    const passed = await setup({ runStatus: "PASSED" });
    await expect(
      passed.service.create({
        runId: passed.fixture.run.id,
        projectId: passed.fixture.project.id,
        includeEvidence: false,
      }),
    ).rejects.toThrow("failed run");
    const { fixture, service } = await setup();
    await expect(
      service.create({ runId: "missing", projectId: fixture.project.id, includeEvidence: false }),
    ).rejects.toThrow("run no longer exists");
    await expect(
      service.create({
        runId: fixture.run.id,
        projectId: "00000000-0000-4000-8000-000000000099",
        includeEvidence: false,
      }),
    ).rejects.toThrow("active project");
  });

  it("refuses an archived project, another environment and a duplicate open investigation", async () => {
    const { fixture, service } = await setup();
    await service.create({
      runId: fixture.run.id,
      projectId: fixture.project.id,
      includeEvidence: false,
    });
    await expect(
      service.create({
        runId: fixture.run.id,
        projectId: fixture.project.id,
        includeEvidence: false,
      }),
    ).rejects.toThrow("already an open investigation");

    const other = await setup();
    await other.fixture.store.saveEnvironment({
      customerId: other.fixture.environment.customerId,
      customerCode: "DEMO",
      customerName: "Demo",
      tenantId: "tenant",
      name: "UAT",
      company: "CRONUS",
      type: "uat",
      baseUrl: "http://localhost:8080/uat",
      authentication: "Windows",
    });
    const uat = other.fixture.store.snapshot().environments[1];
    await other.fixture.store.saveProject({
      environmentId: uat.id,
      name: "UAT AL",
      agent: "codex",
    });
    const uatProject = other.fixture.store.snapshot().projects[1];
    await expect(
      other.service.create({
        runId: other.fixture.run.id,
        projectId: uatProject.id,
        includeEvidence: false,
      }),
    ).rejects.toThrow("not belong to this run");
    await other.fixture.store.setEntityArchived("project", other.fixture.project.id, true);
    await expect(
      other.service.create({
        runId: other.fixture.run.id,
        projectId: other.fixture.project.id,
        includeEvidence: false,
      }),
    ).rejects.toThrow("active project");
  });

  it("builds a prompt that points at the package and marks the hand-off when copied", async () => {
    const { fixture, service, fake } = await setup();
    const investigation = await create(fixture, service);
    const prompt = service.prompt(investigation.id, "codex");
    expect(prompt).toContain("Codex");
    expect(prompt).toContain(
      join(fixture.directory, "investigations", investigation.id, "package"),
    );
    expect(prompt).toContain("fix/BC-2-1");
    await service.copyPrompt(investigation.id, "codex");
    expect(fake.calls.copied).toEqual([prompt]);
    const updated = fixture.store.findInvestigation(investigation.id);
    expect(updated?.status).toBe("HANDED_OFF");
    expect(updated?.iterations[0].agent).toBe("codex");
    expect(() => service.prompt("00000000-0000-4000-8000-000000000099", "codex")).toThrow(
      "no longer exists",
    );
  });

  it("imports the plan, then the change, from the agent folder", async () => {
    const { fixture, service } = await setup();
    const investigation = await create(fixture, service);
    const agentDirectory = join(fixture.directory, "investigations", investigation.id, "agent");

    await expect(service.importAgentOutput(investigation.id)).rejects.toThrow("plan.md");
    await writeFile(join(agentDirectory, "plan.md"), "# Plan\nChange the codeunit.");
    await later(join(agentDirectory, "plan.md"));
    await service.importAgentOutput(investigation.id);
    expect(fixture.store.findInvestigation(investigation.id)).toMatchObject({
      status: "PLAN_RECEIVED",
    });

    await expect(service.importAgentOutput(investigation.id)).rejects.toThrow("no agent result");
    await service.decide({ id: investigation.id, decision: "approved" });
    await expect(service.importAgentOutput(investigation.id)).rejects.toThrow("change.json");
    await writeFile(
      join(agentDirectory, "change.json"),
      JSON.stringify({
        summary: "Fixed",
        branch: "fix/BC-2-1",
        commit: "a41c9d2",
        files: ["Codeunit.al"],
      }),
    );
    await later(join(agentDirectory, "change.json"));
    await service.importAgentOutput(investigation.id);
    const updated = fixture.store.findInvestigation(investigation.id);
    expect(updated?.status).toBe("CHANGE_APPLIED");
    expect(updated?.iterations[0].change).toMatchObject({
      branch: "fix/BC-2-1",
      commit: "a41c9d2",
    });
  });

  it("ignores an old plan after the user asked for changes", async () => {
    const { fixture, service } = await setup();
    const investigation = await create(fixture, service);
    const agentDirectory = join(fixture.directory, "investigations", investigation.id, "agent");
    await writeFile(join(agentDirectory, "plan.md"), "# Plan");
    await later(join(agentDirectory, "plan.md"));
    await service.importAgentOutput(investigation.id);
    await writeFile(join(agentDirectory, "plan.md"), "# Plan");
    const past = new Date(Date.now() - 60_000);
    await utimes(join(agentDirectory, "plan.md"), past, past);
    await service.decide({ id: investigation.id, decision: "changes-requested", note: "Narrower" });
    await expect(service.importAgentOutput(investigation.id)).rejects.toThrow("plan.md");
    expect(service.prompt(investigation.id, "claude-code")).toContain("Narrower");
  });

  it("records a manual change, verifies on a passing retest and rebuilds after a failing one", async () => {
    const { fixture, service } = await setup();
    const investigation = await create(fixture, service);
    await service.copyPrompt(investigation.id, "claude-code");
    await writeFile(
      join(fixture.directory, "investigations", investigation.id, "agent", "plan.md"),
      "# Plan",
    );
    await later(join(fixture.directory, "investigations", investigation.id, "agent", "plan.md"));
    await service.importAgentOutput(investigation.id);
    await service.decide({ id: investigation.id, decision: "approved" });
    await service.recordChange({
      id: investigation.id,
      summary: "Fix",
      branch: "fix/BC-2-1",
      files: ["a.al"],
    });

    const failing = {
      ...fixture.run,
      id: "run-2",
      status: "FAILED" as const,
      startedAt: new Date().toISOString(),
    };
    await fixture.store.addRun(failing);
    await service.onRunFinished(failing);
    expect(fixture.store.findInvestigation(investigation.id)?.status).toBe("RETEST_FAILED");

    await service.nextRound(investigation.id);
    const second = fixture.store.findInvestigation(investigation.id);
    expect(second).toMatchObject({ status: "PACKAGE_READY" });
    expect(second?.iterations).toHaveLength(2);
    const brief = await readFile(
      join(fixture.directory, "investigations", investigation.id, "package", "AGENT-BRIEF.md"),
      "utf8",
    );
    expect(brief).toContain("round 2");
    expect(brief).toContain("Fix");
  });

  it("verifies the investigation when the retest passes", async () => {
    const { fixture, service } = await setup();
    const investigation = await create(fixture, service);
    const agentDirectory = join(fixture.directory, "investigations", investigation.id, "agent");
    await writeFile(join(agentDirectory, "plan.md"), "# Plan");
    await later(join(agentDirectory, "plan.md"));
    await service.importAgentOutput(investigation.id);
    await service.decide({ id: investigation.id, decision: "approved" });
    await service.recordChange({ id: investigation.id, summary: "Fix", branch: "b", files: [] });
    const passing = {
      ...fixture.run,
      id: "run-3",
      status: "PASSED" as const,
      startedAt: new Date().toISOString(),
    };
    await service.onRunFinished(passing);
    expect(fixture.store.findInvestigation(investigation.id)?.status).toBe("VERIFIED");
  });

  it("exports the package into the project after confirmation only", async () => {
    const declined = await setup(undefined, false);
    const first = await create(declined.fixture, declined.service);
    await declined.service.exportPackage(first.id);
    expect(declined.fixture.store.findInvestigation(first.id)?.exportedPath).toBeUndefined();

    const { fixture, service, fake } = await setup();
    const investigation = await create(fixture, service);
    await service.exportPackage(investigation.id);
    const exported = join(fixture.codePath, ".nivio", "investigations", investigation.id);
    expect(fake.calls.confirms).toBe(1);
    expect(fixture.store.findInvestigation(investigation.id)?.exportedPath).toBe(exported);
    expect(await readFile(join(exported, "package", "AGENT-BRIEF.md"), "utf8")).toContain(exported);
    expect(service.prompt(investigation.id, "other")).toContain(join(exported, "package"));
    service.reveal(investigation.id);
    expect(fake.calls.revealed).toEqual([join(exported, "package")]);
  });

  it("cannot export without a code folder", async () => {
    const { fixture, service } = await setup();
    const investigation = await create(fixture, service);
    await fixture.store.saveProject({ ...fixture.project, codePath: undefined });
    await expect(service.exportPackage(investigation.id)).rejects.toThrow("no code folder");
    await expect(service.exportPackage(investigation.id)).rejects.toMatchObject({
      code: "CODE_FOLDER_MISSING",
    });
    await fixture.store.saveProject({
      ...fixture.project,
      codePath: join(fixture.directory, "gone"),
    });
    await expect(service.exportPackage(investigation.id)).rejects.toThrow("no longer exists");
  });

  it("inspects a project and abandons an investigation", async () => {
    const { fixture, service } = await setup();
    expect(await service.inspectProject(fixture.project.id)).toMatchObject({
      isGitRepository: true,
      branch: "main",
    });
    await expect(service.inspectProject("00000000-0000-4000-8000-000000000099")).rejects.toThrow(
      "project no longer exists",
    );
    await fixture.store.saveProject({ ...fixture.project, codePath: undefined });
    expect((await service.inspectProject(fixture.project.id)).exists).toBe(false);
    const investigation = await create(fixture, service);
    await service.abandon(investigation.id);
    expect(fixture.store.findInvestigation(investigation.id)?.status).toBe("ABANDONED");
  });

  describe("notifications", () => {
    it("tells the shell only when the investigation starts to wait for the user", async () => {
      const { fixture, service, needsUser } = await setup();
      const investigation = await create(fixture, service);
      expect(needsUser).toEqual([]);

      await service.submitPlan(investigation.id, "## Analysis\nMissing field.");
      expect(needsUser).toEqual([{ number: 1, status: "PLAN_RECEIVED", project: "Sales AL" }]);

      await service.decide({ id: investigation.id, decision: "approved" });
      expect(needsUser).toHaveLength(1);

      await service.reportChange(investigation.id, {
        summary: "Add field",
        branch: "fix/bc-2-1",
        files: [],
      });
      expect(needsUser.map((item) => item.status)).toEqual(["PLAN_RECEIVED", "CHANGE_APPLIED"]);
    });
  });

  describe("agent round trip", () => {
    it("lets an agent read the package, submit a plan and report a change after approval", async () => {
      const { fixture, service } = await setup();
      const investigation = await create(fixture, service);
      expect(service.listForAgent()).toMatchObject([
        { id: investigation.id, status: "PACKAGE_READY" },
      ]);

      const detail = await service.getForAgent(investigation.id);
      expect(Object.keys(detail.files)).toContain("failure.json");
      expect(JSON.stringify(detail.files)).not.toContain("hunter2");

      await service.submitPlan(investigation.id, "## Analysis\nMissing field.");
      expect(service.decisionForAgent(investigation.id)).toMatchObject({ status: "PLAN_RECEIVED" });
      await expect(
        service.reportChange(investigation.id, { summary: "x", branch: "fix/a", files: [] }),
      ).rejects.toThrow(/PLAN_RECEIVED/);

      await service.decide({ id: investigation.id, decision: "approved" });
      expect(service.decisionForAgent(investigation.id)).toMatchObject({ decision: "approved" });
      await service.reportChange(investigation.id, {
        summary: "Add field",
        branch: "fix/bc-2-1",
        files: ["a.al"],
      });
      expect(fixture.store.snapshot().investigations[0].status).toBe("CHANGE_APPLIED");
      expect(service.listForAgent()).toHaveLength(1);
    });

    it("rejects empty and oversized plans and hides closed investigations", async () => {
      const { fixture, service } = await setup();
      const investigation = await create(fixture, service);
      await expect(service.submitPlan(investigation.id, "")).rejects.toThrow();
      await expect(service.submitPlan(investigation.id, "x".repeat(100_001))).rejects.toThrow(
        /too large/,
      );
      await service.abandon(investigation.id);
      expect(service.listForAgent()).toEqual([]);
    });
  });
});
