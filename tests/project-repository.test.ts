import { mkdir, mkdtemp, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { inspectProjectFolder } from "../src/main/project-repository";

async function folder(): Promise<string> {
  return mkdtemp(join(tmpdir(), "bcft-project-"));
}

describe("inspectProjectFolder", () => {
  it("reports a missing folder", async () => {
    expect(await inspectProjectFolder(join(await folder(), "missing"))).toMatchObject({
      exists: false,
      isGitRepository: false,
      apps: [],
    });
  });

  it("rejects relative paths and files", async () => {
    await expect(inspectProjectFolder("relative/path")).rejects.toThrow("absolute");
    const directory = await folder();
    const file = join(directory, "file.txt");
    await writeFile(file, "x");
    expect((await inspectProjectFolder(file)).exists).toBe(false);
  });

  it("reads branch and AL apps from a repository", async () => {
    const root = await folder();
    await mkdir(join(root, ".git"));
    await writeFile(join(root, ".git", "HEAD"), "ref: refs/heads/develop\n");
    await mkdir(join(root, "app"));
    await writeFile(
      join(root, "app", "app.json"),
      JSON.stringify({ name: "Sales", version: "1.2.0.0" }),
    );
    await mkdir(join(root, "test"));
    await writeFile(
      join(root, "test", "app.json"),
      `﻿${JSON.stringify({ name: "Sales Tests", version: "1.2.0.0" })}`,
    );
    const result = await inspectProjectFolder(root);
    expect(result).toMatchObject({ exists: true, isGitRepository: true, branch: "develop" });
    expect(result.apps.map((app) => app.name).sort()).toEqual(["Sales", "Sales Tests"]);
  });

  it("reports a detached head and ignores a folder that is not a repository", async () => {
    const detached = await folder();
    await mkdir(join(detached, ".git"));
    await writeFile(join(detached, ".git", "HEAD"), "0123456789abcdef\n");
    expect((await inspectProjectFolder(detached)).branch).toBe("detached at 0123456");
    expect((await inspectProjectFolder(await folder())).isGitRepository).toBe(false);
  });

  it("follows a git worktree pointer file", async () => {
    const root = await folder();
    const gitDirectory = join(root, "real-git");
    await mkdir(gitDirectory);
    await writeFile(join(gitDirectory, "HEAD"), "ref: refs/heads/feature\n");
    await writeFile(join(root, ".git"), "gitdir: real-git\n");
    expect((await inspectProjectFolder(root)).branch).toBe("feature");
  });

  it("skips node_modules, invalid app.json files and symbolic links", async () => {
    const root = await folder();
    const outside = await folder();
    await writeFile(join(outside, "app.json"), JSON.stringify({ name: "Outside", version: "1" }));
    await symlink(outside, join(root, "linked"));
    await mkdir(join(root, "node_modules"));
    await writeFile(
      join(root, "node_modules", "app.json"),
      JSON.stringify({ name: "Dep", version: "1" }),
    );
    await mkdir(join(root, "broken"));
    await writeFile(join(root, "broken", "app.json"), "{not json");
    await mkdir(join(root, "nameless"));
    await writeFile(join(root, "nameless", "app.json"), JSON.stringify({ version: "1" }));
    expect((await inspectProjectFolder(root)).apps).toEqual([]);
  });

  it("accepts a folder inside a repository and reports the repository root", async () => {
    const root = await mkdtemp(join(tmpdir(), "bcft-repo-"));
    await mkdir(join(root, ".git"));
    await writeFile(join(root, ".git", "HEAD"), "ref: refs/heads/main\n");
    const app = join(root, "examples", "demo");
    await mkdir(app, { recursive: true });
    await writeFile(join(app, "app.json"), JSON.stringify({ name: "Demo", version: "1.0.0.0" }));

    const inspection = await inspectProjectFolder(app);
    expect(inspection).toMatchObject({ exists: true, isGitRepository: true, branch: "main" });
    expect(inspection.gitRoot).toBe(await realpath(root));
    expect(inspection.apps).toEqual([{ name: "Demo", version: "1.0.0.0", path: "." }]);
  });

  it("leaves gitRoot out when the folder is the repository itself, and rejects a folder outside any repository", async () => {
    const root = await mkdtemp(join(tmpdir(), "bcft-repo-"));
    await mkdir(join(root, ".git"));
    expect((await inspectProjectFolder(root)).gitRoot).toBeUndefined();

    const plain = await mkdtemp(join(tmpdir(), "bcft-plain-"));
    const inspection = await inspectProjectFolder(plain);
    expect(inspection).toMatchObject({ exists: true, isGitRepository: false });
    expect(inspection.gitRoot).toBeUndefined();
  });
});
