import { readFile, readdir, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative } from "node:path";
import type { ProjectInspection } from "../shared/models";

const SKIPPED_DIRECTORIES = new Set([
  ".git",
  ".alpackages",
  ".snapshots",
  "node_modules",
  ".nivio",
]);
const MAX_DEPTH = 3;
const MAX_APPS = 20;

/** Read-only look at a local AL repository: is it git, which branch, which AL apps. */
export async function inspectProjectFolder(path: string): Promise<ProjectInspection> {
  if (!isAbsolute(path)) throw new Error("Choose an absolute folder.");
  const root = await realpath(path).catch(() => undefined);
  const info = root ? await stat(root).catch(() => undefined) : undefined;
  if (!root || !info?.isDirectory()) {
    return { exists: false, isGitRepository: false, apps: [] };
  }
  // The AL app is often a subfolder of a repository, so look upwards for the repository root.
  const gitRoot = await findGitRoot(root);
  const git = gitRoot ? await readGitHead(gitRoot) : { isRepository: false, branch: undefined };
  return {
    exists: true,
    isGitRepository: git.isRepository,
    gitRoot: gitRoot && gitRoot !== root ? gitRoot : undefined,
    branch: git.branch,
    apps: await findApps(root, root, 0),
  };
}

async function findGitRoot(start: string): Promise<string | undefined> {
  let current = start;
  for (let level = 0; level < 30; level += 1) {
    if (await stat(join(current, ".git")).catch(() => undefined)) return current;
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
  return undefined;
}

async function readGitHead(root: string): Promise<{ isRepository: boolean; branch?: string }> {
  const gitPath = join(root, ".git");
  const info = await stat(gitPath).catch(() => undefined);
  if (!info) return { isRepository: false };
  let headDirectory = gitPath;
  if (info.isFile()) {
    // A worktree or submodule: ".git" is a file that points at the real git directory.
    const pointer = (await readFile(gitPath, "utf8").catch(() => "")).trim();
    const target = /^gitdir:\s*(.+)$/.exec(pointer)?.[1];
    if (!target) return { isRepository: true };
    headDirectory = isAbsolute(target) ? target : join(root, target);
  }
  const head = (await readFile(join(headDirectory, "HEAD"), "utf8").catch(() => "")).trim();
  const branch = /^ref:\s*refs\/heads\/(.+)$/.exec(head)?.[1];
  return {
    isRepository: true,
    branch: branch ?? (head ? `detached at ${head.slice(0, 7)}` : undefined),
  };
}

async function findApps(
  root: string,
  directory: string,
  depth: number,
): Promise<ProjectInspection["apps"]> {
  const apps: ProjectInspection["apps"] = [];
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (apps.length >= MAX_APPS) break;
    // Symbolic links are skipped so the scan can never leave the chosen folder.
    if (entry.isSymbolicLink()) continue;
    const entryPath = join(directory, entry.name);
    if (entry.isFile() && entry.name === "app.json") {
      const app = await readApp(entryPath);
      if (app) apps.push({ ...app, path: relative(root, directory) || "." });
    } else if (entry.isDirectory() && depth < MAX_DEPTH && !SKIPPED_DIRECTORIES.has(entry.name)) {
      apps.push(...(await findApps(root, entryPath, depth + 1)));
    }
  }
  return apps.slice(0, MAX_APPS);
}

async function readApp(path: string): Promise<{ name: string; version: string } | undefined> {
  const info = await stat(path).catch(() => undefined);
  if (!info || info.size > 200_000) return undefined;
  try {
    const parsed: unknown = JSON.parse((await readFile(path, "utf8")).replace(/^﻿/, ""));
    if (!parsed || typeof parsed !== "object") return undefined;
    const { name, version } = parsed as { name?: unknown; version?: unknown };
    return typeof name === "string" && typeof version === "string"
      ? { name: name.slice(0, 120), version: version.slice(0, 40) }
      : undefined;
  } catch {
    return undefined;
  }
}
