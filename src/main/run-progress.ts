import type { RunProgressEvent, RunProgressKind } from "../shared/models";

const ignoredPatterns = [
  /^PS: (PlayerSpec|ConfigFile)=/,
  /^\(node:.*NO_COLOR/,
  /^\(Use `Electron/,
  /^\[\d+\/\d+\].*player\.spec/,
  /player\.spec\.js:\d+/,
  /^at /,
  /\.run\.yml/,
  /^Running 1 test using/,
];

// The Dutch alternatives in these patterns read logs written by earlier versions.
export function parseRunProgressLine(
  line: string,
  occurredAt = new Date().toISOString(),
): RunProgressEvent | undefined {
  if (ignoredPatterns.some((pattern) => pattern.test(line))) return undefined;
  if (/Runner (?:started|gestart)/i.test(line))
    return event("runner-started", "Run started", line, "neutral", occurredAt);
  if (line.startsWith("Target: ") || line.startsWith("Doel: "))
    return event(
      "target-selected",
      "Target environment",
      line.slice(line.indexOf(": ") + 2),
      "neutral",
      occurredAt,
    );
  if (/Chromium[- ]runtime/i.test(line))
    return event(
      "browser-ready",
      "Browser ready",
      "Chromium is available for replay.",
      "success",
      occurredAt,
    );
  if (/MFA (?:required|vereist)/i.test(line))
    return event("authentication-required", "Authentication required", line, "warning", occurredAt);
  if (
    /MFA (?:complete|voltooid)|session reused|sessie hergebruikt|saved securely|veilig opgeslagen/i.test(
      line,
    )
  )
    return event("authentication-complete", "Authentication complete", line, "success", occurredAt);
  if (/Running \d+ tests?|recording is starting|opname wordt gestart/i.test(line))
    return event("replay-started", "Replay in progress", line, "neutral", occurredAt);
  if (/^(?:Step|Stap)\s+\d+/i.test(line))
    return event("step-started", "Replay step", line, "neutral", occurredAt);
  if (/error|exception|failed|exitcode [1-9]/i.test(line))
    return event("error", "Replay error", line, "error", occurredAt);
  if (/warning|waarschuwing/i.test(line))
    return event("warning", "Attention needed", line, "warning", occurredAt);
  if (/exitcode 0|passed/i.test(line))
    return event("completed", "Run completed", line, "success", occurredAt);
  return event("update", "Replay update", line, "neutral", occurredAt);
}

function event(
  kind: RunProgressKind,
  title: string,
  detail: string,
  tone: RunProgressEvent["tone"],
  occurredAt: string,
): RunProgressEvent {
  return { kind, title, detail, tone, occurredAt };
}
