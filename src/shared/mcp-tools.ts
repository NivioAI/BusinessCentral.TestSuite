export type McpToolKind = "Read" | "Writes plan" | "Writes change" | "Needs approval";

export interface McpToolInfo {
  name: string;
  kind: McpToolKind;
}

export interface McpToolStatus extends McpToolInfo {
  lastCallAt?: string;
}

export interface McpStatus {
  /** The local bridge accepts connections. */
  listening: boolean;
  lastCallAt?: string;
  tools: McpToolStatus[];
}

/** Every tool the MCP server exposes, with what it is allowed to do. */
export const MCP_TOOLS: McpToolInfo[] = [
  { name: "list_tests", kind: "Read" },
  { name: "list_test_groups", kind: "Read" },
  { name: "get_test", kind: "Read" },
  { name: "list_environments", kind: "Read" },
  { name: "list_runs", kind: "Read" },
  { name: "get_run", kind: "Read" },
  { name: "validate_test_script", kind: "Read" },
  { name: "get_approval", kind: "Read" },
  { name: "list_investigations", kind: "Read" },
  { name: "get_investigation", kind: "Read" },
  { name: "get_investigation_decision", kind: "Read" },
  { name: "submit_plan", kind: "Writes plan" },
  { name: "report_change", kind: "Writes change" },
  { name: "create_test", kind: "Needs approval" },
  { name: "start_test", kind: "Needs approval" },
  { name: "stop_test", kind: "Needs approval" },
];

/** The bridge speaks in methods; three of them carry a request_ prefix. */
export function toolForBridgeMethod(method: string): string {
  return method.startsWith("request_") ? method.slice("request_".length) : method;
}

export const emptyMcpStatus = (): McpStatus => ({
  listening: false,
  tools: MCP_TOOLS.map((tool) => ({ ...tool })),
});
