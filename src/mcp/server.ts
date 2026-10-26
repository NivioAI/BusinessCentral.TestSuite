import { readFile } from "node:fs/promises";
import { request } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod";
import { parsePageScriptContents } from "../main/page-script.js";

interface BridgeConnection {
  version: 1;
  url: string;
  token: string;
}

const connectionFile = requiredEnvironment("BCFT_MCP_BRIDGE_FILE");

const server = new McpServer(
  { name: "nivio-test-suite", version: "0.2.0" },
  {
    instructions:
      "Use existing BC Page Script tests as examples before drafting a new test. Only Business Central YAML is supported. create_test, start_test, and stop_test always require approval in NIVIO Test Suite; poll get_approval after asking the user to approve there. For failure investigations call list_investigations, get_investigation, submit_plan, wait for get_investigation_decision to return approved, then report_change; never push. Production is blocked. Never request or expose credentials. Run evidence is available in NIVIO Test Suite under Run history.",
  },
);

server.registerTool(
  "list_tests",
  {
    title: "List Business Central tests",
    description: "List available Business Central Page Script tests and their metadata.",
    inputSchema: { query: z.string().max(200).optional() },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  },
  async ({ query }) => {
    const tests = (await bridge("list_tests")) as Array<Record<string, unknown>>;
    const normalized = query?.trim().toLowerCase();
    const filtered = normalized
      ? tests.filter((test) => JSON.stringify(test).toLowerCase().includes(normalized))
      : tests;
    return result(filtered);
  },
);

server.registerTool(
  "list_test_groups",
  {
    title: "List test groups",
    description: "List available groups and customer ownership for placing a new test.",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  },
  async () => result(await bridge("list_test_groups")),
);

server.registerTool(
  "get_test",
  {
    title: "Read Business Central test",
    description:
      "Read one test definition and its sanitized Page Script YAML for use as an example.",
    inputSchema: { id: z.string().uuid() },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  },
  async ({ id }) => result(await bridge("get_test", { id })),
);

server.registerTool(
  "list_environments",
  {
    title: "List test environments",
    description: "List non-archived Business Central targets without credentials or URLs.",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  },
  async () => result(await bridge("list_environments")),
);

server.registerTool(
  "list_runs",
  {
    title: "List recent test runs",
    description: "List up to 50 recent sanitized test results.",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  },
  async () => result(await bridge("list_runs")),
);

server.registerTool(
  "get_run",
  {
    title: "Read test result",
    description: "Read a sanitized run result and learn where its local evidence can be viewed.",
    inputSchema: { id: z.string().uuid() },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  },
  async ({ id }) => result(await bridge("get_run", { id })),
);

server.registerTool(
  "validate_test_script",
  {
    title: "Validate Page Script YAML",
    description: "Validate a proposed standalone Business Central Page Script without saving it.",
    inputSchema: { yaml: z.string().min(1).max(2_000_000) },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  },
  async ({ yaml }) => {
    const parsed = parsePageScriptContents(yaml);
    if (parsed.includedFiles.length) throw new Error("MCP-created tests must be standalone YAML.");
    return result({
      valid: true,
      name: parsed.name,
      parameters: parsed.parameters,
      versionHash: parsed.versionHash,
    });
  },
);

