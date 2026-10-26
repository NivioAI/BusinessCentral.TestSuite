import { describe, expect, it } from "vitest";
import { validateStorageState } from "../src/main/storage-state";

describe("Playwright storage state", () => {
  it("accepts a valid cookie state", () => {
    expect(() =>
      validateStorageState(
        JSON.stringify({
          cookies: [{ name: "session", value: "token", domain: ".microsoft.com" }],
          origins: [],
        }),
      ),
    ).not.toThrow();
  });

  it("rejects malformed state", () => {
    expect(() => validateStorageState('{"cookies":"invalid","origins":[]}')).toThrow(
      "Invalid session file.",
    );
  });
});
