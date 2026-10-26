import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { strToU8, unzipSync, zipSync } from "fflate";
import * as z from "zod/v3";
import type { AppState, TestDefinition } from "../shared/models";

const id = z.string().min(1).max(100);
const environmentSchema = z.object({
  id,
  customerId: id,
  tenantId: z.string().max(120),
  name: z.string().max(80),
  company: z.string().max(120),
  type: z.enum(["sandbox", "uat", "docker", "production"]),
  baseUrl: z.string().url(),
  authentication: z.enum(["Windows", "AAD", "UserPassword"]),
  username: z.string().max(200).optional(),
  hasCredential: z.boolean(),
  hasRememberedSession: z.boolean().optional(),
  active: z.boolean(),
  archivedAt: z.string().datetime().optional(),
});
const projectSchema = z.object({
  id,
  environmentId: id,
  name: z.string().max(120),
  description: z.string().max(500).optional(),
  agent: z.enum(["claude-code", "codex", "other"]),
  instructions: z.string().max(4000).optional(),
  archivedAt: z.string().datetime().optional(),
});
const parameterSchema = z.object({
  name: z.string().max(100),
  type: z.enum(["string", "number", "boolean"]),
  description: z.string().max(500).optional(),
  defaultValue: z.union([z.string(), z.number(), z.boolean()]).optional(),
  required: z.boolean(),
  secret: z.boolean(),
});
const testSchema = z.object({
  id,
  testId: z.string().max(80),
  name: z.string().max(160),
  description: z.string().max(500).optional(),
  customerId: id.optional(),
  groupId: id,
  recordingPath: z.string().max(500),
  risk: z.enum(["read-only", "reversible", "destructive"]),
  forbiddenActions: z.array(z.string().max(120)).max(20).default([]),
  tags: z.array(z.string().max(40)).max(20),
  allowedEnvironmentTypes: z.array(z.enum(["sandbox", "uat", "docker", "production"])),
  parameters: z.array(parameterSchema).max(100),
  versionHash: z.string().max(100),
  importedAt: z.string().datetime(),
  projectIds: z.array(id).max(50).default([]),
  archivedAt: z.string().datetime().optional(),
});
const planSchema = z.object({
  id,
  name: z.string().max(120),
  customerId: id,
  environmentId: id,
  testDefinitionIds: z.array(id).min(1).max(100),
  parameterProfileIds: z.record(id, id).optional(),
  archivedAt: z.string().datetime().optional(),
  schedule: z
    .object({
      days: z.enum(["every-day", "weekdays"]),
      time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    })
    .optional(),
});
const parameterProfileSchema = z.object({
  id,
  testDefinitionId: id,
  environmentId: id.optional(),
  name: z.string().min(1).max(80),
  values: z.record(z.union([z.string().max(10_000), z.number().finite(), z.boolean()])),
  updatedAt: z.string().datetime(),
});
const manifestSchema = z.object({
  version: z.literal(1),
  exportedAt: z.string().datetime(),
  state: z.object({
    settings: z.object({
      stepDelayMs: z.number().int().min(0).max(5000),
      textSize: z.enum(["extra-small", "small", "medium", "large"]),
      runRetentionDays: z.union([z.literal(0), z.literal(30), z.literal(90), z.literal(180)]),
      notifications: z
        .object({
          runFinished: z.boolean(),
          investigationNeedsMe: z.boolean(),
          agentApproval: z.boolean(),
          scheduledPlans: z.boolean(),
        })
        .partial()
        .optional(),
    }),
    customers: z.array(
      z.object({
        id,
        code: z.string(),
        name: z.string(),
        active: z.boolean(),
        archivedAt: z.string().datetime().optional(),
      }),
    ),
    testGroups: z.array(
      z.object({
        id,
        name: z.string(),
        customerId: id.optional(),
        system: z.boolean(),
        archivedAt: z.string().datetime().optional(),
      }),
    ),
    environments: z.array(environmentSchema),
    projects: z.array(projectSchema).default([]),
    tests: z.array(testSchema),
    testPlans: z.array(planSchema),
    parameterProfiles: z.array(parameterProfileSchema).default([]),
  }),
});

