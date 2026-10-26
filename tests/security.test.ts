import { describe, expect, it } from "vitest";
import { redactSecrets, stripAnsi } from "../src/main/runner";
import { isAllowedBusinessCentralUrl } from "../src/main/runtime";
import { environmentInputSchema, testRecordingUpdateInputSchema } from "../src/shared/schemas";

describe("Security guardrails", () => {
  it("redacts every occurrence of a supplied secret", () => {
    expect(redactSecrets("password=hunter2; retry hunter2", ["hunter2"])).toBe(
      "password=••••••••; retry ••••••••",
    );
  });

  it("removes terminal styling and cursor control codes", () => {
    expect(stripAnsi("\u001b[1A\u001b[2K\u001b[34mRunning 1 test\u001b[0m")).toBe("Running 1 test");
  });

  it("only allows HTTPS or localhost environment URLs", () => {
    const base = {
      customerCode: "DEMO",
      customerName: "Demo",
      tenantId: "tenant",
      name: "Sandbox",
      company: "CRONUS",
      type: "sandbox" as const,
      authentication: "AAD" as const,
    };
    expect(
      environmentInputSchema.safeParse({
        ...base,
        baseUrl: "https://businesscentral.dynamics.com/tenant/sandbox",
      }).success,
    ).toBe(true);
    expect(
      environmentInputSchema.safeParse({ ...base, baseUrl: "http://evil.example.com" }).success,
    ).toBe(false);
    expect(
      environmentInputSchema.safeParse({ ...base, baseUrl: "https://evil.example.com" }).success,
    ).toBe(false);
    expect(
      environmentInputSchema.safeParse({ ...base, baseUrl: "http://localhost:8080/bc" }).success,
    ).toBe(true);
  });

  it("allows explicit HTTPS Business Central hosts without allowing lookalikes", () => {
    expect(isAllowedBusinessCentralUrl("https://bc.contoso.example/", "bc.contoso.example")).toBe(
      true,
    );
    expect(
      isAllowedBusinessCentralUrl("https://bc.contoso.example.evil.test/", "bc.contoso.example"),
    ).toBe(false);
    expect(isAllowedBusinessCentralUrl("http://bc.contoso.example/", "bc.contoso.example")).toBe(
      false,
    );
  });

  it("accepts only a UUID when selecting a test recording to update", () => {
    expect(
      testRecordingUpdateInputSchema.safeParse({
        testId: "31ef45cc-b5d7-4754-8860-a8ce1f87a51d",
      }).success,
    ).toBe(true);
    expect(testRecordingUpdateInputSchema.safeParse({ testId: "../../state.json" }).success).toBe(
      false,
    );
  });
});
