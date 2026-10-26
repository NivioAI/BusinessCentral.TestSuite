import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { unzipSync } from "fflate";
import * as z from "zod/v3";
import { pathExists } from "./runner";

const relativePath = z
  .string()
  .min(1)
  .max(500)
  .refine((value) => isSafeRelativePath(value), "Runtime package contains an unsafe path.");
const relativeDirectoryPath = z
  .string()
  .min(1)
  .max(500)
  .refine(
    (value) => value === "." || isSafeRelativePath(value),
    "Runtime package contains an unsafe working directory.",
  );

const runtimeManifestSchema = z.object({
  version: z.literal(1),
  replayVersion: z.string().trim().min(1).max(80),
  appVersions: z.array(z.string().trim().min(1).max(40)).min(1).max(20),
  platform: z.enum(["darwin", "win32"]),
  replayScript: relativePath,
  workingDirectory: relativeDirectoryPath.default("."),
  checksums: z.record(z.string().regex(/^[a-f0-9]{64}$/)),
  executablePaths: z.array(relativePath).max(200).default([]),
});

type RuntimeManifest = z.infer<typeof runtimeManifestSchema>;

export interface RuntimePaths {
  replayScript: string;
  workingDirectory: string;
}

export interface RuntimeInspection extends RuntimePaths {
  replayVersion?: string;
  bundledReplayVersion?: string;
  source: "bundled" | "managed";
  compatibility: "compatible" | "unverified" | "incompatible";
  message: string;
  rollbackAvailable: boolean;
}

export class RuntimeManager {
  private readonly runtimeRoot: string;

  constructor(
    dataDirectory: string,
    private readonly appVersion: string,
    private readonly platform: NodeJS.Platform,
  ) {
    this.runtimeRoot = join(dataDirectory, "runtime");
  }

  async inspect(bundled: RuntimePaths, bundledReplayVersion?: string): Promise<RuntimeInspection> {
    const managedDirectory = join(this.runtimeRoot, "current");
    const managedManifest = await this.readManifest(managedDirectory);
    const rollbackAvailable = await pathExists(join(this.runtimeRoot, "rollback", "manifest.json"));
    if (managedManifest) {
      const compatible = this.isCompatible(managedManifest);
      return {
        replayScript: join(managedDirectory, managedManifest.replayScript),
        workingDirectory: join(managedDirectory, managedManifest.workingDirectory),
        replayVersion: managedManifest.replayVersion,
        bundledReplayVersion,
        source: "managed",
        compatibility: compatible ? "compatible" : "incompatible",
        message: compatible
          ? `Managed bc-replay ${managedManifest.replayVersion} is approved for this app version.`
          : `Managed bc-replay ${managedManifest.replayVersion} is not approved for NIVIO Test Suite ${this.appVersion}.`,
        rollbackAvailable,
      };
    }
    return {
      ...bundled,
      replayVersion: bundledReplayVersion,
      bundledReplayVersion,
      source: "bundled",
      compatibility: bundledReplayVersion ? "compatible" : "unverified",
      message: bundledReplayVersion
        ? `Bundled bc-replay ${bundledReplayVersion} is the tested application baseline.`
        : "The bundled bc-replay version could not be verified.",
      rollbackAvailable,
    };
  }

  async install(contents: Uint8Array): Promise<void> {
    if (contents.byteLength > 250_000_000) throw new Error("Runtime package is too large.");
    const files = unzipSync(contents);
    let unpackedSize = 0;
    for (const [name, value] of Object.entries(files)) {
      if (!isSafeRelativePath(name)) throw new Error("Runtime package contains an unsafe path.");
      unpackedSize += value.byteLength;
      if (unpackedSize > 750_000_000) throw new Error("Unpacked runtime package is too large.");
    }
    const manifestFile = files["manifest.json"];
    if (!manifestFile) throw new Error("Runtime package has no manifest.json.");
    const manifest = runtimeManifestSchema.parse(
      JSON.parse(new TextDecoder().decode(manifestFile)),
    );
    if (!this.isCompatible(manifest)) {
      throw new Error("Runtime package is not approved for this platform or app version.");
    }
    if (!files[manifest.replayScript]) throw new Error("Runtime package has no replay script.");
    const packagedFiles = Object.keys(files).filter((name) => name !== "manifest.json");
    if (
      packagedFiles.some(
        (name) => !manifest.checksums[name] || sha256(files[name]) !== manifest.checksums[name],
      ) ||
      Object.keys(manifest.checksums).some(
        (name) => !isSafeRelativePath(name) || !files[name] || name === "manifest.json",
      )
    ) {
      throw new Error("Runtime package checksum validation failed.");
    }
    if (manifest.executablePaths.some((name) => !files[name])) {
      throw new Error("Runtime package declares a missing executable file.");
    }

    await mkdir(this.runtimeRoot, { recursive: true });
    const staging = join(this.runtimeRoot, `staging-${randomUUID()}`);
    await mkdir(staging, { recursive: true });
    try {
      const executablePaths = new Set(manifest.executablePaths);
      for (const [name, value] of Object.entries(files)) {
        const target = join(staging, name);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, value, { mode: executablePaths.has(name) ? 0o700 : 0o600 });
      }
      const current = join(this.runtimeRoot, "current");
      const rollback = join(this.runtimeRoot, "rollback");
      await rm(rollback, { recursive: true, force: true });
      const currentMoved = await pathExists(current);
      if (currentMoved) await rename(current, rollback);
      try {
        await rename(staging, current);
      } catch (error) {
        if (currentMoved && !(await pathExists(current))) await rename(rollback, current);
        throw error;
      }
    } catch (error) {
      await rm(staging, { recursive: true, force: true });
      throw error;
    }
  }

  async rollback(): Promise<void> {
    const current = join(this.runtimeRoot, "current");
    const rollback = join(this.runtimeRoot, "rollback");
    if (!(await pathExists(rollback))) throw new Error("No runtime rollback is available.");
    const temporary = join(this.runtimeRoot, `rollback-swap-${randomUUID()}`);
    if (await pathExists(current)) await rename(current, temporary);
    try {
      await rename(rollback, current);
      if (await pathExists(temporary)) await rename(temporary, rollback);
    } catch (error) {
      if (await pathExists(temporary)) await rename(temporary, current);
      throw error;
    }
  }

  private async readManifest(directory: string): Promise<RuntimeManifest | undefined> {
    try {
      return runtimeManifestSchema.parse(
        JSON.parse(await readFile(join(directory, "manifest.json"), "utf8")),
      );
    } catch {
      return undefined;
    }
  }

  private isCompatible(manifest: RuntimeManifest): boolean {
    return (
      manifest.platform === this.platform &&
      (manifest.appVersions.includes("*") || manifest.appVersions.includes(this.appVersion))
    );
  }
}

function isSafeRelativePath(value: string): boolean {
  const path = value.replaceAll("\\", "/");
  return (
    Boolean(path) &&
    !path.startsWith("/") &&
    !/^[A-Za-z]:/.test(path) &&
    path.split("/").every((segment) => Boolean(segment) && segment !== "." && segment !== "..")
  );
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