export type PortableWorkspace = z.infer<typeof manifestSchema>;
export type PortableWorkspaceState = PortableWorkspace["state"];

export async function createWorkspaceArchive(state: AppState): Promise<Uint8Array> {
  const files: Record<string, Uint8Array> = {};
  const tests: TestDefinition[] = [];
  for (const test of state.tests) {
    const prefix = `library/${test.id}`;
    const name = basename(test.recordingPath).endsWith(".yaml") ? "test.yaml" : "test.yml";
    files[`${prefix}/${name}`] = new Uint8Array(await readFile(test.recordingPath));
    tests.push({ ...test, recordingPath: `${prefix}/${name}` });
  }
  const manifest = {
    version: 1 as const,
    exportedAt: new Date().toISOString(),
    state: {
      settings: { ...state.settings, customAgent: undefined },
      customers: state.customers,
      testGroups: state.testGroups,
      projects: state.projects.map(({ codePath: _codePath, ...project }) => project),
      environments: state.environments.map((item) => ({
        ...item,
        hasCredential: false,
        hasRememberedSession: false,
      })),
      tests,
      testPlans: state.testPlans.map((plan) => ({
        ...plan,
        scheduleHandledAt: undefined,
        schedulePending: undefined,
      })),
      parameterProfiles: state.parameterProfiles.map((profile) => {
        const test = state.tests.find((item) => item.id === profile.testDefinitionId);
        const allowedNames = new Set(
          test?.parameters
            .filter((parameter) => !parameter.secret)
            .map((parameter) => parameter.name),
        );
        return {
          ...profile,
          values: Object.fromEntries(
            Object.entries(profile.values).filter(([name]) => allowedNames.has(name)),
          ),
        };
      }),
    },
  };
  files["manifest.json"] = strToU8(JSON.stringify(manifest, null, 2));
  return zipSync(files, { level: 6 });
}

export function readWorkspaceArchive(contents: Uint8Array): {
  manifest: PortableWorkspace;
  files: Map<string, Uint8Array>;
  checksum: string;
} {
  if (contents.byteLength > 100_000_000) throw new Error("The workspace backup is too large.");
  const unpacked = unzipSync(contents);
  const files = new Map<string, Uint8Array>();
  let total = 0;
  for (const [name, value] of Object.entries(unpacked)) {
    const path = safePath(name);
    total += value.byteLength;
    if (total > 250_000_000) throw new Error("The unpacked workspace backup is too large.");
    files.set(path, value);
  }
  const manifestFile = files.get("manifest.json");
  if (!manifestFile) throw new Error("The workspace backup has no manifest.json.");
  const manifest = manifestSchema.parse(
    withoutDesktopTesting(JSON.parse(new TextDecoder().decode(manifestFile))),
  );
  validateReferences(manifest);
  for (const test of manifest.state.tests) {
    const recordingPath = test.recordingPath;
    if (typeof recordingPath !== "string" || !files.has(safePath(recordingPath))) {
      throw new Error("The workspace backup has a test without a recording file.");
    }
  }
  return {
    manifest,
    files,
    checksum: createHash("sha256").update(contents).digest("hex").slice(0, 12),
  };
}

