import { createHash } from "node:crypto";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { parse, stringify } from "yaml";
import type { TestParameter } from "../shared/models";

interface RawParameter {
  type?: string;
  description?: string;
  default?: unknown;
  required?: boolean;
  secret?: boolean;
}

interface PageScriptDocument {
  name?: string;
  description?: string;
  parameters?: Record<string, RawParameter>;
  steps?: unknown[];
  [key: string]: unknown;
}

export interface ParsedPageScript {
  name: string;
  description?: string;
  parameters: TestParameter[];
  versionHash: string;
  raw: PageScriptDocument;
  includedFiles: string[];
}

const MAX_BUNDLE_FILES = 50;
const MAX_BUNDLE_BYTES = 25_000_000;
const MAX_INCLUDE_DEPTH = 10;

const toParameterType = (value?: string): TestParameter["type"] => {
  const normalized = value?.toLowerCase();
  if (normalized === "number" || normalized === "integer" || normalized === "decimal")
    return "number";
  if (normalized === "boolean" || normalized === "bool") return "boolean";
  return "string";
};

export function parsePageScriptContents(
  contents: string,
  fallbackName = "Imported page script",
): ParsedPageScript {
  const document = parse(contents) as PageScriptDocument | null;
  if (!document || typeof document !== "object" || Array.isArray(document)) {
    throw new Error("The file does not contain a valid Page Script object.");
  }
  if (!Array.isArray(document.steps) || document.steps.length === 0) {
    throw new Error("The Page Script has no runnable steps.");
  }

  const parameters = Object.entries(document.parameters ?? {}).map(([name, input]) => {
    const parameter = input && typeof input === "object" ? input : {};
    const defaultValue = parameter.default;
    const supportedDefault =
      typeof defaultValue === "string" ||
      typeof defaultValue === "number" ||
      typeof defaultValue === "boolean"
        ? defaultValue
        : undefined;
    return {
      name,
      type: toParameterType(parameter.type),
      description: parameter.description,
      defaultValue: supportedDefault,
      required: parameter.required ?? supportedDefault === undefined,
      secret: parameter.secret ?? false,
    } satisfies TestParameter;
  });

  return {
    name:
      typeof document.name === "string" && document.name.trim()
        ? document.name.trim()
        : fallbackName,
    description: typeof document.description === "string" ? document.description : undefined,
    parameters,
    versionHash: createHash("sha256").update(contents).digest("hex").slice(0, 12),
    raw: document,
    includedFiles: includeReferences(document.steps),
  };
}

export async function parsePageScriptFile(path: string): Promise<ParsedPageScript> {
  const bundle = await readPageScriptBundle(path);
  const contents = bundle.get("") as string;
  const fallbackName =
    path
      .split(/[\\/]/)
      .pop()
      ?.replace(/\.(ya?ml)$/i, "") ?? "Imported page script";
  const parsed = parsePageScriptContents(contents, fallbackName);
  parsed.versionHash = hashBundle(bundle);
  parsed.includedFiles = [...bundle.keys()].filter(Boolean);
  return parsed;
}

export async function copyPageScriptBundle(
  sourcePath: string,
  targetDirectory: string,
): Promise<void> {
  const bundle = await readPageScriptBundle(sourcePath);
  await Promise.all(
    [...bundle.entries()].map(async ([path, contents]) => {
      const target = resolve(
        targetDirectory,
        path || sourcePath.split(/[\\/]/).pop() || "test.yml",
      );
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, contents, { encoding: "utf8", mode: 0o600 });
    }),
  );
}

export async function copyPageScriptIncludes(
  sourcePath: string,
  targetDirectory: string,
): Promise<void> {
  const bundle = await readPageScriptBundle(sourcePath);
  await Promise.all(
    [...bundle.entries()]
      .filter(([path]) => path)
      .map(async ([path, contents]) => {
        const target = resolve(targetDirectory, path);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, contents, { encoding: "utf8", mode: 0o600 });
      }),
  );
}

