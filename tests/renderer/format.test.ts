import { describe, expect, it } from "vitest";
import { ERROR_ACTIONS, errorCodeFor, messageOf } from "../../src/renderer/lib/format";
import { APP_ERROR_CODES, AppError } from "../../src/shared/app-error";

describe("messageOf", () => {
  it("removes the Electron wrapper and the recovery code, and remembers the code", () => {
    const wrapped = new Error(
      "Error invoking remote method 'bcft:run:start': Error: [CREDENTIAL_MISSING] Store a credential.",
    );
    const text = messageOf(wrapped);
    expect(text).toBe("Store a credential.");
    expect(errorCodeFor(text)).toBe("CREDENTIAL_MISSING");
  });

  it("returns plain errors unchanged and without a code", () => {
    expect(messageOf(new Error("Nope."))).toBe("Nope.");
    expect(errorCodeFor("Nope.")).toBeUndefined();
    expect(messageOf("plain string")).toBe("plain string");
  });

  it("handles a thrown AppError directly", () => {
    expect(messageOf(new AppError("CODE_FOLDER_MISSING", "Folder is gone."))).toBe(
      "Folder is gone.",
    );
  });

  it("offers a recovery action for every code", () => {
    for (const code of APP_ERROR_CODES) {
      expect(ERROR_ACTIONS[code].label).toBeTruthy();
      expect(ERROR_ACTIONS[code].view).toBeTruthy();
    }
  });

  it("also strips the error name Electron puts before the message", () => {
    const wrapped = new Error(
      "Error invoking remote method 'bcft:investigation:start-agent': AppError: [CODE_FOLDER_MISSING] The code folder is gone.",
    );
    const text = messageOf(wrapped);
    expect(text).toBe("The code folder is gone.");
    expect(errorCodeFor(text)).toBe("CODE_FOLDER_MISSING");
  });
});
