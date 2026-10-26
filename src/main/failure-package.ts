import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, isAbsolute, join, relative } from "node:path";
import type {
  BcEnvironment,
  Project,
  ProjectInspection,
  TestDefinition,
  TestRun,
} from "../shared/models";
import { type BriefContext, agentBriefMarkdown } from "./agent-brief";
import { sanitizeRun, sanitizeText } from "./run-export";

const MAX_LOG_LINES = 2000;
const MAX_EVIDENCE_FILES = 6;

export interface FailurePackageInput {
  directory: string;
  brief: BriefContext;
  run: TestRun;
  test: TestDefinition;
  environment: BcEnvironment;
  project: Project;
  inspection?: ProjectInspection;
  includeEvidence: boolean;
}

/** True when `path` is inside `root`, so evidence can never be read from elsewhere. */
export function isInside(root: string, path: string): boolean {
  const difference = relative(root, path);
  return Boolean(difference) && !difference.startsWith("..") && !isAbsolute(difference);
}

/**
 * Builds the folder an agent receives. Everything is rebuilt from the run and the stored test,
 * with secrets masked, and written only inside the application's own storage.
 */
export async function buildFailurePackage(input: FailurePackageInput): Promise<void> {
  const { directory, run, test, environment, project } = input;
  const safeRun = sanitizeRun(run);
  await rm(directory, { recursive: true, force: true });
  for (const folder of ["test", "run", "evidence", "project"]) {
    await mkdir(join(directory, folder), { recursive: true });
  }

  const failingIndex = safeRun.steps.findIndex((step) => step.status !== "PASSED");
  const failing = failingIndex >= 0 ? safeRun.steps[failingIndex] : undefined;

  await writeFile(join(directory, "README.md"), packageReadme(input.brief), "utf8");
  await writeFile(join(directory, "AGENT-BRIEF.md"), agentBriefMarkdown(input.brief), "utf8");
  await writeFile(
    join(directory, "failure.json"),
    `${JSON.stringify(
      {
        investigation: input.brief.investigationNumber,
        round: input.brief.iterationNumber,
        test: { id: test.testId, name: test.name, risk: test.risk, tags: test.tags },
        run: {
          status: safeRun.status,
          startedAt: safeRun.startedAt,
          durationMs: safeRun.durationMs,
          error: safeRun.error,
          parameters: safeRun.parameters,
        },
        failingStep: failing
          ? { sequence: failing.sequence, description: failing.description, status: failing.status }
          : undefined,
        environment: {
          name: environment.name,
          type: environment.type,
          company: environment.company,
          authentication: environment.authentication,
        },
        project: { name: project.name, branch: input.inspection?.branch },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  const recording = sanitizeText(await readFile(test.recordingPath, "utf8"));
  await writeFile(join(directory, "test", "page-script.yml"), recording, "utf8");

  await writeFile(join(directory, "run", "steps.md"), stepsMarkdown(safeRun, failingIndex), "utf8");
  await writeFile(
    join(directory, "run", "failing-step.md"),
    failingStepMarkdown(safeRun, failingIndex),
    "utf8",
  );
  await writeFile(
    join(directory, "run", "log.txt"),
    `${safeRun.log.slice(-MAX_LOG_LINES).join("\n")}\n`,
    "utf8",
  );
  await writeFile(
    join(directory, "project", "context.md"),
    projectContextMarkdown(project, input.inspection),
    "utf8",
  );

  if (input.includeEvidence) await copyEvidence(directory, run);
}

async function copyEvidence(directory: string, run: TestRun): Promise<void> {
  const candidates = [
    ...run.steps
      .filter((step) => step.status !== "PASSED" && step.screenshotPath)
      .map((step) => step.screenshotPath),
    run.videoPath,
  ].filter((path): path is string => Boolean(path));
  let copied = 0;
  for (const source of candidates) {
    if (copied >= MAX_EVIDENCE_FILES) break;
    if (!isInside(run.resultDirectory, source)) continue;
    await copyFile(source, join(directory, "evidence", basename(source))).then(
      () => {
        copied += 1;
      },
      () => undefined,
    );
  }
}

function packageReadme(brief: BriefContext): string {
  return [
    `# Failure package for ${brief.testId}`,
    "",
    "Created by NIVIO Test Suite from a failed Business Central test run.",
    "",
    "- Start with `AGENT-BRIEF.md`.",
    "- Secrets are masked. There are no credentials in this package.",
    "- Screenshots and video, when present, can show customer data.",
    "- Do not change code before the user approves your plan.",
    "",
  ].join("\n");
}

function stepsMarkdown(run: TestRun, failingIndex: number): string {
  const lines = ["# Steps", ""];
  for (const [index, step] of run.steps.entries()) {
    const marker = index === failingIndex ? " **← failed**" : "";
    const duration = step.durationMs === undefined ? "" : ` (${step.durationMs} ms)`;
    lines.push(`${step.sequence}. [${step.status}] ${step.description}${duration}${marker}`);
  }
  if (!run.steps.length) lines.push("No replay steps were recorded.");
  return `${lines.join("\n")}\n`;
}

function failingStepMarkdown(run: TestRun, failingIndex: number): string {
  if (failingIndex < 0) {
    return `# Failure\n\nNo failing step was recorded.\n\nRun error: ${run.error ?? "none"}\n`;
  }
  const failing = run.steps[failingIndex];
  const before = run.steps.slice(Math.max(0, failingIndex - 3), failingIndex);
  return [
    "# Failing step",
    "",
    `Step ${failing.sequence}: ${failing.description}`,
    `Status: ${failing.status}`,
    `Run error: ${run.error ?? "none"}`,
    "",
    "## Steps just before it",
    "",
    ...before.map((step) => `${step.sequence}. [${step.status}] ${step.description}`),
    "",
    "Read the Page Script in `test/page-script.yml` to see which page, field or action this step targets.",
    "",
  ].join("\n");
}

function projectContextMarkdown(project: Project, inspection?: ProjectInspection): string {
  return [
    `# Project ${project.name}`,
    "",
    `Branch: ${inspection?.branch ?? "unknown"}`,
    "",
    "## AL apps",
    "",
    ...(inspection?.apps.length
      ? inspection.apps.map((app) => `- ${app.name} ${app.version} (${app.path})`)
      : ["No app.json files were found."]),
    "",
    ...(project.instructions ? ["## Project instructions", "", project.instructions, ""] : []),
  ].join("\n");
}
