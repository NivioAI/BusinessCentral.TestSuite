import { branchName } from "../shared/branch-name";
import type { AgentKind } from "../shared/models";

export interface BriefContext {
  investigationNumber: number;
  iterationNumber: number;
  projectName: string;
  testId: string;
  testName: string;
  environmentName: string;
  packagePath: string;
  agentPath: string;
  instructions?: string;
  decisionNote?: string;
  previousChange?: string;
}

const AGENT_NAMES: Record<AgentKind, string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
  other: "your coding agent",
};

/** The short prompt the user pastes into the agent. It points at the package. */
export function agentPrompt(context: BriefContext, agent: AgentKind): string {
  const lines = [
    `You are ${agent === "other" ? "working" : `${AGENT_NAMES[agent]}, working`} in the AL repository of project "${context.projectName}".`,
    `A Business Central test failed (${context.testId} ${context.testName}). Read the package at:`,
    `  ${context.packagePath}`,
    "",
    "1. Read AGENT-BRIEF.md, failure.json and run/failing-step.md.",
    "2. Find the cause in this repository. Do not change any code yet.",
    `3. Write your plan to ${context.agentPath}/plan.md: analysis, proposed changes, risks, tests to run.`,
    "4. Stop and tell the user the plan is ready. Wait for their approval.",
    `5. After approval, work on branch ${branchName(context.testId, context.iterationNumber)}, commit locally, never push.`,
    `6. Write ${context.agentPath}/change.json with summary, branch, commit and files, then tell the user the change is ready to publish and retest.`,
  ];
  if (context.decisionNote) {
    lines.push("", `The user asked for changes to the previous plan: ${context.decisionNote}`);
  }
  return lines.join("\n");
}

/** AGENT-BRIEF.md inside the package: the full rules for the agent. */
export function agentBriefMarkdown(context: BriefContext): string {
  return [
    `# Investigation INV-${context.investigationNumber}, round ${context.iterationNumber}`,
    "",
    `Project: ${context.projectName}`,
    `Failed test: ${context.testId} ${context.testName}`,
    `Environment: ${context.environmentName}`,
    "",
    "## Your task",
    "",
    "A Business Central Page Script test failed. Find out why in the AL code of this repository,",
    "propose a fix, and wait for the user to approve it before changing anything.",
    "",
    "## Evidence in this package",
    "",
    "- `failure.json`: machine-readable summary of the run, the failing step and the environment.",
    "- `run/failing-step.md`: the failing step with the steps before it.",
    "- `run/steps.md` and `run/log.txt`: the full run, secrets masked.",
    "- `test/page-script.yml`: the original Page Script.",
    "- `evidence/`: screenshots (and video) when the user included evidence.",
    "- `project/context.md`: the project, branch and AL apps.",
    "",
    "## Rules",
    "",
    "1. Do not change any code before the user has approved your plan.",
    `2. Write the plan to \`${context.agentPath}/plan.md\` (plain markdown, under 100 kB) with the headings`,
    "   Analysis, Proposed changes, Risks and Tests to run after the change.",
    `3. After approval, create branch \`${branchName(context.testId, context.iterationNumber)}\`, make the smallest change that fixes the cause, and commit locally.`,
    "4. Never push, never publish the extension, never touch production, never read or ask for credentials.",
    "5. Do not edit the Page Script unless the plan says the test itself is wrong, and say so explicitly.",
    `6. Write \`${context.agentPath}/change.json\`: {"summary": "...", "branch": "...", "commit": "...", "files": ["..."]}.`,
    "7. The user publishes the change to the sandbox and starts the retest in NIVIO Test Suite.",
    "",
    ...(context.instructions ? ["## Project instructions", "", context.instructions, ""] : []),
    ...(context.decisionNote
      ? ["## Feedback on the previous plan", "", context.decisionNote, ""]
      : []),
    ...(context.previousChange
      ? [
          "## Previous round",
          "",
          context.previousChange,
          "The retest still failed; see the new evidence.",
          "",
        ]
      : []),
  ].join("\n");
}
