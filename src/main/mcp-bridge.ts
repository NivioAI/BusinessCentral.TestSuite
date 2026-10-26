import { randomBytes } from "node:crypto";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { type IncomingMessage, type Server, type ServerResponse, createServer } from "node:http";
import { parse, stringify } from "yaml";
import {
  MCP_TOOLS,
  type McpStatus,
  emptyMcpStatus,
  toolForBridgeMethod,
} from "../shared/mcp-tools";
import type { McpCreateTestInput, StartRunInput, TestDefinition } from "../shared/models";
import type { AppController } from "./controller";
import { sanitizeRun, sanitizeText } from "./run-export";

const MAX_REQUEST_BYTES = 2_500_000;

export class McpBridge {
  private server?: Server;
  private token = randomBytes(32).toString("base64url");
  private readonly lastCalls = new Map<string, string>();
  private listening = false;

  constructor(
    private readonly controller: AppController,
    private readonly connectionFile: string,
    private readonly onCall: () => void = () => undefined,
  ) {}

  /** Which tools exist and when each was last used. Nothing from the calls themselves. */
  status(): McpStatus {
    const base = emptyMcpStatus();
    const tools = base.tools.map((tool) => ({
      ...tool,
      lastCallAt: this.lastCalls.get(tool.name),
    }));
    const times = tools
      .map((tool) => tool.lastCallAt)
      .filter((value): value is string => Boolean(value));
    return {
      listening: this.listening,
      lastCallAt: times.sort().at(-1),
      tools,
    };
  }

  async start(): Promise<void> {
    this.server = createServer((request, response) => void this.handle(request, response));
    await new Promise<void>((resolve, reject) => {
      this.server?.once("error", reject);
      this.server?.listen(0, "127.0.0.1", () => resolve());
    });
    const address = this.server.address();
    if (!address || typeof address === "string") throw new Error("The MCP bridge could not start.");
    this.listening = true;
    await writeFile(
      this.connectionFile,
      JSON.stringify({
        version: 1,
        url: `http://127.0.0.1:${address.port}/rpc`,
        token: this.token,
      }),
      { encoding: "utf8", mode: 0o600 },
    );
  }

