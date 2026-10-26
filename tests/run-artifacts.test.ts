import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { collectRunArtifacts } from "../src/main/run-artifacts";

describe("Run artifacts", () => {
  it("maps replay-log entries to readable step results", async () => {
    const resultDirectory = await mkdtemp(join(tmpdir(), "bcft-artifacts-"));
    const testResults = join(resultDirectory, "test-results", "run");
    await mkdir(testResults, { recursive: true });
    await writeFile(
      join(testResults, "replay-log.yml"),
      [
        "steps:",
        "  - description: Navigate to <caption>Customers</caption>",
        "    log:",
        "      start: 2026-07-16T19:24:09.037Z",
        "      duration: 1436",
        "log:",
        "  start: 2026-07-16T19:24:03.642Z",
      ].join("\n"),
      "utf8",
    );

    await expect(collectRunArtifacts(resultDirectory)).resolves.toEqual({
      steps: [
        {
          sequence: 1,
          status: "PASSED",
          description: "Navigate to Customers",
          durationMs: 1436,
        },
      ],
      videoPath: undefined,
    });
  });

  it("marks only the final executed step as failed for failure evidence", async () => {
    const resultDirectory = await mkdtemp(join(tmpdir(), "bcft-artifacts-"));
    await writeFile(
      join(resultDirectory, "replay-log.yml"),
      [
        "steps:",
        "  - description: Open customers",
        "  - description: Validate blocked action",
      ].join("\n"),
      "utf8",
    );

    const artifacts = await collectRunArtifacts(resultDirectory, true);

    expect(artifacts.steps.map((step) => step.status)).toEqual(["PASSED", "FAILED"]);
  });
});
