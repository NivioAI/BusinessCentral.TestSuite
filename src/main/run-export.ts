import { readFile, readdir, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import type { TestRun } from "../shared/models";

const REDACTED = "••••••••";
const SENSITIVE_KEY = /password|passwd|secret|token|authorization|cookie|credential|mfa/i;
const SANITIZABLE_EXTENSIONS = new Set([".html", ".json", ".log", ".txt", ".xml", ".yaml", ".yml"]);
const MAX_SANITIZABLE_FILE_BYTES = 20_000_000;

export function sanitizeText(value: string, knownSecrets: string[] = []): string {
  let output = knownSecrets.reduce(
    (current, secret) => (secret ? current.split(secret).join(REDACTED) : current),
    value,
  );
  output = output.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, `Bearer ${REDACTED}`);
  output = output.replace(
    /\b(password|passwd|secret|token|authorization|cookie|credential|mfa(?:Code)?)\b(\s*[:=]\s*)([^\s,;]+)/gi,
    (_match, key: string, separator: string) => `${key}${separator}${REDACTED}`,
  );
  output = output.replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, REDACTED);
  return output;
}

export function sanitizeRun(run: TestRun): TestRun {
  const copy = structuredClone(run);
  copy.log = copy.log.map((line) => sanitizeText(line));
  copy.error = copy.error ? sanitizeText(copy.error) : undefined;
  copy.steps = copy.steps.map((step) => ({
    ...step,
    description: sanitizeText(step.description),
  }));
  copy.parameters = Object.fromEntries(
    Object.entries(copy.parameters).map(([key, value]) => [
      key,
      SENSITIVE_KEY.test(key) ? REDACTED : typeof value === "string" ? sanitizeText(value) : value,
    ]),
  );
  return copy;
}

export function runExportJson(run: TestRun): string {
  return `${JSON.stringify(sanitizeRun(run), null, 2)}\n`;
}

export function runExportMarkdown(run: TestRun): string {
  const safe = sanitizeRun(run);
  const lines = [
    `# ${escapeMarkdown(safe.testId)} — ${escapeMarkdown(safe.testName)}`,
    "",
    `- Status: **${safe.status}**`,
    `- Customer: ${escapeMarkdown(safe.customerCode)}`,
    `- Target: ${escapeMarkdown(safe.environmentName)}`,
    `- Initiated by: ${safe.initiatedBy === "ai-agent" ? "AI agent" : "User"}`,
    `- Started: ${safe.startedAt}`,
    `- Finished: ${safe.finishedAt ?? "—"}`,
    `- Duration: ${safe.durationMs === undefined ? "—" : `${safe.durationMs} ms`}`,
    `- Test version: \`${safe.versionHash}\``,
    "",
    "## Parameters",
    "",
  ];
  const parameters = Object.entries(safe.parameters);
  if (parameters.length) {
    lines.push("| Name | Value |", "|---|---|");
    for (const [name, value] of parameters) {
      lines.push(`| ${escapeTable(name)} | ${escapeTable(String(value))} |`);
    }
  } else {
    lines.push("No parameters recorded.");
  }
  lines.push("", "## Steps", "");
  if (safe.steps.length) {
    lines.push("| # | Status | Description | Duration |", "|---:|---|---|---:|");
    for (const step of safe.steps) {
      lines.push(
        `| ${step.sequence} | ${step.status} | ${escapeTable(step.description)} | ${step.durationMs === undefined ? "—" : `${step.durationMs} ms`} |`,
      );
    }
  } else {
    lines.push("No replay steps recorded.");
  }
  if (safe.error) lines.push("", "## Error", "", sanitizeText(safe.error));
  lines.push(
    "",
    "## Activity",
    "",
    ...(safe.log.length
      ? safe.log.map((line) => `- ${escapeMarkdown(line)}`)
      : ["No activity recorded."]),
    "",
  );
  return lines.join("\n");
}

export async function sanitizeTextArtifacts(
  directory: string,
  knownSecrets: string[] = [],
): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return sanitizeTextArtifacts(path, knownSecrets);
      if (!entry.isFile() || !SANITIZABLE_EXTENSIONS.has(extname(entry.name).toLowerCase())) return;
      const contents = await readFile(path);
      if (contents.byteLength > MAX_SANITIZABLE_FILE_BYTES || contents.includes(0)) return;
      const original = contents.toString("utf8");
      const sanitized = sanitizeText(original, knownSecrets);
      if (sanitized !== original) {
        await writeFile(path, sanitized, { encoding: "utf8", mode: 0o600 });
      }
    }),
  );
}

function escapeMarkdown(value: string): string {
  return value.replace(/([\\`*_{}\[\]()#+.!|-])/g, "\\$1");
}

function escapeTable(value: string): string {
  return sanitizeText(value).replaceAll("|", "\\|").replace(/\r?\n/g, " ");
}
