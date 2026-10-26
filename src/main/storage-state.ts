export function validateStorageState(value: string): void {
  if (Buffer.byteLength(value, "utf8") > 2_000_000)
    throw new Error("The session file is too large.");
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== "object") throw new Error("Invalid session file.");
  const state = parsed as Record<string, unknown>;
  if (!Array.isArray(state.cookies) || !Array.isArray(state.origins)) {
    throw new Error("Invalid session file.");
  }
  for (const cookie of state.cookies) {
    if (
      !cookie ||
      typeof cookie !== "object" ||
      typeof (cookie as Record<string, unknown>).name !== "string" ||
      typeof (cookie as Record<string, unknown>).value !== "string" ||
      typeof (cookie as Record<string, unknown>).domain !== "string"
    ) {
      throw new Error("Invalid session file.");
    }
  }
}
