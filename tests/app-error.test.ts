import { describe, expect, it } from "vitest";
import { APP_ERROR_CODES, AppError, parseAppError } from "../src/shared/app-error";

describe("AppError", () => {
  it("carries the code in the message and parses it back", () => {
    const error = new AppError("RUNTIME_MISSING", "PowerShell 7 is required.");
    expect(error.message).toBe("[RUNTIME_MISSING] PowerShell 7 is required.");
    expect(error.code).toBe("RUNTIME_MISSING");
    expect(parseAppError(error.message)).toEqual({
      code: "RUNTIME_MISSING",
      text: "PowerShell 7 is required.",
    });
  });

  it("leaves plain and unknown-coded messages alone", () => {
    expect(parseAppError("The test no longer exists.")).toEqual({
      text: "The test no longer exists.",
    });
    expect(parseAppError("[NOT_A_CODE] hello")).toEqual({ text: "[NOT_A_CODE] hello" });
    expect(parseAppError("text [RUNTIME_MISSING] later")).toEqual({
      text: "text [RUNTIME_MISSING] later",
    });
  });

  it("keeps multi-line messages intact", () => {
    expect(parseAppError("[AGENT_NOT_FOUND] one\ntwo").text).toBe("one\ntwo");
  });

  it("lists every code once", () => {
    expect(new Set(APP_ERROR_CODES).size).toBe(APP_ERROR_CODES.length);
  });
});