  async close(): Promise<void> {
    this.listening = false;
    await new Promise<void>((resolve) => this.server?.close(() => resolve()));
    await unlink(this.connectionFile).catch(() => undefined);
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      if (request.method !== "POST" || request.url !== "/rpc")
        return send(response, 404, { error: "Not found" });
      if (request.headers.host && !/^127\.0\.0\.1:\d+$/.test(request.headers.host)) {
        return send(response, 403, { error: "Invalid host" });
      }
      if (request.headers.origin)
        return send(response, 403, { error: "Browser origins are not allowed" });
      if (request.headers.authorization !== `Bearer ${this.token}`) {
        return send(response, 401, { error: "Unauthorized" });
      }
      const body = await readJson(request);
      const method = String(body.method ?? "");
      const result = await this.dispatch(method, body.params);
      const tool = toolForBridgeMethod(method);
      if (MCP_TOOLS.some((item) => item.name === tool)) {
        this.lastCalls.set(tool, new Date().toISOString());
        this.onCall();
      }
      send(response, 200, { result });
    } catch (error) {
      send(response, 400, {
        error: sanitizeText(error instanceof Error ? error.message : String(error)),
      });
    }
  }

  private async dispatch(method: string, params: unknown): Promise<unknown> {
    const snapshot = this.controller.snapshot();
    const input = params && typeof params === "object" ? (params as Record<string, unknown>) : {};
    if (method === "list_tests") {
      return snapshot.tests.filter((test) => !test.archivedAt).map(publicTest);
    }
    if (method === "list_test_groups") {
      return snapshot.testGroups
        .filter((group) => !group.archivedAt)
        .map((group) => ({
          id: group.id,
          name: group.name,
          customerId: group.customerId,
          system: group.system,
        }));
    }
    if (method === "get_test") {
      const test = snapshot.tests.find((item) => item.id === input.id);
      if (!test) throw new Error("The test does not exist.");
      const yaml = await readFile(test.recordingPath, "utf8");
      return {
        ...publicTest(test),
        yaml: sanitizePageScript(yaml),
        location: "NIVIO Test Suite → Test library",
      };
    }
    if (method === "list_environments") {
      return snapshot.environments
        .filter((item) => !item.archivedAt)
        .map((environment) => ({
          id: environment.id,
          customerId: environment.customerId,
          name: environment.name,
          company: environment.company,
          type: environment.type,
          authentication: environment.authentication,
          ready: environment.authentication === "Windows" || environment.hasCredential,
        }));
    }
    if (method === "list_runs") {
      return snapshot.runs.slice(0, 50).map(publicRun);
    }
    if (method === "get_run") {
      const run = snapshot.runs.find((item) => item.id === input.id);
      if (!run) throw new Error("The run does not exist.");
      return publicRun(run);
    }
    if (method === "list_investigations") return this.controller.listAgentInvestigations();
    if (method === "get_investigation") {
      return this.controller.getAgentInvestigation(String(input.id ?? ""));
    }
    if (method === "submit_plan") {
      await this.controller.submitAgentPlan(String(input.id ?? ""), String(input.plan ?? ""));
      return {
        status: "PLAN_RECEIVED",
        nextStep:
          "Ask the user to review the plan in NIVIO Test Suite, then poll get_investigation_decision. Do not change code before it is approved.",
      };
    }
    if (method === "get_investigation_decision") {
      return this.controller.getAgentDecision(String(input.id ?? ""));
    }
    if (method === "report_change") {
      const { id, ...change } = input;
      await this.controller.reportAgentChange(String(id ?? ""), change);
      return {
        status: "CHANGE_APPLIED",
        nextStep: "The user publishes the change and starts the retest in NIVIO Test Suite.",
      };
    }
    if (method === "request_create_test") {
      return this.controller.requestMcpCreateTest(input as unknown as McpCreateTestInput);
    }
    if (method === "request_start_test") {
      return this.controller.requestMcpStartTest(input as unknown as StartRunInput);
    }
    if (method === "request_stop_test") return this.controller.requestMcpStopTest();
    if (method === "get_approval") {
      const approval = this.controller.findMcpApproval(String(input.id ?? ""));
      if (!approval) throw new Error("The MCP request does not exist.");
      return approval;
    }
    throw new Error("Unknown MCP method.");
  }
}

function publicTest(test: TestDefinition): Record<string, unknown> {
  return {
    id: test.id,
    testId: test.testId,
    name: test.name,
    description: test.description,
    customerId: test.customerId,
    groupId: test.groupId,
    risk: test.risk,
    forbiddenActions: test.forbiddenActions,
    tags: test.tags,
    allowedEnvironmentTypes: test.allowedEnvironmentTypes,
    parameters: test.parameters.map(
      ({ name, type, description, defaultValue, required, secret }) => ({
        name,
        type,
        description,
        defaultValue: secret ? "••••••••" : defaultValue,
        required,
        secret,
      }),
    ),
    versionHash: test.versionHash,
  };
}

function publicRun(run: ReturnType<typeof sanitizeRun>): Record<string, unknown> {
  const safe = sanitizeRun(run);
  return {
    id: safe.id,
    testId: safe.testId,
    testName: safe.testName,
    environmentName: safe.environmentName,
    customerCode: safe.customerCode,
    status: safe.status,
    startedAt: safe.startedAt,
    finishedAt: safe.finishedAt,
    durationMs: safe.durationMs,
    error: safe.error,
    steps: safe.steps.map(({ screenshotPath: _path, ...step }) => step),
    evidence:
      "Open NIVIO Test Suite → Run history → select this run for screenshots, video and the Playwright report.",
  };
}

function sanitizePageScript(contents: string): string {
  const document = parse(contents) as Record<string, unknown>;
  const parameters = document.parameters;
  if (parameters && typeof parameters === "object" && !Array.isArray(parameters)) {
    for (const parameter of Object.values(parameters as Record<string, unknown>)) {
      if (
        parameter &&
        typeof parameter === "object" &&
        (parameter as Record<string, unknown>).secret === true
      ) {
        (parameter as Record<string, unknown>).default = "••••••••";
      }
    }
  }
  return stringify(document, { lineWidth: 0 });
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > MAX_REQUEST_BYTES) throw new Error("The MCP request is too large.");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
}

function send(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(value));
}
