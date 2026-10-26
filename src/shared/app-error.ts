/**
 * Errors the user can fix with one step. The code travels in the message as "[CODE] text"
 * because Electron IPC only carries the message; the renderer strips it and offers the action.
 */
export const APP_ERROR_CODES = [
  "RUNTIME_MISSING",
  "CREDENTIAL_MISSING",
  "AGENT_NOT_FOUND",
  "CODE_FOLDER_MISSING",
] as const;

export type AppErrorCode = (typeof APP_ERROR_CODES)[number];

export class AppError extends Error {
  constructor(
    readonly code: AppErrorCode,
    text: string,
  ) {
    super(`[${code}] ${text}`);
    this.name = "AppError";
  }
}

const CODED = new RegExp(`^\\[(${APP_ERROR_CODES.join("|")})\\]\\s*([\\s\\S]*)$`);

export function parseAppError(message: string): { code?: AppErrorCode; text: string } {
  const match = CODED.exec(message);
  return match ? { code: match[1] as AppErrorCode, text: match[2] } : { text: message };
}