export async function materializePageScript(
  sourcePath: string,
  targetPath: string,
  values: Record<string, string | number | boolean>,
  stepDelayMs = 0,
): Promise<void> {
  const source = await readFile(sourcePath, "utf8");
  const document = parse(source) as PageScriptDocument;
  if (!document.parameters) document.parameters = {};

  for (const [name, value] of Object.entries(values)) {
    const existing = document.parameters[name];
    document.parameters[name] = {
      ...(existing && typeof existing === "object" ? existing : {}),
      default: value,
    };
  }

  if (stepDelayMs > 0 && document.steps) {
    document.steps = addStepDelay(document.steps, stepDelayMs);
  }

  await writeFile(targetPath, stringify(document, { lineWidth: 0 }), "utf8");
}

function addStepDelay(steps: unknown[], delayMs: number): unknown[] {
  return steps.flatMap((step) => {
    if (!step || typeof step !== "object" || Array.isArray(step)) return [step];
    const node = { ...(step as Record<string, unknown>) };
    if (Array.isArray(node.steps)) node.steps = addStepDelay(node.steps, delayMs);
    if (node.type === "wait" || node.type === "scope" || node.type === "include") return [node];
    return [
      node,
      {
        type: "wait",
        description: `Wait ${delayMs} milliseconds between steps`,
        time: delayMs,
      },
    ];
  });
}

async function readPageScriptBundle(sourcePath: string): Promise<Map<string, string>> {
  const rootDirectory = dirname(await realpath(sourcePath));
  const files = new Map<string, string>();
  const visiting = new Set<string>();

  const visit = async (absolutePath: string, bundlePath: string, depth: number): Promise<void> => {
    if (depth > MAX_INCLUDE_DEPTH)
      throw new Error("The Page Script has includes nested too deeply.");
    const resolvedPath = await realpath(absolutePath);
    const relativePath = relative(rootDirectory, resolvedPath);
    if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
      throw new Error("Page Script include points outside the selected folder.");
    }
    if (visiting.has(resolvedPath)) throw new Error("The Page Script has a circular include.");
    if (files.has(bundlePath)) return;
    if (files.size >= MAX_BUNDLE_FILES) throw new Error("The Page Script has too many includes.");
    visiting.add(resolvedPath);
    const contents = await readFile(resolvedPath, "utf8");
    const totalBytes = [...files.values()].reduce(
      (total, item) => total + Buffer.byteLength(item, "utf8"),
      Buffer.byteLength(contents, "utf8"),
    );
    if (totalBytes > MAX_BUNDLE_BYTES) throw new Error("The Page Script bundle is too large.");
    const document = parse(contents) as PageScriptDocument | null;
    if (!document || typeof document !== "object" || !Array.isArray(document.steps)) {
      throw new Error("A Page Script include is not a valid script.");
    }
    files.set(bundlePath, contents);
    for (const include of includeReferences(document.steps)) {
      if (isAbsolute(include)) throw new Error("A Page Script include must use a relative path.");
      const includePath = resolve(dirname(resolvedPath), include);
      // Bundle paths always use "/", so the version hash is the same on every platform.
      const includeBundlePath = relative(rootDirectory, includePath).split(sep).join("/");
      if (includeBundlePath.startsWith("..") || isAbsolute(includeBundlePath)) {
        throw new Error("Page Script include points outside the selected folder.");
      }
      await visit(includePath, includeBundlePath, depth + 1);
    }
    visiting.delete(resolvedPath);
  };

  await visit(sourcePath, "", 0);
  return files;
}

function includeReferences(steps: unknown[]): string[] {
  const references: string[] = [];
  for (const step of steps) {
    if (!step || typeof step !== "object" || Array.isArray(step)) continue;
    const node = step as Record<string, unknown>;
    if (node.type === "include") {
      if (typeof node.file !== "string" || !node.file.trim()) {
        throw new Error("A Page Script include has no valid file path.");
      }
      references.push(node.file.trim());
    }
    if (Array.isArray(node.steps)) references.push(...includeReferences(node.steps));
  }
  return references;
}

function hashBundle(bundle: Map<string, string>): string {
  const hash = createHash("sha256");
  for (const [path, contents] of [...bundle.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    hash.update(path).update("\0").update(contents).update("\0");
  }
  return hash.digest("hex").slice(0, 12);
}
