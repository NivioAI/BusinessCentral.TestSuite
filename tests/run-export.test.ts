import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  runExportJson,
  runExportMarkdown,
  sanitizeText,
  sanitizeTextArtifacts,
} from "../src/main/run-export";
import type { TestRun } from "../src/shared/models";

const run: TestRun = {
  id: "run-1",
  testId: "BC-SMOKE-001",
  testDefinitionId: "test-1",
  testName: "Customer | smoke",
  environmentId: "environment-1",
  environmentName: "Sandbox",
  customerCode: "DEMO",
  initiatedBy: "ai-agent",
  status: "FAILED",
  startedAt: "2026-07-20T10:00:00.000Z",
  finishedAt: "2026-07-20T10:00:01.000Z",
  durationMs: 1000,
  parameters: { customer: "10000", apiToken: "must-not-export" },
  versionHash: "abc123",
  resultDirectory: "/tmp/run",
  error: "authorization: abc.def.ghi",
  log: ["password=hunter2", "Authorization: Bearer top-secret"],
  progress: [],
  steps: [{ sequence: 1, status: "FAILED", description: "token=step-secret" }],
};

describe("run export", () => {
  it("redacts supplied and recognizable secrets", () => {
    expect(sanitizeText("value=hunter2", ["hunter2"])).toBe("value=••••••••");
    expect(sanitizeText("Bearer abc.def.ghi")).toBe("Bearer ••••••••");
  });

  it("creates a sanitized JSON export", () => {
    const output = runExportJson(run);
    expect(output).not.toContain("must-not-export");
    expect(output).not.toContain("hunter2");
    expect(output).not.toContain("top-secret");
    expect(JSON.parse(output).parameters.apiToken).toBe("••••••••");
  });

  it("creates a sanitized Markdown export", () => {
    const output = runExportMarkdown(run);
    expect(output).toContain("# BC\\-SMOKE\\-001");
    expect(output).toContain("Customer \\| smoke");
    expect(output).toContain("Initiated by: AI agent");
    expect(output).not.toContain("hunter2");
    expect(output).not.toContain("step-secret");
  });

  it("sanitizes text artifacts while leaving binary evidence untouched", async () => {
    const directory = await mkdtemp(join(tmpdir(), "bcft-export-"));
    await writeFile(join(directory, "report.html"), "<p>password=hunter2</p>");
    await writeFile(join(directory, "video.webm"), Buffer.from([0, 1, 2, 3]));
    await sanitizeTextArtifacts(directory, ["hunter2"]);
    expect(await readFile(join(directory, "report.html"), "utf8")).not.toContain("hunter2");
    expect(await readFile(join(directory, "video.webm"))).toEqual(Buffer.from([0, 1, 2, 3]));
  });
});
