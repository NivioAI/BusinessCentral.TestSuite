import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildRunnerEnvironment,
  resolveBusinessCentralUrl,
  resolvePowerShellExecutable,
} from "../src/main/runtime";

describe("Runtime discovery", () => {
  it("falls back to pwsh-preview when stable PowerShell is absent", async () => {
    const directory = await mkdtemp(join(tmpdir(), "bcft-pwsh-"));
    const preview = join(directory, "pwsh-preview");
    await writeFile(preview, "#!/bin/sh\nexit 0\n", "utf8");
    await chmod(preview, 0o755);

    await expect(resolvePowerShellExecutable("linux", { PATH: directory })).resolves.toBe(preview);
  });

  it("adds Homebrew locations for a Finder-launched macOS app", () => {
    const environment = buildRunnerEnvironment(
      "/usr/local/bin/pwsh-preview",
      { PATH: "/usr/bin:/bin" },
      "darwin",
    );
    const paths = environment.PATH?.split(delimiter);

    expect(paths).toEqual(
      expect.arrayContaining(["/usr/local/bin", "/opt/homebrew/bin", "/usr/bin", "/bin"]),
    );
  });

  it("builds a Business Central SaaS environment URL from the root URL", () => {
    expect(
      resolveBusinessCentralUrl(
        "https://businesscentral.dynamics.com/",
        "00000000-0000-0000-0000-000000000000",
        "sandbox",
      ),
    ).toBe("https://businesscentral.dynamics.com/00000000-0000-0000-0000-000000000000/sandbox/");
  });

  it("preserves an explicitly configured Business Central URL", () => {
    const configured = "https://businesscentral.dynamics.com/tenant/custom-environment/";
    expect(resolveBusinessCentralUrl(configured, "other-tenant", "other-environment")).toBe(
      configured,
    );
  });
});
