import { type AppErrorCode, parseAppError } from "../../shared/app-error";

const codes = new Map<string, AppErrorCode>();

/** The readable text of an error. A recovery code is remembered for errorCodeFor(). */
export const messageOf = (cause: unknown) => {
  const raw =
    cause instanceof Error
      ? cause.message.replace(/^Error invoking remote method '[^']+': (?:[A-Za-z]*Error: )?/, "")
      : String(cause);
  const { code, text } = parseAppError(raw);
  if (code) {
    if (codes.size > 50) codes.clear();
    codes.set(text, code);
  }
  return text;
};

export const errorCodeFor = (text: string): AppErrorCode | undefined => codes.get(text);

/** One step that fixes a coded error: where to go and what to call it. */
export const ERROR_ACTIONS: Record<AppErrorCode, { label: string; view: string }> = {
  RUNTIME_MISSING: { label: "Open Settings", view: "settings" },
  CREDENTIAL_MISSING: { label: "Open Environments", view: "environments" },
  AGENT_NOT_FOUND: { label: "Open Help", view: "help" },
  CODE_FOLDER_MISSING: { label: "Open Projects", view: "projects" },
};

export const formatDate = (value: string) =>
  new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(value),
  );

export const formatDuration = (ms?: number) =>
  ms === undefined
    ? "—"
    : ms < 60_000
      ? `${Math.round(ms / 1000)}s`
      : `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;

export const relativeTime = (value: string) => {
  const seconds = Math.round((Date.now() - new Date(value).getTime()) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
};
