import * as z from "zod/v3";
import { isAllowedBusinessCentralUrl } from "./business-central-url";
import { DATA_CATEGORIES } from "./data-categories";

export const appSettingsInputSchema = z.object({
  stepDelayMs: z.number().int().min(0).max(5000),
  textSize: z.enum(["extra-small", "small", "medium", "large"]),
  runRetentionDays: z.union([z.literal(0), z.literal(30), z.literal(90), z.literal(180)]),
  notifications: z.object({
    runFinished: z.boolean(),
    investigationNeedsMe: z.boolean(),
    agentApproval: z.boolean(),
    scheduledPlans: z.boolean(),
  }),
  customAgent: z
    .object({
      executable: z.string().trim().min(1).max(1024),
      args: z
        .array(
          z
            .string()
            .max(200)
            .regex(/^[^\r\n\0]*$/),
        )
        .max(20),
    })
    .optional(),
});

export const parameterProfileInputSchema = z.object({
  testDefinitionId: z.string().uuid(),
  environmentId: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(80),
  values: z.record(z.union([z.string().max(10_000), z.number().finite(), z.boolean()])),
});

export const environmentInputSchema = z.object({
  id: z.string().optional(),
  customerId: z.string().optional(),
  customerCode: z
    .string()
    .trim()
    .min(2)
    .max(32)
    .regex(/^[A-Za-z0-9_-]+$/),
  customerName: z.string().trim().min(2).max(120),
  tenantId: z.string().trim().min(2).max(120),
  name: z.string().trim().min(1).max(80),
  company: z.string().trim().min(1).max(120),
  type: z.enum(["sandbox", "uat", "docker", "production"]),
  baseUrl: z
    .string()
    .url()
    .refine((value) => isAllowedBusinessCentralUrl(value), {
      message:
        "Use businesscentral.dynamics.com, localhost, or a host configured in BCFT_ALLOWED_BC_HOSTS.",
    }),
  authentication: z.enum(["Windows", "AAD", "UserPassword"]),
  username: z.string().trim().max(200).optional(),
  password: z.string().max(500).optional(),
});

export const importedTestInputSchema = z.object({
  groupId: z.string().min(1),
  testId: z.string().trim().max(80).optional(),
  risk: z.enum(["read-only", "reversible", "destructive"]).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).optional(),
  allowedEnvironmentTypes: z.array(z.enum(["sandbox", "uat", "docker", "production"])).optional(),
});

export const testRecordingUpdateInputSchema = z.object({
  testId: z.string().uuid(),
});

function normalizeTestId(value: string): string {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9_-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "");
}

export const customerInputSchema = z.object({
  id: z.string().uuid().optional(),
  code: z
    .string()
    .trim()
    .min(2)
    .max(32)
    .regex(/^[A-Za-z0-9_-]+$/),
  name: z.string().trim().min(2).max(120),
});

export const testGroupInputSchema = z.object({
  id: z.string().uuid().optional(),
  customerId: z.string().min(1),
  name: z.string().trim().min(2).max(80),
});

export const testDefinitionInputSchema = z.object({
  id: z.string().uuid(),
  groupId: z.string().uuid(),
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(500).optional(),
  risk: z.enum(["read-only", "reversible", "destructive"]),
  forbiddenActions: z.array(z.string().trim().min(1).max(120)).max(20),
  tags: z.array(z.string().trim().min(1).max(40)).max(20),
  projectIds: z.array(z.string().uuid()).max(50),
});

export const testPlanInputSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(2).max(120),
  customerId: z.string().uuid(),
  environmentId: z.string().uuid(),
  testDefinitionIds: z.array(z.string().uuid()).min(1).max(100),
  parameterProfileIds: z.record(z.string().uuid(), z.string().uuid()).optional(),
  schedule: z
    .object({
      days: z.enum(["every-day", "weekdays"]),
      time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    })
    .optional(),
});

export const startRunInputSchema = z.object({
  testDefinitionId: z.string().min(1),
  environmentId: z.string().min(1),
  parameters: z.record(z.union([z.string(), z.number(), z.boolean()])),
  confirmRisk: z.boolean(),
  manualMfa: z.boolean(),
  rememberSession: z.boolean(),
});

export const mcpCreateTestInputSchema = z.object({
  groupId: z.string().uuid(),
  testId: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(/^[A-Z0-9_-]+$/),
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(500).optional(),
  yaml: z.string().min(1).max(2_000_000),
  risk: z.enum(["read-only", "reversible", "destructive"]),
  forbiddenActions: z.array(z.string().trim().min(1).max(120)).max(20),
  tags: z.array(z.string().trim().min(1).max(40)).max(20),
  allowedEnvironmentTypes: z
    .array(z.enum(["sandbox", "uat", "docker"]))
    .min(1)
    .max(3),
});

export const agentKindSchema = z.enum(["claude-code", "codex", "other"]);

export const projectInputSchema = z.object({
  id: z.string().uuid().optional(),
  environmentId: z.string().uuid(),
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500).optional(),
  codePath: z.string().trim().min(1).max(1000).optional(),
  agent: agentKindSchema,
  instructions: z.string().trim().max(4000).optional(),
});

export const investigationInputSchema = z.object({
  runId: z.string().min(1).max(100),
  projectId: z.string().uuid(),
  includeEvidence: z.boolean(),
});

export const investigationIdSchema = z.string().uuid();
export const projectIdSchema = z.string().uuid();
export const agentKindInputSchema = agentKindSchema;

export const investigationDecisionInputSchema = z.object({
  id: z.string().uuid(),
  decision: z.enum(["approved", "changes-requested"]),
  note: z.string().trim().max(2000).optional(),
});

export const investigationChangeInputSchema = z.object({
  id: z.string().uuid(),
  summary: z.string().trim().min(1).max(2000),
  branch: z.string().trim().min(1).max(200),
  commit: z.string().trim().max(80).optional(),
  files: z.array(z.string().trim().min(1).max(500)).max(200),
});

export const deleteDataInputSchema = z.object({
  categories: z.array(z.enum(DATA_CATEGORIES)).min(1).max(DATA_CATEGORIES.length),
});

export const beginTestPlanRunInputSchema = z.object({
  planId: z
    .string()
    .min(1)
    .max(80)
    .regex(/^(?:regression:)?[0-9a-fA-F-]{36}$/),
  testDefinitionIds: z.array(z.string().uuid()).min(1).max(200).optional(),
  resumedFromId: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(120).optional(),
  environmentId: z.string().uuid().optional(),
  scheduledFor: z.string().datetime().optional(),
});