function validateReferences(manifest: PortableWorkspace): void {
  const customerIds = new Set(manifest.state.customers.map((item) => item.id));
  const groupIds = new Set(manifest.state.testGroups.map((item) => item.id));
  const environmentIds = new Set(manifest.state.environments.map((item) => item.id));
  const projectIds = new Set(manifest.state.projects.map((item) => item.id));
  if (manifest.state.projects.some((item) => !environmentIds.has(item.environmentId)))
    throw new Error("The workspace backup has a project without a valid environment.");
  const testIds = new Set(manifest.state.tests.map((item) => item.id));
  const testsById = new Map(manifest.state.tests.map((item) => [item.id, item]));
  for (const profile of manifest.state.parameterProfiles) {
    const test = testsById.get(profile.testDefinitionId);
    if (!test || !testIds.has(profile.testDefinitionId)) {
      throw new Error("The workspace backup has a parameter profile without a valid test.");
    }
    if (profile.environmentId && !environmentIds.has(profile.environmentId)) {
      throw new Error("The workspace backup has a parameter profile with an unknown environment.");
    }
    const allowedNames = new Set(
      test.parameters.filter((parameter) => !parameter.secret).map((parameter) => parameter.name),
    );
    if (Object.keys(profile.values).some((name) => !allowedNames.has(name))) {
      throw new Error("The workspace backup has an invalid or secret parameter profile.");
    }
  }
  if (
    manifest.state.testGroups.some((item) => item.customerId && !customerIds.has(item.customerId))
  )
    throw new Error("The workspace backup refers to an unknown customer.");
  if (manifest.state.environments.some((item) => !customerIds.has(item.customerId)))
    throw new Error("The workspace backup has a target without a valid customer.");
  for (const test of manifest.state.tests) {
    if (test.projectIds.some((projectId) => !projectIds.has(projectId)))
      throw new Error("The workspace backup has a test with an unknown project.");
    if (!groupIds.has(test.groupId) || (test.customerId && !customerIds.has(test.customerId)))
      throw new Error("The workspace backup has a test with invalid relations.");
  }
  for (const plan of manifest.state.testPlans) {
    if (
      !customerIds.has(plan.customerId) ||
      !environmentIds.has(plan.environmentId) ||
      plan.testDefinitionIds.some((id) => !testIds.has(id))
    )
      throw new Error("The workspace backup has a test plan with invalid relations.");
    for (const [testId, profileId] of Object.entries(plan.parameterProfileIds ?? {})) {
      const profile = manifest.state.parameterProfiles.find((item) => item.id === profileId);
      if (!testIds.has(testId) || profile?.testDefinitionId !== testId) {
        throw new Error("The workspace backup has an invalid parameter profile in a test plan.");
      }
    }
  }
}

function safePath(value: string): string {
  const path = value.replaceAll("\\", "/").replace(/^\.\//, "");
  if (!path || path.startsWith("/") || path === ".." || path.includes("../")) {
    throw new Error("The workspace backup has an unsafe file path.");
  }
  return path;
}

/**
 * Backups made before desktop testing was removed may still contain desktop applications,
 * tests and plans. They are dropped on import so the rest of the backup stays usable.
 */
function withoutDesktopTesting(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const manifest = raw as { state?: Record<string, unknown> };
  const state = manifest.state;
  if (!state || typeof state !== "object") return raw;
  const records = (value: unknown): Array<Record<string, unknown>> =>
    Array.isArray(value) ? (value as Array<Record<string, unknown>>) : [];
  const tests = records(state.tests).filter((test) => test.kind !== "desktop");
  const testIds = new Set(tests.map((test) => test.id));
  const plans = records(state.testPlans).filter(
    (plan) => !plan.desktopApplicationId && Boolean(plan.environmentId),
  );
  const settings =
    state.settings && typeof state.settings === "object"
      ? { ...(state.settings as Record<string, unknown>) }
      : state.settings;
  if (settings && typeof settings === "object") {
    (settings as Record<string, unknown>).desktopTestingEnabled = undefined;
  }
  return {
    ...manifest,
    state: {
      ...state,
      settings,
      desktopApplications: undefined,
      tests,
      testPlans: plans,
      parameterProfiles: records(state.parameterProfiles).filter((profile) =>
        testIds.has(profile.testDefinitionId),
      ),
    },
  };
}
