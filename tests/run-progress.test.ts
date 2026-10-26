import { describe, expect, it } from "vitest";
import { parseRunProgressLine } from "../src/main/run-progress";

describe("run progress adapter", () => {
  const occurredAt = "2026-07-21T10:00:00.000Z";

  it.each([
    ["Runner started for BC-001.", "runner-started"],
    ["Runner gestart voor BC-001.", "runner-started"],
    ["Target: https://example.test/", "target-selected"],
    ["MFA required: approve.", "authentication-required"],
    ["Doel: https://businesscentral.dynamics.com/", "target-selected"],
    ["Chromium-runtime beschikbaar.", "browser-ready"],
    ["MFA vereist.", "authentication-required"],
    ["MFA voltooid.", "authentication-complete"],
    ["Running 2 tests", "replay-started"],
    ["Step 3: Open customer", "step-started"],
    ["Warning: slow response", "warning"],
    ["Replay failed", "error"],
    ["exitcode 0", "completed"],
  ])("maps %s to %s", (line, kind) => {
    expect(parseRunProgressLine(line, occurredAt)).toMatchObject({ kind, occurredAt });
  });

  it("ignores runner implementation noise", () => {
    expect(parseRunProgressLine("PS: PlayerSpec=/tmp/player.spec.js", occurredAt)).toBeUndefined();
  });
});