server.registerTool(
  "create_test",
  {
    title: "Request creation of a test",
    description:
      "Validate and request approval to add a new standalone Business Central Page Script test.",
    inputSchema: {
      groupId: z.string().uuid(),
      testId: z
        .string()
        .regex(/^[A-Z0-9_-]+$/)
        .max(80),
      name: z.string().min(1).max(160),
      description: z.string().max(500).optional(),
      yaml: z.string().min(1).max(2_000_000),
      risk: z.enum(["read-only", "reversible", "destructive"]),
      forbiddenActions: z.array(z.string().min(1).max(120)).max(20).default([]),
      tags: z.array(z.string().min(1).max(40)).max(20).default([]),
      allowedEnvironmentTypes: z.array(z.enum(["sandbox", "uat", "docker"])).min(1),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  },
  async (input) => approvalResult(await bridge("request_create_test", input)),
);

server.registerTool(
  "start_test",
  {
    title: "Request a visible test run",
    description:
      "Request approval to visibly run a Business Central test with user-requested parameters.",
    inputSchema: {
      testDefinitionId: z.string().uuid(),
      environmentId: z.string().uuid(),
      parameters: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
      manualMfa: z.boolean().default(true),
      rememberSession: z.boolean().default(true),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
  },
  async (input) =>
    approvalResult(
      await bridge("request_start_test", {
        ...input,
        confirmRisk: true,
      }),
    ),
);

server.registerTool(
  "stop_test",
  {
    title: "Request stopping the active test",
    description: "Request approval to abort the currently active test run.",
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
  },
  async () => approvalResult(await bridge("request_stop_test")),
);

server.registerTool(
  "get_approval",
  {
    title: "Check approval request",
    description:
      "Check whether a create, start, or stop request was approved and completed in NIVIO Test Suite.",
    inputSchema: { id: z.string().uuid() },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  },
  async ({ id }) => result(await bridge("get_approval", { id })),
);

server.registerTool(
  "list_investigations",
  {
    title: "List open investigations",
    description:
      "List open failure investigations with status, round, project and test. Start here when the user asks you to analyze a failed Business Central test.",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  },
  async () => result(await bridge("list_investigations")),
);

server.registerTool(
  "get_investigation",
  {
    title: "Read an investigation package",
    description:
      "Read the failure package (brief, failing step, log, Page Script, project context) and the user's decision for one investigation.",
    inputSchema: { id: z.string().uuid() },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  },
  async ({ id }) => result(await bridge("get_investigation", { id })),
);

server.registerTool(
  "submit_plan",
  {
    title: "Submit an analysis and plan",
    description:
      "Submit your analysis and proposed changes as markdown (under 100 kB). This only stores the plan for the user to review. Do not change code until get_investigation_decision returns approved.",
    inputSchema: { id: z.string().uuid(), plan: z.string().min(1).max(100_000) },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  },
  async ({ id, plan }) => result(await bridge("submit_plan", { id, plan })),
);

server.registerTool(
  "get_investigation_decision",
  {
    title: "Check the user's decision on the plan",
    description:
      "Read the status and decision. Proceed with code changes only when the decision is approved; on changes-requested, read the note and submit a revised plan.",
    inputSchema: { id: z.string().uuid() },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  },
  async ({ id }) => result(await bridge("get_investigation_decision", { id })),
);

server.registerTool(
  "report_change",
  {
    title: "Report the applied change",
    description:
      "After the plan is approved and the change is committed locally, report the summary, branch, commit and files. Never push. Only allowed once the plan is approved.",
    inputSchema: {
      id: z.string().uuid(),
      summary: z.string().min(1).max(2000),
      branch: z.string().min(1).max(200),
      commit: z.string().max(80).optional(),
      files: z.array(z.string().min(1).max(500)).max(200).default([]),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  },
  async (input) => result(await bridge("report_change", input)),
);

server.registerResource(
  "page-script-authoring",
  "nivio-test-suite://guides/page-script-authoring",
  { title: "NIVIO Test Suite Page Script authoring rules", mimeType: "text/markdown" },
  async (uri) => ({
    contents: [
      {
        uri: uri.href,
        mimeType: "text/markdown",
        text: "# Page Script authoring\n\n1. Call `list_tests`, then `get_test` for relevant examples.\n2. Create standalone Business Central Page Script YAML with a non-empty `steps` array.\n3. Reuse the parameter structure from existing tests; mark sensitive inputs with `secret: true`.\n4. Call `validate_test_script`.\n5. Call `create_test` and ask the user to approve it in NIVIO Test Suite.\n6. Poll `get_approval`. Never create production-enabled scripts or request credentials.\n",
      },
    ],
  }),
);

const transport = new StdioServerTransport();
await server.connect(transport);

async function bridge(method: string, params?: unknown): Promise<unknown> {
  const connection = JSON.parse(await readFile(connectionFile, "utf8")) as BridgeConnection;
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ method, params });
    const outgoing = request(
      connection.url,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${connection.token}`,
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        response.on("end", () => {
          try {
            const payload = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
              result?: unknown;
              error?: string;
            };
            if ((response.statusCode ?? 500) >= 400) {
              reject(
                new Error(payload.error ?? `NIVIO Test Suite returned ${response.statusCode}.`),
              );
            } else {
              resolve(payload.result);
            }
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    outgoing.once("error", reject);
    outgoing.end(body);
  });
}

function result(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
    structuredContent: { result: value },
  };
}

function approvalResult(value: unknown) {
  const request = value as { id?: string };
  return result({
    ...request,
    nextStep: `Ask the user to approve request ${request.id ?? ""} on the NIVIO Test Suite Dashboard, then poll get_approval.`,
  });
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}
