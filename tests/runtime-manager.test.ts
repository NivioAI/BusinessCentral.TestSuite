import { createHash } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { RuntimeManager } from "../src/main/runtime-manager";

describe("runtime manager", () => {
  it("installs an explicitly compatible package and supports rollback", async () => {
    const directory = await mkdtemp(join(tmpdir(), "nivio-runtime-"));
    const manager = new RuntimeManager(directory, "1.0.0", "darwin");
    await manager.install(runtimeArchive("1.0.0", "0.2.0", "new"));
    await manager.install(runtimeArchive("1.0.0", "0.3.0", "newer"));

    expect((await manager.inspect(bundledPaths(directory), "0.1.0")).replayVersion).toBe("0.3.0");
    await manager.rollback();
    const inspection = await manager.inspect(bundledPaths(directory), "0.1.0");
    expect(inspection.replayVersion).toBe("0.2.0");
    expect(await readFile(inspection.replayScript, "utf8")).toBe("new");
  });

  it("rejects incompatible and unsafe packages", async () => {
    const directory = await mkdtemp(join(tmpdir(), "nivio-runtime-"));
    const manager = new RuntimeManager(directory, "1.0.0", "darwin");
    await expect(manager.install(runtimeArchive("2.0.0", "0.2.0", "new"))).rejects.toThrow(
      "not approved",
    );
    expect(() => zipSync({ "../escape": strToU8("bad") })).not.toThrow();
    await expect(manager.install(zipSync({ "../escape": strToU8("bad") }))).rejects.toThrow(
      "unsafe path",
    );
  });

  it("rejects runtime files that do not match the approved checksum", async () => {
    const directory = await mkdtemp(join(tmpdir(), "nivio-runtime-"));
    const manager = new RuntimeManager(directory, "1.0.0", "darwin");
    const archive = zipSync({
      "manifest.json": strToU8(
        JSON.stringify({
          version: 1,
          replayVersion: "0.2.0",
          appVersions: ["1.0.0"],
          platform: "darwin",
          replayScript: "Replay.ps1",
          workingDirectory: ".",
          checksums: { "Replay.ps1": "0".repeat(64) },
          executablePaths: [],
        }),
      ),
      "Replay.ps1": strToU8("tampered"),
    });

    await expect(manager.install(archive)).rejects.toThrow("checksum validation failed");
  });
});

function bundledPaths(directory: string) {
  return { replayScript: join(directory, "bundled.ps1"), workingDirectory: directory };
}

function runtimeArchive(appVersion: string, replayVersion: string, script: string): Uint8Array {
  const scriptBytes = strToU8(script);
  return zipSync({
    "manifest.json": strToU8(
      JSON.stringify({
        version: 1,
        replayVersion,
        appVersions: [appVersion],
        platform: "darwin",
        replayScript: "Replay.ps1",
        workingDirectory: ".",
        checksums: {
          "Replay.ps1": createHash("sha256").update(scriptBytes).digest("hex"),
        },
        executablePaths: [],
      }),
    ),
    "Replay.ps1": scriptBytes,
  });
}
